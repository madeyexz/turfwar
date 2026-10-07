import { CollisionWorld, terrainHeight } from './collision';
import { near, raycastObstacle, type Obstacle } from './obstacles';

/** Thrown M67 frags and M18 smoke grenades, integrated under plain gravity; smoke clouds stay put. */
export const PHYSICS_STEP = 1 / 120;
export const GRAVITY = 9.8;

/** `smokeCloud`: a smoke grenade that has popped (still, `timer` = seconds left). Keep the order: the frame sends the index. */
export type BodyKind = 'grenade' | 'smoke' | 'smokeCloud';

export interface Body {
  id: number;
  kind: BodyKind;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  /** Soldier id of the thrower/shooter, or -1. */
  owner: number;
  /** Team of the thrower (-1 = neutral, hurts everyone). */
  team: number;
  /** 2 = carries the High Explosive mod. */
  hp: number;
  /** Fuse remaining (seconds); for a smoke cloud, the seconds it has left. */
  timer: number;
}

export const BODY_RADIUS: Record<BodyKind, number> = { grenade: 0.09, smoke: 0.09, smokeCloud: 0.09 };
const RESTITUTION = 0.38;

/**
 * Semi-implicit Euler under gravity, then sphere collision against static solids, terrain and
 * `obstacles` (vehicles' bodies, taken as still for the step).
 */
export function stepBodies(bodies: Body[], dt: number, world: CollisionWorld | undefined, obstacles?: readonly Obstacle[]) {
  if (dt <= 0) return;
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    if (b.kind === 'smokeCloud') { b.age += dt; continue; }
    b.vy -= GRAVITY * dt;
    const ox = b.x, oy = b.y, oz = b.z;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    b.age += dt;
    if (world) collide(b, ox, oy, oz, world, obstacles);
  }
}

function collide(b: Body, ox: number, oy: number, oz: number, world: CollisionWorld, obstacles?: readonly Obstacle[]) {
  const r = BODY_RADIUS[b.kind];
  const dx = b.x - ox, dy = b.y - oy, dz = b.z - oz;
  const len = Math.hypot(dx, dy, dz);
  if (len > 1e-6) {
    const dir = { x: dx / len, y: dy / len, z: dz / len };
    let hit: { t: number; normal: { x: number; y: number; z: number } } | null = world.raycast({ x: ox, y: oy, z: oz }, dir, len + r, -2);
    for (const ob of obstacles ?? []) {
      if (!near(ob, ox, oz, len + r)) continue;
      const h = raycastObstacle({ x: ox, y: oy, z: oz }, dir, ob, hit ? hit.t : len + r);
      if (h) hit = h;
    }
    if (hit) {
      // Reflect velocity about the surface normal and back off to the contact point.
      const n = hit.normal, vn = b.vx * n.x + b.vy * n.y + b.vz * n.z;
      if (vn < 0) {
        const e = RESTITUTION;
        b.vx -= (1 + e) * vn * n.x; b.vy -= (1 + e) * vn * n.y; b.vz -= (1 + e) * vn * n.z;
        // Tangential friction so grenades settle.
        b.vx *= 0.78; b.vz *= 0.78; if (n.y > 0.5) b.vy *= 0.9;
      }
      const back = Math.max(0, hit.t - r);
      b.x = ox + dir.x * back + n.x * 0.01; b.y = oy + dir.y * back + n.y * 0.01; b.z = oz + dir.z * back + n.z * 0.01;
    }
  }
  const g = terrainHeight(world.terrain, b.x, b.z);
  if (b.y - r < g) {
    b.y = g + r;
    if (b.vy < 0) { b.vy = -b.vy * RESTITUTION; b.vx *= 0.8; b.vz *= 0.8; }
  }
}

