import { describe, expect, it } from 'vitest';
import { CollisionWorld } from './collision';
import { MAP_IDS, loadMap, loadNav } from './maps/index';
import type { MapDef } from './maps/types';
import { rng } from './math';
import { MOVE, createMoveState, idleInput, stepMovement, type MoveInput, type MoveState } from './movement';
import { deepestOverlap, penetration, raycastObstacle } from './obstacles';
import {
  RUN_OVER_SPEED, VEHICLES, createVehicle, exitSpot, forwardOf, idleVehicleInput, obstaclesOf, rightOf, speedOf, stepVehicle, vehicleGround,
  vehicleObstacles, type Vehicle, type VehicleKind,
} from './vehicles';
import { avoidObstacles } from './match/bots';
import { spawnSoldier, type SimContext } from './match/combat';
import { addSoldier, createMatch, enterVehicle, exitVehicle, reportState, reportVehicle, resetMatch, tickMatch, TICK_RATE } from './match/sim';
import { ELIMINATION, type ClientReport, type MatchEvent, type MatchState, type Soldier } from './match/state';
import { stepBodies, type Body } from './world';

const STEP = 1 / 120;
const flatField = { x0: -200, z0: -200, spacing: 100, n: 5, heights: new Float32Array(25) };
const bounds = { minX: -150, maxX: 150, minZ: -150, maxZ: 150 };
const open = new CollisionWorld([], [], flatField, bounds);

const parked = (kind: VehicleKind, x = 0, z = 0, yaw = 0, id = 0) => createVehicle(id, { kind, x, y: 0, z, yaw });
/** Walk toward a heading for some seconds against the obstacles; returns the closest the soldier came to them. */
function walk(s: MoveState, yaw: number, seconds: number, vehicles: Vehicle[], input: Partial<MoveInput> = {}) {
  let worst = -Infinity;
  for (let t = 0; t < seconds; t += STEP) {
    stepMovement(open, s, { ...idleInput(yaw), forward: 1, ...input }, STEP, -1, obstaclesOf(vehicles));
    worst = Math.max(worst, deepestOverlap(obstaclesOf(vehicles), s, MOVE.radius, 1.8).depth);
  }
  return worst;
}
/** Yaw that faces from (x0, z0) toward (x1, z1) (forward is (-sin, -cos)). */
const yawTo = (x0: number, z0: number, x1: number, z1: number) => Math.atan2(-(x1 - x0), -(z1 - z0));

describe('soldiers and vehicle bodies', () => {
  it('a parked car stops a soldier walking into it from every side and at its corners', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, 2.2]) {
      const car = parked('car', 3, -2, yaw);
      const f = forwardOf(yaw), r = rightOf(yaw), b = VEHICLES.car.blocks[0];
      // Aim points: the four sides' middles and the four corners of the oriented box.
      const aims: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (const [u, w] of aims) {
        const tx = car.x + r.x * u * b.w + f.x * w * b.l, tz = car.z + r.z * u * b.w + f.z * w * b.l;
        // Start 6 m out along the line from the centre through the aim point.
        const dx = tx - car.x, dz = tz - car.z, d = Math.hypot(dx, dz);
        const s = createMoveState(tx + dx / d * 6, 0, tz + dz / d * 6);
        const depth = walk(s, yawTo(s.x, s.z, car.x, car.z), 3, [car], { sprint: true });
        expect(depth, `yaw ${yaw} aim ${u},${w}`).toBeLessThan(0.02);
        expect(s.y, 'still on the ground').toBeLessThan(0.01);
        // Ended against the body: within a soldier's radius of it.
        expect(penetration(vehicleObstacles(car)[0], s.x, s.z, MOVE.radius + 0.1).depth).toBeGreaterThan(0);
      }
    }
  });

  it('a scooter blocks with a smaller footprint', () => {
    const scooter = parked('scooter', 0, 0, Math.PI / 2);
    // Head-on into its side, and along its length past its nose.
    const side = createMoveState(0, 0, 5);
    expect(walk(side, 0, 2.5, [scooter])).toBeLessThan(0.02);
    expect(side.z).toBeGreaterThan(VEHICLES.scooter.blocks[0].w + MOVE.radius - 0.02);
    expect(side.z).toBeLessThan(VEHICLES.scooter.blocks[0].w + MOVE.radius + 0.05);
    // A soldier passes 1.2 m to the side of its centre line (a car would have stopped him).
    const past = createMoveState(-5, 0, 0.75);
    walk(past, -Math.PI / 2, 2, [scooter]);
    expect(past.x).toBeGreaterThan(3);
    const carPast = createMoveState(-5, 0, 0.75);
    walk(carPast, -Math.PI / 2, 2, [parked('car', 0, 0, Math.PI / 2)]);
    expect(carPast.x).toBeLessThan(0);
  });

  it('the landed helicopter blocks with its cabin and tail boom (crouch under the boom), never its rotor', () => {
    const heli = parked('heli', 0, 0, 0);
    const cabin = createMoveState(-6, 0, -0.5);
    expect(walk(cabin, -Math.PI / 2, 2.5, [heli])).toBeLessThan(0.02);
    expect(cabin.x).toBeLessThan(-1);
    // The tail boom is at head height: blocks a soldier standing, not one crouching under it.
    const tail = forwardOf(0), z = -tail.z * 3;
    const standing = createMoveState(-5, 0, z);
    walk(standing, -Math.PI / 2, 2, [heli]);
    expect(standing.x).toBeLessThan(0);
    const crouched = createMoveState(-5, 0, z);
    crouched.crouch = 1;
    walk(crouched, -Math.PI / 2, 4, [heli], { crouch: true });
    expect(crouched.x).toBeGreaterThan(2);
    // Under the rotor disc (well clear of the body) nothing stops him.
    const rotor = createMoveState(-5, 0, -4);
    walk(rotor, -Math.PI / 2, 1.5, [heli]);
    expect(rotor.x).toBeGreaterThan(2);
  });

  it('a soldier jumps onto a car, stands on its bonnet and roof, and drops off when it drives away', () => {
    const car = parked('car', 0, 0, Math.PI / 2);
    const s = createMoveState(0, 0, 3);
    // Run at its side and jump: up on the lower body.
    for (let t = 0; t < 1.2; t += STEP) {
      stepMovement(open, s, { ...idleInput(0), forward: s.grounded && s.y > 0.5 ? 0 : 1, jump: s.z < 1.9 && s.grounded && s.y < 0.5 }, STEP, -1, obstaclesOf([car]));
    }
    expect(s.grounded).toBe(true);
    expect(s.y).toBeGreaterThan(1);
    // Walk along it onto the roof (a step up from the bonnet), and stand there.
    const top = VEHICLES.car.blocks[1].y0 + VEHICLES.car.blocks[1].h;
    s.x = 1.7; s.z = 0;
    for (let t = 0; t < 0.3; t += STEP) stepMovement(open, s, { ...idleInput(Math.PI / 2), forward: 0.8 }, STEP, -1, obstaclesOf([car]));
    for (let t = 0; t < 1; t += STEP) stepMovement(open, s, idleInput(), STEP, -1, obstaclesOf([car]));
    expect(s.y).toBeCloseTo(top, 3);
    expect(Math.abs(s.x)).toBeLessThan(1.1);
    expect(s.grounded).toBe(true);
    // The car drives off under him: he falls to the road.
    for (let t = 0; t < 2; t += STEP) {
      stepVehicle(open, car, { ...idleVehicleInput(car.yaw, true), throttle: 1 }, STEP);
      stepMovement(open, s, idleInput(), STEP, -1, obstaclesOf([car]));
    }
    expect(s.y).toBeLessThan(0.01);
  });

  it('a car driving slowly into a soldier pushes him aside instead of overlapping him', () => {
    const car = parked('car', 0, 10, 0);
    const s = createMoveState(0.3, 0, 0);
    let worst = 0;
    for (let t = 0; t < 6; t += STEP) {
      // Creep forward at walking pace.
      stepVehicle(open, car, { ...idleVehicleInput(car.yaw, true), throttle: speedOf(car) < 3 ? 0.4 : 0 }, STEP);
      stepMovement(open, s, idleInput(), STEP, -1, obstaclesOf([car]));
      worst = Math.max(worst, deepestOverlap(obstaclesOf([car]), s, MOVE.radius, 1.8).depth);
    }
    expect(car.z).toBeLessThan(-2); // the car went past where he stood
    expect(worst).toBeLessThan(0.08);
    expect(Math.abs(s.x)).toBeGreaterThan(VEHICLES.car.blocks[0].w + MOVE.radius - 0.1);
    expect(s.y).toBeLessThan(0.01); // slow: no shove off his feet
  });

  it('a fast car shoves a soldier off his feet and aside', () => {
    const car = parked('car', 0, 12, 0);
    car.vz = -15; car.vx = 0;
    const s = createMoveState(0.4, 0, 0);
    let airborne = false;
    for (let t = 0; t < 1.5; t += STEP) {
      stepVehicle(open, car, { ...idleVehicleInput(car.yaw, true), throttle: 1 }, STEP);
      stepMovement(open, s, idleInput(), STEP, -1, obstaclesOf([car]));
      airborne ||= !s.grounded;
    }
    expect(speedOf(car)).toBeGreaterThan(RUN_OVER_SPEED);
    expect(airborne).toBe(true);
    expect(Math.abs(s.x)).toBeGreaterThan(1.3);
  });

  it('a grenade bounces off a car body and comes to rest on its roof', () => {
    const car = parked('car', 0, 0, 0);
    const side: Body = { id: 1, kind: 'grenade', x: -6, y: 0.9, z: 0, vx: 12, vy: 2, vz: 0, age: 0, owner: -1, team: -1, hp: 1, timer: 9 };
    for (let i = 0; i < 120; i++) stepBodies([side], 1 / 120, open, obstaclesOf([car]));
    expect(side.x).toBeLessThan(-VEHICLES.car.blocks[0].w);
    const dropped: Body = { ...side, x: 0, y: 4, z: 0.2, vx: 0, vy: 0, vz: 0 };
    for (let i = 0; i < 480; i++) stepBodies([dropped], 1 / 120, open, obstaclesOf([car]));
    expect(dropped.y).toBeGreaterThan(1.4);
    expect(dropped.y).toBeLessThan(1.6);
    expect(raycastObstacle({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, vehicleObstacles(car)[1], 10)?.normal.y).toBe(1);
  });
});

describe('vehicles against each other', () => {
  it('two cars driven into each other separate, lose their speed and take a crash-sized impact', () => {
    const a = parked('car', 0, 15, 0, 0), b = parked('car', 0, -15, Math.PI, 1);
    let impactA = 0, impactB = 0, worst = 0;
    for (let t = 0; t < 3; t += STEP) {
      // Each sees the other where it was at the start of the step (as each driver sees the other one's latest pose).
      const seenA = obstaclesOf([a]), seenB = obstaclesOf([b]);
      const ea = stepVehicle(open, a, { ...idleVehicleInput(a.yaw, true), throttle: 1 }, STEP, seenB);
      const eb = stepVehicle(open, b, { ...idleVehicleInput(b.yaw, true), throttle: 1 }, STEP, seenA);
      impactA = Math.max(impactA, ea.impact); impactB = Math.max(impactB, eb.impact);
      worst = Math.max(worst, deepestOverlap(obstaclesOf([b]), { x: a.x, y: 0, z: a.z }, 0.01, 1).depth);
    }
    // Never through each other: A stays on its side (north, +z), B on its own.
    expect(a.z).toBeGreaterThan(b.z + 2 * VEHICLES.car.blocks[0].l - 0.3);
    expect(impactA).toBeGreaterThan(VEHICLES.car.crashSpeed);
    expect(impactB).toBeGreaterThan(VEHICLES.car.crashSpeed);
    expect(worst).toBe(0);
  });

  it('a car rams a scooter: the scooter takes most of the blow (by mass)', () => {
    const car = parked('car', 0, 0, 0, 0);
    car.vz = -12;
    const scooter = parked('scooter', 0, -6, Math.PI / 2, 1);
    let carImpact = 0, kick = 0;
    for (let t = 0; t < 0.6; t += STEP) {
      const e = stepVehicle(open, car, idleVehicleInput(car.yaw, true), STEP, obstaclesOf([scooter]));
      carImpact = Math.max(carImpact, e.impact);
      for (const c of e.contacts ?? []) kick = Math.max(kick, Math.hypot(c.dvx, c.dvz));
    }
    expect(carImpact).toBeGreaterThan(0.5);
    expect(carImpact).toBeLessThan(4);
    expect(kick).toBeGreaterThan(10);
  });

  it('exitSpot never puts a soldier into a vehicle parked alongside', () => {
    const car = parked('car', 0, 0, 0, 0);
    // A second car right by the driver's door (left side), another behind.
    const left = parked('car', -2.3, 0, 0, 1), behind = parked('car', 0, 5.2, 0, 2);
    const free = exitSpot(open, car, 0);
    expect(penetration(vehicleObstacles(left)[0], free.x, free.z, MOVE.radius).depth).toBeGreaterThan(0); // the door spot is where the other car is
    const out = exitSpot(open, car, 0, MOVE.radius, MOVE.standHeight, obstaclesOf([left, behind]));
    expect(deepestOverlap(obstaclesOf([car, left, behind]), out, MOVE.radius, MOVE.standHeight).depth).toBe(0);
    expect(Math.hypot(out.x - car.x, out.z - car.z)).toBeLessThan(4);
  });
});

/** A flat test map with a car and a scooter parked side by side, and a base each side of them. */
function flatMap(): MapDef {
  return {
    id: 'flat', name: 'Flat', region: '', description: '', theme: 'dusk', bounds, terrain: flatField, solids: [], ramps: [], decor: [], sun: { x: 0, y: 1, z: 0 },
    points: [{ id: 'A', name: 'A', x: 0, y: 0, z: 0, radius: 5 }],
    spawns: [{ team: 0, x: -20, y: 0, z: 0, yaw: 0 }, { team: 1, x: 20, y: 0, z: 0, yaw: 0 }],
    vehicles: [{ kind: 'car', x: 0, y: 0, z: 0, yaw: 0 }, { kind: 'scooter', x: 0, y: 0, z: -6, yaw: 0 }, { kind: 'car', x: 2.4, y: 0, z: 0, yaw: 0 }],
  };
}
function setup() {
  const events: MatchEvent[] = [];
  const ctx: SimContext = { map: flatMap(), world: open, random: rng(5), emit: e => events.push(e) };
  const state = createMatch('flat', { ...ELIMINATION, teamSize: 0, noBots: true });
  return { ctx, state, events };
}
const tick = (state: MatchState, ctx: SimContext, seconds: number) => { for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) tickMatch(state, ctx, 1 / TICK_RATE); };
const report = (s: Soldier, x: number, z: number, y = 0): ClientReport => ({ x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, crouch: 0, grounded: true, sprint: false, ads: false, weapon: 0 });
const place = (s: Soldier, x: number, z: number, y = 0) => { s.m = createMoveState(x, y, z); s.groundY = y; };

describe('vehicle bodies in a match (server rules)', () => {
  it('rejects a reported position walking into a parked car, accepts walking up to it and standing on its roof', () => {
    const { ctx, state } = setup();
    const a = addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    resetMatch(state, ctx); tick(state, ctx, 4.2);
    place(a, -3, 0);
    // Up to the door: fine.
    expect(reportState(state, ctx, a.id, report(a, -1.4, 0), 0.2)).toBe(true);
    const before = a.corrections;
    // Into the body: refused, and the soldier stays where he was.
    expect(reportState(state, ctx, a.id, report(a, -0.6, 0), 0.2)).toBe(false);
    expect(reportState(state, ctx, a.id, report(a, 0, 0.5), 0.2)).toBe(false);
    expect(a.corrections).toBe(before + 2);
    expect(a.m.x).toBeCloseTo(-1.4, 5);
    // On the roof (he jumped up): a floor like any other, so standing there is no hovering.
    const roof = VEHICLES.car.blocks[1].y0 + VEHICLES.car.blocks[1].h;
    place(a, -0.2, 0, roof);
    for (let i = 0; i < 80; i++) expect(reportState(state, ctx, a.id, report(a, -0.2, 0, roof), 0.05)).toBe(true);
    expect(a.corrections).toBe(before + 2);
  });

  it('accepts a soldier a moving car pushed (deeper than slack only if he walked in himself)', () => {
    const { ctx, state } = setup();
    const a = addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    resetMatch(state, ctx); tick(state, ctx, 4.2);
    const car = state.vehicles[0];
    // The car rolls onto where he stands (the host moved it; his client has not seen it yet).
    place(a, 0, -2.6);
    car.z = -1.0; car.vz = -2;
    expect(reportState(state, ctx, a.id, report(a, 0, -2.6), 0.05)).toBe(true);
    // Pushed out of its way by his client: fine.
    expect(reportState(state, ctx, a.id, report(a, 0, -3.7), 0.05)).toBe(true);
  });

  it('exits on the free side when another car is parked by the driver\'s door', () => {
    const { ctx, state } = setup();
    const a = addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    const b = addSoldier(state, ctx, { name: 'B', team: 0, bot: false });
    resetMatch(state, ctx); tick(state, ctx, 4.2);
    // The passenger side of car 0 (+x) has car 2 right against it: get in, then out.
    place(a, -1.6, 0);
    expect(enterVehicle(state, ctx, a.id, 0)).toBe(true);
    expect(exitVehicle(state, ctx, a.id)).toBe(true);
    expect(deepestOverlap(obstaclesOf(state.vehicles), a.m, MOVE.radius, MOVE.standHeight).depth).toBe(0);
    // From the passenger's seat: its own door spot is inside car 2, so it gets out elsewhere, clear.
    const door = exitSpot(ctx.world, state.vehicles[0], 1);
    expect(deepestOverlap(obstaclesOf([state.vehicles[2]]), door, MOVE.radius, MOVE.standHeight).depth).toBeGreaterThan(0);
    place(a, -1.6, 0); place(b, -1.6, 0.5);
    expect(enterVehicle(state, ctx, a.id, 0)).toBe(true);
    expect(enterVehicle(state, ctx, b.id, 0)).toBe(true);
    expect(exitVehicle(state, ctx, b.id)).toBe(true);
    expect(deepestOverlap(obstaclesOf(state.vehicles), b.m, MOVE.radius, MOVE.standHeight).depth).toBe(0);
  });

  it('a car rammed by a driven car is shoved and damaged by the host; driving through it is refused', () => {
    const { ctx, state } = setup();
    const a = addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    resetMatch(state, ctx); tick(state, ctx, 4.2);
    // A takes car 0, already rolling west at 24 m/s from 12 m east of car 2's side (its client's
    // prediction runs from the same pose).
    place(a, -1.6, 0);
    expect(enterVehicle(state, ctx, a.id, 0)).toBe(true);
    const mine = state.vehicles[0], target = state.vehicles[2];
    Object.assign(mine, { x: 16, z: 0, yaw: Math.PI / 2, vx: -24, vz: 0 });
    const sim: Vehicle = { ...mine };
    const health = target.health;
    let refused = 0;
    for (let k = 0; k < 12; k++) {
      for (let i = 0; i < 6; i++) stepVehicle(ctx.world, sim, { ...idleVehicleInput(sim.yaw, true), throttle: 1 }, STEP, obstaclesOf(state.vehicles, sim.id));
      if (!reportVehicle(state, ctx, a.id, { vehicle: sim.id, x: sim.x, y: sim.y, z: sim.z, vx: sim.vx, vy: sim.vy, vz: sim.vz, yaw: sim.yaw, pitch: sim.pitch, roll: sim.roll }, 0.05)) refused++;
      tick(state, ctx, 0.05);
    }
    expect(refused).toBe(0);
    // The rammer stopped at the struck car's side; the struck car took the blow and rolled west.
    expect(sim.x).toBeGreaterThan(2.4 + VEHICLES.car.blocks[0].w);
    expect(target.health).toBeLessThan(health);
    expect(target.x).toBeLessThan(2.4 - 1);
    // A cheat: a report from beside car 2 straight into its body.
    Object.assign(mine, { x: target.x + 2.4, z: target.z, vx: 0, vz: 0 });
    const cheat = { vehicle: mine.id, x: target.x, y: mine.y, z: target.z, vx: 0, vy: 0, vz: 0, yaw: mine.yaw, pitch: 0, roll: 0 };
    target.vx = 0; target.vz = 0;
    expect(reportVehicle(state, ctx, a.id, cheat, 0.2)).toBe(false);
  });

  it('a driverless car that rolls into a parked one bounces and hands it the blow', () => {
    const { ctx, state } = setup();
    addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    resetMatch(state, ctx); tick(state, ctx, 4.2);
    const [car, scooter] = state.vehicles;
    // Car 0 coasts backwards (+z is behind it)... set it rolling toward the scooter in front (-z).
    car.vz = -9;
    tick(state, ctx, 1.5);
    expect(car.z).toBeGreaterThan(scooter.z);
    expect(scooter.z).toBeLessThan(-6.5); // pushed on
    expect(deepestOverlap(vehicleObstacles(scooter), { x: car.x, y: 0, z: car.z }, 0.5, 1).depth).toBe(0);
  });

  it('spawn slots are never under a parked vehicle, on every map', () => {
    for (const id of MAP_IDS) {
      const { def, world } = loadMap(id);
      const vehicles = (def.vehicles ?? []).map((spot, i) => { const v = createVehicle(i, spot); v.y = vehicleGround(world, { ...v, y: spot.y + 0.5 }); return v; });
      const obstacles = obstaclesOf(vehicles);
      for (const slot of def.spawns) expect(deepestOverlap(obstacles, slot, MOVE.radius + 0.3, MOVE.standHeight).depth, `${id} slot ${slot.x},${slot.z}`).toBe(0);
      for (const crate of def.pickups ?? []) expect(deepestOverlap(obstacles, crate, 0.6, MOVE.standHeight).depth, `${id} crate`).toBe(0);
    }
  });

  it('a soldier deploys clear of a vehicle driven onto his base\'s slots', () => {
    const { ctx, state } = setup();
    const a = addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    resetMatch(state, ctx); tick(state, ctx, 4.2);
    // Park car 0 on SWAT's only slot, then redeploy.
    // (startRound parks it back at its spot; a deploy mid-round does not.)
    Object.assign(state.vehicles[0], { x: -20, z: 0.3 });
    a.alive = false;
    spawnSoldier(state, ctx, a);
    expect(deepestOverlap(obstaclesOf(state.vehicles), a.m, MOVE.radius - 0.02, MOVE.standHeight).depth).toBe(0);
  });
});

describe('bots and vehicles', () => {
  it('the navigation grid routes round the vehicles parked at their spots', () => {
    for (const id of MAP_IDS) {
      const { def, world } = loadMap(id), nav = loadNav(id);
      const vehicles = (def.vehicles ?? []).map((spot, i) => { const v = createVehicle(i, spot); v.y = vehicleGround(world, { ...v, y: spot.y + 0.5 }); return v; });
      const obstacles = obstaclesOf(vehicles);
      for (let i = 0; i < nav.x.length; i++) {
        expect(deepestOverlap(obstacles, { x: nav.x[i], y: nav.y[i], z: nav.z[i] }, MOVE.radius * 0.8, MOVE.standHeight).depth, `${id} node ${i}`).toBe(0);
      }
    }
  });

  it('a bot heading through a car steers round it and gets past', () => {
    const car = parked('car', 0, 0, Math.PI / 2);
    const bot = { id: 3, m: createMoveState(0, 0, 6) } as Soldier;
    const goal = { x: 0, z: -6 };
    let worst = 0;
    for (let t = 0; t < 5 && bot.m.z > goal.z + 0.5; t += STEP) {
      let [mx, mz] = [goal.x - bot.m.x, goal.z - bot.m.z];
      const l = Math.hypot(mx, mz); mx /= l; mz /= l;
      [mx, mz] = avoidObstacles(bot, obstaclesOf([car]), mx, mz);
      const yaw = Math.atan2(-mx, -mz);
      stepMovement(open, bot.m, { ...idleInput(yaw), forward: Math.hypot(mx, mz) }, STEP, -1, obstaclesOf([car]));
      worst = Math.max(worst, deepestOverlap(obstaclesOf([car]), bot.m, MOVE.radius, 1.8).depth);
    }
    expect(bot.m.z).toBeLessThan(goal.z + 1);
    expect(worst).toBeLessThan(0.02);
  });
});
