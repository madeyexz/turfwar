import { beforeAll, expect, test } from 'vitest';
import { initPhysics, Simulation, STEP } from './physics';

beforeAll(initPhysics);
test('uniform force curves a projectile down and target hits award points', () => {
  const sim = new Simulation();
  sim.laws.gravity = { mode: 'uniform', strength: 1.5, exponent: 2, direction: { x: 0, y: -1, z: 0 } };
  for (const entity of [...sim.entities]) sim.remove(entity);
  const shot = sim.spawn('shot', { x: 0, y: 10, z: 0 }, { x: 4, y: 0, z: 0 });
  for (let i = 0; i < 120; i++) sim.step(STEP);
  expect(shot.body.translation().x).toBeCloseTo(4, 2);
  expect(shot.body.translation().y).toBeCloseTo(9.25, 1);
  sim.spawn('drone', shot.body.translation(), { x: 4, y: 0, z: 0 });
  sim.step();
  expect(sim.score).toBe(100);
  expect(sim.entities).toHaveLength(0);
  sim.world.free();
});

test('inverse-square ellipse closes after its Kepler period, inverse-cube escapes', () => {
  // Independent analytic period: a = r_peri/(1-e), T = 2π√(a³/μ).
  const periapsis = 6, eccentricity = 0.2, mu = 80;
  const a = periapsis / (1 - eccentricity);
  const period = 2 * Math.PI * Math.sqrt(a ** 3 / mu);
  const velocity = Math.sqrt(mu * (1 + eccentricity) / periapsis);
  function integrate(exponent: number) {
    const sim = new Simulation();
    for (const entity of [...sim.entities]) sim.remove(entity);
    sim.laws.gravity.exponent = exponent;
    const body = sim.spawn('drone', { x: periapsis, y: 0, z: 0 }, { x: 0, y: 0, z: velocity }).body;
    for (let i = 0; i < Math.round(period / STEP); i++) sim.step();
    const result = { ...body.translation() };
    sim.world.free();
    return result;
  }
  const closed = integrate(2), escaped = integrate(3);
  expect(Math.abs(Math.atan2(closed.z, closed.x))).toBeLessThan(0.025);
  expect(Math.hypot(closed.x - periapsis, closed.z)).toBeLessThan(0.15);
  expect(Math.abs(Math.atan2(escaped.z, escaped.x))).toBeGreaterThan(0.5);
  expect(Math.hypot(escaped.x, escaped.z)).toBeGreaterThan(25);
});
