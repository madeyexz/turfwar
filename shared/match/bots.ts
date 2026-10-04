import { chestPoint } from '../hitbox';
import { clamp, dirFromAngles, wrapAngle, type Vec3 } from '../math';
import { MOVE, eyeHeight, stepMovement, type MoveInput } from '../movement';
import { GRENADE } from '../weapons';
import { eyeOf, feetOf, resolveShot, spreadFor, throwGrenadeFrom, traceShot, weaponOf, type SimContext } from './combat';
import { findPath, nearestNode } from './nav';
import type { BotBrain, MatchState, Soldier } from './state';

const CALLSIGNS = [
  'Halcyon', 'Vex', 'Marrow', 'Kestrel', 'Onyx', 'Sable', 'Rook', 'Cinder', 'Talon', 'Wren', 'Juno', 'Brask',
  'Ember', 'Quill', 'Nyx', 'Dagger', 'Lumen', 'Shrike', 'Vesper', 'Atlas', 'Mako', 'Pike', 'Orrin', 'Zephyr',
];

export function botName(state: MatchState, random: () => number) {
  const used = new Set(state.soldiers.map(s => s.name));
  for (let i = 0; i < 40; i++) {
    const name = CALLSIGNS[Math.floor(random() * CALLSIGNS.length)];
    if (!used.has(name)) return name;
  }
  return `Unit-${state.nextId}`;
}

export function createBrain(skill: number): BotBrain {
  return {
    skill, goal: '', goalX: 0, goalZ: 0, path: [], pathIndex: 0, repath: 0, target: -1, reaction: 0, lastSeen: -99,
    seenX: 0, seenY: 0, seenZ: 0, aimYaw: 0, aimPitch: 0, errYaw: 0, errPitch: 0, strafe: 1, strafeLeft: 0,
    crouchLeft: 0, burst: 0, burstPause: 0, stuck: 0, lastX: 0, lastZ: 0, think: 0, grenadeCooldown: 6, jump: false,
  };
}

const yawTo = (from: Vec3, to: Vec3) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
const pitchTo = (from: Vec3, to: Vec3) => Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z));

/** Choose which capture point this bot should work on. */
function chooseGoal(state: MatchState, ctx: SimContext, bot: Soldier, brain: BotBrain) {
  let best = state.points[0], bestScore = -Infinity;
  for (const p of state.points) {
    const def = ctx.map.points.find(d => d.id === p.id)!;
    const distance = Math.hypot(def.x - bot.m.x, def.z - bot.m.z);
    let score = (p.owner !== bot.team ? 1.1 : 0.25) + (p.contested ? 0.7 : 0) + (p.capturing !== -1 && p.capturing !== bot.team ? 0.9 : 0);
    score += p.id === 'B' ? 0.25 : 0;
    score -= distance / 140;
    // Spread the team out: discourage piling onto one point.
    const mates = state.soldiers.filter(s => s.bot && s.team === bot.team && s.id !== bot.id && s.brain?.goal === p.id).length;
    score -= mates * 0.18;
    score += ctx.random() * 0.45;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  const def = ctx.map.points.find(d => d.id === best.id)!;
  const angle = ctx.random() * Math.PI * 2, r = ctx.random() * def.radius * 0.7;
  brain.goal = best.id; brain.goalX = def.x + Math.cos(angle) * r; brain.goalZ = def.z + Math.sin(angle) * r;
  brain.repath = 0;
}

function plan(ctx: SimContext, bot: Soldier, brain: BotBrain, tx: number, ty: number, tz: number) {
  if (!ctx.nav) return;
  const start = nearestNode(ctx.nav, bot.m.x, bot.m.y, bot.m.z);
  const goal = nearestNode(ctx.nav, tx, ty, tz);
  brain.path = findPath(ctx.nav, start, goal);
  brain.pathIndex = brain.path.length > 1 ? 1 : 0;
}

/** Find the most pressing visible enemy. */
function perceive(state: MatchState, ctx: SimContext, bot: Soldier, brain: BotBrain) {
  const eye = eyeOf(bot);
  let best: Soldier | undefined, bestScore = Infinity;
  for (const s of state.soldiers) {
    if (!s.alive || s.team === bot.team) continue;
    const dx = s.m.x - bot.m.x, dz = s.m.z - bot.m.z;
    const d = Math.hypot(dx, dz);
    if (d > 95) continue;
    const facing = Math.abs(wrapAngle(yawTo(eye, s.m) - bot.yaw));
    const recentlyHit = bot.lastAttacker === s.id && bot.sinceHit < 2;
    if (facing > 1.25 && d > 11 && !recentlyHit) continue;
    const chest = chestPoint(feetOf(s), s.m.crouch);
    const head = { x: s.m.x, y: s.m.y + eyeHeight(s.m), z: s.m.z };
    if (!ctx.world.lineOfSight(eye, chest, bot.team) && !ctx.world.lineOfSight(eye, head, bot.team)) continue;
    const score = d * (facing > 1.25 ? 1.6 : 1) * (s.id === brain.target ? 0.7 : 1) * (recentlyHit ? 0.5 : 1);
    if (score < bestScore) { bestScore = score; best = s; }
  }
  return best;
}

export function updateBot(state: MatchState, ctx: SimContext, bot: Soldier, dt: number) {
  const brain = bot.brain!;
  if (!bot.alive || dt <= 0) return;
  brain.think -= dt; brain.repath -= dt; brain.strafeLeft -= dt; brain.crouchLeft -= dt;
  brain.burstPause -= dt; brain.grenadeCooldown -= dt; brain.reaction -= dt;

  // ---- Perception -----------------------------------------------------------------
  let target = state.soldiers.find(s => s.id === brain.target && s.alive);
  if (brain.think <= 0) {
    brain.think = 0.12 + ctx.random() * 0.08;
    const seen = perceive(state, ctx, bot, brain);
    if (seen) {
      if (seen.id !== brain.target) {
        brain.target = seen.id;
        brain.reaction = 0.22 + (1 - brain.skill) * 0.38 + ctx.random() * 0.16;
        const scale = (1.25 - brain.skill) * (0.03 + ctx.random() * 0.05);
        brain.errYaw = (ctx.random() < 0.5 ? -1 : 1) * scale; brain.errPitch = (ctx.random() - 0.3) * scale;
      }
      brain.lastSeen = state.worldTime; brain.seenX = seen.m.x; brain.seenY = seen.m.y; brain.seenZ = seen.m.z;
      target = seen;
    } else if (state.worldTime - brain.lastSeen > 2.2) {
      brain.target = -1; target = undefined;
    }
  }
  const visible = !!target && state.worldTime - brain.lastSeen < 0.3;

  // ---- Goals and navigation ------------------------------------------------------
  if (!brain.goal || brain.repath <= 0) {
    const goalPoint = state.points.find(p => p.id === brain.goal);
    if (!brain.goal || !goalPoint || (goalPoint.owner === bot.team && !goalPoint.contested && ctx.random() < 0.5)) chooseGoal(state, ctx, bot, brain);
    if (target && !visible && state.worldTime - brain.lastSeen < 2.2) plan(ctx, bot, brain, brain.seenX, brain.seenY, brain.seenZ);
    else plan(ctx, bot, brain, brain.goalX, bot.m.y, brain.goalZ);
    brain.repath = 2.5 + ctx.random() * 2;
  }
  let moveX = 0, moveZ = 0;
  if (ctx.nav && brain.path.length) {
    const nav = ctx.nav;
    let i = brain.pathIndex;
    while (i < brain.path.length - 1 && Math.hypot(nav.x[brain.path[i]] - bot.m.x, nav.z[brain.path[i]] - bot.m.z) < 1.3) i++;
    brain.pathIndex = i;
    const node = brain.path[i];
    const dx = nav.x[node] - bot.m.x, dz = nav.z[node] - bot.m.z, d = Math.hypot(dx, dz);
    if (d > 0.6 || i < brain.path.length - 1) { moveX = dx / (d || 1); moveZ = dz / (d || 1); }
    else if (ctx.random() < dt * 0.6) { brain.repath = 0; }
    if (nav.y[node] - bot.m.y > 0.9 && bot.m.grounded && d < 2) brain.jump = true;
  }

  // ---- Combat ----------------------------------------------------------------------
  const w = weaponOf(bot);
  let wantAds = false;
  if (target && visible) {
    const eye = eyeOf(bot);
    const aimAt = ctx.random() < 0.18 + brain.skill * 0.15 ? { x: target.m.x, y: target.m.y + eyeHeight(target.m) + 0.02, z: target.m.z } : chestPoint(feetOf(target), target.m.crouch);
    // Imperfect lead on moving targets.
    const lead = 0.06 + (1 - brain.skill) * 0.08;
    aimAt.x += target.m.vx * lead * (ctx.random() - 0.2); aimAt.z += target.m.vz * lead * (ctx.random() - 0.2);
    const distance = Math.hypot(aimAt.x - eye.x, aimAt.z - eye.z);
    brain.errYaw *= Math.exp(-dt * (1.6 + brain.skill * 2.4)); brain.errPitch *= Math.exp(-dt * (1.6 + brain.skill * 2.4));
    const wantYaw = yawTo(eye, aimAt) + brain.errYaw, wantPitch = pitchTo(eye, aimAt) + brain.errPitch;
    const turn = (4 + brain.skill * 6) * dt;
    bot.yaw = wrapAngle(bot.yaw + clamp(wrapAngle(wantYaw - bot.yaw), -turn, turn));
    bot.pitch = clamp(bot.pitch + clamp(wantPitch - bot.pitch, -turn, turn), -1.3, 1.3);
    const aligned = Math.abs(wrapAngle(wantYaw - bot.yaw)) < 0.06 && Math.abs(wantPitch - bot.pitch) < 0.06;
    wantAds = distance > 22 && w.id !== 'sidearm';

    // Strafe and range-keeping while fighting.
    if (brain.strafeLeft <= 0) { brain.strafe = ctx.random() < 0.5 ? -1 : 1; brain.strafeLeft = 0.5 + ctx.random() * 0.9; }
    const preferred = w.id === 'lancer' ? 45 : w.id === 'magnum' ? 18 : 20;
    const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw), rx = Math.cos(bot.yaw), rz = -Math.sin(bot.yaw);
    const advance = distance > preferred * 1.4 ? 0.7 : distance < preferred * 0.5 ? -0.6 : 0;
    const pathWeight = distance > preferred ? 0.6 : 0.2;
    moveX = moveX * pathWeight + (fx * advance + rx * brain.strafe * 0.9);
    moveZ = moveZ * pathWeight + (fz * advance + rz * brain.strafe * 0.9);
    if (brain.crouchLeft < -2 && ctx.random() < dt * 0.25 * brain.skill && distance > 15) brain.crouchLeft = 0.8 + ctx.random();

    // Fire in bursts once the reaction delay has passed.
    if (brain.reaction <= 0 && aligned && bot.reloadLeft <= 0 && bot.switchLeft <= 0 && bot.fireCooldown <= 0 && brain.burstPause <= 0 && distance < w.range * 0.6) {
      if (bot.ammo[bot.weapon] <= 0) { bot.reloadLeft = w.reload; }
      else {
        const spread = spreadFor({ ...bot, ads: wantAds }, w) * (1.35 - brain.skill * 0.55) * Math.PI / 180;
        const yaw = bot.yaw + (ctx.random() - 0.5) * 2 * spread, pitch = bot.pitch + (ctx.random() - 0.5) * 2 * spread;
        const dir = dirFromAngles(yaw, pitch);
        resolveShot(state, ctx, bot, w, eye, traceShot(state, ctx, bot, eye, dir, w.range));
        bot.ammo[bot.weapon]--; bot.sinceShot = 0;
        bot.fireCooldown = w.auto ? w.interval : w.interval * (1.15 + ctx.random() * 0.6);
        brain.burst++;
        const burstLength = w.auto ? 3 + Math.floor(ctx.random() * (distance < 15 ? 8 : 4)) : 1;
        if (brain.burst >= burstLength) { brain.burst = 0; brain.burstPause = (w.auto ? 0.18 : 0.05) + ctx.random() * (distance > 30 ? 0.6 : 0.3); }
      }
    }
  } else {
    // Look where we are going (smoothly) when not fighting.
    if (moveX || moveZ) {
      const want = Math.atan2(-moveX, -moveZ);
      bot.yaw = wrapAngle(bot.yaw + clamp(wrapAngle(want - bot.yaw), -4 * dt, 4 * dt));
      bot.pitch *= Math.exp(-dt * 3);
    }
    brain.burst = 0;
    if (bot.ammo[bot.weapon] < weaponOf(bot).magazine * 0.4 && bot.reloadLeft <= 0) bot.reloadLeft = w.reload;
    // Grenade the last known position of an enemy who ducked behind cover.
    if (target && brain.grenadeCooldown <= 0 && bot.grenades > 0 && state.worldTime - brain.lastSeen < 2.5) {
      const d = Math.hypot(brain.seenX - bot.m.x, brain.seenZ - bot.m.z);
      if (d > 9 && d < 24 && ctx.random() < 0.35) {
        const eye = eyeOf(bot);
        const yaw = yawTo(eye, { x: brain.seenX, y: 0, z: brain.seenZ });
        // Flat-ground ballistic estimate: pick a pitch whose range matches the distance.
        const v = GRENADE.throwSpeed, pitch = clamp(0.5 * Math.asin(clamp(d * 9.8 / (v * v), -1, 1)) - 0.08, 0.05, 0.9);
        throwGrenadeFrom(state, bot, eye, dirFromAngles(yaw, pitch));
      }
      brain.grenadeCooldown = 9 + ctx.random() * 8;
    }
  }

  // ---- Stuck detection ------------------------------------------------------------
  const moved = Math.hypot(bot.m.x - brain.lastX, bot.m.z - brain.lastZ);
  brain.lastX = bot.m.x; brain.lastZ = bot.m.z;
  const wanted = Math.hypot(moveX, moveZ) > 0.3;
  brain.stuck = wanted && moved < dt * 0.8 ? brain.stuck + dt : Math.max(0, brain.stuck - dt * 2);
  if (brain.stuck > 0.7) { brain.jump = true; brain.stuck = 0; brain.repath = 0; brain.strafe *= -1; }

  // ---- Drive the shared movement controller ---------------------------------------
  const len = Math.hypot(moveX, moveZ);
  if (len > 1) { moveX /= len; moveZ /= len; }
  const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw), rx = Math.cos(bot.yaw), rz = -Math.sin(bot.yaw);
  const forward = moveX * fx + moveZ * fz, strafe = moveX * rx + moveZ * rz;
  const input: MoveInput = {
    forward, strafe, yaw: bot.yaw, jump: brain.jump, crouch: brain.crouchLeft > 0,
    sprint: !visible && len > 0.5 && forward > 0.7 && bot.reloadLeft <= 0, ads: wantAds && visible,
  };
  brain.jump = false;
  bot.sprint = input.sprint && bot.m.grounded; bot.ads = input.ads;
  stepMovement(ctx.world, bot.m, input, dt, bot.team);
  // Safety net: never let a bot fall out of the world.
  if (bot.m.y < -60) bot.m.y = ctx.world.groundHeight(bot.m.x, bot.m.z, 100, MOVE.radius);
}
