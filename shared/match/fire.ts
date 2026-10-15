import type { CollisionWorld } from '../collision';
import { normalize3, type Vec3 } from '../math';
import { GRENADE, MOLOTOV, SMOKE } from '../weapons';
import type { Body } from '../world';
import { applyDamage, feetOf, shieldedIds, spawnBody, type SimContext } from './combat';
import type { MatchState, Soldier } from './state';

/** One flame patch's reach (m): a soldier whose feet come this close to a patch's centre is in the fire. */
export const PATCH_RADIUS = MOLOTOV.radius * 0.3;
/** The fire's shape: a centre patch and two rings, fixed angles (client and host agree without sending it). */
const RINGS: { r: number; n: number; phase: number }[] = [{ r: MOLOTOV.radius * 0.37, n: 6, phase: 0 }, { r: MOLOTOV.radius * 0.72, n: 12, phase: Math.PI / 12 }];

/**
 * Where a fire burns: patches on the floor round `f` (its centre on the floor where the bottle broke).
 * A patch counts only if no wall stands between it and the centre and there is floor under it within
 * a step of the centre's height (fire neither climbs walls nor pours over ledges). Deterministic: the
 * client draws the same patches the host burns with.
 */
export function firePatches(world: CollisionWorld, f: Vec3): Vec3[] {
  // Bots ask every tick they stand near one: remember the last few (fires do not move).
  let cache = patchCache.get(world);
  if (!cache) patchCache.set(world, cache = new Map());
  const key = `${f.x}|${f.y}|${f.z}`;
  const known = cache.get(key);
  if (known) return known;
  const patches = shapeFire(world, f);
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, patches);
  return patches;
}
const patchCache = new WeakMap<CollisionWorld, Map<string, Vec3[]>>();

function shapeFire(world: CollisionWorld, f: Vec3): Vec3[] {
  const lift = 0.35, center = { x: f.x, y: f.y + lift, z: f.z };
  const patches: Vec3[] = [{ x: f.x, y: f.y, z: f.z }];
  for (const ring of RINGS) {
    for (let i = 0; i < ring.n; i++) {
      const a = ring.phase + (i / ring.n) * Math.PI * 2;
      const p = { x: f.x + Math.cos(a) * ring.r, y: center.y, z: f.z + Math.sin(a) * ring.r };
      if (!world.lineOfSight(center, p, -2)) continue;
      const hit = world.raycast({ x: p.x, y: f.y + 0.6, z: p.z }, { x: 0, y: -1, z: 0 }, 1.2, -2);
      if (!hit || hit.normal.y < 0.5) continue;
      patches.push({ x: p.x, y: hit.point.y, z: p.z });
    }
  }
  return patches;
}

/** Whether a point lies in a smoke cloud (the sphere smokeBlocks uses). */
function inSmoke(bodies: readonly Body[], p: Vec3) {
  return bodies.some(c => c.kind === 'smokeCloud' && Math.hypot(p.x - c.x, p.y - (c.y + SMOKE.height), p.z - c.z) < SMOKE.radius);
}

/** Throw the 燃燒彈: the M67's arc; it breaks on the first floor it touches (`hp` drops to 0, see world.ts). */
export function throwMolotovFrom(state: MatchState, s: Soldier, origin: Vec3, dir: Vec3) {
  if (!s.alive || s.molotovs <= 0) return undefined;
  s.molotovs--;
  const d = normalize3(dir);
  const v = { x: d.x * GRENADE.throwSpeed + s.m.vx * 0.5, y: d.y * GRENADE.throwSpeed + 2.6, z: d.z * GRENADE.throwSpeed + s.m.vz * 0.5 };
  return spawnBody(state, 'molotov', origin, v, s.id, s.team, 1, MOLOTOV.fuse);
}

/**
 * The bottle broke: on a floor (`hp` 0) it lights a fire there for MOLOTOV.duration, unless it broke
 * in smoke; in the air (the fuse ran out) it fizzles.
 */
export function breakMolotov(state: MatchState, ctx: SimContext, g: Body) {
  const floor = { x: g.x, y: g.y - 0.09, z: g.z };
  if (g.hp > 0 || inSmoke(state.bodies, { x: g.x, y: g.y + 0.3, z: g.z })) {
    ctx.emit({ type: 'molotov', action: 'fizzle', x: g.x, y: g.y, z: g.z, owner: g.owner });
    return undefined;
  }
  ctx.emit({ type: 'molotov', action: 'burst', x: floor.x, y: floor.y, z: floor.z, owner: g.owner });
  return spawnBody(state, 'fire', floor, { x: 0, y: 0, z: 0 }, g.owner, g.team, 1, MOLOTOV.duration);
}

/** A smoke grenade popped at `at`: fires whose flames it covers go out. */
export function smotherFires(state: MatchState, ctx: SimContext, at: Vec3) {
  for (const f of [...state.bodies]) {
    if (f.kind !== 'fire' || Math.abs(f.y - at.y) > SMOKE.height + SMOKE.radius * 0.5) continue;
    if (Math.hypot(f.x - at.x, f.z - at.z) > SMOKE.radius + MOLOTOV.radius * 0.5) continue;
    state.bodies.splice(state.bodies.indexOf(f), 1);
    ctx.emit({ type: 'molotov', action: 'out', x: f.x, y: f.y, z: f.z, owner: f.owner });
  }
}

/** A thrown smoke grenade touching the flames of a fire (it pops there at once, as in Counter-Strike). */
export function smokeInFire(state: MatchState, ctx: SimContext, b: Body) {
  return state.bodies.some(f => f.kind === 'fire' && Math.hypot(b.x - f.x, b.z - f.z) < MOLOTOV.radius + 0.5 && Math.abs(b.y - f.y) < 1
    && inFire(firePatches(ctx.world, f), { x: b.x, y: b.y - 0.2, z: b.z }));
}

/** Whether feet at `p` stand in the flames of `patches` (and `slack` m more, for bots keeping clear). */
export function inFire(patches: readonly Vec3[], p: Vec3, slack = 0) {
  return patches.some(q => p.y - q.y > -0.5 && p.y - q.y < MOLOTOV.height && Math.hypot(p.x - q.x, p.z - q.z) < PATCH_RADIUS + slack);
}

/** Burn everyone standing in a fire, once per MOLOTOV.pulse of the fire's life (call after its age has advanced by `dt`). */
export function burnFires(state: MatchState, ctx: SimContext, dt: number) {
  if (state.roundPhase !== 'live') return;
  let shielded: Set<number> | undefined;
  for (const f of state.bodies) {
    if (f.kind !== 'fire' || Math.floor(f.age / MOLOTOV.pulse) === Math.floor((f.age - dt) / MOLOTOV.pulse)) continue;
    let patches: Vec3[] | undefined;
    for (const s of state.soldiers) {
      if (!s.alive) continue;
      const feet = feetOf(s);
      if (Math.hypot(feet.x - f.x, feet.z - f.z) > MOLOTOV.radius + 0.5 || Math.abs(feet.y - f.y) > MOLOTOV.height + 1) continue;
      shielded ??= shieldedIds(state);
      if (shielded.has(s.id)) continue;
      patches ??= firePatches(ctx.world, f);
      if (inFire(patches, feet)) applyDamage(state, ctx, s, f.owner, MOLOTOV.dps * MOLOTOV.pulse, 'burn', f, 'molotov');
    }
  }
}

/** The fire `slack` m or less from feet at `p`, if any (bots step out of it). */
export function fireNear(state: MatchState, ctx: SimContext, p: Vec3, slack: number) {
  for (const f of state.bodies) {
    if (f.kind !== 'fire' || Math.hypot(p.x - f.x, p.z - f.z) > MOLOTOV.radius + slack + 0.5 || Math.abs(p.y - f.y) > MOLOTOV.height + 1) continue;
    if (inFire(firePatches(ctx.world, f), p, slack)) return f;
  }
  return undefined;
}
