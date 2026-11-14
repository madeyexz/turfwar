// Lab: the second step of the places table (after mkplaces_repo.py). Leave out the cells that a bot cannot walk to
// and make the weights of each side sum to PLACE_WEIGHTS again. A cell stays when the nav node that the bot would
// go to (nearestNode) is within 4 m sideways and 2.5 m in height, and there is a path to it from the base of the side.
// The test "the places of the players are on the nav grid" (shared/match/match.test.ts) has the same rule.
// Usage: bun placefix.ts /home/user/workspace/repo/shared/match/places.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { loadMap, loadNav } from '/home/user/workspace/repo/shared/maps/index';
import { findPath, nearestNode } from '/home/user/workspace/repo/shared/match/nav';

const SUM = 10000, SIDE = 4, HEIGHT = 2.5;
const file = process.argv[2];
const lines = readFileSync(file, 'utf8').split('\n');
let map = '', side = 0, kept = 0, dropped = 0;
for (let i = 0; i < lines.length; i++) {
  const head = /^  (\w+): \[$/.exec(lines[i]);
  if (head) { map = head[1]; side = 0; continue; }
  const row = /^    \[([-\d.,]+)\],$/.exec(lines[i]);
  if (!row) continue;
  const v = row[1].split(',').map(Number);
  const { def } = loadMap(map); const nav = loadNav(map);
  const base = def.spawns.find(p => p.team === side)!;
  const from = nearestNode(nav, base.x, base.y, base.z);
  const cells: number[][] = []; let lost = 0;
  for (let k = 0; k < v.length; k += 4) {
    const [x, y, z, w] = v.slice(k, k + 4);
    const n = nearestNode(nav, x, y, z);
    if (n >= 0 && Math.hypot(nav.x[n] - x, nav.z[n] - z) <= SIDE && Math.abs(nav.y[n] - y) <= HEIGHT && findPath(nav, from, n).length) cells.push([x, y, z, w]);
    else lost += w;
  }
  const total = cells.reduce((a, c) => a + c[3], 0);
  const w = cells.map(c => Math.max(1, Math.round(c[3] / total * SUM)));
  w[0] += SUM - w.reduce((a, b) => a + b, 0);
  lines[i] = '    [' + cells.map((c, k) => `${c[0]},${c[1]},${c[2]},${w[k]}`).join(',') + '],';
  console.log(map.padEnd(11), side, 'kept', cells.length, 'left out', v.length / 4 - cells.length, 'cells with', lost, 'of', SUM);
  kept += cells.length; dropped += v.length / 4 - cells.length; side++;
}
writeFileSync(file, lines.join('\n'));
console.log('cells', kept, 'left out', dropped);
