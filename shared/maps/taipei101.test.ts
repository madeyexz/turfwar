import { describe, expect, it } from 'vitest';
import { loadMap, loadNav } from './index';
import { findPath, nearestNode, type NavGraph } from '../match/nav';
import { mapsFor } from '../match/rooms';
import { MOVE } from '../movement';
import { clearLine, longSightlines } from './sightlines';
import { CEIL, CORE, DAMPER, F2, FLOOR_Y, H, SHAFT, TAIPEI101_NAME_ZH } from './taipei101';

const ID = 'taipei101';

/** Walking distance along the bots' graph. */
function walk(nav: NavGraph, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  const p = findPath(nav, nearestNode(nav, a.x, a.y, a.z), nearestNode(nav, b.x, b.y, b.z));
  expect(p.length).toBeGreaterThan(1);
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(nav.x[p[i]] - nav.x[p[i - 1]], nav.y[p[i]] - nav.y[p[i - 1]], nav.z[p[i]] - nav.z[p[i - 1]]);
  return d;
}

describe('taipei101: an office floor high up Taipei 101', () => {
  it('is a compact notched floor plate about 50 m across, 380 m up, offered to 1v1 and 6v6 in both modes', () => {
    const { def } = loadMap(ID);
    expect(2 * H).toBeGreaterThanOrEqual(50); expect(2 * H).toBeLessThanOrEqual(60);
    expect(def.bounds.maxX - def.bounds.minX).toBeLessThan(60);
    expect(FLOOR_Y).toBeGreaterThan(370); expect(FLOOR_Y).toBeLessThan(395);
    expect(def.big).toBeFalsy();
    expect(def.vehicles ?? []).toEqual([]);
    expect(def.name).toBe('Taipei 101 · 88F');
    expect(def.region).toContain(TAIPEI101_NAME_ZH);
    for (const size of [1, 6]) for (const mode of ['elimination', 'sabotage'] as const) expect(mapsFor(size, mode)).toContain(ID);
    expect(mapsFor(24)).not.toContain(ID);
  });

  it('has no open sightline longer than 45 m between places a soldier can stand, on either floor', () => {
    const { world } = loadMap(ID); const nav = loadNav(ID);
    const lines = longSightlines(world, nav, 45, undefined, 1);
    expect(lines.slice(0, 5).map(l => `${l.length.toFixed(1)} m: ${l.a.map(v => v.toFixed(1))} -> ${l.b.map(v => v.toFixed(1))}`)).toEqual([]);
  });

  it('puts the bases 30–50 m apart on foot, and SWAT on each site 1.5–2 s ahead of Militia', () => {
    const { def } = loadMap(ID); const nav = loadNav(ID);
    const slots = (team: number) => def.spawns.filter(s => s.team === team).slice(0, 12);
    const centre = (team: number) => { const s = slots(team); return { x: s.reduce((a, p) => a + p.x, 0) / s.length, y: s[0].y, z: s.reduce((a, p) => a + p.z, 0) / s.length }; };
    const apart = walk(nav, centre(0), centre(1));
    expect(apart).toBeGreaterThan(30); expect(apart).toBeLessThan(50);
    expect(def.sabotage).toEqual({ sites: ['A', 'B'], attackerSpawn: 1 });
    for (const id of def.sabotage!.sites) {
      const site = def.points.find(p => p.id === id)!;
      const first = (team: number) => Math.min(...slots(team).map(s => walk(nav, s, site)));
      const lead = (first(1) - first(0)) / MOVE.sprint;
      expect(lead, id).toBeGreaterThan(1.5);
      expect(lead, id).toBeLessThan(2.05);
    }
  });

  it('puts the bomb sites in different rooms: A in the server room (west), B in the boardroom (east)', () => {
    const { def } = loadMap(ID);
    const a = def.points.find(p => p.id === 'A')!, b = def.points.find(p => p.id === 'B')!;
    expect(a.x).toBeLessThan(-CORE.x); expect(b.x).toBeGreaterThan(CORE.x);
    for (const p of [a, b]) { expect(p.z).toBeGreaterThan(-CORE.z); expect(p.z).toBeLessThan(0); expect(p.y).toBe(0); }
  });

  it('bots reach every room, both floors of the core and both stairs from both bases', () => {
    const { def } = loadMap(ID); const nav = loadNav(ID);
    const spots: [string, number, number, number][] = [
      ['Sky Lobby', 0, -15, 0], ["Chairman's office", -22.5, -15, 0], ["CEO's office", 22.5, -15, 0],
      ["Chairman's anteroom", -15, -20, 0], ["CEO's anteroom", 15, -20, 0],
      ['server room', -17.5, -5, 0], ['boardroom', 17.5, -2.5, 0], ['pantry', -15, 5, 0], ['copy room', 15, 7.5, 0],
      ['open office SW', -17.5, 17.5, 0], ['open office SE', 20, 17.5, 0], ['meeting room A', 15, 20, 0], ['meeting room B', 20, 20, 0],
      ['renovation floor', 0, 20, 0], ['damper hall', 5, 0, 0], ['under the gallery', -10, 7.5, 0],
      ['west stair', -10, 0, 1.8], ['east stair', 10, 0, 1.8],
      ['gallery north', 0, -7.5, F2], ['gallery south', 0, 7.5, F2], ['gallery west', -7.5, 0, F2], ['gallery east', 7.5, 0, F2],
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

  it('deploys each team on clear floor in its own base: SWAT in the Sky Lobby, Militia on the renovation floor', () => {
    const { def, world } = loadMap(ID);
    for (const team of [0, 1] as const) {
      const own = def.spawns.filter(s => s.team === team);
      expect(own.length).toBe(12);
      for (const s of own) {
        expect(world.overlapsSolid({ x: s.x, y: s.y, z: s.z }, 0.4, 1.8), `${s.x},${s.z}`).toBe(false);
        expect(world.groundHeight(s.x, s.z, s.y + 0.1, 0.35)).toBeCloseTo(s.y, 3);
        expect(world.ceilingHeight(s.x, s.z, s.y, 0.4)).toBeGreaterThan(s.y + 2);
        expect(Math.abs(s.x)).toBeLessThan(CORE.x);
        if (team === 0) expect(s.z).toBeLessThan(-CORE.z); else expect(s.z).toBeGreaterThan(CORE.z);
      }
    }
    // Every ammo crate stands on a floor, clear of furniture.
    for (const p of def.pickups ?? []) {
      expect(world.groundHeight(p.x, p.z, p.y + 0.1, 0.3), `${p.x},${p.z}`).toBeCloseTo(p.y, 3);
      expect(world.overlapsSolid({ x: p.x, y: p.y + 0.05, z: p.z }, 0.45, 1.2), `${p.x},${p.z}`).toBe(false);
    }
    expect(def.pickups!.filter(p => p.y > F2 - 0.1).length).toBeGreaterThan(0);
  });

  it('hangs the tuned mass damper in a shaft through both floors, overlooked from the gallery', () => {
    const { def, world } = loadMap(ID); const nav = loadNav(ID);
    // The sphere: 41 gold plates stacked on the shaft's axis, widest at its waist.
    const plates = def.decor.flatMap(d => d.kind === 'cylinder' && d.style === 'gold' ? [d] : []);
    expect(plates.length).toBe(41);
    for (const p of plates) { expect(p.x).toBe(0); expect(p.z).toBe(0); }
    expect(Math.max(...plates.map(p => p.radius))).toBeCloseTo(DAMPER.r, 1);
    expect(Math.min(...plates.map(p => p.y))).toBeCloseTo(DAMPER.y - DAMPER.r, 3);
    // Its sphere spans 88F's ceiling and 89F's floor.
    expect(DAMPER.y - DAMPER.r).toBeLessThan(CEIL); expect(DAMPER.y + DAMPER.r).toBeGreaterThan(F2 + 1.5);
    // The shaft is open: nothing solid between 88F's ceiling and 89F's floor round the sphere.
    for (const [x, z] of [[4.5, 0], [-4.5, 0], [0, 4.5], [0, -4.5]]) expect(world.overlapsSolid({ x, y: CEIL - 0.6, z }, 0.3, 1.2)).toBe(false);
    // Vertical play: from somewhere on the gallery a soldier sees someone on the hall floor under the shaft.
    const eye = 1.55, hall: number[] = [], up: number[] = [];
    for (let i = 0; i < nav.x.length; i++) {
      if (Math.abs(nav.y[i]) < 0.1 && Math.abs(nav.x[i]) < SHAFT && Math.abs(nav.z[i]) < SHAFT) hall.push(i);
      if (Math.abs(nav.y[i] - F2) < 0.1) up.push(i);
    }
    expect(hall.length).toBeGreaterThan(4); expect(up.length).toBeGreaterThan(8);
    // The gallery's glass balustrades stand higher than a soldier can jump, so nobody perches on them.
    const jump = MOVE.jumpSpeed ** 2 / (2 * MOVE.gravity);
    const rails = def.solids.filter(s => s.surface === 'glass' && Math.abs(s.minY - F2) < 0.01);
    expect(rails.length).toBeGreaterThanOrEqual(6);
    for (const s of rails) expect(s.maxY - s.minY).toBeGreaterThan(jump);
    const seen = up.some(a => hall.some(c => clearLine(world, nav.x[a], nav.y[a] + eye, nav.z[a], nav.x[c], nav.y[c] + 1.2, nav.z[c])));
    expect(seen).toBe(true);
  });
});
