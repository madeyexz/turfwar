import { MapBuilder, fbm } from './builder';
import type { MapDef } from './types';

/**
 * Crane: an original homage to BeGone's first map (geometry and art are our own). A large, open
 * plateau fought at mid to long range, with close fights in its two houses. Militia (team 1)
 * deploys in the north-west behind its brick building (whose roof is the map's sniping perch),
 * beside the tank platform and the L-shaped fence. SWAT (team 0) deploys in the south-east under
 * the gantry crane, by its tank platform. The middle holds the Ammo house (a barn with holes in
 * its roof and stairs at the back) and the Silo; the fallen crane lies across the north-east
 * corner, the Broken house sits by the west fence, and the Trench runs along the south edge from
 * behind the Broken house to the SWAT yard. Sabotage: A is inside the Ammo house, B at the SWAT
 * base.
 *
 * Coordinates: +X east, +Z south, metres (BeGone's top-down view with north up). Asymmetric, as
 * in the original: everything is placed directly.
 */
const HALF_X = 52, HALF_Z = 39;
const CRANE_RUST = 0xb0662e, CRANE_CAB = 0xc68a2c, OLIVE = 0x7a845a, TANK_WHITE = 0xd8d4c8, RED_CRATE = 0xa0604c;

type B = MapBuilder;
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/** Depth of the trenches cut into the plateau at (x, z). */
function trench(x: number, z: number) {
  // The long trench: along the south edge from behind the Broken house to the SWAT yard.
  const longEnds = smooth(Math.min(x + 38, 8 - x) / 6);
  const longAcross = Math.abs(z - 30.5);
  const long = 1.8 * longEnds * (longAcross < 1.5 ? 1 : 1 - smooth((longAcross - 1.5) / 2.5));
  // The short campers' trench between the SWAT platform and the fallen crane.
  const shortEnds = smooth(Math.min(z - 4, 20 - z) / 4);
  const shortAcross = Math.abs(x - 33);
  const short = 1.4 * shortEnds * (shortAcross < 1.2 ? 1 : 1 - smooth((shortAcross - 1.2) / 2.2));
  return Math.max(long, short);
}

/** Plateau ground: a gentle roll, rocky slopes rising past the east and north-east edges, the trenches. */
function ground(x: number, z: number) {
  let h = fbm(x * 0.035, z * 0.035, 13) * 0.9;
  h += smooth((x - 40) / 14) * 10;                                            // east rocks
  h += smooth(((x - 18) * 0.6 + (-z - 22) * 0.8 - 10) / 10) * 8;              // north-east plateau edge
  h += smooth((-z - 38.5) / 12) * 7 + smooth((z - 38.5) / 12) * 7 + smooth((-x - 51) / 12) * 7;
  return h - trench(x, z);
}

/** Plank fence along an axis-aligned line, in short panels that follow the ground. */
function fence(b: B, x0: number, z0: number, x1: number, z1: number) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len / 6);
  for (let i = 0; i < n; i++) {
    const cx = x0 + (x1 - x0) * (i + 0.5) / n, cz = z0 + (z1 - z0) * (i + 0.5) / n;
    const g = Math.min(b.ground(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n), b.ground(cx, cz), b.ground(x0 + (x1 - x0) * (i + 1) / n, z0 + (z1 - z0) * (i + 1) / n));
    const along = x1 !== x0;
    b.box(cx, g - 0.4, cz, along ? len / n : 0.15, 2.7, along ? 0.15 : len / n, 'wood');
  }
}

/** A lattice member lying on the ground from (x0, z0) to (x1, z1), kinked where it settled on the slope. */
function fallenGirder(b: B, x0: number, z0: number, x1: number, z1: number, kinks: number, w: number, h: number) {
  for (let i = 0; i < kinks; i++) {
    const xa = x0 + (x1 - x0) * i / kinks, za = z0 + (z1 - z0) * i / kinks;
    const xb = x0 + (x1 - x0) * (i + 1) / kinks, zb = z0 + (z1 - z0) * (i + 1) / kinks;
    b.truss(xa, b.ground(xa, za) - 0.05, za, xb, b.ground(xb, zb) - 0.05, zb, w, h, CRANE_RUST);
  }
}

export function crane(): MapDef {
  const b = new MapBuilder({
    id: 'crane', name: 'Crane', region: 'HILLTOP DEPOT / FALLEN CRANE',
    description: 'Open plateau: the Ammo house, the Silo, a fallen crane and two bases with sniping perches.',
    theme: 'dusk', halfX: HALF_X, halfZ: HALF_Z, seed: 13, roll: 0, ridge: 0,
    sabotage: { sites: ['A', 'B'], attackerSpawn: 1 },
    // Low evening sun in the west: long shadows fall east across the plateau.
    sun: { x: -0.72, y: 0.45, z: 0.22 },
    ground,
  });
  // Level foundations for everything that stands on the plateau.
  b.pad(-36.5, -24.5, 11, 21, 0, 4);             // Militia building
  b.pad(-46, -25, 10, 26, 0, 3);                 // Militia deployment strip
  b.pad(-25, -10.5, 10, 11, 0, 3);               // tank platform
  b.pad(-26, 1, 12, 12, 0, 3);                   // L-shaped fence
  b.pad(11.5, -6.9, 24, 13, 0, 4);               // Ammo house and its stairs
  b.pad(3, -21, 12, 14, 0, 3);                   // Silo and its stairs
  b.pad(-12.5, -19.5, 8, 5, 0, 3);               // buried container
  b.pad(-33.9, 11.75, 11, 16, 0, 4);             // Broken house
  b.pad(17, 27, 30, 20, 0, 4);                   // SWAT yard
  b.pad(-4, 21, 17, 6, 0, 3);                    // helicopter
  for (const z of [12.35, 35.1]) b.pad(-8.6, z, 3, 3, 0, 2);
  b.buildTerrain(2);
  const g = (x: number, z: number) => b.ground(x, z);

  // ---- Militia base (north-west): the brick building, its roof perch and the deployment strip ----
  const mb = b.bunker(-36.5, -24.5, 9, 19, {
    y: 0, h: 5.6, style: 'brick', roof: false,
    doors: [['w', 1, 2.2], ['e', -2.5, 2.2], ['s', 0, 2.2]],
    windows: [['e', -7, 1.6], ['n', 0, 1.8], ['w', -6, 1.4], ['w', 6, 1.4], ['s', 3, 1.4]],
  });
  b.box(-36.5, mb.h, -24.5, 9.4, 0.35, 19.4, 'slab');                    // roof (top 5.95)
  const roofTop = mb.h + 0.35;
  // Parapet for the roof snipers, open where the stairs land on the east side.
  b.box(-36.5, roofTop, -34.05, 9.4, 1, 0.3, 'brick');
  b.box(-36.5, roofTop, -14.95, 9.4, 1, 0.3, 'brick');
  b.box(-41.05, roofTop, -29.5, 0.3, 1, 8.8, 'brick');                      // west parapet, open over the ladder
  b.box(-41.05, roofTop, -19.5, 0.3, 1, 8.8, 'brick');
  b.box(-31.95, roofTop, -29.75, 0.3, 1, 8.3, 'brick');
  b.box(-31.95, roofTop, -19.1, 0.3, 1, 8.1, 'brick');
  // BeGone's ladder up the back, where the Militia deploys, plus a steel stair up the east face.
  b.ladder(-41.2, -24.5, g(-41.8, -24.5), roofTop, 0);
  b.stairs(-31, -19, 1.6, 8, 0, roofTop, 3);
  b.box(-31, roofTop - 0.35, -24, 1.6, 0.35, 2, 'steel');
  b.box(-30.3, 0, -24.9, 0.2, roofTop - 0.35, 0.2, 'steel');
  b.rail(-30.2, -23, -30.2, -25, roofTop);
  b.crate(-39.4, 0, -31.8, 1.5); b.crate(-39.4, 1.5, -31.8, 1.5); b.crate(-37.8, 0, -32.2, 1.5);
  b.crate(-34.2, 0, -17.2, 1.5, 1.2, 1.5);
  b.light(-31.7, 3.2, -27, 0xffc27a, 5, 12);
  for (let i = 0; i < 12; i++) b.spawn(1, i % 2 ? -44.5 : -48, 0, -33 + Math.floor(i / 2) * 3, -3 * Math.PI / 4);

  // ---- Tank platform beside the Militia building, and the L-shaped fence facing SWAT ----
  b.box(-25, 0, -10.5, 8, 1.2, 9, 'slab');
  b.stairs(-26, -16.3, 2.4, 2.6, 0, 1.2, 1);
  for (const z of [-12.8, -10.5, -8.2]) {
    for (const x of [-27.3, -22.7]) b.box(x, 1.2, z, 0.4, 0.3, 1.5, 'steel');
    b.cylinder(-25, 1.5, z, 1, 6.5, 'steel', 'x', TANK_WHITE);
    b.cylinder(-19.25, 1.95, z, 0.18, 4.5, 'steel', 'x');             // feed pipes out past the platform
    b.box(-17.6, 0, z, 0.2, 1.95, 0.2, 'steel');
  }
  b.box(-26, 0, -3.5, 9.2, 2.3, 0.15, 'roof');
  b.box(-21.4, 0, 1, 0.15, 2.3, 9, 'roof');
  for (const [x, z] of [[-30.6, -3.5], [-26, -3.5], [-21.4, -3.5], [-21.4, 1], [-21.4, 5.5]]) b.box(x, 0, z, 0.25, 2.4, 0.25, 'steel');

  // ---- Ammo house (A): a plank barn with holes in its corrugated roof ----
  const barn = b.bunker(10.75, -6.9, 17.5, 8.8, {
    y: 0, h: 4.2, style: 'wood', roof: false,
    doors: [['w', 0, 3], ['s', -4.5, 2.4], ['s', 5, 2.4], ['e', 1.5, 2]],
    windows: [['n', -5, 1.6], ['n', 0, 1.6], ['n', 5, 1.6]],
  });
  // Pitched roof, each slope broken by a hole you can see (and shoot) through.
  b.ramp(5.4, -9.1, 7.2, 4.4, barn.h, 5.6, 1, 'roof');
  b.ramp(15.1, -9.1, 9.2, 4.4, barn.h, 5.6, 1, 'roof');
  b.ramp(7.65, -4.7, 11.7, 4.4, barn.h, 5.6, 3, 'roof');
  b.ramp(17.35, -4.7, 4.7, 4.4, barn.h, 5.6, 3, 'roof');
  for (const x of [2.25, 19.25]) {                                      // stepped gable boards
    b.box(x, barn.h, -6.9, 0.3, 0.4, 6.2, 'wood');
    b.box(x, barn.h + 0.4, -6.9, 0.3, 0.5, 3.1, 'wood');
  }
  // The stairs at the back: up to the lower roof, then on up to the barn roof.
  b.box(21.5, 2.35, -9.9, 4, 0.25, 2.8, 'roof');
  for (const z of [-11.1, -8.7]) b.box(23.3, 0, z, 0.2, 2.35, 0.2, 'steel');
  b.stairs(22.5, -5.5, 2, 6, 0, 2.6, 3);
  b.stairs(21.5, -10.4, 3.8, 1.6, 2.6, 4.45, 2);
  b.point('A', 'Ammo House', 14.5, 0, -6.8, 6);
  b.ammoCrate(3.6, 0, -9.9);
  b.crate(6.2, 0, -9.6); b.crate(6.2, 1.5, -9.6); b.crate(7.7, 0, -9.8, 1.5, 1.2, 1.5);
  b.crate(8.8, 0, -4.2, 1.5); b.crate(17.7, 0, -9.7); b.crate(17.9, 1.5, -9.5, 1.2);
  b.crate(18, 0, -3.9, 1.5, 1.2, 1.5);
  b.light(1.6, 3.4, -6.9, 0xffc27a, 5, 12);

  // ---- Silo: a concrete cylinder with its ladder and a stair to its rim ----
  const silo = { x: 4, z: -23, r: 3.2, h: 7.5 };
  b.cylinder(silo.x, 0, silo.z, silo.r, silo.h, 'concrete');
  b.cylinder(silo.x, silo.h, silo.z, 1.3, 0.3, 'steel', 'y', 0x4a4a46);   // hatch
  b.box(silo.x, silo.h, silo.z - silo.r + 0.3, 2.6, 0.9, 0.25, 'slab');    // rim walls (open to the west stairs)
  for (const dx of [-0.95, 0.95]) b.box(silo.x + dx, silo.h, silo.z + silo.r - 0.3, 0.7, 0.9, 0.25, 'slab');   // open over the ladder
  b.box(silo.x + silo.r - 0.3, silo.h, silo.z, 0.25, 0.9, 2.6, 'slab');
  b.ladder(silo.x, silo.z + silo.r, g(silo.x, silo.z + silo.r + 0.6), silo.h, 3);   // the silo's own ladder, south side
  b.stairs(-0.35, -18.25, 1.9, 9.5, 0, silo.h, 3);
  b.box(0.3, silo.h - 0.35, -24, 3.2, 0.35, 2, 'steel');
  for (const z of [-24.85, -23.15]) b.box(-1.15, 0, z, 0.25, silo.h - 0.35, 0.25, 'steel');
  b.rail(-1.3, -23, -1.3, -24.8, silo.h);
  b.point('C', 'Silo', 10, 0, -21, 6);

  // ---- Between the silo and the Militia: the buried container, the log and crate stacks ----
  b.box(-12.5, -1.3, -19.5, 6.1, 2.6, 2.5, 'container');
  b.cylinder(-14.8, g(-14.8, -29.5) - 0.2, -29.5, 0.55, 8, 'wood', 'z', 0x6e5038);
  for (const [x, z] of [[-11.2, -1.4], [-11.6, 16.1]]) {
    b.crate(x - 0.8, g(x - 0.8, z) - 0.1, z, 1.5, 1.3, 1.5, RED_CRATE);
    b.crate(x + 0.8, g(x + 0.8, z) - 0.1, z, 1.5, 1.3, 1.5, RED_CRATE);
    b.crate(x, g(x, z) + 1.2, z, 1.5, 1.3, 1.5, RED_CRATE);
  }

  // ---- Broken house (west, by the fence): ammo inside, open on three sides, roof caved in ----
  const bh = b.bunker(-33.9, 11.75, 9, 14, {
    y: 0, h: 3.6, style: 'plaster', roof: false,
    doors: [['n', 1, 2.2], ['e', -2, 2.4], ['s', -1, 2.2]],
    windows: [['w', -3, 1.6], ['w', 3, 1.6], ['e', 4, 1.6]],
  });
  b.ramp(-36.25, 6.5, 4.7, 4, bh.h, 4.6, 0, 'roof');
  b.ramp(-36.25, 14.75, 4.7, 8.5, bh.h, 4.6, 0, 'roof');
  b.ramp(-31.55, 8.75, 4.7, 8.5, bh.h, 4.6, 2, 'roof');
  b.ramp(-31.55, 17.25, 4.7, 3.5, bh.h, 4.6, 2, 'roof');
  b.point('D', 'Broken House', -34, 0, 12, 5);
  b.ammoCrate(-36.8, 0, 17.2);
  b.crate(-36.6, 0, 7.4, 1.5, 1.2, 1.5); b.crate(-31.2, 0, 15.6, 1.5);
  for (const z of [7.5, 9.2, 10.9]) b.crate(-28.6, 0, z, 1.4, 1, 1.4, 0x8a6a4a);   // pallets by the east door
  // What fell through the caved-in roof: a sheet of iron and broken masonry.
  b.paint(b.box(-35.6, 0, 9.4, 2.6, 0.2, 1.6, 'roof'), 0x9a7a62);
  b.paint(b.box(-31.6, 0, 14.2, 1.2, 0.6, 0.9, 'plaster'), 0xc8c0b4);
  b.paint(b.box(-30.4, 0, 19.6, 1.4, 0.5, 1, 'plaster'), 0xc8c0b4);
  b.paint(b.box(-38.8, 0, 3.8, 1.1, 0.7, 1.2, 'plaster'), 0xc8c0b4);

  // ---- SWAT base (south-east): the gantry crane over the tank platform ----
  for (const z of [12.35, 35.1]) {
    b.box(11, 5.6, z, 41, 1.2, 2.6, 'steel');                                  // runway beams
    for (const x of [-8.6, 11, 30.6]) b.box(x, g(x, z) - 0.5, z, 1.3, 6.1 - g(x, z), 1.3, 'slab');
  }
  b.box(6.5, 6.8, 23.75, 0.25, 1.4, 25, 'steel');                               // the travelling bridge
  b.box(8.3, 6.8, 23.75, 0.25, 1.4, 25, 'steel');
  for (let z = 12.5; z < 35.5; z += 2.5) b.box(7.4, 6.8, z, 1.55, 0.2, 0.25, 'steel');
  b.box(7.4, 5.9, 23, 2.6, 0.9, 2.2, 'steel');                                 // hoist trolley
  b.box(17.2, 0, 22, 9.6, 4, 7.6, 'slab');                                     // tank platform (top 4)
  b.cylinder(16.6, 4.25, 20.6, 1.3, 6, 'steel', 'x', TANK_WHITE);
  for (const x of [14.4, 18.8]) b.box(x, 4, 20.6, 0.5, 0.3, 1.8, 'steel');
  b.box(20.6, 4, 23.6, 2.4, 2.4, 2.6, 'roof');                                 // pump shed
  b.box(17.2, 4, 18.35, 9.6, 1, 0.15, 'steel');                               // low walls for the platform snipers
  b.box(12.45, 4, 22, 0.15, 1, 7.6, 'steel');
  b.box(13.95, 4, 25.75, 3.1, 1, 0.15, 'steel');
  b.stairs(16.5, 28.8, 2, 6, 0, 4, 3);
  b.ladder(22, 20, g(22.6, 20), 4, 2);                                          // and a ladder up the east side
  b.rail(17.5, 25.8, 22, 25.8, 4);
  b.point('B', 'SWAT Base', 11.5, 0, 29, 6);
  b.crate(8, 0, 26.5, 1.5); b.crate(8, 1.5, 26.5, 1.5); b.crate(9.6, 0, 26.3, 1.5, 1.2, 1.5);
  b.crate(13.3, 0, 32.6, 1.5, 1.2, 1.5);
  b.ammoCrate(24.5, 0, 26.6);                                                  // the base crate, clear of the stairs
  b.light(20.6, 6.2, 22.2, 0xfff1d0, 5, 14);
  for (let i = 0; i < 12; i++) b.spawn(0, 20 + (i % 4) * 3, 0, 29 + Math.floor(i / 4) * 2.5, Math.PI / 4);

  // ---- The helicopter parked west of the SWAT yard: cover against round-start snipes ----
  b.paint(b.box(-3, 0.55, 21, 6.5, 2.3, 2.4, 'steel'), OLIVE);                 // fuselage
  b.box(0.95, 0.75, 21, 1.4, 1.7, 2.1, 'glass');                               // cockpit glazing
  b.paint(b.box(-9, 1.5, 21, 5.5, 0.7, 0.7, 'steel'), OLIVE);                  // tail boom
  b.paint(b.box(-11.4, 2.2, 21, 0.9, 1.6, 0.2, 'steel'), OLIVE);
  for (const z of [19.85, 22.15]) {
    b.box(-3, 0, z, 6.4, 0.15, 0.15, 'steel');                                  // skids
    for (const x of [-5, -1]) b.box(x, 0.15, z, 0.12, 0.4, 0.12, 'steel');
  }
  b.box(-3, 2.85, 21, 0.3, 0.55, 0.3, 'steel');
  b.box(-3, 3.4, 21, 12, 0.08, 0.35, 'steel');                                 // rotor
  b.box(-3, 3.4, 21, 0.35, 0.08, 12, 'steel');

  // ---- The fallen crane across the north-east corner: mast, jib, cab and scattered plates ----
  fallenGirder(b, 39.5, -5.5, 18, -27.5, 3, 2, 1.6);
  fallenGirder(b, 31, -30, 45.5, -3.5, 3, 1.6, 1.4);
  b.paint(b.box(41.6, g(41.6, -3.2) - 0.3, -3.2, 3.6, 3.1, 3.6, 'steel'), CRANE_CAB);
  b.box(44.6, g(44.6, -1) - 0.3, -1, 2.4, 1.9, 2.4, 'slab');                   // counterweight
  b.box(33.8, g(33.8, 1.5), 1.5, 2.8, 0.25, 2.2, 'steel');
  b.box(39.2, g(39.2, 4.6), 4.6, 1.4, 0.3, 1.8, 'steel');
  b.box(37.4, g(37.4, 8.6), 8.6, 3, 0.3, 1, 'steel');
  b.truss(38, g(38, 9.4) - 0.05, 9.4, 41.6, g(41.6, 12.6) - 0.05, 12.6, 1.4, 1.2, CRANE_RUST);       // a torn-off jib section
  b.point('E', 'Crane', 30, g(30, -9), -9, 6);

  // ---- Perimeter: plank fences west, north and south; rocky slopes east ----
  fence(b, -50.5, -38, -50.5, -5);
  fence(b, -50.5, -5, -42, -5);
  fence(b, -42, -5, -42, 37.5);
  fence(b, -50.5, -38, 30, -38);
  fence(b, -42, 37.5, 46, 37.5);
  const rocks: [number, number, number, number, number][] = [
    [47, -15, 3, 2.2, 3.6], [49, 4, 2.6, 1.8, 2.4], [46.5, 19, 3.2, 2.4, 2.8], [49.5, 31, 2.4, 1.6, 2.6],
    [41, -27, 2.8, 1.8, 2.2], [36, -34, 3.4, 2.4, 2.6], [24, -36, 2.2, 1.4, 2.4], [50, -26, 2.6, 2.2, 3],
  ];
  for (const [x, z, w, h, d] of rocks) {
    // Seat each rock on its lowest corner so none floats on the steep slopes.
    const low = Math.min(g(x - w / 2, z - d / 2), g(x + w / 2, z - d / 2), g(x - w / 2, z + d / 2), g(x + w / 2, z + d / 2));
    b.box(x, low - 0.3, z, w, g(x, z) + h - low + 0.3, d, 'rock');
  }

  // ---- Trees (broad, leafy) all over the plateau and just past the fences ----
  const trees: [number, number, number][] = [
    [-24, -27, 0.75], [-28.5, -21, 0.7], [-38.5, -1.5, 1.1], [-4.7, -11.5, 1.1], [5, -15, 0.9], [13, -15, 1],
    [23, -17, 1.1], [1.5, 4, 1.2], [17, 1, 1], [26, 6.5, 1.1], [-23, 15, 1], [-18.5, 12.5, 0.9],
    [-34, 24, 1], [-25, 24, 1.1], [-16, 24.5, 0.9], [38, 15.5, 1.1], [37, 30, 1], [44, 22, 1.2],
    [-20, -34, 1], [-6, -33, 1.1], [-46, 12, 1.2], [-47, 28, 1], [-55, -20, 1.3],
  ];
  for (const [x, z, s] of trees) b.tree(x, z, s, 1);

  return b.build();
}
