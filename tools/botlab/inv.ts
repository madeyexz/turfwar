// Inventory: the admin summary and every quality file -> /tmp/rec/quality.jsonl (one QualityFile per line).
import { r2, listAll, getJson } from '/home/user/workspace/repo/tools/recorder/r2';
const c = r2('turfwar-rec', 'R2_REC_READ');
const stats = await getJson<any>(c, 'v1/stats/clean-hours.json');
await Bun.write('/tmp/rec/clean-hours.json', JSON.stringify(stats));
console.log('stats keys', Object.keys(stats ?? {}));
const t0 = Date.now();
const keys = await listAll(c, 'v1/quality/');
console.log('quality files', keys.length, 'list ms', Date.now() - t0);
const out = Bun.file('/tmp/rec/quality.jsonl').writer();
let next = 0, done = 0, fail = 0;
await Promise.all(Array.from({ length: 24 }, async () => {
  while (next < keys.length) {
    const k = keys[next++].key;
    try { const t = await c.file(k).text(); JSON.parse(t); out.write(JSON.stringify({ key: k, q: JSON.parse(t) }) + '\n'); } catch (e) { fail++; }
    if (++done % 2000 === 0) console.log(done, 'of', keys.length, 'fail', fail, ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
}));
await out.end();
console.log('done', done, 'fail', fail, ((Date.now() - t0) / 1000).toFixed(0) + 's');
