import { describe, expect, it } from 'vitest';
import { loadMap, loadNav } from './index';
import { findPath, nearestNode, type NavGraph } from '../match/nav';
import { mapsFor } from '../match/rooms';
import { rng } from '../math';
import { MOVE } from '../movement';
import { TICK_RATE, addSoldier, createContext, createMatch, resetMatch, tickMatch } from '../match/sim';
import { ATTACKERS, ELIMINATION, SABOTAGE, type MatchEvent } from '../match/state';
import { balanceTeams } from '../match/sim';
import { clearLine } from './sightlines';
import { AMMO, SPAWNS, VEHICLES, XINYI_NAME_ZH } from './xinyi';
import { B1, F2, SKY } from './xinyi-plan';

const ID = 'xinyi';
const EYE = 1.55;

/** Walking distance along the bots' graph. */
function walk(nav: NavGraph, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  const p = findPath(nav, nearestNode(nav, a.x, a.y, a.z), nearestNode(nav, b.x, b.y, b.z));
  expect(p.length).toBeGreaterThan(1);
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(nav.x[p[i]] - nav.x[p[i - 1]], nav.y[p[i]] - nav.y[p[i - 1]], nav.z[p[i]] - nav.z[p[i - 1]]);
  return d;
}

describe('xinyi: Taipei 101 · Xinyi, our own layout', () => {
  it('is a big map for 24v24 (and smaller rooms) in Elimination and Sabotage: about 272 × 292 m', () => {
    const { def } = loadMap(ID);
    expect(XINYI_NAME_ZH).toBe('台北101・信義');
    expect(def.name).toBe('Taipei 101 · Xinyi');
    const b = def.bounds;
    expect(b.maxX - b.minX).toBeGreaterThan(260); expect(b.maxX - b.minX).toBeLessThan(285);
    expect(b.maxZ - b.minZ).toBeGreaterThan(280); expect(b.maxZ - b.minZ).toBeLessThan(300);
    expect(def.big).toBe(true);
    // Only big maps host 24v24, and big maps host nothing smaller.
    expect(mapsFor(24)).toContain(ID); expect(mapsFor(24, 'sabotage')).toContain(ID);
    for (const size of [1, 6]) expect(mapsFor(size)).not.toContain(ID);
    expect(def.sabotage).toEqual({ sites: ['A', 'B'], attackerSpawn: 1 });
    expect(def.points.map(p => p.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect([...new Set(def.vehicles!.map(v => v.kind))].sort()).toEqual(['car', 'heli', 'scooter']);
    expect(def.vehicles!.length).toBe(VEHICLES.length);
    expect(def.ladders!.length).toBeGreaterThanOrEqual(2);
  });

  it('deploys twelve slots of its own in each base (the loader pads to 24, none in a solid or on a stair) with an ammo crate close by', () => {
    const { def, world } = loadMap(ID);
    for (const team of [0, 1] as const) {
      expect(SPAWNS.filter(s => s[0] === team).length).toBe(12);
      const own = def.spawns.filter(s => s.team === team);
      expect(own.length).toBe(24);
      for (const s of own) {
        expect(world.overlapsSolid({ x: s.x, y: s.y, z: s.z }, 0.45, 1.8), `${s.x},${s.z}`).toBe(false);
        expect(world.groundHeight(s.x, s.z, s.y + 0.5, 0.35)).toBeCloseTo(s.y, 1);
        expect(world.rampsAt(s.x, s.z).some(i => { const r = world.ramps[i]; return s.x > r.minX - 0.5 && s.x < r.maxX + 0.5 && s.z > r.minZ - 0.5 && s.z < r.maxZ + 0.5; })).toBe(false);
      }
      const cx = own.reduce((a, s) => a + s.x, 0) / own.length, cz = own.reduce((a, s) => a + s.z, 0) / own.length;
      expect(def.pickups!.some(p => Math.hypot(p.x - cx, p.z - cz) < 20), `crate by base ${team}`).toBe(true);
    }
  });

  it('screens the bases: no slot sees a slot of the other base, and nobody on a street 100 m off sees into the middle of either', () => {
    const { def, world } = loadMap(ID);
    const [swat, militia] = [0, 1].map(t => def.spawns.filter(s => s.team === t));
    for (const a of swat) for (const b of militia) expect(clearLine(world, a.x, a.y + EYE, a.z, b.x, b.y + EYE, b.z), `${a.x},${a.z} -> ${b.x},${b.z}`).toBe(false);
  });

  it('puts SWAT on each site 1.2–2.8 s ahead of Militia (sprinting), and the bases a long walk apart', () => {
    const { def } = loadMap(ID); const nav = loadNav(ID);
    const slots = (team: number) => def.spawns.filter(s => s.team === team);
    const centre = (team: number) => { const s = slots(team); return { x: s.reduce((a, p) => a + p.x, 0) / s.length, y: s[0].y, z: s.reduce((a, p) => a + p.z, 0) / s.length }; };
    const apart = walk(nav, centre(0), centre(1));
    expect(apart).toBeGreaterThan(220); expect(apart).toBeLessThan(320);
    for (const id of def.sabotage!.sites) {
      const site = def.points.find(p => p.id === id)!;
      const first = (team: number) => Math.min(...slots(team).map(s => walk(nav, s, site)));
      const lead = (first(1) - first(0)) / MOVE.sprint;
      expect(lead, id).toBeGreaterThan(1.2);
      expect(lead, id).toBeLessThan(2.8);
    }
  });

  it('bots reach every site, floor, bridge, deck, roof and landmark from both bases', () => {
    const { def } = loadMap(ID); const nav = loadNav(ID);
    const spots: [string, number, number, number][] = [
      ...def.points.map(p => [`point ${p.id}`, p.x, p.z, p.y] as [string, number, number, number]),
      ['food court', 22, 20, B1], ['ground floor, west ring', 4, 0, 0], ['ground floor, north ring', 22, -42, 0], ['gallery, north', 22, -42, F2], ['gallery, south', 22, 42, F2],
      ['the bridge', 22, 0, F2], ['B1 passage', 44, -3, B1], ['garden floor', 76, -20, B1], ['garden stair, north (top)', 72, -35, 0], ['garden stair, south (top)', 72, 26, 0],
      ['skywalk, north end', -94, -107, SKY], ['skywalk, over Xinyi Rd', -94, -88, SKY], ['skywalk, plaza end', -94, -70, SKY],
      ['village lane', 45, 112, 0], ['village middle row', 40, 125, 0], ['village lookout roof', 58, 125, 4.35], ['village back lane', 40, 135, 0],
      ['Xinyi Rd, west', -115, -88, 0], ['Heping Rd, east', 90, 80, 0], ['helipad', 106, -88, 0], ['trailhead', 117, 60, 0],
      ['SWAT forecourt', 0, -106, 0], ['Militia forecourt', 45, 98, 0], ['plaza, south-west', -100, 40, 0], ['tower plaza', -35, 40, 0],
    ];
    for (const team of [0, 1]) {
      const sp = def.spawns.find(s => s.team === team)!;
      const start = nearestNode(nav, sp.x, sp.y, sp.z);
      for (const [name, x, z, y] of spots) {
        const n = nearestNode(nav, x, y, z);
        expect(Math.abs(nav.y[n] - y), name).toBeLessThan(0.6);
        expect(Math.hypot(nav.x[n] - x, nav.z[n] - z), name).toBeLessThan(2.6);
        const path = findPath(nav, start, n);
        expect(path[path.length - 1], `${team}->${name}`).toBe(n);
      }
    }
  });

  it('puts every ammo crate on a floor, clear of everything, and both bases can walk to each', () => {
    const { def, world } = loadMap(ID); const nav = loadNav(ID);
    expect(AMMO.length).toBeGreaterThanOrEqual(12);
    for (const p of def.pickups!) {
      expect(Math.abs(world.groundHeight(p.x, p.z, p.y + 0.5, 0.3) - p.y), `crate@${p.x},${p.z}`).toBeLessThan(0.1);
      expect(world.overlapsSolid({ x: p.x, y: p.y + 0.1, z: p.z }, 0.35, 1.2), `crate@${p.x},${p.z}`).toBe(false);
      for (const team of [0, 1]) {
        const sp = def.spawns.find(s => s.team === team)!;
        const goal = nearestNode(nav, p.x, p.y, p.z), path = findPath(nav, nearestNode(nav, sp.x, sp.y, sp.z), goal);
        expect(path[path.length - 1], `${team}->crate@${p.x},${p.z}`).toBe(goal);
      }
    }
  });

  it('has working ladders: each top is reachable and its foot stands on a floor', () => {
    const { def, world } = loadMap(ID); const nav = loadNav(ID);
    const sp = def.spawns.find(s => s.team === 0)!, start = nearestNode(nav, sp.x, sp.y, sp.z);
    for (const l of def.ladders!) {
      const n = nearestNode(nav, l.x, l.y1, l.z);
      expect(Math.abs(nav.y[n] - l.y1), `ladder@${l.x},${l.z}`).toBeLessThan(0.6);
      const path = findPath(nav, start, n);
      expect(path[path.length - 1], `ladder@${l.x},${l.z}`).toBe(n);
      expect(world.groundHeight(l.x, l.z + 1.2, l.y0 + 0.5, 0.3)).toBeLessThan(l.y0 + 0.6);
    }
  });

  it('parks its vehicles clear of geometry: cars on both boulevards, scooters at both bases, the helicopter on its pad', () => {
    const { def } = loadMap(ID);
    const heli = def.vehicles!.find(v => v.kind === 'heli')!;
    expect(heli.x).toBeGreaterThan(96); expect(heli.z).toBeLessThan(-78);
    for (const team of [0, 1]) {
      const own = def.spawns.filter(s => s.team === team);
      const near = def.vehicles!.filter(v => v.kind === 'scooter' && own.some(s => Math.hypot(s.x - v.x, s.z - v.z) < 18));
      expect(near.length, `scooters at base ${team}`).toBeGreaterThanOrEqual(3);
    }
    expect(def.vehicles!.filter(v => v.kind === 'car').length).toBeGreaterThanOrEqual(5);
  });

  for (const [site, name] of [[0, 'the mall atrium (A)'], [1, 'the west plaza (B)']] as const) {
    it(`Sabotage: Militia bots find their way to ${name} and arm it`, () => {
      const events: MatchEvent[] = [];
      const ctx = createContext(ID, rng(5), e => events.push(e));
      const state = createMatch(ID, { ...SABOTAGE, teamSize: 0, warmup: 0, botSkill: 0.2 });
      for (let i = 0; i < 4; i++) addSoldier(state, ctx, { name: `M${i}`, team: ATTACKERS, bot: true });
      const swat = addSoldier(state, ctx, { name: 'S', team: (1 - ATTACKERS) as 0 | 1, bot: false });
      resetMatch(state, ctx);
      if (state.round % 2 !== site) state.round++;
      for (let i = 0; i < 120 * TICK_RATE && !state.bomb.armed; i++) {
        swat.m.x = 0; swat.m.y = -30; swat.m.z = 0;
        tickMatch(state, ctx, 1 / TICK_RATE);
      }
      expect(events.find(e => e.type === 'bomb' && e.action === 'armed')).toMatchObject({ site });
    }, 60_000);
  }

  it('runs 24v24: everyone deploys in the base at once without standing in each other or a wall, and the fight goes on without anyone stuck in a solid', () => {
    const ctx = createContext(ID, rng(11), () => undefined);
    const state = createMatch(ID, { ...ELIMINATION, teamSize: 24, warmup: 0 });
    balanceTeams(state, ctx);
    expect(state.soldiers.filter(s => s.team === 0).length).toBe(24);
    expect(state.soldiers.filter(s => s.team === 1).length).toBe(24);
    for (let i = 0; i < 3; i++) tickMatch(state, ctx, 1 / TICK_RATE);
    for (const a of state.soldiers) {
      expect(ctx.world.overlapsSolid(a.m, 0.3, 1.2)).toBe(false);
      for (const b of state.soldiers) if (a !== b && a.team === b.team) expect(Math.hypot(a.m.x - b.m.x, a.m.z - b.m.z)).toBeGreaterThan(0.5);
    }
    for (let i = 0; i < 40 * TICK_RATE; i++) tickMatch(state, ctx, 1 / TICK_RATE);
    for (const s of state.soldiers) if (s.alive) expect(ctx.world.overlapsSolid(s.m, 0.2, 1.2)).toBe(false);
  }, 60_000);
});
