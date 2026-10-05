import { describe, expect, it } from 'vitest';
import { CollisionWorld, type Heightfield, type Ladder, type Solid } from './collision';
import { MOVE, createMoveState, eyeHeight, idleInput, stepMovement, type MoveInput } from './movement';

const flat: Heightfield = { x0: -100, z0: -100, spacing: 4, n: 51, heights: new Float32Array(51 * 51) };
const bounds = { minX: -90, maxX: 90, minZ: -90, maxZ: 90 };
const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, team?: number): Solid =>
  ({ minX, minY, minZ, maxX, maxY, maxZ, surface: 'metal', ...(team === undefined ? {} : { team }) });
const run = (world: CollisionWorld, input: Partial<MoveInput>, seconds: number, start = createMoveState(0, 0, 0), team = -1) => {
  const s = start;
  for (let t = 0; t < seconds; t += 1 / 120) stepMovement(world, s, { ...idleInput(), ...input }, 1 / 120, team);
  return s;
};

describe('infantry movement', () => {
  const open = new CollisionWorld([], [], flat, bounds);

  it('walk, sprint, ADS and crouch reach distinct top speeds; diagonals are normalized', () => {
    const speed = (input: Partial<MoveInput>) => { const s = run(open, input, 1); return Math.hypot(s.vx, s.vz); };
    expect(speed({ forward: 1 })).toBeCloseTo(MOVE.walk, 1);
    expect(speed({ forward: 1, sprint: true })).toBeCloseTo(MOVE.sprint, 1);
    expect(speed({ forward: 1, sprint: true, ads: true })).toBeCloseTo(MOVE.ads, 1);
    expect(speed({ forward: 1, crouch: true })).toBeCloseTo(MOVE.crouch, 1);
    expect(speed({ forward: 1, strafe: 1 })).toBeCloseTo(MOVE.walk, 1);
    expect(speed({ forward: -1 })).toBeCloseTo(MOVE.walk * MOVE.backward, 1);
  });

  it('yaw 0 moves toward -Z and strafing right moves toward +X', () => {
    const fwd = run(open, { forward: 1 }, 0.5), right = run(open, { strafe: 1 }, 0.5);
    expect(fwd.z).toBeLessThan(-2); expect(Math.abs(fwd.x)).toBeLessThan(1e-6);
    expect(right.x).toBeGreaterThan(2);
  });

  it('jumps, lands on the ground and reports the landing impact', () => {
    const s = createMoveState(0, 0, 0);
    const first = stepMovement(open, s, { ...idleInput(), jump: true }, 1 / 120);
    expect(first.jumped).toBe(true);
    let landed = 0, peak = 0;
    for (let i = 0; i < 240; i++) { const e = stepMovement(open, s, idleInput(), 1 / 120); landed = Math.max(landed, e.landed); peak = Math.max(peak, s.y); }
    expect(peak).toBeCloseTo(MOVE.jumpSpeed ** 2 / (2 * MOVE.gravity), 1);
    expect(s.y).toBe(0); expect(s.grounded).toBe(true); expect(landed).toBeGreaterThan(5);
  });

  it('sliding converts a sprint into a fast, decaying slide with a cooldown', () => {
    const s = run(open, { forward: 1, sprint: true }, 1);
    const events = stepMovement(open, s, { ...idleInput(), forward: 1, sprint: true, crouch: true }, 1 / 120);
    expect(events.slideStarted).toBe(true);
    expect(Math.hypot(s.vx, s.vz)).toBeGreaterThan(MOVE.slideSpeed - 0.2);
    run(open, { forward: 1, crouch: true }, 1.2, s);
    expect(s.slideTime).toBe(0);
    expect(Math.hypot(s.vx, s.vz)).toBeLessThan(MOVE.crouch + 0.2);
  });

  it('walls block, low ledges are stepped onto, tall blocks are not', () => {
    const world = new CollisionWorld([box(-5, 0, -3, 5, 3, -2), box(-1, 0, 6, 1, 0.45, 8), box(4, 0, 6, 6, 1.2, 8)], [], flat, bounds);
    const blocked = run(world, { forward: 1 }, 2);
    expect(blocked.z).toBeGreaterThanOrEqual(-2 + MOVE.radius - 1e-3);
    const step = createMoveState(0, 0, 9);
    let onStep = false;
    for (let i = 0; i < 120; i++) { stepMovement(world, step, { ...idleInput(), forward: 1 }, 1 / 120); if (step.z < 7.5 && step.z > 6.5 && step.y === 0.45) onStep = true; }
    expect(onStep).toBe(true); // walked up onto the 0.45 m step without jumping
    const tall = run(world, { forward: 1 }, 2, createMoveState(5, 0, 10));
    expect(tall.z).toBeGreaterThanOrEqual(8 + MOVE.radius - 1e-3);
    expect(tall.y).toBe(0);
  });

  it('cannot tunnel through thin cover even while sliding at full speed', () => {
    const world = new CollisionWorld([box(-5, 0, -4.1, 5, 1.2, -4)], [], flat, bounds);
    const s = run(world, { forward: 1, sprint: true }, 0.4);
    stepMovement(world, s, { ...idleInput(), forward: 1, sprint: true, crouch: true }, 1 / 120);
    run(world, { forward: 1, crouch: true }, 1, s);
    expect(s.z).toBeGreaterThan(-4);
  });

  it('ramps carry the player up to a roof and crouching under a ceiling stays crouched', () => {
    const world = new CollisionWorld([box(-2, 2, 6, 2, 3, 10), box(-2, 1.25, -12, 2, 4, -9)], [{ minX: -2, maxX: 2, minZ: 0, maxZ: 6, y0: 0, y1: 3, dir: 1, surface: 'metal' }], flat, bounds);
    const up = run(world, { forward: -1 }, 1.8, createMoveState(0, 0, -1));
    expect(up.y).toBeCloseTo(3, 1); // on the roof
    const s = run(world, { crouch: true, forward: 1 }, 1.5, createMoveState(0, 0, -7));
    expect(s.z).toBeLessThan(-9.5);
    run(world, {}, 1, s);
    expect(s.crouch).toBe(1);
    expect(eyeHeight(s)).toBeCloseTo(MOVE.eyeCrouch);
  });

  it('team shields pass their own team and block the enemy', () => {
    const world = new CollisionWorld([box(-5, 0, -3, 5, 6, -2.8, 0)], [], flat, bounds);
    expect(run(world, { forward: 1 }, 1.5, createMoveState(0, 0, 0), 0).z).toBeLessThan(-4);
    expect(run(world, { forward: 1 }, 1.5, createMoveState(0, 0, 0), 1).z).toBeGreaterThan(-2.8);
    // Shield blocks enemy bullets but not friendly ones.
    expect(world.raycast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 10, 1)).not.toBeNull();
    expect(world.raycast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 10, 0)).toBeNull();
  });
});

describe('collision queries', () => {
  it('raycasts report the nearest of box, ramp and terrain with normals', () => {
    expect(new CollisionWorld([box(4, 0, -1, 5, 3, 1)], [], flat, bounds).raycast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 3.5)).toBeNull();
    const boxHit = new CollisionWorld([box(4, 0, -1, 5, 3, 1)], [], flat, bounds).raycast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 50)!;
    expect(boxHit.t).toBeCloseTo(4); expect(boxHit.normal).toEqual({ x: -1, y: 0, z: 0 });
    const rampHit = new CollisionWorld([], [{ minX: -4, maxX: -2, minZ: -1, maxZ: 1, y0: 0, y1: 2, dir: 2, surface: 'metal' }], flat, bounds)
      .raycast({ x: -3, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10)!;
    expect(rampHit.point.y).toBeCloseTo(1); expect(rampHit.normal.x).toBeGreaterThan(0);
    const ground = new CollisionWorld([], [], flat, bounds).raycast({ x: 0, y: 5, z: 0 }, { x: 0.6, y: -0.8, z: 0 }, 20)!;
    expect(ground.point.y).toBeCloseTo(0, 2); expect(ground.index).toBe(-1);
  });
});

describe('ladders', () => {
  // A 4 m block with a ladder up its west face, and a deck on posts whose ladder leans on its edge.
  const ladder: Ladder = { x: 2, z: 0, y0: 0, y1: 4, width: 0.9, dir: 0 };
  const deckLadder: Ladder = { x: 2, z: 20, y0: 0, y1: 3, width: 0.9, dir: 0 };
  const world = new CollisionWorld([box(2, 0, -2, 8, 4, 2), box(2, 2.7, 18, 8, 3, 22)], [], flat, bounds, [ladder, deckLadder]);
  const east = -Math.PI / 2, west = Math.PI / 2;

  it('climbs up toward the rungs and steps off onto the landing', () => {
    const s = run(world, { forward: 1, yaw: east }, 1.5, createMoveState(1.3, 0, 0));
    expect(s.y).toBeCloseTo(4, 2);
    expect(s.x).toBeGreaterThan(2.2);
    expect(s.grounded).toBe(true);
  });

  it('walking off the top climbs down at climbing speed instead of falling', () => {
    const s = createMoveState(2.6, 4, 0);
    let slowest = 0;
    for (let i = 0; i < 360; i++) { stepMovement(world, s, { ...idleInput(west), forward: 1 }, 1 / 120); slowest = Math.min(slowest, s.vy); }
    expect(s.y).toBeCloseTo(0, 2);
    expect(slowest).toBeGreaterThan(-MOVE.climb - 1.5);
  });

  it('holds on without input and lets go when jumping', () => {
    const s = run(world, { forward: 1, yaw: east }, 0.6, createMoveState(1.3, 0, 0));
    const held = run(world, { yaw: east }, 1, s);
    expect(held.y).toBeGreaterThan(1.5);
    const off = run(world, { yaw: east, jump: true }, 1.2, held);
    expect(off.x).toBeLessThan(0.8);
    expect(off.y).toBeCloseTo(0, 2);
  });

  it('a climber stays in front of a deck the ladder leans on, then lands on it', () => {
    let underDeck = false;
    const s = createMoveState(1.3, 0, 20);
    for (let i = 0; i < 170; i++) {
      stepMovement(world, s, { ...idleInput(east), forward: 1 }, 1 / 120);
      if (s.y < 2.3 && s.x > 2 - MOVE.radius + 0.01) underDeck = true;
    }
    expect(underDeck).toBe(false);
    expect(s.y).toBeCloseTo(3, 2);
    expect(s.x).toBeGreaterThan(2.2);
  });
});
