import { beforeAll, expect, test } from 'vitest';
import { Player } from './player';
import { groundHeight, maps, segmentBox } from './battlefield';
import { initPhysics, Simulation, STEP } from './physics';

beforeAll(initPhysics);
test('walk, sprint and aim have distinct speeds; diagonal input is normalized', () => {
  for (const [keys, aim, speed] of [[['KeyW'], false, 6], [['KeyW', 'ShiftLeft'], false, 10], [['KeyW', 'ShiftLeft'], true, 3.3], [['KeyW', 'KeyD'], false, 6]] as const) {
    const p = new Player(); p.position.set(0, -1.5, 0); p.aiming = aim;
    p.update(.1, new Set(keys), true);
    expect(Math.hypot(p.position.x, p.position.z)).toBeCloseTo(speed * .1);
  }
});
test('solid cover blocks movement; landing on its top does not trap the player', () => {
  const p = new Player(), b = maps[0].structures.find(b => b.role === 'cover')!;
  p.position.set(b.x, groundHeight(b.x, b.z + 3, p.map) + 1.75, b.z + 3);
  for (let i = 0; i < 120; i++) p.update(STEP, new Set(['KeyW']), true);
  expect(p.position.z).toBeGreaterThanOrEqual(b.z + b.d / 2 + .35);
  p.position.set(b.x, -3.25 + b.h + 1.75 + .5, b.z); p.grounded = false;
  for (let i = 0; i < 60; i++) p.update(STEP, new Set(), true);
  expect(p.position.y).toBeCloseTo(-3.25 + b.h + 1.75);
  p.update(.1, new Set(['KeyD']), true);
  expect(p.position.x).toBeCloseTo(b.x + .6);
});
test('jump lands, crouch changes eye height, and inactive input cannot move', () => {
  const p = new Player(); p.position.set(0, -1.5, 0);
  p.update(STEP, new Set(['Space']), true); expect(p.position.y).toBeGreaterThan(-1.5);
  for (let i = 0; i < 120; i++) p.update(STEP, new Set(), true);
  expect(p.position.y).toBeCloseTo(-1.5);
  p.update(STEP, new Set(['KeyC']), true); expect(p.position.y).toBeCloseTo(-2.15);
  const before = p.position.clone(); p.update(.1, new Set(['KeyW']), false); expect(p.position).toEqual(before);
});
test('fire rate, magazine, timed reload, and sprint prevent unlimited firing', () => {
  const p = new Player(); expect(p.fire()).toBe(true); expect(p.fire()).toBe(false);
  p.update(.12, new Set(), false); expect(p.fire()).toBe(true);
  p.reload(); p.update(1.64, new Set(), false); expect(p.ammo).toBe(28); expect(p.fire()).toBe(false);
  p.update(.02, new Set(), false); expect(p.ammo).toBe(30);
  p.sprinting = true; expect(p.fire()).toBe(false);
  p.sprinting = false; p.ammo = 0; expect(p.fire()).toBe(false); expect(p.reloadLeft).toBe(1.65);
});
test('shield absorbs damage before health and regenerates only after its delay', () => {
  const p = new Player(); p.damage(130); expect(p.shield).toBe(0); expect(p.health).toBe(70);
  p.update(4, new Set(), false); expect(p.shield).toBe(0);
  p.update(.5, new Set(), false); expect(p.shield).toBe(9);
  p.damage(100); expect(p.health).toBe(0); expect(p.fire()).toBe(false);
});
test('swept projectiles cannot tunnel through base walls or the player', () => {
  const sim = new Simulation(); sim.laws.gravity.strength = 0;
  for (const e of [...sim.entities]) sim.remove(e);
  const b = sim.map.structures[0];
  const from = { x: b.x, y: 0, z: b.z + 20 }, to = { x: b.x, y: 0, z: b.z - 20 };
  expect(segmentBox(from, to, b)).toBe(true);
  expect(segmentBox({ ...from, y: 30 }, { ...to, y: 30 }, b)).toBe(false);
  sim.spawn('shot', from, { x: 0, y: 0, z: -4800 }); sim.step(); expect(sim.entities).toHaveLength(0);
  let damage = 0; sim.onPlayerHit = () => damage++;
  sim.spawn('hostileShot', { x: -2, y: 0, z: 0 }, { x: 480, y: 0, z: 0 });
  sim.step(STEP, { x: 0, y: .5, z: 0 }); expect(damage).toBe(1); expect(sim.entities).toHaveLength(0);
  sim.world.free();
});
test('capture needs cleared patrol and proximity, freezes with time, and rewinds', () => {
  const sim = new Simulation(), target = { x: 0, y: 0, z: 10 };
  sim.tick(6, target); expect(sim.capture).toBe(0);
  for (const e of [...sim.entities]) sim.remove(e);
  for (let i = 0; i < 120; i++) sim.tick(6, { ...target, z: 13 }); expect(sim.capture).toBe(0);
  for (let i = 0; i < 120; i++) sim.tick(6, target); expect(sim.capture).toBeCloseTo(12.5);
  sim.laws.time.mode = 'playerMotion';
  for (let i = 0; i < 120; i++) sim.tick(0, target); expect(sim.capture).toBeCloseTo(12.5);
  sim.startRewind(2); for (let i = 0; i < 240; i++) sim.tick(0, target); expect(sim.capture).toBe(0);
  sim.world.free();
});
test('enemy fire follows world time and map switching resets collision and history', () => {
  const sim = new Simulation(); sim.laws.time.mode = 'playerMotion';
  for (let i = 0; i < 120; i++) sim.tick(0, { x: 0, y: 0, z: 30 });
  expect(sim.entities.some(e => e.kind === 'hostileShot')).toBe(false);
  for (let i = 0; i < 100; i++) sim.tick(6, { x: 0, y: 0, z: 30 });
  expect(sim.entities.some(e => e.kind === 'hostileShot')).toBe(true);
  sim.setMap(maps[2]); expect(sim.staticBodies).toHaveLength(maps[2].structures.length + 1);
  expect(sim.historyLength).toBe(1); expect(sim.entities).toHaveLength(13); expect(sim.capture).toBe(0);
  sim.world.free();
});
