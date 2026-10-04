import { describe, expect, it } from 'vitest';
import { defaultLaws, type Laws } from './laws';
import { History, PHYSICS_STEP, circularSpeed, stepBodies, timeFactor, type Body } from './world';

const center = { x: 0, y: 0, z: 0 };
const body = (kind: Body['kind'], x: number, y: number, z: number, vx: number, vy: number, vz: number): Body =>
  ({ id: 1, kind, x, y, z, vx, vy, vz, age: 0, owner: -1, team: -1, hp: 1, timer: 0 });

describe('lawful world physics', () => {
  it('closes an inverse-square ellipse after its analytic Kepler period; inverse-cube escapes', () => {
    // Independent analytic period: a = r_peri/(1-e), T = 2π√(a³/μ).
    const periapsis = 6, eccentricity = 0.2, mu = 80;
    const a = periapsis / (1 - eccentricity);
    const period = 2 * Math.PI * Math.sqrt(a ** 3 / mu);
    const velocity = Math.sqrt(mu * (1 + eccentricity) / periapsis);
    const run = (exponent: number) => {
      const laws: Laws = structuredClone(defaultLaws);
      laws.gravity.exponent = exponent;
      const b = body('drone', periapsis, 0, 0, 0, 0, velocity);
      for (let i = 0; i < Math.round(period / PHYSICS_STEP); i++) stepBodies([b], PHYSICS_STEP, laws, center, undefined);
      return b;
    };
    const closed = run(2), escaped = run(3);
    expect(Math.abs(Math.atan2(closed.z, closed.x))).toBeLessThan(0.025);
    expect(Math.hypot(closed.x - periapsis, closed.z)).toBeLessThan(0.15);
    expect(Math.abs(Math.atan2(escaped.z, escaped.x))).toBeGreaterThan(0.5);
    expect(Math.hypot(escaped.x, escaped.z)).toBeGreaterThan(25);
  });

  it('circular orbit speed matches the law and holds radius for a full revolution', () => {
    const laws = structuredClone(defaultLaws);
    const r = 7, v = circularSpeed(laws.gravity, r);
    expect(v).toBeCloseTo(Math.sqrt(80 / 7));
    const b = body('drone', r, 0, 0, 0, 0, v);
    const period = 2 * Math.PI * r / v;
    let minR = Infinity, maxR = 0;
    for (let t = 0; t < period; t += PHYSICS_STEP) {
      stepBodies([b], PHYSICS_STEP, laws, center, undefined);
      const radius = Math.hypot(b.x, b.z);
      minR = Math.min(minR, radius); maxR = Math.max(maxR, radius);
    }
    expect(maxR - minR).toBeLessThan(0.02);
    expect(circularSpeed({ ...laws.gravity, strength: -80 }, r)).toBe(0);
    expect(circularSpeed({ ...laws.gravity, mode: 'uniform' }, r)).toBe(0);
  });

  it('uniform anomaly gravity bends energy bolts while grenades also feel the planet', () => {
    const laws: Laws = { ...structuredClone(defaultLaws), gravity: { mode: 'uniform', strength: 1.5, exponent: 2, direction: { x: 0, y: -1, z: 0 } } };
    const bolt = body('bolt', 0, 10, 0, 4, 0, 0), grenade = body('grenade', 0, 10, 0, 4, 0, 0);
    for (let i = 0; i < 120; i++) stepBodies([bolt, grenade], PHYSICS_STEP, laws, center, undefined);
    expect(bolt.x).toBeCloseTo(4, 3);
    expect(bolt.y).toBeCloseTo(10 - 0.5 * 1.5, 3);
    expect(grenade.y).toBeCloseTo(10 - 0.5 * (1.5 + 9.8), 3);
  });

  it('motion-driven time is exactly zero at rest and proportional below walking pace', () => {
    expect(timeFactor({ mode: 'playerMotion', scale: 1 }, 0)).toBe(0);
    expect(timeFactor({ mode: 'playerMotion', scale: 1 }, 3)).toBeCloseTo(0.5);
    expect(timeFactor({ mode: 'playerMotion', scale: 2 }, 50)).toBe(2);
    expect(timeFactor({ mode: 'constant', scale: 0.25 }, 0)).toBe(0.25);
  });

  it('history ring keeps the newest entries across wrap and pops newest first', () => {
    const h = new History<number>(5);
    for (let i = 0; i < 12; i++) h.push(i);
    expect(h.length).toBe(5);
    expect(h.toArray()).toEqual([7, 8, 9, 10, 11]);
    expect(h.pop()).toBe(11);
    expect(h.pop()).toBe(10);
    h.push(99);
    expect(h.toArray()).toEqual([7, 8, 9, 99]);
    h.clear(); expect(h.pop()).toBeUndefined();
  });
});
