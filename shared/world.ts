import { CollisionWorld, terrainHeight } from './collision';
import type { Laws } from './laws';
import type { Vec3 } from './math';

/**
 * The lawful world: bodies that obey the rewritable laws (anomaly gravity and world time).
 * Players are "lawbreakers" and are integrated separately; bots, drones, grenades, plasma
 * bolts and debris live here and freeze, bend or rewind with the laws.
 */
export const PHYSICS_STEP = 1 / 120;
export const PLANET_GRAVITY = 9.8;

export type BodyKind = 'drone' | 'grenade' | 'bolt' | 'debris';

export interface Body {
  id: number;
  kind: BodyKind;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  /** Soldier id of the thrower/shooter, or -1. */
  owner: number;
  /** Team allegiance (-1 = neutral, attacks everyone). */
  team: number;
  hp: number;
  /** Drones: seconds until next shot; grenades: fuse remaining. */
  timer: number;
}

export const BODY_RADIUS: Record<BodyKind, number> = { drone: 0.55, grenade: 0.09, bolt: 0.12, debris: 0.25 };
/** Planetary gravity applies to thrown objects; drones hover and bolts are energy. */
const FEELS_PLANET: Record<BodyKind, boolean> = { drone: false, grenade: true, bolt: false, debris: true };
const RESTITUTION: Record<BodyKind, number> = { drone: 0.5, grenade: 0.38, bolt: 0, debris: 0.3 };

/** World seconds per wall-clock second. Motion is the controlling lawbreaker's speed. */
export function timeFactor(time: Laws['time'], motionSpeed: number) {
  return time.scale * (time.mode === 'playerMotion' ? Math.min(1, Math.max(0, motionSpeed) / 6) : 1);
}

/** Acceleration from the rewritable anomaly field, centered on the reactor. */
export function gravityAt(p: Vec3, gravity: Laws['gravity'], center: Vec3): Vec3 {
  if (gravity.mode === 'uniform') {
    const d = gravity.direction;
    const length = Math.hypot(d.x, d.y, d.z) || 1;
    return { x: d.x / length * gravity.strength, y: d.y / length * gravity.strength, z: d.z / length * gravity.strength };
  }
  const rx = p.x - center.x, ry = p.y - center.y, rz = p.z - center.z;
  const r = Math.hypot(rx, ry, rz);
  // The softened core keeps the point-mass singularity from launching bodies.
  const factor = -gravity.strength / Math.max(r, 1.5) ** (gravity.exponent + 1);
  return { x: rx * factor, y: ry * factor, z: rz * factor };
}

/** Speed for a circular orbit at radius r under the central law, or 0 if none exists. */
export function circularSpeed(gravity: Laws['gravity'], r: number) {
  if (gravity.mode !== 'central' || gravity.strength <= 0) return 0;
  return Math.sqrt(gravity.strength * Math.max(r, 1.5) ** (1 - gravity.exponent));
}

export interface StepHooks {
  /** Called when a bolt or grenade touches static geometry. Return true to delete the body. */
  onImpact?: (body: Body, point: Vec3, normal: Vec3) => boolean;
}

export function accel(b: Body, laws: Laws, center: Vec3) {
  const a = gravityAt(b, laws.gravity, center);
  if (FEELS_PLANET[b.kind]) a.y -= PLANET_GRAVITY;
  return a;
}

/**
 * Kick-drift-kick leapfrog integration (symplectic, so orbits close instead of drifting),
 * followed by sphere collision against static solids and terrain.
 */
export function stepBodies(bodies: Body[], dt: number, laws: Laws, center: Vec3, world: CollisionWorld | undefined, hooks: StepHooks = {}) {
  if (dt <= 0) return;
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    const a0 = accel(b, laws, center);
    b.vx += a0.x * dt / 2; b.vy += a0.y * dt / 2; b.vz += a0.z * dt / 2;
    const ox = b.x, oy = b.y, oz = b.z;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    const a1 = accel(b, laws, center);
    b.vx += a1.x * dt / 2; b.vy += a1.y * dt / 2; b.vz += a1.z * dt / 2;
    b.age += dt;
    if (world && collide(b, ox, oy, oz, world, hooks)) bodies.splice(i, 1);
  }
}

function collide(b: Body, ox: number, oy: number, oz: number, world: CollisionWorld, hooks: StepHooks) {
  const r = BODY_RADIUS[b.kind];
  const dx = b.x - ox, dy = b.y - oy, dz = b.z - oz;
  const len = Math.hypot(dx, dy, dz);
  if (len > 1e-6) {
    const dir = { x: dx / len, y: dy / len, z: dz / len };
    const hit = world.raycast({ x: ox, y: oy, z: oz }, dir, len + r, -2);
    if (hit) {
      if (hooks.onImpact?.(b, hit.point, hit.normal)) return true;
      if (b.kind === 'bolt') return true;
      // Reflect velocity about the surface normal and back off to the contact point.
      const n = hit.normal, vn = b.vx * n.x + b.vy * n.y + b.vz * n.z;
      if (vn < 0) {
        const e = RESTITUTION[b.kind];
        b.vx -= (1 + e) * vn * n.x; b.vy -= (1 + e) * vn * n.y; b.vz -= (1 + e) * vn * n.z;
        // Tangential friction for thrown objects so grenades settle.
        if (b.kind !== 'drone') { b.vx *= 0.78; b.vz *= 0.78; if (n.y > 0.5) b.vy *= 0.9; }
      }
      const back = Math.max(0, hit.t - r);
      b.x = ox + dir.x * back + n.x * 0.01; b.y = oy + dir.y * back + n.y * 0.01; b.z = oz + dir.z * back + n.z * 0.01;
    }
  }
  const g = terrainHeight(world.terrain, b.x, b.z);
  if (b.y - r < g) {
    if (b.kind === 'bolt') return true;
    b.y = g + r;
    if (b.vy < 0) { b.vy = -b.vy * RESTITUTION[b.kind]; if (b.kind !== 'drone') { b.vx *= 0.8; b.vz *= 0.8; } }
  }
  return false;
}

/** Fixed-size ring buffer used for bounded world rewind. */
export class History<T> {
  private items: (T | undefined)[];
  private head = 0;
  length = 0;
  constructor(readonly capacity: number) { this.items = new Array(capacity); }
  push(item: T) {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    this.length = Math.min(this.capacity, this.length + 1);
  }
  /** Remove and return the newest entry. */
  pop(): T | undefined {
    if (!this.length) return undefined;
    this.head = (this.head - 1 + this.capacity) % this.capacity;
    const item = this.items[this.head];
    this.items[this.head] = undefined;
    this.length--;
    return item;
  }
  peek(): T | undefined { return this.length ? this.items[(this.head - 1 + this.capacity) % this.capacity] : undefined; }
  clear() { this.items.fill(undefined); this.head = 0; this.length = 0; }
  toArray(): T[] {
    const out: T[] = [];
    for (let i = this.length; i > 0; i--) out.push(this.items[(this.head - i + this.capacity * 2) % this.capacity]!);
    return out;
  }
}
