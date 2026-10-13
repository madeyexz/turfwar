import { describe, expect, it } from 'vitest';
import { CollisionWorld, type Heightfield, type Solid } from './collision';
import { hitShape, raycastSoldier } from './hitbox';
import { PEEK, easePeek, peekOf, peekSide } from './peek';

const flat: Heightfield = { x0: -100, z0: -100, spacing: 4, n: 51, heights: new Float32Array(51 * 51) };
const bounds = { minX: -90, maxX: 90, minZ: -90, maxZ: 90 };
const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Solid =>
  ({ minX, minY, minZ, maxX, maxY, maxZ, surface: 'concrete' });
const world = (...solids: Solid[]) => new CollisionWorld(solids, [], flat, bounds);

// A soldier at the origin looks down -z (yaw 0); +x is to the right.
describe('auto-peek', () => {
  it('leans out past the edge of cover right in front, toward the open side', () => {
    expect(peekSide(world(box(-3, 0, -1.2, 0.15, 3, -0.6)), 0, 0, 0, 0, 0)).toBe(1);
    expect(peekSide(world(box(-0.15, 0, -1.2, 3, 3, -0.6)), 0, 0, 0, 0, 0)).toBe(-1);
  });

  it('does not lean in the open, against a wide wall, or with cover farther than PEEK.block', () => {
    expect(peekSide(world(), 0, 0, 0, 0, 0)).toBe(0);
    expect(peekSide(world(box(-5, 0, -1.2, 5, 3, -0.6)), 0, 0, 0, 0, 0)).toBe(0);
    expect(peekSide(world(box(-3, 0, -PEEK.block - 1, 0.15, 3, -PEEK.block - 0.4)), 0, 0, 0, 0, 0)).toBe(0);
  });

  it('needs room beside the head: a wall at the shoulder rules that side out', () => {
    expect(peekSide(world(box(-3, 0, -1.2, 0.15, 3, -0.6), box(0.4, 0, -0.5, 1, 3, 0.5)), 0, 0, 0, 0, 0)).toBe(0);
  });

  it('a post with both sides open keeps the side already leaned to', () => {
    const post = world(box(-0.2, 0, -1, 0.2, 3, -0.6));
    expect(peekSide(post, 0, 0, 0, 0, 0, -1, -1)).toBe(-1);
    expect(peekSide(post, 0, 0, 0, 0, 0, -1, 1)).toBe(1);
  });

  it('turns with the yaw: facing +x, cover on the near side of the edge leans left', () => {
    // Facing +x (yaw -π/2), the right is +z; the wall covers +z, so the open side is -z (left).
    expect(peekSide(world(box(0.6, 0, -0.15, 1.2, 3, 3)), 0, 0, 0, 0, -Math.PI / 2)).toBe(-1);
  });

  it('only aiming humans peek, and the leaning head is where shots land', () => {
    const w = world(box(-3, 0, -1.2, 0.15, 3, -0.6));
    const s = { m: { x: 0, y: 0, z: 0, crouch: 0 }, yaw: 0, ads: true, alive: true, bot: false, team: 0 };
    expect(peekOf(w, s)).toBe(1);
    expect(peekOf(w, { ...s, ads: false })).toBe(0);
    expect(peekOf(w, { ...s, bot: true })).toBe(0);
    // A shot from straight ahead along the leaned-out head's line hits it, and misses the upright one.
    const leaned = hitShape(s.m, 0, 0, 1), upright = hitShape(s.m, 0, 0, 0);
    const o = { x: leaned.head.x, y: leaned.head.y, z: -20 }, d = { x: 0, y: 0, z: 1 };
    expect(raycastSoldier(o, d, leaned)?.zone).toBe('head');
    expect(raycastSoldier(o, d, upright)?.zone).not.toBe('head');
    // ...and from that shooter, the leaned head clears the wall's edge.
    expect(w.lineOfSight(o, leaned.head)).toBe(true);
    expect(w.lineOfSight(o, upright.head)).toBe(false);
  });

  it('eases in and out over PEEK.time', () => {
    expect(easePeek(0, 1, PEEK.time / 2)).toBeCloseTo(0.5);
    expect(easePeek(0.5, 1, PEEK.time)).toBe(1);
    expect(easePeek(1, 0, PEEK.time)).toBe(0);
    expect(easePeek(0.2, -1, PEEK.time / 4)).toBeCloseTo(-0.05);
  });
});
