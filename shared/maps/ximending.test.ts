import { describe, expect, it } from 'vitest';
import { loadMap, loadNav } from './index';
import { findPath, nearestNode, type NavGraph } from '../match/nav';
import { mapsFor } from '../match/rooms';
import { rng } from '../math';
import { MOVE } from '../movement';
import { TICK_RATE, addSoldier, createContext, createMatch, resetMatch, tickMatch } from '../match/sim';
import { ATTACKERS, SABOTAGE, type MatchEvent } from '../match/state';
import { clearLine, longSightlines } from './sightlines';
import { AMMO, SPAWNS, VEHICLES, XIMENDING_NAME_ZH } from './ximending';
import { BALCONY, PAD, ROOF } from './ximending-plan';

const ID = 'taipei';
const EYE = 1.55;

/** Walking distance along the bots' graph. */
function walk(nav: NavGraph, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  const p = findPath(nav, nearestNode(nav, a.x, a.y, a.z), nearestNode(nav, b.x, b.y, b.z));
  expect(p.length).toBeGreaterThan(1);
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(nav.x[p[i]] - nav.x[p[i - 1]], nav.y[p[i]] - nav.y[p[i - 1]], nav.z[p[i]] - nav.z[p[i - 1]]);
  return d;
}
/** The ring road and its sidewalks, outside the lanes' ends. */
const onRing = (x: number, z: number) => Math.abs(x) > 68 || Math.abs(z) > 50;

describe('taipei: Ximending (西門町), our own layout', () => {
  it('is a compact city map for 1v1 and 6v6 in Elimination and Sabotage, not 24v24: about 162 × 132 m', () => {
    const { def } = loadMap(ID);
    expect(XIMENDING_NAME_ZH).toBe('西門町');
    expect(def.name).toBe('Taipei'); // unchanged: the lobby lists the map as Taipei (西門町 in Chinese)
    const b = def.bounds;
    expect(b.maxX - b.minX).toBeGreaterThan(150); expect(b.maxX - b.minX).toBeLessThan(170);
    expect(b.maxZ - b.minZ).toBeGreaterThan(120); expect(b.maxZ - b.minZ).toBeLessThan(140);
    expect(def.big).toBeFalsy();
    for (const size of [1, 6]) {
      expect(mapsFor(size)).toContain(ID);
      expect(mapsFor(size, 'sabotage')).toContain(ID);
    }
    expect(mapsFor(24)).not.toContain(ID);
    expect(def.sabotage).toEqual({ sites: ['A', 'B'], attackerSpawn: 1 });
    expect(def.points.map(p => p.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    // Cars, scooters and the helicopter.
    expect([...new Set(def.vehicles!.map(v => v.kind))].sort()).toEqual(['car', 'heli', 'scooter']);
    expect(def.vehicles!.length).toBe(VEHICLES.length);
  });

  it('has no open view longer than 60 m between any two places a soldier can stand (the ring road aside)', () => {
    const { world } = loadMap(ID); const nav = loadNav(ID);
    // Every node of the bots' graph (streets, arcades, the market, the balcony, the roofs), eye to eye.
    const lines = longSightlines(world, nav, 60, onRing, 1);
    expect(lines.slice(0, 5).map(l => `${l.length.toFixed(1)} m: ${l.a.map(v => v.toFixed(1))} -> ${l.b.map(v => v.toFixed(1))}`)).toEqual([]);
  }, 60_000);

  it('screens the bases: no line over 60 m reaches into either, not even from the ring road, and no slot sees a slot of the other base', () => {
    const { def, world } = loadMap(ID); const nav = loadNav(ID);
    const bases = [[-68, -15, -47.5, 15], [47.5, -15, 68, 15]];
    const inBase = ([x, , z]: [number, number, number]) => bases.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
    const lines = longSightlines(world, nav, 60, undefined, 1).filter(l => inBase(l.a) || inBase(l.b));
    expect(lines.slice(0, 5).map(l => `${l.length.toFixed(1)} m: ${l.a.map(v => v.toFixed(1))} -> ${l.b.map(v => v.toFixed(1))}`)).toEqual([]);
    const [swat, militia] = [0, 1].map(t => def.spawns.filter(s => s.team === t));
    for (const a of swat) for (const b of militia) {
      expect(clearLine(world, a.x, a.y + EYE, a.z, b.x, b.y + EYE, b.z), `${a.x},${a.z} -> ${b.x},${b.z}`).toBe(false);
    }
  }, 60_000);

  it('puts the bases 110–150 m apart on foot, and SWAT on each site 1.5–2.5 s ahead of Militia', () => {
    const { def } = loadMap(ID); const nav = loadNav(ID);
    const slots = (team: number) => def.spawns.filter(s => s.team === team);
    const centre = (team: number) => { const s = slots(team); return { x: s.reduce((a, p) => a + p.x, 0) / s.length, y: s[0].y, z: s.reduce((a, p) => a + p.z, 0) / s.length }; };
    const apart = walk(nav, centre(0), centre(1));
    expect(apart).toBeGreaterThan(110); expect(apart).toBeLessThan(150);
    for (const id of def.sabotage!.sites) {
      const site = def.points.find(p => p.id === id)!;
      const first = (team: number) => Math.min(...slots(team).map(s => walk(nav, s, site)));
      const lead = (first(1) - first(0)) / MOVE.sprint;
      expect(lead, id).toBeGreaterThan(1.5);
      expect(lead, id).toBeLessThan(2.5);
    }
  });

  it('bots reach every lane, landmark, interior, deck and roof from both bases', () => {
    const { def } = loadMap(ID); const nav = loadNav(ID);
    const spots: [string, number, number, number][] = [
      // Site A and round it: the plaza, the balcony and both stairs, the cinema's lobby and back door, Cinema Street's alley.
      ['Cinema Street', -15, -32.5, 0], ['cinema balcony', -15, -35.5, BALCONY], ['west balcony stair, halfway', -28, -35.5, BALCONY / 2],
      ['east balcony stair, halfway', -3, -35.5, BALCONY / 2], ['cinema lobby', -15.5, -45, 0], ['cinema back door', -15.5, -49, 0],
      ['alley N (lane N to lane M)', -17.5, -17.5, 0],
      // Lanes and streets.
      ['lane N, west end', -62.5, -32.5, 0], ['lane N, east end', 62.5, -32.5, 0], ['lane S, west end', -62.5, 32.5, 0], ['lane S, east end', 62.5, 32.5, 0],
      ['Hanzhong St, north', 0, -32.5, 0], ['Hanzhong St, south', 0, 25, 0], ['West St', -42.5, 0, 0], ['East St', 42.5, 0, 0],
      // The night market, the arcade and its roof, the skybridge and the hotel roof.
      ['night market', -22.5, 0, 0], ['arcade hall', 24, -16, 0], ['arcade, east door', 37, -16, 0], ['mall passage', -56.5, -43.5, 0],
      ['arcade roof, by the west ladder', 7, -11.4, ROOF], ['beside the helipad', PAD[2] + 1.5, (PAD[1] + PAD[3]) / 2, ROOF],
      ['skybridge', 28.75, 0, ROOF], ['hotel roof', 25, 15, ROOF], ['hotel roof, by its ladder', 28.6, 26, ROOF],
      // Site B: the Red House square, between the octagon and the cross wing.
      ['Red House square', -8.5, 31, 0], ['between the octagon and the cross wing', -19, 42, 0], ['Red House, Hanzhong side', 0, 37.5, 0],
      // The bases and their alleys.
      ['SWAT plaza', -58, 0, 0], ['Militia yard', 58, 0, 0], ['alley W1', -57.5, -21, 0], ['alley E2', 54.5, 21, 0], ['alley E1', 59.5, -21, 0], ['alley W2', -57.5, 21, 0],
    ];
    for (const team of [0, 1]) {
      const sp = def.spawns.find(s => s.team === team)!;
      const start = nearestNode(nav, sp.x, sp.y, sp.z);
      for (const [name, x, z, y] of spots) {
        const n = nearestNode(nav, x, y, z);
        expect(Math.abs(nav.y[n] - y), name).toBeLessThan(0.3);
        expect(Math.hypot(nav.x[n] - x, nav.z[n] - z), name).toBeLessThan(1.5);
        const path = findPath(nav, start, n);
        expect(path[path.length - 1], `${team}->${name}`).toBe(n);
      }
    }
  });

  it('has cover close by: every place a soldier can stand off the ring road is within 8 m of something chest-high to hide behind', () => {
    const { world } = loadMap(ID); const nav = loadNav(ID);
    const bare: string[] = [];
    for (let i = 0; i < nav.x.length; i++) {
      const x = nav.x[i], y = nav.y[i], z = nav.z[i];
      if (onRing(x, z)) continue;
      let covered = false;
      world.forSolidsIn(x - 8, z - 8, x + 8, z + 8, s => {
        if (covered || s.maxY < y + 1.1 || s.minY > y + 0.5) return;
        const dx = Math.max(0, s.minX - x, x - s.maxX), dz = Math.max(0, s.minZ - z, z - s.maxZ);
        if (Math.hypot(dx, dz) <= 8) covered = true;
      });
      if (!covered) bare.push(`${x},${y.toFixed(1)},${z}`);
    }
    expect(bare).toEqual([]);
  });

  for (const [site, name] of [[0, 'Cinema Street (A)'], [1, 'the Red House square (B)']] as const) {
    it(`Sabotage: Militia bots find their way to ${name} and arm it`, () => {
      const events: MatchEvent[] = [];
      const ctx = createContext(ID, rng(5), e => events.push(e));
      const state = createMatch(ID, { ...SABOTAGE, teamSize: 0, warmup: 0, botSkill: 0.2 });
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

  it('deploys twelve slots in each base, none inside a solid or on a stair, with an ammo crate close by and one in each lane', () => {
    const { def, world } = loadMap(ID); const nav = loadNav(ID);
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
    // Crates stand on a floor, clear of everything, and both teams can walk to each one.
    for (const p of def.pickups!) {
      expect(Math.abs(world.groundHeight(p.x, p.z, p.y + 0.5, 0.3) - p.y), `crate@${p.x},${p.z}`).toBeLessThan(0.05);
      expect(world.overlapsSolid({ x: p.x, y: p.y + 0.05, z: p.z }, 0.35, 1.2), `crate@${p.x},${p.z}`).toBe(false);
      for (const team of [0, 1]) {
        const sp = def.spawns.find(s => s.team === team)!;
        expect(findPath(nav, nearestNode(nav, sp.x, sp.y, sp.z), nearestNode(nav, p.x, p.y, p.z)).length, `${team}->crate@${p.x},${p.z}`).toBeGreaterThan(1);
      }
    }
    // One crate in each of the three lanes, and in each half of lanes N and S.
    expect(AMMO.map(([, , z]) => (z < -20 ? 'N' : z > 20 ? 'S' : 'M')).sort().join('')).toBe('MMNNSS');
  });

  it('parks its vehicles clear of geometry: cars on the ring, scooters at both bases, the helicopter on the arcade roof', () => {
    const { def, world } = loadMap(ID);
    const heli = def.vehicles!.find(v => v.kind === 'heli')!;
    expect(heli.y).toBeCloseTo(ROOF, 2);
    expect(heli.x).toBeGreaterThan(PAD[0]); expect(heli.x).toBeLessThan(PAD[2]);
    expect(world.groundHeight(heli.x, heli.z, heli.y + 0.5, 0.3)).toBeCloseTo(ROOF, 1);
    for (const team of [0, 1]) {
      const own = def.spawns.filter(s => s.team === team);
      const near = def.vehicles!.filter(v => v.kind === 'scooter' && own.some(s => Math.hypot(s.x - v.x, s.z - v.z) < 12));
      expect(near.length, `scooters at base ${team}`).toBeGreaterThanOrEqual(3);
    }
    expect(def.vehicles!.filter(v => v.kind === 'car').every(v => Math.abs(v.x) > 70 || Math.abs(v.z) > 54)).toBe(true);
  });
});
