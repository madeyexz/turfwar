// Local recount (docs/RECORDING.md "Proof"), same steps as scripts/rec-recount.ts but over the local copy:
// every segment in the R2 list, sha256 against its manifest, classify again from raw segment + input
// files with the repo's own code, own sum. Usage: bun recount.ts <shard> <shards>
import { CLEAN_RULES } from '/home/user/workspace/repo/shared/rec/policy';
import { loadSegment, manifestKey, qualityOf, type Manifest } from '/home/user/workspace/repo/tools/recorder/lib';
import { getJson } from '/home/user/workspace/repo/tools/recorder/r2';
import { client as c, lists, Lru, shardOf } from './local';
const shard = Number(process.argv[2] ?? 0), shards = Number(process.argv[3] ?? 1);
const out = Bun.file(`/tmp/rec/out/recount-${shard}.jsonl`).writer();
let movement = 0, aim = 0, segments = 0, badChecksum = 0, noManifest = 0, rounds = 0, errors = 0;
const cache = new Lru<string, any>(10);
const t0 = Date.now();
const mine = lists.seg.filter(x => shardOf(x.key, shards) === shard);
for (const { key } of mine) {
  const m = await getJson<Manifest>(c, manifestKey(key));
  if (!m) { noManifest++; continue; }
  let seg;
  try { seg = await loadSegment(c, key, m.sha256); } catch { badChecksum++; continue; }
  segments++;
  try {
    const q = await qualityOf(c, 'v1', key, seg, CLEAN_RULES, cache);
    for (const x of q.qualities) {
      if (x.tier !== 'clean') continue;
      rounds++; movement += x.clean; aim += x.aimClean;
    }
    out.write(JSON.stringify({ key, checks: q.checks, inputs: q.inputs.length, q: q.qualities.map(x => ({ id: x.soldierId, tier: x.tier, aliveLive: x.aliveLive, clean: x.clean, aimClean: x.aimClean, dropped: x.dropped, input: x.input, assist: x.aimAssist })) }) + '\n');
  } catch (e) { errors++; out.write(JSON.stringify({ key, error: String(e).slice(0, 200) }) + '\n'); }
  if (segments % 500 === 0) { out.flush(); console.log(shard, segments, 'of', mine.length, ((Date.now() - t0) / 1000).toFixed(0) + 's', 'rss', (process.memoryUsage().rss / 1e6).toFixed(0) + 'MB'); }
}
await out.end();
const result = { shard, shards, segments, rounds, badChecksum, noManifest, errors, movementHours: movement / 3600, aimHours: aim / 3600, seconds: (Date.now() - t0) / 1000 };
await Bun.write(`/tmp/rec/out/recount-${shard}.json`, JSON.stringify(result));
console.log('DONE', JSON.stringify(result));
