import { rayBox, type CollisionWorld } from '../collision';
import type { NavGraph } from '../match/nav';

/**
 * Long open sightlines between places a soldier can stand (map tests and dev tooling): the
 * navigation graph's nodes (every floor reachable from the bases, roofs and decks included), thinned
 * to one per `cell` metres per storey, are paired up, and a pair counts when the two are further than
 * `limit` apart and nothing static blocks the line between their eyes.
 */
export interface Sightline { a: [number, number, number]; b: [number, number, number]; length: number }

const EYE = 1.55;

/** Nothing solid between a and b (ramps and the flat ground are ignored: they never rise to eye height). */
export function clearLine(world: CollisionWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
  const o = { x: ax, y: ay, z: az }, d = { x: dx / len, y: dy / len, z: dz / len };
  const steps = Math.max(1, Math.ceil(len / 6));
  let blocked = false;
  for (let k = 0; k < steps && !blocked; k++) {
    const t0 = (k / steps) * len, t1 = ((k + 1) / steps) * len;
    const x0 = ax + d.x * t0, z0 = az + d.z * t0, x1 = ax + d.x * t1, z1 = az + d.z * t1;
    world.forSolidsIn(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), s => {
      if (blocked || s.team !== undefined) return;
      const hit = rayBox(o, d, s, len - 0.05);
      if (hit && hit.t > 0.05) blocked = true;
    });
  }
  return !blocked;
}

/** Standing spots: nav nodes, one per cell × cell column and 2 m of height. */
export function standingSpots(nav: NavGraph, cell = 4) {
  const seen = new Set<string>(), out: [number, number, number][] = [];
  for (let i = 0; i < nav.x.length; i++) {
    const key = `${Math.round(nav.x[i] / cell)},${Math.round(nav.z[i] / cell)},${Math.round(nav.y[i] / 2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([nav.x[i], nav.y[i], nav.z[i]]);
  }
  return out;
}

/**
 * Every clear eye-to-eye line longer than `limit` between standing spots, longest first; spots for
 * which `exempt` holds (say, a road's drive lane) are left out.
 */
export function longSightlines(world: CollisionWorld, nav: NavGraph, limit: number, exempt?: (x: number, z: number) => boolean, cell = 4): Sightline[] {
  const spots = standingSpots(nav, cell).filter(([x, , z]) => !exempt?.(x, z)), out: Sightline[] = [];
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
    const [ax, ay, az] = spots[i], [bx, by, bz] = spots[j];
    const length = Math.hypot(bx - ax, bz - az);
    if (length <= limit) continue;
    if (clearLine(world, ax, ay + EYE, az, bx, by + EYE, bz)) out.push({ a: spots[i], b: spots[j], length });
  }
  return out.sort((p, q) => q.length - p.length);
}
