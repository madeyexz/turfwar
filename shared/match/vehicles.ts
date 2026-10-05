import { MOVE, createMoveState } from '../movement';
import { clamp } from '../math';
import {
  HELI_CEILING, RUN_OVER_SPEED, ROTOR_SPINUP, VEHICLES, createVehicle, exitSpot, forwardOf, idleVehicleInput, maxSlack, reachOf,
  seatPosition, slackSpeed, speedOf, stepVehicle, vehicleBlocked, vehicleGround, type Vehicle,
} from '../vehicles';
import { MOVE_SLACK, applyDamage, damageVehicle, seatOf, type SimContext } from './combat';
import type { MatchState, Soldier, VehicleReport } from './state';

export { seatOf } from './combat';

/**
 * Match rules for vehicles, shared by Solo and the server: parking them at round start, getting in
 * and out (E), validating the driver's reports, simulating driverless vehicles, keeping the crew in
 * their seats, crashes and running soldiers over.
 */

/** Seconds between run-over hits from one vehicle. */
const RUN_OVER_COOLDOWN = 0.4;
/** Pilots cannot bail out higher than this above the floor. */
export const BAIL_HEIGHT = 40;

/** Park every vehicle at its map spot, repaired and empty (every round start). */
export function resetVehicles(state: MatchState, ctx: SimContext) {
  state.vehicles = (ctx.map.vehicles ?? []).map((spot, i) => {
    const v = createVehicle(i, spot);
    v.y = vehicleGround(ctx.world, { ...v, y: spot.y + 0.5 });
    return v;
  });
}

/** Can this soldier get into vehicle `v` (and which seat)? */
export function seatFor(state: MatchState, s: Soldier, v: Vehicle): 0 | 1 | undefined {
  if (v.wrecked || !s.alive || seatOf(state, s.id)) return undefined;
  const spec = VEHICLES[v.kind];
  if (reachOf(v, s.m) > spec.reach + 0.5) return undefined;
  const team = (id: number) => state.soldiers.find(x => x.id === id)?.team;
  if (v.driver < 0) return v.passenger >= 0 && team(v.passenger) !== s.team ? undefined : 0;
  if (spec.seats.length > 1 && v.passenger < 0 && team(v.driver) === s.team) return 1;
  return undefined;
}

/** E next to a vehicle: take the driver's seat, or the passenger's beside a teammate. */
export function enterVehicle(state: MatchState, ctx: SimContext, id: number, index: number) {
  const s = state.soldiers.find(x => x.id === id);
  const v = Number.isInteger(index) ? state.vehicles[index] : undefined;
  if (!s || !v || state.phase === 'ended') return false;
  const seat = seatFor(state, s, v);
  if (seat === undefined) return false;
  if (seat === 0) { v.driver = id; v.slack = maxSlack(v.kind); } else v.passenger = id;
  s.reloadLeft = 0; s.using = false; s.ads = false; s.sprint = false;
  seatSoldier(s, v, seat);
  ctx.emit({ type: 'vehicle', action: 'enter', vehicle: v.id, id, seat });
  return true;
}

/** E inside a vehicle: step out beside it on clear floor (pilots only below BAIL_HEIGHT). */
export function exitVehicle(state: MatchState, ctx: SimContext, id: number) {
  const s = state.soldiers.find(x => x.id === id);
  const seated = seatOf(state, id);
  if (!s || !seated) return false;
  const { vehicle: v, seat } = seated;
  const floor = ctx.world.groundHeight(v.x, v.z, v.y + 0.2, 0.5);
  if (v.kind === 'heli' && v.y - floor > BAIL_HEIGHT) return false;
  const p = exitSpot(ctx.world, v, seat, MOVE.radius);
  if (seat === 0) v.driver = -1; else v.passenger = -1;
  const ground = ctx.world.groundHeight(p.x, p.z, p.y + 0.05, MOVE.radius);
  s.m = createMoveState(p.x, p.y, p.z);
  s.m.grounded = p.y - ground < 0.05;
  s.groundY = Math.max(ground, p.y - 0.01); s.moveSlack = MOVE_SLACK.max;
  ctx.emit({ type: 'vehicle', action: 'exit', vehicle: v.id, id, seat });
  return true;
}

/** Put an occupant on its seat: position, the vehicle's velocity, sitting. */
export function seatSoldier(s: Soldier, v: Vehicle, seat: number) {
  const p = seatPosition(v, seat);
  const m = s.m;
  m.x = p.x; m.y = p.y; m.z = p.z; m.vx = v.vx; m.vy = v.vy; m.vz = v.vz;
  m.grounded = true; m.crouch = VEHICLES[v.kind].sit; m.airTime = 0; m.slideTime = 0;
  s.groundY = p.y; s.moveSlack = MOVE_SLACK.max; s.sprint = false; s.using = false;
}

/**
 * Accept the driver's report of its vehicle if it is plausible: the driver's own vehicle, within
 * the distance budget (top speed against server time), in bounds, clear of solid geometry, on the
 * floor for cars and scooters, under the ceiling for the helicopter (which lifts only once its
 * rotor has spun up), and not moving during the round-start freeze. A rejected report counts as a
 * correction and the client snaps back to the server's pose.
 */
export function reportVehicle(state: MatchState, ctx: SimContext, id: number, r: VehicleReport, elapsed: number) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || s.bot) return false;
  s.idle = 0;
  const v = Number.isInteger(r.vehicle) ? state.vehicles[r.vehicle] : undefined;
  if (!v || v.driver !== id || v.wrecked || !s.alive) return false;
  if (![r.x, r.y, r.z, r.vx, r.vy, r.vz, r.yaw, r.pitch, r.roll].every(Number.isFinite)) return false;
  const spec = VEHICLES[v.kind];
  const dt = clamp(elapsed, 0, 0.5);
  v.slack = Math.min(maxSlack(v.kind), v.slack + slackSpeed(v.kind) * dt);
  const moved = Math.hypot(r.x - v.x, r.y - v.y, r.z - v.z);
  const frozen = state.phase === 'live' && state.roundPhase === 'freeze' && !state.config.practice;
  const b = ctx.map.bounds;
  const pose = { kind: v.kind, x: r.x, y: r.y, z: r.z, yaw: r.yaw };
  let bad = moved > v.slack || (frozen && moved > 0.5)
    || r.x < b.minX - 1 || r.x > b.maxX + 1 || r.z < b.minZ - 1 || r.z > b.maxZ + 1
    || vehicleBlocked(ctx.world, pose);
  const floor = vehicleGround(ctx.world, { ...pose, y: r.y + 0.3 });
  if (v.kind === 'heli') {
    // No lift before the rotor has spun up, nothing above the ceiling.
    bad ||= r.y > HELI_CEILING + 0.5 || (v.rotor < 0.7 && r.y > v.y + 0.3) || r.y < floor - 0.4;
  } else {
    // Cars and scooters stay on the floor (they may drop off a ledge, never rise off it).
    bad ||= r.y < floor - 0.6 || (r.y > floor + 1.2 && !(r.vy < -0.5 && r.y <= v.y + 0.05));
  }
  if (bad) { s.corrections++; return false; }
  // Crash damage: velocity lost between two reports beyond what brakes and steering explain.
  const change = Math.hypot(r.vx - v.vx, (v.kind === 'heli' ? r.vy - v.vy : 0), r.vz - v.vz);
  const allowed = (spec.brake + spec.maxSpeed * spec.steer + spec.accel) * dt + 3;
  const crash = change - allowed;
  v.slack -= moved;
  const cap = Math.hypot(spec.maxSpeed, spec.climb) * 1.3, speed = Math.hypot(r.vx, r.vy, r.vz), k = speed > cap ? cap / speed : 1;
  v.x = r.x; v.y = r.y; v.z = r.z; v.vx = r.vx * k; v.vy = r.vy * k; v.vz = r.vz * k;
  v.yaw = r.yaw; v.pitch = clamp(r.pitch, -0.6, 0.6); v.roll = clamp(r.roll, -0.6, 0.6);
  v.grounded = v.y - floor < 0.1;
  s.yaw = r.yaw;
  if (crash > spec.crashSpeed) damageVehicle(state, ctx, v, id, (crash - spec.crashSpeed) * spec.crashDamage, 'crash');
  placeCrew(state, v);
  return true;
}

/** Keep the crew on their seats. */
function placeCrew(state: MatchState, v: Vehicle) {
  for (const [seat, id] of [[0, v.driver], [1, v.passenger]] as const) {
    const s = id >= 0 ? state.soldiers.find(x => x.id === id) : undefined;
    if (s) seatSoldier(s, v, seat);
  }
}

/**
 * Per tick: empty the seats of the dead and departed, simulate vehicles nobody drives (coasting
 * cars, a falling helicopter, wrecks), spin driven rotors up, seat the crews and run soldiers over.
 */
export function updateVehicles(state: MatchState, ctx: SimContext, dt: number) {
  if (state.vehicles.length !== (ctx.map.vehicles?.length ?? 0)) resetVehicles(state, ctx);
  if (!state.vehicles.length) return;
  const byId = new Map(state.soldiers.map(s => [s.id, s]));
  const seated = new Set<number>();
  for (const v of state.vehicles) {
    if (v.driver >= 0 && !byId.get(v.driver)?.alive) v.driver = -1;
    if (v.passenger >= 0 && !byId.get(v.passenger)?.alive) v.passenger = -1;
    if (v.driver >= 0) seated.add(v.driver);
    if (v.passenger >= 0) seated.add(v.passenger);
  }
  for (const v of state.vehicles) {
    if (v.driver < 0 || v.wrecked) {
      const resting = v.grounded && speedOf(v) < 0.02 && Math.abs(v.vy) < 0.02 && v.rotor === 0;
      if (!resting) {
        const e = stepVehicle(ctx.world, v, idleVehicleInput(v.yaw, false), dt);
        const spec = VEHICLES[v.kind];
        if (e.impact > spec.crashSpeed) damageVehicle(state, ctx, v, -1, (e.impact - spec.crashSpeed) * spec.crashDamage, 'crash');
        if (v.grounded && speedOf(v) < 0.05) { v.vx = 0; v.vz = 0; }
      }
    } else if (v.kind === 'heli') v.rotor = Math.min(1, v.rotor + dt / ROTOR_SPINUP);
    placeCrew(state, v);
    runOver(state, ctx, v, byId, seated);
  }
}

/** A driven vehicle at speed hurts enemy soldiers its body touches. */
function runOver(state: MatchState, ctx: SimContext, v: Vehicle, byId: Map<number, Soldier>, seated: Set<number>) {
  const spec = VEHICLES[v.kind];
  const speed = speedOf(v);
  if (v.wrecked || v.driver < 0 || !spec.runOver || speed < RUN_OVER_SPEED || state.time - v.lastRun < RUN_OVER_COOLDOWN) return;
  const driver = byId.get(v.driver);
  if (!driver) return;
  const f = forwardOf(v.yaw);
  for (const s of state.soldiers) {
    if (!s.alive || s.team === driver.team || seated.has(s.id)) continue;
    if (s.m.y < v.y - 1 || s.m.y > v.y + spec.height) continue;
    const hit = spec.circles.some(([o, r]) => Math.hypot(s.m.x - (v.x + f.x * o), s.m.z - (v.z + f.z * o)) < r + MOVE.radius);
    if (!hit) continue;
    v.lastRun = state.time;
    applyDamage(state, ctx, s, driver.id, (speed - RUN_OVER_SPEED) * spec.runOver + 10, 'body', { x: v.x, y: v.y + 0.5, z: v.z }, 'roadkill');
  }
}
