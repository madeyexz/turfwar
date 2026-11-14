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
import type { InputSession } from '../shared/rec/clean';
import { CLEAN_RULES, recPrefix, type RecEnv } from '../shared/rec/policy';
import { loadSegment, manifestKey, qualityOf, RecentSessions, type Manifest } from '../tools/recorder/lib';
import { getJson, listAll, putChecked, r2 } from '../tools/recorder/r2';

const env: RecEnv = process.argv.includes('--env') && process.argv[process.argv.indexOf('--env') + 1] === 'dev' ? 'dev' : 'tw';
const prefix = process.env.REC_PREFIX ?? recPrefix(env);
const c = r2('turfwar-rec', 'R2_REC_READ');

let movement = 0, aim = 0, segments = 0, badChecksum = 0, noManifest = 0, rounds = 0;
// Only the latest decoded input sessions are kept: with all of them the run needs more memory than an orb or the VM has.
const cache = new RecentSessions<string, InputSession[]>();
const keys = (await listAll(c, `${prefix}/seg/`)).map(x => x.key);
// 24 segments at a time: each segment needs about 2 s of round trips to R2, so one at a time 18,000 segments take about 10 hours. The sums are made in key order.
const clean = new Array<{ clean: number; aimClean: number }[] | 'noManifest' | 'badChecksum'>(keys.length);
let next = 0;
await Promise.all(Array.from({ length: 24 }, async () => {
  while (next < keys.length) {
    const i = next++, key = keys[i];
    // R2 sometimes answers a request with an internal error: try a segment again, four times at most.
    for (let attempt = 1; ; attempt++) {
      try {
        const m = await getJson<Manifest>(c, manifestKey(key));
        if (!m) { clean[i] = 'noManifest'; break; }
        let seg;
        try { seg = await loadSegment(c, key, m.sha256); } catch (e) { if (String(e).includes('checksum mismatch')) { clean[i] = 'badChecksum'; break; } throw e; }
        const q = await qualityOf(c, prefix, key, seg, CLEAN_RULES, cache);
        clean[i] = q.qualities.filter(x => x.tier === 'clean').map(x => ({ clean: x.clean, aimClean: x.aimClean }));
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        console.error(`${key}: ${String(e).slice(0, 120)}; again (${attempt})`);
        await Bun.sleep(2000 * attempt);
      }
    }
    if ((i + 1) % 1000 === 0) console.error(`${i + 1} of ${keys.length} segments`);
  }
}));
for (const one of clean) {
  if (one === 'noManifest') { noManifest++; continue; }
  if (one === 'badChecksum') { badChecksum++; continue; }
  segments++;
  for (const x of one) { rounds++; movement += x.clean; aim += x.aimClean; }
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
