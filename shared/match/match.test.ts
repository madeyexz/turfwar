import { describe, expect, it } from 'vitest';
import { MAP_IDS, loadMap, loadNav } from '../maps/index';
import { rng, wrapAngle } from '../math';
import { CollisionWorld } from '../collision';
import { createMoveState, eyeHeight, stepMovement } from '../movement';
import { hitShape } from '../hitbox';
import { ECONOMY, GRENADE, LOADOUTS, WEAPONS, pelletCone, pelletDirs } from '../weapons';
import { findPath, nearestNode } from './nav';
import { addSoldier, balanceTeams, buyItem, createContext, createMatch, fireShot, pickUp, reload, reportState, teamSizeFor, tickMatch, TICK_RATE } from './sim';
import { OFFLINE_CONFIG, ONLINE_CONFIG, PRACTICE_CONFIG, type MatchEvent, type MatchState, type Soldier } from './state';
import { MOVE_SLACK, eyeOf, killSoldier, spawnSoldier, type SimContext } from './combat';
import { decodeFrame, encodeFrame } from './frame';

function setup(config = OFFLINE_CONFIG, seed = 1) {
  const events: MatchEvent[] = [];
  const random = rng(seed);
  const ctx = createContext('cinder', random, e => events.push(e));
  const state = createMatch('cinder', { ...config }, random);
  return { ctx, state, events };
}
const tick = (state: MatchState, ctx: SimContext, seconds: number) => { for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) tickMatch(state, ctx, 1 / TICK_RATE); };
const place = (s: Soldier, x: number, z: number, ctx: SimContext, fromY = 50) => { s.m.x = x; s.m.z = z; s.m.y = ctx.world.groundHeight(x, z, fromY, 0.3); s.m.vx = s.m.vz = 0; };
const report = (s: Soldier, over: Partial<Parameters<typeof reportState>[3]> = {}) =>
  ({ x: s.m.x, y: s.m.y, z: s.m.z, vx: 0, vy: 0, vz: 0, yaw: s.yaw, pitch: 0, crouch: 0, grounded: true, sprint: false, ads: false, weapon: 0 as const, ...over });

describe('maps and navigation', () => {
  for (const id of MAP_IDS) {
    it(`${id}: every capture point is reachable from both spawns`, () => {
      const { def } = loadMap(id); const nav = loadNav(id);
      const ids = def.points.map(p => p.id).sort();
      expect(ids).toEqual(['A', 'B', 'C', 'D', 'E'].slice(0, ids.length));
      expect([3, 5]).toContain(ids.length);
      for (const team of [0, 1]) {
        const sp = def.spawns.find(s => s.team === team)!;
        const start = nearestNode(nav, sp.x, sp.y, sp.z);
        for (const p of def.points) expect(findPath(nav, start, nearestNode(nav, p.x, p.y, p.z)).length, `${team}->${p.id}`).toBeGreaterThan(3);
      }
    });
    // Ochre Quarter keeps its source layout's attacker/defender asymmetry on purpose.
    it.skipIf(id === 'ochre')(`${id}: is rotationally symmetric for fairness`, () => {
      const { def } = loadMap(id);
      const key = (s: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number }) => [s.minX, s.maxX, s.minZ, s.maxZ, s.minY, s.maxY].map(v => v.toFixed(2)).join();
      const all = new Set(def.solids.map(key));
      for (const s of def.solids) expect(all.has(key({ minX: -s.maxX, maxX: -s.minX, minZ: -s.maxZ, maxZ: -s.minZ, minY: s.minY, maxY: s.maxY }))).toBe(true);
    });
    it(`${id}: spawns and pickups are clear of geometry`, () => {
      const { def, world } = loadMap(id);
      for (const sp of def.spawns) expect(world.overlapsSolid({ x: sp.x, y: sp.y, z: sp.z }, 0.35, 1.7)).toBe(false);
      for (const p of def.pickups ?? []) expect(world.overlapsSolid({ x: p.x, y: p.y + 0.05, z: p.z }, 0.3, 1.2), `${p.item}@${p.x},${p.z}`).toBe(false);
    });
  }
});

describe('bot match', () => {
  it('bots navigate, fight and capture objectives on their own', () => {
    const { ctx, state, events } = setup({ ...OFFLINE_CONFIG, teamSize: 5 }, 7);
    balanceTeams(state, ctx);
    tick(state, ctx, 100);
    expect(events.filter(e => e.type === 'kill').length).toBeGreaterThan(4);
    expect(events.filter(e => e.type === 'capture').length).toBeGreaterThan(1);
    expect(state.scores[0] + state.scores[1]).toBeGreaterThan(10);
    for (const s of state.soldiers) {
      const b = ctx.map.bounds;
      expect(s.m.x).toBeGreaterThanOrEqual(b.minX); expect(s.m.x).toBeLessThanOrEqual(b.maxX);
      if (s.alive) expect(ctx.world.overlapsSolid(s.m, 0.2, 1.2)).toBe(false);
    }
  });
});

describe('server-side validation', () => {
  function duel() {
    const env = setup();
    const a = addSoldier(env.state, env.ctx, { name: 'A', team: 0, bot: false });
    const b = addSoldier(env.state, env.ctx, { name: 'B', team: 1, bot: false });
    a.protectLeft = b.protectLeft = 0;
    // Open ground south of the reactor deck.
    place(a, -6, 22, env.ctx); place(b, 6, 22, env.ctx);
    a.yaw = -Math.PI / 2;
    return { ...env, a, b };
  }
  const claimAt = (a: Soldier, b: Soldier, zone: 'head' | 'body' = 'body') => {
    const origin = { x: a.m.x, y: a.m.y + eyeHeight(a.m), z: a.m.z };
    const shape = hitShape(b.m, b.m.crouch, b.yaw);
    const point = zone === 'head' ? shape.head : { x: b.m.x, y: b.m.y + 1.2, z: b.m.z };
    const d = Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z);
    return { weapon: 0 as const, origin, dir: { x: (point.x - origin.x) / d, y: (point.y - origin.y) / d, z: (point.z - origin.z) / d }, target: b.id, zone, point };
  };

  it('accepts plausible hits and applies shield, health, headshot and kill credit', () => {
    const { state, ctx, a, b, events } = duel();
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(true);
    expect(b.shield).toBeLessThan(50);
    let shots = 1;
    while (b.alive && shots < 20) { a.fireCooldown = 0; fireShot(state, ctx, a.id, claimAt(a, b, 'head')); shots++; }
    expect(b.alive).toBe(false);
    expect(a.kills).toBe(1);
    expect(events.some(e => e.type === 'kill' && e.head)).toBe(true);
    expect(shots).toBeLessThan(7);
  });

  it('rejects claims through walls, far from the target, too fast, or with an empty magazine', () => {
    const { state, ctx, a, b } = duel();
    // Far-off claimed point.
    const far = claimAt(a, b); far.point = { ...far.point, y: far.point.y + 4 };
    fireShot(state, ctx, a.id, far);
    expect(b.shield).toBe(50);
    // Rate limit: a short burst is tolerated (network jitter) but the fourth instant shot is refused.
    a.fireCooldown = 0;
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(true);
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(true);
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(true);
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(false);
    // Slow weapons get no burst: a second instant rail shot is refused, a timely one accepted.
    a.loadout = 'recon'; a.weapons = ['lancer', 'magnum']; a.ammo = [5, 6]; a.fireCooldown = 0; b.health = 1000;
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(true);
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(false);
    a.fireCooldown -= 0.8;
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(true);
    expect(b.health).toBeLessThan(1000 - 92);
    a.loadout = 'assault'; a.weapons = ['carbine', 'sidearm']; a.ammo = [30, 14]; b.health = 100; b.shield = 50;
    // Empty magazine.
    a.fireCooldown = 0; a.ammo[0] = 0;
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(false);
    // Through the reactor pylon: put the target behind it.
    a.ammo[0] = 30; a.fireCooldown = 0; b.shield = 50; b.health = 100;
    place(a, -8, 0, ctx); a.m.y = 0.1; place(b, 8, 0, ctx); b.m.y = 0.1;
    fireShot(state, ctx, a.id, claimAt(a, b));
    expect(b.shield).toBe(50);
  });

  it('accepts a full-auto magazine fired at the real rate despite network jitter', () => {
    const { state, ctx, a, b } = duel();
    const r = rng(7), interval = WEAPONS.carbine.interval;
    // Shots leave the client evenly at 690 RPM and arrive up to ±60 ms early or late; the server ticks at 30 Hz.
    const arrivals = Array.from({ length: 30 }, (_, i) => i * interval + 0.08 + (r() - 0.5) * 0.12).sort((x, y) => x - y);
    let now = 0, accepted = 0;
    for (const t of arrivals) {
      while (now + 1 / TICK_RATE <= t) { tickMatch(state, ctx, 1 / TICK_RATE); now += 1 / TICK_RATE; }
      if (fireShot(state, ctx, a.id, claimAt(a, b))) accepted++;
    }
    expect(accepted).toBe(30);
  });

  it('never applies friendly fire', () => {
    const { state, ctx, a } = duel();
    const mate = addSoldier(state, ctx, { name: 'M', team: 0, bot: false });
    mate.protectLeft = 0; place(mate, 0, 22, ctx);
    fireShot(state, ctx, a.id, claimAt(a, mate));
    expect(mate.shield).toBe(50);
  });

  it('rejects teleports and entering the enemy spawn shield, accepts normal movement', () => {
    const { state, ctx, a } = duel();
    expect(reportState(state, ctx, a.id, report(a, { x: a.m.x + 0.2 }), 1 / 20)).toBe(true);
    expect(reportState(state, ctx, a.id, report(a, { x: a.m.x + 25 }), 1 / 20)).toBe(false);
    expect(a.corrections).toBe(1);
    // Team 1's shield sits at x = +66.6: team 0 cannot stand inside it.
    place(a, 66.2, 0, ctx);
    expect(reportState(state, ctx, a.id, report(a, { x: 66.6 }), 1 / 20)).toBe(false);
  });

  it('absorbs network jitter but never pays for report spam', () => {
    const { state, ctx, a } = duel();
    // Sprinting at 8.8 m/s reported at 20 Hz, but delivered in uneven bunches (0, 0, 150 ms gaps).
    const gaps = [0.002, 0.002, 0.146, 0.05, 0.004, 0.096];
    for (let i = 0; i < 60; i++) {
      expect(reportState(state, ctx, a.id, report(a, { x: a.m.x + 8.8 / 20 }), gaps[i % gaps.length])).toBe(true);
      a.m.x -= 8.8 / 20; // stay on open ground
    }
    expect(a.corrections).toBe(0);
    // A speed hack sending 200 reports per second, each 0.5 m apart (100 m/s), gets at most the
    // budget for that second (burst cap plus one second at the speed limit), not 100 m.
    let moved = 0;
    for (let i = 0; i < 200; i++) {
      const dir = i % 2 ? -1 : 1;
      if (reportState(state, ctx, a.id, report(a, { x: a.m.x + 0.5 * dir }), 0.005)) moved += 0.5;
    }
    expect(moved).toBeLessThanOrEqual(MOVE_SLACK.max + MOVE_SLACK.speed * 1);
    expect(moved).toBeLessThan(25);
    // Vertical: a stream of small rises cannot climb past a jump's height, nor hover there.
    const y0 = a.m.y;
    for (let i = 0; i < 50; i++) reportState(state, ctx, a.id, report(a, { y: a.m.y + 0.3 }), 0.05);
    expect(a.m.y - y0).toBeLessThan(2.4);
    for (let i = 0; i < 80; i++) reportState(state, ctx, a.id, report(a), 0.05);
    expect(a.m.y - y0).toBeLessThan(0.36);
    // Nor can it pop up onto a roof in one report.
    expect(reportState(state, ctx, a.id, report(a, { y: a.m.y + 4 }), 0.5)).toBe(false);
  });

  it('accepts a jump that steps up onto a ledge higher than the jump itself', () => {
    const env = duel(), a = env.a;
    const flat = { x0: -100, z0: -100, spacing: 4, n: 51, heights: new Float32Array(51 * 51) };
    const bounds = { minX: -90, maxX: 90, minZ: -90, maxZ: 90 };
    const world = new CollisionWorld([{ minX: 6, minY: 0, minZ: -2, maxX: 12, maxY: 1.7, maxZ: 2, surface: 'metal' }], [], flat, bounds);
    const ctx = { ...env.ctx, world, map: { ...env.ctx.map, bounds } };
    const m = createMoveState(0, 0, 0);
    a.m = { ...m }; a.groundY = 0;
    for (let i = 1; i <= 110; i++) {
      stepMovement(world, m, { forward: 1, strafe: 0, yaw: -Math.PI / 2, jump: m.x > 3 && m.x < 3.3, crouch: false, sprint: true, ads: false }, 1 / 120, a.team);
      if (i % 6 === 0) reportState(env.state, ctx, a.id, { x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, yaw: 0, pitch: 0, crouch: 0, grounded: m.grounded, sprint: true, ads: false, weapon: 0 }, 0.05);
    }
    expect(m.y).toBeCloseTo(1.7, 2); // landed on top (1.2 m jump + step-up)
    expect(a.corrections).toBe(0);
    expect(a.m.y).toBeCloseTo(1.7, 2);
  });

  it('never corrects a legitimate run: sprinting, slide-hops and jumps over terrain, with network jitter', () => {
    const { state, ctx, a } = duel();
    const m = { ...a.m }, r = rng(3), dt = 1 / 120;
    let t = 0, yaw = -Math.PI / 2, nextSend = 0.05, lastArrival = 0, jumps = 0, slides = 0;
    const arrivals: { at: number; report: Parameters<typeof reportState>[3] }[] = [];
    for (let i = 0; i < 120 * 14; i++) {
      t += dt;
      yaw += Math.sin(t * 0.6) * 0.006;
      // Slide every ~2.3 s, hop out of it, and jump regularly in between.
      const phase = t % 2.3;
      const ev = stepMovement(ctx.world, m, { forward: 1, strafe: 0, yaw, jump: phase > 2.25 || t % 0.9 < 0.04, crouch: phase > 1.9 && phase < 2.2, sprint: true, ads: false }, dt, a.team);
      if (ev.jumped) jumps++;
      if (ev.slideStarted) slides++;
      if (t >= nextSend) {
        nextSend += 0.05;
        // Latency 30–130 ms, plus an occasional 350 ms stall; a websocket keeps order, so stalled reports arrive bunched.
        const latency = 0.03 + r() * 0.1 + (r() < 0.03 ? 0.35 : 0);
        lastArrival = Math.max(lastArrival, t + latency);
        arrivals.push({ at: lastArrival, report: { x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, yaw, pitch: 0, crouch: m.crouch, grounded: m.grounded, sprint: true, ads: false, slide: m.slideTime > 0, weapon: 0 } });
      }
    }
    let prev = 0;
    for (const { at, report: rep } of arrivals) { reportState(state, ctx, a.id, rep, at - prev); prev = at; }
    expect(Math.hypot(m.x - (-6), m.z - 22)).toBeGreaterThan(40);
    expect(jumps).toBeGreaterThan(8);
    expect(slides).toBeGreaterThan(2);
    expect(a.corrections).toBe(0);
  });
});

describe('new weapons', () => {
  function duel(loadout: 'breacher' | 'grenadier', gap: number) {
    const env = setup();
    const a = addSoldier(env.state, env.ctx, { name: 'A', team: 0, bot: false, loadout });
    const b = addSoldier(env.state, env.ctx, { name: 'B', team: 1, bot: false });
    a.protectLeft = b.protectLeft = 0; a.alive = b.alive = true; a.health = b.health = 100; a.shield = b.shield = 50;
    a.ammo = [WEAPONS[LOADOUTS[loadout].weapons[0]].magazine, 14];
    place(a, -gap / 2, 22, env.ctx); place(b, gap / 2, 22, env.ctx);
    a.yaw = -Math.PI / 2;
    return { ...env, a, b };
  }
  const aimAt = (a: Soldier, b: Soldier, dy = 0) => {
    const origin = { x: a.m.x, y: a.m.y + eyeHeight(a.m), z: a.m.z };
    const point = { x: b.m.x, y: b.m.y + 1.2 + dy, z: b.m.z };
    const d = Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z);
    return { weapon: 0 as const, origin, dir: { x: (point.x - origin.x) / d, y: (point.y - origin.y) / d, z: (point.z - origin.z) / d }, target: b.id, zone: 'body' as const, point };
  };
  const health = (s: Soldier) => s.health + s.shield;

  it('every kit pairs two known weapons', () => {
    for (const l of Object.values(LOADOUTS)) for (const id of l.weapons) expect(WEAPONS[id].id).toBe(id);
  });

  it('pellets follow one fixed pattern inside the cone', () => {
    const dir = { x: 0.6, y: -0.2, z: -0.77 }, cone = pelletCone(WEAPONS.scatter, false);
    const a = pelletDirs(dir, cone, 9), b = pelletDirs(dir, cone, 9);
    expect(a).toEqual(b);
    expect(a).toHaveLength(9);
    const len = Math.hypot(dir.x, dir.y, dir.z);
    for (const d of a) {
      const angle = Math.acos(Math.min(1, (d.x * dir.x + d.y * dir.y + d.z * dir.z) / len)) * 180 / Math.PI;
      expect(angle).toBeLessThanOrEqual(cone + 1e-6);
    }
  });

  it('the scattergun shreds up close, falls off at range, and is paced by its pump', () => {
    const near = duel('breacher', 5);
    expect(fireShot(near.state, near.ctx, near.a.id, aimAt(near.a, near.b))).toBe(true);
    const closeDamage = 150 - health(near.b);
    expect(closeDamage).toBeGreaterThan(80);
    // One trigger pull is one claim: an instant second pull is refused.
    expect(fireShot(near.state, near.ctx, near.a.id, aimAt(near.a, near.b))).toBe(false);
    expect(near.a.ammo[0]).toBe(WEAPONS.scatter.magazine - 1);
    const far = duel('breacher', 30);
    fireShot(far.state, far.ctx, far.a.id, aimAt(far.a, far.b));
    expect(150 - health(far.b)).toBeLessThan(closeDamage / 3);
  });

  it('moves a lagging pellet target to the validated claim, but no further', () => {
    const { state, ctx, a, b } = duel('breacher', 6);
    const claim = aimAt(a, b);
    // The server sees the target 0.6 m behind where the shooter saw (and claimed) it.
    b.m.z += 0.6;
    fireShot(state, ctx, a.id, claim);
    expect(150 - health(b)).toBeGreaterThan(60);
    // A claim far from the target is ignored, and the pattern is traced against the real position.
    const other = duel('breacher', 6);
    const bogus = aimAt(other.a, other.b); bogus.point = { ...bogus.point, y: bogus.point.y + 3 };
    other.b.m.z += 3;
    fireShot(other.state, other.ctx, other.a.id, bogus);
    expect(health(other.b)).toBe(150);
  });

  it('graviton charges fly in an arc and detonate on contact or near an enemy', () => {
    const { state, ctx, a, b, events } = duel('grenadier', 16);
    expect(fireShot(state, ctx, a.id, aimAt(a, b))).toBe(true);
    expect(state.bodies.filter(x => x.kind === 'charge')).toHaveLength(1);
    tick(state, ctx, 1);
    expect(state.bodies.some(x => x.kind === 'charge')).toBe(false);
    expect(events.some(e => e.type === 'explosion' && e.weapon === 'graviton')).toBe(true);
    expect(health(b)).toBeLessThan(150 - 40);

    // Fired level, the next charge drops below its line of fire.
    const arc = duel('grenadier', 40);
    arc.a.pitch = 0;
    const eye = eyeOf(arc.a);
    fireShot(arc.state, arc.ctx, arc.a.id, { ...aimAt(arc.a, arc.b), dir: { x: 1, y: 0, z: 0 } });
    tick(arc.state, arc.ctx, 0.3);
    const charge = arc.state.bodies.find(x => x.kind === 'charge')!;
    expect(charge.y).toBeLessThan(eye.y - 0.2);
  });
});

describe('objectives', () => {
  it('a lone soldier captures a neutral point in eight world seconds; contest freezes it', () => {
    const { state, ctx, events } = setup({ ...OFFLINE_CONFIG, warmup: 0 });
    const a = addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    const def = ctx.map.points.find(p => p.id === 'A')!;
    place(a, def.x, def.z, ctx, def.y + 0.5);
    tick(state, ctx, 4);
    const p = state.points.find(x => x.id === 'A')!;
    expect(p.progress).toBeCloseTo(50, -1);
    const b = addSoldier(state, ctx, { name: 'B', team: 1, bot: false });
    place(b, def.x + 1, def.z, ctx, def.y + 0.5);
    const frozen = p.progress;
    tick(state, ctx, 2);
    expect(p.contested).toBe(true); expect(p.progress).toBe(frozen);
    place(b, 0, 40, ctx);
    tick(state, ctx, 4.5);
    expect(p.owner).toBe(0);
    expect(events.some(e => e.type === 'capture' && e.point === 'A' && e.team === 0)).toBe(true);
    expect(a.captures).toBe(1);
  });
});

describe('100-soldier battles', () => {
  function city(seed = 3) {
    const events: MatchEvent[] = [];
    const random = rng(seed);
    const ctx = createContext('meridian', random, e => events.push(e));
    const state = createMatch('meridian', { ...ONLINE_CONFIG, warmup: 1 }, random);
    return { ctx, state, events };
  }

  it('a big battlefield fills both teams to its own size; small maps and Law Lab keep theirs', () => {
    const { ctx, state } = city();
    expect(teamSizeFor(ctx.map, state.config)).toBe(50);
    balanceTeams(state, ctx);
    expect(state.soldiers.filter(s => s.team === 0).length).toBe(50);
    expect(state.soldiers.filter(s => s.team === 1).length).toBe(50);
    expect(teamSizeFor(ctx.map, { ...ONLINE_CONFIG, teamSize: 0, practice: true })).toBe(0);
    expect(teamSizeFor(loadMap('cinder').def, ONLINE_CONFIG)).toBe(ONLINE_CONFIG.teamSize);
  });

  it('fifty bots a side fight and take objectives on the city map', () => {
    const { ctx, state, events } = city(11);
    balanceTeams(state, ctx);
    tick(state, ctx, 90);
    expect(events.filter(e => e.type === 'kill').length).toBeGreaterThan(20);
    expect(events.filter(e => e.type === 'capture').length).toBeGreaterThan(0);
    for (const s of state.soldiers) if (s.alive) expect(ctx.world.overlapsSolid(s.m, 0.2, 1.2)).toBe(false);
  });

  it('forward spawns open only while the team holds the point and no enemy is close', () => {
    const { ctx, state } = city();
    const s = addSoldier(state, ctx, { name: 'F', team: 0, bot: false });
    const forward = (id: string) => ctx.map.spawns.filter(p => p.team === 0 && p.point === id);
    expect(forward('A').length).toBeGreaterThan(0);
    const at = (slots: typeof ctx.map.spawns) => slots.some(p => Math.hypot(p.x - s.m.x, p.z - s.m.z) < 2);
    for (let i = 0; i < 20; i++) { spawnSoldier(state, ctx, s); expect(at(forward('A'))).toBe(false); }
    state.points.find(p => p.id === 'A')!.owner = 0;
    let used = 0;
    for (let i = 0; i < 20; i++) { spawnSoldier(state, ctx, s); if (at(forward('A'))) used++; }
    expect(used).toBeGreaterThan(10);
    // An enemy standing on the forward slots closes the ones near it.
    const enemy = addSoldier(state, ctx, { name: 'E', team: 1, bot: false });
    const slot = forward('A')[0];
    place(enemy, slot.x, slot.z, ctx);
    const near = forward('A').filter(p => Math.hypot(p.x - slot.x, p.z - slot.z) < 20);
    for (let i = 0; i < 20; i++) { spawnSoldier(state, ctx, s); expect(at(near)).toBe(false); }
  });

  it('the packed frame round-trips poses, bodies, points and shots', () => {
    const { ctx, state } = city();
    balanceTeams(state, ctx);
    tick(state, ctx, 3);
    state.pickupLeft = [0, 12.2, 300];
    state.bodies.push({ id: 999, kind: 'charge', x: 1, y: 2, z: 3, vx: 30, vy: 1, vz: 0, age: 0, owner: 1, team: 0, hp: 1, timer: 2 });
    const a = state.soldiers[3];
    a.yaw = -2.5; a.pitch = 0.4; a.reloadLeft = 1; a.sinceShot = 0;
    const shot = { type: 'shot' as const, shooter: a.id, weapon: 'lancer' as const, from: { x: 1.23, y: 2, z: -3 }, to: { x: 40.5, y: 1, z: -80.02 }, hit: 1 as const, surface: 'concrete' };
    const frame = decodeFrame(encodeFrame(state, [shot]))!;
    expect(frame.tick).toBe(state.tick);
    expect(frame.poses.length).toBe(100);
    const p = frame.poses.find(x => x.id === a.id)!;
    expect(p.x).toBeCloseTo(a.m.x, 1); expect(p.y).toBeCloseTo(a.m.y, 1); expect(p.z).toBeCloseTo(a.m.z, 1);
    expect(Math.abs(wrapAngle(p.yaw - a.yaw))).toBeLessThan(0.001);
    expect(p.pitch).toBeCloseTo(0.4, 3);
    expect(p.reloading).toBe(true); expect(p.firing).toBe(true); expect(p.alive).toBe(a.alive);
    expect(frame.bodies.map(b => b.kind)).toEqual(state.bodies.map(b => b.kind));
    expect(frame.points.map(x => x.owner)).toEqual(state.points.map(x => x.owner));
    expect(frame.pickups).toEqual([0, 13, 255]);
    expect(frame.shots[0]).toMatchObject({ shooter: a.id, weapon: 'lancer', hit: 1, surface: 'concrete' });
    expect(frame.shots[0].to.z).toBeCloseTo(-80.02, 1);
  });
});

describe('credits, buying and pickups', () => {
  function armed() {
    const env = setup();
    const a = addSoldier(env.state, env.ctx, { name: 'A', team: 0, bot: false });
    const b = addSoldier(env.state, env.ctx, { name: 'B', team: 1, bot: false });
    return { ...env, a, b };
  }

  it('earns credits for kills and headshots, and keeps them through death', () => {
    const { state, ctx, a, b } = armed();
    expect(a.money).toBe(ECONOMY.start);
    killSoldier(state, ctx, b, a, 'carbine', true);
    expect(a.money).toBe(ECONOMY.start + ECONOMY.kill + ECONOMY.headshotBonus);
    killSoldier(state, ctx, a, b, 'carbine', false);
    expect(a.money).toBe(ECONOMY.start + ECONOMY.kill + ECONOMY.headshotBonus);
  });

  it('buys during buy time or near the spawn, charges the price and fills the right slot', () => {
    const { state, ctx, a } = armed();
    a.money = 5000;
    const r = buyItem(state, ctx, a.id, 'lancer');
    expect(r.ok).toBe(true);
    expect(a.money).toBe(5000 - WEAPONS.lancer.price);
    expect(a.weapons[0]).toBe('lancer'); expect(a.weapon).toBe(0);
    expect(a.ammo[0]).toBe(WEAPONS.lancer.magazine); expect(a.reserve[0]).toBe(WEAPONS.lancer.magazine * ECONOMY.spareMags);
    expect(buyItem(state, ctx, a.id, 'magnum').ok).toBe(true);
    expect(a.weapons).toEqual(['lancer', 'magnum']);
    // Too poor.
    a.money = 100;
    expect(buyItem(state, ctx, a.id, 'carbine').ok).toBe(false);
    expect(a.weapons[0]).toBe('lancer');
    // Buy time over, away from the spawn: refused; back at the spawn: allowed.
    a.money = 5000; a.sinceSpawn = 99;
    place(a, 0, 22, ctx);
    expect(buyItem(state, ctx, a.id, 'carbine').ok).toBe(false);
    const home = ctx.map.spawns.find(p => p.team === a.team && !p.point)!;
    place(a, home.x, home.z, ctx, home.y + 1);
    expect(buyItem(state, ctx, a.id, 'carbine').ok).toBe(true);
    // Grenades are capped.
    a.grenades = GRENADE.perLife;
    expect(buyItem(state, ctx, a.id, 'grenade').ok).toBe(false);
  });

  it('loses bought weapons on death and rebuys them on respawn when affordable', () => {
    const { state, ctx, a, b } = armed();
    a.money = 5000;
    buyItem(state, ctx, a.id, 'scatter');
    killSoldier(state, ctx, a, b, 'carbine', false);
    a.money = 2000;
    spawnSoldier(state, ctx, a);
    expect(a.weapons[0]).toBe('scatter');
    expect(a.money).toBe(2000 - WEAPONS.scatter.price);
    killSoldier(state, ctx, a, b, 'carbine', false);
    a.money = 100;
    spawnSoldier(state, ctx, a);
    expect(a.weapons[0]).toBe('carbine');
    expect(a.money).toBe(100);
  });

  it('reloads from spare ammo and cannot reload without it; bots never run dry', () => {
    const { state, a } = armed();
    a.ammo[0] = 10; a.reserve[0] = 12;
    reload(state, a.id);
    expect(a.reloadLeft).toBeGreaterThan(0);
    a.reloadLeft = 0.001;
    tickMatch(state, createContext('cinder', rng(1), () => {}), 1 / TICK_RATE);
    expect(a.ammo[0]).toBe(22); expect(a.reserve[0]).toBe(0);
    a.ammo[0] = 5;
    reload(state, a.id);
    expect(a.reloadLeft).toBe(0);
  });

  it('weapon pickups swap with E in reach; ammo and armor are collected by walking over them; all come back', () => {
    const { state, ctx: base, a } = armed();
    const map = { ...base.map, pickups: [
      { x: 0, y: 0, z: 22, item: 'lancer' as const, respawn: 30 },
      { x: 4, y: 0, z: 22, item: 'ammo' as const, respawn: 20 },
      { x: 8, y: 0, z: 22, item: 'armor' as const, respawn: 40 },
    ] };
    for (const p of map.pickups) p.y = base.world.groundHeight(p.x, p.z, 50, 0.3);
    const ctx = { ...base, map };
    state.pickupLeft = [0, 0, 0];
    place(a, 10, 30, ctx);
    expect(pickUp(state, ctx, a.id, 0)).toBe(false); // out of reach
    place(a, 0.5, 22, ctx);
    expect(pickUp(state, ctx, a.id, 0)).toBe(true);
    expect(a.weapons[0]).toBe('lancer');
    expect(state.pickupLeft[0]).toBe(30);
    expect(pickUp(state, ctx, a.id, 0)).toBe(false); // already taken
    a.reserve = [0, 0]; a.shield = 0; a.health = 40;
    place(a, 4, 22, ctx);
    tickMatch(state, ctx, 1 / TICK_RATE);
    expect(a.reserve[0]).toBe(WEAPONS.lancer.magazine * ECONOMY.spareMags);
    place(a, 8, 22, ctx);
    tickMatch(state, ctx, 1 / TICK_RATE);
    expect(a.health).toBe(100); expect(a.shield).toBe(50);
    tick(state, ctx, 31);
    expect(state.pickupLeft[0]).toBe(0);
  });

  it('free buying (practice range and ?freebuy) costs nothing and works anywhere', () => {
    const { state, ctx, a } = armed();
    state.config.freeBuy = true;
    a.money = 0; a.sinceSpawn = 999;
    place(a, 0, 22, ctx);
    expect(buyItem(state, ctx, a.id, 'lancer').ok).toBe(true);
    expect(a.weapons[0]).toBe('lancer'); expect(a.money).toBe(0);
    a.grenades = 0;
    expect(buyItem(state, ctx, a.id, 'grenade').ok).toBe(true);
    expect(PRACTICE_CONFIG.freeBuy).toBe(true);
  });

  it('bots spend their credits on better guns when they deploy', () => {
    const { state, ctx } = setup();
    const bot = addSoldier(state, ctx, { name: 'Rich', team: 0, bot: true, loadout: 'assault' });
    let upgraded = 0;
    for (let i = 0; i < 20; i++) { bot.money = 6000; spawnSoldier(state, ctx, bot); if (WEAPONS[bot.weapons[0]].price > WEAPONS.carbine.price) upgraded++; }
    expect(upgraded).toBeGreaterThan(5);
  });
});

