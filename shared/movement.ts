import { CollisionWorld, LADDER_DIRS } from './collision';
import { clamp } from './math';
import { obstacleGround, resolveObstacles, type Obstacle } from './obstacles';

/** Infantry movement tuned for a fast browser arena shooter. Shared by players and bots. */
export const MOVE = {
  radius: 0.38,
  standHeight: 1.8,
  crouchHeight: 1.2,
  eyeStand: 1.62,
  eyeCrouch: 1.05,
  walk: 6.2,
  sprint: 8.8,
  crouch: 3.1,
  ads: 3.6,
  backward: 0.82,
  groundAccel: 62,
  airAccel: 11,
  friction: 9,
  gravity: 21,
  jumpSpeed: 7.1,
  slideSpeed: 11.8,
  slideTime: 0.78,
  slideFriction: 2.6,
  slideCooldown: 0.45,
  coyote: 0.12,
  /** Ladder climbing speed, sideways shuffle on a ladder, and the push when jumping off one. */
  climb: 3.4,
  climbSide: 1.5,
  ladderPush: 4,
};

export interface MoveState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  grounded: boolean;
  /** 0 standing to 1 fully crouched (eases between). */
  crouch: number;
  slideTime: number;
  slideCooldown: number;
  airTime: number;
  prevCrouchInput: boolean;
  prevJumpInput: boolean;
}

export interface MoveInput {
  /** -1 back .. 1 forward */
  forward: number;
  /** -1 left .. 1 right */
  strafe: number;
  yaw: number;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  ads: boolean;
  /** Speed multiplier from the weapon in hand and attachments (BeGone movement %; default 1). */
  speed?: number;
}

export interface MoveEvents { jumped: boolean; landed: number; slideStarted: boolean; stepped: number }

export const idleInput = (yaw = 0): MoveInput => ({ forward: 0, strafe: 0, yaw, jump: false, crouch: false, sprint: false, ads: false });

export function createMoveState(x: number, y: number, z: number): MoveState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, grounded: true, crouch: 0, slideTime: 0, slideCooldown: 0, airTime: 0, prevCrouchInput: false, prevJumpInput: false };
}

export const eyeHeight = (s: Pick<MoveState, 'crouch'>) => MOVE.eyeStand + (MOVE.eyeCrouch - MOVE.eyeStand) * s.crouch;
export const bodyHeight = (s: Pick<MoveState, 'crouch'>) => MOVE.standHeight + (MOVE.crouchHeight - MOVE.standHeight) * s.crouch;
export const isSprinting = (s: MoveState, input: MoveInput) =>
  input.sprint && input.forward > 0.1 && !input.ads && s.slideTime <= 0 && s.crouch < 0.5;

/**
 * Advance one soldier by dt seconds. Mutates the state and returns feel events. `obstacles` are
 * moving solids (vehicles' bodies): they block like walls, carry their tops as floors, and push a
 * soldier out of their way (with a shove when they come fast).
 */
export function stepMovement(world: CollisionWorld, s: MoveState, input: MoveInput, dt: number, team = -1, obstacles?: readonly Obstacle[]): MoveEvents {
  const events: MoveEvents = { jumped: false, landed: 0, slideStarted: false, stepped: 0 };
  const speedH = Math.hypot(s.vx, s.vz);
  const crouchPressed = input.crouch && !s.prevCrouchInput;
  const jumpPressed = input.jump && !s.prevJumpInput;
  s.prevCrouchInput = input.crouch; s.prevJumpInput = input.jump;
  s.slideCooldown = Math.max(0, s.slideCooldown - dt);

  // Slide: crouch while sprinting on the ground converts momentum into a low, fast slide.
  if (crouchPressed && s.grounded && s.slideCooldown <= 0 && s.slideTime <= 0 && speedH > MOVE.walk + 0.6) {
    const boost = Math.max(speedH, MOVE.slideSpeed) / (speedH || 1);
    s.vx *= boost; s.vz *= boost; s.slideTime = MOVE.slideTime; events.slideStarted = true;
  }
  if (s.slideTime > 0) {
    s.slideTime -= dt;
    if (!input.crouch || Math.hypot(s.vx, s.vz) < 3.4) s.slideTime = 0;
    if (s.slideTime <= 0) { s.slideTime = 0; s.slideCooldown = MOVE.slideCooldown; }
  }

  // Crouch eases; standing up is blocked under low ceilings.
  let wantCrouch = input.crouch || s.slideTime > 0 ? 1 : 0;
  if (!wantCrouch && s.crouch > 0 && world.ceilingHeight(s.x, s.z, s.y, MOVE.radius) < s.y + MOVE.standHeight + 0.05) wantCrouch = 1;
  s.crouch = clamp(s.crouch + Math.sign(wantCrouch - s.crouch) * dt * 7, 0, 1);

  const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
  let fx = input.forward, sx = input.strafe;
  const len = Math.hypot(fx, sx);
  if (len > 1) { fx /= len; sx /= len; }
  // forward = (-sin, -cos), right = (cos, -sin)
  const wishX = -sin * fx + cos * sx, wishZ = -cos * fx - sin * sx;
  const sprinting = isSprinting(s, input);
  let maxSpeed = sprinting ? MOVE.sprint : input.ads ? MOVE.ads : MOVE.walk;
  if (s.crouch > 0) maxSpeed = Math.min(maxSpeed, maxSpeed + (MOVE.crouch * (input.ads ? 0.85 : 1) - maxSpeed) * s.crouch);
  if (fx < -0.1) maxSpeed *= MOVE.backward;
  maxSpeed *= input.speed ?? 1;

  // Ladders: moving toward one climbs, away from it climbs down, jumping lets go. Holding on stops
  // the fall; you can shuffle sideways, and near the top you step forward onto the landing.
  const ladder = world.ladderAt(s.x, s.y, s.z, MOVE.radius);
  let climbing = false;
  if (ladder) {
    const [nx, nz] = LADDER_DIRS[ladder.dir];
    const amount = Math.min(1, len), into = (wishX * nx + wishZ * nz) * amount, side = (wishZ * nx - wishX * nz) * amount;
    const climb = into > 0.3 ? 1 : into < -0.3 ? -1 : 0;
    if (jumpPressed && !s.grounded) {
      s.vx = -nx * MOVE.ladderPush; s.vz = -nz * MOVE.ladderPush; s.vy = MOVE.jumpSpeed * 0.5; events.jumped = true;
    } else if ((!s.grounded || climb > 0) && !(s.vy > 0 && s.vx * nx + s.vz * nz < -1)) {
      // (Rising away from the rungs is a jump off them: no grabbing back on until the arc turns.)
      climbing = true;
      const landing = climb > 0 && s.y > ladder.y1 - 0.6 ? MOVE.walk * 0.6 : 0;
      s.vy = climb * MOVE.climb;
      s.vx = -nz * side * MOVE.climbSide + nx * landing;
      s.vz = nx * side * MOVE.climbSide + nz * landing;
      s.slideTime = 0;
    }
  }

  if (climbing) {
    // Velocity set above.
  } else if (s.grounded && s.slideTime > 0) {
    // Sliding: low friction, light steering only.
    const sp = Math.hypot(s.vx, s.vz);
    const drop = Math.max(0, sp - MOVE.slideFriction * dt * (1 + sp * 0.12));
    if (sp > 0) { s.vx *= drop / sp; s.vz *= drop / sp; }
    s.vx += wishX * 4 * dt; s.vz += wishZ * 4 * dt;
  } else if (s.grounded) {
    const tx = wishX * maxSpeed, tz = wishZ * maxSpeed;
    const dx = tx - s.vx, dz = tz - s.vz;
    const dl = Math.hypot(dx, dz);
    // Faster deceleration than acceleration keeps strafes crisp.
    const accel = (len < 0.05 ? MOVE.friction * 7 : MOVE.groundAccel) * dt;
    if (dl <= accel) { s.vx = tx; s.vz = tz; }
    else { s.vx += dx / dl * accel; s.vz += dz / dl * accel; }
  } else {
    // Air control: steer toward the wish direction without exceeding the current or max speed.
    const cur = Math.hypot(s.vx, s.vz);
    s.vx += wishX * MOVE.airAccel * dt; s.vz += wishZ * MOVE.airAccel * dt;
    const next = Math.hypot(s.vx, s.vz), cap = Math.max(cur, maxSpeed);
    if (next > cap) { s.vx *= cap / next; s.vz *= cap / next; }
  }

  s.airTime = s.grounded || climbing ? 0 : s.airTime + dt;
  if (jumpPressed && !ladder && (s.grounded || s.airTime < MOVE.coyote) && s.crouch < 0.6) {
    s.vy = MOVE.jumpSpeed; s.grounded = false; s.airTime = MOVE.coyote; events.jumped = true;
    if (s.slideTime > 0) { s.slideTime = 0; s.slideCooldown = MOVE.slideCooldown; }
  }
  if (!climbing) s.vy -= MOVE.gravity * dt;

  // Horizontal sweep in substeps so fast slides cannot tunnel through thin cover.
  const height = bodyHeight(s);
  const travel = Math.hypot(s.vx, s.vz) * dt;
  const steps = Math.max(1, Math.ceil(travel / (MOVE.radius * 0.5)));
  const startX = s.x, startZ = s.z, startY = s.y;
  let blocked = false;
  let mover: Obstacle | undefined;
  for (let i = 0; i < steps; i++) {
    s.x += s.vx * dt / steps; s.z += s.vz * dt / steps;
    const pos = { x: s.x, y: s.y, z: s.z };
    // Vehicles first, the static world last: pinned between the two, the wall wins.
    const pusher = resolveObstacles(obstacles, pos, MOVE.radius, height);
    if (pusher) { blocked = true; if (Math.hypot(pusher.vx, pusher.vz) > 0.3) mover = pusher; }
    if (world.resolveCylinder(pos, MOVE.radius, height, team)) blocked = true;
    s.x = pos.x; s.z = pos.z;
    // Allow stepping onto low ledges mid-sweep.
    const g = Math.max(world.groundHeight(s.x, s.z, s.y, MOVE.radius), obstacleGround(obstacles, s.x, s.z, s.y, MOVE.radius));
    if (s.grounded && g > s.y && g <= s.y + 0.6) { events.stepped += g - s.y; s.y = g; }
  }
  // Blocked: the velocity is what the sweep actually moved (a vehicle pushing us lends us its own).
  if (blocked && dt > 0) { s.vx = (s.x - startX) / dt; s.vz = (s.z - startZ) / dt; }
  if (mover) {
    // A moving vehicle pushes us aside, off its line (never just along ahead of its bumper); a
    // fast one (a run-over) knocks us off our feet too.
    const speed = Math.hypot(mover.vx, mover.vz), ux = mover.vx / speed, uz = mover.vz / speed;
    const side = Math.sign((s.x - mover.x) * -uz + (s.z - mover.z) * ux) || 1;
    const lx = -uz * side, lz = ux * side, aside = s.vx * lx + s.vz * lz, want = speed * 0.6;
    if (aside < want) { s.vx += lx * (want - aside); s.vz += lz * (want - aside); }
    if (mover.shove > 0) { s.vy = Math.max(s.vy, mover.shove); s.grounded = false; s.slideTime = 0; }
  }
  if (climbing && ladder && s.y < ladder.y1 - 0.6) {
    // Below the landing a climber stays in front of the rungs, never under a deck the ladder leans on.
    const [nx, nz] = LADDER_DIRS[ladder.dir];
    const depth = (s.x - ladder.x) * nx + (s.z - ladder.z) * nz + MOVE.radius;
    if (depth > 0) { s.x -= nx * depth; s.z -= nz * depth; }
  }

  // Vertical: land, snap down small steps and slopes, bump ceilings.
  const wasGrounded = s.grounded;
  const fallSpeed = -s.vy;
  s.y += s.vy * dt;
  const ground = Math.max(world.groundHeight(s.x, s.z, Math.max(s.y, startY), MOVE.radius), obstacleGround(obstacles, s.x, s.z, Math.max(s.y, startY), MOVE.radius));
  if (s.y <= ground) {
    if (!wasGrounded && fallSpeed > 1) events.landed = fallSpeed;
    s.y = ground; s.vy = 0; s.grounded = true;
  } else if (wasGrounded && s.vy <= 0 && s.y - ground < 0.65) {
    s.y = ground; s.vy = 0; s.grounded = true;
  } else {
    s.grounded = false;
  }
  if (s.vy > 0) {
    const ceiling = world.ceilingHeight(s.x, s.z, s.y, MOVE.radius);
    if (s.y + height > ceiling) { s.y = ceiling - height; s.vy = 0; }
  }
  return events;
}
