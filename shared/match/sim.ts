import { chestPoint, hitShape } from '../hitbox';
import { parseLawCommand, type LawCommand, type Laws } from '../laws';
import { loadMap, loadNav } from '../maps/index';
import { clamp, cloneData, dist3, normalize3, segmentPointDistance, type Vec3 } from '../math';
import { MOVE, createMoveState } from '../movement';
import { HEALTH, LOADOUTS, WEAPONS, type LoadoutId } from '../weapons';
import { BODY_RADIUS, History, PHYSICS_STEP, circularSpeed, stepBodies, timeFactor, type Body } from '../world';
import { botName, createBrain, updateBot } from './bots';
import {
  DRONE, TICK_RATE, applyDamage, explode, eyeOf, feetOf, isHostile, killSoldier, resolveShot, spawnBody, spawnSoldier,
  throwGrenadeFrom, traceShot, weaponOf, type SimContext, type TraceResult,
} from './combat';
import type { ClientReport, MatchConfig, MatchEvent, MatchState, ShotClaim, Soldier, Team, WorldSnapshot } from './state';

export { TICK_RATE } from './combat';
export type { SimContext } from './combat';

const CAPTURE_SECONDS = 8;
const SCORE_INTERVAL = 2.5;
export const HISTORY_SECONDS = 10;

/** Build a simulation context. `withNav` is needed only where bots are simulated. */
export function createContext(mapId: string, random: () => number, emit: (e: MatchEvent) => void, withNav = true): SimContext {
  const { def, world } = loadMap(mapId);
  const history = new History<WorldSnapshot>(HISTORY_SECONDS * TICK_RATE + 1);
  return { map: def, world, nav: withNav ? loadNav(mapId) : undefined, random, emit, history };
}

export function createMatch(mapId: string, config: MatchConfig, random: () => number): MatchState {
  const { def } = loadMap(mapId);
  const state: MatchState = {
    mapId, phase: 'warmup', phaseLeft: config.warmup, time: 0, worldTime: 0, tick: 0, scores: [0, 0], scoreTimer: 0,
    laws: cloneData(def.laws), lawAuthor: -1, lawText: '', lawLeft: -1, rewindLeft: 0,
    soldiers: [], points: def.points.map(p => ({ id: p.id, progress: 0, owner: -1, contested: false, capturing: -1 })),
    bodies: [], nextId: 1, droneTimer: 0, winner: -1, config,
  };
  seedAnomaly(state, def.anomaly, random);
  return state;
}

/** Sentinel drones and shards in orbit around the reactor under the current law. */
function seedAnomaly(state: MatchState, center: Vec3, random: () => number) {
  for (let i = 0; i < DRONE.max; i++) spawnDrone(state, center, random, i / DRONE.max);
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI * 2 / 6 + 0.3, r = 11 + (i % 2) * 1.5;
    const speed = circularSpeed(state.laws.gravity, r);
    spawnBody(state, 'debris', { x: center.x + Math.cos(angle) * r, y: center.y - 2.6 + (i % 3) * 0.7, z: center.z + Math.sin(angle) * r },
      { x: -Math.sin(angle) * speed, y: 0, z: Math.cos(angle) * speed }, -1, -1, 1);
  }
}

function spawnDrone(state: MatchState, center: Vec3, random: () => number, phase = random()) {
  const angle = phase * Math.PI * 2, r = 6 + random() * 2.6, tilt = 0.18 + random() * 0.2;
  const speed = circularSpeed(state.laws.gravity, r);
  const owner = state.points.find(p => p.id === 'B')?.owner ?? -1;
  return spawnBody(state, 'drone',
    { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r * Math.sin(tilt), z: center.z + Math.sin(angle) * r * Math.cos(tilt) },
    { x: -Math.sin(angle) * speed, y: Math.cos(angle) * speed * Math.sin(tilt), z: Math.cos(angle) * speed * Math.cos(tilt) },
    -1, owner, DRONE.hp, 0.6 + random() * DRONE.interval);
}

export function addSoldier(state: MatchState, ctx: SimContext, opts: { name: string; team?: Team; bot: boolean; loadout?: LoadoutId }): Soldier {
  const counts = [0, 1].map(t => state.soldiers.filter(s => s.team === t && !s.bot).length);
  const team: Team = opts.team ?? (counts[0] <= counts[1] ? 0 : 1);
  const loadout = opts.loadout ?? (opts.bot ? (ctx.random() < 0.3 ? 'recon' : 'assault') : 'assault');
  const s: Soldier = {
    id: state.nextId++, name: opts.name.slice(0, 20), team, bot: opts.bot, loadout,
    m: createMoveState(0, 0, 0), yaw: 0, pitch: 0, alive: false, health: 0, shield: 0, weapon: 0,
    ammo: [WEAPONS[LOADOUTS[loadout].weapons[0]].magazine, WEAPONS[LOADOUTS[loadout].weapons[1]].magazine],
    reloadLeft: 0, fireCooldown: 0, switchLeft: 0, grenades: 0, respawnLeft: 0, protectLeft: 0, sinceHit: 99, lastAttacker: -1,
    kills: 0, deaths: 0, score: 0, captures: 0, lawCooldown: 0, sprint: false, ads: false, sinceShot: 99, corrections: 0, idle: 0,
  };
  if (opts.bot) s.brain = createBrain(clamp(state.config.botSkill + (ctx.random() - 0.5) * 0.3, 0.15, 0.95));
  state.soldiers.push(s);
  ctx.emit({ type: 'join', id: s.id, name: s.name, team });
  spawnSoldier(state, ctx, s);
  return s;
}

export function removeSoldier(state: MatchState, ctx: SimContext, id: number) {
  const i = state.soldiers.findIndex(s => s.id === id);
  if (i < 0) return;
  const [s] = state.soldiers.splice(i, 1);
  ctx.emit({ type: 'leave', id, name: s.name });
}

/** Keep both teams at config.teamSize by adding or removing bots around the humans. */
export function balanceTeams(state: MatchState, ctx: SimContext) {
  for (const team of [0, 1] as Team[]) {
    const members = state.soldiers.filter(s => s.team === team);
    const humans = members.filter(s => !s.bot).length;
    const wantBots = Math.max(0, state.config.teamSize - humans);
    const bots = members.filter(s => s.bot);
    for (let i = bots.length; i < wantBots; i++) addSoldier(state, ctx, { name: botName(state, ctx.random), team, bot: true });
    // Remove dead bots first when a human takes a slot.
    bots.sort((a, b) => Number(a.alive) - Number(b.alive));
    for (let i = 0; i < bots.length - wantBots; i++) removeSoldier(state, ctx, bots[i].id);
  }
}

// ---------------------------------------------------------------------------------------
// Human commands (validated). The same functions back the offline host and server reducers.
// ---------------------------------------------------------------------------------------

/** Accept a client's own movement report if it is physically plausible. */
export function reportState(state: MatchState, ctx: SimContext, id: number, r: ClientReport, elapsed: number) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || s.bot) return false;
  s.idle = 0;
  const finite = [r.x, r.y, r.z, r.vx, r.vy, r.vz, r.yaw, r.pitch, r.crouch].every(Number.isFinite);
  if (!finite) return false;
  s.yaw = r.yaw; s.pitch = clamp(r.pitch, -1.5, 1.5);
  if (!s.alive) return true;
  const dt = clamp(elapsed, 1 / 60, 0.5);
  const horizontal = Math.hypot(r.x - s.m.x, r.z - s.m.z);
  const rise = r.y - s.m.y;
  const maxHorizontal = (MOVE.slideSpeed * 1.3 + 1.5) * dt + 0.8;
  const pos = { x: r.x, y: r.y, z: r.z };
  const b = ctx.map.bounds;
  const outOfBounds = r.x < b.minX - 1 || r.x > b.maxX + 1 || r.z < b.minZ - 1 || r.z > b.maxZ + 1;
  if (horizontal > maxHorizontal || rise > MOVE.jumpSpeed * dt + 1.2 || outOfBounds || ctx.world.overlapsSolid(pos, MOVE.radius * 0.55, 1.2, s.team)) {
    s.corrections++;
    return false;
  }
  s.m.x = r.x; s.m.y = r.y; s.m.z = r.z; s.m.vx = r.vx; s.m.vy = r.vy; s.m.vz = r.vz;
  s.m.crouch = clamp(r.crouch, 0, 1); s.m.grounded = r.grounded;
  s.sprint = r.sprint; s.ads = r.ads;
  if (r.weapon !== s.weapon) switchWeapon(state, id, r.weapon);
  if (horizontal > 0.05 && s.protectLeft > 0.6) s.protectLeft = Math.min(s.protectLeft, 0.6);
  return true;
}

export function switchWeapon(state: MatchState, id: number, slot: 0 | 1) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || !s.alive || s.weapon === slot) return;
  s.weapon = slot; s.reloadLeft = 0;
  s.switchLeft = WEAPONS[LOADOUTS[s.loadout].weapons[slot]].equipTime;
}

export function reload(state: MatchState, id: number) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || !s.alive || s.reloadLeft > 0) return;
  const w = weaponOf(s);
  if (s.ammo[s.weapon] < w.magazine) s.reloadLeft = w.reload;
}

export function setLoadout(state: MatchState, id: number, loadout: LoadoutId) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || !(loadout in LOADOUTS)) return;
  s.loadout = loadout;
  // Takes effect on the next deployment unless the soldier has not fired since spawning.
  if (s.alive && s.sinceShot > 50 && s.protectLeft > 0) {
    const [a, b] = LOADOUTS[loadout].weapons;
    s.ammo = [WEAPONS[a].magazine, WEAPONS[b].magazine]; s.weapon = 0;
  }
}

/** Validate a client's hitscan shot and its claimed hit. */
/** Seconds a client's fire clock may run ahead of the server's (network jitter allowance). */
export const FIRE_JITTER = 0.25;

export function fireShot(state: MatchState, ctx: SimContext, id: number, claim: ShotClaim) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || s.bot || !s.alive || state.phase === 'ended') return false;
  if (claim.weapon !== s.weapon) switchWeapon(state, id, claim.weapon);
  const w = weaponOf(s);
  // Token-bucket rate limit: network jitter can deliver a few shots at once, so a client may run
  // up to FIRE_JITTER seconds ahead of the server's fire clock. The sustained rate stays capped at
  // the weapon's fire rate, and slow weapons get no instant follow-up shot.
  if (s.reloadLeft > 0.12 || s.switchLeft > 0.12 || s.fireCooldown > FIRE_JITTER || s.ammo[s.weapon] <= 0) return false;
  const values = [claim.origin.x, claim.origin.y, claim.origin.z, claim.dir.x, claim.dir.y, claim.dir.z, claim.point.x, claim.point.y, claim.point.z];
  if (!values.every(Number.isFinite)) return false;
  s.ammo[s.weapon]--;
  s.fireCooldown = Math.max(0, s.fireCooldown) + w.interval;
  s.sinceShot = 0; s.protectLeft = 0;
  const eye = eyeOf(s);
  const origin = dist3(claim.origin, eye) < 2.5 ? claim.origin : eye;
  const dir = normalize3(claim.dir);
  let result: TraceResult | undefined;
  const target = claim.target >= 0 ? state.soldiers.find(x => x.id === claim.target) : undefined;
  if (target && target.alive && target.team !== s.team && claim.zone) {
    const distance = dist3(origin, claim.point);
    const shape = hitShape(feetOf(target), target.m.crouch, target.yaw);
    const nearest = Math.min(
      segmentPointDistance(claim.point, shape.chestBottom, shape.chestTop).distance,
      segmentPointDistance(claim.point, shape.foot, shape.hip).distance,
      dist3(claim.point, shape.head),
    );
    const tolerance = 1.1 + Math.hypot(target.m.vx, target.m.vz) * 0.3;
    const toPoint = normalize3({ x: claim.point.x - origin.x, y: claim.point.y - origin.y, z: claim.point.z - origin.z });
    const aligned = toPoint.x * dir.x + toPoint.y * dir.y + toPoint.z * dir.z > Math.cos(0.12);
    if (distance <= w.range && nearest <= tolerance && aligned && ctx.world.lineOfSight(origin, claim.point, s.team)) {
      result = { point: claim.point, soldier: target, zone: claim.zone, distance };
    }
  }
  // Without a valid soldier claim, the server traces walls and drones itself.
  result ??= traceShot({ ...state, soldiers: [] }, ctx, s, origin, dir, w.range);
  resolveShot(state, ctx, s, w, origin, result);
  return true;
}

export function throwGrenade(state: MatchState, ctx: SimContext, id: number, origin: Vec3, dir: Vec3) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || !s.alive || state.phase === 'ended') return false;
  const eye = eyeOf(s);
  const o = [origin.x, origin.y, origin.z, dir.x, dir.y, dir.z].every(Number.isFinite) && dist3(origin, eye) < 2.5 ? origin : eye;
  s.protectLeft = 0;
  return !!throwGrenadeFrom(state, s, o, normalize3(dir));
}

/** Rewrite a law. Commands are validated with the shared schema; nothing executes. */
export function applyLaw(state: MatchState, ctx: SimContext, id: number, raw: unknown, source: string, text: string): { ok: boolean; message: string } {
  let command: LawCommand;
  try { command = parseLawCommand(raw); } catch { return { ok: false, message: 'Invalid law command.' }; }
  const s = state.soldiers.find(x => x.id === id);
  if (state.config.lawCooldown > 0) {
    if (!s) return { ok: false, message: 'Only deployed lawbreakers can rewrite laws.' };
    if (s.lawCooldown > 0) return { ok: false, message: `Law engine recharging: ${Math.ceil(s.lawCooldown)}s.` };
    const holdsReactor = state.points.find(p => p.id === 'B')?.owner === s.team;
    s.lawCooldown = state.config.lawCooldown * (holdsReactor ? 0.5 : 1);
  }
  let message: string;
  switch (command.kind) {
    case 'gravity': state.laws.gravity = command.gravity; message = describeGravity(command.gravity); break;
    case 'time': state.laws.time = command.time; message = command.time.mode === 'playerMotion' ? 'Time now moves only when the lawbreaker moves.' : `World time runs at ×${command.time.scale.toFixed(2)}.`; break;
    case 'lightSpeed': state.laws.lightSpeed = command.lightSpeed; message = `Light now travels at ${command.lightSpeed.c} m/s.`; break;
    case 'rewind': {
      state.laws.rewind = command.rewind;
      const ticks = Math.min(Math.round(command.rewind.seconds * TICK_RATE), Math.max(0, ctx.history.length - 1));
      state.rewindLeft = ticks;
      message = `Rewinding the world ${(ticks / TICK_RATE).toFixed(1)}s. Lawbreakers stay free.`;
      ctx.emit({ type: 'rewind', seconds: ticks / TICK_RATE });
      break;
    }
  }
  if (command.kind !== 'rewind') {
    state.lawAuthor = id; state.lawText = text || message;
    state.lawLeft = state.config.lawDuration > 0 ? state.config.lawDuration : -1;
  }
  ctx.emit({ type: 'law', author: id, command, text: text || message, source });
  return { ok: true, message };
}

export function describeGravity(g: Laws['gravity']) {
  if (g.mode === 'uniform') return `Gravity pulls uniformly at ${g.strength} m/s².`;
  const power = g.exponent === 2 ? 'square' : g.exponent === 3 ? 'cube' : `power ${g.exponent}`;
  return g.strength < 0 ? `The reactor repels with the inverse ${power} of distance.` : `The reactor pulls with the inverse ${power} of distance.`;
}

// ---------------------------------------------------------------------------------------
// Simulation tick
// ---------------------------------------------------------------------------------------

export function resetMatch(state: MatchState, ctx: SimContext) {
  state.phase = 'warmup'; state.phaseLeft = state.config.warmup; state.scores = [0, 0]; state.scoreTimer = 0;
  state.time = 0; state.worldTime = 0; state.winner = -1; state.rewindLeft = 0;
  state.laws = cloneData(ctx.map.laws); state.lawAuthor = -1; state.lawText = ''; state.lawLeft = -1;
  state.points = ctx.map.points.map(p => ({ id: p.id, progress: 0, owner: -1, contested: false, capturing: -1 }));
  state.bodies = [];
  ctx.history.clear();
  seedAnomaly(state, ctx.map.anomaly, ctx.random);
  for (const s of state.soldiers) { s.kills = 0; s.deaths = 0; s.score = 0; s.captures = 0; s.lawCooldown = 0; spawnSoldier(state, ctx, s); }
  ctx.emit({ type: 'phase', phase: 'warmup', winner: -1 });
}

function lawfulMotion(state: MatchState) {
  const author = state.soldiers.find(s => s.id === state.lawAuthor && s.alive && !s.bot);
  if (author) return Math.hypot(author.m.vx, author.m.vz);
  let fastest = 0;
  for (const s of state.soldiers) if (!s.bot && s.alive) fastest = Math.max(fastest, Math.hypot(s.m.vx, s.m.vz));
  return fastest;
}

export function worldTimeFactor(state: MatchState) {
  return state.rewindLeft > 0 ? 0 : timeFactor(state.laws.time, lawfulMotion(state));
}

export function tickMatch(state: MatchState, ctx: SimContext, dt: number) {
  state.time += dt; state.tick++;
  // ---- Phases ----
  state.phaseLeft -= dt;
  if (state.phase === 'warmup' && state.phaseLeft <= 0) {
    state.phase = 'live'; state.phaseLeft = state.config.timeLimit; state.scores = [0, 0];
    ctx.emit({ type: 'phase', phase: 'live', winner: -1 });
  } else if (state.phase === 'live') {
    const [a, b] = state.scores;
    if (a >= state.config.scoreLimit || b >= state.config.scoreLimit || state.phaseLeft <= 0) {
      state.phase = 'ended'; state.phaseLeft = 12; state.winner = a === b ? -1 : a > b ? 0 : 1;
      ctx.emit({ type: 'phase', phase: 'ended', winner: state.winner });
    }
  } else if (state.phase === 'ended' && state.phaseLeft <= 0) {
    resetMatch(state, ctx);
  }
  if (state.lawLeft > 0) {
    state.lawLeft -= dt;
    if (state.lawLeft <= 0) {
      state.lawLeft = -1; state.laws = { ...cloneData(ctx.map.laws), rewind: state.laws.rewind }; state.lawAuthor = -1; state.lawText = '';
      ctx.emit({ type: 'lawRevert' });
    }
  }

  // ---- Lawbreakers (humans) run on wall-clock time ----
  for (const s of state.soldiers) if (!s.bot) updateTimers(state, ctx, s, dt);

  // ---- The lawful world ----
  if (state.rewindLeft > 0) {
    // The newest entry is the present; step back one entry and restore the one before it.
    ctx.history.pop();
    state.rewindLeft--;
    const snapshot = ctx.history.peek();
    if (snapshot) restoreSnapshot(state, snapshot);
    if (ctx.history.length <= 1) state.rewindLeft = 0;
  } else {
    const dtW = dt * worldTimeFactor(state);
    if (dtW > 0) {
      state.worldTime += dtW;
      for (const s of state.soldiers) {
        if (!s.bot) continue;
        updateTimers(state, ctx, s, dtW);
        if (s.alive) updateBot(state, ctx, s, dtW);
      }
      stepWorld(state, ctx, dtW);
      updatePoints(state, ctx, dtW);
      ctx.history.push(takeSnapshot(state));
    }
  }

  // ---- Team score ticks on wall-clock time ----
  if (state.phase === 'live') {
    state.scoreTimer += dt;
    while (state.scoreTimer >= SCORE_INTERVAL) {
      state.scoreTimer -= SCORE_INTERVAL;
      for (const p of state.points) if (p.owner !== -1) state.scores[p.owner] += 1;
    }
  }
}

function updateTimers(state: MatchState, ctx: SimContext, s: Soldier, dt: number) {
  s.idle += dt; s.lawCooldown = Math.max(0, s.lawCooldown - dt);
  if (!s.alive) {
    s.respawnLeft -= dt;
    if (s.respawnLeft <= 0 && state.phase !== 'ended') spawnSoldier(state, ctx, s);
    return;
  }
  s.fireCooldown = Math.max(0, s.fireCooldown - dt);
  s.switchLeft = Math.max(0, s.switchLeft - dt);
  s.protectLeft = Math.max(0, s.protectLeft - dt);
  s.sinceShot += dt; s.sinceHit += dt;
  if (s.reloadLeft > 0) {
    s.reloadLeft -= dt;
    if (s.reloadLeft <= 0) { s.reloadLeft = 0; s.ammo[s.weapon] = weaponOf(s).magazine; }
  }
  if (s.sinceHit > HEALTH.shieldDelay) s.shield = Math.min(HEALTH.shield, s.shield + HEALTH.shieldRate * dt);
  if (s.sinceHit > HEALTH.healthDelay) s.health = Math.min(HEALTH.max, s.health + HEALTH.healthRate * dt);
  // Falling out of the world is fatal.
  if (s.m.y < -40) killSoldier(state, ctx, s, undefined, 'fall', false);
}

function stepWorld(state: MatchState, ctx: SimContext, dtW: number) {
  const center = ctx.map.anomaly;
  const before = new Map(state.bodies.map(b => [b.id, { x: b.x, y: b.y, z: b.z }]));
  const steps = Math.max(1, Math.ceil(dtW / PHYSICS_STEP - 1e-9));
  for (let i = 0; i < steps; i++) stepBodies(state.bodies, dtW / steps, state.laws, center, ctx.world);

  for (const b of [...state.bodies]) {
    const old = before.get(b.id) ?? b;
    const far = Math.hypot(b.x - center.x, b.z - center.z) > 180 || b.y < -40 || b.y > 260;
    if (b.kind === 'bolt') {
      if (b.age > 4 || far) { removeBody(state, b); continue; }
      for (const s of state.soldiers) {
        if (!s.alive || !isHostile(b.team, s.team)) continue;
        const shape = hitShape(feetOf(s), s.m.crouch, s.yaw);
        const hitBody = segmentPointDistance(chestPoint(feetOf(s), s.m.crouch), old, b).distance < shape.chestR + BODY_RADIUS.bolt + 0.15;
        const hitHead = segmentPointDistance(shape.head, old, b).distance < shape.headR + BODY_RADIUS.bolt;
        if (hitBody || hitHead) {
          applyDamage(state, ctx, s, -1, DRONE.boltDamage, 'bolt', old, 'sentinel');
          removeBody(state, b);
          break;
        }
      }
    } else if (b.kind === 'grenade') {
      b.timer -= dtW;
      if (b.timer <= 0 || far) { removeBody(state, b); if (!far) explode(state, ctx, b); }
    } else if (b.kind === 'drone') {
      if (far) { removeBody(state, b); continue; }
      b.timer -= dtW;
      if (b.timer <= 0) {
        b.timer = DRONE.interval * (0.75 + ctx.random() * 0.5);
        droneFire(state, ctx, b);
      }
    } else if (far) removeBody(state, b);
  }

  // Replace lost sentinels while the anomaly can hold them in orbit.
  const drones = state.bodies.filter(b => b.kind === 'drone').length;
  if (drones < DRONE.max && circularSpeed(state.laws.gravity, 7) > 0) {
    state.droneTimer -= dtW;
    if (state.droneTimer <= 0) { spawnDrone(state, center, ctx.random); state.droneTimer = DRONE.respawn; }
  } else state.droneTimer = DRONE.respawn;
}

function removeBody(state: MatchState, b: Body) {
  const i = state.bodies.indexOf(b);
  if (i >= 0) state.bodies.splice(i, 1);
}

function droneFire(state: MatchState, ctx: SimContext, d: Body) {
  if (state.config.practice) return;
  let best: Soldier | undefined, bestD = DRONE.range;
  for (const s of state.soldiers) {
    if (!s.alive || !isHostile(d.team, s.team) || s.protectLeft > 0) continue;
    const chest = chestPoint(feetOf(s), s.m.crouch);
    const dist = dist3(d, chest);
    if (dist < bestD && ctx.world.lineOfSight(d, chest, -2)) { bestD = dist; best = s; }
  }
  if (!best) return;
  const chest = chestPoint(feetOf(best), best.m.crouch);
  const t = bestD / DRONE.boltSpeed;
  const aim = { x: chest.x + best.m.vx * t * 0.6 - d.x, y: chest.y - d.y, z: chest.z + best.m.vz * t * 0.6 - d.z };
  const dir = normalize3(aim);
  spawnBody(state, 'bolt', { x: d.x + dir.x * 0.7, y: d.y + dir.y * 0.7, z: d.z + dir.z * 0.7 },
    { x: dir.x * DRONE.boltSpeed, y: dir.y * DRONE.boltSpeed, z: dir.z * DRONE.boltSpeed }, -1, d.team, 1);
}

function updatePoints(state: MatchState, ctx: SimContext, dtW: number) {
  for (const p of state.points) {
    const def = ctx.map.points.find(d => d.id === p.id)!;
    const counts = [0, 0];
    for (const s of state.soldiers) {
      if (!s.alive) continue;
      if (Math.hypot(s.m.x - def.x, s.m.z - def.z) <= def.radius && Math.abs(s.m.y - def.y) < 4.5) counts[s.team]++;
    }
    p.contested = counts[0] > 0 && counts[1] > 0;
    if (p.contested) { p.capturing = -1; continue; }
    if (counts[0] === 0 && counts[1] === 0) {
      p.capturing = -1;
      const goal = p.owner === -1 ? 0 : p.owner === 0 ? 100 : -100;
      p.progress += clamp(goal - p.progress, -6 * dtW, 6 * dtW);
      continue;
    }
    const team: Team = counts[0] > 0 ? 0 : 1;
    const n = Math.min(4, Math.max(counts[0], counts[1]));
    const rate = 100 / CAPTURE_SECONDS * (1 + 0.35 * (n - 1)) * dtW;
    p.progress = clamp(p.progress + (team === 0 ? rate : -rate), -100, 100);
    p.capturing = p.owner === team && Math.abs(p.progress) >= 100 ? -1 : team;
    if (p.owner !== -1 && p.owner !== team && (p.owner === 0 ? p.progress <= 0 : p.progress >= 0)) {
      p.owner = -1;
      ctx.emit({ type: 'neutralize', point: p.id, team });
    }
    if (p.owner === -1 && Math.abs(p.progress) >= 100) {
      p.owner = team; p.capturing = -1;
      for (const s of state.soldiers) {
        if (s.alive && s.team === team && Math.hypot(s.m.x - def.x, s.m.z - def.z) <= def.radius) { s.score += 150; s.captures++; }
      }
      if (p.id === 'B') for (const b of state.bodies) if (b.kind === 'drone') b.team = team;
      ctx.emit({ type: 'capture', point: p.id, team });
    }
  }
}

export function takeSnapshot(state: MatchState): WorldSnapshot {
  return {
    worldTime: state.worldTime,
    bodies: state.bodies.map(b => ({ ...b })),
    bots: state.soldiers.filter(s => s.bot).map(s => ({
      id: s.id, m: { ...s.m }, yaw: s.yaw, pitch: s.pitch, alive: s.alive, health: s.health, shield: s.shield,
      ammo: [s.ammo[0], s.ammo[1]], reloadLeft: s.reloadLeft, respawnLeft: s.respawnLeft,
    })),
    points: state.points.map(p => ({ id: p.id, progress: p.progress, owner: p.owner })),
  };
}

export function restoreSnapshot(state: MatchState, snap: WorldSnapshot) {
  state.worldTime = snap.worldTime;
  state.bodies = snap.bodies.map(b => ({ ...b }));
  for (const saved of snap.bots) {
    const s = state.soldiers.find(x => x.id === saved.id);
    if (!s) continue;
    s.m = { ...saved.m }; s.yaw = saved.yaw; s.pitch = saved.pitch; s.alive = saved.alive; s.health = saved.health;
    s.shield = saved.shield; s.ammo = [saved.ammo[0], saved.ammo[1]]; s.reloadLeft = saved.reloadLeft; s.respawnLeft = saved.respawnLeft;
    if (s.brain) { s.brain.path = []; s.brain.repath = 0; s.brain.target = -1; }
  }
  for (const saved of snap.points) {
    const p = state.points.find(x => x.id === saved.id);
    if (p) { p.progress = saved.progress; p.owner = saved.owner; }
  }
}
