import { describe, expect, it } from 'vitest';
import { loadMap, loadNav } from './index';
import { findPath, nearestNode, type NavGraph } from '../match/nav';
import { mapsFor } from '../match/rooms';
import { rng } from '../math';
import { MOVE } from '../movement';
import { TICK_RATE, addSoldier, createContext, createMatch, resetMatch, tickMatch } from '../match/sim';
import { ATTACKERS, SABOTAGE, type MatchEvent } from '../match/state';
import { clearLine, longSightlines } from './sightlines';
import { AMMO, DECK, SANCHONG_NAME_ZH, SPAWNS } from './sanchong';
import { RAMP_X0, SHED_ROOF, STAGE_Y, TERRACE_Y } from './sanchong-plan';

/** Walking distance along the bots' graph. */
function walk(nav: NavGraph, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  const p = findPath(nav, nearestNode(nav, a.x, a.y, a.z), nearestNode(nav, b.x, b.y, b.z));
  expect(p.length).toBeGreaterThan(1);
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(nav.x[p[i]] - nav.x[p[i - 1]], nav.y[p[i]] - nav.y[p[i - 1]], nav.z[p[i]] - nav.z[p[i - 1]]);
  return d;
}

const EYE = 1.55;

describe('sanchong: Sanchong (三重), New Taipei', () => {
  it('is a compact city map for 1v1 and 6v6 in Elimination and Sabotage, not 24v24: about 150 × 115 m', () => {
    const { def } = loadMap('sanchong');
    expect(SANCHONG_NAME_ZH).toBe('三重');
    const b = def.bounds;
    expect(b.maxX - b.minX).toBeGreaterThan(140); expect(b.maxX - b.minX).toBeLessThan(160);
    expect(b.maxZ - b.minZ).toBeGreaterThan(105); expect(b.maxZ - b.minZ).toBeLessThan(135);
    expect(def.big).toBeFalsy();
    for (const size of [1, 6]) {
      expect(mapsFor(size)).toContain('sanchong');
      expect(mapsFor(size, 'sabotage')).toContain('sanchong');
    }
    expect(mapsFor(24)).not.toContain('sanchong');
    expect(def.sabotage).toEqual({ sites: ['A', 'B'], attackerSpawn: 1 });
    // Drivable scooters wait at both bases.
    for (const team of [0, 1]) {
      const own = def.spawns.filter(s => s.team === team);
      const near = (def.vehicles ?? []).filter(v => v.kind === 'scooter' && own.some(s => Math.hypot(s.x - v.x, s.z - v.z) < 10));
      expect(near.length, `scooters at base ${team}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('has no open view longer than 60 m between any two places a soldier can stand', () => {
    const { world } = loadMap('sanchong'); const nav = loadNav('sanchong');
    // Every node of the bots' graph (streets, arcades, the market, the bridge deck, the roofs), eye to eye.
    const lines = longSightlines(world, nav, 60, undefined, 1);
    expect(lines.slice(0, 5).map(l => `${l.length.toFixed(1)} m: ${l.a.map(v => v.toFixed(1))} -> ${l.b.map(v => v.toFixed(1))}`)).toEqual([]);
  }, 30_000);

  it('screens the bases: no spawn slot sees any slot of the other base', () => {
    const { def, world } = loadMap('sanchong');
    const [swat, militia] = [0, 1].map(t => def.spawns.filter(s => s.team === t));
    for (const a of swat) for (const b of militia) {
      expect(clearLine(world, a.x, a.y + EYE, a.z, b.x, b.y + EYE, b.z), `${a.x},${a.z} -> ${b.x},${b.z}`).toBe(false);
    }
  });

  it('puts the bases 130–170 m apart on foot, and SWAT on each site 1.5–2.5 s ahead of Militia', () => {
    const { def } = loadMap('sanchong'); const nav = loadNav('sanchong');
    const slots = (team: number) => def.spawns.filter(s => s.team === team);
    const centre = (team: number) => { const s = slots(team); return { x: s.reduce((a, p) => a + p.x, 0) / s.length, y: s[0].y, z: s.reduce((a, p) => a + p.z, 0) / s.length }; };
    const apart = walk(nav, centre(0), centre(1));
    expect(apart).toBeGreaterThan(130); expect(apart).toBeLessThan(170);
    for (const id of def.sabotage!.sites) {
      const site = def.points.find(p => p.id === id)!;
      const first = (team: number) => Math.min(...slots(team).map(s => walk(nav, s, site)));
      const lead = (first(1) - first(0)) / MOVE.sprint;
      expect(lead, id).toBeGreaterThan(1.5);
      expect(lead, id).toBeLessThan(2.5);
    }
  });

  it('bots reach every lane, landmark, deck and roof from both bases', () => {
    const { def } = loadMap('sanchong'); const nav = loadNav('sanchong');
    const ramp = (x: number) => (x - RAMP_X0) / 26 * DECK;
    const spots: [string, number, number, number][] = [
      // The Taipei Bridge approach: the ramp, the deck over the temple square, the east stair, under the deck.
      ['ramp foot', -55, -60, 0], ['scooter ramp, halfway up', -37.5, -60, ramp(-37.5)], ['deck over the square', 5, -57.5, DECK],
      ['deck by the site office', 15, -62.5, DECK], ['top of the east stair', 27.5, -57.5, DECK], ['east stair, halfway', 37.5, -57.5, (42 - 37.5) / 12 * DECK],
      ['under the bridge', 0, -60, 0], ['under-bridge lane, west', -35, -57.5, 0],
      // Site A and round it: the square, the stage, the temple hall, the arcades and the main street.
      ['temple square', 2.5, -40, 0], ['opera stage', -2.5, -50, STAGE_Y], ['temple hall', 20, -40, 0],
      ['main street, west', -50, -40, 0], ['row N arcade', -37.5, -45, 0], ['east main street', 40, -40, 0],
      ['passage N1', -30, -50, 0], ['passage N2', 45, -50, 0],
      // The lanes between the main street and the market, and the market hall.
      ['lane M1', -40, -20, 0], ['lane M0, the dog-leg', 5, -20, 0], ['lane M3', 40, -15, 0],
      ['market, north aisle', -20, -2.5, 0], ['market crossing', 0, 0, 0], ['market, south aisle', 20, 2.5, 0],
      ['market street, west', -50, -2.5, 0], ['market street, east', 50, 2.5, 0],
      // Site B: the ironworks yard, the workshop and its roof, the print shop's passage.
      ['ironworks yard', 10, 22.5, 0], ['workshop floor', -5, 20, 0], ['workshop roof', -5, 20, SHED_ROOF + 0.3], ['print shop passage', 25, 22.5, 0],
      ['lane S1', -30, 15, 0], ['lane S2', -10, 15, 0], ['lane S3', 30, 15, 0],
      // The back alleys, the shrine pocket and the roof terrace up its ladder.
      ['alley, west', -45, 30, 0], ['alley, dog-leg', -30, 35, 0], ['alley, middle', -20, 40, 0], ['alley by the yard gate', 15, 30, 0],
      ['alley, east', 45, 40, 0], ['shrine pocket', 0, 45, 0], ['behind the shrine', 10, 45, 0], ['roof terrace', -2.5, 35, TERRACE_Y],
      // The edges: the west street and the levee road.
      ['west street, north', -60, -40, 0], ['west street, south', -55, 25, 0], ['levee road, north', 57.5, -30, 0], ['levee road, south', 67.5, 30, 0],
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

  it('has cover close by: every place a soldier can stand is within 8 m of something chest-high to hide behind', () => {
    const { world } = loadMap('sanchong'); const nav = loadNav('sanchong');
    const bare: string[] = [];
    for (let i = 0; i < nav.x.length; i++) {
      const x = nav.x[i], y = nav.y[i], z = nav.z[i];
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

  for (const [site, name] of [[0, 'the temple square (A)'], [1, 'the ironworks yard (B)']] as const) {
    it(`Sabotage: Militia bots find their way to ${name} and arm it`, () => {
      const events: MatchEvent[] = [];
      const ctx = createContext('sanchong', rng(5), e => events.push(e));
      const state = createMatch('sanchong', { ...SABOTAGE, teamSize: 0, warmup: 0, botSkill: 0.2 });
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
    const { def, world } = loadMap('sanchong'); const nav = loadNav('sanchong');
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
    // One crate per lane near the middle: the main street, the market, the alleys.
    expect(AMMO.map(([, , z]) => (z < -30 ? 'main' : z < 10 ? 'market' : 'alleys'))).toEqual(['main', 'market', 'alleys']);
  });
});
