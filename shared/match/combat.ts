import type { CollisionWorld } from '../collision';
import { chestPoint, hitShape, raycastSoldier } from '../hitbox';
import type { Laws } from '../laws';
import type { MapDef } from '../maps/types';
import { dist3, raySphere, type Vec3 } from '../math';
import { createMoveState, eyeHeight } from '../movement';
import { GRENADE, HEALTH, LOADOUTS, WEAPONS, damageAt, zoneMultiplier, type HitZone, type WeaponDef } from '../weapons';
import { BODY_RADIUS, type Body } from '../world';
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

export const weaponOf = (s: Soldier): WeaponDef => WEAPONS[LOADOUTS[s.loadout].weapons[s.weapon]];
export const eyeOf = (s: Soldier): Vec3 => ({ x: s.m.x, y: s.m.y + eyeHeight(s.m), z: s.m.z });
export const feetOf = (s: Soldier): Vec3 => ({ x: s.m.x, y: s.m.y, z: s.m.z });
export const isHostile = (a: number, b: number) => a !== b || a === -1;

export function spawnSoldier(state: MatchState, ctx: SimContext, s: Soldier) {
  const options = ctx.map.spawns.filter(p => p.team === s.team);
  // Prefer the spawn slot with the most room from teammates who just spawned.
  let best = options[0], bestScore = -Infinity;
  for (const o of options) {
    let near = Infinity;
    for (const other of state.soldiers) if (other.alive && other.id !== s.id) near = Math.min(near, Math.hypot(other.m.x - o.x, other.m.z - o.z));
    const score = Math.min(near, 12) + ctx.random() * 2;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  s.m = createMoveState(best.x + (ctx.random() - 0.5) * 1.5, best.y, best.z + (ctx.random() - 0.5) * 1.5);
  s.m.y = ctx.world.groundHeight(s.m.x, s.m.z, best.y + 1, 0.3);
  s.yaw = best.yaw; s.pitch = 0;
  s.alive = true; s.health = HEALTH.max; s.shield = HEALTH.shield;
  const [a, b] = LOADOUTS[s.loadout].weapons;
  s.ammo = [WEAPONS[a].magazine, WEAPONS[b].magazine]; s.weapon = 0;
  s.reloadLeft = 0; s.fireCooldown = 0; s.switchLeft = 0; s.grenades = GRENADE.perLife;
  s.protectLeft = RESPAWN_PROTECT; s.sinceHit = 99; s.lastAttacker = -1; s.sinceShot = 99;
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

/** Authoritative hitscan against static geometry, enemy soldiers and drones. */
export function traceShot(state: MatchState, ctx: SimContext, shooter: Soldier, origin: Vec3, dir: Vec3, range: number): TraceResult {
  const wall = ctx.world.raycast(origin, dir, range, shooter.team);
  let best = wall ? wall.t : range;
  let result: TraceResult = { point: wall ? wall.point : { x: origin.x + dir.x * range, y: origin.y + dir.y * range, z: origin.z + dir.z * range }, distance: best, surface: wall?.surface };
  for (const s of state.soldiers) {
    if (!s.alive || s.id === shooter.id || s.team === shooter.team) continue;
    if (Math.abs(s.m.x - origin.x) > best + 2 || Math.abs(s.m.z - origin.z) > best + 2) continue;
    const hit = raycastSoldier(origin, dir, hitShape(feetOf(s), s.m.crouch, s.yaw));
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
  if (killer) killer.score += DRONE.score;
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

export function explode(state: MatchState, ctx: SimContext, g: Body) {
  const center = { x: g.x, y: g.y + 0.2, z: g.z };
  ctx.emit({ type: 'explosion', x: g.x, y: g.y, z: g.z, owner: g.owner });
  for (const s of state.soldiers) {
    if (!s.alive) continue;
    const chest = chestPoint(feetOf(s), s.m.crouch);
    const d = dist3(center, chest);
    if (d > GRENADE.radius || !ctx.world.lineOfSight(center, chest, -2)) continue;
    const owner = state.soldiers.find(o => o.id === g.owner);
    if (owner && owner.team === s.team && owner.id !== s.id) continue;
    applyDamage(state, ctx, s, g.owner, GRENADE.damage * (1 - d / GRENADE.radius) ** 1.2, 'blast', center, 'grenade');
  }
  for (const b of [...state.bodies]) {
    if (b.kind !== 'drone' || b.id === g.id) continue;
    const d = dist3(center, b);
    if (d < GRENADE.radius) damageDrone(state, ctx, b, GRENADE.damage * (1 - d / GRENADE.radius), g.owner);
  }
}

export function teamCount(state: MatchState, team: Team, humansOnly = false) {
  return state.soldiers.filter(s => s.team === team && (!humansOnly || !s.bot)).length;
}

export function lawsEqual(a: Laws, b: Laws) { return JSON.stringify(a) === JSON.stringify(b); }
