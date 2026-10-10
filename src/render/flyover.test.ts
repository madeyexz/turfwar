import { describe, expect, it } from 'vitest';
import { FORMATION, PUFF_LIFE, PUFF_RATE, axes, brave, jetAt, overheadPass, puffAt, type FlyoverPath, type Puff } from './flyover';

const path: FlyoverPath = { start: { x: -800, y: 250, z: 70 }, velocity: { x: 86, y: 0, z: -50 }, smokeOn: -40, smokeOff: 40 };
const fresh = (): Puff => ({ x: 0, y: 0, z: 0, size: 0, alpha: 0, shade: 0 });
const along = (a: { x: number; z: number }, b: { x: number; z: number }) => {
  const { fwd } = axes(path);
  return (a.x - b.x) * fwd.x + (a.z - b.z) * fwd.z;
};

describe('flyover', () => {
  it('flies the flag: the ribbons read red, white, blue, white, red across the wedge', () => {
    expect([...FORMATION].sort((a, b) => a.side - b.side).map(f => f.color)).toEqual(['red', 'white', 'blue', 'white', 'red']);
  });

  it('keeps the wedge: the lead on the path, wingmen behind it and level with it', () => {
    expect(jetAt(path, 0, 0)).toEqual({ x: -800, y: 250, z: 70 });
    const lead = jetAt(path, 0, 2);
    expect(lead.x).toBeCloseTo(-628); expect(lead.z).toBeCloseTo(-30);
    for (let j = 1; j < FORMATION.length; j++) {
      const p = jetAt(path, j, 2);
      expect(along(p, lead)).toBeCloseTo(-FORMATION[j].back);
      expect(p.y).toBe(lead.y);
    }
  });

  it('leaves smoke behind the jets, swelling and fading, and only while it is on', () => {
    const t = 3, k = Math.floor((t - 0.5) * PUFF_RATE);
    const young = puffAt(path, 0, k, t, fresh());
    expect(young.alpha).toBeGreaterThan(0);
    expect(along(young, jetAt(path, 0, t))).toBeLessThan(-30);
    const old = puffAt(path, 0, Math.floor((t - 9) * PUFF_RATE), t, fresh());
    expect(old.size).toBeGreaterThan(young.size);
    expect(old.alpha).toBeLessThan(young.alpha);
    expect(puffAt(path, 0, Math.floor((t + 0.2) * PUFF_RATE), t, fresh()).alpha).toBe(0); // not yet left
    expect(puffAt(path, 0, Math.floor((t - PUFF_LIFE - 1) * PUFF_RATE), t, fresh()).alpha).toBe(0); // gone
    const off = { ...path, smokeOn: 2.9 };
    expect(puffAt(off, 0, k, t, fresh()).alpha).toBe(0);
  });

  it('draws the same puff on every frame and client', () => {
    expect(puffAt(path, 3, 120, 4, fresh())).toEqual(puffAt(path, 3, 120, 4, fresh()));
  });

  it('passes over the middle of the map at t = 0 in development play', () => {
    const p = overheadPass(220);
    expect(jetAt(p, 0, 0)).toEqual({ x: 0, y: 220, z: 0 });
    expect(axes(p).speed).toBeCloseTo(110);
  });

  it('builds a jet about 13 m long and 10.5 m across', () => {
    const { body } = brave();
    body.computeBoundingBox();
    const b = body.boundingBox!;
    expect(b.max.x - b.min.x).toBeGreaterThan(12.5); expect(b.max.x - b.min.x).toBeLessThan(14);
    expect(b.max.z - b.min.z).toBeCloseTo(10.5, 0);
  });
});
