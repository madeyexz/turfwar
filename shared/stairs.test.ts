import { describe, expect, it } from 'vitest';
import { CollisionWorld, rampHeight, type Heightfield, type Ramp } from './collision';
import { MAP_IDS, loadMap } from './maps';
import { MOVE, createMoveState, idleInput, stepMovement, type MoveInput } from './movement';

const flat: Heightfield = { x0: -100, z0: -100, spacing: 4, n: 51, heights: new Float32Array(51 * 51) };
const bounds = { minX: -90, maxX: 90, minZ: -90, maxZ: 90 };
// A flight rising toward -Z from z = 0 to a 3 m landing at z = -6, 3 m wide.
const flight: Ramp = { minX: -1.5, maxX: 1.5, minZ: -6, maxZ: 0, y0: 0, y1: 3, dir: 3, surface: 'metal', base: -0.05 };
const run = (world: CollisionWorld, input: Partial<MoveInput>, seconds: number, start: ReturnType<typeof createMoveState>) => {
  for (let t = 0; t < seconds; t += 1 / 120) stepMovement(world, start, { ...idleInput(), ...input }, 1 / 120);
  return start;
};

describe('stairs are as solid as they are drawn', () => {
  const stairs = new CollisionWorld([], [flight], flat, bounds);
  const slope = new CollisionWorld([], [{ ...flight, base: undefined }], flat, bounds);

  it('a soldier climbs the flight from its foot', () => {
    const s = createMoveState(0, 0, 1);
    while (s.z > -4) run(stairs, { forward: 1 }, 0.1, s);
    expect(s.z).toBeGreaterThan(-5);
    expect(s.y).toBeCloseTo(rampHeight(flight, s.x, s.z), 1);
  });

  it('walking into its side is blocked, where a bare slope lets you through', () => {
    const into = (world: CollisionWorld) => run(world, { strafe: 1 }, 2, createMoveState(-4, 0, -4.5));
    expect(into(stairs).x).toBeLessThanOrEqual(flight.minX - MOVE.radius + 1e-3);
    expect(into(slope).x).toBeGreaterThan(flight.maxX);
    // Low at its foot, the side is a step: soldiers step up onto it.
    expect(run(stairs, { strafe: 1 }, 1.5, createMoveState(-4, 0, -0.4)).x).toBeGreaterThan(flight.minX);
  });

  it('stops shots through its side and its back, and still takes hits on the treads', () => {
    const side = stairs.raycast({ x: -10, y: 1.5, z: -4.5 }, { x: 1, y: 0, z: 0 }, 20);
    expect(side?.t).toBeCloseTo(10 + flight.minX, 5);
    expect(side?.normal).toEqual({ x: -1, y: 0, z: 0 });
    expect(slope.raycast({ x: -10, y: 1.5, z: -4.5 }, { x: 1, y: 0, z: 0 }, 20)).toBeNull();
    expect(stairs.raycast({ x: 0, y: 2, z: -12 }, { x: 0, y: 0, z: 1 }, 20)?.point.z).toBeCloseTo(-6, 5);
    const down = stairs.raycast({ x: 0, y: 10, z: -3 }, { x: 0, y: -1, z: 0 }, 20)!;
    expect(down.point.y).toBeCloseTo(1.5, 5);
    expect(down.normal.y).toBeGreaterThan(0.8);
    // Above the treads a shot carries on.
    expect(stairs.raycast({ x: -10, y: 3.2, z: -4.5 }, { x: 1, y: 0, z: 0 }, 20)).toBeNull();
  });

  it('on every map, a shot across a flight under its slope is stopped', () => {
    for (const id of MAP_IDS) {
      const { def, world } = loadMap(id);
      for (const d of def.decor) {
        if (d.kind !== 'ramp' || d.style !== 'stairs') continue;
        const r = world.ramps[d.ramp];
        if (r.y1 - r.y0 < 1) continue;
        const alongX = r.dir === 0 || r.dir === 2;
        // Three quarters of the way up, halfway between the base and the treads.
        const t = 0.75, x = r.dir === 0 ? r.minX + (r.maxX - r.minX) * t : r.dir === 2 ? r.maxX - (r.maxX - r.minX) * t : (r.minX + r.maxX) / 2;
        const z = r.dir === 1 ? r.minZ + (r.maxZ - r.minZ) * t : r.dir === 3 ? r.maxZ - (r.maxZ - r.minZ) * t : (r.minZ + r.maxZ) / 2;
        const y = (r.y0 + rampHeight(r, x, z)) / 2;
        const a = alongX ? { x, y, z: r.minZ - 0.5 } : { x: r.minX - 0.5, y, z };
        const b = alongX ? { x, y, z: r.maxZ + 0.5 } : { x: r.maxX + 0.5, y, z };
        expect(world.lineOfSight(a, b), `${id} flight at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(false);
      }
    }
  });
});
