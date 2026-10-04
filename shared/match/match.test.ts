import { describe, expect, it } from 'vitest';
import { defaultLaws } from '../laws';
import { MAP_IDS, loadMap, loadNav } from '../maps/index';
import { rng } from '../math';
import { CollisionWorld } from '../collision';
import { createMoveState, eyeHeight, stepMovement } from '../movement';
import { hitShape } from '../hitbox';
import { LOADOUTS, WEAPONS, pelletCone, pelletDirs } from '../weapons';
import { findPath, nearestNode } from './nav';
import { addSoldier, applyLaw, balanceTeams, createContext, createMatch, fireShot, reportState, tickMatch, TICK_RATE } from './sim';
import { OFFLINE_CONFIG, ONLINE_CONFIG, type MatchEvent, type MatchState, type Soldier } from './state';
import { MOVE_SLACK, type SimContext } from './combat';

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
      expect(def.points.map(p => p.id).sort()).toEqual(['A', 'B', 'C']);
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
    it(`${id}: spawns are not inside geometry and the reactor floats over B`, () => {
      const { def, world } = loadMap(id);
      for (const sp of def.spawns) expect(world.overlapsSolid({ x: sp.x, y: sp.y, z: sp.z }, 0.35, 1.7)).toBe(false);
      const b = def.points.find(p => p.id === 'B')!;
      expect(Math.hypot(def.anomaly.x - b.x, def.anomaly.z - b.z)).toBeLessThan(0.5);
      expect(def.anomaly.y - b.y).toBeGreaterThan(2);
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
    a.loadout = 'recon'; a.ammo = [5, 6]; a.fireCooldown = 0; b.health = 1000;
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(true);
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(false);
    a.fireCooldown -= 0.8;
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(true);
    expect(b.health).toBeLessThan(1000 - 92);
    a.loadout = 'assault'; a.ammo = [30, 14]; b.health = 100; b.shield = 50;
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

  it('graviton charges are lawful bodies: they fly, bend with gravity laws and detonate', () => {
    const { state, ctx, a, b, events } = duel('grenadier', 16);
    expect(fireShot(state, ctx, a.id, aimAt(a, b))).toBe(true);
    expect(state.bodies.filter(x => x.kind === 'charge')).toHaveLength(1);
    tick(state, ctx, 1);
    expect(state.bodies.some(x => x.kind === 'charge')).toBe(false);
    expect(events.some(e => e.type === 'explosion' && e.weapon === 'graviton')).toBe(true);
    expect(health(b)).toBeLessThan(150 - 40);

    // Sideways gravity bends the next charge away from the line it was fired along.
    const bent = duel('grenadier', 16);
    bent.state.laws.gravity = { mode: 'uniform', direction: { x: 0, y: 0, z: 1 }, strength: 30, exponent: 0 };
    fireShot(bent.state, bent.ctx, bent.a.id, aimAt(bent.a, bent.b));
    tick(bent.state, bent.ctx, 0.2);
    const charge = bent.state.bodies.find(x => x.kind === 'charge')!;
    expect(charge.z - bent.a.m.z).toBeGreaterThan(0.3);
  });
});

describe('laws in a match', () => {
  it('validates commands, enforces online cooldown and reverts after the law duration', () => {
    const { state, ctx } = setup({ ...ONLINE_CONFIG, warmup: 0 });
    const a = addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    expect(applyLaw(state, ctx, a.id, { kind: 'gravity', gravity: { mode: 'central', strength: 80, exponent: 2, direction: { x: 0, y: -1, z: 0 }, code: 'x' } }, 'AI', '').ok).toBe(false);
    expect(applyLaw(state, ctx, a.id, { kind: 'gravity', gravity: { ...defaultLaws.gravity, exponent: 3 } }, 'PRESET', '').ok).toBe(true);
    expect(state.laws.gravity.exponent).toBe(3);
    expect(applyLaw(state, ctx, a.id, { kind: 'lightSpeed', lightSpeed: { c: 10 } }, 'PRESET', '').ok).toBe(false);
    tick(state, ctx, ONLINE_CONFIG.lawDuration + 0.5);
    expect(state.laws.gravity.exponent).toBe(2);
  });

  it('inverse-cube gravity flings the sentinel drones out of the reactor', () => {
    const { state, ctx } = setup();
    const near = () => state.bodies.filter(b => b.kind === 'drone' && Math.hypot(b.x, b.z) < 12).length;
    expect(near()).toBe(4);
    applyLaw(state, ctx, -1, { kind: 'gravity', gravity: { ...defaultLaws.gravity, exponent: 3 } }, 'PRESET', '');
    tick(state, ctx, 12);
    expect(near()).toBeLessThan(2);
  });

  it('motion-driven time freezes bots and bodies while the lawbreaker stands still', () => {
    const { state, ctx } = setup({ ...OFFLINE_CONFIG, teamSize: 3 });
    const me = addSoldier(state, ctx, { name: 'Me', team: 0, bot: false });
    balanceTeams(state, ctx);
    tick(state, ctx, 4);
    applyLaw(state, ctx, me.id, { kind: 'time', time: { mode: 'playerMotion', scale: 1 } }, 'PRESET', '');
    const before = JSON.stringify([state.bodies, state.soldiers.filter(s => s.bot).map(s => s.m)]);
    const worldTime = state.worldTime;
    tick(state, ctx, 3);
    expect(state.worldTime).toBe(worldTime);
    expect(JSON.stringify([state.bodies, state.soldiers.filter(s => s.bot).map(s => s.m)])).toBe(before);
    // Moving at half walking pace advances world time at half speed.
    me.m.vx = 3;
    tick(state, ctx, 2);
    expect(state.worldTime - worldTime).toBeCloseTo(1, 1);
  });

  it('rewind restores bots, bodies and objectives but not the lawbreaker or scores', () => {
    const { state, ctx } = setup({ ...OFFLINE_CONFIG, teamSize: 4, warmup: 0 }, 3);
    const me = addSoldier(state, ctx, { name: 'Me', team: 0, bot: false });
    balanceTeams(state, ctx);
    tick(state, ctx, 20);
    const saved = JSON.stringify({ bodies: state.bodies, bots: state.soldiers.filter(s => s.bot).map(s => [s.m.x, s.m.z, s.alive]), points: state.points.map(p => [p.progress, p.owner]) });
    const savedTime = state.worldTime;
    tick(state, ctx, 3);
    place(me, -30, 30, ctx);
    const scores = [...state.scores];
    applyLaw(state, ctx, me.id, { kind: 'rewind', rewind: { seconds: 3 } }, 'PRESET', '');
    for (let i = 0; i < 3 * TICK_RATE; i++) tickMatch(state, ctx, 1 / TICK_RATE);
    expect(state.worldTime).toBeCloseTo(savedTime, 5);
    expect(JSON.stringify({ bodies: state.bodies, bots: state.soldiers.filter(s => s.bot).map(s => [s.m.x, s.m.z, s.alive]), points: state.points.map(p => [p.progress, p.owner]) })).toBe(saved);
    expect(me.m.x).toBe(-30);
    expect(state.scores[0] + state.scores[1]).toBeGreaterThanOrEqual(scores[0] + scores[1]);
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
