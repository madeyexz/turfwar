import { describe, expect, it } from 'vitest';
import { CollisionWorld } from './collision';
import { GRAVITY, PHYSICS_STEP, stepBodies, type Body } from './world';

const body = (kind: Body['kind'], x: number, y: number, z: number, vx: number, vy: number, vz: number): Body =>
  ({ id: 1, kind, x, y, z, vx, vy, vz, age: 0, owner: -1, team: -1, hp: 1, timer: 5 });
const flat = new CollisionWorld([], [], { x0: -50, z0: -50, spacing: 100, n: 2, heights: new Float32Array(4) }, { minX: -50, maxX: 50, minZ: -50, maxZ: 50 });

describe('thrown bodies', () => {
  it('follow a ballistic arc under gravity', () => {
    const b = body('grenade', 0, 50, 0, 10, 0, 0);
    for (let i = 0; i < Math.round(1 / PHYSICS_STEP); i++) stepBodies([b], PHYSICS_STEP, undefined);
    expect(b.x).toBeCloseTo(10, 5);
    expect(50 - b.y).toBeCloseTo(GRAVITY / 2, 0);
  });

  it('grenades bounce and settle on the ground', () => {
    const b = body('grenade', 0, 3, 0, 4, 0, 0);
    for (let i = 0; i < 6 / PHYSICS_STEP; i++) stepBodies([b], PHYSICS_STEP, flat);
    expect(b.y).toBeGreaterThan(0); expect(b.y).toBeLessThan(0.2);
    expect(Math.hypot(b.vx, b.vz)).toBeLessThan(0.5);
  });

  it('graviton charges stop dead on contact and spend their fuse', () => {
    const b = body('charge', 0, 2, 0, 0, -10, 0);
    for (let i = 0; i < 60; i++) stepBodies([b], PHYSICS_STEP, flat);
    expect(b.timer).toBe(0);
    expect(b.vx === 0 && b.vy === 0 && b.vz === 0).toBe(true);
  });
});
