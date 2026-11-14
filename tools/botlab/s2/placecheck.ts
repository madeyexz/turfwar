// Lab: check the places table against the nav grid, as the bot uses it (nearestNode of the place, a path from the base).
// Usage: bun placecheck.ts [--cells]   (prints totals per map and side; --cells also prints each bad cell)
import { loadMap, loadNav } from '/home/user/workspace/repo/shared/maps/index';
import { nearestNode } from '/home/user/workspace/repo/shared/match/nav';
import { PLACES, PLACE_WEIGHTS } from '/home/user/workspace/repo/shared/match/places';

const SIDE = 4, HEIGHT = 2.5, NEAR = 2.5;
const showCells = process.argv.includes('--cells');
let allBad = 0, allJit = 0, allSides = 0;
const kinds = { noWay: 0, far: 0, level: 0 }; let farthest = 0;
for (const [id, sides] of Object.entries(PLACES)) {
  const { def } = loadMap(id); const nav = loadNav(id);
  sides.forEach((cells, side) => {
    // All nodes a soldier can walk to from the base of this side.
    const reach = new Uint8Array(nav.x.length); const stack: number[] = [];
    for (const p of def.spawns) if (p.team === side) { const n = nearestNode(nav, p.x, p.y, p.z); if (n >= 0 && !reach[n]) { reach[n] = 1; stack.push(n); } }
    while (stack.length) { const a = stack.pop()!; for (let e = nav.offsets[a]; e < nav.offsets[a + 1]; e++) { const b = nav.edges[e]; if (!reach[b]) { reach[b] = 1; stack.push(b); } } }
    const ok = (x: number, y: number, z: number, px: number, py: number, pz: number, far: number, w = 0) => {
      const n = nearestNode(nav, x, y, z);
      if (n < 0 || !reach[n]) { kinds.noWay += w; return false; }
      if (Math.hypot(nav.x[n] - px, nav.z[n] - pz) > far) { kinds.far += w; if (w) farthest = Math.max(farthest, Math.hypot(nav.x[n] - px, nav.z[n] - pz)); return false; }
      if (Math.abs(nav.y[n] - py) > HEIGHT) { kinds.level += w; return false; }
      return true;
    };
    let sum = 0, bad = 0, jit = 0, count = 0;
    for (let i = 0; i < cells.length; i += 4) {
      const [x, y, z, w] = cells.slice(i, i + 4); sum += w; count++;
      if (!ok(x, y, z, x, y, z, SIDE)) { bad += w; if (showCells) console.log('  bad', id, side, x, y, z, w); continue; }
      // The goals the bot can take from this place: a disc of NEAR m.
      let fail = 0, n = 0;
      for (const r of [NEAR, NEAR * 0.7, NEAR * 0.4]) for (let k = 0; k < 16; k++) {
        const a = (k + 0.5) / 16 * Math.PI * 2; n++;
        if (!ok(x + Math.cos(a) * r, y, z + Math.sin(a) * r, x, y, z, SIDE + NEAR, w / 48)) fail++;
      }
      jit += w * fail / n;
      if (showCells && fail) console.log('  jitter', id, side, x, y, z, w, (fail / n).toFixed(2));
    }
    allBad += bad; allJit += jit; allSides++;
    console.log(id.padEnd(11), side, 'cells', String(count).padStart(3), 'sum', sum, sum === PLACE_WEIGHTS ? '' : 'SUM!', 'bad centre', bad, 'bad goal (of 10,000)', jit.toFixed(0));
  });
}
console.log('bad goals by kind, mean of 10,000 per side: no way', (kinds.noWay / allSides).toFixed(1), 'far', (kinds.far / allSides).toFixed(1), 'other level', (kinds.level / allSides).toFixed(1), '| farthest goal node from its place (m)', farthest.toFixed(1));
console.log('mean bad centre', (allBad / allSides).toFixed(0), 'mean bad goal', (allJit / allSides).toFixed(0), 'of 10,000');
