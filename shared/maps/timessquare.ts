import { defaultLaws } from '../laws';
import { cloneData, rng } from '../math';
import { MapBuilder } from './builder';
import { carve, cityBoxes, placeCity, vehicle, type CityBox } from './city';
import { timesSquare as data } from './data/times-square';
import type { MapDef } from './types';

/**
 * Times Square: the real Broadway "bowtie" in Midtown Manhattan, between 44th and 46th Streets.
 * Every building footprint and height comes from OpenStreetMap (tools/fetch-osm.ts); the street
 * grid is turned so 7th Avenue runs along X, uptown at +X. Broadway crosses 7th Avenue at 45th
 * Street (B). A is the plaza on Broadway south of the crossing, C the plaza toward Duffy Square.
 * Two ground-floor arcades (cut through the real blocks) give each side a flanking lane, and the
 * cross-street stubs are barricaded at the edge of the battlefield. Team 0 deploys at the 44th
 * Street end, team 1 at the 46th Street end. The layout is close to, but not exactly, symmetric.
 */

const HALF_X = 108, HALF_Z = 46;
/** Ground-floor arcades: [minX, maxX, minZ, maxZ]. Their roofs are the buildings above. */
const ARCADES: [number, number, number, number][] = [
  [-74, -10, -38, -32], [8, 62, -38, -32],
  [-70, -8, 32, 38], [8, 74, 32, 38],
];
const ARCADE_CEILING = 5;

export function timesSquareMap(): MapDef {
  const b = new MapBuilder({
    id: 'times', name: 'Times Square', region: 'NEW YORK CITY / MIDTOWN MANHATTAN',
    description: 'Real Midtown blocks from OpenStreetMap: the Broadway bowtie, arcades and side streets.',
    theme: 'city', halfX: HALF_X, halfZ: HALF_Z, seed: 5, roll: 0, ridge: 0, asymmetric: true,
    attribution: 'Building data © OpenStreetMap contributors (ODbL)',
    laws: cloneData(defaultLaws), sun: { x: 0.35, y: 0.82, z: 0.3 },
    ground: () => 0,
  });
  b.buildTerrain(2);

  let boxes: CityBox[] = cityBoxes(data);
  for (const [minX, maxX, minZ, maxZ] of ARCADES) boxes = carve(boxes, { minX, maxX, minZ, maxZ }, ARCADE_CEILING);
  placeCity(b, data, boxes);
  billboards(b, boxes);

  // ---- B: the crossing of Broadway, 7th Avenue and 45th Street ----
  b.box(0, 0, 0, 7, 0.3, 7, 'concrete');                          // traffic island
  b.box(0, 0.3, 0, 2.4, 2.2, 2.4, 'pillar');
  b.raw({ kind: 'reactor', x: 0, y: 0.3, z: 0 });
  b.point('B', '45th & Broadway', 0, 0.3, 0, 9);

  b.mirrored(() => {
    // Crossing: wrecks and barriers around the island.
    vehicle(b, 'taxi', -9, -8, false, 0.06, 1);
    vehicle(b, 'taxi', 7, 9, true, -0.05, 2);
    b.box(-10, 0, 6, 0.8, 1.1, 4, 'concrete');
    b.box(-3, 0, -12, 4, 1.1, 0.8, 'concrete');
    // 45th Street stubs, barricaded where the battlefield ends.
    for (const z of [-44, 44]) b.box(-1, 0, z, 16, 1.2, 0.8, 'concrete');
    vehicle(b, 'van', -4, -40, true, 0.04, 3);

    // ---- A: Broadway plaza between 44th and 45th ----
    b.point(b.mirroredSide ? 'C' : 'A', b.mirroredSide ? 'Duffy Square' : 'Broadway Plaza', -50, 0, 6, 8.5);
    // Pop-up red bleachers, a nod to the TKTS steps up at Duffy Square.
    b.ramp(-50, 15, 10, 6, 0, 2.4, 1, 'stairs');
    b.box(-50, 0, 20, 10, 2.4, 4, 'concrete');
    b.rail(-55, 22, -45, 22, 2.4);
    b.box(-62, 0, 2, 0.8, 1.1, 4.5, 'concrete');
    b.box(-40, 0, 0, 3.6, 1.1, 0.8, 'concrete');
    vehicle(b, 'bus', -48, -6, false, 0.03, 4);
    vehicle(b, 'car', -36, 10, true, -0.07, 5);
    b.solidProp('Prop_Crate_Large', -58, 0, 12, 0.2, 1.9, 1.3, 1.9);

    // ---- Main avenue between A and B ----
    vehicle(b, 'taxi', -26, 3, false, -0.04, 6);
    vehicle(b, 'car', -22, -9, false, 0.05, 7);
    b.box(-30, 0, 14, 0.8, 1.1, 4, 'concrete');
    vehicle(b, 'taxi', -72, -6, true, 0.05, 8);
    vehicle(b, 'van', -78, 10, false, -0.03, 9);
    b.box(-86, 0, -2, 4, 1.1, 0.8, 'concrete');

    // Sidewalk shed along the north frontage: a walkable deck over the pavement.
    b.platform(-54, -14.2, 28, 3, 3.6);
    b.ramp(-37.5, -14.2, 5, 3, 0, 3.6, 2, 'stairs');
    b.rail(-68, -12.7, -40, -12.7, 3.6);

    // 44th Street: barricades closing the stubs, cover at the corners.
    for (const z of [-45, 45]) { b.box(-82, 0, z, 18, 1.2, 0.8, 'concrete'); vehicle(b, 'bus', -82, z - 3 * Math.sign(z), false, 0.02, 10); }
    vehicle(b, 'car', -84, -26, true, 0.06, 11);
    vehicle(b, 'taxi', -76, 24, true, -0.05, 12);

    // Arcades: pillars and kiosks break the sightlines; warm lamps light the passages.
    for (const [minX, maxX, minZ, maxZ] of ARCADES.filter(a => a[0] < 0)) {
      const z = (minZ + maxZ) / 2;
      for (let x = minX + 6; x < maxX - 3; x += 9) b.box(x, 0, z, 1.2, ARCADE_CEILING, 1.2, 'pillar');
      for (let x = minX + 10; x < maxX - 6; x += 18) b.light(x, ARCADE_CEILING - 0.2, z, 0xffc27a, 5, 10);
      b.box(minX + 10.5, 0, z + (z < 0 ? 1.6 : -1.6), 3, 1.1, 1.4, 'concrete');
    }
  });

  // ---- Street lamps and signal masts along the avenue ----
  const r = rng(45);
  for (let x = -100; x <= 100; x += 25) for (const z of [-14, 14]) {
    if (Math.abs(x) < 6) continue;
    const lx = x + (r() - 0.5) * 4;
    b.box(lx, 0, z + Math.sign(z) * 0.9, 0.25, 7.6, 0.25, 'pillar');
    b.light(lx, 7.5, z, 0xfff1d0, 5, 16);
  }

  // ---- Spawns: shielded ends of the avenue ----
  b.box(-97, 0, 7, 0.3, 7, 46, 'shield', 'energy', 0);
  for (const z of [-13, -2, 6, 14, 22]) b.spawn(0, -103, 0, z, -Math.PI / 2);
  b.raw({ kind: 'spawnPad', team: 0, x: -102, y: 0, z: 7, rotY: -Math.PI / 2 });
  b.light(-104, 6, 7, 0x58b6ff, 8, 20);
  b.box(97, 0, -15, 0.3, 7, 62, 'shield', 'energy', 1);
  for (const z of [-30, -20, -10, 0, 8]) b.spawn(1, 103, 0, z, Math.PI / 2);
  b.raw({ kind: 'spawnPad', team: 1, x: 102, y: 0, z: -12, rotY: Math.PI / 2 });
  b.light(104, 6, -12, 0xff5a4a, 8, 20);
  // Beyond the battlefield the avenue is jammed with buses.
  for (const s of [-1, 1]) for (let z = -40; z <= 30; z += 12.5) vehicle(b, 'bus', s * 113, z, true, 0.03 * s, 20 + z);

  return b.build();
}

/**
 * Times Square's glow: screens on the building faces that look onto the open avenue, sized and
 * placed from a fixed seed.
 */
function billboards(b: MapBuilder, boxes: CityBox[]) {
  const r = rng(1904);
  const solidAt = (x: number, z: number) => boxes.some(o => o.bottom < 3 && x > o.minX && x < o.maxX && z > o.minZ && z < o.maxZ);
  for (const o of boxes) {
    if (o.top < 14 || o.bottom > 0) continue;
    const faces = [
      { nx: 0, nz: 1, x0: o.minX, x1: o.maxX, z: o.maxZ }, { nx: 0, nz: -1, x0: o.minX, x1: o.maxX, z: o.minZ },
      { nx: 1, nz: 0, x0: o.minZ, x1: o.maxZ, z: o.maxX }, { nx: -1, nz: 0, x0: o.minZ, x1: o.maxZ, z: o.minX },
    ];
    for (const f of faces) {
      const len = f.x1 - f.x0;
      if (len < 8) continue;
      const mid = (f.x0 + f.x1) / 2;
      const px = f.nx ? f.z + f.nx * 3 : mid, pz = f.nx ? mid : f.z + f.nz * 3;
      // Only faces onto the avenue and its plazas, never into side streets out of bounds.
      if (Math.abs(px) > 120 || Math.abs(pz) > 30 || solidAt(px, pz)) continue;
      const count = Math.min(3, Math.floor(len / 12) + 1);
      for (let k = 0; k < count; k++) {
        const w = Math.min(len / count - 1.5, 6 + r() * 10), h = 4 + r() * 9;
        const along = f.x0 + (k + 0.5) * len / count, y = 6 + r() * Math.max(1, Math.min(o.top - h - 6, 22));
        const x = f.nx ? f.z + f.nx * 0.12 : along, z = f.nx ? along : f.z + f.nz * 0.12;
        b.raw({ kind: 'billboard', x, y, z, w, h, rotY: Math.atan2(f.nx, f.nz), seed: Math.floor(r() * 1e6) });
      }
    }
  }
}
