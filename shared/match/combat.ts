import type { CollisionWorld } from '../collision';
import { chestPoint, hitShape, raycastSoldier } from '../hitbox';
import type { Laws } from '../laws';
import type { MapDef } from '../maps/types';
import { dist3, raySphere, type Vec3 } from '../math';
import { createMoveState, eyeHeight } from '../movement';
import { ECONOMY, GRENADE, HEALTH, LOADOUTS, WEAPONS, damageAt, pelletCone, pelletDirs, zoneMultiplier, type HitZone, type WeaponDef } from '../weapons';
import { BODY_RADIUS, type Body } from '../world';
import { award, outfit } from './economy';
import type { NavGraph } from './nav';
import type { MatchEvent, MatchState, Soldier, Team, WorldSnapshot } from './state';

export interface SimContext {
  map: MapDef;
  world: CollisionWorld;
  nav?: NavGraph;
  random: () => number;
  emit: (event: MatchEvent) => void;
  history: { push(s: WorldSnapshot): void; pop(): WorldSnapshot | undefined; peek(): WorldSnapshot | undefined; readonly length: number; clear(): void };
}

export const TICK_RATE = 30;
export const RESPAWN_PROTECT = 1.6;
export const DRONE = { max: 4, hp: 55, range: 28, boltSpeed: 30, boltDamage: 16, interval: 1.35, respawn: 9, score: 50 };

export const weaponOf = (s: Soldier): WeaponDef => WEAPONS[s.weapons[s.weapon]];
export const eyeOf = (s: Soldier): Vec3 => ({ x: s.m.x, y: s.m.y + eyeHeight(s.m), z: s.m.z });
export const feetOf = (s: Soldier): Vec3 => ({ x: s.m.x, y: s.m.y, z: s.m.z });
export const isHostile = (a: number, b: number) => a !== b || a === -1;

/**
 * Distance budget for client-reported movement: refills at `speed` (above slide speed, with room for slide-hops)
 * up to `max` metres: how far a burst of delayed reports may move at once (about 0.7 s of sprinting).
 */
export const MOVE_SLACK = { speed: 14, max: 6 };

export function spawnSoldier(state: MatchState, ctx: SimContext, s: Soldier) {
  // Forward slots open only while the team holds their point uncontested.
  const held = (id: string) => state.points.some(p => p.id === id && p.owner === s.team && !p.contested);
  const options = ctx.map.spawns.filter(p => p.team === s.team && (!p.point || held(p.point)));
  // Prefer the slot with the most room from soldiers who just spawned; never a forward slot with
  // enemies close by, and lean toward the front so big maps do not turn into long walks.
  let best = options[0], bestScore = -Infinity;
  for (const o of options) {
    let near = Infinity, enemy = Infinity;
    for (const other of state.soldiers) {
      if (!other.alive || other.id === s.id) continue;
      const d = Math.hypot(other.m.x - o.x, other.m.z - o.z);
      if (other.team === s.team) near = Math.min(near, d); else enemy = Math.min(enemy, d);
    }
    if (o.point && enemy < 25) continue;
    const score = Math.min(near, 12) + ctx.random() * 2 + (o.point ? 3 : 0);
    if (score > bestScore) { bestScore = score; best = o; }
  }
  s.m = createMoveState(best.x + (ctx.random() - 0.5) * 1.5, best.y, best.z + (ctx.random() - 0.5) * 1.5);
  s.m.y = ctx.world.groundHeight(s.m.x, s.m.z, best.y + 1, 0.3);
  s.yaw = best.yaw; s.pitch = 0;
  s.alive = true; s.health = HEALTH.max; s.shield = HEALTH.shield;
  outfit(s, ctx.random);
  s.reloadLeft = 0; s.fireCooldown = 0; s.switchLeft = 0; s.grenades = GRENADE.perLife;
  s.protectLeft = RESPAWN_PROTECT; s.sinceHit = 99; s.lastAttacker = -1; s.sinceShot = 99; s.moveSlack = MOVE_SLACK.max; s.groundY = s.m.y;
  if (s.brain) { s.brain.path = []; s.brain.target = -1; s.brain.repath = 0; s.brain.goal = ''; }
  ctx.emit({ type: 'spawn', id: s.id });
}

export function applyDamage(state: MatchState, ctx: SimContext, target: Soldier, attackerId: number, amount: number, zone: HitZone | 'blast' | 'bolt', from: Vec3, weapon: string) {
  if (!target.alive || target.protectLeft > 0 || amount <= 0 || state.phase === 'ended') return false;
  const attacker = state.soldiers.find(s => s.id === attackerId);
  if (attacker && attacker.team === target.team && attacker.id !== target.id) return false;
  const hadShield = target.shield > 0;
  const absorbed = Math.min(target.shield, amount);
  target.shield -= absorbed;
  target.health = Math.max(0, target.health - (amount - absorbed));
  target.sinceHit = 0;
  if (attacker) target.lastAttacker = attacker.id;
  ctx.emit({ type: 'damage', target: target.id, attacker: attackerId, amount: Math.round(amount), zone, x: from.x, y: from.y, z: from.z, shieldBroke: hadShield && target.shield <= 0 });
  if (target.health <= 0) killSoldier(state, ctx, target, attacker, weapon, zone === 'head');
  return true;
}

export function killSoldier(state: MatchState, ctx: SimContext, victim: Soldier, killer: Soldier | undefined, weapon: string, head: boolean) {
  victim.alive = false; victim.deaths++; victim.respawnLeft = state.config.respawn;
  victim.reloadLeft = 0; victim.m.vx = 0; victim.m.vz = 0;
  if (killer && killer.id !== victim.id) {
    killer.kills++; killer.score += head ? 125 : 100;
    if (killer.team !== victim.team) award(killer, ECONOMY.kill + (head ? ECONOMY.headshotBonus : 0));
    if (state.phase === 'live') state.scores[killer.team] += 1;
  }
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

export interface TraceResult { point: Vec3; soldier?: Soldier; zone?: HitZone; drone?: Body; distance: number; surface?: string }

/**
 * Authoritative hitscan against static geometry, enemy soldiers and drones. `feet` may move a
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
  for (const b of state.bodies) {
    if (b.kind !== 'drone' || !isHostile(b.team, shooter.team)) continue;
    const t = raySphere(origin, dir, b, BODY_RADIUS.drone);
    if (t >= 0 && t < best) {
      best = t;
      result = { point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t }, drone: b, distance: t };
    }
  }
  return result;
}

export function damageDrone(state: MatchState, ctx: SimContext, drone: Body, amount: number, killerId: number) {
  drone.hp -= amount;
  if (drone.hp > 0) return;
  const i = state.bodies.indexOf(drone);
  if (i >= 0) state.bodies.splice(i, 1);
  const killer = state.soldiers.find(s => s.id === killerId);
  if (killer) { killer.score += DRONE.score; award(killer, ECONOMY.droneKill); }
  ctx.emit({ type: 'droneDown', x: drone.x, y: drone.y, z: drone.z, killer: killerId });
}

/** Resolve a hitscan shot result into damage and a replicated tracer event. */
export function resolveShot(state: MatchState, ctx: SimContext, shooter: Soldier, w: WeaponDef, origin: Vec3, result: TraceResult) {
  let hit: 0 | 1 | 2 = 0;
  if (result.soldier && result.zone) {
    const amount = damageAt(w, result.distance) * zoneMultiplier(w, result.zone);
    if (applyDamage(state, ctx, result.soldier, shooter.id, amount, result.zone, origin, w.id)) hit = result.zone === 'head' ? 2 : 1;
  } else if (result.drone) {
    damageDrone(state, ctx, result.drone, damageAt(w, result.distance), shooter.id); hit = 1;
  }
  ctx.emit({ type: 'shot', shooter: shooter.id, weapon: w.id, from: origin, to: result.point, hit, surface: result.surface });
}

/**
 * Fire every pellet of a scattergun shot along the weapon's fixed pattern. Damage per target is
 * summed into one hit (a head pellet makes it a headshot); each pellet still leaves a tracer.
 */
export function resolvePellets(state: MatchState, ctx: SimContext, shooter: Soldier, w: WeaponDef, origin: Vec3, dir: Vec3, ads: boolean, feet: (s: Soldier) => Vec3 = feetOf) {
  const hits = new Map<Soldier, { amount: number; head: boolean }>();
  for (const d of pelletDirs(dir, pelletCone(w, ads), w.pellets)) {
    const r = traceShot(state, ctx, shooter, origin, d, w.range, feet);
    let hit: 0 | 1 | 2 = 0;
    if (r.soldier && r.zone) {
      const h = hits.get(r.soldier) ?? { amount: 0, head: false };
      h.amount += damageAt(w, r.distance) * zoneMultiplier(w, r.zone);
      h.head ||= r.zone === 'head';
      hits.set(r.soldier, h);
      hit = r.zone === 'head' ? 2 : 1;
    } else if (r.drone) {
      damageDrone(state, ctx, r.drone, damageAt(w, r.distance), shooter.id); hit = 1;
    }
    ctx.emit({ type: 'shot', shooter: shooter.id, weapon: w.id, from: origin, to: r.point, hit, surface: r.surface });
  }
  for (const [target, h] of hits) applyDamage(state, ctx, target, shooter.id, h.amount, h.head ? 'head' : 'body', origin, w.id);
}

/** Launch a graviton charge: a lawful body that bends with gravity and time, detonating on contact. */
export function launchCharge(state: MatchState, ctx: SimContext, s: Soldier, w: WeaponDef, origin: Vec3, dir: Vec3) {
  const p = w.projectile!;
  const v = { x: dir.x * p.speed + s.m.vx * 0.3, y: dir.y * p.speed + s.m.vy * 0.3, z: dir.z * p.speed + s.m.vz * 0.3 };
  // A zero-length shot event carries the muzzle report to other clients.
  ctx.emit({ type: 'shot', shooter: s.id, weapon: w.id, from: origin, to: origin, hit: 0 });
  return spawnBody(state, 'charge', origin, v, s.id, s.team, 1, p.fuse);
}

export function spawnBody(state: MatchState, kind: Body['kind'], p: Vec3, v: Vec3, owner: number, team: number, hp = 1, timer = 0): Body {
  const body: Body = { id: state.nextId++, kind, x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, age: 0, owner, team, hp, timer };
  state.bodies.push(body);
  return body;
}

export function throwGrenadeFrom(state: MatchState, s: Soldier, origin: Vec3, dir: Vec3) {
  if (!s.alive || s.grenades <= 0) return undefined;
  s.grenades--;
  const v = { x: dir.x * GRENADE.throwSpeed + s.m.vx * 0.5, y: dir.y * GRENADE.throwSpeed + 2.6, z: dir.z * GRENADE.throwSpeed + s.m.vz * 0.5 };
  return spawnBody(state, 'grenade', origin, v, s.id, s.team, 1, GRENADE.fuse);
}

export interface Blast { radius: number; damage: number; weapon: string }
const GRENADE_BLAST: Blast = { radius: GRENADE.radius, damage: GRENADE.damage, weapon: 'grenade' };

export function explode(state: MatchState, ctx: SimContext, g: Body, blast: Blast = GRENADE_BLAST) {
  const center = { x: g.x, y: g.y + 0.2, z: g.z };
  ctx.emit({ type: 'explosion', x: g.x, y: g.y, z: g.z, owner: g.owner, radius: blast.radius, weapon: blast.weapon });
  for (const s of state.soldiers) {
    if (!s.alive) continue;
    const chest = chestPoint(feetOf(s), s.m.crouch);
    const d = dist3(center, chest);
    if (d > blast.radius || !ctx.world.lineOfSight(center, chest, -2)) continue;
    const owner = state.soldiers.find(o => o.id === g.owner);
    if (owner && owner.team === s.team && owner.id !== s.id) continue;
    applyDamage(state, ctx, s, g.owner, blast.damage * (1 - d / blast.radius) ** 1.2, 'blast', center, blast.weapon);
  }
  for (const b of [...state.bodies]) {
    if (b.kind !== 'drone' || b.id === g.id) continue;
    const d = dist3(center, b);
    if (d < blast.radius) damageDrone(state, ctx, b, blast.damage * (1 - d / blast.radius), g.owner);
  }
}

export function teamCount(state: MatchState, team: Team, humansOnly = false) {
  return state.soldiers.filter(s => s.team === team && (!humansOnly || !s.bot)).length;
}

export function lawsEqual(a: Laws, b: Laws) { return JSON.stringify(a) === JSON.stringify(b); }
