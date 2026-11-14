// Download: quality files -> quality.jsonl, then every segment and every input batch the quality files name.
import { r2, listAll } from '/home/user/workspace/repo/tools/recorder/r2';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const c = r2('turfwar-rec', 'R2_REC_READ');
const N = Number(process.env.CONC ?? 64);
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';
async function pool<T>(items: T[], fn: (x: T) => Promise<void>, label: string) {
  let next = 0, done = 0, fail = 0;
  await Promise.all(Array.from({ length: N }, async () => {
    while (next < items.length) {
      const x = items[next++];
      for (let a = 0; ; a++) { try { await fn(x); break; } catch (e) { if (a >= 3) { fail++; break; } await Bun.sleep(300 * (a + 1)); } }
      if (++done % 2000 === 0) console.log(label, done, 'of', items.length, 'fail', fail, el());
    }
  }));
  console.log(label, 'done', done, 'fail', fail, el());
}
if (!existsSync('/tmp/rec/quality.jsonl.ok')) {
  const keys = await listAll(c, 'v1/quality/');
  console.log('quality files', keys.length, el());
  const out = Bun.file('/tmp/rec/quality.jsonl').writer();
  await pool(keys, async k => { const t = await c.file(k.key).text(); out.write(JSON.stringify({ key: k.key, q: JSON.parse(t) }) + '\n'); }, 'quality');
  await out.end();
  await Bun.write('/tmp/rec/quality.jsonl.ok', 'ok');
}
const segs = new Set<string>(), inputs = new Set<string>();
for (const line of (await Bun.file('/tmp/rec/quality.jsonl').text()).split('\n')) {
  if (!line) continue;
  const { q } = JSON.parse(line);
  segs.add(q.segment);
  for (const k of q.inputs ?? []) inputs.add(k);
}
console.log('segments', segs.size, 'input batches', inputs.size);
const get = async (key: string) => {
  const path = '/tmp/rec/' + key.replace(/^v1\//, '');
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  const buf = await c.file(key).arrayBuffer();
  await Bun.write(path + '.part', buf);
  const { renameSync } = await import('node:fs');
  renameSync(path + '.part', path);
};
await pool([...segs], get, 'seg');
await pool([...inputs], get, 'input');
console.log('ALL DONE', el());
