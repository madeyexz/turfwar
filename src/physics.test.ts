import { beforeAll, expect, test } from 'vitest';
import { initPhysics, Simulation, STEP } from './physics';

beforeAll(initPhysics);
test('uniform force curves a projectile down and target hits award points', () => {
  const sim = new Simulation();
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
