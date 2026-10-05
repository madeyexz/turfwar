import { chestPoint, hitShape } from '../hitbox';
import { STEP_HEIGHT } from '../collision';
import { loadMap, loadNav } from '../maps/index';
import type { MapDef } from '../maps/types';
import { clamp, cloneData, dist3, normalize3, segmentPointDistance, type Vec3 } from '../math';
import { MOVE, createMoveState } from '../movement';
import { ECONOMY, HEALTH, LOADOUTS, WEAPONS, slotOf, type LoadoutId } from '../weapons';
import { PHYSICS_STEP, stepBodies, type Body } from '../world';
import { botName, createBrain, updateBot } from './bots';
import { award, buy, equip, finishReload, kitWeapons, takePickup, updatePickups, type BuyItem } from './economy';
import {
  MOVE_SLACK, TICK_RATE, applyDamage, explode, eyeOf, feetOf, isHostile, killSoldier, launchCharge, resolvePellets, resolveShot,
  spawnBody, spawnSoldier, throwGrenadeFrom, traceShot, weaponOf, type SimContext, type TraceResult,
} from './combat';
import type { ClientReport, MatchConfig, MatchEvent, MatchState, ShotClaim, Soldier, Team } from './state';

export { TICK_RATE } from './combat';
export type { SimContext } from './combat';

const CAPTURE_SECONDS = 8;
const SCORE_INTERVAL = 2.5;

/** Build a simulation context. `withNav` is needed only where bots are simulated. */
export function createContext(mapId: string, random: () => number, emit: (e: MatchEvent) => void, withNav = true): SimContext {
  const { def, world } = loadMap(mapId);
  return { map: def, world, nav: withNav ? loadNav(mapId) : undefined, random, emit };
}

export function createMatch(mapId: string, config: MatchConfig, random: () => number): MatchState {
  const { def } = loadMap(mapId);
  const state: MatchState = {
    mapId, phase: 'warmup', phaseLeft: config.warmup, time: 0, tick: 0, scores: [0, 0], scoreTimer: 0,
    soldiers: [], points: def.points.map(p => ({ id: p.id, progress: 0, owner: -1, contested: false, capturing: -1 })),
    bodies: [], pickupLeft: (def.pickups ?? []).map(() => 0), nextId: 1, winner: -1, config,
  };
  return state;
}

export function addSoldier(state: MatchState, ctx: SimContext, opts: { name: string; team?: Team; bot: boolean; loadout?: LoadoutId }): Soldier {
  const counts = [0, 1].map(t => state.soldiers.filter(s => s.team === t && !s.bot).length);
  const team: Team = opts.team ?? (counts[0] <= counts[1] ? 0 : 1);
  const roll = opts.loadout || !opts.bot ? 0 : ctx.random();
  const loadout = opts.loadout ?? (opts.bot ? (roll < 0.25 ? 'recon' : roll < 0.43 ? 'breacher' : roll < 0.58 ? 'grenadier' : 'assault') : 'assault');
  const s: Soldier = {
    id: state.nextId++, name: opts.name.slice(0, 20), team, bot: opts.bot, loadout,
    m: createMoveState(0, 0, 0), yaw: 0, pitch: 0, alive: false, health: 0, shield: 0, weapon: 0,
    weapons: kitWeapons(loadout), reserve: [0, 0], money: ECONOMY.start, bought: ['', ''], sinceSpawn: 0,
    ammo: [WEAPONS[LOADOUTS[loadout].weapons[0]].magazine, WEAPONS[LOADOUTS[loadout].weapons[1]].magazine],
    reloadLeft: 0, fireCooldown: 0, switchLeft: 0, grenades: 0, respawnLeft: 0, protectLeft: 0, sinceHit: 99, lastAttacker: -1,
    kills: 0, deaths: 0, score: 0, captures: 0, sprint: false, ads: false, sinceShot: 99, corrections: 0, moveSlack: MOVE_SLACK.max, groundY: 0, idle: 0,
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

/** Soldiers per team: the battlefield's own size (big maps hold 50v50), except on the practice range. */
export const teamSizeFor = (map: MapDef, config: MatchConfig) => config.practice ? config.teamSize : map.teamSize ?? config.teamSize;

/** Keep both teams at the battlefield's team size by adding or removing bots around the humans. */
export function balanceTeams(state: MatchState, ctx: SimContext) {
  const size = teamSizeFor(ctx.map, state.config);
  for (const team of [0, 1] as Team[]) {
    const members = state.soldiers.filter(s => s.team === team);
    const humans = members.filter(s => !s.bot).length;
    const wantBots = Math.max(0, size - humans);
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
const JUMP_APEX = MOVE.jumpSpeed ** 2 / (2 * MOVE.gravity);

export function reportState(state: MatchState, ctx: SimContext, id: number, r: ClientReport, elapsed: number) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || s.bot) return false;
  s.idle = 0;
  const finite = [r.x, r.y, r.z, r.vx, r.vy, r.vz, r.yaw, r.pitch, r.crouch].every(Number.isFinite);
  if (!finite) return false;
  s.yaw = r.yaw; s.pitch = clamp(r.pitch, -1.5, 1.5);
  if (!s.alive) return true;
  // Distance budget against server-measured time: it refills at the top movement speed and is
  // capped, so jitter (reports bunching up after a gap) passes, but sending reports faster never
  // buys extra distance.
  const dt = clamp(elapsed, 0, 0.5);
  s.moveSlack = Math.min(MOVE_SLACK.max, s.moveSlack + MOVE_SLACK.speed * dt);
  const horizontal = Math.hypot(r.x - s.m.x, r.z - s.m.z);
  const rise = r.y - s.m.y;
  const cost = Math.hypot(horizontal, Math.max(0, rise));
  // Height checks: nothing lifts a soldier higher above its last floor than a jump plus a
  // step-up onto a ledge (margin for that floor being a report old), and no fall on these maps
  // lasts 2.5 s, so a longer airborne spell is hovering. Either drops the soldier to the floor.
  const floor = ctx.world.groundHeight(r.x, r.z, r.y + 0.05, MOVE.radius);
  const airborne = r.y - floor > 0.35;
  const airTime = airborne ? s.m.airTime + dt : 0;
  const flying = (rise > 0.02 && r.y > s.groundY + JUMP_APEX + STEP_HEIGHT + 0.3) || airTime > 2.5;
  if (flying) {
    s.m.y = ctx.world.groundHeight(s.m.x, s.m.z, s.m.y + 0.05, MOVE.radius); s.m.vy = 0;
    s.m.airTime = 0; s.groundY = s.m.y;
    s.corrections++;
    return false;
  }
  const pos = { x: r.x, y: r.y, z: r.z };
  const b = ctx.map.bounds;
  const outOfBounds = r.x < b.minX - 1 || r.x > b.maxX + 1 || r.z < b.minZ - 1 || r.z > b.maxZ + 1;
  if (cost > s.moveSlack || outOfBounds || ctx.world.overlapsSolid(pos, MOVE.radius * 0.55, 1.2, s.team)) {
    s.corrections++;
    return false;
  }
  s.moveSlack -= cost;
  s.m.airTime = airTime;
  if (!airborne) s.groundY = r.y;
  s.m.x = r.x; s.m.y = r.y; s.m.z = r.z; s.m.vx = r.vx; s.m.vy = r.vy; s.m.vz = r.vz;
  s.m.crouch = clamp(r.crouch, 0, 1); s.m.grounded = r.grounded && !airborne;
  s.sprint = r.sprint; s.ads = r.ads;
  s.m.slideTime = r.slide ? Math.max(s.m.slideTime, 0.2) : 0;
  if (r.weapon !== s.weapon) switchWeapon(state, id, r.weapon);
  if (horizontal > 0.05 && s.protectLeft > 0.6) s.protectLeft = Math.min(s.protectLeft, 0.6);
  return true;
}

export function switchWeapon(state: MatchState, id: number, slot: 0 | 1) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || !s.alive || s.weapon === slot) return;
  s.weapon = slot; s.reloadLeft = 0;
  s.switchLeft = WEAPONS[s.weapons[slot]].equipTime;
}

export function reload(state: MatchState, id: number) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || !s.alive || s.reloadLeft > 0) return;
  const w = weaponOf(s);
  if (s.ammo[s.weapon] < w.magazine && (s.bot || s.reserve[s.weapon] > 0)) s.reloadLeft = w.reload;
}

export function setLoadout(state: MatchState, id: number, loadout: LoadoutId) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || !(loadout in LOADOUTS)) return;
  s.loadout = loadout;
  // Takes effect on the next deployment unless the soldier has not fired since spawning.
  if (s.alive && s.sinceShot > 50 && s.protectLeft > 0) {
    for (const wid of kitWeapons(loadout)) if (s.bought[slotOf(WEAPONS[wid])] === '') equip(s, wid);
    s.weapon = 0;
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
  if (w.projectile) { launchCharge(state, ctx, s, w, { x: origin.x + dir.x * 0.6, y: origin.y + dir.y * 0.6, z: origin.z + dir.z * 0.6 }, dir); return true; }
  let result: TraceResult | undefined;
  let compensated: { target: Soldier; shift: Vec3 } | undefined;
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
      compensated = { target, shift: lagShift(shape, claim.point) };
    }
  }
  if (w.pellets > 1) {
    // Pellets re-trace the shared fixed pattern; a validated claim moves its target to where the
    // shooter saw it (just far enough for the claimed point to touch the hit shape).
    const feet = (x: Soldier) => {
      const f = feetOf(x);
      return compensated?.target === x ? { x: f.x + compensated.shift.x, y: f.y + compensated.shift.y, z: f.z + compensated.shift.z } : f;
    };
    resolvePellets(state, ctx, s, w, origin, dir, s.ads, feet);
    return true;
  }
  // Without a valid soldier claim, the server traces the shot itself.
  result ??= traceShot({ ...state, soldiers: [] }, ctx, s, origin, dir, w.range);
  resolveShot(state, ctx, s, w, origin, result);
  return true;
}

/** Offset that moves a hit shape just far enough for `point` to lie on its surface. */
function lagShift(shape: ReturnType<typeof hitShape>, point: Vec3): Vec3 {
  const parts = [
    { ...segmentPointDistance(point, shape.chestBottom, shape.chestTop), a: shape.chestBottom, b: shape.chestTop, r: shape.chestR },
    { ...segmentPointDistance(point, shape.foot, shape.hip), a: shape.foot, b: shape.hip, r: shape.legR },
    { distance: dist3(point, shape.head), t: 0, a: shape.head, b: shape.head, r: shape.headR },
  ];
  const best = parts.reduce((x, y) => y.distance - y.r < x.distance - x.r ? y : x);
  if (best.distance <= best.r) return { x: 0, y: 0, z: 0 };
  const q = { x: best.a.x + (best.b.x - best.a.x) * best.t, y: best.a.y + (best.b.y - best.a.y) * best.t, z: best.a.z + (best.b.z - best.a.z) * best.t };
  const k = 1 - best.r / best.distance;
  return { x: (point.x - q.x) * k, y: (point.y - q.y) * k, z: (point.z - q.z) * k };
}

/** Buy menu purchase (validated: alive, buy time or near own spawn, enough credits). */
export function buyItem(state: MatchState, ctx: SimContext, id: number, item: BuyItem) {
  return buy(state, ctx.map, state.soldiers.find(x => x.id === id && !x.bot), item);
}

/** Swap in the weapon lying at pickup `index` (E). Ammo and armor are collected by walking over them. */
export function pickUp(state: MatchState, ctx: SimContext, id: number, index: number) {
  const s = state.soldiers.find(x => x.id === id);
  return !!s && Number.isInteger(index) && takePickup(state, ctx.map, s, index);
}

export function throwGrenade(state: MatchState, ctx: SimContext, id: number, origin: Vec3, dir: Vec3) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || !s.alive || state.phase === 'ended') return false;
  const eye = eyeOf(s);
  const o = [origin.x, origin.y, origin.z, dir.x, dir.y, dir.z].every(Number.isFinite) && dist3(origin, eye) < 2.5 ? origin : eye;
  s.protectLeft = 0;
  return !!throwGrenadeFrom(state, s, o, normalize3(dir));
}

// ---------------------------------------------------------------------------------------
// Simulation tick
// ---------------------------------------------------------------------------------------

export function resetMatch(state: MatchState, ctx: SimContext) {
  state.phase = 'warmup'; state.phaseLeft = state.config.warmup; state.scores = [0, 0]; state.scoreTimer = 0;
  state.time = 0; state.winner = -1;
  state.points = ctx.map.points.map(p => ({ id: p.id, progress: 0, owner: -1, contested: false, capturing: -1 }));
  state.bodies = [];
  state.pickupLeft = (ctx.map.pickups ?? []).map(() => 0);
  for (const s of state.soldiers) { s.kills = 0; s.deaths = 0; s.score = 0; s.captures = 0; s.money = ECONOMY.start; s.bought = ['', '']; spawnSoldier(state, ctx, s); }
  ctx.emit({ type: 'phase', phase: 'warmup', winner: -1 });
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
  for (const s of state.soldiers) {
    updateTimers(state, ctx, s, dt);
    if (s.bot && s.alive) updateBot(state, ctx, s, dt);
  }
  stepWorld(state, ctx, dt);
  updatePoints(state, ctx, dt);

  updatePickups(state, ctx.map, dt);

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
  s.idle += dt;
  if (!s.alive) {
    s.respawnLeft -= dt;
    if (s.respawnLeft <= 0 && state.phase !== 'ended') spawnSoldier(state, ctx, s);
    return;
  }
  s.fireCooldown = Math.max(0, s.fireCooldown - dt);
  s.switchLeft = Math.max(0, s.switchLeft - dt);
  s.protectLeft = Math.max(0, s.protectLeft - dt);
  s.sinceShot += dt; s.sinceHit += dt; s.sinceSpawn += dt;
  if (s.reloadLeft > 0) {
    s.reloadLeft -= dt;
    if (s.reloadLeft <= 0) { s.reloadLeft = 0; finishReload(s, weaponOf(s)); }
  }
  if (s.sinceHit > HEALTH.shieldDelay) s.shield = Math.min(HEALTH.shield, s.shield + HEALTH.shieldRate * dt);
  if (s.sinceHit > HEALTH.healthDelay) s.health = Math.min(HEALTH.max, s.health + HEALTH.healthRate * dt);
  // Falling out of the world is fatal.
  if (s.m.y < -40) killSoldier(state, ctx, s, undefined, 'fall', false);
}

function stepWorld(state: MatchState, ctx: SimContext, dt: number) {
  const before = new Map(state.bodies.map(b => [b.id, { x: b.x, y: b.y, z: b.z }]));
  const steps = Math.max(1, Math.ceil(dt / PHYSICS_STEP - 1e-9));
  for (let i = 0; i < steps; i++) stepBodies(state.bodies, dt / steps, ctx.world);
  const b0 = ctx.map.bounds;
  for (const b of [...state.bodies]) {
    const old = before.get(b.id) ?? b;
    const far = b.x < b0.minX - 60 || b.x > b0.maxX + 60 || b.z < b0.minZ - 60 || b.z > b0.maxZ + 60 || b.y < -40 || b.y > 260;
    if (b.kind === 'grenade') {
      b.timer -= dt;
      if (b.timer <= 0 || far) { removeBody(state, b); if (!far) explode(state, ctx, b); }
    } else {
      // Graviton charges detonate on contact (world.ts spends the fuse), near an enemy, or on timeout.
      const p = WEAPONS.graviton.projectile!;
      b.timer -= dt;
      if (b.timer > 0) for (const s of state.soldiers) {
        if (!s.alive || !isHostile(b.team, s.team)) continue;
        if (segmentPointDistance(chestPoint(feetOf(s), s.m.crouch), old, b).distance < p.proximity) { b.timer = 0; break; }
      }
      if (b.timer <= 0 || far) { removeBody(state, b); if (!far) explode(state, ctx, b, { radius: p.radius, damage: p.damage, weapon: 'graviton' }); }
    }
  }
}

function removeBody(state: MatchState, b: Body) {
  const i = state.bodies.indexOf(b);
  if (i >= 0) state.bodies.splice(i, 1);
}

function updatePoints(state: MatchState, ctx: SimContext, dt: number) {
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
      p.progress += clamp(goal - p.progress, -6 * dt, 6 * dt);
      continue;
    }
    const team: Team = counts[0] > 0 ? 0 : 1;
    const n = Math.min(4, Math.max(counts[0], counts[1]));
    const rate = 100 / CAPTURE_SECONDS * (1 + 0.35 * (n - 1)) * dt;
    p.progress = clamp(p.progress + (team === 0 ? rate : -rate), -100, 100);
    p.capturing = p.owner === team && Math.abs(p.progress) >= 100 ? -1 : team;
    if (p.owner !== -1 && p.owner !== team && (p.owner === 0 ? p.progress <= 0 : p.progress >= 0)) {
      p.owner = -1;
      ctx.emit({ type: 'neutralize', point: p.id, team });
    }
    if (p.owner === -1 && Math.abs(p.progress) >= 100) {
      p.owner = team; p.capturing = -1;
      for (const s of state.soldiers) {
        if (s.alive && s.team === team && Math.hypot(s.m.x - def.x, s.m.z - def.z) <= def.radius) { s.score += 150; s.captures++; award(s, ECONOMY.capture); }
      }
      ctx.emit({ type: 'capture', point: p.id, team });
    }
  }
}
