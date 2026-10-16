/**
 * The recording processor (docs/RECORDING.md), run hourly on the game server's machine by a systemd
 * timer: classifies every new segment with the clean rules (a quality file next to its manifest), then
 * rewrites the admin summary `stats/clean-hours.json` from all quality files, and once a day applies
 * the retention rules (input never used by a segment: 30 days; everything: 3 years).
 *
 *   bun process.ts [--retention] [--reprocess]
 *
 * Environment: REC_ENV, R2_REC_VM_ACCESS_KEY_ID, R2_REC_VM_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, REC_DIR.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TARGETS, totals, type InputSession, type Quality } from '../../shared/rec/clean';
import { CLEAN_RULES, KEEP_DAYS, UNUSABLE_KEEP_DAYS, recPrefix, type RecEnv } from '../../shared/rec/policy';
import { qualityKey, qualityOf, loadSegment, type Manifest, type QualityFile } from './lib';
import { getJson, listAll, putChecked, r2 } from './r2';

const ENV = (process.env.REC_ENV ?? 'tw') as RecEnv;
const PREFIX = process.env.REC_PREFIX ?? recPrefix(ENV);
const DIR = process.env.REC_DIR ?? '/var/lib/turfwar-rec';
const CACHE = join(DIR, 'quality-cache');
mkdirSync(CACHE, { recursive: true, mode: 0o700 });
const c = r2(process.env.REC_BUCKET ?? 'turfwar-rec', 'R2_REC_VM');
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...extra }));
const reprocess = process.argv.includes('--reprocess');
/** Input batches arrive up to ~30 s after a round (plus retries): wait this long before classifying. */
const SETTLE_MS = Number(process.env.REC_SETTLE_MS ?? 10 * 60_000);

const manifests = await listAll(c, `${PREFIX}/manifest/`);
const done = new Set((await listAll(c, `${PREFIX}/quality/`)).map(x => x.key));
/** A quality file from the local cache, else from R2 (then cached). */
async function readQuality(qkey: string): Promise<QualityFile | undefined> {
  const local = join(CACHE, qkey.replace(/\//g, '_'));
  if (existsSync(local)) return JSON.parse(readFileSync(local, 'utf8'));
  const q = await getJson<QualityFile>(c, qkey);
  if (q) writeFileSync(local, JSON.stringify(q));
  return q;
}
// Quality files of an older version of the clean rules are classified again (once, after an update).
const stale = new Set<string>();
for (const qkey of done) if ((await readQuality(qkey))?.rules !== CLEAN_RULES) stale.add(qkey);
let processed = 0, failed = 0;
/**
 * Decoded input sessions, shared by neighbouring segments; only the latest few are kept (the service has
 * 400 MB, and a reprocess of every segment after a rules change would otherwise hold every session).
 */
class RecentSessions<K, V> extends Map<K, V> {
  override set(k: K, v: V) {
    super.delete(k); super.set(k, v);
    while (this.size > 24) this.delete(this.keys().next().value as K);
    return this;
  }
}
const inputCache = new RecentSessions<string, InputSession[]>();
for (const { key, lastModified } of manifests) {
  const qkey = qualityKey(key);
  if (done.has(qkey) && !reprocess && !stale.has(qkey)) continue;
  if (!done.has(qkey) && lastModified && Date.now() - Date.parse(lastModified) < SETTLE_MS) continue;
  try {
    const m = await getJson<Manifest>(c, key);
    if (!m) continue;
    const seg = await loadSegment(c, m.key, m.sha256);
    const q = await qualityOf(c, PREFIX, m.key, seg, CLEAN_RULES, inputCache);
    await putChecked(c, qkey, JSON.stringify(q), 'application/json');
    writeFileSync(join(CACHE, qkey.replace(/\//g, '_')), JSON.stringify(q));
    done.add(qkey);
    processed++;
  } catch (e) { failed++; log('segment failed', { key, error: String(e) }); }
}

// ---- The summary --------------------------------------------------------------------------------
const files: QualityFile[] = [];
for (const qkey of done) { const q = await readQuality(qkey); if (q) files.push(q); }
const optouts = new Set((await listAll(c, `${PREFIX}/optout/`)).map(x => x.key.match(/pid=([0-9a-f]+)/)?.[1] ?? ''));
const qualities: Quality[] = files.flatMap(f => f.qualities);
/** The export takes public, non-EU/UK subjects who did not opt out, from matches with no other human left out (approximated per segment here). */
const hasExcluded = new Set(files.filter(f => f.qualities.some(q => q.tier === 'excluded')).map(f => f.segment));
const t = totals(qualities, q => q.roomKind === 'public' && !q.euUk && !optouts.has(q.pid) && !hasExcluded.has(q.segment));
const kills = files.reduce((n, f) => n + f.checks.kills, 0), matched = files.reduce((n, f) => n + f.checks.killsMatched, 0);
const recount = await getJson<Record<string, unknown>>(c, `${PREFIX}/stats/recount.json`);
const stats = {
  env: ENV, rules: CLEAN_RULES, updatedAt: Date.now(), targets: TARGETS,
  movementHours: t.movementHours, aimHours: t.aimHours, exportMovementHours: t.exportMovementHours, exportAimHours: t.exportAimHours,
  serverOnlyHours: t.serverOnlyHours, aliveLiveHours: t.aliveLiveHours, subjectRounds: t.subjectRounds, cleanRounds: t.cleanRounds,
  segments: files.length, manifests: manifests.length, subjects: new Set(qualities.filter(q => q.pid).map(q => q.pid)).size,
  topTenShare: topShare(qualities, 0.1),
  killReconciliation: { kills, matched },
  meanGapRatio: files.length ? files.reduce((n, f) => n + f.checks.gapRatio, 0) / files.length : 0,
  dropped: dropped(qualities),
  byDay: t.byDay, byDevice: t.byDevice, byInput: t.byInput, byMap: t.byMap,
  recount: recount ?? null,
};
await putChecked(c, `${PREFIX}/stats/clean-hours.json`, JSON.stringify(stats), 'application/json');
log('processed', { processed, stale: stale.size, failed, segments: files.length, movementHours: +t.movementHours.toFixed(3), aimHours: +t.aimHours.toFixed(3) });

/** Share of movement-clean hours from the top `q` of subjects (concentration, for the bias check). */
function topShare(qs: Quality[], q: number) {
  const by = new Map<string, number>();
  for (const x of qs) if (x.clean > 0) by.set(x.pid, (by.get(x.pid) ?? 0) + x.clean);
  const v = [...by.values()].sort((a, b) => b - a), sum = v.reduce((a, b) => a + b, 0);
  return sum ? v.slice(0, Math.max(1, Math.ceil(v.length * q))).reduce((a, b) => a + b, 0) / sum : 0;
}
function dropped(qs: Quality[]) {
  const out: Record<string, number> = {};
  for (const x of qs) for (const [k, s] of Object.entries(x.dropped)) out[k] = (out[k] ?? 0) + s / 3600;
  return out;
}

// ---- Retention (daily) --------------------------------------------------------------------------
if (process.argv.includes('--retention') || new Date().getUTCHours() === 19) {
  const used = new Set(files.flatMap(f => f.inputs));
  const now = Date.now(), day = (k: string) => Date.parse(k.match(/dt=(\d{4}-\d{2}-\d{2})/)?.[1] ?? '') || now;
  let removed = 0;
  for (const { key } of await listAll(c, `${PREFIX}/input/`)) {
    const age = (now - day(key)) / 86_400_000;
    if (age > KEEP_DAYS || (age > UNUSABLE_KEEP_DAYS && !used.has(key))) { await c.delete(key); removed++; }
  }
  for (const part of ['seg', 'manifest', 'quality']) {
    for (const { key } of await listAll(c, `${PREFIX}/${part}/`)) if ((now - day(key)) / 86_400_000 > KEEP_DAYS) { await c.delete(key); removed++; }
  }
  log('retention', { removed });
}
