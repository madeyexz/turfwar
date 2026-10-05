import type { CollisionWorld } from '../collision';
import { chestPoint, hitShape, raycastSoldier } from '../hitbox';
import type { MapDef } from '../maps/types';
import { dist3, type Vec3 } from '../math';
import { createMoveState, eyeHeight } from '../movement';
import { GRENADE, HEALTH, HIGH_EXPLOSIVE, STAMINA, pelletCone, pelletDirs, zoneDamage, type HitZone, type WeaponDef } from '../weapons';
import type { Body } from '../world';
import { CASH, award, statsOf } from './economy';
import type { NavGraph } from './nav';
import { ATTACKERS, type MatchEvent, type MatchState, type Soldier, type Team } from './state';

export interface SimContext {
  map: MapDef;
  world: CollisionWorld;
  nav?: NavGraph;
  random: () => number;
  emit: (event: MatchEvent) => void;
}

export const TICK_RATE = 30;

export const weaponOf = (s: Soldier): WeaponDef => statsOf(s);
export const eyeOf = (s: Soldier): Vec3 => ({ x: s.m.x, y: s.m.y + eyeHeight(s.m), z: s.m.z });
export const feetOf = (s: Soldier): Vec3 => ({ x: s.m.x, y: s.m.y, z: s.m.z });
export const isHostile = (a: number, b: number) => a !== b || a === -1;

/**
 * Distance budget for client-reported movement: refills at `speed` (above slide speed, with room for slide-hops)
 * up to `max` metres: how far a burst of delayed reports may move at once (about 0.7 s of sprinting).
 */
export const MOVE_SLACK = { speed: 14, max: 6 };

/**
 * Which base a team deploys from. Militia attacks in Sabotage; a map whose attacking side is its
 * team-0 base swaps the bases for that mode.
 */
export function sideOf(state: MatchState, map: MapDef, team: Team): Team {
  if (state.config.mode !== 'sabotage' || !map.sabotage) return team;
  const attackerSide = map.sabotage.attackerSpawn;
  return (team === ATTACKERS ? attackerSide : 1 - attackerSide) as Team;
}

/** Deploy a soldier in their base for a new round: full health, stamina and ammo. */
export function spawnSoldier(state: MatchState, ctx: SimContext, s: Soldier) {
  const side = sideOf(state, ctx.map, s.team);
  const options = ctx.map.spawns.filter(p => p.team === side);
  // Prefer the slot with the most room from soldiers already standing in the base.
  let best = options[0], bestScore = -Infinity;
  for (const o of options) {
    let near = Infinity;
    for (const other of state.soldiers) if (other.alive && other.id !== s.id && other.team === s.team) near = Math.min(near, Math.hypot(other.m.x - o.x, other.m.z - o.z));
    // A slot someone already stands on is the last resort (big rooms fill every slot).
    const score = near < 1.3 ? near - 20 : Math.min(near, 12) + ctx.random() * 2;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  s.m = createMoveState(best.x + (ctx.random() - 0.5) * 0.5, best.y, best.z + (ctx.random() - 0.5) * 0.5);
  s.m.y = ctx.world.groundHeight(s.m.x, s.m.z, best.y + 1, 0.3);
  s.yaw = best.yaw; s.pitch = 0;
  s.alive = true; s.health = HEALTH.max; s.stamina = STAMINA.max;
  s.weapon = 0; s.reloadLeft = 0; s.fireCooldown = 0; s.switchLeft = statsOf(s, 0).equipTime;
  s.sinceHit = 99; s.lastAttacker = -1; s.sinceShot = 99; s.moveSlack = MOVE_SLACK.max; s.groundY = s.m.y; s.using = false;
  s.round.streak = 0;
  if (s.brain) { s.brain.path = []; s.brain.target = -1; s.brain.repath = 0; s.brain.goal = ''; }
  ctx.emit({ type: 'spawn', id: s.id });
}

export function applyDamage(state: MatchState, ctx: SimContext, target: Soldier, attackerId: number, amount: number, zone: HitZone | 'blast' | 'fall', from: Vec3, weapon: string) {
  if (!target.alive || amount <= 0 || state.phase === 'ended' || state.roundPhase === 'over') return false;
  const attacker = state.soldiers.find(s => s.id === attackerId);
  if (attacker && attacker.team === target.team && attacker.id !== target.id) return false;
  amount = Math.min(amount, target.health);
  target.health -= amount;
  target.sinceHit = 0;
  if (attacker && attacker !== target) {
    target.lastAttacker = attacker.id;
    target.round.hits.push({ by: attacker.id, at: state.time });
    attacker.round.damage += amount;
    if (!state.firstBlood) { state.firstBlood = true; award(state, attacker, CASH.firstBlood, 'First blood', ctx.emit); }
    if (zone === 'head') {
      const paid = attacker.round.headshots[target.id] ?? 0;
      if (paid < CASH.headshotCap) { attacker.round.headshots[target.id] = paid + 1; award(state, attacker, CASH.headshot, 'Headshot', ctx.emit); }
    }
  }
  ctx.emit({ type: 'damage', target: target.id, attacker: attackerId, amount: Math.round(amount), zone, x: from.x, y: from.y, z: from.z });
  if (target.health <= 0) killSoldier(state, ctx, target, attacker === target ? undefined : attacker, weapon, zone === 'head');
  return true;
}

/** A death, with BeGone's kill-side cash awards (kill, first kill, last enemy, multi-kill, streak, trade, assists). */
export function killSoldier(state: MatchState, ctx: SimContext, victim: Soldier, killer: Soldier | undefined, weapon: string, head: boolean) {
  victim.alive = false; victim.deaths++; victim.health = 0;
  victim.reloadLeft = 0; victim.m.vx = 0; victim.m.vz = 0; victim.using = false; victim.round.streak = 0;
  const lastOfTeam = !state.soldiers.some(s => s.alive && s.team === victim.team);
  if (killer && killer.team !== victim.team) {
    state.lastKillTeam = killer.team;
    killer.kills++; killer.score += head ? 125 : 100;
    const r = killer.round;
    award(state, killer, weapon === 'grenade' ? CASH.grenadeKill : weapon === 'knife' ? CASH.knifeKill : CASH.kill, 'Kill', ctx.emit);
    if (!state.firstKill) { state.firstKill = true; award(state, killer, CASH.firstKill, 'First kill', ctx.emit); }
    if (lastOfTeam) award(state, killer, CASH.lastEnemy, 'Last enemy', ctx.emit);
    r.chain = state.time - r.lastKillAt < CASH.multiKillWindow ? r.chain + 1 : 1;
    r.kills++; r.streak++; r.lastKillAt = state.time; r.lastVictim = victim.id;
    if (r.chain >= 2) award(state, killer, CASH.multiKill * r.chain, `${r.chain}× multi-kill`, ctx.emit);
    if (r.streak % CASH.streakEvery === 0) award(state, killer, CASH.streak * (r.streak / CASH.streakEvery), `${r.streak} kill streak`, ctx.emit);
    // Trade: the two killed each other (the killer already fell to this victim moments ago).
    if (!killer.alive && victim.round.lastVictim === killer.id && state.time - victim.round.lastKillAt < 1) {
      award(state, killer, CASH.trade, 'Trade', ctx.emit); award(state, victim, CASH.trade, 'Trade', ctx.emit);
    }
  }
  // Assists: anyone else who hurt the victim in its last 3 seconds.
  const helped = new Set<number>();
  for (const h of victim.round.hits) {
    if (h.by === killer?.id || helped.has(h.by) || state.time - h.at > CASH.assistWindow) continue;
    const helper = state.soldiers.find(s => s.id === h.by);
    if (!helper || helper.team === victim.team) continue;
    helped.add(h.by); helper.assists++; helper.score += 50;
    award(state, helper, CASH.assist, 'Assist', ctx.emit);
  }
  victim.round.hits = [];
  ctx.emit({ type: 'kill', killer: killer?.id ?? -1, victim: victim.id, weapon, head });
}

/** Spread cone (degrees) for a soldier's current state. */
export function spreadFor(s: Soldier, w: WeaponDef, bloom = 0) {
  const moving = Math.hypot(s.m.vx, s.m.vz) > 1.5;
  let spread = s.ads ? w.spread.ads : w.spread.hip;
  if (moving) spread += w.spread.moving * (s.ads ? 0.35 : 1);
  if (!s.m.grounded) spread += w.spread.air;
  if (s.m.crouch > 0.5 && !moving) spread *= 0.7;
  return spread + bloom;
}

export interface TraceResult { point: Vec3; soldier?: Soldier; zone?: HitZone; distance: number; surface?: string }

/**
 * Authoritative hitscan against static geometry and enemy soldiers. `feet` may move a
 * soldier's hit shape to where the shooter saw it (validated lag compensation for pellets).
 */
export function traceShot(state: MatchState, ctx: SimContext, shooter: Soldier, origin: Vec3, dir: Vec3, range: number, feet: (s: Soldier) => Vec3 = feetOf): TraceResult {
  const wall = ctx.world.raycast(origin, dir, range, shooter.team);
  let best = wall ? wall.t : range;
  let result: TraceResult = { point: wall ? wall.point : { x: origin.x + dir.x * range, y: origin.y + dir.y * range, z: origin.z + dir.z * range }, distance: best, surface: wall?.surface };
  for (const s of state.soldiers) {
    if (!s.alive || s.id === shooter.id || s.team === shooter.team) continue;
    if (Math.abs(s.m.x - origin.x) > best + 2 || Math.abs(s.m.z - origin.z) > best + 2) continue;
    const hit = raycastSoldier(origin, dir, hitShape(feet(s), s.m.crouch, s.yaw));
    if (hit && hit.t < best) {
      best = hit.t;
      result = { point: { x: origin.x + dir.x * hit.t, y: origin.y + dir.y * hit.t, z: origin.z + dir.z * hit.t }, soldier: s, zone: hit.zone, distance: hit.t };
    }
  }
  return result;
}

/** Resolve a hitscan (or knife) result into damage and a replicated tracer event. */
export function resolveShot(state: MatchState, ctx: SimContext, shooter: Soldier, w: WeaponDef, origin: Vec3, result: TraceResult) {
  let hit: 0 | 1 | 2 = 0;
  if (result.soldier && result.zone) {
    if (applyDamage(state, ctx, result.soldier, shooter.id, zoneDamage(w, result.zone), result.zone, origin, w.id)) hit = result.zone === 'head' ? 2 : 1;
  }
  ctx.emit({ type: 'shot', shooter: shooter.id, weapon: w.id, from: origin, to: result.point, hit, surface: result.surface });
}

/**
 * Fire every pellet of a shotgun blast along the weapon's fixed pattern. Damage per target is
 * summed into one hit (a head pellet makes it a headshot); each pellet still leaves a tracer.
 */
export function resolvePellets(state: MatchState, ctx: SimContext, shooter: Soldier, w: WeaponDef, origin: Vec3, dir: Vec3, ads: boolean, feet: (s: Soldier) => Vec3 = feetOf) {
  const hits = new Map<Soldier, { amount: number; head: boolean }>();
  for (const d of pelletDirs(dir, pelletCone(w, ads), w.pellets)) {
    const r = traceShot(state, ctx, shooter, origin, d, w.range, feet);
    let hit: 0 | 1 | 2 = 0;
    if (r.soldier && r.zone) {
      const h = hits.get(r.soldier) ?? { amount: 0, head: false };
      h.amount += zoneDamage(w, r.zone);
      h.head ||= r.zone === 'head';
      hits.set(r.soldier, h);
      hit = r.zone === 'head' ? 2 : 1;
    }
    ctx.emit({ type: 'shot', shooter: shooter.id, weapon: w.id, from: origin, to: r.point, hit, surface: r.surface });
  }
  for (const [target, h] of hits) applyDamage(state, ctx, target, shooter.id, h.amount, h.head ? 'head' : 'body', origin, w.id);
}

export function spawnBody(state: MatchState, kind: Body['kind'], p: Vec3, v: Vec3, owner: number, team: number, hp = 1, timer = 0): Body {
  const body: Body = { id: state.nextId++, kind, x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, age: 0, owner, team, hp, timer };
  state.bodies.push(body);
  return body;
}

/** Throw the M67 (a High Explosive grenade is marked by hp 2). */
export function throwGrenadeFrom(state: MatchState, s: Soldier, origin: Vec3, dir: Vec3) {
  if (!s.alive || s.grenades <= 0) return undefined;
  s.grenades--;
  const v = { x: dir.x * GRENADE.throwSpeed + s.m.vx * 0.5, y: dir.y * GRENADE.throwSpeed + 2.6, z: dir.z * GRENADE.throwSpeed + s.m.vz * 0.5 };
  return spawnBody(state, 'grenade', origin, v, s.id, s.team, s.grenadeHE ? 2 : 1, GRENADE.fuse);
}

/** BeGone's 22-unit blast range, read as a diameter in metres (11 m radius); HE: +45 damage, −6. */
export function blastOf(he: boolean) {
  return { radius: (GRENADE.radius + (he ? HIGH_EXPLOSIVE.radius : 0)) / 2, damage: GRENADE.damage + (he ? HIGH_EXPLOSIVE.damage : 0) };
}

/** Frag blast: damage falls off with distance, blocked by walls, never hurts teammates. */
export function explode(state: MatchState, ctx: SimContext, g: Body) {
  const { radius, damage } = blastOf(g.hp === 2);
  const center = { x: g.x, y: g.y + 0.2, z: g.z };
  ctx.emit({ type: 'explosion', x: g.x, y: g.y, z: g.z, owner: g.owner, radius, weapon: 'grenade' });
  const owner = state.soldiers.find(o => o.id === g.owner);
  for (const s of state.soldiers) {
    if (!s.alive) continue;
    const chest = chestPoint(feetOf(s), s.m.crouch);
    const d = dist3(center, chest);
    if (d > radius || !ctx.world.lineOfSight(center, chest, -2)) continue;
    if (owner && owner.team === s.team && owner.id !== s.id) continue;
    applyDamage(state, ctx, s, g.owner, damage * (1 - d / radius) ** 1.2, 'blast', center, 'grenade');
  }
}

export function teamCount(state: MatchState, team: Team, humansOnly = false) {
  return state.soldiers.filter(s => s.team === team && (!humansOnly || !s.bot)).length;
}
