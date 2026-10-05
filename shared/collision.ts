import { clamp, type Vec3 } from './math';

/**
 * Static world collision shared by client prediction, offline bots and the SpacetimeDB module.
 * Solids are axis-aligned boxes; ramps are walkable slopes; terrain is a regular heightfield.
 * Keeping this pure TypeScript (no WASM) lets the exact same rules run inside the server module.
 */
export type Surface = 'metal' | 'concrete' | 'rock' | 'dirt' | 'glass' | 'energy';

export interface Solid {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  surface: Surface;
  /** Shield walls block players but let bullets through only from the owning team. */
  team?: number;
}

export interface Ramp {
  minX: number; minZ: number; maxX: number; maxZ: number;
  /** Height at the low and high ends. */
  y0: number; y1: number;
  /** 0: rises along +X, 1: along +Z, 2: along -X, 3: along -Z. */
  dir: 0 | 1 | 2 | 3;
  surface: Surface;
}

/**
 * Climbable ladder fixed to a wall face. A soldier touching it climbs instead of falling; it is
 * not solid (the wall behind it is).
 */
export interface Ladder {
  /** Foot of the ladder's centre line on the wall face, its top (the landing height) and width. */
  x: number; z: number; y0: number; y1: number; width: number;
  /** Direction from the ladder into the wall, the way a climber faces: 0 +X, 1 +Z, 2 -X, 3 -Z. */
  dir: 0 | 1 | 2 | 3;
}

/** Unit vectors into the wall for each ladder direction. */
export const LADDER_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
/** How far in front of the rungs a soldier's centre can be and still hold on. */
export const LADDER_REACH = 0.35;

export interface Heightfield {
  /** World-space minimum corner and cell spacing. */
  x0: number; z0: number; spacing: number;
  /** Number of samples along each axis. */
  n: number;
  heights: Float32Array;
}

export interface RayHit {
  t: number;
  point: Vec3;
  normal: Vec3;
  surface: Surface;
  /** Index of the solid that was hit, -1 for terrain, -2 - i for ramp i. */
  index: number;
}

export const STEP_HEIGHT = 0.55;
const CELL = 8;

export function terrainHeight(field: Heightfield, x: number, z: number) {
  const gx = clamp((x - field.x0) / field.spacing, 0, field.n - 1.0001);
  const gz = clamp((z - field.z0) / field.spacing, 0, field.n - 1.0001);
  const ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz;
  const n = field.n, h = field.heights;
  const a = h[iz * n + ix], b = h[iz * n + ix + 1], c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
  // Triangulated exactly like the render mesh (diagonal from a to d) so feet never float.
  return u >= v ? a + (b - a) * u + (d - b) * v : a + (d - c) * u + (c - a) * v;
}

export function rampHeight(r: Ramp, x: number, z: number) {
  let t: number;
  switch (r.dir) {
    case 0: t = (x - r.minX) / (r.maxX - r.minX); break;
    case 1: t = (z - r.minZ) / (r.maxZ - r.minZ); break;
    case 2: t = (r.maxX - x) / (r.maxX - r.minX); break;
    default: t = (r.maxZ - z) / (r.maxZ - r.minZ); break;
  }
  return r.y0 + (r.y1 - r.y0) * clamp(t, 0, 1);
}

export class CollisionWorld {
  readonly cells = new Map<number, { solids: number[]; ramps: number[] }>();
  private stamp: Uint32Array;
  private stampId = 1;

  constructor(readonly solids: Solid[], readonly ramps: Ramp[], readonly terrain: Heightfield,
    readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, readonly ladders: Ladder[] = []) {
    this.stamp = new Uint32Array(Math.max(1, solids.length));
    solids.forEach((s, i) => this.insert(s.minX, s.minZ, s.maxX, s.maxZ, c => c.solids.push(i)));
    ramps.forEach((r, i) => this.insert(r.minX, r.minZ, r.maxX, r.maxZ, c => c.ramps.push(i)));
  }

  private key(cx: number, cz: number) { return (cx + 512) * 1024 + (cz + 512); }
  private insert(minX: number, minZ: number, maxX: number, maxZ: number, add: (c: { solids: number[]; ramps: number[] }) => void) {
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = this.key(cx, cz);
        let cell = this.cells.get(k);
        if (!cell) { cell = { solids: [], ramps: [] }; this.cells.set(k, cell); }
        add(cell);
      }
  }

  /** Visit each solid whose XZ footprint might overlap the rectangle, once. */
  forSolidsIn(minX: number, minZ: number, maxX: number, maxZ: number, visit: (s: Solid, i: number) => void) {
    const id = this.nextStamp();
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const cell = this.cells.get(this.key(cx, cz));
        if (!cell) continue;
        for (const i of cell.solids) {
          if (this.stamp[i] === id) continue;
          this.stamp[i] = id;
          visit(this.solids[i], i);
        }
      }
  }

  private nextStamp() {
    if (++this.stampId > 0xfffffff0) { this.stamp.fill(0); this.stampId = 1; }
    return this.stampId;
  }

  rampsAt(x: number, z: number) {
    return this.cells.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)))?.ramps ?? [];
  }

  /**
   * Highest walkable surface under a vertical cylinder whose feet are at feetY.
   * Surfaces up to STEP_HEIGHT above the feet count, which gives automatic step-up.
   */
  groundHeight(x: number, z: number, feetY: number, radius: number, step = STEP_HEIGHT) {
    let best = terrainHeight(this.terrain, x, z);
    const limit = feetY + step;
    this.forSolidsIn(x - radius, z - radius, x + radius, z + radius, s => {
      if (s.maxY > limit || s.maxY <= best) return;
      if (circleRect(x, z, radius * 0.7, s)) best = s.maxY;
    });
    for (const i of this.rampsAt(x, z)) {
      const r = this.ramps[i];
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      const h = rampHeight(r, x, z);
      if (h <= limit + 0.15 && h > best) best = h;
    }
    return best;
  }

  /** The ladder a cylinder with its feet at (x, y, z) is holding: in reach of the rungs, within their width, below the top. */
  ladderAt(x: number, y: number, z: number, radius: number) {
    for (const l of this.ladders) {
      const [nx, nz] = LADDER_DIRS[l.dir];
      const depth = (x - l.x) * nx + (z - l.z) * nz, side = (z - l.z) * nx - (x - l.x) * nz;
      if (Math.abs(side) <= l.width / 2 && depth >= -(radius + LADDER_REACH) && depth <= 0.3 && y >= l.y0 - 0.1 && y <= l.y1 - 0.05) return l;
    }
    return undefined;
  }

  /** Lowest ceiling above the head of a cylinder, or Infinity. */
  ceilingHeight(x: number, z: number, feetY: number, radius: number) {
    let best = Infinity;
    this.forSolidsIn(x - radius, z - radius, x + radius, z + radius, s => {
      if (s.minY <= feetY + STEP_HEIGHT || s.minY >= best) return;
      if (circleRect(x, z, radius * 0.9, s)) best = s.minY;
    });
    return best;
  }

  /**
   * Push a vertical cylinder out of solids it overlaps horizontally. Returns true if blocked.
   * `team` lets a soldier pass through their own spawn shield.
   */
  resolveCylinder(pos: Vec3, radius: number, height: number, team = -1) {
    let blocked = false;
    for (let iteration = 0; iteration < 3; iteration++) {
      let moved = false;
      this.forSolidsIn(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, s => {
        if (s.maxY <= pos.y + STEP_HEIGHT || s.minY >= pos.y + height) return;
        if (s.team !== undefined && s.team === team) return;
        const cx = clamp(pos.x, s.minX, s.maxX), cz = clamp(pos.z, s.minZ, s.maxZ);
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) return;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          pos.x += dx / d * (radius - d); pos.z += dz / d * (radius - d);
        } else {
          // Center is inside the rectangle: exit through the nearest face.
          const left = pos.x - s.minX, right = s.maxX - pos.x, back = pos.z - s.minZ, front = s.maxZ - pos.z;
          const m = Math.min(left, right, back, front);
          if (m === left) pos.x = s.minX - radius; else if (m === right) pos.x = s.maxX + radius;
          else if (m === back) pos.z = s.minZ - radius; else pos.z = s.maxZ + radius;
          dx = 0; dz = 0;
        }
        moved = true; blocked = true;
      });
      if (!moved) break;
    }
    const b = this.bounds;
    if (pos.x < b.minX) { pos.x = b.minX; blocked = true; }
    if (pos.x > b.maxX) { pos.x = b.maxX; blocked = true; }
    if (pos.z < b.minZ) { pos.z = b.minZ; blocked = true; }
    if (pos.z > b.maxZ) { pos.z = b.maxZ; blocked = true; }
    return blocked;
  }

  /**
   * True if a cylinder at pos overlaps any solid. Team shields are ignored unless `team` is
   * given, in which case the other team's shields count (server-side movement validation).
   */
  overlapsSolid(pos: Vec3, radius: number, height: number, team = -1) {
    let hit = false;
    this.forSolidsIn(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, s => {
      if (hit || (s.team !== undefined && (team < 0 || s.team === team)) || s.maxY <= pos.y + STEP_HEIGHT || s.minY >= pos.y + height) return;
      if (circleRect(pos.x, pos.z, radius, s)) hit = true;
    });
    return hit;
  }

  /**
   * Nearest intersection along a unit direction. `team` makes that team's shields transparent.
   */
  raycast(o: Vec3, d: Vec3, maxDist: number, team = -1): RayHit | null {
    let bestT = maxDist, best: RayHit | null = null;
    const ex = o.x + d.x * maxDist, ez = o.z + d.z * maxDist;
    this.forSolidsIn(Math.min(o.x, ex), Math.min(o.z, ez), Math.max(o.x, ex), Math.max(o.z, ez), (s, i) => {
      if (s.team !== undefined && (s.team === team || team === -2)) return;
      const hit = rayBox(o, d, s, bestT);
      if (hit && hit.t < bestT) { bestT = hit.t; best = { ...hit, surface: s.surface, index: i }; }
    });
    // Ramps (top surface only).
    for (let i = 0; i < this.ramps.length; i++) {
      const r = this.ramps[i];
      const t = rayRamp(o, d, r, bestT);
      if (t >= 0 && t < bestT) {
        bestT = t;
        const n = rampNormal(r);
        best = { t, point: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t }, normal: n, surface: r.surface, index: -2 - i };
      }
    }
    const tt = this.raycastTerrain(o, d, bestT);
    if (tt >= 0 && tt < bestT) {
      const p = { x: o.x + d.x * tt, y: o.y + d.y * tt, z: o.z + d.z * tt };
      best = { t: tt, point: p, normal: this.terrainNormal(p.x, p.z), surface: 'dirt', index: -1 };
    }
    return best;
  }

  /** True when nothing static blocks the straight segment between two points. */
  lineOfSight(a: Vec3, b: Vec3, team = -1) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return true;
    return !this.raycast(a, { x: dx / len, y: dy / len, z: dz / len }, len - 0.05, team);
  }

  raycastTerrain(o: Vec3, d: Vec3, maxDist: number) {
    const step = 0.75;
    let prevT = 0, prevAbove = o.y - terrainHeight(this.terrain, o.x, o.z);
    if (prevAbove < 0) return 0;
    for (let t = step; t <= maxDist + step; t += step) {
      const tc = Math.min(t, maxDist);
      const above = o.y + d.y * tc - terrainHeight(this.terrain, o.x + d.x * tc, o.z + d.z * tc);
      if (above < 0) {
        // Bisect for a precise impact point.
        let lo = prevT, hi = tc;
        for (let k = 0; k < 10; k++) {
          const mid = (lo + hi) / 2;
          const m = o.y + d.y * mid - terrainHeight(this.terrain, o.x + d.x * mid, o.z + d.z * mid);
          if (m < 0) hi = mid; else lo = mid;
        }
        return hi;
      }
      if (tc >= maxDist) break;
      prevT = tc; prevAbove = above;
    }
    return -1;
  }

  terrainNormal(x: number, z: number): Vec3 {
    const e = 0.5;
    const hx = terrainHeight(this.terrain, x + e, z) - terrainHeight(this.terrain, x - e, z);
    const hz = terrainHeight(this.terrain, x, z + e) - terrainHeight(this.terrain, x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    return { x: nx / l, y: ny / l, z: nz / l };
  }
}

export function circleRect(x: number, z: number, r: number, s: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  const cx = clamp(x, s.minX, s.maxX), cz = clamp(z, s.minZ, s.maxZ);
  return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
}

export function rayBox(o: Vec3, d: Vec3, s: Solid, maxT: number) {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  const lo = [s.minX, s.minY, s.minZ], hi = [s.maxX, s.maxY, s.maxZ];
  const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dd[a]) < 1e-12) {
      if (oo[a] < lo[a] || oo[a] > hi[a]) return null;
      continue;
    }
    const inv = 1 / dd[a];
    let t1 = (lo[a] - oo[a]) * inv, t2 = (hi[a] - oo[a]) * inv, sg = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sg = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sign = sg; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis < 0) {
    // Origin inside the box: report an immediate hit facing back along the ray.
    return { t: 0, point: { ...o }, normal: { x: -d.x, y: -d.y, z: -d.z } };
  }
  const normal = { x: axis === 0 ? sign : 0, y: axis === 1 ? sign : 0, z: axis === 2 ? sign : 0 };
  return { t: tmin, point: { x: o.x + d.x * tmin, y: o.y + d.y * tmin, z: o.z + d.z * tmin }, normal };
}

function rampNormal(r: Ramp): Vec3 {
  const run = r.dir === 0 || r.dir === 2 ? r.maxX - r.minX : r.maxZ - r.minZ;
  const rise = r.y1 - r.y0;
  const l = Math.hypot(run, rise);
  const h = -rise / l, v = run / l;
  switch (r.dir) {
    case 0: return { x: h, y: v, z: 0 };
    case 1: return { x: 0, y: v, z: h };
    case 2: return { x: -h, y: v, z: 0 };
    default: return { x: 0, y: v, z: -h };
  }
}

function rayRamp(o: Vec3, d: Vec3, r: Ramp, maxT: number) {
  const n = rampNormal(r);
  const denom = n.x * d.x + n.y * d.y + n.z * d.z;
  if (Math.abs(denom) < 1e-9) return -1;
  // Plane passes through the low edge point.
  const px = r.dir === 2 ? r.maxX : r.minX, pz = r.dir === 3 ? r.maxZ : r.minZ;
  const t = (n.x * (px - o.x) + n.y * (r.y0 - o.y) + n.z * (pz - o.z)) / denom;
  if (t < 0 || t > maxT) return -1;
  const x = o.x + d.x * t, z = o.z + d.z * t;
  if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) return -1;
  return t;
}
