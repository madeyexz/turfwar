import { describe, expect, it } from 'vitest';
import { defaultLaws } from '../laws';
import { loadMap, loadNav } from '../maps/index';
import { rng } from '../math';
import { eyeHeight } from '../movement';
import { hitShape } from '../hitbox';
import { findPath, nearestNode } from './nav';
import { addSoldier, applyLaw, balanceTeams, createContext, createMatch, fireShot, reportState, tickMatch, TICK_RATE } from './sim';
import { OFFLINE_CONFIG, ONLINE_CONFIG, type MatchEvent, type MatchState, type Soldier } from './state';
import type { SimContext } from './combat';

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

describe('map and navigation', () => {
  it('every capture point is reachable from both spawns', () => {
    const { def } = loadMap('cinder'); const nav = loadNav('cinder');
    for (const team of [0, 1]) {
      const sp = def.spawns.find(s => s.team === team)!;
      const start = nearestNode(nav, sp.x, sp.y, sp.z);
      for (const p of def.points) expect(findPath(nav, start, nearestNode(nav, p.x, p.y, p.z)).length, `${team}->${p.id}`).toBeGreaterThan(3);
    }
  });
  it('is rotationally symmetric for fairness', () => {
    const { def } = loadMap('cinder');
    const key = (s: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number }) => [s.minX, s.maxX, s.minZ, s.maxZ, s.minY, s.maxY].map(v => v.toFixed(2)).join();
    const all = new Set(def.solids.map(key));
    for (const s of def.solids) expect(all.has(key({ minX: -s.maxX, maxX: -s.minX, minZ: -s.maxZ, maxZ: -s.minZ, minY: s.minY, maxY: s.maxY }))).toBe(true);
  });
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
    // Rate limit: an immediate second shot is refused.
    a.fireCooldown = 0;
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(true);
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(false);
    // Empty magazine.
    a.fireCooldown = 0; a.ammo[0] = 0;
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(false);
    // Through the reactor pylon: put the target behind it.
    a.ammo[0] = 30; a.fireCooldown = 0; b.shield = 50; b.health = 100;
    place(a, -8, 0, ctx); a.m.y = 0.1; place(b, 8, 0, ctx); b.m.y = 0.1;
    fireShot(state, ctx, a.id, claimAt(a, b));
    expect(b.shield).toBe(50);
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
