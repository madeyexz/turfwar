import { MapBuilder, fbm } from './builder';
import type { BlockStyle, MapDef, PointId } from './types';

/**
 * Meridian District: a 50v50 Conquest battlefield in a war-torn desert city. Five points run
 * west to east, A–E, between two warpgates (team 0 west, team 1 east):
 *
 *   A Park        — wooded hills around a pavilion on the flag hill
 *   B Site        — a construction pit under an open steel frame and a tower crane
 *   C Meridian    — the central square, decked over the drained canal in the downtown core
 *   D, E          — B and A rotated 180° onto the far bank
 *
 * A dry canal splits the city north to south: the square's deck and two road bridges cross it,
 * and stairs lead down to the canal bed, which runs under all of them. Elevated highways along
 * the north and south edges give Recon a long lane, with ramps at both ends and stairs midway.
 * A ruined block breaks the centre street between A and B, and twin towers mark the core.
 * The land falls gently from the warpgates toward the canal. Every metre that is not street,
 * plaza or sector is city block, taller toward the core, so sightlines stay short.
 *
 * The west half is authored once and placed through the builder's 180° mirror, so both teams
 * get the same city. Coordinates: +X east, +Z south, metres.
 */

const HALF_X = 200, HALF_Z = 140;
/** Canal bed depth and the inner face of its retaining walls (|x|). */
const CANAL_Y = -4, CANAL_X = 8;
/** Elevated highway deck height and centre line (north side of the west half). */
const HWY_Y = 9, HWY_Z = -96;

interface Area { x0: number; x1: number; z0: number; z1: number }
const area = (x0: number, x1: number, z0: number, z1: number): Area => ({ x0, x1, z0, z1 });

// Walkable ground of the west half (x ≤ -10; the canal is handled separately). Everything else
// becomes city block. Rows that meet the canal are mirrored in z so they continue on the far bank.
const AREAS: Area[] = [
  area(-196, -172, -20, 20),     // warpgate courtyard
  area(-172, -160, -130, 130),   // base boulevard
  area(-160, -10, -104, -88),    // under the north highway
  area(-160, -10, 88, 104),      // under the south highway
  area(-160, -10, -78, -66),     // north avenue → north bridge
  area(-160, -10, 66, 78),       // south avenue → south bridge
  area(-160, -104, -6, 6),       // centre street, base → ruins
  area(-80, -34, -6, 6),         // centre street, ruins → central square
  area(-128, -120, -130, 130),   // west cross street
  area(-104, -98, -104, -34),    // alley, north highway → ruins
  area(-96, -90, 20, 104),       // alley, ruins → south highway
  area(-70, -62, -130, -66),     // street, north edge → north avenue
  area(-70, -62, 6, 130),        // street, centre → south edge
  area(-42, -34, -78, 78),       // downtown avenue beside the central square
  area(-150, -100, 16, 66),      // A: park
  area(-160, -150, 30, 42),      // park gate from the boulevard
  area(-104, -80, -34, 20),      // ruined block
  area(-90, -42, -66, -16),      // B: construction site
  area(-34, -10, -30, 30),       // C: central square (west bank)
  area(-66, -38, 10, 34),        // lot: hotel
  area(-160, -128, -56, -28),    // lot: offices
];

/** Footprints kept for the landmark towers (placed explicitly, not by the block fill). */
const TOWER = area(-58, -44, 40, 54);

const inArea = (a: Area, x: number, z: number) => x > a.x0 && x < a.x1 && z > a.z0 && z < a.z1;
const open = (x: number, z: number) => x > -10 || inArea(TOWER, x, z) || AREAS.some(a => inArea(a, x, z));

const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
function hash(i: number, j: number) {
  let h = Math.imul(i + 101, 374761393) ^ Math.imul(j + 211, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** City ground: falls from the warpgates toward the canal, which is cut 4 m deep. */
function ground(x: number, z: number) {
  const ax = Math.abs(x);
  const base = 4.5 * smooth((ax - 20) / 140);
  const cut = smooth((CANAL_X + 2 - ax) / 2);
  const inner = base * (1 - cut) + CANAL_Y * cut;
  // Beyond the city limits the land climbs into broken mesas.
  const rise = smooth((Math.max(ax / HALF_X, Math.abs(z) / HALF_Z) - 1) / 0.12);
  return inner * (1 - rise) + rise * (32 + (fbm(x * 0.03, z * 0.03, 41) + fbm(-x * 0.03, -z * 0.03, 41)) * 14);
}


export function meridianDistrict(): MapDef {
  const b = new MapBuilder({
    id: 'meridian', name: 'Meridian District', region: 'INDAR-CLASS DESERT / CITY QUARTER',
    description: 'A war-torn city for Mega servers: park, construction site, canal bridges, highways and a central square.',
    theme: 'desert', halfX: HALF_X, halfZ: HALF_Z, seed: 41, roll: 0, ridge: 0,
    sabotage: { sites: ['A', 'B'], attackerSpawn: 1 },
    big: true,
    sun: { x: -0.5, y: 0.66, z: 0.42 },
    ground,
  });

  // ---- Terrain shaping (before the heightfield is sampled) ----
  b.mirrored(() => {
    b.bump(-128, 40, 18, 3.2);       // A: the flag hill
    b.bump(-142, 60, 9, 2.6);
    b.bump(-110, 58, 10, 3.6);
    b.bump(-108, 22, 8, 2.2);
    b.bump(-146, 22, 7, 1.8);
    b.pad(-64, -38, 24, 18, -2.5, 6);  // B: the excavation pit
    b.pad(-52, 22, 26, 20, ground(-52, 22), 3);     // hotel lot
    b.pad(-144, -42, 26, 20, ground(-144, -42), 3); // office lot
  });
  b.buildTerrain(2);
  const g = (x: number, z: number) => b.ground(x, z);

  b.mirrored(() => blockOut(b));

  // ---- C: central square, decked over the canal (self-symmetric pieces outside the mirror) ----
  b.box(0, -0.7, 0, 2 * (CANAL_X + 3), 0.7, 60, 'concrete');
  b.box(0, 0, 0, 2.6, 2.4, 2.6, 'pillar');
  b.point('C', 'Meridian Square', 0, 0, 0, 14);

  b.mirrored(() => {
    // ---- Canal: retaining walls, stairs down to the bed, piers and debris ----
    b.box(-(CANAL_X + 1), CANAL_Y - 0.6, 0, 2, -CANAL_Y + 0.6, HALF_Z * 2, 'concrete');
    for (const [z, dir] of [[-45, 3], [50, 1], [-115, 3], [112, 1]] as const) b.ramp(-CANAL_X + 1.2, z, 2.4, 10, CANAL_Y, 0, dir, 'stairs');
    b.box(0, CANAL_Y, -15, 2.4, -CANAL_Y - 0.7, 4, 'pillar');           // piers under the square
    b.box(0, CANAL_Y, -72, 2.4, -CANAL_Y - 0.7, 5, 'pillar');           // pier under the bridge
    b.box(3, CANAL_Y, -34, 2.2, 1.8, 2.6, 'rock');
    b.box(-4, CANAL_Y, -100, 2.6, 1.6, 3.2, 'rock');
    b.box(-2.5, CANAL_Y, -128, 6.2, 2.6, 2.5, 'container');
    b.solidProp('Prop_Crate_Large', 4, CANAL_Y, -58, 0.4, 1.9, 1.3, 1.9);
    b.light(-4, -1.6, -10, 0x9fd8ff, 4, 12);

    // ---- North road bridge (the south one is its mirror) ----
    b.box(0, -0.7, -72, 2 * (CANAL_X + 3), 0.7, 12, 'concrete');
    b.box(0, 0, -77.75, 2 * (CANAL_X + 3), 1.0, 0.5, 'concrete');
    b.box(0, 0, -66.25, 2 * (CANAL_X + 3), 1.0, 0.5, 'concrete');
    b.box(-3, 0, -73.5, 6.2, 2.6, 2.5, 'container');                     // jack-knifed truck
    b.box(5.5, 0, -70, 2.2, 1.5, 4.4, 'container');                      // car

    // ---- C: the square's west bank ----
    b.box(-6.2, 0, -4.2, 0.6, 1.15, 3.6, 'wallDark');
    b.box(-4.2, 0, -6.2, 3.6, 1.15, 0.6, 'wallDark');
    b.box(6.2, 0, -4.2, 0.6, 1.15, 3.6, 'wallDark');
    b.box(4.2, 0, -6.2, 3.6, 1.15, 0.6, 'wallDark');
    b.light(-6.5, 1.8, -6.5, 0x7ff6ff, 5, 12);
    b.box(-26, g(-26, -24), -24, 6.2, 2.6, 2.5, 'container');
    b.box(-26, g(-26, -24) + 2.6, -24, 6.2, 2.6, 2.5, 'container');
    b.box(-17, g(-17, 22), 22, 10, 3, 2.6, 'container');                 // burnt-out bus
    b.box(-20, g(-20, 8), 8, 2.2, 1.2, 2.2, 'concrete');                 // planters
    b.box(-20, g(-20, -8), -8, 2.2, 1.2, 2.2, 'concrete');
    b.box(-14, g(-14, -18), -18, 4.2, 1.2, 0.9, 'concrete');
    b.box(-28, g(-28, 2), 2, 0.9, 1.2, 4.2, 'concrete');
    b.box(-30, g(-30, 16), 16, 3, 3.2, 3, 'wallDark');                   // kiosk
    b.solidProp('Prop_Crate_Large', -13, 'ground', 12, 0.3, 1.9, 1.3, 1.9);
    b.solidProp('Prop_Crate_Tarp', -22, 'ground', -14, 1.2, 1.4, 1.05, 1.4);
    // Landmark tower over the core: visible from everywhere, beacon on its mast.
    const ty = g(-51, 47) - 2;
    b.box(-51, ty, 47, 14, 66, 14, 'wall');
    b.box(-51, ty + 66, 47, 9, 4, 9, 'wallDark');
    b.mast(-51, ty + 70, 47, 14);
    b.light(-51, ty + 72, 47, 0xff4a3a, 6, 30);

    // ---- Elevated highway along the north edge (the south one is its mirror) ----
    b.box(0, HWY_Y - 0.8, HWY_Z, 280, 0.8, 10, 'floor');
    b.box(0, HWY_Y, HWY_Z + 4.75, 280, 1.1, 0.5, 'concrete');
    b.box(-102, HWY_Y, HWY_Z - 4.75, 76, 1.1, 0.5, 'concrete');
    b.box(0, HWY_Y, HWY_Z - 4.75, 116, 1.1, 0.5, 'concrete');
    b.box(102, HWY_Y, HWY_Z - 4.75, 76, 1.1, 0.5, 'concrete');
    for (const x of [-125, -100, -75, -50, -25, 25, 50, 75, 100, 125]) {
      const py = g(x, HWY_Z) - 1;
      b.box(x, py, HWY_Z, 2.2, HWY_Y - 0.8 - py, 2.2, 'pillar');
    }
    b.ramp(-150, HWY_Z, 20, 10, g(-160, HWY_Z), HWY_Y, 0, 'ramp');
    b.ramp(150, HWY_Z, 20, 10, g(160, HWY_Z), HWY_Y, 2, 'ramp');
    b.ramp(-72, HWY_Z - 6.5, 20, 3, g(-82, HWY_Z - 6.5), HWY_Y, 0, 'stairs');
    b.ramp(72, HWY_Z - 6.5, 20, 3, g(82, HWY_Z - 6.5), HWY_Y, 2, 'stairs');
    for (const x of [-60, 60]) b.box(x, g(x, HWY_Z - 6.5) - 0.5, HWY_Z - 6.5, 4, HWY_Y - g(x, HWY_Z - 6.5) + 0.5, 3, 'concrete');
    b.box(-30, HWY_Y, HWY_Z - 1.5, 6.2, 2.6, 2.5, 'container');          // stalled traffic
    b.box(-118, HWY_Y, HWY_Z + 2, 4.4, 1.5, 2.2, 'container');
    b.box(58, HWY_Y, HWY_Z + 1.5, 6.2, 2.6, 2.5, 'container');
    b.box(-18, g(-18, -92), -92, 4.4, 1.5, 2.2, 'container');            // cars under the deck
    b.box(-132, g(-132, -98), -98, 2.2, 1.5, 4.4, 'container');

    // ---- Avenues and streets: wrecks staggered to break the long sightlines ----
    const wreck = (x: number, z: number, alongX: boolean, high = false) => {
      const [w, d] = alongX ? [6.2, 2.5] : [2.5, 6.2];
      const y = g(x, z);
      b.box(x, y, z, w, 2.6, d, 'container');
      if (high) b.box(x, y + 2.6, z, w, 2.6, d, 'container');
    };
    wreck(-140, -75, true, true); wreck(-104, -69, true); wreck(-56, -75, true, true); wreck(-24, -69, true);
    wreck(-134, 69, true); wreck(-82, 75, true, true); wreck(-30, 69, true);
    wreck(-150, -3, true, true); wreck(-58, 3, true); wreck(-46, -3, true);
    wreck(-169, -60, false, true); wreck(-163, 60, false); wreck(-169, 110, false, true); wreck(-163, -105, false);
    wreck(-124, -86, false); wreck(-124, 86, false, true); wreck(-38, -50, false, true); wreck(-38, 50, false);
    b.box(-124, g(-124, -18), -18, 4.2, 1.2, 0.9, 'concrete');
    b.box(-66, g(-66, -92), -92, 0.9, 1.2, 4.2, 'concrete');

    // ---- Warpgate: walled courtyard behind a one-way team shield ----
    const by = g(-184, 0);
    b.box(-172.15, by, 0, 0.3, 8, 40, 'shield', 'energy', b.team(0));
    for (const x of [-192, -186, -180]) for (const z of [-16, -8, 0, 8, 16]) b.spawn(0, x, by, z, -Math.PI / 2);
    b.raw({ kind: 'spawnPad', team: b.team(0), ...b.at(-184, 0), y: by, rotY: b.rotation(-Math.PI / 2) });
    b.light(-188, by + 7, 0, b.mirroredSide ? 0xff5a4a : 0x58b6ff, 8, 26);
    b.box(-176, by, -12, 0.9, 1.3, 4.4, 'concrete');
    b.box(-176, by, 12, 0.9, 1.3, 4.4, 'concrete');

    park(b, g);
    ruins(b, g);
    construction(b, g);
    twoStorey(b, -52, 22, g(-52, 22));      // hotel by the square
    twoStorey(b, -144, -42, g(-144, -42));  // offices by the base

    // ---- Ammo crate ----
    b.ammoCrate(-3, CANAL_Y, -50);                           // canal bed

    // ---- Vehicles on the base boulevard: two cars, two scooters and a helicopter ----
    b.vehicle('car', -166, 'ground', -30, 0);
    b.vehicle('car', -166, 'ground', 30, Math.PI);
    b.vehicle('scooter', -166, 'ground', -40, 0);
    b.vehicle('scooter', -166, 'ground', 40, Math.PI);
    b.vehicle('heli', -166, 'ground', -85, 0);
  });

  // ---- Points A, B and their mirrors D, E (ids do not mirror, so they are placed here) ----
  b.point('A', 'Park', -128, g(-128, 40), 40, 13);
  b.point('B', 'Construction Site', -64, -2.5, -38, 12);
  b.point('D', 'Construction Site', 64, -2.5, 38, 12);
  b.point('E', 'Park', 128, g(-128, 40), -40, 13);

  return b.build();
}

/** A: wooded hills around a sheltered pavilion on the flag hill. */
function park(b: MapBuilder, g: (x: number, z: number) => number) {
  const ay = g(-128, 40);
  b.platform(-128, 40, 9, 9, ay + 3.6);
  b.box(-128, ay, 40, 1.4, 1.1, 1.4, 'pillar');                       // monument plinth
  b.light(-128, ay + 3, 40, 0xffe0a8, 5, 14);
  const trees: [number, number, number, number][] = [
    [-140, 22, 1.1, 0], [-136, 30, 0.9, 1], [-118, 26, 1.0, 2], [-112, 36, 0.8, 1], [-138, 52, 1.2, 0],
    [-120, 56, 1.0, 2], [-110, 62, 0.9, 0], [-146, 62, 1.1, 1], [-104, 54, 0.8, 2], [-132, 60, 0.9, 1],
    [-116, 46, 0.7, 0], [-140, 44, 0.8, 2],
  ];
  for (const [x, z, s, v] of trees) b.tree(x, z, s, v);
  // Low garden walls and boulders as cover.
  b.box(-118, g(-118, 32), 32, 6, 1.1, 0.7, 'wallDark');
  b.box(-136, g(-136, 47), 47, 0.7, 1.1, 6, 'wallDark');
  b.box(-122, g(-122, 50), 50, 5, 1.1, 0.7, 'wallDark');
  b.box(-108, g(-108, 28), 28, 2.4, 1.6, 2.2, 'rock');
  b.box(-139, g(-139, 34), 34, 2.0, 1.4, 2.6, 'rock');
  b.box(-126, g(-126, 62), 62, 2.6, 1.8, 2.0, 'rock');
  b.solidProp('Prop_Crate_Tarp_Large', -114, 'ground', 42, 0.5, 2.2, 1.6, 2.2);
}

/** Between A and B: a bombed-out block of broken walls, a collapsed floor and rubble. */
function ruins(b: MapBuilder, g: (x: number, z: number) => number) {
  // [x, z, w, d, h]: wall stubs at uneven heights, gaps where shells went through.
  const walls: [number, number, number, number, number][] = [
    [-101, -24, 0.6, 12, 5.5], [-101, -6, 0.6, 6, 2.2], [-101, 8, 0.6, 10, 4.2],
    [-95, -31, 10, 0.6, 3.4], [-84, -31, 6, 0.6, 6.0], [-86, 17, 6, 0.6, 2.8],
    [-83, -14, 0.6, 9, 4.8], [-83, 10, 0.6, 6, 3.0], [-92, -10, 6, 0.6, 1.4], [-90, 4, 0.6, 5, 2.0],
  ];
  for (const [x, z, w, d, h] of walls) b.box(x, g(x, z) - 0.3, z, w, h + 0.3, d, 'wallDark');
  // Collapsed upper floor: a slab still up on the north side, its broken end slumped to the ground.
  const sy = g(-92, -22);
  b.box(-92, sy + 3.0, -24, 12, 0.4, 8, 'floor');
  b.box(-97.5, sy, -27.5, 0.6, 3.0, 0.6, 'pillar');
  b.box(-86.5, sy, -27.5, 0.6, 3.0, 0.6, 'pillar');
  b.ramp(-92, -16.5, 8, 7, sy, sy + 3.4, 3, 'ramp');
  // Rubble.
  for (const [x, z, s] of [[-96, -2, 1.6], [-87, 2, 2.2], [-98, 12, 1.4], [-86, -24, 1.2], [-94, 8, 1.0], [-89, -8, 1.3]] as const) {
    b.box(x, g(x, z) - 0.2, z, s * 1.4, s, s * 1.2, 'rock');
  }
  b.box(-88, g(-88, 12), 12, 2.2, 1.5, 4.4, 'container');               // flipped car
}

/** B: an excavation pit under an open steel frame, with a tower crane over it. */
function construction(b: MapBuilder, g: (x: number, z: number) => number) {
  const fy = g(-54, -61);
  // Two open floors of a frame going up beside the pit, stairs to each.
  b.platform(-54, -61, 16, 10, fy + 4.2);
  b.ramp(-42.5, -62.5, 7, 3, g(-39, -62.5), fy + 4.2, 2, 'stairs');
  b.box(-49, fy + 8.05, -61, 6, 0.35, 10, 'floor');
  for (const [px, pz] of [[-51.6, -65.6], [-46.4, -65.6], [-51.6, -61.5], [-46.4, -56.4]]) b.box(px, fy + 4.2, pz, 0.45, 3.85, 0.45, 'pillar');
  b.ramp(-55.25, -57.5, 6.5, 3, fy + 4.2, fy + 8.4, 0, 'stairs');
  b.box(-49, fy + 8.4, -65.8, 6, 1.0, 0.4, 'wallDark');
  b.box(-60, fy + 4.2, -65.8, 4, 1.0, 0.4, 'wallDark');
  // Crane on the pit edge.
  b.box(-78, g(-78, -50) - 0.5, -50, 2.4, 1.5, 2.4, 'concrete');
  b.mast(-78, g(-78, -50) + 1, -50, 26);
  // The pit: formwork walls, pipe stacks and pallets.
  b.box(-64, -2.5, -38, 1.2, 2.8, 1.2, 'pillar');                       // survey post on the flag
  b.box(-70, -2.5, -32, 6, 1.6, 0.6, 'concrete');
  b.box(-58, -2.5, -44, 6, 1.6, 0.6, 'concrete');
  b.box(-73, -2.5, -44, 0.6, 1.6, 5, 'concrete');
  b.box(-55, -2.5, -31, 0.6, 1.6, 5, 'concrete');
  b.box(-64, -2.5, -46.5, 8, 1.4, 2.4, 'pillar');                       // stacked pipes
  b.box(-84, g(-84, -58), -58, 6.2, 2.6, 2.5, 'container');
  b.box(-84, g(-84, -58) + 2.6, -58, 6.2, 2.6, 2.5, 'container');
  b.box(-48, g(-48, -22), -22, 2.5, 2.6, 6.2, 'container');
  b.solidProp('Prop_Crate_Large', -68, -2.5, -41, 0.2, 1.9, 1.3, 1.9);
  b.solidProp('Prop_Crate_Tarp_Large', -60, -2.5, -33, 0.7, 2.2, 1.6, 2.2);
  b.solidProp('Prop_Barrel2_Closed', -75, 'ground', -24, 0, 0.9, 1.2, 0.9);
  b.light(-64, 1.5, -38, 0xffd27a, 5, 16);
}

/**
 * Enterable two-storey building: a ground floor with doors on three sides, and exterior stairs
 * to a roof terrace that opens into a smaller upper floor.
 */
function twoStorey(b: MapBuilder, x: number, z: number, y: number) {
  const f1 = b.bunker(x, z, 20, 14, {
    y, h: 4.2,
    doors: [['n', -4, 2.6], ['s', 5, 2.6], ['e', 0, 2.4]],
    windows: [['n', 3, 2.2], ['n', 7.5, 2.2], ['s', -2, 2.2], ['s', -7, 2.2], ['e', -4, 1.8], ['e', 4, 1.8]],
  });
  const f2 = b.bunker(x + 3, z, 14, 14, {
    y: f1.top, h: 3.8,
    doors: [['w', -4, 2.4]],
    windows: [['n', -3, 2.2], ['n', 3, 2.2], ['s', 0, 2.6], ['e', -3, 2], ['e', 3, 2]],
  });
  // Stairs along the west wall to a landing beside the roof terrace.
  b.ramp(x - 11.5, z + 1.5, 3, 10, y, f1.top, 3, 'stairs');
  b.box(x - 11.5, y, z - 5, 3, f1.top - y, 3, 'concrete');
  b.box(x + 3, f2.top, z - 7.1, 14, 1.0, 0.4, 'wallDark');
  b.box(x + 9.9, f2.top, z, 0.4, 1.0, 13.4, 'wallDark');
  b.light(x, y + 3.6, z, 0xffd9a0, 5, 12);
}

/** Fills the west half outside the walkable areas with city blocks, tallest toward the core. */
function blockOut(b: MapBuilder) {
  const cell = 2, w = HALF_X / cell, d = (HALF_Z * 2) / cell, maxRun = 10;
  const solid = new Uint8Array(w * d);
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    solid[j * w + i] = open(-HALF_X + (i + 0.5) * cell, -HALF_Z + (j + 0.5) * cell) ? 0 : 1;
  }
  // Greedy rectangles, capped at 20 m a side so heights vary along each block.
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
    const x0 = -HALF_X + i * cell, z0 = -HALF_Z + j * cell, x1 = x0 + rw * cell, z1 = z0 + rd * cell;
    const corners = [b.ground(x0, z0), b.ground(x1, z0), b.ground(x0, z1), b.ground(x1, z1)];
    const bottom = Math.min(...corners) - 1.5, top = Math.max(...corners);
    const r = hash(i, j);
    const core = smooth(1 - Math.hypot((x0 + x1) / 2, (z0 + z1) / 2) / 170);
    const edge = i === 0 || j === 0 || j + rd === d;
    const height = 8 + core * 22 + Math.floor(r * 5) * 2 + (edge ? 6 : 0);
    const style: BlockStyle = r < 0.35 ? 'wall' : r < 0.55 ? 'wallDark' : r < 0.82 ? (height <= 15 ? 'sandstone' : 'wall') : 'concrete';
    b.box((x0 + x1) / 2, bottom, (z0 + z1) / 2, x1 - x0, top + height - bottom, z1 - z0, style);
  }
}
