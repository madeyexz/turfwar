import type { CollisionWorld } from './collision';
import { clamp, wrapAngle, type Vec3 } from './math';

/**
 * Drivable vehicles: arcade physics shared by the driver's client (prediction), Solo and the
 * SpacetimeDB module (driverless vehicles, validation). Cars and scooters drive on the floor under
 * them (terrain, solids' tops, ramps) and never flip; the helicopter hovers, climbs and descends.
 * Bodies collide with the static world as a row of vertical cylinders along their length.
 *
 * Local axes follow the soldiers': yaw 0 faces -Z; forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw).
 */
export type VehicleKind = 'car' | 'scooter' | 'heli';
export const VEHICLE_KINDS: VehicleKind[] = ['car', 'scooter', 'heli'];

/** A seat: feet position in the vehicle's local frame (x right, y up, z forward). */
export interface Seat { x: number; y: number; z: number }

export interface VehicleSpec {
  /** HUD and prompt words. */
  name: string; verb: string;
  health: number;
  /** Top speeds (m/s): forward, reverse (heli: backward), heli strafe; climb and descent for the heli. */
  maxSpeed: number; reverse: number; strafe: number; climb: number; descend: number;
  /** Acceleration, braking and coasting deceleration (m/s²). */
  accel: number; brake: number; drag: number;
  /** Highest yaw rate (rad/s) and how fast sideways slip dies (1/s). */
  steer: number; grip: number;
  /** Collision cylinders along the body: [forward offset, radius]; their height. */
  circles: [number, number][]; height: number;
  /** Hit box (oriented by yaw): half width, half length, height, bottom above the floor, centre's forward offset. */
  box: { w: number; l: number; h: number; y0: number; c: number };
  /** Driver first, then the passenger. */
  seats: Seat[];
  /** Occupants' crouch (sitting) value. */
  sit: number;
  /** How close (m, from the body) a soldier must be to get in. */
  reach: number;
  /** Riders can be shot directly (scooters); otherwise the body takes the hits. */
  exposed: boolean;
  /** Damage per m/s above RUN_OVER_SPEED to a soldier it hits (0: none). */
  runOver: number;
  /** Speed lost in one impact above which the body takes crash damage, and damage per m/s beyond it. */
  crashSpeed: number; crashDamage: number;
  /**
   * Handbrake drift (cars and scooters): lateral grip while sliding (fraction of `grip`), how much
   * of the body's turn the velocity follows while sliding (1 = none of the slide), the yaw-rate
   * boost of a handbrake turn, and how fast the locked wheels bleed speed (m/s²).
   */
  drift: { grip: number; follow: number; yaw: number; bleed: number };
  /** The driver has a hand free to shoot one-handed weapons (pistols and SMGs) while riding. */
  driverArms: boolean;
}

export const VEHICLES: Record<VehicleKind, VehicleSpec> = {
  car: {
    name: 'CAR', verb: 'DRIVE', health: 520,
    maxSpeed: 26, reverse: 8, strafe: 0, climb: 0, descend: 0,
    accel: 8.5, brake: 20, drag: 2.4, steer: 1.45, grip: 9,
    circles: [[1.35, 0.92], [0, 0.92], [-1.35, 0.92]], height: 1.5,
    box: { w: 0.92, l: 2.25, h: 1.42, y0: 0.14, c: 0 },
    seats: [{ x: -0.4, y: 0.14, z: -0.05 }, { x: 0.4, y: 0.14, z: -0.05 }], sit: 1,
    reach: 2.2, exposed: false, runOver: 7, crashSpeed: 11, crashDamage: 14,
    drift: { grip: 0.14, follow: 0.3, yaw: 1.7, bleed: 3.5 }, driverArms: false,
  },
  scooter: {
    name: 'SCOOTER', verb: 'RIDE', health: 160,
    maxSpeed: 21, reverse: 2.5, strafe: 0, climb: 0, descend: 0,
    accel: 9.5, brake: 17, drag: 2, steer: 2.3, grip: 11,
    circles: [[0.45, 0.42], [-0.45, 0.42]], height: 1.2,
    box: { w: 0.3, l: 0.92, h: 0.95, y0: 0.08, c: 0 },
    seats: [{ x: 0, y: 0.32, z: 0.02 }, { x: 0, y: 0.36, z: -0.5 }], sit: 0.75,
    reach: 1.6, exposed: true, runOver: 3.5, crashSpeed: 10, crashDamage: 6,
    drift: { grip: 0.32, follow: 0.55, yaw: 1.35, bleed: 3 }, driverArms: true,
  },
  heli: {
    name: 'HELICOPTER', verb: 'FLY', health: 800,
    maxSpeed: 34, reverse: 12, strafe: 16, climb: 9, descend: 8,
    accel: 10, brake: 10, drag: 1.2, steer: 1.8, grip: 3,
    circles: [[1.0, 1.15], [-0.6, 1.15], [-2.5, 0.6], [-4.2, 0.6]], height: 2.6,
    box: { w: 1.05, l: 3.2, h: 2.3, y0: 0.3, c: -1.2 },
    seats: [{ x: -0.4, y: 0.4, z: 0.85 }, { x: 0.4, y: 0.4, z: 0.85 }], sit: 1,
    reach: 2.4, exposed: false, runOver: 0, crashSpeed: 7, crashDamage: 26,
    drift: { grip: 1, follow: 1, yaw: 1, bleed: 0 }, driverArms: false,
  },
};

/** Highest the helicopter climbs (absolute metres). */
export const HELI_CEILING = 160;
/** Heli rotor disc radius (visual; the rotor does not collide). */
export const ROTOR_RADIUS = 5.2;
/** A driven vehicle hurts soldiers in its path above this speed (m/s). */
export const RUN_OVER_SPEED = 6;
/** Seconds the heli rotor takes to spin up before it lifts. */
export const ROTOR_SPINUP = 1.6;
const GRAVITY = 21;

/** Where a map parks a vehicle at round start. */
export interface VehicleSpot { kind: VehicleKind; x: number; y: number; z: number; yaw: number }

export interface Vehicle {
  /** Index of the map's spot this vehicle started from (stable for the match). */
  id: number;
  kind: VehicleKind;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Heading, and the body's visual nose-up pitch and right-down roll (radians). */
  yaw: number; pitch: number; roll: number;
  /** Current steering (-1 left .. 1 right) and rotor spin (0..1). */
  steer: number; rotor: number;
  grounded: boolean;
  health: number;
  /** Soldier ids in the seats, or -1. */
  driver: number; passenger: number;
  wrecked: boolean;
  /** Server bookkeeping: distance budget for driver reports, last attacker, last run-over hit time. */
  slack: number; lastAttacker: number; lastRun: number;
}

export interface VehicleInput {
  /** W/S: -1 brake/reverse (heli: back) .. 1 throttle (heli: forward). */
  throttle: number;
  /** A/D: -1 left .. 1 right (heli: strafe). */
  steer: number;
  /** Space: handbrake. */
  brake: boolean;
  /** Heli: -1 descend (C/Ctrl) .. 1 climb (Space). */
  lift: number;
  /** Heli: heading to turn toward (the camera's yaw). */
  yaw: number;
  /** A pilot is aboard (rotor spins up, controls work). */
  engine: boolean;
}

export const idleVehicleInput = (yaw = 0, engine = false): VehicleInput => ({ throttle: 0, steer: 0, brake: false, lift: 0, yaw, engine });

export interface VehicleEvents { impact: number; landed: number }

export function createVehicle(id: number, spot: VehicleSpot): Vehicle {
  const spec = VEHICLES[spot.kind];
  return {
    id, kind: spot.kind, x: spot.x, y: spot.y, z: spot.z, vx: 0, vy: 0, vz: 0, yaw: spot.yaw, pitch: 0, roll: 0,
    steer: 0, rotor: 0, grounded: true, health: spec.health, driver: -1, passenger: -1, wrecked: false,
    slack: maxSlack(spot.kind), lastAttacker: -1, lastRun: -9,
  };
}

/** Distance budget for client-reported vehicle movement (like MOVE_SLACK): refill speed and cap. */
export const slackSpeed = (kind: VehicleKind) => { const s = VEHICLES[kind]; return Math.hypot(s.maxSpeed, s.climb) * 1.2 + 2; };
export const maxSlack = (kind: VehicleKind) => slackSpeed(kind) * 0.7;

export const forwardOf = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
export const rightOf = (yaw: number) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });

/** World position of a point given in the vehicle's local frame (yaw only). */
export function localToWorld(v: Pick<Vehicle, 'x' | 'y' | 'z' | 'yaw'>, p: Seat): Vec3 {
  const f = forwardOf(v.yaw), r = rightOf(v.yaw);
  return { x: v.x + r.x * p.x + f.x * p.z, y: v.y + p.y, z: v.z + r.z * p.x + f.z * p.z };
}

/** Feet position of a seat (0 driver, 1 passenger). */
export const seatPosition = (v: Pick<Vehicle, 'kind' | 'x' | 'y' | 'z' | 'yaw'>, seat: number) => localToWorld(v, VEHICLES[v.kind].seats[seat] ?? VEHICLES[v.kind].seats[0]);

export const speedOf = (v: Pick<Vehicle, 'vx' | 'vy' | 'vz'>) => Math.hypot(v.vx, v.vz);

/** Highest floor under any of the body's cylinders (step-up of `step` from its current height). */
export function vehicleGround(world: CollisionWorld, v: Pick<Vehicle, 'kind' | 'x' | 'y' | 'z' | 'yaw'>, step = 0.6) {
  const spec = VEHICLES[v.kind], f = forwardOf(v.yaw);
  let best = -Infinity;
  for (const [o, r] of spec.circles) best = Math.max(best, world.groundHeight(v.x + f.x * o, v.z + f.z * o, v.y, r * 0.8, step));
  return best;
}

/** Push the body's cylinders out of solids. Returns the total push (zero when clear). */
function resolveBody(world: CollisionWorld, v: Vehicle, spec: VehicleSpec) {
  const f = forwardOf(v.yaw);
  let px = 0, pz = 0;
  for (const [o, r] of spec.circles) {
    const cx = v.x + f.x * o, cz = v.z + f.z * o;
    const pos = { x: cx, y: v.y, z: cz };
    world.resolveCylinder(pos, r, spec.height);
    const dx = pos.x - cx, dz = pos.z - cz;
    if (dx || dz) { v.x += dx; v.z += dz; px += dx; pz += dz; }
  }
  return { x: px, z: pz };
}

/** True when the body overlaps static geometry (validation; small margin for float noise). */
export function vehicleBlocked(world: CollisionWorld, v: Pick<Vehicle, 'kind' | 'x' | 'y' | 'z' | 'yaw'>) {
  const spec = VEHICLES[v.kind], f = forwardOf(v.yaw);
  return spec.circles.some(([o, r]) => world.overlapsSolid({ x: v.x + f.x * o, y: v.y, z: v.z + f.z * o }, r * 0.6, spec.height * 0.8));
}

const approach = (value: number, target: number, rate: number) => value < target ? Math.min(target, value + rate) : Math.max(target, value - rate);

/** Advance one vehicle by dt seconds under `input`. Mutates it and returns impact events. */
export function stepVehicle(world: CollisionWorld, v: Vehicle, input: VehicleInput, dt: number): VehicleEvents {
  const events: VehicleEvents = { impact: 0, landed: 0 };
  if (dt <= 0) return events;
  const spec = VEHICLES[v.kind];
  const heli = v.kind === 'heli';
  const live = input.engine && !v.wrecked;
  if (heli) stepHeliForces(v, spec, input, live, dt);
  else stepGroundForces(v, spec, input, live, dt);

  // Sweep in substeps so fast vehicles cannot tunnel through thin walls.
  const travel = Math.hypot(v.vx, v.vy, v.vz) * dt;
  const steps = Math.max(1, Math.ceil(travel / 0.3));
  const h = dt / steps;
  const startY = v.y;
  let pushX = 0, pushZ = 0;
  for (let i = 0; i < steps; i++) {
    v.x += v.vx * h; v.z += v.vz * h;
    const push = resolveBody(world, v, spec);
    pushX += push.x; pushZ += push.z;
    if (!heli && v.grounded) {
      // Kerbs and low steps lift the body as it rolls over them.
      const g = vehicleGround(world, v);
      if (g > v.y && g <= v.y + 0.6) v.y = g;
    }
  }
  const pushed = Math.hypot(pushX, pushZ);
  if (pushed > 1e-6) {
    // Hit a wall: lose the speed into it (with a little bounce) and some of the rest.
    const nx = pushX / pushed, nz = pushZ / pushed, vn = v.vx * nx + v.vz * nz;
    if (vn < 0) {
      events.impact = -vn;
      v.vx -= nx * vn * 1.25; v.vz -= nz * vn * 1.25;
      const keep = 1 - Math.min(0.5, -vn * 0.03);
      v.vx *= keep; v.vz *= keep;
    }
  }

  // Vertical: gravity (the heli's lift is in its forces), landing and floors.
  const wasGrounded = v.grounded;
  const fall = -v.vy;
  v.y += v.vy * dt;
  const ground = vehicleGround(world, { ...v, y: Math.max(v.y, startY) });
  if (v.y <= ground) {
    if (!wasGrounded && fall > 2) events.landed = fall;
    v.y = ground; v.vy = Math.max(0, v.vy); v.grounded = true;
  } else if (!heli && wasGrounded && v.vy <= 0 && v.y - ground < 0.7) {
    v.y = ground; v.vy = 0; v.grounded = true;
  } else v.grounded = heli ? v.y - ground < 0.05 : false;
  if (heli) {
    if (v.vy > 0) {
      let ceiling = Infinity;
      const f = forwardOf(v.yaw);
      for (const [o, r] of spec.circles) ceiling = Math.min(ceiling, world.ceilingHeight(v.x + f.x * o, v.z + f.z * o, v.y, r));
      if (v.y + spec.height > ceiling) { v.y = ceiling - spec.height; v.vy = 0; }
    }
    if (v.y > HELI_CEILING) { v.y = HELI_CEILING; v.vy = Math.min(0, v.vy); }
  }
  if (events.landed > 0) events.impact = Math.max(events.impact, events.landed * (heli ? 1 : 0.5));
  attitude(world, v, spec, dt);
  return events;
}

function stepGroundForces(v: Vehicle, spec: VehicleSpec, input: VehicleInput, live: boolean, dt: number) {
  const f = forwardOf(v.yaw), r = rightOf(v.yaw);
  let vf = v.vx * f.x + v.vz * f.z, vr = v.vx * r.x + v.vz * r.z;
  const throttle = live ? clamp(input.throttle, -1, 1) : 0;
  v.steer = approach(v.steer, live ? clamp(input.steer, -1, 1) : 0, dt * 4);
  if (v.grounded) {
    if (throttle > 0.05) {
      vf = vf < -0.3 ? Math.min(0, vf + spec.brake * dt) : Math.min(spec.maxSpeed, vf + spec.accel * throttle * dt * (1 - 0.7 * (Math.max(0, vf) / spec.maxSpeed) ** 2));
    } else if (throttle < -0.05) {
      vf = vf > 0.3 ? Math.max(0, vf - spec.brake * dt) : Math.max(-spec.reverse, vf - spec.accel * 0.6 * -throttle * dt);
    } else vf = approach(vf, 0, spec.drag * dt);
    const handbrake = live && input.brake;
    // Locked rear wheels bleed speed gently (the handbrake is for sliding, W/S brake hard).
    if (handbrake) vf = approach(vf, 0, spec.drift.bleed * dt);
    vf -= vf * Math.abs(vf) * 0.0015 * dt;
    const slide = slideOf(spec, vf, vr, handbrake);
    // Steering turns the body; reversing steers the other way, and grip drops at speed. A handbrake
    // turn swings the tail round faster.
    const sf = clamp(vf / 5, -1, 1) * (1 - 0.4 * clamp(Math.abs(vf) / spec.maxSpeed, 0, 1));
    const turn = v.steer * spec.steer * sf * dt * (handbrake ? spec.drift.yaw : 1);
    // Gripping tyres carry the velocity round with the body; sliding ones let the body turn under
    // it (the slip angle grows), until grip pulls the velocity back in line or counter-steer
    // swings the nose back toward it.
    const follow = 1 + (spec.drift.follow - 1) * slide;
    const carry = v.yaw - turn * follow;
    const cf = forwardOf(carry), cr = rightOf(carry);
    const wx = cf.x * vf + cr.x * vr, wz = cf.z * vf + cr.z * vr;
    v.yaw = wrapAngle(v.yaw - turn);
    const nf = forwardOf(v.yaw), nr = rightOf(v.yaw);
    vf = wx * nf.x + wz * nf.z; vr = wx * nr.x + wz * nr.z;
    vr *= Math.exp(-spec.grip * (1 + (spec.drift.grip - 1) * slide) * dt);
    v.vx = nf.x * vf + nr.x * vr; v.vz = nf.z * vf + nr.z * vr;
    // Throttle on a sideways body never pushes the speed past the top speed.
    const speed = Math.hypot(v.vx, v.vz);
    if (speed > spec.maxSpeed) { v.vx *= spec.maxSpeed / speed; v.vz *= spec.maxSpeed / speed; }
  }
  v.vy -= GRAVITY * dt;
}

/**
 * How much the tyres slide (0 gripping .. 1 sliding): fully with the handbrake on; otherwise the
 * slip angle (between heading and velocity) of a moving body loosens them part of the way, so a
 * drift released at a big angle slides on for a moment before it catches.
 */
function slideOf(spec: VehicleSpec, vf: number, vr: number, handbrake: boolean) {
  if (handbrake) return 1;
  const speed = Math.hypot(vf, vr);
  if (speed < 3) return 0;
  const slip = Math.atan2(Math.abs(vr), Math.abs(vf));
  return 0.6 * clamp((slip - 0.1) / 0.4, 0, 1) * clamp((speed - 3) / 4, 0, 1);
}

/** Signed slip angle (radians) between the heading and the ground velocity; positive slides right. */
export function slipAngle(v: Pick<Vehicle, 'vx' | 'vz' | 'yaw'>) {
  const f = forwardOf(v.yaw), r = rightOf(v.yaw);
  const vf = v.vx * f.x + v.vz * f.z, vr = v.vx * r.x + v.vz * r.z;
  return Math.hypot(vf, vr) < 0.5 ? 0 : Math.atan2(vr, Math.abs(vf));
}

/**
 * Tyre skid (0..1) of a car or scooter for effects: a sliding body at speed, or locked wheels
 * dragged along with the handbrake (`braking`, known only for the vehicle we drive).
 */
export function skidOf(v: Pick<Vehicle, 'kind' | 'vx' | 'vz' | 'yaw' | 'grounded'>, braking = false) {
  if (v.kind === 'heli' || !v.grounded) return 0;
  const speed = Math.hypot(v.vx, v.vz);
  const slide = clamp((Math.abs(slipAngle(v)) - 0.12) / 0.3, 0, 1) * clamp((speed - 4) / 5, 0, 1);
  return Math.max(slide, braking ? clamp((speed - 3) / 8, 0, 0.7) : 0);
}

function stepHeliForces(v: Vehicle, spec: VehicleSpec, input: VehicleInput, live: boolean, dt: number) {
  v.rotor = approach(v.rotor, live ? 1 : 0, dt / (live ? ROTOR_SPINUP : 4));
  const lift = v.rotor >= 0.95 && live;
  if (lift) {
    // Heading follows the pilot's view; the stick moves the body relative to it.
    const dy = wrapAngle(input.yaw - v.yaw);
    v.yaw = wrapAngle(v.yaw + clamp(dy, -spec.steer * dt, spec.steer * dt));
    const f = forwardOf(v.yaw), r = rightOf(v.yaw);
    const t = clamp(input.throttle, -1, 1), s = clamp(input.steer, -1, 1);
    const wantF = t >= 0 ? t * spec.maxSpeed : t * spec.reverse, wantR = s * spec.strafe;
    const tx = f.x * wantF + r.x * wantR, tz = f.z * wantF + r.z * wantR;
    const dx = tx - v.vx, dz = tz - v.vz, dl = Math.hypot(dx, dz), a = spec.accel * dt;
    if (dl <= a) { v.vx = tx; v.vz = tz; } else { v.vx += dx / dl * a; v.vz += dz / dl * a; }
    const l = clamp(input.lift, -1, 1);
    const wantY = l >= 0 ? l * spec.climb : l * spec.descend;
    v.vy = approach(v.vy, wantY, 14 * dt);
  } else {
    // Unpowered (spinning up, pilotless or wrecked): it drops, and skids to a halt on the ground.
    v.vy -= GRAVITY * (v.rotor > 0.5 && !v.wrecked ? 0.45 : 1) * dt;
    const k = Math.exp(-(v.grounded ? 4 : spec.drag * 0.3) * dt);
    v.vx *= k; v.vz *= k;
  }
  if (v.grounded && !lift) { v.vx *= Math.exp(-6 * dt); v.vz *= Math.exp(-6 * dt); }
}

/** Visual pitch and roll: ground vehicles follow the floor and lean into turns; the heli banks with its velocity. */
function attitude(world: CollisionWorld, v: Vehicle, spec: VehicleSpec, dt: number) {
  const f = forwardOf(v.yaw), r = rightOf(v.yaw);
  const vf = v.vx * f.x + v.vz * f.z, vr = v.vx * r.x + v.vz * r.z;
  let pitch = 0, roll = 0;
  if (v.kind === 'heli') {
    pitch = v.grounded ? 0 : -0.26 * clamp(vf / spec.maxSpeed, -1, 1);
    roll = v.grounded ? 0 : 0.3 * clamp(vr / spec.strafe, -1, 1);
  } else {
    const [front] = spec.circles[0], [back] = spec.circles[spec.circles.length - 1];
    if (v.grounded) {
      const hf = world.groundHeight(v.x + f.x * front, v.z + f.z * front, v.y + 0.3, 0.2, 0.9);
      const hb = world.groundHeight(v.x + f.x * back, v.z + f.z * back, v.y + 0.3, 0.2, 0.9);
      pitch = clamp(Math.atan2(hf - hb, front - back), -0.4, 0.4);
    } else pitch = v.pitch;
    const lean = v.kind === 'scooter' ? 0.42 : -0.05;
    roll = lean * v.steer * clamp(Math.abs(vf) / 10, 0, 1) * Math.sign(vf || 1);
  }
  const k = 1 - Math.exp(-8 * dt);
  v.pitch += (pitch - v.pitch) * k;
  v.roll += (roll - v.roll) * k;
}

/**
 * Ray against the vehicle's hit box (rotated by yaw only). Returns the distance, or -1.
 * `pad` grows the box (validation tolerance).
 */
export function raycastVehicle(o: Vec3, d: Vec3, v: Pick<Vehicle, 'kind' | 'x' | 'y' | 'z' | 'yaw'>, pad = 0) {
  const b = VEHICLES[v.kind].box;
  const f = forwardOf(v.yaw), r = rightOf(v.yaw);
  const cx = v.x + f.x * b.c, cz = v.z + f.z * b.c;
  // Into the box's frame: u along right, w along forward.
  const ox = o.x - cx, oz = o.z - cz;
  const lo = [ox * r.x + oz * r.z, o.y - v.y, ox * f.x + oz * f.z];
  const ld = [d.x * r.x + d.z * r.z, d.y, d.x * f.x + d.z * f.z];
  const min = [-b.w - pad, b.y0 - pad, -b.l - pad], max = [b.w + pad, b.y0 + b.h + pad, b.l + pad];
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(ld[a]) < 1e-12) { if (lo[a] < min[a] || lo[a] > max[a]) return -1; continue; }
    let ta = (min[a] - lo[a]) / ld[a], tb = (max[a] - lo[a]) / ld[a];
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}

/** Distance from a point to the vehicle's hit box (0 inside). */
export function vehicleBoxDistance(p: Vec3, v: Pick<Vehicle, 'kind' | 'x' | 'y' | 'z' | 'yaw'>) {
  const b = VEHICLES[v.kind].box;
  const f = forwardOf(v.yaw), r = rightOf(v.yaw);
  const ox = p.x - (v.x + f.x * b.c), oz = p.z - (v.z + f.z * b.c);
  const u = ox * r.x + oz * r.z, w = ox * f.x + oz * f.z, y = p.y - v.y;
  const du = Math.max(0, Math.abs(u) - b.w), dw = Math.max(0, Math.abs(w) - b.l);
  const dy = Math.max(0, b.y0 - y, y - (b.y0 + b.h));
  return Math.hypot(du, dw, dy);
}

/** Centre of the hit box (explosions, effects). */
export function vehicleCenter(v: Pick<Vehicle, 'kind' | 'x' | 'y' | 'z' | 'yaw'>): Vec3 {
  const b = VEHICLES[v.kind].box, f = forwardOf(v.yaw);
  return { x: v.x + f.x * b.c, y: v.y + b.y0 + b.h / 2, z: v.z + f.z * b.c };
}

/**
 * Where a soldier leaving the vehicle stands: beside the driver's door first, then the other side,
 * behind and in front; on clear floor in reach of the body (never through a wall). Falls back to
 * the roof.
 */
export function exitSpot(world: CollisionWorld, v: Pick<Vehicle, 'kind' | 'x' | 'y' | 'z' | 'yaw'>, seat: number, radius = 0.38, height = 1.8): Vec3 {
  const spec = VEHICLES[v.kind];
  const side = spec.box.w + radius + 0.35, end = spec.box.l + radius + 0.4;
  const first = seat === 1 ? 1 : -1;
  const candidates: [number, number][] = [
    [first * side, 0], [-first * side, 0], [0, spec.box.c - end], [0, spec.box.c + end],
    [first * side, -spec.box.l * 0.7], [-first * side, -spec.box.l * 0.7], [first * side * 1.6, 0], [-first * side * 1.6, 0],
  ];
  const b = world.bounds;
  const from = { x: v.x, y: v.y + 1, z: v.z };
  for (const [lx, lz] of candidates) {
    const p = localToWorld(v, { x: lx, y: 0, z: lz });
    if (p.x < b.minX + 0.5 || p.x > b.maxX - 0.5 || p.z < b.minZ + 0.5 || p.z > b.maxZ - 0.5) continue;
    const floor = world.groundHeight(p.x, p.z, v.y + 0.6, radius);
    // In flight there is no floor next to the door: the soldier drops from the seat's height.
    const y = v.y - floor > 1.2 ? v.y : floor;
    if (world.overlapsSolid({ x: p.x, y: y + 0.05, z: p.z }, radius, height)) continue;
    if (!world.lineOfSight(from, { x: p.x, y: y + 1, z: p.z })) continue;
    return { x: p.x, y, z: p.z };
  }
  return { x: v.x, y: v.y + spec.box.y0 + spec.box.h + 0.05, z: v.z };
}

/** Distance from a soldier's feet to the vehicle body, for getting in (ignores height within reach). */
export function reachOf(v: Pick<Vehicle, 'kind' | 'x' | 'y' | 'z' | 'yaw'>, p: Vec3) {
  const dy = p.y - v.y;
  if (dy < -1.5 || dy > 2.5) return Infinity;
  return vehicleBoxDistance({ x: p.x, y: v.y + VEHICLES[v.kind].box.y0 + 0.2, z: p.z }, v);
}
