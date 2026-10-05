import { describe, expect, it } from 'vitest';
import { CollisionWorld } from './collision';
import { MAP_IDS, loadMap } from './maps/index';
import { rng } from './math';
import {
  HELI_CEILING, VEHICLES, createVehicle, exitSpot, forwardOf, idleVehicleInput, raycastVehicle, seatPosition, speedOf, stepVehicle,
  vehicleBlocked, type Vehicle, type VehicleInput,
} from './vehicles';
import { decodeFrame, encodeFrame } from './match/frame';
import {
  addSoldier, createContext, createMatch, enterVehicle, exitVehicle, fireShot, reportState, reportVehicle, resetMatch, seatOf, startRound,
  tickMatch, TICK_RATE,
} from './match/sim';
import { ELIMINATION, PRACTICE_CONFIG, vehicleTarget, type MatchConfig, type MatchEvent, type MatchState, type Soldier } from './match/state';
import type { SimContext } from './match/combat';

const STEP = 1 / 120;
const drive = (world: ReturnType<typeof loadMap>['world'], v: Vehicle, input: Partial<VehicleInput>, seconds: number) => {
  let impact = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i++) impact = Math.max(impact, stepVehicle(world, v, { ...idleVehicleInput(v.yaw, true), ...input }, STEP).impact);
  return impact;
};
const taipeiSpot = (kind: Vehicle['kind']) => {
  const { def } = loadMap('taipei');
  const i = def.vehicles!.findIndex(s => s.kind === kind);
  return { index: i, spot: def.vehicles![i] };
};

describe('vehicle physics', () => {
  it('a car accelerates along its heading, steers, brakes and stays on the road', () => {
    const { world } = loadMap('taipei');
    const { spot } = taipeiSpot('car');
    const v = createVehicle(0, spot);
    const y0 = v.y;
    drive(world, v, { throttle: 1 }, 2);
    const f = forwardOf(spot.yaw);
    const moved = (v.x - spot.x) * f.x + (v.z - spot.z) * f.z;
    expect(speedOf(v)).toBeGreaterThan(10);
    expect(moved).toBeGreaterThan(10);
    expect(Math.abs(v.y - y0)).toBeLessThan(0.3);
    expect(v.grounded).toBe(true);
    const yaw = v.yaw;
    drive(world, v, { throttle: 0.3, steer: 1 }, 0.6);
    expect(v.yaw).toBeLessThan(yaw - 0.2); // steering right turns clockwise (yaw decreases)
    drive(world, v, { throttle: -1 }, 2.5);
    expect(speedOf(v)).toBeLessThan(8.5); // braked through zero into reverse, capped at reverse speed
  });

  it('a car hits a wall: it stops at it instead of passing through, and the impact is reported', () => {
    // Flat ground and a thin wall 25 m ahead.
    const wall = { minX: 0, maxX: 0.3, minY: 0, maxY: 3, minZ: -10, maxZ: 10, surface: 'concrete' as const };
    const world = new CollisionWorld([wall], [], { x0: -100, z0: -100, spacing: 50, n: 5, heights: new Float32Array(25) }, { minX: -90, maxX: 90, minZ: -90, maxZ: 90 });
    const v = createVehicle(0, { kind: 'car', x: -25, y: 0, z: 0, yaw: -Math.PI / 2 });
    let impact = 0;
    for (let t = 0; t < 6; t += STEP) {
      impact = Math.max(impact, stepVehicle(world, v, { ...idleVehicleInput(v.yaw, true), throttle: 1 }, STEP).impact);
      expect(v.x).toBeLessThan(wall.minX);
    }
    expect(impact).toBeGreaterThan(3);
    expect(vehicleBlocked(world, v)).toBe(false);
  });

  it('the helicopter waits for its rotor, climbs, hovers, flies, respects the ceiling and lands', () => {
    const { world } = loadMap('taipei');
    const { spot } = taipeiSpot('heli');
    const v = createVehicle(0, spot);
    const y0 = v.y;
    drive(world, v, { lift: 1 }, 0.8);
    expect(v.y).toBeCloseTo(y0, 3); // still spinning up
    drive(world, v, { lift: 1 }, 3);
    expect(v.y).toBeGreaterThan(y0 + 10);
    drive(world, v, {}, 1);
    const hover = v.y;
    drive(world, v, {}, 2);
    expect(Math.abs(v.y - hover)).toBeLessThan(0.05);
    expect(Math.abs(v.vy)).toBeLessThan(0.01);
    drive(world, v, { lift: 1 }, 25);
    expect(v.y).toBeLessThanOrEqual(HELI_CEILING);
    const x0 = v.x, z0 = v.z;
    drive(world, v, { throttle: 1, yaw: v.yaw }, 2);
    expect(Math.hypot(v.x - x0, v.z - z0)).toBeGreaterThan(20);
    drive(world, v, { throttle: 0, lift: -1 }, 30);
    expect(v.grounded).toBe(true);
    expect(v.y).toBeLessThan(HELI_CEILING);
    expect(Math.abs(v.vy)).toBeLessThan(0.01);
  });

  it('an unpowered helicopter falls; hit boxes and exit spots line up with the body', () => {
    const { world } = loadMap('taipei');
    const { spot } = taipeiSpot('heli');
    const v = createVehicle(0, { ...spot, y: spot.y + 30 });
    v.grounded = false;
    let landed = 0;
    for (let i = 0; i < 600 && !v.grounded; i++) landed = Math.max(landed, stepVehicle(world, v, idleVehicleInput(v.yaw, false), STEP).impact);
    expect(v.grounded).toBe(true);
    expect(landed).toBeGreaterThan(VEHICLES.heli.crashSpeed);
    const t = raycastVehicle({ x: v.x - 20, y: v.y + 1.2, z: v.z - 1.2 }, { x: 1, y: 0, z: 0 }, v);
    expect(t).toBeGreaterThan(17); expect(t).toBeLessThan(20);
    expect(raycastVehicle({ x: v.x - 20, y: v.y + 6, z: v.z }, { x: 1, y: 0, z: 0 }, v)).toBe(-1);
    const out = exitSpot(world, v, 0);
    expect(Math.hypot(out.x - v.x, out.z - v.z)).toBeGreaterThan(1);
    expect(world.overlapsSolid({ ...out, y: out.y + 0.05 }, 0.38, 1.8)).toBe(false);
  });
});

function setup(config: MatchConfig = { ...ELIMINATION, teamSize: 0, noBots: true }, mapId = 'taipei') {
  const events: MatchEvent[] = [];
  const ctx = createContext(mapId, rng(3), e => events.push(e));
  const state = createMatch(mapId, config);
  return { ctx, state, events };
}
const tick = (state: MatchState, ctx: SimContext, seconds: number) => { for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) tickMatch(state, ctx, 1 / TICK_RATE); };
const goLive = (state: MatchState, ctx: SimContext) => { resetMatch(state, ctx); tick(state, ctx, state.config.freezeTime + 0.1); };
/** Stand a soldier next to vehicle i (beside the driver's door). */
const besides = (state: MatchState, ctx: SimContext, s: Soldier, i: number) => {
  const p = exitSpot(ctx.world, state.vehicles[i], 0);
  s.m.x = p.x; s.m.y = p.y; s.m.z = p.z; s.m.vx = s.m.vz = 0; s.m.grounded = true;
};
const vreport = (v: Vehicle, over: Partial<Vehicle> = {}) => {
  const n = { ...v, ...over };
  return { vehicle: v.id, x: n.x, y: n.y, z: n.z, vx: n.vx, vy: n.vy, vz: n.vz, yaw: n.yaw, pitch: n.pitch, roll: n.roll };
};

describe('vehicles in a match', () => {
  it('every map parks its vehicles in bounds, on the floor and clear of geometry', () => {
    for (const id of MAP_IDS) {
      const { def, world } = loadMap(id);
      for (const spot of def.vehicles ?? []) {
        const b = def.bounds;
        expect(spot.x > b.minX && spot.x < b.maxX && spot.z > b.minZ && spot.z < b.maxZ, `${id} ${spot.kind}@${spot.x},${spot.z}`).toBe(true);
        expect(vehicleBlocked(world, spot), `${id} ${spot.kind}@${spot.x},${spot.z}`).toBe(false);
        expect(Math.abs(world.groundHeight(spot.x, spot.z, spot.y + 0.5, 0.3) - spot.y), `${id} floor`).toBeLessThan(0.6);
      }
    }
    const kinds = new Set(loadMap('taipei').def.vehicles!.map(v => v.kind));
    expect([...kinds].sort()).toEqual(['car', 'heli', 'scooter']);
    expect(loadMap('meridian').def.vehicles!.length).toBeGreaterThanOrEqual(6);
  });

  it('E gets in and out: drivers, passengers for teammates only, seat poses and a clear exit spot', () => {
    const { ctx, state, events } = setup();
    const a = addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    const mate = addSoldier(state, ctx, { name: 'Mate', team: 0, bot: false });
    const enemy = addSoldier(state, ctx, { name: 'Enemy', team: 1, bot: false });
    goLive(state, ctx);
    const { index } = taipeiSpot('car');
    expect(state.vehicles.length).toBe(ctx.map.vehicles!.length);
    // Too far away: nothing happens.
    expect(enterVehicle(state, ctx, a.id, index)).toBe(false);
    besides(state, ctx, a, index);
    expect(enterVehicle(state, ctx, a.id, index)).toBe(true);
    const v = state.vehicles[index];
    expect(v.driver).toBe(a.id);
    expect(seatOf(state, a.id)?.seat).toBe(0);
    const seat = seatPosition(v, 0);
    expect(Math.hypot(a.m.x - seat.x, a.m.z - seat.z)).toBeLessThan(1e-6);
    besides(state, ctx, enemy, index);
    expect(enterVehicle(state, ctx, enemy.id, index)).toBe(false);
    besides(state, ctx, mate, index);
    expect(enterVehicle(state, ctx, mate.id, index)).toBe(true);
    expect(v.passenger).toBe(mate.id);
    expect(events.some(e => e.type === 'vehicle' && e.action === 'enter' && e.id === a.id && e.seat === 0)).toBe(true);
    // Moving reports from occupants never move them off their seats.
    expect(reportState(state, ctx, a.id, { x: a.m.x + 3, y: a.m.y, z: a.m.z, vx: 0, vy: 0, vz: 0, yaw: 1, pitch: 0, crouch: 0, grounded: true, sprint: false, ads: false, weapon: 0 }, 0.05)).toBe(true);
    tick(state, ctx, 0.1);
    expect(Math.hypot(a.m.x - seat.x, a.m.z - seat.z)).toBeLessThan(1e-3);
    expect(exitVehicle(state, ctx, a.id)).toBe(true);
    expect(v.driver).toBe(-1);
    expect(ctx.world.overlapsSolid({ x: a.m.x, y: a.m.y + 0.05, z: a.m.z }, 0.38, 1.8)).toBe(false);
    expect(Math.hypot(a.m.x - v.x, a.m.z - v.z)).toBeGreaterThan(1);
    expect(Math.hypot(a.m.x - v.x, a.m.z - v.z)).toBeLessThan(4);
    // The dead lose their seat.
    mate.alive = false;
    tick(state, ctx, 0.05);
    expect(v.passenger).toBe(-1);
  });

  it('the driver reports its vehicle: plausible driving is accepted, teleports, flying cars and freeze moves are corrected', () => {
    const { ctx, state } = setup();
    const a = addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    goLive(state, ctx);
    const { index } = taipeiSpot('car');
    besides(state, ctx, a, index);
    expect(enterVehicle(state, ctx, a.id, index)).toBe(true);
    const v = state.vehicles[index];
    const sim = { ...v };
    let corrections = a.corrections;
    for (let k = 0; k < 40; k++) {
      for (let i = 0; i < 6; i++) stepVehicle(ctx.world, sim, { ...idleVehicleInput(sim.yaw, true), throttle: 1, steer: k > 20 ? 0.4 : 0 }, 1 / 120);
      expect(reportVehicle(state, ctx, a.id, vreport(sim), 0.05)).toBe(true);
      tickMatch(state, ctx, 0.05);
    }
    expect(a.corrections).toBe(corrections);
    expect(Math.hypot(v.x - ctx.map.vehicles![index].x, v.z - ctx.map.vehicles![index].z)).toBeGreaterThan(10);
    expect(Math.hypot(a.m.x - seatPosition(v, 0).x, a.m.z - seatPosition(v, 0).z)).toBeLessThan(1e-3);
    // Teleport.
    expect(reportVehicle(state, ctx, a.id, vreport(v, { x: v.x + 40 }), 0.05)).toBe(false);
    expect(a.corrections).toBe(++corrections);
    // A flying car.
    expect(reportVehicle(state, ctx, a.id, vreport(v, { y: v.y + 3, vy: 2 }), 0.05)).toBe(false);
    expect(a.corrections).toBe(++corrections);
    // Into a building.
    const wall = ctx.world.solids.find(s => s.maxY - s.minY > 8 && Math.abs((s.minX + s.maxX) / 2 - v.x) < 60 && Math.abs((s.minZ + s.maxZ) / 2 - v.z) < 60)!;
    expect(reportVehicle(state, ctx, a.id, vreport(v, { x: (wall.minX + wall.maxX) / 2, z: (wall.minZ + wall.maxZ) / 2 }), 5)).toBe(false);
    // Somebody else's vehicle is not yours to report.
    const b = addSoldier(state, ctx, { name: 'B', team: 1, bot: false });
    expect(reportVehicle(state, ctx, b.id, vreport(v, { x: v.x + 0.5 }), 0.05)).toBe(false);
    // Round-start freeze: no driving.
    startRound(state, ctx);
    besides(state, ctx, a, index);
    expect(enterVehicle(state, ctx, a.id, index)).toBe(true);
    const parked = state.vehicles[index];
    const before = a.corrections;
    expect(reportVehicle(state, ctx, a.id, vreport(parked, { x: parked.x + 2 }), 0.2)).toBe(false);
    expect(a.corrections).toBe(before + 1);
  });

  it('the helicopter cannot lift before its rotor spins up on the server, then flies within its ceiling', () => {
    const { ctx, state } = setup();
    const a = addSoldier(state, ctx, { name: 'Pilot', team: 0, bot: false });
    goLive(state, ctx);
    const { index } = taipeiSpot('heli');
    besides(state, ctx, a, index);
    expect(enterVehicle(state, ctx, a.id, index)).toBe(true);
    const v = state.vehicles[index];
    expect(reportVehicle(state, ctx, a.id, vreport(v, { y: v.y + 1, vy: 5 }), 0.1)).toBe(false);
    tick(state, ctx, 2);
    expect(v.rotor).toBe(1);
    const sim = { ...v, rotor: 1 };
    const before = a.corrections;
    for (let k = 0; k < 60; k++) {
      for (let i = 0; i < 6; i++) stepVehicle(ctx.world, sim, { ...idleVehicleInput(sim.yaw, true), lift: 1, throttle: k > 30 ? 1 : 0 }, 1 / 120);
      expect(reportVehicle(state, ctx, a.id, vreport(sim), 0.05), `report ${k}`).toBe(true);
      tickMatch(state, ctx, 0.05);
    }
    expect(a.corrections).toBe(before);
    expect(v.y).toBeGreaterThan(ctx.map.vehicles![index].y + 15);
    expect(reportVehicle(state, ctx, a.id, vreport(v, { y: HELI_CEILING + 5 }), 5)).toBe(false);
    // Too high to bail out; low enough, out you go.
    v.y = ctx.map.vehicles![index].y + 45;
    expect(exitVehicle(state, ctx, a.id)).toBe(false);
    v.y = ctx.map.vehicles![index].y + 8;
    expect(exitVehicle(state, ctx, a.id)).toBe(true);
    expect(a.m.y).toBeCloseTo(v.y, 3);
    expect(a.m.grounded).toBe(false);
  });

  it('rounds park every vehicle back at its spot, repaired and empty', () => {
    const { ctx, state } = setup();
    const a = addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    goLive(state, ctx);
    const { index, spot } = taipeiSpot('scooter');
    besides(state, ctx, a, index);
    expect(enterVehicle(state, ctx, a.id, index)).toBe(true);
    const v = state.vehicles[index];
    expect(reportVehicle(state, ctx, a.id, vreport(v, { x: v.x + 1.5, vx: 3 }), 0.5)).toBe(true);
    v.health = 20;
    startRound(state, ctx);
    const fresh = state.vehicles[index];
    expect(fresh.driver).toBe(-1);
    expect(fresh.health).toBe(VEHICLES.scooter.health);
    expect(fresh.x).toBeCloseTo(spot.x, 5); expect(fresh.z).toBeCloseTo(spot.z, 5);
    expect(seatOf(state, a.id)).toBeUndefined();
  });

  it('shots: drivers cannot fire, car crews are behind the body, scooter riders are exposed, wrecks kill the crew', () => {
    const { ctx, state, events } = setup({ ...PRACTICE_CONFIG });
    const a = addSoldier(state, ctx, { name: 'Driver', team: 0, bot: false });
    const r = addSoldier(state, ctx, { name: 'Rider', team: 0, bot: false });
    const shooter = addSoldier(state, ctx, { name: 'Shooter', team: 1, bot: false });
    goLive(state, ctx);
    const car = taipeiSpot('car').index, scooter = taipeiSpot('scooter').index;
    besides(state, ctx, a, car); enterVehicle(state, ctx, a.id, car);
    besides(state, ctx, r, scooter); enterVehicle(state, ctx, r.id, scooter);
    const claim = (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, target: number) => {
      const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      return { weapon: 0 as const, origin: from, dir: { x: (to.x - from.x) / d, y: (to.y - from.y) / d, z: (to.z - from.z) / d }, target, zone: 'body' as const, point: to };
    };
    // The driver cannot shoot.
    const before = a.ammo[0];
    expect(fireShot(state, ctx, a.id, claim({ x: a.m.x, y: a.m.y + 1, z: a.m.z }, { x: a.m.x + 5, y: a.m.y + 1, z: a.m.z }, -1))).toBe(false);
    expect(a.ammo[0]).toBe(before);
    // A shot at the car's driver hits the car.
    const v = state.vehicles[car];
    const f = forwardOf(v.yaw);
    const eye = { x: v.x + f.x * 12, y: v.y + 1.2, z: v.z + f.z * 12 };
    shooter.m.x = eye.x; shooter.m.y = eye.y - 1.62; shooter.m.z = eye.z;
    const health = a.health, hp = v.health;
    for (let i = 0; i < 3; i++) {
      shooter.fireCooldown = 0;
      fireShot(state, ctx, shooter.id, claim(eye, { x: a.m.x, y: a.m.y + 1.0, z: a.m.z }, a.id));
    }
    expect(a.health).toBe(health);
    expect(v.health).toBeLessThan(hp);
    // A claimed vehicle hit.
    shooter.fireCooldown = 0;
    const hp2 = v.health;
    expect(fireShot(state, ctx, shooter.id, claim(eye, { x: v.x, y: v.y + 0.8, z: v.z }, vehicleTarget(car)))).toBe(true);
    expect(v.health).toBeLessThan(hp2);
    // The scooter rider takes the bullet.
    const s = state.vehicles[scooter];
    const rf = forwardOf(s.yaw);
    const reye = { x: s.x + rf.x * 8, y: r.m.y + 1.0, z: s.z + rf.z * 8 };
    shooter.m.x = reye.x; shooter.m.y = reye.y - 1.62; shooter.m.z = reye.z; shooter.fireCooldown = 0;
    const rh = r.health;
    fireShot(state, ctx, shooter.id, claim(reye, { x: r.m.x, y: r.m.y + 0.9, z: r.m.z }, r.id));
    expect(r.health).toBeLessThan(rh);
    // Wreck the car: its crew dies in the explosion.
    v.health = 5;
    shooter.m.x = eye.x; shooter.m.y = eye.y - 1.62; shooter.m.z = eye.z; shooter.fireCooldown = 0;
    fireShot(state, ctx, shooter.id, claim(eye, { x: v.x, y: v.y + 0.8, z: v.z }, vehicleTarget(car)));
    expect(v.wrecked).toBe(true);
    expect(a.alive).toBe(false);
    expect(events.some(e => e.type === 'kill' && e.victim === a.id && e.killer === shooter.id)).toBe(true);
    expect(events.some(e => e.type === 'explosion' && e.weapon === 'vehicle')).toBe(true);
    expect(enterVehicle(state, ctx, shooter.id, car)).toBe(false);
  });

  it('running an enemy over hurts them; teammates are spared', () => {
    const { ctx, state } = setup({ ...PRACTICE_CONFIG });
    const a = addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    const mate = addSoldier(state, ctx, { name: 'Mate', team: 0, bot: false });
    const enemy = addSoldier(state, ctx, { name: 'E', team: 1, bot: false });
    goLive(state, ctx);
    const { index } = taipeiSpot('car');
    besides(state, ctx, a, index); enterVehicle(state, ctx, a.id, index);
    const v = state.vehicles[index];
    const f = forwardOf(v.yaw);
    const ahead = (s: Soldier, d: number) => { s.m.x = v.x + f.x * d; s.m.z = v.z + f.z * d; s.m.y = v.y; };
    ahead(mate, 2); ahead(enemy, 2.2);
    v.vx = f.x * 15; v.vz = f.z * 15;
    tickMatch(state, ctx, 1 / TICK_RATE);
    expect(enemy.health).toBeLessThan(100);
    expect(mate.health).toBe(100);
  });

  it('frames carry vehicles: pose, health, crew and wrecks round-trip', () => {
    const { ctx, state } = setup();
    addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    goLive(state, ctx);
    const v = state.vehicles[3];
    v.x += 1.234; v.y += 0.5; v.yaw = 2.5; v.pitch = 0.1; v.roll = -0.2; v.vx = 12.3; v.health = 77; v.driver = 1; v.rotor = 0.5;
    state.vehicles[1].wrecked = true;
    const frame = decodeFrame(encodeFrame(state, []))!;
    expect(frame.vehicles.length).toBe(state.vehicles.length);
    const d = frame.vehicles[3];
    expect(d.kind).toBe(v.kind);
    expect(d.x).toBeCloseTo(v.x, 1); expect(d.y).toBeCloseTo(v.y, 1); expect(d.vx).toBeCloseTo(12.3, 1);
    expect(d.yaw).toBeCloseTo(2.5, 3); expect(d.pitch).toBeCloseTo(0.1, 3); expect(d.roll).toBeCloseTo(-0.2, 3);
    expect(d.health).toBe(77); expect(d.driver).toBe(1); expect(d.passenger).toBe(-1); expect(d.rotor).toBeCloseTo(0.5, 1);
    expect(frame.vehicles[1].wrecked).toBe(true);
    expect(frame.poses.length).toBe(state.soldiers.length);
  });
});
