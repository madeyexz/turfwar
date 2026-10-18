/**
 * The match recorder (docs/RECORDING.md), a long-running Bun service on the game server's machine.
 * It connects to SpacetimeDB on localhost as an ordinary SDK client, signs in with the admin key (for
 * the admin-only `recorder_subjects` view: who plays where, with their consent), subscribes to every
 * room's roster, takes the frames and events of rooms with a recording subject (frames.ts, a second and
 * lighter connection), cuts one segment per round (shared/rec/segmenter.ts), compresses it
 * with zstd, spools it to disk and uploads it to R2 with a checked ETag and a sha256 manifest. Players who
 * turn datasets off get an opt-out marker (their pid only), which the export reads.
 *
 * Environment (deploy/gcp-taipei/recorder/env.example): STDB_URI, STDB_DB, REC_ENV (tw | dev),
 * TURFWAR_ADMIN_KEY, REC_SALT, R2_REC_VM_ACCESS_KEY_ID, R2_REC_VM_SECRET_ACCESS_KEY, R2_ACCOUNT_ID,
 * REC_DIR (spool and token), REC_SPOOL_MAX_MB.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DbConnection } from '../../src/module_bindings';
import { mapDef } from '../../shared/maps/index';
import { encodeSegment, type Segment } from '../../shared/rec/segment';
import { Segmenter, type RosterRow, type Subject } from '../../shared/rec/segmenter';
import { REC_TERMS_VERSION, pidOf, recPrefix, utcDate, type RecEnv } from '../../shared/rec/policy';
import { FrameFeed, checkRowTypes } from './frames';
import { putChecked, r2, sha256Hex } from './r2';

declare const RECORDER_SHA: string;
const SHA = typeof RECORDER_SHA === 'string' ? RECORDER_SHA : (process.env.RECORDER_SHA ?? 'dev');
const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:8080';
const DB = process.env.STDB_DB ?? 'turfwar';
const ENV = (process.env.REC_ENV ?? 'tw') as RecEnv;
const DIR = process.env.REC_DIR ?? '/var/lib/turfwar-rec';
const SPOOL = join(DIR, 'spool');
const SPOOL_MAX = Number(process.env.REC_SPOOL_MAX_MB ?? 2048) * 1024 * 1024;
const ADMIN_KEY = (process.env.TURFWAR_ADMIN_KEY ?? '').trim();
const SALT = (process.env.REC_SALT ?? '').trim();
const PREFIX = process.env.REC_PREFIX ?? recPrefix(ENV);
if (!ADMIN_KEY || !SALT) throw new Error('TURFWAR_ADMIN_KEY and REC_SALT must be set');
if (ENV !== 'tw' && ENV !== 'dev') throw new Error('REC_ENV must be tw or dev');
mkdirSync(SPOOL, { recursive: true, mode: 0o700 });
const bucket = r2(process.env.REC_BUCKET ?? 'turfwar-rec', 'R2_REC_VM');

const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...extra }));

// ---- Module and map hashes ----------------------------------------------------------------------
/** sha256 of the module's schema (`/v1/database/<db>/schema?version=9`): it changes whenever tables, reducers or views do. */
let moduleHash = '';
async function refreshModuleHash() {
  try {
    const res = await fetch(`${URI.replace(/^ws/, 'http')}/v1/database/${DB}/schema?version=9`);
    if (!res.ok) throw new Error(`schema ${res.status}`);
    const h = `schema:${sha256Hex(await res.text())}`;
    if (h !== moduleHash) { moduleHash = h; log('module', { moduleHash }); }
  } catch (e) { log('module hash failed', { error: String(e) }); }
}
const mapHashes = new Map<string, string>();
const mapHash = (id: string) => {
  let h = mapHashes.get(id);
  if (h === undefined) { try { h = sha256Hex(JSON.stringify(mapDef(id))); } catch { h = ''; } mapHashes.set(id, h); }
  return h;
};

// ---- Spool and upload ---------------------------------------------------------------------------
const stats = { segments: 0, uploaded: 0, failed: 0, spoolFull: 0, bytes: 0 };
const spoolSize = () => readdirSync(SPOOL).reduce((n, f) => n + statSync(join(SPOOL, f)).size, 0);

/** Close a segment: compress, write to the spool (atomically), then upload in the background. */
function spool(seg: Segment) {
  stats.segments++;
  const raw = encodeSegment(seg);
  const zst = Bun.zstdCompressSync(raw, { level: 9 });
  if (spoolSize() + zst.length > SPOOL_MAX) { stats.spoolFull++; log('spool full: segment dropped', { room: seg.header.room }); return; }
  const h = seg.header;
  const day = utcDate(h.startMs);
  const name = `${h.matchUid}-r${String(h.round).padStart(3, '0')}-${h.startTick}`;
  const key = `${PREFIX}/seg/dt=${day}/room=${String(h.room).padStart(3, '0')}/${name}.tfr.zst`;
  const manifest = {
    key, bytes: zst.length, rawBytes: raw.length, sha256: sha256Hex(zst), rawSha256: sha256Hex(raw),
    recorderSha: h.recorderSha, moduleHash: h.moduleHash, frameVersion: h.frameVersion, mapId: h.mapId, mapHash: h.mapHash,
    mode: h.mode, teamSize: h.teamSize, roomKind: h.roomKind, matchUid: h.matchUid, round: h.round, startMs: h.startMs, endMs: h.endMs,
    ticksExpected: h.ticksExpected, ticksReceived: h.ticksReceived, gapRatio: h.gapRatio, truncated: h.truncated,
    pids: [...new Set(h.soldiers.filter(s => s.pid).map(s => s.pid!))],
  };
  const tmp = join(SPOOL, `${name}.tmp`);
  writeFileSync(tmp, zst, { mode: 0o600 });
  writeFileSync(join(SPOOL, `${name}.json`), JSON.stringify(manifest), { mode: 0o600 });
  renameSync(tmp, join(SPOOL, `${name}.zst`));
  void drain();
}

let draining = false;
async function drain() {
  if (draining) return;
  draining = true;
  try {
    for (const f of readdirSync(SPOOL).filter(f => f.endsWith('.json')).sort()) {
      const base = f.slice(0, -5), data = join(SPOOL, `${base}.zst`);
      if (!existsSync(data)) { unlinkSync(join(SPOOL, f)); continue; }
      const manifest = JSON.parse(readFileSync(join(SPOOL, f), 'utf8')) as { key: string; pids: string[]; startMs: number };
      try {
        await putChecked(bucket, manifest.key, new Uint8Array(readFileSync(data)), 'application/zstd');
        const mkey = manifest.key.replace('/seg/', '/manifest/').replace(/\.tfr\.zst$/, '.json');
        await putChecked(bucket, mkey, JSON.stringify(manifest), 'application/json');
        // The player-to-file index (deletion requests): one small object per subject and segment.
        for (const pid of manifest.pids) await putChecked(bucket, `${PREFIX}/index/pid=${pid}/seg-${base}.json`, JSON.stringify({ kind: 'seg', key: manifest.key, manifest: mkey, day: utcDate(manifest.startMs) }), 'application/json');
        unlinkSync(data); unlinkSync(join(SPOOL, f));
        stats.uploaded++; stats.bytes += manifest.key.length;
      } catch (e) {
        stats.failed++;
        log('upload failed; will retry', { key: manifest.key, error: String(e) });
        break;
      }
    }
  } finally { draining = false; }
}
setInterval(() => void drain(), 60_000);

// ---- Subjects and opt-outs ----------------------------------------------------------------------
const pids = new Map<string, string>();
const optedOut = new Set<string>();
async function pid(identity: string) {
  let p = pids.get(identity);
  if (!p) { p = await pidOf(SALT, ENV, identity); pids.set(identity, p); }
  return p;
}
/** room → soldier → subject, rebuilt from the view. */
let subjects = new Map<number, Map<number, Subject>>();
type SubjectRow = { identity: string; soldierId: number; room: number; termsVersion: number; excluded: boolean; excludedBy: string; platform: string; device: string; euUk: boolean };
async function rebuildSubjects(rows: SubjectRow[]) {
  const next = new Map<number, Map<number, Subject>>();
  for (const r of rows) {
    const p = await pid(r.identity);
    const subject = r.termsVersion >= REC_TERMS_VERSION && !r.excluded && r.platform !== 'crazygames';
    let m = next.get(r.room); if (!m) next.set(r.room, m = new Map());
    m.set(r.soldierId, { pid: subject ? p : undefined, subject, device: r.device, euUk: r.euUk, termsVersion: r.termsVersion });
    // Turned datasets off: earlier matches leave later exports too (the export reads these markers).
    if (r.excluded && r.termsVersion > 0 && !optedOut.has(p)) {
      optedOut.add(p);
      putChecked(bucket, `${PREFIX}/optout/pid=${p}.json`, JSON.stringify({ at: Date.now(), by: r.excludedBy || 'setting' }), 'application/json')
        .catch(e => { optedOut.delete(p); log('opt-out marker failed', { error: String(e) }); });
    }
  }
  subjects = next;
}

// ---- The connection -----------------------------------------------------------------------------
const segmenter = new Segmenter({
  env: ENV, recorderSha: SHA, moduleHash: () => moduleHash, mapHash, now: () => Date.now(),
  uid: () => crypto.randomUUID().replace(/-/g, '').slice(0, 16), onClose: spool,
});
const TOKEN_FILE = join(DIR, 'token');
let conn: DbConnection | undefined;
let feed: FrameFeed | undefined;
/** Rooms whose frames the recorder takes now (rooms with a recording subject in them). */
let watching = 0;
let backoff = 1000;

function connect() {
  const token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : undefined;
  const c = DbConnection.builder().withUri(URI).withDatabaseName(DB).withToken(token)
    // Localhost: compression only costs CPU here (per-message gzip on the server, a decompression stream per message here).
    // Light mode: no reducer details with each update (the callbacks only read rows).
    .withCompression('none').withLightMode(true)
    .onConnect((ctx, identity, next) => {
      writeFileSync(TOKEN_FILE, next, { mode: 0o600 });
      log('connected', { identity: identity.toHexString().slice(0, 8) });
      backoff = 1000;
      ctx.reducers.adminLogin({ key: ADMIN_KEY }).catch(e => log('admin login failed', { error: String(e) }));
      const db = ctx.db;
      // Each room's info, parsed when its match row changes (frames arrive 30 times a second).
      const rooms = new Map<number, { configJson: string; mode: string; teamSize: number }>();
      const setRoom = (m: { id: number; configJson: string }) => {
        let cfg: { mode?: string; teamSize?: number } = {};
        try { cfg = JSON.parse(m.configJson); } catch { /* old row */ }
        rooms.set(m.id, { configJson: m.configJson, mode: cfg.mode ?? '', teamSize: cfg.teamSize ?? 0 });
      };
      const priv = new Set<number>();
      const roster = new Map<number, RosterRow & { room: number }>();
      const info = (room: number) => {
        const m = rooms.get(room);
        return { configJson: m?.configJson ?? '', mode: m?.mode ?? '', teamSize: m?.teamSize ?? 0, private: priv.has(room) };
      };
      const subjectIn = (room: number) => (id: number) => subjects.get(room)?.get(id);
      // Frames and events only from rooms with a recording subject in them: a round without one is not
      // kept, and every frame costs this small VM CPU (30 a second per room). A subject who joins mid-round
      // starts the segment there. Its own connection (frames.ts): the SDK's decoder costs more than the rest.
      feed?.close();
      const thisFeed = feed = new FrameFeed({
        uri: URI, db: DB, token: next, log,
        sink: { frame: f => onFrame(f), event: e => segmenter.event(e.room, e.json) },
        onClose: () => { log('frame connection closed'); watching = 0; try { ctx.disconnect(); } catch { /* already closed */ } },
      });
      thisFeed.start().catch(e => { log('frame connection failed', { error: String(e) }); thisFeed.close(); });
      const syncRooms = () => {
        const want = new Set<number>();
        for (const [room, m] of subjects) for (const s of m.values()) if (s.subject && s.pid) want.add(room);
        thisFeed.watch(want);
        watching = want.size;
      };
      // One rebuild at a time, always from the newest rows (rows arrive one callback each).
      let rebuilding = false, again = false;
      const refresh = () => {
        if (rebuilding) { again = true; return; }
        rebuilding = true;
        void rebuildSubjects([...db.recorderSubjects.iter()] as SubjectRow[]).then(syncRooms).finally(() => { rebuilding = false; if (again) { again = false; refresh(); } });
      };
      db.match.onInsert((_c, m) => setRoom(m));
      db.match.onUpdate((_c, _o, m) => setRoom(m));
      db.match.onDelete((_c, m) => { rooms.delete(m.id); segmenter.close(m.id, false); });
      db.privateRoom.onInsert((_c, r) => priv.add(r.room));
      db.privateRoom.onDelete((_c, r) => priv.delete(r.room));
      const onRoster = (r: RosterRow & { room: number }) => { roster.set(r.id, r); segmenter.roster(r.room, r, subjectIn(r.room)); };
      db.roster.onInsert((_c, r) => onRoster(r as unknown as RosterRow & { room: number }));
      db.roster.onUpdate((_c, _o, r) => onRoster(r as unknown as RosterRow & { room: number }));
      db.roster.onDelete((_c, r) => roster.delete(r.id));
      db.recorderSubjects.onInsert(refresh);
      db.recorderSubjects.onDelete(refresh);
      const onFrame = (f: { id: number; mapId: string; data: Uint8Array }) => {
        segmenter.frame(f.id, f.mapId, f.data, info(f.id), id => roster.get(id), subjectIn(f.id));
      };
      ctx.subscriptionBuilder()
        .onApplied(() => { refresh(); log('subscribed', { rooms: rooms.size }); })
        .onError(ec => {
          // An older module (no recorder_subjects yet), or a revoked admin: try again from a fresh connection.
          log('subscription error; reconnecting in 60 s', { error: String((ec as { event?: unknown }).event ?? 'unknown') });
          setTimeout(() => { try { ctx.disconnect(); } catch { /* already closed */ } }, 60_000);
        })
        .subscribe(['SELECT * FROM match', 'SELECT * FROM private_room', 'SELECT * FROM roster', 'SELECT * FROM recorder_subjects']);
    })
    .onConnectError((_c, e) => { log('connect failed', { error: String(e) }); retry(); })
    .onDisconnect(() => { log('disconnected'); feed?.close(); watching = 0; segmenter.closeAll(true); retry(); })
    .build();
  conn = c;
}
let retrying = false;
function retry() {
  if (retrying) return;
  retrying = true;
  conn = undefined;
  setTimeout(() => { retrying = false; connect(); }, backoff);
  backoff = Math.min(60_000, backoff * 2);
}

// A room whose frames stop (its humans left) closes after 30 s; health every minute.
setInterval(() => segmenter.closeIdle(30_000), 10_000);
setInterval(() => {
  void refreshModuleHash();
  log('health', { ...stats, rooms: subjects.size, watching, open: segmenter.openRooms.length, skippedVersion: segmenter.skippedVersion, droppedNoSubject: segmenter.droppedNoSubject, spoolBytes: spoolSize(), connected: !!conn });
}, 60_000);

const stop = () => { log('stopping'); segmenter.closeAll(true); void drain().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 20_000); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

checkRowTypes();
await refreshModuleHash();
void drain();
connect();
