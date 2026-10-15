/**
 * Delete one player's recordings (docs/RECORDING.md "Deletion"): from their SpacetimeDB identity (the
 * game ID they send with the request) or a pid, find every file through the player-to-file index; delete
 * their input batches; rewrite each segment they are in with their soldier blanked and their pid removed
 * (the other players' rounds stay); drop the stale quality files so the processor recounts; and leave an
 * opt-out marker so no later export holds them.
 *
 *   bun scripts/rec-delete.ts --identity <hex> [--env dev] [--dry-run]
 *   bun scripts/rec-delete.ts --pid <pid> [--env dev] [--dry-run]
 *
 * Needs REC_SALT (for --identity) and R2_REC_VM_* keys.
 */
import { pidOf, recPrefix, type RecEnv } from '../shared/rec/policy';
import { Rec, encodeSegment, recordJson, zeroSoldiers, jsonRecord } from '../shared/rec/segment';
import { loadSegment, manifestKey, qualityKey, type Manifest } from '../tools/recorder/lib';
import { getJson, listAll, putChecked, r2, sha256Hex } from '../tools/recorder/r2';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const env: RecEnv = arg('--env') === 'dev' ? 'dev' : 'tw';
const dry = process.argv.includes('--dry-run');
const prefix = process.env.REC_PREFIX ?? recPrefix(env);
const identity = arg('--identity');
const pid = arg('--pid') ?? (identity ? await pidOf(process.env.REC_SALT ?? '', env, identity.toLowerCase().replace(/^0x/, '')) : undefined);
if (!pid || !/^[0-9a-f]{32}$/.test(pid)) throw new Error('give --identity <hex> (with REC_SALT set) or --pid <pid>');
const c = r2('turfwar-rec', 'R2_REC_VM');

const index = await listAll(c, `${prefix}/index/pid=${pid}/`);
let inputs = 0, segments = 0;
for (const { key } of index) {
  const entry = await getJson<{ kind: string; prefix?: string; key?: string }>(c, key);
  if (entry?.kind === 'input' && entry.prefix) {
    for (const b of await listAll(c, entry.prefix)) { if (!dry) await c.delete(b.key); inputs++; }
  } else if (entry?.kind === 'seg' && entry.key) {
    const m = await getJson<Manifest>(c, manifestKey(entry.key));
    if (!m) continue;
    const seg = await loadSegment(c, entry.key, m.sha256);
    const ids = new Set(seg.header.soldiers.filter(s => s.pid === pid).map(s => s.soldierId));
    for (const s of seg.header.soldiers) if (ids.has(s.soldierId)) { delete s.pid; delete s.device; delete s.euUk; delete s.termsVersion; s.excluded = true; }
    seg.header.hasExcluded = true;
    seg.records = seg.records.map(r => {
      if (r.type === Rec.Frame) return { ...r, data: zeroSoldiers(r.data, ids) };
      if (r.type === Rec.Roster) { const row = recordJson<Record<string, unknown>>(r); return ids.has(row.id as number) ? jsonRecord(Rec.Roster, r.tick, r.ms, { id: row.id, team: row.team, bot: row.bot, alive: row.alive }) : r; }
      return r;
    });
    const raw = encodeSegment(seg), zst = Bun.zstdCompressSync(raw, { level: 9 });
    const pids = m.pids.filter(p => p !== pid);
    if (!dry) {
      await putChecked(c, entry.key, zst, 'application/zstd');
      await putChecked(c, manifestKey(entry.key), JSON.stringify({ ...m, bytes: zst.length, rawBytes: raw.length, sha256: sha256Hex(zst), rawSha256: sha256Hex(raw), pids }), 'application/json');
      await c.delete(qualityKey(manifestKey(entry.key)));
    }
    segments++;
  }
  if (!dry) await c.delete(key);
}
if (!dry) await putChecked(c, `${prefix}/optout/pid=${pid}.json`, JSON.stringify({ at: Date.now(), by: 'deletion' }), 'application/json');
console.log(JSON.stringify({ pid, env, dry, indexEntries: index.length, inputBatchesDeleted: inputs, segmentsRewritten: segments }));
