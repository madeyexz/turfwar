// Second download pass for an independent recount: list the raw keys in R2 (segments, input batches,
// manifests), then fetch the manifests and every input batch that the first pass did not fetch.
import { r2, listAll } from '/home/user/workspace/repo/tools/recorder/r2';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
const c = r2('turfwar-rec', 'R2_REC_READ');
const N = 64, t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';
mkdirSync('/tmp/rec/lists', { recursive: true });
const lists: Record<string, { key: string; size: number }[]> = {};
for (const kind of ['seg', 'manifest', 'input', 'stats']) {
  const path = `/tmp/rec/lists/${kind}.json`;
  if (existsSync(path)) { lists[kind] = await Bun.file(path).json(); continue; }
  lists[kind] = (await listAll(c, `v1/${kind}/`)).map(x => ({ key: x.key, size: x.size }));
  await Bun.write(path, JSON.stringify(lists[kind]));
  console.log('listed', kind, lists[kind].length, (lists[kind].reduce((n, x) => n + x.size, 0) / 1e9).toFixed(3), 'GB', el());
}
async function pool<T>(items: T[], fn: (x: T) => Promise<void>, label: string) {
  let next = 0, done = 0, fail = 0;
  await Promise.all(Array.from({ length: N }, async () => {
    while (next < items.length) {
      const x = items[next++];
      for (let a = 0; ; a++) { try { await fn(x); break; } catch { if (a >= 3) { fail++; break; } await Bun.sleep(300 * (a + 1)); } }
      if (++done % 4000 === 0) console.log(label, done, 'of', items.length, 'fail', fail, el());
    }
  }));
  console.log(label, 'done', done, 'fail', fail, el());
}
const local = (key: string) => '/tmp/rec/' + key.replace(/^v1\//, '');
const get = async (key: string) => {
  const path = local(key);
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path + '.part', await c.file(key).arrayBuffer());
  renameSync(path + '.part', path);
};
const missSeg = lists.seg.filter(x => !existsSync(local(x.key)));
const missIn = lists.input.filter(x => !existsSync(local(x.key)));
console.log('segments in R2', lists.seg.length, 'not local', missSeg.length, '| input batches in R2', lists.input.length, 'not local', missIn.length, '| manifests', lists.manifest.length);
await pool(missSeg.map(x => x.key), get, 'seg');
await pool(missIn.map(x => x.key), get, 'input');
await pool(lists.manifest.map(x => x.key), get, 'manifest');
await pool(lists.stats.map(x => x.key), get, 'stats');
console.log('ALL DONE', el());
