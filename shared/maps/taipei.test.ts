import { describe, expect, it } from 'vitest';
import { loadMap, loadNav } from './index';
import { findPath, nearestNode, type NavGraph } from '../match/nav';
import { MOVE } from '../movement';
import { longSightlines } from './sightlines';
import { PLAY, RING } from './taipei-compact';

/** The compact Ximending (taipei-compact.ts and its layers), in the source's coordinates. */
const OX = (PLAY.x0 + PLAY.x1) / 2, OZ = (PLAY.z0 + PLAY.z1) / 2;
const at = (x: number, z: number) => ({ x: x - OX, z: z - OZ });
const onRing = (x: number, z: number) => RING.some(([x0, z0, x1, z1]) => x + OX > x0 && x + OX < x1 && z + OZ > z0 && z + OZ < z1);

/** Walking distance along the bots' graph. */
function walk(nav: NavGraph, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  const p = findPath(nav, nearestNode(nav, a.x, a.y, a.z), nearestNode(nav, b.x, b.y, b.z));
  expect(p.length).toBeGreaterThan(1);
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(nav.x[p[i]] - nav.x[p[i - 1]], nav.y[p[i]] - nav.y[p[i - 1]], nav.z[p[i]] - nav.z[p[i - 1]]);
  return d;
}

describe('taipei: the compact Ximending', () => {
  it('plays in the dense core: about 160 × 135 m', () => {
    const { bounds: b } = loadMap('taipei').def;
    expect(b.maxX - b.minX).toBeGreaterThan(130); expect(b.maxX - b.minX).toBeLessThan(170);
    expect(b.maxZ - b.minZ).toBeGreaterThan(125); expect(b.maxZ - b.minZ).toBeLessThan(170);
  });

  it('has no open sightline longer than 60 m between places a soldier can stand (the ring road\'s drive lanes aside)', () => {
    const { world } = loadMap('taipei'); const nav = loadNav('taipei');
    // Every node of the bots' graph (every floor, deck and roof reachable from the bases), eye to eye.
    const lines = longSightlines(world, nav, 60, onRing, 1);
    const show = lines.slice(0, 5).map(l => `${l.length.toFixed(1)} m: ${[l.a[0] + OX, l.a[1], l.a[2] + OZ].map(v => v.toFixed(1))} -> ${[l.b[0] + OX, l.b[1], l.b[2] + OZ].map(v => v.toFixed(1))}`);
    expect(show).toEqual([]);
  });

  it('screens both bases: no line over 60 m reaches into them, not even from the ring road', () => {
    const { world } = loadMap('taipei'); const nav = loadNav('taipei');
    const bases = [[-805.2, -286.5, -765.6, -278.1], [-819.3, -200.7, -806.7, -178.4]];
    const inBase = ([x, , z]: [number, number, number]) => bases.some(([x0, z0, x1, z1]) => x + OX > x0 && x + OX < x1 && z + OZ > z0 && z + OZ < z1);
    const lines = longSightlines(world, nav, 60, undefined, 1).filter(l => inBase(l.a) || inBase(l.b));
    expect(lines.map(l => `${l.length.toFixed(1)} m: ${[l.a[0] + OX, l.a[2] + OZ]} -> ${[l.b[0] + OX, l.b[2] + OZ]}`)).toEqual([]);
  });

  it('puts the bases 90–120 m apart on foot, and SWAT on each site ahead of Militia', () => {
    const { def } = loadMap('taipei'); const nav = loadNav('taipei');
    const slots = (team: number) => def.spawns.filter(s => s.team === team).slice(0, 12);
    const centre = (team: number) => { const s = slots(team); return { x: s.reduce((a, p) => a + p.x, 0) / s.length, y: s[0].y, z: s.reduce((a, p) => a + p.z, 0) / s.length }; };
    const apart = walk(nav, centre(0), centre(1));
    expect(apart).toBeGreaterThan(90); expect(apart).toBeLessThan(120);
    for (const id of def.sabotage!.sites) {
      const site = def.points.find(p => p.id === id)!;
      const first = (team: number) => Math.min(...slots(team).map(s => walk(nav, s, site)));
      // At a sprint, the first defender is on the site a second and a half or more before the first attacker.
      expect(first(1) - first(0), id).toBeGreaterThan(1.5 * MOVE.sprint);
    }
  });

  it('bots reach every deck, upper storey, passage and roof from both bases', () => {
    const { def } = loadMap('taipei'); const nav = loadNav('taipei');
    const spots: [string, number, number, number][] = [
      ['scaffold upper deck', -808.5, -262.5, 6.95], ['site office porch', -756, -275, 2.75], ['temple stage', -756, -205, 1.25],
      ['cinema balcony', -843.5, -247.5, 2.9], ['tea house upstairs', -823.5, -225, 4.2], ['karaoke upstairs', -768.5, -240, 4.2],
      ['arcade canopy', -753.5, -230, 3.0], ['7-TWELVE roof (helipad)', -776, -217.5, 13.9], ['skybridge', -768.5, -207.5, 13.9],
      ['7-TWELVE roof across Emei St', -771, -190, 13.9], ['figure shop roof', -826, -270, 17.9],
      ['Ximen Mall', -786, -267.5, 0], ['cinema corridor', -836, -232.5, 0], ['drugstore', -798.5, -195, 0],
      ['sneaker hall', -783.5, -192.5, 0], ['sneaker outlet', -828.5, -190, 0], ['board-game café', -726, -225, 0],
    ];
    for (const team of [0, 1]) {
      const sp = def.spawns.find(s => s.team === team)!;
      const start = nearestNode(nav, sp.x, sp.y, sp.z);
      for (const [name, sx, sz, y] of spots) {
        const { x, z } = at(sx, sz), n = nearestNode(nav, x, y, z);
        expect(Math.abs(nav.y[n] - y), name).toBeLessThan(0.3);
        expect(Math.hypot(nav.x[n] - x, nav.z[n] - z), name).toBeLessThan(1.5);
        expect(findPath(nav, start, n).length, `${team}->${name}`).toBeGreaterThan(3);
      }
    }
  });
});
