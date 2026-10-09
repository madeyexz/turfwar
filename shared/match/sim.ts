import { hitShape } from '../hitbox';
import { STEP_HEIGHT } from '../collision';
import { loadMap, loadNav } from '../maps/index';
import type { MapDef } from '../maps/types';
import { clamp, dist3, normalize3, segmentPointDistance, type Vec3 } from '../math';
import { MOVE, createMoveState } from '../movement';
import { FALL, STAMINA, oneHanded, type AttachmentId, type Slot, type WeaponId } from '../weapons';
import { PHYSICS_STEP, stepBodies, type Body } from '../world';
import { botName, createBrain, updateBot } from './bots';
import {
  CASH, award, botShop, buy, buyAttachment, finishReload, newRoundStats, refillAmmo, resetInventory, statsOf, useCrate, type BuyItem,
} from './economy';
import {
  MOVE_SLACK, TICK_RATE, applyDamage, crewTeam, explode, eyeOf, feetOf, killSoldier, onSite, popSmoke, resolvePellets, resolveShot, seatOf, shieldedIds, sideOf, spawnSoldier, throwSmokeFrom,
  throwGrenadeFrom, traceShot, weaponOf, type SimContext, type TraceResult,
} from './combat';
import { ATTACKERS, targetVehicle, type ClientReport, type MatchConfig, type MatchEvent, type MatchState, type RoundEnd, type ShotClaim, type Soldier, type Team } from './state';
import { resetVehicles, shoverSpeed, updateVehicles, vehicleRoof, walksIntoVehicle } from './vehicles';
import { VEHICLES, obstaclesOf, speedOf, vehicleBoxDistance } from '../vehicles';

export { SITE_FLOOR, TICK_RATE, onSite } from './combat';
export { enterVehicle, exitVehicle, reportVehicle, seatOf } from './vehicles';
export type { SimContext } from './combat';

/** Metres from a bomb site's centre within which it can be armed or disarmed. */
export const BOMB_REACH = 3.5;

/** Build a simulation context. `withNav` is needed only where bots are simulated. */
export function createContext(mapId: string, random: () => number, emit: (e: MatchEvent) => void, withNav = true): SimContext {
  const { def, world } = loadMap(mapId);
  return { map: def, world, nav: withNav ? loadNav(mapId) : undefined, random, emit };
}

export function createMatch(mapId: string, config: MatchConfig): MatchState {
  return {
    mapId, phase: 'warmup', phaseLeft: config.warmup, time: 0, tick: 0, scores: [0, 0],
    round: 0, roundPhase: 'freeze', roundClock: 0, roundWinner: -1, lossStreak: [0, 0],
    firstKill: false, firstBlood: false, lastKillTeam: -1, bomb: { site: -1, armed: false, progress: 0, by: -1 },
    soldiers: [], bodies: [], vehicles: [], nextId: 1, winner: -1, config,
  };
}

/** Sabotage needs bomb sites on the map; anywhere else the match is played as Elimination. */
export const modeOf = (state: MatchState, map: MapDef) => state.config.mode === 'sabotage' && map.sabotage?.sites.length ? 'sabotage' : 'elimination';

/** Rounds played before a player stops being a rookie (bots go easier on rookies). */
export const ROOKIE_ROUNDS = 10;
/** A human who joins within this many seconds of a round's start deploys at once instead of waiting a round. */
export const LATE_JOIN_SECONDS = 30;

export function addSoldier(state: MatchState, ctx: SimContext, opts: { name: string; team?: Team; bot: boolean; rookie?: boolean }): Soldier {
  const counts = [0, 1].map(t => state.soldiers.filter(s => s.team === t && !s.bot).length);
  const team: Team = opts.team ?? (counts[0] <= counts[1] ? 0 : 1);
  const s: Soldier = {
    id: state.nextId++, name: opts.name.slice(0, 20), team, bot: opts.bot, ...(opts.rookie && !opts.bot ? { rookie: true } : {}),
    m: createMoveState(0, 0, 0), yaw: 0, pitch: 0, alive: false, health: 0, weapon: 0,
    weapons: ['mp5', 'm9a1'], owned: [], attachments: {}, ammo: [0, 0], reserve: [0, 0],
    reloadLeft: 0, fireCooldown: 0, switchLeft: 0, grenades: 0, grenadeHE: false, smokes: 0, stamina: STAMINA.max, money: 0,
    sinceHit: 99, lastAttacker: -1, kills: 0, deaths: 0, assists: 0, score: 0, sprint: false, ads: false, sinceShot: 99, using: false,
    corrections: 0, moveSlack: MOVE_SLACK.max, groundY: 0, idle: 0, round: newRoundStats(), roundsHere: 0,
  };
  resetInventory(s);
  refillAmmo(s);
  if (opts.bot) s.brain = createBrain(clamp(state.config.botSkill + (ctx.random() - 0.5) * 0.3, 0.15, 0.95));
  state.soldiers.push(s);
  ctx.emit({ type: 'join', id: s.id, name: s.name, team, bot: s.bot });
  // Joining mid-round: you deploy at the next round start (BeGone has no mid-round respawn), except
  // that a human who arrives in a round's first LATE_JOIN_SECONDS (before the bomb is down) deploys in
  // their base at once rather than watching a whole round. In the warmup before a match everyone
  // stands in their base and may walk about (bots wait; nothing can be shot: fireShot / throwGrenade
  // need a live round) until round 1 deploys everyone fresh.
  const young = state.roundPhase === 'live' && state.roundClock <= LATE_JOIN_SECONDS && !state.bomb.armed && !opts.bot;
  if (state.phase === 'warmup' || (state.phase === 'live' && (state.roundPhase === 'freeze' || state.config.practice || young))) spawnSoldier(state, ctx, s);
  return s;
}

export function removeSoldier(state: MatchState, ctx: SimContext, id: number) {
  const i = state.soldiers.findIndex(s => s.id === id);
  if (i < 0) return;
  const [s] = state.soldiers.splice(i, 1);
  ctx.emit({ type: 'leave', id, name: s.name, team: s.team, bot: s.bot });
}

/** Soldiers per team on this server (BeGone sizes: Duel 1, Team Duel 2, Mini 4, Medium 6, Large 8, Mega 12). */
export const teamSizeFor = (config: MatchConfig) => config.teamSize;

/** Keep both teams at the server size by adding or removing bots around the humans. */
export function balanceTeams(state: MatchState, ctx: SimContext) {
  const size = teamSizeFor(state.config);
  for (const team of [0, 1] as Team[]) {
    const members = state.soldiers.filter(s => s.team === team);
    const humans = members.filter(s => !s.bot).length;
    const wantBots = state.config.noBots ? 0 : Math.max(0, size - humans);
    const bots = members.filter(s => s.bot);
    for (let i = bots.length; i < wantBots; i++) addSoldier(state, ctx, { name: botName(state, ctx.random), team, bot: true });
    // Remove dead bots first when a human takes a slot.
    bots.sort((a, b) => Number(a.alive) - Number(b.alive));
    for (let i = 0; i < bots.length - wantBots; i++) removeSoldier(state, ctx, bots[i].id);
  }
}

/**
 * Whether a human may change sides now: `ok`; `later` (mid-round: the client holds the request for
 * the next round's buy freeze); `even` (the other side does not have fewer humans, so a switch would
 * not help: it never makes the human split worse, and a lone human may pick either side); `no` (a
 * bot, the practice range, or no soldier).
 */
export function canSwitchTeam(state: MatchState, s: Soldier | undefined): 'ok' | 'later' | 'even' | 'no' {
  if (!s || s.bot || state.config.practice) return 'no';
  const humans = (team: Team) => state.soldiers.filter(x => !x.bot && x.team === team).length;
  if (humans((1 - s.team) as Team) >= humans(s.team)) return 'even';
  // Only between fights: the buy freeze, the warmup or the result screen.
  return state.phase === 'live' && state.roundPhase !== 'freeze' ? 'later' : 'ok';
}

/**
 * Change a human's side when `canSwitchTeam` allows it: in the buy freeze they redeploy in the new
 * base (keeping what they own); bots then even out both sides (one leaves the new side, one joins
 * the old). Returns whether it happened.
 */
export function switchTeam(state: MatchState, ctx: SimContext, id: number) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || canSwitchTeam(state, s) !== 'ok') return false;
  s.team = (1 - s.team) as Team;
  if (state.phase === 'live' && s.alive) spawnSoldier(state, ctx, s);
  ctx.emit({ type: 'team', id, name: s.name, team: s.team });
  balanceTeams(state, ctx);
  return true;
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
  if (seatOf(state, id)) {
    // In a vehicle the seat decides where you are: only the view, aim and weapon count.
    s.ads = r.ads; s.using = false;
    if (r.weapon !== s.weapon) switchWeapon(state, id, r.weapon);
    return true;
  }
  // Distance budget against server-measured time: it refills at the top movement speed and is
  // capped, so jitter (reports bunching up after a gap) passes, but sending reports faster never
  // buys extra distance.
  const dt = clamp(elapsed, 0, 0.5);
  // A vehicle near us may have pushed us aside (or run us down): its speed adds to the budget.
  const shove = state.vehicles.length ? shoverSpeed(state, s.m) : 0;
  s.moveSlack = Math.min(MOVE_SLACK.max + shove * 0.3, s.moveSlack + (MOVE_SLACK.speed + shove) * dt);
  const horizontal = Math.hypot(r.x - s.m.x, r.z - s.m.z);
  const rise = r.y - s.m.y;
  const cost = Math.hypot(horizontal, Math.max(0, rise));
  // Height checks: nothing lifts a soldier higher above its last floor than a jump plus a
  // step-up onto a ledge (margin for that floor being a report old), and no fall on these maps
  // lasts 2.5 s, so a longer airborne spell is hovering. Either drops the soldier to the floor.
  // Vehicle roofs are floors too.
  const floor = Math.max(ctx.world.groundHeight(r.x, r.z, r.y + 0.05, MOVE.radius), state.vehicles.length ? vehicleRoof(state, { x: r.x, y: r.y + 0.05, z: r.z }) : -Infinity);
  // A soldier on a ladder is held up by it: it counts as a floor (with slack for a report's lag).
  const climbing = !!ctx.world.ladderAt(r.x, r.y, r.z, MOVE.radius + 0.3);
  const airborne = !climbing && r.y - floor > 0.35;
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
  if (cost > s.moveSlack || outOfBounds || ctx.world.overlapsSolid(pos, MOVE.radius * 0.55, 1.2, s.team)
    || (state.vehicles.length && walksIntoVehicle(state, s.m, pos))) {
    s.corrections++;
    return false;
  }
  // Fall damage: landing from a long drop, judged from the fall speed in the previous report.
  const landing = !s.m.grounded && r.grounded && !airborne ? -s.m.vy : 0;
  s.moveSlack -= cost;
  s.m.airTime = airTime;
  if (!airborne) s.groundY = r.y;
  s.m.x = r.x; s.m.y = r.y; s.m.z = r.z; s.m.vx = r.vx; s.m.vy = r.vy; s.m.vz = r.vz;
  s.m.crouch = clamp(r.crouch, 0, 1); s.m.grounded = r.grounded && !airborne;
  s.sprint = r.sprint; s.ads = r.ads; s.using = !!r.use;
  s.m.slideTime = r.slide ? Math.max(s.m.slideTime, 0.2) : 0;
  if (r.weapon !== s.weapon) switchWeapon(state, id, r.weapon);
  if (landing > FALL.safe) applyDamage(state, ctx, s, s.id, (landing - FALL.safe) * FALL.perMs, 'fall', s.m, 'fall');
  return true;
}

export function switchWeapon(state: MatchState, id: number, slot: Slot) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || !s.alive || s.weapon === slot || ![0, 1, 2].includes(slot)) return;
  s.weapon = slot; s.reloadLeft = 0;
  s.switchLeft = statsOf(s, slot).equipTime;
}

export function reload(state: MatchState, id: number) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || !s.alive || s.reloadLeft > 0 || s.weapon === 2) return;
  const w = weaponOf(s);
  if (s.ammo[s.weapon] < w.magazine && (s.bot || s.reserve[s.weapon] > 0)) s.reloadLeft = w.reload;
}

/** Seconds a client's fire clock may run ahead of the server's (network jitter allowance). */
export const FIRE_JITTER = 0.25;
/** Metres a claimed shot origin may sit from the shooter's eye (more aboard a moving vehicle). */
export const SHOT_REACH = 2.5;
const slotOf = (v: number): Slot => (v === 1 || v === 2 ? v : 0);

/** Validate a client's hitscan shot (or knife swing) and its claimed hit. */
export function fireShot(state: MatchState, ctx: SimContext, id: number, claim: ShotClaim) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || s.bot || !s.alive || state.phase !== 'live' || state.roundPhase === 'freeze') return false;
  // Car and helicopter drivers keep both hands on the controls (passengers can shoot); a scooter
  // rider steers with one hand and fires one-handed weapons (pistols, SMGs) with the other.
  const seat = seatOf(state, id);
  if (seat?.seat === 0 && (!VEHICLES[seat.vehicle.kind].driverArms || !oneHanded(statsOf(s, slotOf(claim.weapon))))) return false;
  if (claim.weapon !== s.weapon) switchWeapon(state, id, claim.weapon);
  const w = weaponOf(s);
  const melee = s.weapon === 2;
  // Token-bucket rate limit: network jitter can deliver a few shots at once, so a client may run
  // up to FIRE_JITTER seconds ahead of the server's fire clock. The sustained rate stays capped at
  // the weapon's fire rate, and slow weapons get no instant follow-up shot.
  if (s.reloadLeft > 0.12 || s.switchLeft > 0.12 || s.fireCooldown > FIRE_JITTER || (s.weapon !== 2 && s.ammo[s.weapon] <= 0)) return false;
  const values = [claim.origin.x, claim.origin.y, claim.origin.z, claim.dir.x, claim.dir.y, claim.dir.z, claim.point.x, claim.point.y, claim.point.z];
  if (!values.every(Number.isFinite)) return false;
  if (s.weapon !== 2) s.ammo[s.weapon]--;
  s.fireCooldown = Math.max(0, s.fireCooldown) + w.interval;
  s.sinceShot = 0;
  // The muzzle is near the shooter's eye; aboard a moving vehicle the seat the server knows lags
  // the client's by up to a report, so the allowance grows with the vehicle's speed.
  const eye = eyeOf(s);
  const reach = SHOT_REACH + (seat ? speedOf(seat.vehicle) * 0.1 : 0);
  const origin = dist3(claim.origin, eye) < reach ? claim.origin : eye;
  const dir = normalize3(claim.dir);
  let result: TraceResult | undefined;
  let compensated: { target: Soldier; shift: Vec3 } | undefined;
  const target = claim.target >= 0 ? state.soldiers.find(x => x.id === claim.target) : undefined;
  // A soldier inside a car or the helicopter cannot be hit directly: the body takes those shots.
  if (target && target.alive && target.team !== s.team && claim.zone && !shieldedIds(state).has(target.id)) {
    const distance = dist3(origin, claim.point);
    const shape = hitShape(feetOf(target), target.m.crouch, target.yaw);
    const nearest = Math.min(
      segmentPointDistance(claim.point, shape.chestBottom, shape.chestTop).distance,
      segmentPointDistance(claim.point, shape.foot, shape.hip).distance,
      dist3(claim.point, shape.head),
    );
    const tolerance = 1.1 + Math.hypot(target.m.vx, target.m.vz) * 0.3;
    const toPoint = normalize3({ x: claim.point.x - origin.x, y: claim.point.y - origin.y, z: claim.point.z - origin.z });
    const aligned = toPoint.x * dir.x + toPoint.y * dir.y + toPoint.z * dir.z > Math.cos(melee ? 0.6 : 0.12);
    if (distance <= w.range + (melee ? 0.6 : 0) && nearest <= tolerance && aligned && ctx.world.lineOfSight(origin, claim.point, s.team)) {
      result = { point: claim.point, soldier: target, zone: claim.zone, distance };
      compensated = { target, shift: lagShift(shape, claim.point) };
    }
  }
  const claimed = state.vehicles[targetVehicle(claim.target)];
  if (claimed && !claimed.wrecked && claimed.driver !== id && claimed.passenger !== id && crewTeam(state, claimed) !== s.team) {
    // A claimed hit on a vehicle's body: near the box (moving vehicles get more slack), in range, in sight.
    const distance = dist3(origin, claim.point);
    const toPoint = normalize3({ x: claim.point.x - origin.x, y: claim.point.y - origin.y, z: claim.point.z - origin.z });
    const aligned = toPoint.x * dir.x + toPoint.y * dir.y + toPoint.z * dir.z > Math.cos(melee ? 0.6 : 0.12);
    const near = vehicleBoxDistance(claim.point, claimed) <= 1 + speedOf(claimed) * 0.3 + Math.abs(claimed.vy) * 0.3;
    if (distance <= w.range + (melee ? 0.6 : 0) && near && aligned && ctx.world.lineOfSight(origin, claim.point, s.team)) {
      result = { point: claim.point, vehicle: claimed, distance, surface: 'metal' };
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

/** Store purchase: a weapon (or free swap to an owned one), the M67 or its High Explosive mod. */
export function buyItem(state: MatchState, ctx: SimContext, id: number, item: BuyItem) {
  const s = state.soldiers.find(x => x.id === id && !x.bot);
  return buy(state, ctx.map, s, item, s ? sideOf(state, ctx.map, s.team) : 0);
}

/** Store purchase: an attachment for an owned weapon. */
export function buyAttachmentFor(state: MatchState, id: number, weapon: WeaponId, attachment: AttachmentId) {
  return buyAttachment(state, state.soldiers.find(x => x.id === id && !x.bot), weapon, attachment);
}

/** Use an ammo crate (E). */
export function useAmmoCrate(state: MatchState, ctx: SimContext, id: number, index: number) {
  const s = state.soldiers.find(x => x.id === id);
  return !!s && Number.isInteger(index) && useCrate(state, ctx.map, s, index);
}

/** Throw the M18 smoke grenade: the same checks as the M67 (alive, live round, not driving, a plausible origin). */
export function throwSmoke(state: MatchState, ctx: SimContext, id: number, origin: Vec3, dir: Vec3) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || !s.alive || state.phase !== 'live' || state.roundPhase === 'freeze' || seatOf(state, id)?.seat === 0) return false;
  const eye = eyeOf(s);
  const o = [origin.x, origin.y, origin.z, dir.x, dir.y, dir.z].every(Number.isFinite) && dist3(origin, eye) < 2.5 ? origin : eye;
  return !!throwSmokeFrom(state, s, o, normalize3(dir));
}

export function throwGrenade(state: MatchState, ctx: SimContext, id: number, origin: Vec3, dir: Vec3) {
  const s = state.soldiers.find(x => x.id === id);
  if (!s || !s.alive || state.phase !== 'live' || state.roundPhase === 'freeze' || seatOf(state, id)?.seat === 0) return false;
  const eye = eyeOf(s);
  const o = [origin.x, origin.y, origin.z, dir.x, dir.y, dir.z].every(Number.isFinite) && dist3(origin, eye) < 2.5 ? origin : eye;
  return !!throwGrenadeFrom(state, s, o, normalize3(dir));
}

// ---------------------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------------------

export const roundLength = (state: MatchState, map: MapDef) =>
  modeOf(state, map) === 'sabotage' && map.sabotage!.sites.length === 1 ? state.config.roundTimeSingle : state.config.roundTime;

/** A fresh match: scores and inventories reset (new-match bonus), then round 1. */
export function resetMatch(state: MatchState, ctx: SimContext) {
  state.phase = 'live'; state.scores = [0, 0]; state.round = 0; state.winner = -1; state.time = 0;
  state.lossStreak = [0, 0];
  for (const s of state.soldiers) { s.kills = 0; s.deaths = 0; s.assists = 0; s.score = 0; resetInventory(s); }
  ctx.emit({ type: 'phase', phase: 'live', winner: -1 });
  startRound(state, ctx);
}

/** Everyone deploys in their base with full health and ammo; bots shop; the round freezes briefly. */
export function startRound(state: MatchState, ctx: SimContext, replay = false) {
  if (!replay) state.round++;
  state.roundPhase = 'freeze'; state.phaseLeft = state.config.freezeTime; state.roundClock = 0; state.roundWinner = -1;
  state.firstKill = false; state.firstBlood = false; state.lastKillTeam = -1;
  state.bomb = { site: -1, armed: false, progress: 0, by: -1 };
  state.bodies = [];
  resetVehicles(state, ctx);
  for (const s of state.soldiers) {
    s.round = newRoundStats();
    if (s.bot) botShop(s, ctx.random);
    refillAmmo(s);
    spawnSoldier(state, ctx, s);
  }
  ctx.emit({ type: 'round', phase: 'freeze', round: state.round, winner: -1 });
}

/** Round result and BeGone's round-end cash: win, survival, last man standing, loss bonus, loyalty. */
function endRound(state: MatchState, ctx: SimContext, winner: -1 | Team, reason: RoundEnd) {
  state.roundPhase = 'over'; state.phaseLeft = state.config.roundOverTime; state.roundWinner = winner;
  state.bomb.by = -1;
  if (winner !== -1) {
    const loser = (1 - winner) as Team;
    state.scores[winner]++;
    state.lossStreak[winner] = 0; state.lossStreak[loser]++;
    const winners = state.soldiers.filter(s => s.team === winner);
    const standing = winners.filter(s => s.alive);
    for (const s of winners) award(state, s, CASH.roundWin, 'Round won', ctx.emit);
    if (standing.length === 1) award(state, standing[0], CASH.lastStanding, 'Last man standing', ctx.emit);
    if (state.lossStreak[loser] > CASH.lossBonusAfter) for (const s of state.soldiers) if (s.team === loser) award(state, s, CASH.lossBonus, 'Loss bonus', ctx.emit);
  }
  for (const s of state.soldiers) {
    if (s.alive) award(state, s, CASH.survivor, 'Survived', ctx.emit);
    s.roundsHere++;
    if (s.roundsHere % CASH.loyaltyEvery === 0) award(state, s, CASH.loyalty, 'Loyalty', ctx.emit);
    s.using = false;
  }
  ctx.emit({ type: 'round', phase: 'over', round: state.round, winner, reason });
  if (winner !== -1 && state.scores[winner] >= state.config.roundsToWin) {
    state.phase = 'ended'; state.phaseLeft = state.config.matchOverTime; state.winner = winner;
    ctx.emit({ type: 'phase', phase: 'ended', winner });
  }
}

/** Sabotage: Militia arms a site by holding E still for 5 s; SWAT disarms the same way. */
function updateBomb(state: MatchState, ctx: SimContext, dt: number) {
  const sites = ctx.map.sabotage!.sites.map(id => ctx.map.points.find(p => p.id === id)!);
  const bomb = state.bomb;
  const holding = (s: Soldier, p: { x: number; y: number; z: number }) => s.alive && s.using && s.m.grounded && Math.hypot(s.m.vx, s.m.vz) < 0.6
    && onSite(p, s.m.x, s.m.y, s.m.z, BOMB_REACH);
  if (!bomb.armed) {
    let armer: Soldier | undefined, site = -1;
    for (const s of state.soldiers) {
      if (s.team !== ATTACKERS) continue;
      const i = sites.findIndex(p => holding(s, p));
      if (i >= 0 && (bomb.by === -1 || bomb.by === s.id)) { armer = s; site = i; break; }
    }
    if (!armer) { bomb.by = -1; bomb.progress = 0; bomb.site = -1; return; }
    if (bomb.by !== armer.id || bomb.site !== site) { bomb.by = armer.id; bomb.site = site; bomb.progress = 0; }
    bomb.progress = Math.min(1, bomb.progress + dt / state.config.armTime);
    if (bomb.progress >= 1) {
      bomb.armed = true; bomb.progress = 0; bomb.by = -1;
      state.phaseLeft = state.config.bombTime;
      award(state, armer, CASH.bomb, 'Bomb armed', ctx.emit);
      ctx.emit({ type: 'bomb', action: 'armed', site, by: armer.id });
    }
    return;
  }
  const p = sites[bomb.site];
  const defuser = state.soldiers.find(s => s.team !== ATTACKERS && holding(s, p) && (bomb.by === -1 || bomb.by === s.id));
  if (!defuser) { bomb.by = -1; bomb.progress = 0; return; }
  bomb.by = defuser.id;
  bomb.progress = Math.min(1, bomb.progress + dt / state.config.disarmTime);
  if (bomb.progress >= 1) {
    award(state, defuser, CASH.bomb, 'Bomb disarmed', ctx.emit);
    ctx.emit({ type: 'bomb', action: 'disarmed', site: bomb.site, by: defuser.id });
    endRound(state, ctx, defuser.team, 'disarmed');
  }
}

/** Has the round been decided this tick? */
function checkRoundEnd(state: MatchState, ctx: SimContext) {
  if (state.config.practice) return;
  const alive = [0, 1].map(t => state.soldiers.some(s => s.team === t && s.alive));
  const present = [0, 1].map(t => state.soldiers.some(s => s.team === t));
  if (!present[0] || !present[1]) return;
  const defenders = (1 - ATTACKERS) as Team;
  // The last two traded kills: the team that made the final kill takes the round.
  if (!alive[0] && !alive[1]) { endRound(state, ctx, state.lastKillTeam, 'eliminated'); return; }
  if (modeOf(state, ctx.map) === 'sabotage' && state.bomb.armed) {
    // Once armed, only a disarm (or every SWAT down) ends the round before the blast.
    if (!alive[defenders]) endRound(state, ctx, ATTACKERS, 'eliminated');
    return;
  }
  if (!alive[0]) endRound(state, ctx, 1, 'eliminated');
  else if (!alive[1]) endRound(state, ctx, 0, 'eliminated');
}

/** Elimination: time out with both teams alive is a draw (the round replays). Sabotage: SWAT holds, or the bomb blows. */
function timeOut(state: MatchState, ctx: SimContext) {
  if (state.config.practice) { state.phaseLeft = state.config.roundTime; return; }
  if (modeOf(state, ctx.map) !== 'sabotage') { endRound(state, ctx, -1, 'time'); return; }
  if (state.bomb.armed) {
    const p = ctx.map.points.find(x => x.id === ctx.map.sabotage!.sites[state.bomb.site])!;
    ctx.emit({ type: 'bomb', action: 'exploded', site: state.bomb.site, by: -1 });
    ctx.emit({ type: 'explosion', x: p.x, y: p.y + 0.5, z: p.z, owner: -1, radius: 12, weapon: 'bomb' });
    endRound(state, ctx, ATTACKERS, 'exploded');
  } else endRound(state, ctx, (1 - ATTACKERS) as Team, 'time');
}

export function tickMatch(state: MatchState, ctx: SimContext, dt: number) {
  state.time += dt; state.tick++;
  state.phaseLeft -= dt;
  if (state.phase === 'warmup' || state.phase === 'ended') {
    if (state.phaseLeft <= 0) resetMatch(state, ctx);
  } else {
    state.roundClock += dt;
    if (state.roundPhase === 'freeze' && state.phaseLeft <= 0) {
      state.roundPhase = 'live'; state.phaseLeft = roundLength(state, ctx.map);
      ctx.emit({ type: 'round', phase: 'live', round: state.round, winner: -1 });
    } else if (state.roundPhase === 'over' && state.phaseLeft <= 0) {
      startRound(state, ctx, state.roundWinner === -1);
    }
  }

  const frozen = state.roundPhase === 'freeze' || state.phase !== 'live';
  // The vehicles' bodies, built once per tick: bots walk round them and are pushed by them.
  const obstacles = state.vehicles.length ? obstaclesOf(state.vehicles) : undefined;
  for (const s of state.soldiers) {
    updateTimers(state, ctx, s, dt);
    if (s.bot && s.alive && !frozen) updateBot(state, ctx, s, dt, obstacles);
  }
  updateVehicles(state, ctx, dt);
  stepWorld(state, ctx, dt);
  if (state.phase === 'live' && state.roundPhase === 'live') {
    if (modeOf(state, ctx.map) === 'sabotage') updateBomb(state, ctx, dt);
    if (state.roundPhase === 'live') checkRoundEnd(state, ctx);
    if (state.roundPhase === 'live' && state.phaseLeft <= 0) timeOut(state, ctx);
  }
}

/** Weapon timers and stamina. Health does not regenerate within a round (BeGone). */
function updateTimers(state: MatchState, ctx: SimContext, s: Soldier, dt: number) {
  if (!s.alive) return;
  // Idle (time since the client last reported) counts only while alive: the dead spectate and send
  // no movement reports, so counting them would drop a spectator as a vanished client. A client that
  // vanishes while dead is dropped 45 s after it respawns next round instead.
  s.idle += dt;
  s.fireCooldown = Math.max(0, s.fireCooldown - dt);
  s.switchLeft = Math.max(0, s.switchLeft - dt);
  s.sinceShot += dt; s.sinceHit += dt;
  if (s.reloadLeft > 0) {
    s.reloadLeft -= dt;
    if (s.reloadLeft <= 0) { s.reloadLeft = 0; finishReload(s, weaponOf(s)); }
  }
  if (s.bot) s.stamina = clamp(s.stamina + (s.sprint ? -STAMINA.sprint : s.m.crouch > 0.5 ? STAMINA.regenCrouched : STAMINA.regen) * dt, 0, STAMINA.max);
  // Falling out of the world is fatal.
  if (s.m.y < -40) killSoldier(state, ctx, s, undefined, 'fall', false);
}

function stepWorld(state: MatchState, ctx: SimContext, dt: number) {
  const steps = Math.max(1, Math.ceil(dt / PHYSICS_STEP - 1e-9));
  // Grenades bounce off the vehicles where they are after this tick's driving.
  const obstacles = state.bodies.length && state.vehicles.length ? obstaclesOf(state.vehicles) : undefined;
  for (let i = 0; i < steps; i++) stepBodies(state.bodies, dt / steps, ctx.world, obstacles);
  const b0 = ctx.map.bounds;
  for (const b of [...state.bodies]) {
    const far = b.x < b0.minX - 60 || b.x > b0.maxX + 60 || b.z < b0.minZ - 60 || b.z > b0.maxZ + 60 || b.y < -40 || b.y > 260;
    b.timer -= dt;
    if (b.timer <= 0 || far) {
      removeBody(state, b);
      if (far) continue;
      if (b.kind === 'grenade') explode(state, ctx, b);
      else if (b.kind === 'smoke') popSmoke(state, ctx, b);
      // A cloud whose time is up just clears.
    }
  }
}

function removeBody(state: MatchState, b: Body) {
  const i = state.bodies.indexOf(b);
  if (i >= 0) state.bodies.splice(i, 1);
}
