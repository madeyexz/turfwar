/**
 * Independent recount of the clean hours (docs/RECORDING.md "Proof"): lists the segments themselves (not
 * the processor's manifests or quality files), checks each one's sha256 against its manifest, classifies
 * every subject again from the raw segment and input files, sums movement-clean and aim-clean hours with
 * its own loop, and compares them with `stats/clean-hours.json`.
 *
 *   bun scripts/rec-recount.ts [--env dev] [--write]
 *
 * Reads with R2_REC_READ_* keys; `--write` stores the result as stats/recount.json (needs R2_REC_VM_* keys).
 * Exit code 1 when the totals differ by more than 1 % (or 0.01 h).
 */
import { CLEAN_RULES, recPrefix, type RecEnv } from '../shared/rec/policy';
import { loadSegment, manifestKey, qualityOf, type Manifest } from '../tools/recorder/lib';
import { getJson, listAll, putChecked, r2 } from '../tools/recorder/r2';

const env: RecEnv = process.argv.includes('--env') && process.argv[process.argv.indexOf('--env') + 1] === 'dev' ? 'dev' : 'tw';
const prefix = process.env.REC_PREFIX ?? recPrefix(env);
const c = r2('turfwar-rec', 'R2_REC_READ');

let movement = 0, aim = 0, segments = 0, badChecksum = 0, noManifest = 0, rounds = 0;
const cache = new Map();
for (const { key } of await listAll(c, `${prefix}/seg/`)) {
  const m = await getJson<Manifest>(c, manifestKey(key));
  if (!m) { noManifest++; continue; }
  let seg;
  try { seg = await loadSegment(c, key, m.sha256); } catch { badChecksum++; continue; }
  segments++;
  const q = await qualityOf(c, prefix, key, seg, CLEAN_RULES, cache);
  for (const x of q.qualities) {
    if (x.tier !== 'clean') continue;
    rounds++;
    movement += x.clean;
    aim += x.aimClean;
  }
}
const stats = await getJson<{ movementHours: number; aimHours: number; segments: number; updatedAt: number }>(c, `${prefix}/stats/clean-hours.json`);
const result = {
  at: Date.now(), env, rules: CLEAN_RULES, segments, rounds, badChecksum, noManifest,
  movementHours: movement / 3600, aimHours: aim / 3600,
  admin: stats ? { movementHours: stats.movementHours, aimHours: stats.aimHours, segments: stats.segments, updatedAt: stats.updatedAt } : null,
};
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, 0.01 * Math.max(a, b));
const ok = !!stats && close(result.movementHours, stats.movementHours) && close(result.aimHours, stats.aimHours) && !badChecksum && !noManifest;
console.log(JSON.stringify({ ...result, ok }, null, 2));
if (process.argv.includes('--write')) await putChecked(r2('turfwar-rec', 'R2_REC_VM'), `${prefix}/stats/recount.json`, JSON.stringify({ ...result, ok }), 'application/json');
process.exit(ok ? 0 : 1);
