import { MapBuilder } from './builder';
import type { MapDef } from './types';

/**
 * Warehouse: an original homage to BeGone's third map (geometry and art are our own). One
 * skylit hall: each team deploys in a wide empty bay under its sniping deck, the middle is a
 * maze of wooden crates, and a bridge crosses over the maze carrying the hall's only fixed ammo
 * crate. The bridge is two offset lanes, each climbed by stairs from one team's side, with a
 * team-coloured box half-blocking each lane. Each deck has stairs at both ends and four ladders up
 * its face. Militia (team 1) holds the west bay, SWAT the east.
 *
 * Coordinates: +X east, +Z south, metres. Everything inside `mirrored()` is repeated rotated
 * 180° for the other team, so the two halves are identical, as in the original.
 */
const HALF_X = 28.5, HALF_Z = 16.5;
/** Inner faces of the hall walls. */
const IN_X = 27.5, IN_Z = 15.5;
const CRATE = 1.5;
const BRIDGE = 3.6, DECK = 3.2;
const MILITIA_GREEN = 0x6f8a46, SWAT_BLUE = 0x4a6f9c, GIRDER = 0x8a9399;

/** The northern maze, [x, z, stacked crates]; the mirror lays out the southern one. */
const MAZE: [number, number, number][] = [
  // North-west "C" around a dead end.
  [-5.6, -12.8, 2], [-8.6, -11.3, 2], [-7.1, -11.3, 1], [-5.6, -11.3, 1], [-4.1, -11.3, 1],
  [-8.6, -9.8, 1], [-8.6, -8.3, 1], [-4.1, -9.8, 1], [-2.6, -9.8, 2], [-2.6, -8.3, 1],
  // The cross in front of the bridge stairs.
  [-5.6, -6.8, 1], [-7.1, -5.3, 1], [-5.6, -5.3, 2], [-4.1, -5.3, 1], [-2.6, -5.3, 1], [-5.6, -3.8, 1],
  // North-centre block against the wall.
  [2.2, -14.3, 2], [0.7, -12.8, 1], [2.2, -12.8, 1], [5.2, -12.8, 1], [5.2, -11.3, 1],
  [2.2, -9.8, 1], [3.7, -9.8, 1], [5.2, -9.8, 2], [0.7, -8.3, 1], [2.2, -8.3, 1],
  // The tall column on the north wall.
  [8.2, -14.3, 2], [8.2, -12.8, 2], [8.2, -11.3, 1],
  // North-east steps up toward the bridge.
  [5.2, -6.8, 2], [6.7, -6.8, 1], [8.2, -6.8, 1], [3.7, -5.3, 1], [5.2, -5.3, 1], [3.7, -3.8, 1],
  [0.7, -5.3, 1], [0.7, -3.8, 1], [8.2, -3.8, 1],
];

export function warehouse(): MapDef {
  const b = new MapBuilder({
    id: 'warehouse', name: 'Warehouse', region: 'FREIGHT DEPOT / CRATE HALL',
    description: 'A crate maze under a bridge, with sniping decks over both bays.',
    theme: 'snow', halfX: HALF_X, halfZ: HALF_Z, seed: 5, roll: 0, ridge: 0,
    sun: { x: 0.35, y: 0.82, z: 0.3 },
    // Buried under the hall's slab floor (deep enough that no walkable layer hides beneath it); snowdrifts heap up against the outside walls.
    ground: (x, z) => { const e = Math.max(Math.abs(x) - HALF_X, Math.abs(z) - HALF_Z); return e > 0 ? Math.min(3, e * 0.3) : -1; },
  });
  b.buildTerrain(2);

  // ---- Hall floor, the bridge deck and its ammo crate ----
  b.box(0, -1, 0, IN_X * 2, 1, IN_Z * 2, 'slab');
  b.box(0, BRIDGE - 0.3, 0, 23, 0.3, 6, 'floor');
  b.ammoCrate(0, BRIDGE, 0);
  b.point('B', 'Bridge', 0, BRIDGE, 0, 6);
  b.paint(b.box(0, 8.9, 0, 0.3, 0.6, IN_Z * 2, 'steel'), GIRDER);   // centre roof truss
  b.light(0, 8.4, 0, 0xfff1d0, 5, 14);

  b.mirrored(() => {
    // ---- Shell: west wall, north wall with a high window band, skylit roof ----
    b.box(-HALF_X + 0.5, 0, 0, 1, 9.8, HALF_Z * 2, 'roof');
    b.box(0, 0, -HALF_Z + 0.5, HALF_X * 2, 5.6, 1, 'roof');
    b.box(0, 5.6, -HALF_Z + 0.6, HALF_X * 2, 1.6, 0.4, 'glass');
    b.box(0, 7.2, -HALF_Z + 0.5, HALF_X * 2, 2.6, 1, 'roof');
    for (const [z0, z1] of [[-HALF_Z, -11.5], [-9.5, -4], [-2, 0]]) b.box(0, 9.8, (z0 + z1) / 2, HALF_X * 2, 0.3, z1 - z0, 'roof');
    for (const x of [-24, -16, -8]) {
      b.paint(b.box(x, 8.9, 0, 0.3, 0.6, IN_Z * 2, 'steel'), GIRDER);
      b.paint(b.box(x, 0, -IN_Z + 0.25, 0.5, 9.8, 0.5, 'steel'), GIRDER);
      b.light(x, 8.4, -7, 0xfff1d0, 5, 14);
    }
    b.paint(b.box(-IN_X + 0.25, 0, -8, 0.5, 9.8, 0.5, 'steel'), GIRDER);

    // ---- Bay: twelve slots in a line under the sniping deck (Militia west, SWAT east) ----
    for (let i = 0; i < 12; i++) b.spawn(1, -20.5, 0, -13.2 + i * 2.4, -Math.PI / 2);

    // ---- Sniping deck along the end wall, stairs at both ends, two team boxes for cover ----
    b.box(-25.75, DECK - 0.3, 0, 3.5, 0.3, 19, 'floor');
    for (const z of [-9.2, -3, 3, 9.2]) b.paint(b.box(-24.2, 0, z, 0.3, DECK - 0.3, 0.3, 'steel'), GIRDER);
    b.stairs(-26.6, -12, 1.8, 5, 0, DECK, 1);
    b.stairs(-26.6, 12, 1.8, 5, 0, DECK, 3);
    // The original's four ladders up the deck's face from the bay (one comes up behind a team box),
    // with the railing open where each one arrives.
    const ladders = [-7.4, -4.5, 1.4, 7.4];
    for (const z of ladders) b.ladder(-24, z, 0, DECK, 2);
    [-9.5, ...ladders.flatMap(z => [z - 0.6, z + 0.6]), 9.5].forEach((z, i, all) => { if (i % 2 === 0) b.rail(-24, z, -24, all[i + 1], DECK); });
    const team = b.mirroredSide ? SWAT_BLUE : MILITIA_GREEN;
    b.crate(-25.6, DECK, -4.5, CRATE, 1.2, CRATE, team);
    b.crate(-25.6, DECK, 5.5, CRATE, 1.2, CRATE, team);

    // ---- Bridge: this team's lane climbs from its side; its box half-blocks the lane ----
    b.stairs(-13.75, -1.5, 4.5, 3, 0, BRIDGE, 0);
    b.crate(-5.5, BRIDGE, -1.5, CRATE, CRATE, 3, team);
    for (const x of [-11, -5.5]) for (const z of [-2.85, 2.85]) b.paint(b.box(x, 0, z, 0.3, BRIDGE - 0.3, 0.3, 'steel'), GIRDER);
    b.rail(-11.5, -3, 11.5, -3, BRIDGE);

    // ---- The maze ----
    for (const [x, z, stack] of MAZE) for (let k = 0; k < stack; k++) b.crate(x, k * CRATE, z);
    b.point(b.mirroredSide ? 'C' : 'A', b.mirroredSide ? 'South Stacks' : 'North Stacks', -0.8, 0, -10, 6);
  });
  return b.build();
}
