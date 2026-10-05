import { MapBuilder } from './builder';
import type { MapDef } from './types';

/**
 * Ochre Quarter: an original desert-town take on the classic two-site layout of CS:GO's
 * Dust II (geometry and art are our own; nothing is imported from that game). Unlike the
 * other battlefields it is deliberately asymmetric. Team 0 deploys at the southern plaza
 * (the attackers' spawn), team 1 at the northern courtyard (the defenders'). A is the
 * north-east site at the top of Long, B is mid by the crate, C is the north-west site at the
 * end of Tunnels.
 *
 * Coordinates: +X east, +Z south, metres. The town is blocked out as walkable areas; every
 * metre not covered by an area becomes sandstone building mass.
 */

/** Walkable floor: constant height, or a linear slope from h[0] at the min side to h[1]. */
interface Area { x0: number; x1: number; z0: number; z1: number; h: number | [number, number]; along?: 'x' | 'z' }
const area = (x0: number, x1: number, z0: number, z1: number, h: Area['h'], along?: Area['along']): Area => ({ x0, x1, z0, z1, h, along });

const HALF_X = 60, HALF_Z = 58;

// Later areas win where they overlap. Keep every edge on an even metre so the 2 m terrain
// samples fall on area borders and floors stay flat right up to the walls.
const AREAS: Area[] = [
  // ---- Defenders' side (north) ----
  area(-56, -26, -54, -26, 0),                 // C: north-west site
  area(-26, -24, -42, -38, 0),                 // C doors
  area(-24, -10, -44, -36, 0),                 // C-doors corridor
  area(-10, 4, -50, -28, 0),                   // defenders' mid
  area(-4, 2, -28, -24, 0),                    // mid doors
  area(4, 8, -48, -42, 0),                     // courtyard → defenders' mid
  area(8, 26, -56, -40, 0),                    // defenders' courtyard (spawn)
  area(26, 34, -50, -42, [0, 2], 'x'),         // ramp up to A
  area(34, 56, -56, -30, 2),                   // A: north-east site
  // ---- Mid and catwalk ----
  area(-6, 6, -24, 22, 0),                     // mid
  area(6, 12, -36, 14, 0),                     // under the catwalk (the catwalk is a solid deck)
  area(12, 26, -36, -28, 2.5),                 // short
  area(26, 34, -36, -30, [2.5, 2], 'x'),       // short → A
  area(-8, 8, 22, 34, [0, 2], 'z'),            // top of mid, climbing to the plaza
  // ---- Attackers' side (south) ----
  area(-14, 16, 34, 52, 2),                    // attackers' plaza (spawn)
  area(16, 36, 36, 46, [2, 1], 'x'),           // plaza → outside long
  area(36, 46, 30, 46, 1),                     // outside long
  area(38, 44, 26, 30, [0.5, 1], 'z'),         // long doors
  area(34, 56, 14, 26, 0.5),                   // long corner
  area(48, 58, 26, 40, -2),                    // pit
  area(48, 58, 26, 32, [0.5, -2], 'z'),
  area(42, 56, -30, 14, [2, 0.5], 'z'),        // long, climbing north to A
  area(-22, -14, 36, 46, 2),                   // plaza → outside tunnels
  area(-50, -22, 26, 44, 1),                   // outside tunnels
  area(-30, -22, 26, 44, [1, 2], 'x'),
  // ---- Tunnels ----
  area(-40, -32, 12, 26, [0, 1], 'z'),         // upper tunnel entrance
  area(-40, -28, -4, 12, 0),                   // upper tunnels junction
  area(-40, -32, -26, -4, 0),                  // tunnel to C
  area(-28, -22, 2, 8, [0, -1], 'x'),          // lower tunnels
  area(-22, -12, 2, 8, -1),
  area(-12, -6, 2, 8, [-1, 0], 'x'),
];

function floorAt(x: number, z: number): number | undefined {
  for (let i = AREAS.length - 1; i >= 0; i--) {
    const a = AREAS[i];
    if (x < a.x0 || x > a.x1 || z < a.z0 || z > a.z1) continue;
    if (typeof a.h === 'number') return a.h;
    const t = a.along === 'x' ? (x - a.x0) / (a.x1 - a.x0) : (z - a.z0) / (a.z1 - a.z0);
    return a.h[0] + (a.h[1] - a.h[0]) * t;
  }
  return undefined;
}

export function ochreQuarter(): MapDef {
  const b = new MapBuilder({
    id: 'ochre', name: 'Ochre Quarter', region: 'INDAR-CLASS DESERT / OLD TOWN',
    description: 'Asymmetric two-site old town: Long, Mid, Catwalk and Tunnels.',
    theme: 'desert', halfX: HALF_X, halfZ: HALF_Z, seed: 2, roll: 0, ridge: 0,
    sabotage: { sites: ['A', 'C'], attackerSpawn: 0 },
    sun: { x: 0.45, y: 0.7, z: 0.4 },
    ground: (x, z) => floorAt(x, z) ?? 0,
  });
  b.buildTerrain(2);
  blockOut(b);

  // ---- B: mid, around the mid crate ----
  b.box(0, 0, 4, 2.6, 2.4, 2.6, 'pillar');
  b.point('B', 'Mid', 0, 0, 4, 8.5);
  b.box(-1, 3.2, -26, 6, 4.8, 2, 'sandstone');                    // mid doors lintel
  b.box(-3.4, 0, -22, 0.25, 2.6, 3.2, 'wallDark');                // open door leaves
  b.box(1.4, 0, -22, 0.25, 2.6, 3.2, 'wallDark');
  b.solidProp('Prop_Crate_Large', -4.4, 0, -14, 0.1, 1.9, 1.3, 1.9);
  b.solidProp('Prop_Crate', 4.6, 0, 17, 0.3, 1.2, 1.0, 1.2);
  b.box(-4.5, 0, 17, 2, 1.2, 0.9, 'concrete');
  // Catwalk: a raised deck along mid's east side, with stairs up from the crate.
  b.box(9, 0, -14, 6, 2.5, 44, 'sandstone');
  b.ramp(9, 11, 6, 6, 0, 2.5, 3, 'stairs');
  b.rail(6.1, -10, 6.1, 8, 2.5);
  b.solidProp('Prop_Crate_Tarp', 9.5, 2.5, -24, 0.2, 1.4, 1.05, 1.4);
  b.light(-5.4, 2.8, 12, 0xffc27a, 4, 10);

  // ---- A: north-east site ----
  b.point('A', 'A Site', 46, 2, -40, 8);
  b.box(44, 2, -51, 8, 1, 6, 'sandstone');                        // site platform
  b.ramp(44, -46.5, 4, 3, 2, 3, 3, 'stairs');
  b.solidProp('Prop_Crate_Large', 39, 2, -40, 0.15, 1.9, 1.3, 1.9);
  b.solidProp('Prop_Crate', 39.3, 3.3, -40.2, 0.6, 1.2, 1.0, 1.2);
  b.solidProp('Prop_Crate_Large', 52.5, 2, -35, 0, 1.9, 1.3, 1.9);
  b.box(53, 2, -54, 3, 1.2, 0.9, 'concrete');                     // corner cover at the back
  b.box(36.5, 2, -45, 0.9, 1.2, 3.4, 'concrete');                 // top of the defenders' ramp
  b.rail(34, -36, 34, -42, 2);
  b.light(46, 5.5, -55.6, 0xfff1d0, 5, 12);
  // Long: barrels and the car at the top, a container at the corner.
  b.solidProp('Prop_Barrel1', 54.5, 'ground', -14, 0, 0.7, 1.1, 0.7);
  b.solidProp('Prop_Barrel2_Closed', 43.8, 'ground', 2, 0, 0.9, 1.2, 0.9);
  b.box(50, b.ground(50, -24), -24, 2.2, 1.5, 4.4, 'container');  // car at the top of long
  b.box(51, 0.5, 20, 6.2, 2.6, 2.5, 'container');                 // long corner container
  b.solidProp('Prop_Crate_Tarp_Large', 37, 0.5, 17, 0.4, 2.2, 1.6, 2.2);
  b.box(41, 4.2, 28, 6, 3.8, 4, 'sandstone');                     // long doors lintel
  b.box(38.4, 1, 31.8, 0.25, 2.6, 3.4, 'wallDark');               // door leaves swung open
  b.box(43.6, 1, 31.8, 0.25, 2.6, 3.4, 'wallDark');
  b.solidProp('Prop_Crate', 44.6, 1, 42, 0.2, 1.2, 1.0, 1.2);
  b.solidProp('Prop_Crate_Large', 53, -2, 38, 0.3, 1.9, 1.3, 1.9);  // pit
  // Short: cover where it opens onto the site.
  b.box(29, b.ground(29, -34.5), -34.5, 0.9, 1.2, 2.6, 'concrete');

  // ---- C: north-west site ----
  b.point('C', 'C Site', -40, 0, -40, 8);
  b.box(-51, 0, -50, 10, 1, 8, 'sandstone');                      // back platform
  b.ramp(-44.5, -48, 3, 4, 0, 1, 2, 'stairs');
  b.solidProp('Prop_Crate_Large', -40, 0, -46, 0.1, 1.9, 1.3, 1.9);
  b.solidProp('Prop_Crate_Large', -38, 0, -46.2, 0.4, 1.9, 1.3, 1.9);
  b.solidProp('Prop_Crate', -38.8, 1.3, -46.1, 0.9, 1.2, 1.0, 1.2);
  b.box(-31, 0, -31, 2.5, 2.6, 6.2, 'container');                 // by the tunnel exit
  b.box(-50, 0, -34, 4.4, 1.5, 2.2, 'container');                 // car
  b.solidProp('Prop_Crate_Tarp', -29, 0, -46.5, 0.5, 1.4, 1.05, 1.4);
  b.box(-25, 3.2, -40, 2, 4.8, 4, 'sandstone');                   // C doors lintel
  b.light(-40, 3, -53.6, 0xfff1d0, 5, 12);

  // ---- Tunnels: roofed, lamp-lit passages ----
  b.box(-36, 3.6, 16, 8, 0.6, 8, 'sandstone');
  b.box(-34, 3.2, 4, 12, 0.6, 16, 'sandstone');
  b.box(-36, 3.2, -12, 8, 0.6, 16, 'sandstone');
  b.box(-17, 2.4, 5, 18, 0.6, 6, 'sandstone');
  b.solidProp('Prop_Barrel1', -38.8, 0, -1, 0, 0.7, 1.1, 0.7);
  b.solidProp('Prop_Crate', -29.6, 0, 10.2, 0.2, 1.2, 1.0, 1.2);
  for (const [x, y, z] of [[-36, 3.1, 16], [-34, 2.7, 4], [-36, 2.7, -12], [-17, 1.9, 5]]) b.light(x, y, z, 0xffb45a, 5, 9);
  b.solidProp('Prop_Crate_Large', -44, 1, 30, 0.2, 1.9, 1.3, 1.9);  // outside tunnels
  b.solidProp('Prop_Crate_Tarp_Large', -30, 'ground', 40, 0.6, 2.2, 1.6, 2.2);

  // ---- Spawns: walled courtyards behind team shields ----
  b.box(1, 2, 46, 30, 7, 0.3, 'shield', 'energy', 0);
  for (const x of [-10, -4, 2, 8, 12]) b.spawn(0, x, 2, 49.5, 0);
  b.raw({ kind: 'spawnPad', team: 0, x: 1, y: 2, z: 47.4, rotY: 0 });
  b.solidProp('Prop_Crate_Large', -9, 2, 40, 0.3, 1.9, 1.3, 1.9);
  b.solidProp('Prop_Crate', 12.5, 2, 38, 0, 1.2, 1.0, 1.2);
  b.light(1, 6, 51.6, 0xff5a4a, 8, 20);

  b.box(17, 0, -50, 18, 7, 0.3, 'shield', 'energy', 1);
  for (const x of [10, 14, 18, 22, 25]) b.spawn(1, x, 0, -53, Math.PI);
  b.raw({ kind: 'spawnPad', team: 1, x: 17, y: 0, z: -51.2, rotY: Math.PI });
  b.solidProp('Prop_Crate', 10, 0, -44, 0.2, 1.2, 1.0, 1.2);
  b.light(17, 6, -55.6, 0x58b6ff, 8, 20);

  // ---- Ammo crates ----

  return b.build();
}

/** Fills every metre outside the walkable areas with merged sandstone building blocks. */
function blockOut(b: MapBuilder) {
  const w = HALF_X * 2, d = HALF_Z * 2;
  const solid = new Uint8Array(w * d);
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) solid[j * w + i] = floorAt(i - HALF_X + 0.5, j - HALF_Z + 0.5) === undefined ? 1 : 0;
  // Greedy rectangles: widest run first, then grow down while the whole run stays solid.
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    if (!solid[j * w + i]) continue;
    let rw = 1;
    while (i + rw < w && solid[j * w + i + rw]) rw++;
    let rd = 1;
    grow: while (j + rd < d) {
      for (let k = 0; k < rw; k++) if (!solid[(j + rd) * w + i + k]) break grow;
      rd++;
    }
    for (let jj = j; jj < j + rd; jj++) solid.fill(0, jj * w + i, jj * w + i + rw);
    const edge = i === 0 || j === 0 || i + rw === w || j + rd === d;
    const top = 7 + ((i * 7 + j * 13) % 5) * 0.6 + (edge ? 3 : 0);
    b.box(i - HALF_X + rw / 2, -3, j - HALF_Z + rd / 2, rw, top + 3, rd, 'sandstone');
  }
}
