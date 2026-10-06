import { STEP_HEIGHT } from './collision';
import type { Vec3 } from './math';

/**
 * Moving solids: oriented boxes (turned by yaw only) that block soldiers, other vehicles and
 * grenades like the static world's solids do. Drivable vehicles' bodies are made of them (see
 * `vehicleObstacles` in vehicles.ts); everything here is pure geometry, shared by client
 * prediction, Solo and the server module. Soldiers stand on their tops like on any solid.
 */
export interface Obstacle {
  /** Owner (a vehicle's index), so a body never collides with itself. */
  id: number;
  /** Centre of the footprint and its axes: right (u) and forward (w), unit length. */
  x: number; z: number;
  rx: number; rz: number; fx: number; fz: number;
  /** Half extents along right and forward. */
  hw: number; hl: number;
  /** Bottom and top (absolute heights). */
  y0: number; y1: number;
  /** The owner's velocity (shoves soldiers it pushes, relative speed of vehicle impacts). */
  vx: number; vz: number;
  /** The owner's mass (kg) for vehicle impacts. */
  mass: number;
  /** Upward pop (m/s) given to a soldier it pushes (a run-over shove), 0 for none. */
  shove: number;
  /** Bounding radius of the footprint (broad phase). */
  reach: number;
}

/** Local footprint coordinates (u along right, w along forward) of a point. */
function local(ob: Obstacle, x: number, z: number) {
  const dx = x - ob.x, dz = z - ob.z;
  return { u: dx * ob.rx + dz * ob.rz, w: dx * ob.fx + dz * ob.fz };
}

/** Horizontal broad phase: can a circle of radius r at (x, z) touch the footprint at all? */
export const near = (ob: Obstacle, x: number, z: number, r: number) => {
  const reach = ob.reach + r;
  const dx = x - ob.x, dz = z - ob.z;
  return Math.abs(dx) < reach && Math.abs(dz) < reach && dx * dx + dz * dz < reach * reach;
};

/**
 * How far a circle of radius r at (x, z) sinks into the footprint (positive overlaps, zero or
 * less is clear), and the horizontal push (unit normal times depth) that moves it out.
 */
export function penetration(ob: Obstacle, x: number, z: number, r: number) {
  const { u, w } = local(ob, x, z);
  const du = Math.abs(u) - ob.hw, dw = Math.abs(w) - ob.hl;
  let nu: number, nw: number, depth: number;
  if (du > 0 || dw > 0) {
    // Outside: push away from the nearest point of the rectangle.
    const cu = Math.max(0, du), cw = Math.max(0, dw), d = Math.hypot(cu, cw);
    depth = r - d;
    if (depth <= 0) return { depth, x: 0, z: 0 };
    nu = (cu / d) * Math.sign(u); nw = (cw / d) * Math.sign(w);
  } else if (du > dw) {
    // Centre inside: out through the nearest side.
    depth = r - du; nu = Math.sign(u) || 1; nw = 0;
  } else {
    depth = r - dw; nu = 0; nw = Math.sign(w) || 1;
  }
  const px = (ob.rx * nu + ob.fx * nw) * depth, pz = (ob.rz * nu + ob.fz * nw) * depth;
  return { depth, x: px, z: pz };
}

/** Does a vertical body with its feet at y and this height overlap the obstacle's height (bar what it steps onto)? */
export const blocksHeight = (ob: Obstacle, y: number, height: number, step = STEP_HEIGHT) => ob.y1 > y + step && ob.y0 < y + height;

/**
 * Push a vertical cylinder out of the obstacles it overlaps (like CollisionWorld.resolveCylinder).
 * Returns the obstacle that pushed it hardest, if any. `skip` names an owner to ignore.
 */
export function resolveObstacles(obstacles: readonly Obstacle[] | undefined, pos: Vec3, radius: number, height: number, skip = -1) {
  let pusher: Obstacle | undefined, most = 0;
  if (!obstacles?.length) return pusher;
  for (let iteration = 0; iteration < 2; iteration++) {
    let moved = false;
    for (const ob of obstacles) {
      if (ob.id === skip || !near(ob, pos.x, pos.z, radius) || !blocksHeight(ob, pos.y, height)) continue;
      const p = penetration(ob, pos.x, pos.z, radius);
      if (p.depth <= 1e-9) continue;
      pos.x += p.x; pos.z += p.z; moved = true;
      if (p.depth > most) { most = p.depth; pusher = ob; }
    }
    if (!moved) break;
  }
  return pusher;
}

/** Highest obstacle top under a cylinder whose feet are at feetY, up to a step above them (or -Infinity). */
export function obstacleGround(obstacles: readonly Obstacle[] | undefined, x: number, z: number, feetY: number, radius: number, step = STEP_HEIGHT) {
  let best = -Infinity;
  if (!obstacles?.length) return best;
  const limit = feetY + step, r = radius * 0.7;
  for (const ob of obstacles) {
    if (ob.y1 > limit || ob.y1 <= best || !near(ob, x, z, r)) continue;
    if (penetration(ob, x, z, r).depth > 0) best = ob.y1;
  }
  return best;
}

/** Deepest overlap (metres) of a cylinder with any obstacle at its height, and that obstacle. */
export function deepestOverlap(obstacles: readonly Obstacle[] | undefined, pos: Vec3, radius: number, height: number, skip = -1) {
  let depth = 0, hit: Obstacle | undefined;
  for (const ob of obstacles ?? []) {
    if (ob.id === skip || !near(ob, pos.x, pos.z, radius) || !blocksHeight(ob, pos.y, height)) continue;
    const d = penetration(ob, pos.x, pos.z, radius).depth;
    if (d > depth) { depth = d; hit = ob; }
  }
  return { depth, obstacle: hit };
}

/** Ray against an obstacle's box: distance along the unit direction and the face normal, or undefined. */
export function raycastObstacle(o: Vec3, d: Vec3, ob: Obstacle, maxT: number) {
  const ox = o.x - ob.x, oz = o.z - ob.z;
  const lo = [ox * ob.rx + oz * ob.rz, o.y, ox * ob.fx + oz * ob.fz];
  const ld = [d.x * ob.rx + d.z * ob.rz, d.y, d.x * ob.fx + d.z * ob.fz];
  const min = [-ob.hw, ob.y0, -ob.hl], max = [ob.hw, ob.y1, ob.hl];
  let t0 = 0, t1 = maxT, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(ld[a]) < 1e-12) { if (lo[a] < min[a] || lo[a] > max[a]) return undefined; continue; }
    let ta = (min[a] - lo[a]) / ld[a], tb = (max[a] - lo[a]) / ld[a], s = -1;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
    if (ta > t0) { t0 = ta; axis = a; sign = s; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return undefined;
  }
  // Starting inside: no face to bounce off (the caller is already overlapping).
  if (axis < 0) return undefined;
  const nu = axis === 0 ? sign : 0, ny = axis === 1 ? sign : 0, nw = axis === 2 ? sign : 0;
  return { t: t0, normal: { x: ob.rx * nu + ob.fx * nw, y: ny, z: ob.rz * nu + ob.fz * nw } };
}
