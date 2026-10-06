import { describe, expect, it } from 'vitest';
import { loadMap, loadNav } from './index';
import { findPath, nearestNode, type NavGraph } from '../match/nav';
import { mapsFor } from '../match/rooms';
import { rng } from '../math';
import { MOVE } from '../movement';
import { BOMB_REACH, TICK_RATE, addSoldier, createContext, createMatch, onSite, resetMatch, tickMatch } from '../match/sim';
import { ATTACKERS, SABOTAGE, type MatchEvent } from '../match/state';
import { longSightlines } from './sightlines';
import { GRAND, LEVEL, MEMORIAL_NAME_ZH, SPAWNS } from './memorial';

/** Walking distance along the bots' graph. */
function walk(nav: NavGraph, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  const p = findPath(nav, nearestNode(nav, a.x, a.y, a.z), nearestNode(nav, b.x, b.y, b.z));
  expect(p.length).toBeGreaterThan(1);
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(nav.x[p[i]] - nav.x[p[i - 1]], nav.y[p[i]] - nav.y[p[i - 1]], nav.z[p[i]] - nav.z[p[i - 1]]);
  return d;
}

/** The grand staircase: its three flights and landings, up to the top step on the platform. */
const onGrandStairs = (x: number, z: number) => x > GRAND.flights[0][0] && x < -18.75 && z > GRAND.z0 && z < GRAND.z1;
/** The view down the grand staircase's axis: Liberty Square, the stairs and the terraces either side of them, up to the bronze doors. */
const onAxis = ([x, , z]: [number, number, number]) => x < -14.5 && Math.abs(z) < 15;

describe('memorial: Memorial Hall (中正紀念堂)', () => {
  it('is a compact arena for 1v1 and 6v6 in Elimination and Sabotage, not 24v24', () => {
    const { def } = loadMap('memorial');
    expect(MEMORIAL_NAME_ZH).toBe('中正紀念堂');
    const { bounds: b } = def;
    expect(b.maxX - b.minX).toBeGreaterThan(110); expect(b.maxX - b.minX).toBeLessThan(140);
    expect(b.maxZ - b.minZ).toBeGreaterThan(85); expect(b.maxZ - b.minZ).toBeLessThan(110);
    expect(def.big).toBeFalsy();
    expect(def.vehicles ?? []).toEqual([]);
    for (const size of [1, 6]) {
      expect(mapsFor(size)).toContain('memorial');
      expect(mapsFor(size, 'sabotage')).toContain('memorial');
    }
    expect(mapsFor(24)).not.toContain('memorial');
    expect(def.sabotage).toEqual({ sites: ['A', 'B'], attackerSpawn: 1 });
  });

  it('climbs the 89 steps of the grand staircase from Liberty Square to the platform', () => {
    expect(GRAND.flights.reduce((n, f) => n + f[4], 0)).toBe(89);
    expect(GRAND.flights[0][2]).toBe(LEVEL.G);
    expect(GRAND.flights[2][3]).toBe(LEVEL.H);
    const nav = loadNav('memorial');
    // Straight up the middle: every node on the way is on the staircase or its landings.
    const p = findPath(nav, nearestNode(nav, -52.5, 0, 0), nearestNode(nav, -17.5, LEVEL.H, 0));
    expect(p.length).toBeGreaterThan(10);
    expect(nav.y[p[p.length - 1]]).toBeCloseTo(LEVEL.H, 1);
    for (const i of p) expect(Math.abs(nav.z[i]), `${nav.x[i]},${nav.z[i]}`).toBeLessThan(GRAND.z1);
  });

  it('has no open view longer than 55 m between places a soldier can stand, but down the grand staircase', () => {
    const { world } = loadMap('memorial'); const nav = loadNav('memorial');
    // Every node of the bots' graph (gardens, terraces, galleries, the chamber), eye to eye.
    const lines = longSightlines(world, nav, 55, onGrandStairs, 1).filter(l => !(onAxis(l.a) && onAxis(l.b)));
    expect(lines.slice(0, 5).map(l => `${l.length.toFixed(1)} m: ${l.a.map(v => v.toFixed(1))} -> ${l.b.map(v => v.toFixed(1))}`)).toEqual([]);
  }, 30_000);

  it('puts the bases 110–140 m apart on foot, and SWAT on each site 1.5–2.5 s ahead of Militia', () => {
    const { def } = loadMap('memorial'); const nav = loadNav('memorial');
    const slots = (team: number) => def.spawns.filter(s => s.team === team);
    const centre = (team: number) => { const s = slots(team); return { x: s.reduce((a, p) => a + p.x, 0) / s.length, y: s[0].y, z: s.reduce((a, p) => a + p.z, 0) / s.length }; };
    const apart = walk(nav, centre(0), centre(1));
    expect(apart).toBeGreaterThan(110); expect(apart).toBeLessThan(140);
    for (const id of def.sabotage!.sites) {
      const site = def.points.find(p => p.id === id)!;
      const first = (team: number) => Math.min(...slots(team).map(s => walk(nav, s, site)));
      // At a sprint, the first defender is on the site 1.5–2.5 s before the first attacker.
      const lead = (first(1) - first(0)) / MOVE.sprint;
      expect(lead, id).toBeGreaterThan(1.5);
      expect(lead, id).toBeLessThan(2.5);
    }
  });

  it('bots reach every room, floor, terrace, stair and garden from both bases', () => {
    const { def } = loadMap('memorial'); const nav = loadNav('memorial');
    const { G, M, U, H } = LEVEL;
    const spots: [string, number, number, number][] = [
      // The chamber and the platform round the hall.
      ['before the statue', 2.5, 0, H], ['chamber by the bronze doors', -10, -7.5, H], ['chamber, north side door', -7.5, -12.5, H],
      ['platform west (top of the grand staircase)', -17.5, 0, H], ['platform north', 5, -17.5, H], ['platform south', -10, 17.5, H], ['platform east', 17.5, 10, H],
      // Grand staircase landings, the rear staircase, the side stairs' landings.
      ['grand staircase, first landing', -40, 0, M], ['grand staircase, second landing', -30, 0, U], ['rear staircase, middle', 32.5, 0, 6.99],
      ['north side stair, first landing', -5, -35, M], ['north side stair, second landing', 5, -27.5, U], ['south side stair, top', -5, 22.5, 13.2],
      // Terraces.
      ['first terrace north', 15, -32.5, M], ['first terrace south', -27.5, 32.5, M], ['first terrace west', -37.5, 25, M], ['first terrace east', 32.5, -20, M],
      ['second terrace north', -20, -22.5, U], ['second terrace south', 20, 25, U], ['second terrace west', -25, -17.5, U], ['second terrace east', 25, 15, U],
      // Upper gallery (M) and the stairwells' landings up to the chamber.
      ['upper gallery west', -27.5, -15, M], ['upper gallery north', -10, -22.5, M], ['upper gallery east', 25, 20, M], ['balcony over the Gallery Hall', -5, -7.5, M],
      ['north stairwell landing', 12.5, -10, U], ['south stairwell landing', 12.5, 10, U],
      // Ground floor (G): the museum.
      ['entrance hall', -37.5, 2.5, G], ['exhibition room 1', -32.5, -20, G], ['exhibition room 2', -15, -20, G], ['exhibition room 3', -15, 20, G],
      ['exhibition room 4', -32.5, 25, G], ['exhibition room 5', -5, 25, G], ['lecture hall', -2.5, -22.5, G], ['library', 22.5, -25, G],
      ['gift shop', 22.5, 22.5, G], ['east lobby', 30, 0, G], ['Gallery Hall', -10, 0, G],
      // Grounds.
      ['Liberty Square', -55, 5, G], ['east forecourt', 40, -7.5, G], ['north-west garden', -60, -40, G], ['south-west garden', -60, 25, G],
      ['north garden by the pavilion', -17.5, -47.5, G], ['south garden by the pond', 37.5, 43.75, G], ['north-east garden', 50, -40, G], ['south-east garden', 47.5, 25, G],
    ];
    for (const team of [0, 1]) {
      const sp = def.spawns.find(s => s.team === team)!;
      const start = nearestNode(nav, sp.x, sp.y, sp.z);
      for (const [name, x, z, y] of spots) {
        const n = nearestNode(nav, x, y, z);
        expect(Math.abs(nav.y[n] - y), name).toBeLessThan(0.3);
        expect(Math.hypot(nav.x[n] - x, nav.z[n] - z), name).toBeLessThan(1.5);
        expect(findPath(nav, start, n).length, `${team}->${name}`).toBeGreaterThan(3);
      }
    }
  });

  it('arms each site on its own floor: the chamber (B) is not armed from the Gallery Hall (A) under it, nor A from the chamber', () => {
    const { def } = loadMap('memorial');
    const [a, b] = def.sabotage!.sites.map(id => def.points.find(p => p.id === id)!);
    // The sites stack (A under B) within arming reach across the floor; the floor tells them apart.
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(BOMB_REACH * 2);
    expect(onSite(a, a.x, a.y, a.z, BOMB_REACH)).toBe(true);
    expect(onSite(a, a.x, b.y, a.z, BOMB_REACH)).toBe(false);
    expect(onSite(b, b.x, a.y, b.z, BOMB_REACH)).toBe(false);
    expect(onSite(b, b.x, LEVEL.M, b.z, BOMB_REACH)).toBe(false);
  });

  for (const [site, name] of [[0, 'the Gallery Hall (A)'], [1, 'the chamber upstairs (B)']] as const) {
    it(`Sabotage: Militia bots find their way to ${name} and arm it`, () => {
      const events: MatchEvent[] = [];
      const ctx = createContext('memorial', rng(5), e => events.push(e));
      const state = createMatch('memorial', { ...SABOTAGE, teamSize: 0, warmup: 0, botSkill: 0.2 });
      for (let i = 0; i < 4; i++) addSoldier(state, ctx, { name: `M${i}`, team: ATTACKERS, bot: true });
      // One SWAT player hiding under the map keeps the round going.
      const swat = addSoldier(state, ctx, { name: 'S', team: (1 - ATTACKERS) as 0 | 1, bot: false });
      resetMatch(state, ctx);
      // Attackers take the round's site in turn (round % sites).
      if (state.round % 2 !== site) state.round++;
      for (let i = 0; i < 60 * TICK_RATE && !state.bomb.armed; i++) {
        swat.m.x = 0; swat.m.y = -30; swat.m.z = 0;
        tickMatch(state, ctx, 1 / TICK_RATE);
      }
      expect(events.find(e => e.type === 'bomb' && e.action === 'armed')).toMatchObject({ site });
    }, 30_000);
  }

  it('deploys twelve slots in each base, none inside a solid or on a stair, with an ammo crate close by', () => {
    const { def, world } = loadMap('memorial');
    for (const team of [0, 1] as const) {
      const own = def.spawns.filter(s => s.team === team);
      // All twelve are the map's own (none padded by the loader).
      expect(own.length).toBe(12);
      expect(SPAWNS.filter(s => s[0] === team).length).toBe(12);
      for (const s of own) {
        expect(world.overlapsSolid({ x: s.x, y: s.y, z: s.z }, 0.45, 1.8), `${s.x},${s.z}`).toBe(false);
        expect(world.groundHeight(s.x, s.z, s.y + 0.5, 0.35)).toBeCloseTo(s.y, 2);
        expect(world.rampsAt(s.x, s.z).some(i => { const r = world.ramps[i]; return s.x > r.minX - 0.5 && s.x < r.maxX + 0.5 && s.z > r.minZ - 0.5 && s.z < r.maxZ + 0.5; })).toBe(false);
      }
      const cx = own.reduce((a, s) => a + s.x, 0) / 12, cz = own.reduce((a, s) => a + s.z, 0) / 12;
      expect(def.pickups!.some(p => Math.hypot(p.x - cx, p.z - cz) < 20), `crate by base ${team}`).toBe(true);
    }
    // Crates round the map stand on a floor, clear of everything.
    for (const p of def.pickups!) {
      expect(Math.abs(world.groundHeight(p.x, p.z, p.y + 0.5, 0.3) - p.y), `crate@${p.x},${p.z}`).toBeLessThan(0.05);
      expect(world.overlapsSolid({ x: p.x, y: p.y + 0.05, z: p.z }, 0.35, 1.2), `crate@${p.x},${p.z}`).toBe(false);
    }
  });
});
