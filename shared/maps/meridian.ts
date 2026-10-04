import { defaultLaws } from '../laws';
import { cloneData } from '../math';
import { MapBuilder, fbm } from './builder';
import type { BlockStyle, MapDef } from './types';

/**
 * Meridian District: a dense sci-fi city quarter built for 50v50. A street grid between two
 * warpgates (team 0 west, team 1 east): a boulevard in front of each gate, avenues along the
 * north and south edges, a centre street that runs into the reactor plaza (B), and a transit
 * plaza on each side (A west, C east). Every metre that is not street, plaza or lot is a city
 * block whose tower heights break up the long sightlines. Enterable two-level buildings with
 * roof access sit in open lots along the main routes.
 *
 * The west half is authored once and placed through the builder's 180° mirror, so both teams
 * get the same city. Coordinates: +X east, +Z south, metres.
 */

const HALF_X = 150, HALF_Z = 100;

interface Area { x0: number; x1: number; z0: number; z1: number }
const area = (x0: number, x1: number, z0: number, z1: number): Area => ({ x0, x1, z0, z1 });

// Walkable ground of the west half (x ≤ 0). Everything else becomes building mass. Rows that
// reach x = 0 are mirrored in z so the streets continue across the centre line.
const AREAS: Area[] = [
  area(-148, -124, -18, 18),     // warpgate courtyard
  area(-124, -112, -96, 96),     // spawn boulevard
  area(-80, -72, -96, 96),       // second street
  area(-44, -40, -96, 96),       // alley along the reactor blocks
  area(-112, 0, -74, -64),       // north avenue
  area(-112, 0, 64, 74),         // south avenue
  area(-112, -40, -40, -34),     // north cross street
  area(-112, -40, 34, 40),       // south cross street
  area(-112, 0, -4, 4),          // centre street into the reactor plaza
  area(-96, -60, -48, -14),      // A: transit plaza
  area(-112, -100, -30, -8),     // forward post behind A
  area(-24, 0, -24, 24),         // B: reactor plaza (west half)
  area(-40, -24, -12, 12),       // B west court
  area(-72, -46, 4, 30),         // lot: market hall (opens onto the second and centre streets)
  area(-40, -6, -64, -42),       // lot: archive
  area(-112, -84, 40, 64),       // lot: depot
];

const open = (x: number, z: number) => AREAS.some(a => x > a.x0 && x < a.x1 && z > a.z0 && z < a.z1);

const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
function hash(i: number, j: number) {
  let h = Math.imul(i + 101, 374761393) ^ Math.imul(j + 211, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function meridianDistrict(): MapDef {
  const b = new MapBuilder({
    id: 'meridian', name: 'Meridian District', region: 'INDAR-CLASS DESERT / CITY QUARTER',
    description: '50v50 city fight: street grid, transit plazas, reactor square. Forward spawns on held points.',
    theme: 'desert', halfX: HALF_X, halfZ: HALF_Z, seed: 41, roll: 0, ridge: 0,
    laws: cloneData(defaultLaws), sun: { x: -0.5, y: 0.66, z: 0.42 },
    // Flat streets; beyond the city limits the land climbs into broken mesas.
    ground: (x, z) => {
      const rise = smooth((Math.max(Math.abs(x) / HALF_X, Math.abs(z) / HALF_Z) - 1) / 0.14);
      return rise * (30 + (fbm(x * 0.03, z * 0.03, 41) + fbm(-x * 0.03, -z * 0.03, 41)) * 14);
    },
    teamSize: 50,
  });
  b.buildTerrain(2);

  b.mirrored(() => blockOut(b));

  // ---- B: the reactor plaza (self-symmetric pieces sit outside the mirror) ----
  b.box(0, 0, 0, 18, 1.0, 18, 'concrete');
  b.ramp(0, -10.5, 6, 3, 0, 1, 1, 'stairs');
  b.ramp(0, 10.5, 6, 3, 0, 1, 3, 'stairs');
  b.ramp(-10.5, 0, 3, 6, 0, 1, 0, 'stairs');
  b.ramp(10.5, 0, 3, 6, 0, 1, 2, 'stairs');
  b.box(0, 1, 0, 2.6, 2.4, 2.6, 'pillar');
  b.raw({ kind: 'reactor', x: 0, y: 1, z: 0 });
  b.point('B', 'Reactor Square', 0, 1, 0, 12);
  b.mirrored(() => {
    // Deck corners: low walls to fight from (well below the sentinel orbits).
    b.box(-6.2, 1, -4.2, 0.6, 1.15, 3.6, 'wallDark');
    b.box(-4.2, 1, -6.2, 3.6, 1.15, 0.6, 'wallDark');
    b.box(6.2, 1, -4.2, 0.6, 1.15, 3.6, 'wallDark');
    b.box(4.2, 1, -6.2, 3.6, 1.15, 0.6, 'wallDark');
    b.light(-6.5, 2.2, -6.5, 0x7ff6ff, 5, 12);
    b.light(6.5, 2.2, -6.5, 0x7ff6ff, 5, 12);
    // Plaza edge: container stacks in the corners, barriers and crates around the deck.
    b.box(-19, 0, -20, 6.2, 2.6, 2.5, 'container');
    b.box(-19, 2.6, -20, 6.2, 2.6, 2.5, 'container');
    b.box(19.5, 0, -16, 2.5, 2.6, 6.2, 'container');
    b.box(-16, 0, 14, 4.2, 1.2, 0.9, 'concrete');
    b.box(-14, 0, -14, 0.9, 1.2, 4.2, 'concrete');
    b.box(8, 0, -17, 4.2, 1.2, 0.9, 'concrete');
    b.solidProp('Prop_Crate_Large', -15, 0, 4, 0.3, 1.9, 1.3, 1.9);
    b.solidProp('Prop_Crate_Tarp', -13, 0, -6.5, 1.2, 1.4, 1.05, 1.4);
    b.solidProp('Prop_Crate', 4, 0, -20.5, 0.4, 1.2, 1.0, 1.2);
    // West court: barriers screening the forward spawn from the square.
    b.box(-26, 0, -9, 0.9, 1.3, 6, 'concrete');
    b.box(-26, 0, 9, 0.9, 1.3, 6, 'concrete');
    b.solidProp('Prop_Crate_Large', -33, 0, -6.5, 0, 1.9, 1.3, 1.9);
  });

  b.mirrored(() => {
    // ---- Warpgate: walled courtyard behind a one-way team shield ----
    b.box(-124.15, 0, 0, 0.3, 8, 36, 'shield', 'energy', b.team(0));
    for (const x of [-144, -138, -132]) for (const z of [-14, -7, 0, 7, 14]) b.spawn(0, x, 0, z, -Math.PI / 2);
    b.raw({ kind: 'spawnPad', team: b.team(0), ...b.at(-136, 0), y: 0, rotY: b.rotation(-Math.PI / 2) });
    b.light(-140, 7, 0, b.mirroredSide ? 0xff5a4a : 0x58b6ff, 8, 24);
    b.box(-128, 0, -11, 0.9, 1.3, 4.4, 'concrete');
    b.box(-128, 0, 11, 0.9, 1.3, 4.4, 'concrete');

    // ---- A: transit plaza with a raised platform over the point ----
    b.platform(-78, -31, 10, 6, 4.2);
    b.ramp(-78, -37, 2.6, 6, 0, 4.2, 1, 'stairs');
    b.box(-78, 4.2, -27.9, 10, 1.0, 0.4, 'wallDark');
    b.box(-82.8, 4.2, -31, 0.4, 1.0, 5.6, 'wallDark');
    b.light(-78, 3.6, -31, 0xfff1d0, 5, 14);
    b.box(-90, 0, -42, 2.5, 2.6, 6.2, 'container');
    b.box(-90, 2.6, -42, 2.5, 2.6, 6.2, 'container');
    b.box(-66, 0, -20, 6.2, 2.6, 2.5, 'container');
    b.box(-88, 0, -20, 4.2, 1.2, 0.9, 'concrete');
    b.box(-68, 0, -42, 0.9, 1.2, 4.2, 'concrete');
    b.box(-63, 0, -32, 0.9, 1.2, 4.2, 'concrete');
    b.solidProp('Prop_Crate_Large', -84, 0, -26, 0.2, 1.9, 1.3, 1.9);
    b.solidProp('Prop_Crate_Tarp_Large', -71, 0, -36, 0.5, 2.2, 1.6, 2.2);
    b.solidProp('Prop_Crate', -92, 0, -30, 0.1, 1.2, 1.0, 1.2);
    b.solidProp('Prop_Barrel2_Closed', -61.5, 0, -46, 0, 0.9, 1.2, 0.9);
    // Forward post behind A.
    b.box(-104, 0, -6.5, 4, 1.2, 0.9, 'concrete');

    // ---- Lot: market hall (enterable, roof reached by stairs on its west side) ----
    const m = b.bunker(-58, 19, 18, 14, {
      y: 0, h: 4.4,
      doors: [['n', 0, 2.6], ['s', -4, 2.6], ['e', 2, 2.4]],
      windows: [['n', -5.5, 2.2], ['n', 5.5, 2.2], ['s', 4, 2.2], ['e', -3.5, 2], ['w', 3, 2]],
    });
    b.ramp(-68.2, 19, 2.4, 10, 0, m.top, 3, 'stairs');
    b.box(-58, m.top, 25.9, 8, 1.0, 0.4, 'wallDark');
    b.solidProp('Prop_Crate_Large', -61, 0, 16, 0.4, 1.9, 1.3, 1.9);
    b.solidProp('Prop_Chest', -53, 0, 22, Math.PI / 2, 1.5, 0.75, 0.8);
    b.light(-58, 3.8, 19, 0xffd9a0, 5, 12);
    b.solidProp('Prop_Crate', -48, 0, 10, 0.3, 1.2, 1.0, 1.2);

    // ---- Lot: archive on the north avenue (stairs on its east side) ----
    const a = b.bunker(-22, -52, 22, 14, {
      y: 0, h: 4.4,
      doors: [['n', -5, 2.6], ['w', 0, 2.4], ['s', 6, 2.6]],
      windows: [['n', 1, 2.2], ['n', 7, 2.2], ['s', -6, 2.2], ['s', 0, 2.2], ['w', -4, 1.8]],
    });
    b.ramp(-9.7, -52, 2.4, 10, 0, a.top, 1, 'stairs');
    b.box(-22, a.top, -58.9, 10, 1.0, 0.4, 'wallDark');
    b.prop('Kit_Prop_Computer', -30, 0, -55.5, Math.PI / 2);
    b.solidProp('Prop_Crate_Tarp', -16, 0, -48, 0.6, 1.4, 1.05, 1.4);
    b.light(-22, 3.8, -52, 0xfff1d0, 5, 12);
    b.solidProp('Prop_Crate_Large', -36, 0, -44, 0.2, 1.9, 1.3, 1.9);

    // ---- Lot: depot by the spawn boulevard (stairs on its east side) ----
    const d = b.bunker(-97, 53, 18, 12, {
      y: 0, h: 4.4,
      doors: [['w', 0, 2.6], ['n', 4, 2.6], ['s', -3, 2.4]],
      windows: [['n', -4, 2.2], ['s', 4, 2.2], ['e', -2, 2], ['w', -3.5, 1.8]],
    });
    b.ramp(-86.8, 53, 2.4, 10, 0, d.top, 1, 'stairs');
    b.box(-90, 0, 44, 6.2, 2.6, 2.5, 'container');
    b.solidProp('Prop_Barrel1', -105, 0, 44, 0, 0.7, 1.1, 0.7);
    b.light(-97, 3.8, 53, 0xffd9a0, 5, 12);

    // ---- Street cover: staggered container stacks and barriers break the long sightlines ----
    const stack = (x: number, z: number, alongX: boolean, high = true) => {
      const [w, dd] = alongX ? [6.2, 2.5] : [2.5, 6.2];
      b.box(x, 0, z, w, 2.6, dd, 'container');
      if (high) b.box(x, 2.6, z, w, 2.6, dd, 'container');
    };
    stack(-92, -2.75, true); stack(-56, 2.75, true); stack(-34, 2.75, true, false);
    stack(-96, -71.25, true); stack(-60, -66.75, true); stack(-24, -71.25, true, false);
    stack(-90, 66.75, true); stack(-52, 71.25, true); stack(-14, 66.75, true, false);
    stack(-121.25, -80, false); stack(-114.75, -50, false, false); stack(-121.25, 48, false, false); stack(-114.75, 82, false);
    stack(-78.75, -86, false); stack(-73.25, 18, false, false); stack(-78.75, 56, false);
    b.box(-118, 0, 26, 4.2, 1.2, 0.9, 'concrete');
    b.box(-118, 0, -26, 4.2, 1.2, 0.9, 'concrete');
    b.box(-60, 0, -37, 0.9, 1.2, 4.2, 'concrete');
    b.box(-96, 0, 37, 0.9, 1.2, 4.2, 'concrete');
    b.solidProp('Prop_Crate', -42, 0, -80, 0.2, 1.2, 1.0, 1.2);
    b.solidProp('Prop_Crate_Large', -42, 0, 50, 0.6, 1.9, 1.3, 1.9);
    b.solidProp('Prop_Barrel2_Closed', -74, 0, -8, 0, 0.9, 1.2, 0.9);
  });

  // ---- Capture points and forward spawns (explicit per team so A ↔ C keep their ids) ----
  b.point('A', 'Transit Plaza', -78, 0, -31, 11);
  b.point('C', 'Freight Plaza', 78, 0, 31, 11);
  const forward: [number, number, 'A' | 'B'][] = [
    [-109, -27, 'A'], [-103, -27, 'A'], [-109, -21, 'A'], [-103, -21, 'A'],
    [-109, -15, 'A'], [-103, -15, 'A'], [-109, -10, 'A'], [-103, -10, 'A'],
    [-37, -10, 'B'], [-37, -6, 'B'], [-37, 6, 'B'], [-37, 10, 'B'], [-31, -9, 'B'], [-31, 9, 'B'],
  ];
  for (const [x, z, p] of forward) {
    b.spawn(0, x, 0, z, -Math.PI / 2, p);
    b.spawn(1, -x, 0, -z, Math.PI / 2, p === 'A' ? 'C' : 'B');
  }

  return b.build();
}

/** Fills the west half outside the walkable areas with city blocks of varied height. */
function blockOut(b: MapBuilder) {
  const cell = 2, w = HALF_X / cell, d = (HALF_Z * 2) / cell, maxRun = 10;
  const solid = new Uint8Array(w * d);
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    solid[j * w + i] = open(-HALF_X + (i + 0.5) * cell, -HALF_Z + (j + 0.5) * cell) ? 0 : 1;
  }
  // Greedy rectangles, capped at 20 m a side so towers vary in height along each block.
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    if (!solid[j * w + i]) continue;
    let rw = 1;
    while (rw < maxRun && i + rw < w && solid[j * w + i + rw]) rw++;
    let rd = 1;
    grow: while (rd < maxRun && j + rd < d) {
      for (let k = 0; k < rw; k++) if (!solid[(j + rd) * w + i + k]) break grow;
      rd++;
    }
    for (let jj = j; jj < j + rd; jj++) solid.fill(0, jj * w + i, jj * w + i + rw);
    const r = hash(i, j);
    const edge = i === 0 || j === 0 || j + rd === d;
    const top = 9 + Math.floor(r * 8) * 2 + (edge ? 6 : 0);
    // Plastered masonry only on the low blocks; towers get armored panels or concrete.
    const style: BlockStyle = r < 0.35 ? 'wall' : r < 0.55 ? 'wallDark' : r < 0.82 ? (top <= 15 ? 'sandstone' : 'wall') : 'concrete';
    b.box(-HALF_X + (i + rw / 2) * cell, -2, -HALF_Z + (j + rd / 2) * cell, rw * cell, top + 2, rd * cell, style);
  }
}
