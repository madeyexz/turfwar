import { CollisionWorld, STEP_HEIGHT, rampHeight, terrainHeight } from '../collision';
import { MOVE } from '../movement';
import type { MapDef } from '../maps/types';

/**
 * Automatically generated multi-level navigation grid. Every walkable surface (terrain, roofs,
 * catwalks, ramps) becomes nodes; edges connect neighbours a soldier can actually walk or drop
 * between. Built deterministically from map data, so the server and offline client agree.
 */
export interface NavGraph {
  x: Float32Array; y: Float32Array; z: Float32Array;
  /** CSR adjacency. */
  offsets: Uint32Array; edges: Uint32Array; costs: Float32Array;
  spacing: number;
  /** Column lookup: key -> node ids in that column. */
  columns: Map<number, number[]>;
  x0: number; z0: number; nx: number; nz: number;
}

const SPACING = 2.5;
const MAX_DROP = 4.2;

export function buildNav(map: MapDef, world: CollisionWorld): NavGraph {
  const b = map.bounds;
  const x0 = b.minX + 1, z0 = b.minZ + 1;
  const nx = Math.floor((b.maxX - b.minX - 2) / SPACING) + 1, nz = Math.floor((b.maxZ - b.minZ - 2) / SPACING) + 1;
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  const columns = new Map<number, number[]>();
  const r = MOVE.radius + 0.05;

  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const x = x0 + ix * SPACING, z = z0 + iz * SPACING;
    const candidates = [terrainHeight(world.terrain, x, z)];
    world.forSolidsIn(x, z, x, z, s => {
      if (s.team === undefined && x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) candidates.push(s.maxY);
    });
    for (const i of world.rampsAt(x, z)) {
      const ramp = world.ramps[i];
      if (x >= ramp.minX && x <= ramp.maxX && z >= ramp.minZ && z <= ramp.maxZ) candidates.push(rampHeight(ramp, x, z));
    }
    const ids: number[] = [];
    for (const h of candidates.sort((a, c) => a - c)) {
      if (ids.some(id => Math.abs(ys[id] - h) < 0.3)) continue;
      // Must stand on something here (not a hidden surface under a higher floor) and fit upright.
      const ground = world.groundHeight(x, z, h, MOVE.radius * 0.5, 0.05);
      if (Math.abs(ground - h) > 0.08) continue;
      const pos = { x, y: h, z };
      if (world.overlapsSolid(pos, r, MOVE.standHeight)) continue;
      if (world.ceilingHeight(x, z, h, r) < h + MOVE.standHeight) continue;
      // Reject steep terrain.
      if (candidates[0] === h) {
        const n = world.terrainNormal(x, z);
        if (n.y < 0.72) continue;
      }
      ids.push(xs.length); xs.push(x); ys.push(h); zs.push(z);
    }
    if (ids.length) columns.set(iz * nx + ix, ids);
  }

  let adjacency: { to: number; cost: number }[][] = xs.map(() => []);
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const here = columns.get(iz * nx + ix);
    if (!here) continue;
    for (const [dx, dz] of dirs) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const there = columns.get(jz * nx + jx);
      if (!there) continue;
      for (const a of here) for (const c of there) {
        const forward = walkable(world, xs[a], ys[a], zs[a], xs[c], ys[c], zs[c]);
        const backward = walkable(world, xs[c], ys[c], zs[c], xs[a], ys[a], zs[a]);
        const cost = Math.hypot(xs[a] - xs[c], ys[a] - ys[c], zs[a] - zs[c]);
        if (forward) adjacency[a].push({ to: c, cost });
        if (backward) adjacency[c].push({ to: a, cost });
      }
    }
  }
  // Keep only nodes reachable from (and returning to) the spawns; drops onto isolated roofs vanish.
  const keep = reachable(adjacency, map.spawns.map(sp => closestIndex(xs, ys, zs, sp.x, sp.y, sp.z)));
  const remap = new Int32Array(xs.length).fill(-1);
  let count = 0;
  for (let i = 0; i < xs.length; i++) if (keep[i]) remap[i] = count++;
  const kx: number[] = [], ky: number[] = [], kz: number[] = [];
  for (let i = 0; i < xs.length; i++) if (keep[i]) { kx.push(xs[i]); ky.push(ys[i]); kz.push(zs[i]); }
  adjacency = adjacency.filter((_, i) => keep[i]).map(list => list.filter(e => keep[e.to]).map(e => ({ to: remap[e.to], cost: e.cost })));
  for (const [key, ids] of [...columns]) {
    const kept = ids.filter(i => keep[i]).map(i => remap[i]);
    if (kept.length) columns.set(key, kept); else columns.delete(key);
  }
  xs.length = 0; ys.length = 0; zs.length = 0; xs.push(...kx); ys.push(...ky); zs.push(...kz);

  const offsets = new Uint32Array(xs.length + 1);
  adjacency.forEach((list, i) => { offsets[i + 1] = offsets[i] + list.length; });
  const edges = new Uint32Array(offsets[xs.length]), costs = new Float32Array(offsets[xs.length]);
  adjacency.forEach((list, i) => list.forEach((e, k) => { edges[offsets[i] + k] = e.to; costs[offsets[i] + k] = e.cost; }));
  return { x: Float32Array.from(xs), y: Float32Array.from(ys), z: Float32Array.from(zs), offsets, edges, costs, spacing: SPACING, columns, x0, z0, nx, nz };
}

/** Can a soldier move from a to b? Climbs are limited to step height; drops are one-way. */
function walkable(world: CollisionWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const rise = by - ay;
  if (rise > STEP_HEIGHT + 0.1) {
    // Only ramps/stairs allow larger climbs between neighbouring samples.
    if (!onRampPath(world, ax, ay, az, bx, by, bz)) return false;
  }
  if (rise < -MAX_DROP) return false;
  // Sample the segment: ground must stay continuous (no gaps) unless dropping, body must fit.
  const samples = 4;
  let prev = ay;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const g = world.groundHeight(x, z, Math.max(prev, ay + rise * t) + 0.05, MOVE.radius * 0.6);
    if (g - prev > STEP_HEIGHT + 0.15) return false;
    if (rise >= -0.6 && prev - g > 1.0 && i < samples) return false;
    if (world.overlapsSolid({ x, y: g, z }, MOVE.radius, MOVE.standHeight * 0.9)) return false;
    prev = g;
  }
  return Math.abs(prev - by) < 0.7;
}

function onRampPath(world: CollisionWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  for (const i of world.rampsAt(mx, mz)) {
    const r = world.ramps[i];
    if (mx < r.minX - 0.3 || mx > r.maxX + 0.3 || mz < r.minZ - 0.3 || mz > r.maxZ + 0.3) continue;
    const run = Math.hypot(bx - ax, bz - az);
    if ((by - ay) / run < 1.2) return true;
  }
  return false;
}

export function nearestNode(nav: NavGraph, x: number, y: number, z: number) {
  const ix = Math.round((x - nav.x0) / nav.spacing), iz = Math.round((z - nav.z0) / nav.spacing);
  let best = -1, bestD = Infinity;
  // Always search the neighbouring ring too: the closest column can hold an unreachable roof.
  for (let ring = 0; ring <= 5 && (best < 0 || ring <= 1); ring++) {
    for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
      const ids = nav.columns.get((iz + dz) * nav.nx + ix + dx);
      if (!ids) continue;
      for (const id of ids) {
        const d = (nav.x[id] - x) ** 2 + ((nav.y[id] - y) * 2) ** 2 + (nav.z[id] - z) ** 2;
        if (d < bestD) { bestD = d; best = id; }
      }
    }
  }
  return best;
}

/** A* search returning node ids from start to goal (inclusive), or [] when unreachable. */
export function findPath(nav: NavGraph, start: number, goal: number, maxExpand = Math.max(6000, nav.x.length)): number[] {
  if (start < 0 || goal < 0) return [];
  if (start === goal) return [start];
  const n = nav.x.length;
  const g = new Float32Array(n).fill(Infinity), came = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
  const heap: number[] = [], f: number[] = [];
  const h = (i: number) => Math.hypot(nav.x[i] - nav.x[goal], nav.y[i] - nav.y[goal], nav.z[i] - nav.z[goal]);
  const push = (i: number, score: number) => {
    heap.push(i); f.push(score);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[p] <= f[k]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]]; [f[p], f[k]] = [f[k], f[p]]; k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const lastI = heap.pop()!, lastF = f.pop()!;
    if (heap.length) {
      heap[0] = lastI; f[0] = lastF;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && f[l] < f[m]) m = l;
        if (r < heap.length && f[r] < f[m]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; [f[m], f[k]] = [f[k], f[m]]; k = m;
      }
    }
    return top;
  };
  g[start] = 0; push(start, h(start));
  let expanded = 0;
  while (heap.length && expanded < maxExpand) {
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1; expanded++;
    for (let e = nav.offsets[cur]; e < nav.offsets[cur + 1]; e++) {
      const next = nav.edges[e];
      if (closed[next]) continue;
      const score = g[cur] + nav.costs[e];
      if (score < g[next]) { g[next] = score; came[next] = cur; push(next, score + h(next)); }
    }
  }
  if (came[goal] < 0) return [];
  const path = [goal];
  for (let c = came[goal]; c >= 0; c = came[c]) path.push(c);
  return path.reverse();
}

function closestIndex(xs: number[], ys: number[], zs: number[], x: number, y: number, z: number) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = (xs[i] - x) ** 2 + (ys[i] - y) ** 2 * 4 + (zs[i] - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Nodes reachable from the seeds that can also get back to a seed (strongly connected). */
function reachable(adjacency: { to: number }[][], seeds: number[]) {
  const n = adjacency.length;
  const forward = new Uint8Array(n), backward = new Uint8Array(n);
  const reverse: number[][] = adjacency.map(() => []);
  adjacency.forEach((list, i) => list.forEach(e => reverse[e.to].push(i)));
  const flood = (mark: Uint8Array, next: (i: number) => number[]) => {
    const stack = [...seeds];
    for (const s of seeds) mark[s] = 1;
    while (stack.length) { const c = stack.pop()!; for (const t of next(c)) if (!mark[t]) { mark[t] = 1; stack.push(t); } }
  };
  flood(forward, i => adjacency[i].map(e => e.to));
  flood(backward, i => reverse[i]);
  return Array.from(forward, (f, i) => f && backward[i]);
}
