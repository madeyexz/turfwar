import { describe, expect, it } from 'vitest';
import { MAP_IDS, loadMap, loadNav } from '../maps/index';
import { rng } from '../math';
import { CollisionWorld } from '../collision';
import { createMoveState, eyeHeight, stepMovement } from '../movement';
import { hitShape } from '../hitbox';
import { GRENADE, WEAPONS, pelletCone, pelletDirs, weaponStats } from '../weapons';
import { findPath, nearestNode } from './nav';
import {
  BOMB_REACH, addSoldier, balanceTeams, buyAttachmentFor, buyItem, createContext, createMatch, fireShot, reportState,
  canSwitchTeam, removeSoldier, resetMatch, switchTeam, tickMatch, useAmmoCrate, TICK_RATE,
} from './sim';
import { ATTACKERS, ELIMINATION, PRACTICE_CONFIG, SABOTAGE, type MatchConfig, type MatchEvent, type MatchState, type Soldier, type Team } from './state';
import { MOVE_SLACK, killSoldier, sideOf, type SimContext } from './combat';
import { CASH } from './economy';
import { decodeFrame, encodeFrame } from './frame';

function setup(config: MatchConfig = ELIMINATION, seed = 1, mapId = 'cinder') {
  const events: MatchEvent[] = [];
  const random = rng(seed);
  const ctx = createContext(mapId, random, e => events.push(e));
  const state = createMatch(mapId, { ...config });
  return { ctx, state, events };
}
const tick = (state: MatchState, ctx: SimContext, seconds: number) => { for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) tickMatch(state, ctx, 1 / TICK_RATE); };
const place = (s: Soldier, x: number, z: number, ctx: SimContext, fromY = 50) => { s.m.x = x; s.m.z = z; s.m.y = ctx.world.groundHeight(x, z, fromY, 0.3); s.m.vx = s.m.vz = 0; s.m.grounded = true; };
const report = (s: Soldier, over: Partial<Parameters<typeof reportState>[3]> = {}) =>
  ({ x: s.m.x, y: s.m.y, z: s.m.z, vx: 0, vy: 0, vz: 0, yaw: s.yaw, pitch: 0, crouch: 0, grounded: true, sprint: false, ads: false, weapon: 0 as const, ...over });
/** Start the match and skip the round-start freeze. */
const goLive = (state: MatchState, ctx: SimContext) => { resetMatch(state, ctx); tick(state, ctx, state.config.freezeTime + 0.1); };

const ASYMMETRIC = ['ochre', 'crane', 'tower', 'pipeline', 'timbertown', 'taipei', 'xinyi', 'taipei101', 'memorial'];

describe('maps and navigation', () => {
  for (const id of MAP_IDS) {
    it(`${id}: every landmark and bomb site is reachable from both bases`, () => {
      const { def } = loadMap(id); const nav = loadNav(id);
      for (const team of [0, 1]) {
        const sp = def.spawns.find(s => s.team === team)!;
        const start = nearestNode(nav, sp.x, sp.y, sp.z);
        for (const p of def.points) expect(findPath(nav, start, nearestNode(nav, p.x, p.y, p.z)).length, `${team}->${p.id}`).toBeGreaterThan(3);
      }
      for (const site of def.sabotage?.sites ?? []) expect(def.points.some(p => p.id === site), site).toBe(true);
    });
    it(`${id}: each base fits its largest room (6v6 with spare slots; 24v24 on big maps)`, () => {
      const { def } = loadMap(id);
      for (const team of [0, 1]) expect(def.spawns.filter(s => s.team === team).length).toBeGreaterThanOrEqual(def.big ? 24 : 12);
    });
    // Ochre Quarter, the BeGone homages and Taipei keep their source layouts' asymmetry on purpose.
    it.skipIf(ASYMMETRIC.includes(id))(`${id}: is rotationally symmetric for fairness`, () => {
      const { def } = loadMap(id);
      const key = (s: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number }) => [s.minX, s.maxX, s.minZ, s.maxZ, s.minY, s.maxY].map(v => v.toFixed(2)).join();
      const all = new Set(def.solids.map(key));
      for (const s of def.solids) expect(all.has(key({ minX: -s.maxX, maxX: -s.minX, minZ: -s.maxZ, maxZ: -s.minZ, minY: s.minY, maxY: s.maxY }))).toBe(true);
    });
    it(`${id}: spawns and ammo crates are clear of geometry`, () => {
      const { def, world } = loadMap(id);
      for (const sp of def.spawns) expect(world.overlapsSolid({ x: sp.x, y: sp.y, z: sp.z }, 0.35, 1.7)).toBe(false);
      for (const p of def.pickups ?? []) {
        expect(p.item).toBe('ammo');
        expect(world.overlapsSolid({ x: p.x, y: p.y + 0.05, z: p.z }, 0.3, 1.2), `crate@${p.x},${p.z}`).toBe(false);
      }
    });
  }
  // Taipei's own layout checks (sightlines, levels, base distances) are in shared/maps/taipei.test.ts, Taipei 101 · 88F's in taipei101.test.ts.
});

describe('bot matches', () => {
  it('Elimination: bots fight whole rounds to a result, then the next round deploys', () => {
    const { ctx, state, events } = setup({ ...ELIMINATION, teamSize: 5, warmup: 0 }, 7);
    balanceTeams(state, ctx);
    tick(state, ctx, 240);
    expect(events.filter(e => e.type === 'kill').length).toBeGreaterThan(8);
    const decided = events.filter(e => e.type === 'round' && e.phase === 'over' && e.winner !== -1);
    expect(decided.length).toBeGreaterThan(1);
    expect(state.scores[0] + state.scores[1]).toBe(decided.length);
    for (const s of state.soldiers) {
      const b = ctx.map.bounds;
      expect(s.m.x).toBeGreaterThanOrEqual(b.minX); expect(s.m.x).toBeLessThanOrEqual(b.maxX);
      if (s.alive) expect(ctx.world.overlapsSolid(s.m, 0.2, 1.2)).toBe(false);
    }
  });

  it('Sabotage: Militia bots carry the fight to the site and arm the bomb', () => {
    const { ctx, state, events } = setup({ ...SABOTAGE, teamSize: 0, warmup: 0, botSkill: 0.2 }, 5);
    for (let i = 0; i < 4; i++) addSoldier(state, ctx, { name: `M${i}`, team: ATTACKERS, bot: true });
    // One SWAT player hiding out of sight under the map keeps the round going.
    const swat = addSoldier(state, ctx, { name: 'S', team: (1 - ATTACKERS) as 0 | 1, bot: false });
    resetMatch(state, ctx);
    for (let i = 0; i < 90 * TICK_RATE && !state.bomb.armed; i++) {
      swat.m.x = 0; swat.m.y = -30; swat.m.z = 0;
      tickMatch(state, ctx, 1 / TICK_RATE);
    }
    expect(events.some(e => e.type === 'bomb' && e.action === 'armed')).toBe(true);
  });

  it('Sabotage on Taipei: Militia bots find their way through Ximending to a site and arm it', () => {
    const { ctx, state, events } = setup({ ...SABOTAGE, teamSize: 0, warmup: 0, botSkill: 0.2 }, 5, 'taipei');
    for (let i = 0; i < 4; i++) addSoldier(state, ctx, { name: `M${i}`, team: ATTACKERS, bot: true });
    const swat = addSoldier(state, ctx, { name: 'S', team: (1 - ATTACKERS) as 0 | 1, bot: false });
    resetMatch(state, ctx);
    for (let i = 0; i < 110 * TICK_RATE && !state.bomb.armed; i++) {
      swat.m.x = 0; swat.m.y = -30; swat.m.z = 0;
      tickMatch(state, ctx, 1 / TICK_RATE);
    }
    expect(events.some(e => e.type === 'bomb' && e.action === 'armed')).toBe(true);
  });

  it('Sabotage on Xinyi: Militia bots reach a site round Taipei 101 (the sunken atrium or the west plaza) and arm it', () => {
    const { ctx, state, events } = setup({ ...SABOTAGE, teamSize: 0, warmup: 0, botSkill: 0.2 }, 5, 'xinyi');
    for (let i = 0; i < 4; i++) addSoldier(state, ctx, { name: `M${i}`, team: ATTACKERS, bot: true });
    const swat = addSoldier(state, ctx, { name: 'S', team: (1 - ATTACKERS) as 0 | 1, bot: false });
    resetMatch(state, ctx);
    for (let i = 0; i < 110 * TICK_RATE && !state.bomb.armed; i++) {
      swat.m.x = 0; swat.m.y = -30; swat.m.z = 0;
      tickMatch(state, ctx, 1 / TICK_RATE);
    }
    expect(events.some(e => e.type === 'bomb' && e.action === 'armed')).toBe(true);
  });

  it('Sabotage on Taipei 101 · 88F: Militia bots come up the fire stairs, reach the server room or the boardroom and arm it', () => {
    const { ctx, state, events } = setup({ ...SABOTAGE, teamSize: 0, warmup: 0, botSkill: 0.2 }, 5, 'taipei101');
    for (let i = 0; i < 4; i++) addSoldier(state, ctx, { name: `M${i}`, team: ATTACKERS, bot: true });
    const swat = addSoldier(state, ctx, { name: 'S', team: (1 - ATTACKERS) as 0 | 1, bot: false });
    resetMatch(state, ctx);
    for (let i = 0; i < 90 * TICK_RATE && !state.bomb.armed; i++) {
      swat.m.x = 0; swat.m.y = -30; swat.m.z = 0;
      tickMatch(state, ctx, 1 / TICK_RATE);
    }
    expect(events.some(e => e.type === 'bomb' && e.action === 'armed')).toBe(true);
  });

  it('bots climb a ladder when their path takes one', () => {
    const { ctx, state } = setup({ ...ELIMINATION, teamSize: 0, warmup: 0 }, 3, 'warehouse');
    const bot = addSoldier(state, ctx, { name: 'B', team: 1, bot: true });
    const enemy = addSoldier(state, ctx, { name: 'E', team: 0, bot: false });
    goLive(state, ctx);
    // The west deck's ladder at z -7.4: from the bay floor in front of it to the deck above it.
    const nav = loadNav('warehouse');
    place(bot, -21, -7.4, ctx, 1);
    const path = findPath(nav, nearestNode(nav, bot.m.x, bot.m.y, bot.m.z), nearestNode(nav, -26.2, 3.2, -7.4));
    expect(path.some((n, i) => i > 0 && nav.y[n] - nav.y[path[i - 1]] > 1.5)).toBe(true);
    Object.assign(bot.brain!, { goal: 'roam', goalLeft: 99, repath: 99, path, pathIndex: 0 });
    let onDeck = false;
    for (let i = 0; i < 4 * TICK_RATE && !onDeck; i++) {
      enemy.m.x = 0; enemy.m.y = -30; enemy.m.z = 0;
      tickMatch(state, ctx, 1 / TICK_RATE);
      onDeck = bot.m.grounded && Math.abs(bot.m.y - 3.2) < 0.05 && bot.m.x < -24;
    }
    expect(onDeck).toBe(true);
  });

  it('24v24 rooms run on the big map', () => {
    const { ctx, state, events } = setup({ ...ELIMINATION, teamSize: 24, warmup: 0 }, 11, 'meridian');
    balanceTeams(state, ctx);
    expect(state.soldiers.filter(s => s.team === 0).length).toBe(24);
    expect(state.soldiers.filter(s => s.team === 1).length).toBe(24);
    tick(state, ctx, 0.1);
    // Everyone deploys in the base at once without standing inside each other or a wall.
    for (const a of state.soldiers) {
      expect(ctx.world.overlapsSolid(a.m, 0.3, 1.2)).toBe(false);
      for (const b of state.soldiers) if (a !== b && a.team === b.team) expect(Math.hypot(a.m.x - b.m.x, a.m.z - b.m.z)).toBeGreaterThan(0.5);
    }
    tick(state, ctx, 60);
    expect(events.filter(e => e.type === 'kill').length).toBeGreaterThan(3);
    for (const s of state.soldiers) if (s.alive) expect(ctx.world.overlapsSolid(s.m, 0.2, 1.2)).toBe(false);
  });
});

describe('rounds', () => {
  function teams(config: MatchConfig = ELIMINATION, mapId = 'cinder') {
    const env = setup({ ...config, warmup: 0 }, 1, mapId);
    const a = addSoldier(env.state, env.ctx, { name: 'A', team: 0, bot: false });
    const b = addSoldier(env.state, env.ctx, { name: 'B', team: 1, bot: false });
    goLive(env.state, env.ctx);
    return { ...env, a, b };
  }

  it('freezes everyone at round start, then wiping a team wins the round and pays out', () => {
    const env = setup({ ...ELIMINATION, warmup: 0 });
    const a = addSoldier(env.state, env.ctx, { name: 'A', team: 0, bot: false });
    addSoldier(env.state, env.ctx, { name: 'B', team: 1, bot: false });
    resetMatch(env.state, env.ctx);
    expect(env.state.roundPhase).toBe('freeze');
    expect(a.alive).toBe(true); expect(a.health).toBe(100);
    expect(a.money).toBe(CASH.matchBonus);
    expect(a.weapons).toEqual(['mp5', 'm9a1']);
    tick(env.state, env.ctx, env.state.config.freezeTime + 0.1);
    expect(env.state.roundPhase).toBe('live');
  });

  it('the last team standing takes the round; the next round redeploys both teams in their bases', () => {
    const { state, ctx, a, b, events } = teams();
    const before = a.money;
    b.health = 1; b.lastAttacker = a.id;
    place(a, -6, 22, ctx); place(b, 6, 22, ctx);
    a.yaw = -Math.PI / 2;
    fireShot(state, ctx, a.id, claimAt(a, b));
    expect(b.alive).toBe(false);
    tick(state, ctx, 0.1);
    expect(state.roundPhase).toBe('over');
    expect(state.scores).toEqual([1, 0]);
    expect(a.money).toBe(before + CASH.kill + CASH.firstKill + CASH.lastEnemy + CASH.firstBlood + CASH.roundWin + CASH.survivor + CASH.lastStanding);
    expect(events.some(e => e.type === 'reward' && e.id === a.id && e.reason === 'Round won')).toBe(true);
    tick(state, ctx, state.config.roundOverTime);
    expect(state.round).toBe(2);
    expect(b.alive).toBe(true); expect(b.health).toBe(100);
    for (const s of [a, b]) {
      const side = sideOf(state, ctx.map, s.team);
      expect(ctx.map.spawns.some(p => p.team === side && Math.hypot(p.x - s.m.x, p.z - s.m.z) < 1.2)).toBe(true);
    }
  });

  it('an Elimination time-out is a draw and the round is replayed', () => {
    const { state, ctx, events } = teams();
    tick(state, ctx, state.config.roundTime + 0.2);
    expect(events.some(e => e.type === 'round' && e.phase === 'over' && e.winner === -1 && e.reason === 'time')).toBe(true);
    tick(state, ctx, state.config.roundOverTime);
    expect(state.round).toBe(1);
    expect(state.scores).toEqual([0, 0]);
  });

  it('first to the round limit wins the match, which then restarts with fresh inventories', () => {
    const { state, ctx, a, b } = teams({ ...ELIMINATION, roundsToWin: 2 });
    a.money = 9000;
    for (let r = 0; r < 2; r++) {
      b.health = 0; b.alive = false;
      tick(state, ctx, 0.1);
      if (state.phase !== 'ended') tick(state, ctx, state.config.roundOverTime + state.config.freezeTime + 0.1);
    }
    expect(state.phase).toBe('ended'); expect(state.winner).toBe(0);
    tick(state, ctx, state.config.matchOverTime + 0.1);
    expect(state.phase).toBe('live'); expect(state.scores).toEqual([0, 0]);
    expect(a.money).toBe(CASH.matchBonus);
  });

  it('Sabotage: holding use still on a site for 5 s arms the bomb; 40 s later it blows', () => {
    const { state, ctx, a, b, events } = teams(SABOTAGE);
    const militia = a.team === ATTACKERS ? a : b;
    const site = ctx.map.points.find(p => p.id === ctx.map.sabotage!.sites[0])!;
    place(militia, site.x, site.z, ctx, site.y + 1);
    militia.using = true;
    tick(state, ctx, state.config.armTime - 0.3);
    expect(state.bomb.armed).toBe(false);
    expect(state.bomb.progress).toBeGreaterThan(0.8);
    tick(state, ctx, 0.5);
    expect(state.bomb.armed).toBe(true);
    expect(state.phaseLeft).toBeGreaterThan(state.config.bombTime - 1);
    militia.using = false;
    tick(state, ctx, state.config.bombTime + 0.1);
    expect(events.some(e => e.type === 'bomb' && e.action === 'exploded')).toBe(true);
    expect(state.scores[ATTACKERS]).toBe(1);
  });

  it('Sabotage: SWAT disarms an armed bomb in 5 s; letting go resets the disarm', () => {
    const { state, ctx, a, b } = teams(SABOTAGE);
    const militia = a.team === ATTACKERS ? a : b, swat = militia === a ? b : a;
    const site = ctx.map.points.find(p => p.id === ctx.map.sabotage!.sites[0])!;
    place(militia, site.x, site.z, ctx, site.y + 1); militia.using = true;
    tick(state, ctx, state.config.armTime + 0.1);
    militia.using = false;
    place(militia, site.x + 30, site.z, ctx);
    place(swat, site.x + BOMB_REACH * 0.5, site.z, ctx, site.y + 1); swat.using = true;
    tick(state, ctx, 2);
    swat.using = false;
    tick(state, ctx, 0.1);
    expect(state.bomb.progress).toBe(0);
    swat.using = true;
    tick(state, ctx, state.config.disarmTime + 0.1);
    expect(state.roundWinner).toBe(swat.team);
  });

  it('practice range: free store, no round end', () => {
    const { state, ctx } = setup({ ...PRACTICE_CONFIG, warmup: 0 });
    const a = addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    goLive(state, ctx);
    expect(buyItem(state, ctx, a.id, 'm249').ok).toBe(true);
    expect(a.weapons[0]).toBe('m249');
    tick(state, ctx, 30);
    expect(state.roundPhase).toBe('live');
  });
});

const claimAt = (a: Soldier, b: Soldier, zone: 'head' | 'body' = 'body') => {
  const origin = { x: a.m.x, y: a.m.y + eyeHeight(a.m), z: a.m.z };
  const shape = hitShape(b.m, b.m.crouch, b.yaw);
  const point = zone === 'head' ? shape.head : { x: b.m.x, y: b.m.y + 1.2, z: b.m.z };
  const d = Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z);
  return { weapon: a.weapon, origin, dir: { x: (point.x - origin.x) / d, y: (point.y - origin.y) / d, z: (point.z - origin.z) / d }, target: b.id, zone, point };
};

function duel(gap = 12) {
  const env = setup({ ...ELIMINATION, warmup: 0 });
  const a = addSoldier(env.state, env.ctx, { name: 'A', team: 0, bot: false });
  const b = addSoldier(env.state, env.ctx, { name: 'B', team: 1, bot: false });
  goLive(env.state, env.ctx);
  place(a, -gap / 2, 22, env.ctx); place(b, gap / 2, 22, env.ctx);
  a.yaw = -Math.PI / 2;
  return { ...env, a, b };
}

describe('server-side validation', () => {
  it('accepts plausible hits with BeGone damage, headshot cash and kill credit', () => {
    const { state, ctx, a, b, events } = duel();
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(true);
    expect(b.health).toBe(100 - WEAPONS.mp5.damage.body);
    let shots = 1;
    while (b.alive && shots < 20) { a.fireCooldown = 0; fireShot(state, ctx, a.id, claimAt(a, b, 'head')); shots++; }
    expect(b.alive).toBe(false);
    expect(a.kills).toBe(1);
    expect(events.some(e => e.type === 'kill' && e.head)).toBe(true);
    expect(events.some(e => e.type === 'reward' && e.id === a.id && e.reason === 'Headshot')).toBe(true);
    expect(shots).toBe(1 + Math.ceil((100 - WEAPONS.mp5.damage.body) / WEAPONS.mp5.damage.head));
  });

  it('rejects claims far from the target, too fast, with an empty magazine, through walls, or during the freeze', () => {
    const { state, ctx, a, b } = duel();
    const far = claimAt(a, b); far.point = { ...far.point, y: far.point.y + 4 };
    fireShot(state, ctx, a.id, far);
    expect(b.health).toBe(100);
    // Rate limit: a short burst is tolerated (network jitter) but not a whole magazine at once.
    a.fireCooldown = 0; b.health = 10000;
    let accepted = 0;
    for (let i = 0; i < 8; i++) if (fireShot(state, ctx, a.id, claimAt(a, b))) accepted++;
    expect(accepted).toBeLessThan(5);
    // Slow weapons get no burst: a second instant M110 shot is refused, a timely one accepted.
    state.config.freeBuy = true;
    buyItem(state, ctx, a.id, 'm110');
    state.config.freeBuy = false;
    a.switchLeft = 0; a.fireCooldown = 0; a.money = 99999;
    expect(a.weapons[0]).toBe('m110');
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(true);
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(false);
    a.fireCooldown -= 0.7;
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(true);
    // Empty magazine.
    a.fireCooldown = 0; a.ammo[0] = 0;
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(false);
    // A wall between them.
    a.ammo[0] = 5; a.fireCooldown = 0; b.health = 100;
    const wall = new CollisionWorld([{ minX: -0.5, minY: -10, minZ: 10, maxX: 0.5, maxY: 30, maxZ: 34, surface: "concrete" }, ...ctx.world.solids], ctx.world.ramps, ctx.world.terrain, ctx.world.bounds);
    fireShot(state, { ...ctx, world: wall }, a.id, claimAt(a, b));
    expect(b.health).toBe(100);
    // Frozen at round start.
    state.roundPhase = 'freeze'; a.fireCooldown = 0;
    expect(fireShot(state, ctx, a.id, claimAt(a, b))).toBe(false);
  });

  it('accepts a full-auto magazine fired at the real rate despite network jitter', () => {
    const { state, ctx, a, b } = duel();
    b.health = 1e6;
    const r = rng(7), interval = WEAPONS.mp5.interval;
    const arrivals = Array.from({ length: 30 }, (_, i) => i * interval + 0.08 + (r() - 0.5) * 0.12).sort((x, y) => x - y);
    let now = 0, accepted = 0;
    for (const t of arrivals) {
      while (now + 1 / TICK_RATE <= t) { tickMatch(state, ctx, 1 / TICK_RATE); now += 1 / TICK_RATE; }
      if (fireShot(state, ctx, a.id, claimAt(a, b))) accepted++;
    }
    expect(accepted).toBe(30);
  });

  it('the M1014 is a close-range killer: a near one-shot at 8 m, much weaker at 30 m', () => {
    const shotgun = (gap: number) => {
      const env = duel(gap);
      env.state.config.freeBuy = true;
      buyItem(env.state, env.ctx, env.a.id, 'm1014');
      env.a.switchLeft = 0; env.a.fireCooldown = 0;
      fireShot(env.state, env.ctx, env.a.id, claimAt(env.a, env.b));
      return 100 - env.b.health;
    };
    expect(shotgun(8)).toBeGreaterThanOrEqual(70);
    expect(shotgun(30)).toBeLessThan(shotgun(8));
  });

  it('the knife only reaches arm\'s length', () => {
    const near = duel(1.6);
    near.a.weapon = 2; near.a.switchLeft = 0;
    expect(fireShot(near.state, near.ctx, near.a.id, claimAt(near.a, near.b))).toBe(true);
    expect(near.b.health).toBe(100 - WEAPONS.knife.damage.body);
    const far = duel(6);
    far.a.weapon = 2; far.a.switchLeft = 0;
    fireShot(far.state, far.ctx, far.a.id, claimAt(far.a, far.b));
    expect(far.b.health).toBe(100);
  });

  it('never applies friendly fire', () => {
    const { state, ctx, a } = duel();
    const mate = addSoldier(state, ctx, { name: 'M', team: 0, bot: false });
    mate.alive = true; mate.health = 100; place(mate, 0, 22, ctx);
    fireShot(state, ctx, a.id, claimAt(a, mate));
    expect(mate.health).toBe(100);
  });

  it('rejects teleports, accepts normal movement, and hurts long falls', () => {
    const { state, ctx, a } = duel();
    expect(reportState(state, ctx, a.id, report(a, { x: a.m.x + 0.2 }), 1 / 20)).toBe(true);
    expect(reportState(state, ctx, a.id, report(a, { x: a.m.x + 25 }), 1 / 20)).toBe(false);
    expect(a.corrections).toBe(1);
    a.m.grounded = false; a.m.vy = -16;
    reportState(state, ctx, a.id, report(a), 1 / 20);
    expect(a.health).toBeLessThan(100);
    expect(a.health).toBeGreaterThan(0);
  });

  it('absorbs network jitter but never pays for report spam', () => {
    const { state, ctx, a } = duel();
    const gaps = [0.002, 0.002, 0.146, 0.05, 0.004, 0.096];
    for (let i = 0; i < 60; i++) {
      expect(reportState(state, ctx, a.id, report(a, { x: a.m.x + 8.8 / 20 }), gaps[i % gaps.length])).toBe(true);
      a.m.x -= 8.8 / 20;
    }
    expect(a.corrections).toBe(0);
    let moved = 0;
    for (let i = 0; i < 200; i++) {
      const dir = i % 2 ? -1 : 1;
      if (reportState(state, ctx, a.id, report(a, { x: a.m.x + 0.5 * dir }), 0.005)) moved += 0.5;
    }
    expect(moved).toBeLessThanOrEqual(MOVE_SLACK.max + MOVE_SLACK.speed * 1);
    const y0 = a.m.y;
    for (let i = 0; i < 50; i++) reportState(state, ctx, a.id, report(a, { y: a.m.y + 0.3 }), 0.05);
    expect(a.m.y - y0).toBeLessThan(2.4);
    for (let i = 0; i < 80; i++) reportState(state, ctx, a.id, report(a), 0.05);
    expect(a.m.y - y0).toBeLessThan(0.36);
    expect(reportState(state, ctx, a.id, report(a, { y: a.m.y + 4 }), 0.5)).toBe(false);
  });

  it('accepts climbing a ladder far higher than a jump, and only on the ladder', () => {
    const env = duel(), a = env.a;
    const flat = { x0: -100, z0: -100, spacing: 4, n: 51, heights: new Float32Array(51 * 51) };
    const bounds = { minX: -90, maxX: 90, minZ: -90, maxZ: 90 };
    const world = new CollisionWorld([{ minX: 2, minY: 0, minZ: -2, maxX: 8, maxY: 6, maxZ: 2, surface: 'metal' }], [], flat, bounds, [{ x: 2, z: 0, y0: 0, y1: 6, width: 0.9, dir: 0 }]);
    const ctx = { ...env.ctx, world, map: { ...env.ctx.map, bounds } };
    const m = createMoveState(1.3, 0, 0);
    a.m = { ...m }; a.groundY = 0;
    for (let i = 1; i <= 240; i++) {
      stepMovement(world, m, { forward: 1, strafe: 0, yaw: -Math.PI / 2, jump: false, crouch: false, sprint: false, ads: false }, 1 / 120, a.team);
      if (i % 6 === 0) reportState(env.state, ctx, a.id, { x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, yaw: 0, pitch: 0, crouch: 0, grounded: m.grounded, sprint: false, ads: false, weapon: 0 }, 0.05);
    }
    expect(m.y).toBeCloseTo(6, 2);
    expect(a.m.y).toBeCloseTo(6, 1);
    expect(a.corrections).toBe(0);
    // The same climb a few metres along the wall, away from the ladder, is hovering.
    a.m = createMoveState(1.3, 0, 8); a.groundY = 0;
    for (let i = 1; i <= 20; i++) reportState(env.state, ctx, a.id, { x: 1.3, y: i * 0.17, z: 8, vx: 0, vy: 3.4, vz: 0, yaw: 0, pitch: 0, crouch: 0, grounded: false, sprint: false, ads: false, weapon: 0 }, 0.05);
    expect(a.corrections).toBeGreaterThan(0);
    expect(a.m.y).toBeLessThan(2.1);
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
    expect(m.y).toBeCloseTo(1.7, 2);
    expect(a.corrections).toBe(0);
  });
});

describe('store and cash', () => {
  it('buys a primary in base during buy time, swaps owned weapons free, refuses later', () => {
    const { state, ctx, a } = duel();
    const side = sideOf(state, ctx.map, a.team);
    const base = ctx.map.spawns.find(p => p.team === side)!;
    place(a, base.x, base.z, ctx, base.y + 1);
    a.money = 5000;
    expect(buyItem(state, ctx, a.id, 'm4a1').ok).toBe(true);
    expect(a.money).toBe(5000 - WEAPONS.m4a1.price);
    expect(a.weapons[0]).toBe('m4a1');
    expect(buyItem(state, ctx, a.id, 'mp5').ok).toBe(true);
    expect(a.money).toBe(5000 - WEAPONS.m4a1.price);
    expect(buyItem(state, ctx, a.id, 'm1014').ok).toBe(false); // too expensive now
    expect(buyItem(state, ctx, a.id, 'm4a1').ok).toBe(true);    // owned: free
    state.roundClock = state.config.buyTime + 1;
    expect(buyItem(state, ctx, a.id, 'mp5').ok).toBe(false);
  });

  it('attachments fit by weapon, replace their category and change stats', () => {
    const { state, a } = duel();
    a.money = 10000;
    expect(buyAttachmentFor(state, a.id, 'mp5', 'acog').ok).toBe(true);
    expect(a.attachments.mp5?.optic).toBe('acog');
    expect(buyAttachmentFor(state, a.id, 'mp5', 'holo').ok).toBe(true);
    expect(a.attachments.mp5?.optic).toBe('holo');
    expect(buyAttachmentFor(state, a.id, 'm4a1', 'acog').ok).toBe(false); // not owned
    const before = a.money;
    expect(buyAttachmentFor(state, a.id, 'mp5', 'extendedClip').ok).toBe(true);
    expect(a.money).toBeLessThan(before);
    expect(weaponStats('mp5', a.attachments.mp5).magazine).toBeGreaterThan(WEAPONS.mp5.magazine);
    // Gadgets stack: a laser, a flashlight and a suppressor together, the optic kept.
    for (const id of ['laser', 'flashlight', 'suppressor'] as const) expect(buyAttachmentFor(state, a.id, 'mp5', id).ok).toBe(true);
    expect(a.attachments.mp5).toMatchObject({ optic: 'holo', laser: 'laser', light: 'flashlight', muzzle: 'suppressor', magazine: 'extendedClip' });
  });

  it('the M67 is limited to one and High Explosive is an upgrade', () => {
    const { state, ctx, a } = duel();
    a.money = 5000;
    expect(buyItem(state, ctx, a.id, 'grenade').ok).toBe(true);
    expect(buyItem(state, ctx, a.id, 'grenade').ok).toBe(false);
    expect(buyItem(state, ctx, a.id, 'highExplosive').ok).toBe(true);
    expect(a.money).toBe(5000 - GRENADE.price - 1500);
  });

  it('an ammo crate costs once per round and restocks part of a magazine', () => {
    const { state, ctx, a } = duel();
    const crate = ctx.map.pickups![0];
    place(a, crate.x + 1, crate.z, ctx, crate.y + 1);
    a.reserve[0] = 0; a.money = 1000;
    expect(useAmmoCrate(state, ctx, a.id, 0)).toBe(true);
    expect(a.reserve[0]).toBe(WEAPONS.mp5.restock);
    expect(a.money).toBe(1000 - CASH.crate);
    expect(useAmmoCrate(state, ctx, a.id, 0)).toBe(true);
    expect(a.money).toBe(1000 - CASH.crate);
    place(a, crate.x + 10, crate.z, ctx);
    expect(useAmmoCrate(state, ctx, a.id, 0)).toBe(false);
  });

  it('shotgun pellets follow one fixed pattern inside the cone', () => {
    const dir = { x: 0.6, y: -0.2, z: -0.77 }, w = weaponStats('m1014'), cone = pelletCone(w, false);
    const a = pelletDirs(dir, cone, w.pellets), b = pelletDirs(dir, cone, w.pellets);
    expect(a).toEqual(b);
    expect(a).toHaveLength(14);
    const len = Math.hypot(dir.x, dir.y, dir.z);
    for (const d of a) {
      const angle = Math.acos(Math.min(1, (d.x * dir.x + d.y * dir.y + d.z * dir.z) / len)) * 180 / Math.PI;
      expect(angle).toBeLessThanOrEqual(cone + 1e-6);
    }
  });
});

describe('frame', () => {
  it('the packed frame round-trips poses, round, bomb and shots', () => {
    const { ctx, state } = setup({ ...SABOTAGE, teamSize: 6, warmup: 0 }, 3);
    balanceTeams(state, ctx);
    tick(state, ctx, 6);
    state.bomb = { site: 0, armed: true, progress: 0.5, by: 7 };
    state.bodies.push({ id: 999, kind: 'grenade', x: 1, y: 2, z: 3, vx: 30, vy: 1, vz: 0, age: 0, owner: 1, team: 0, hp: 1, timer: 2 });
    const a = state.soldiers[3];
    a.yaw = -2.5; a.pitch = 0.4; a.reloadLeft = 1; a.sinceShot = 0; a.weapon = 2; a.using = true;
    const shot = { type: 'shot' as const, shooter: a.id, weapon: 'm110' as const, from: { x: 1.23, y: 2, z: -3 }, to: { x: 40.5, y: 1, z: -80.02 }, hit: 1 as const, surface: 'concrete' };
    const frame = decodeFrame(encodeFrame(state, [shot]))!;
    expect(frame.tick).toBe(state.tick);
    expect(frame.round).toBe(state.round);
    expect(frame.roundPhase).toBe(state.roundPhase);
    expect(frame.bomb.site).toBe(0); expect(frame.bomb.armed).toBe(true); expect(frame.bomb.by).toBe(7);
    expect(frame.bomb.progress).toBeCloseTo(0.5, 2);
    expect(frame.poses.length).toBe(12);
    const pose = frame.poses[3];
    expect(pose.id).toBe(a.id);
    expect(pose.weapon).toBe(2); expect(pose.weaponId).toBe('knife');
    expect(pose.using).toBe(true); expect(pose.reloading).toBe(true); expect(pose.firing).toBe(true);
    expect(pose.x).toBeCloseTo(a.m.x, 1);
    expect(pose.health).toBe(Math.round(a.health));
    expect(frame.poses[0].ammo).toBe(state.soldiers[0].weapon === 2 ? 0 : state.soldiers[0].ammo[state.soldiers[0].weapon as 0 | 1]);
    expect(frame.bodies[frame.bodies.length - 1].kind).toBe('grenade');
    expect(frame.shots[0].weapon).toBe('m110');
    expect(frame.shots[0].surface).toBe('concrete');
    expect(frame.shots[0].to.z).toBeCloseTo(-80.02, 1);
    const other = frame.poses[0], s0 = state.soldiers[0];
    expect(other.weaponId).toBe(s0.weapons[s0.weapon as 0 | 1]);
  });
});

describe('idle humans (the server drops a client quiet for over 45 s)', () => {
  /** Two humans per team, so a death does not end the round; everyone but `a` keeps reporting. */
  function room() {
    const { ctx, state } = setup({ ...ELIMINATION, roundTime: 600, roundTimeSingle: 600 });
    const a = addSoldier(state, ctx, { name: 'A', team: 0, bot: false });
    const others = [
      addSoldier(state, ctx, { name: 'B', team: 0, bot: false }),
      addSoldier(state, ctx, { name: 'C', team: 1, bot: false }),
      addSoldier(state, ctx, { name: 'D', team: 1, bot: false }),
    ];
    goLive(state, ctx);
    const play = (seconds: number) => {
      for (let t = 0; t < seconds; t++) {
        for (const s of others) if (s.alive) reportState(state, ctx, s.id, report(s), 1);
        tick(state, ctx, 1);
      }
    };
    return { ctx, state, a, play };
  }

  it('does not count a dead soldier as idle: a spectator stays well under the limit for 60 s', () => {
    const { ctx, state, a, play } = room();
    reportState(state, ctx, a.id, report(a), 1 / 20);
    killSoldier(state, ctx, a, undefined, 'fall', false);
    const atDeath = a.idle;
    play(60);
    expect(state.roundPhase).toBe('live');
    expect(a.alive).toBe(false);
    expect(a.idle).toBe(atDeath);
    expect(a.idle).toBeLessThan(1);
  });

  it('still counts an alive human who stops reporting past 45 s', () => {
    const { a, play } = room();
    play(46);
    expect(a.alive).toBe(true);
    expect(a.idle).toBeGreaterThan(45);
  });
});

describe('join and leave events (clients note humans in the chat)', () => {
  it('say whether the soldier is a bot, and which team a leaver was on', () => {
    const { ctx, state, events } = setup();
    const human = addSoldier(state, ctx, { name: 'Ian', team: 1, bot: false });
    const bot = addSoldier(state, ctx, { name: 'Unit-9', team: 0, bot: true });
    removeSoldier(state, ctx, human.id);
    removeSoldier(state, ctx, bot.id);
    const mine = events.filter(e => (e.type === 'join' || e.type === 'leave') && (e.id === human.id || e.id === bot.id));
    expect(mine).toEqual([
      { type: 'join', id: human.id, name: 'Ian', team: 1, bot: false },
      { type: 'join', id: bot.id, name: 'Unit-9', team: 0, bot: true },
      { type: 'leave', id: human.id, name: 'Ian', team: 1, bot: false },
      { type: 'leave', id: bot.id, name: 'Unit-9', team: 0, bot: true },
    ]);
  });
});

describe('switching sides (only toward the side with fewer humans, between fights)', () => {
  /** A 6v6 room with these many humans per side (bots fill the rest), in round 1's buy freeze. */
  function room(humans: [number, number], config: MatchConfig = ELIMINATION) {
    const { ctx, state, events } = setup({ ...config, teamSize: 6 });
    const people = ([0, 1] as Team[]).flatMap(team => Array.from({ length: humans[team] }, (_, i) => addSoldier(state, ctx, { name: `H${team}${i}`, team, bot: false })));
    balanceTeams(state, ctx);
    resetMatch(state, ctx);
    return { ctx, state, events, people };
  }
  const count = (state: MatchState, team: Team, bot: boolean) => state.soldiers.filter(s => s.team === team && s.bot === bot).length;

  it('moves a human to the side with fewer humans in the buy freeze, redeploys them there, and evens out the bots', () => {
    const { ctx, state, events, people } = room([2, 0]);
    expect([state.phase, state.roundPhase]).toEqual(['live', 'freeze']);
    const a = people[0];
    const before = { x: a.m.x, z: a.m.z };
    expect(canSwitchTeam(state, a)).toBe('ok');
    expect(switchTeam(state, ctx, a.id)).toBe(true);
    expect(a.team).toBe(1);
    expect(a.alive).toBe(true);
    expect(Math.hypot(a.m.x - before.x, a.m.z - before.z)).toBeGreaterThan(5);
    expect([count(state, 0, false), count(state, 1, false)]).toEqual([1, 1]);
    expect([count(state, 0, true), count(state, 1, true)]).toEqual([5, 5]);
    expect(events.some(e => e.type === 'team' && e.id === a.id && e.team === 1)).toBe(true);
  });

  it('lets a lone human pick either side', () => {
    const { ctx, state, people: [a] } = room([1, 0]);
    expect(switchTeam(state, ctx, a.id)).toBe(true);
    expect(a.team).toBe(1);
    expect(switchTeam(state, ctx, a.id)).toBe(true);
    expect(a.team).toBe(0);
  });

  it('refuses a switch that would not even things out', () => {
    const even = room([1, 1]);
    for (const p of even.people) {
      expect(canSwitchTeam(even.state, p)).toBe('even');
      expect(switchTeam(even.state, even.ctx, p.id)).toBe(false);
    }
    // 2 v 1: the lone human cannot cross (the other side has more humans); one of the pair may, since
    // 1 < 2 (that mirrors the split to 1 v 2: never worse).
    const { ctx, state, people } = room([2, 1]);
    const lone = people.find(p => p.team === 1)!;
    expect(canSwitchTeam(state, lone)).toBe('even');
    expect(switchTeam(state, ctx, lone.id)).toBe(false);
    expect(canSwitchTeam(state, people[0])).toBe('ok');
  });

  it('holds a mid-round switch for the next buy freeze', () => {
    const { ctx, state, people: [a] } = room([2, 0]);
    tick(state, ctx, state.config.freezeTime + 0.2);
    expect(state.roundPhase).toBe('live');
    expect(canSwitchTeam(state, a)).toBe('later');
    expect(switchTeam(state, ctx, a.id)).toBe(false);
    expect(a.team).toBe(0);
  });

  it('never applies to bots or on the practice range', () => {
    const { state } = room([1, 0]);
    expect(canSwitchTeam(state, state.soldiers.find(s => s.bot))).toBe('no');
    const practice = room([2, 0], PRACTICE_CONFIG);
    expect(canSwitchTeam(practice.state, practice.people[0])).toBe('no');
  });
});
