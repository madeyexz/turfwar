// List the session index in R2 (read key), to compare it with the input tree.
import { r2, listAll } from '/home/user/workspace/repo/tools/recorder/r2';
const c = r2('turfwar-rec', 'R2_REC_READ');
const t0 = Date.now();
const idx = (await listAll(c, 'v1/index/')).map(x => ({ key: x.key, size: x.size }));
await Bun.write('/tmp/rec/lists/index.json', JSON.stringify(idx));
const input: { key: string; size: number }[] = await Bun.file('/tmp/rec/lists/input.json').json();
const fromTree = new Set<string>();
for (const { key } of input) {
  const m = key.match(/^v1\/input\/dt=(\d{4}-\d{2}-\d{2})\/pid=([^/]+)\/s=([0-9a-f]{24})\//);
  if (m) fromTree.add(`v1/index/pid=${m[2]}/input-${m[1]}-${m[3]}.json`);
}
const inIdx = new Set(idx.filter(x => /\/input-/.test(x.key)).map(x => x.key));
let onlyTree = 0, onlyIdx = 0;
for (const k of fromTree) if (!inIdx.has(k)) onlyTree++;
for (const k of inIdx) if (!fromTree.has(k)) onlyIdx++;
const kinds: Record<string, number> = {};
for (const x of idx) { const k = x.key.replace(/^v1\/index\/pid=[^/]+\//, '').replace(/-.*$/, ''); kinds[k] = (kinds[k] ?? 0) + 1; }
console.log(JSON.stringify({ indexKeys: idx.length, kinds, sessionsFromTree: fromTree.size, sessionsInIndex: inIdx.size, onlyTree, onlyIdx, ms: Date.now() - t0 }));
