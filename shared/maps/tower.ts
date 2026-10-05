import { fbm, MapBuilder } from './builder';
import type { BlockStyle, MapDef } from './types';

/**
 * Tower: an original homage to BeGone's second map (geometry and art are our own). A dusk
 * freight depot on a hillside. Militia (team 1) deploys inside the derelict brick warehouse in
 * the north-west, whose broken Window opens onto the Catwalk; the catwalk runs east over the
 * containers, behind the long corrugated Roof building and on to the round brick Tower, where
 * SWAT (team 0) deploys in the fenced yard. Between them: the container field, the open-roofed
 * Ammo house on the west side, the Clockhouse in the south-west corner, the Fence and its
 * stacked crates, and a flank lane south of the low plank fence. Elimination only.
 *
 * Coordinates: +X east, +Z south, metres (BeGone's top-down at ~10 px per metre, shifted so the
 * play area is centred). Deliberately asymmetric, like the original.
 */
const HALF_X = 32, HALF_Z = 36;
/** Catwalk deck height; the Militia window sill and the tower's first landing share it. */
const CAT = 3.6;
const RUST = 0x7e4a30, YELLOW = 0xc9a227, GREY = 0x868c90, TYRE = 0x1e1e1e, WHITE = 0xdcd6c8;

type B = MapBuilder;
/** Door or window opening along a wall: [from, to, bottom, top] (top ≥ wall height means a full-height gap). */
type Gap = [number, number, number, number];

/** A straight wall along `axis` at `at`, from a0 to a1, with openings. */
function wall(b: B, axis: 'x' | 'z', at: number, a0: number, a1: number, y: number, h: number, t: number, style: BlockStyle, gaps: Gap[] = []) {
  const seg = (from: number, to: number, y0: number, y1: number) => {
    if (to - from < 0.05 || y1 - y0 < 0.05) return;
    if (axis === 'x') b.box((from + to) / 2, y + y0, at, to - from, y1 - y0, t, style);
    else b.box(at, y + y0, (from + to) / 2, t, y1 - y0, to - from, style);
  };
  let cursor = a0;
  for (const [g0, g1, bottom, top] of [...gaps].sort((p, q) => p[0] - q[0])) {
    seg(cursor, g0, 0, h);
    seg(g0, g1, 0, bottom);
    seg(g0, g1, Math.min(top, h), h);
    cursor = g1;
  }
  seg(cursor, a1, 0, h);
}

/** Four walls around x0..x1 × z0..z1 (centred on those lines), each with its own openings. */
function shell(b: B, x0: number, x1: number, z0: number, z1: number, y: number, h: number, t: number, style: BlockStyle,
  gaps: { n?: Gap[]; s?: Gap[]; w?: Gap[]; e?: Gap[] } = {}) {
  wall(b, 'x', z0, x0 - t / 2, x1 + t / 2, y, h, t, style, gaps.n);
  wall(b, 'x', z1, x0 - t / 2, x1 + t / 2, y, h, t, style, gaps.s);
  wall(b, 'z', x0, z0 + t / 2, z1 - t / 2, y, h, t, style, gaps.w);
  wall(b, 'z', x1, z0 + t / 2, z1 - t / 2, y, h, t, style, gaps.e);
}

/** Shipping container standing on y over x0..x1 × z0..z1. */
function container(b: B, x0: number, x1: number, z0: number, z1: number, y = 0) {
  b.box((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, 2.6, z1 - z0, 'container');
}

/** Plank fence between two points on one axis. */
function fence(b: B, x0: number, z0: number, x1: number, z1: number, h = 2.6) {
  b.box((x0 + x1) / 2, -0.1, (z0 + z1) / 2, Math.max(0.15, Math.abs(x1 - x0)), h + 0.1, Math.max(0.15, Math.abs(z1 - z0)), 'wood');
}

/** Painted steel post from the floor up to a deck. */
function post(b: B, x: number, y: number, z: number, top: number, color = GREY) {
  b.paint(b.box(x, y, z, 0.25, top - y, 0.25, 'steel'), color);
}

export function tower(): MapDef {
  const b = new MapBuilder({
    id: 'tower', name: 'Tower', region: 'HILLSIDE FREIGHT DEPOT',
    description: 'A derelict warehouse, a catwalk and the old brick tower, with containers between.',
    theme: 'dusk', halfX: HALF_X, halfZ: HALF_Z, seed: 13, roll: 0, ridge: 0,
    sun: { x: -0.62, y: 0.42, z: 0.45 },
    ground: (x, z) => {
      // The hole by the Militia window, dug through the warehouse floor.
      if (x >= -10 && x <= -8 && z >= -22 && z <= -20) return -1.5;
      // Flat yard; grassy hills roll up past the bounds, steepening into rock.
      const e = Math.max(Math.abs(x) - HALF_X, Math.abs(z) - HALF_Z);
      return e > 0 ? (e * 0.3 + e * e * 0.009) * (0.8 + 0.4 * fbm(x * 0.04, z * 0.04, 13)) : 0;
    },
  });
  b.buildTerrain(2);

  militiaWarehouse(b);
  roofBuilding(b);
  catwalk(b);
  brickTower(b);
  ammoHouse(b);
  clockhouse(b);
  yard(b);

  b.point('A', 'Window', -4.8, CAT, -18.6, 4);
  b.point('B', 'Tower', 12.5, 0, -2.5, 5);
  b.point('C', 'Containers', -5, 0, 7.5, 7);
  b.point('D', 'Ammo House', -21.5, 0, 7.5, 5);
  b.point('E', 'Clockhouse', -16.5, 0, 24, 5);
  return b.build();
}

/**
 * Militia base: a roofless brick warehouse. Inside, a yellow grated bridge runs along the south
 * wall from the broken Window, with a staircase down at each end; containers, a wire cage and an
 * overturned shelf give the nooks campers love, and the hole sits just inside the window.
 */
function militiaWarehouse(b: B) {
  // Slab floor with the hole left open.
  b.box(-17.5, 0, -23.5, 15, 0.25, 13, 'slab');
  b.box(-4.5, 0, -23.5, 7, 0.25, 13, 'slab');
  b.box(-9, 0, -26, 2, 0.25, 8, 'slab');
  b.box(-9, 0, -18.5, 2, 0.25, 3, 'slab');
  shell(b, -25, -1, -30, -17, 0, 8, 0.5, 'brick', {
    s: [[-24.6, -22.2, 0, 3], [-7, -2.5, CAT, 6.5]],          // south door, the Window
    w: [[-25, -22.4, 0, 3]],                                   // west entrance (the far side)
    e: [[-27, -24.6, 0, 3]],                                   // alley door
  });
  // Broken brickwork hanging over the window.
  b.box(-6.5, 5.9, -17, 0.9, 0.6, 0.5, 'brick');
  b.box(-3, 5.6, -17, 0.8, 0.9, 0.5, 'brick');
  // Grated bridge along the south wall (the window landing at its east end), stairs at both ends.
  b.box(-11.7, CAT - 0.25, -18.875, 20.6, 0.25, 3.25, 'floor');
  for (const x of [-18, -13.5, -6]) post(b, x, 0.25, -20.35, CAT - 0.25, YELLOW);
  b.ramp(-2.4, -23.5, 2, 6, 0.25, CAT, 1, 'stairs');
  b.ramp(-21, -23.5, 2, 6, 0.25, CAT, 1, 'stairs');
  b.rail(-20, -20.5, -3.4, -20.5, CAT);
  // Containers in an L along the north wall, the wire cage in the corner, the overturned shelf.
  container(b, -16, -9.8, -29.75, -27.35, 0.25);
  container(b, -18.4, -16, -29.75, -23.55, 0.25);
  for (const [x, z] of [[-24.6, -29.6], [-21.7, -29.6], [-18.8, -29.6], [-24.6, -27], [-21.7, -27], [-18.8, -27]]) b.paint(b.box(x, 0.25, z, 0.1, 2.4, 0.1, 'steel'), GREY);
  b.paint(b.box(-21.7, 2.55, -27, 5.9, 0.1, 0.1, 'steel'), GREY);
  b.paint(b.box(-21.7, 2.55, -29.6, 5.9, 0.1, 0.1, 'steel'), GREY);
  b.paint(b.box(-24.6, 2.55, -28.3, 0.1, 0.1, 2.5, 'steel'), GREY);
  b.paint(b.box(-22.9, 1.1, -27, 3.4, 0.08, 0.08, 'steel'), GREY);
  b.paint(b.box(-24.6, 1.1, -28.3, 0.08, 0.08, 2.5, 'steel'), GREY);
  b.box(-11, 0.25, -22.7, 4, 1.4, 0.6, 'wood');
  // Boxes stacked by the window staircase.
  b.crate(-4.6, 0.25, -25.5);
  b.crate(-4.6, 1.75, -25.5);
  b.crate(-4.6, 0.25, -27.2);
  // Rusted trusses under a roof that has lost most of its sheets.
  for (const x of [-21, -17, -13, -9, -5]) b.truss(x, 7.3, -29.75, x, 7.3, -17.25, 0.35, 0.7, RUST);
  b.box(-23, 8, -23.5, 4, 0.12, 13.4, 'roof');
  b.box(-15, 8, -26.75, 4, 0.12, 6.9, 'roof');
  b.box(-11, 8, -23.5, 4, 0.12, 13.4, 'roof');
  b.box(-3, 8, -20.25, 4, 0.12, 6.9, 'roof');
  b.light(-25.6, 3.4, -23.7, 0xffc27a, 4, 10);

  // Twelve slots on the ground floor, facing the window and the doors.
  const slots: [number, number][] = [
    [-14.8, -25.3], [-12.8, -25.3], [-10.8, -25.3], [-8.8, -25.3], [-6.8, -25.3],
    [-18.6, -19], [-16.4, -19], [-14.2, -19], [-12, -19], [-6.6, -19], [-4.6, -19], [-14.6, -21.7],
  ];
  for (const [x, z] of slots) b.spawn(1, x, 0.25, z, Math.PI);

  // West yard: the tyre stacks outside the base, a shed past the fence.
  for (const [x, z, h] of [[-27, -11.6, 1.2], [-26.1, -10.3, 0.9], [-27.3, -9.1, 1.2], [-25.9, -12.6, 0.6]]) b.cylinder(x, 0, z, 0.45, h, 'steel', 'y', TYRE);
  b.box(-30, 0, -29.3, 3, 2.8, 3.4, 'wood');
  b.box(-30, 2.8, -29.3, 3.6, 0.15, 4, 'roof');
}

/**
 * The Roof: a long brick building with a pitched corrugated roof between the bases. External
 * metal stairs climb from the catwalk onto its south end; campers lie up behind the ridge.
 */
function roofBuilding(b: B) {
  shell(b, 5, 13, -29, -9, 0, 5, 0.4, 'brick', {
    s: [[8, 10, 0, 2.8]],
    w: [[-26, -24, 1.2, 2.4], [-21, -19, 0, 2.8]],
    e: [[-24, -22, 1.2, 2.4], [-15, -13, 0, 2.8]],
  });
  for (const z of [-29, -9]) {
    b.box(9, 5, z, 8, 0.45, 0.4, 'brick');
    b.box(9, 5.45, z, 5.2, 0.45, 0.4, 'brick');
    b.box(9, 5.9, z, 2.4, 0.4, 0.4, 'brick');
  }
  b.ramp(6.9, -19, 4.2, 20.4, 5, 6.3, 0, 'roof');
  b.ramp(11.1, -19, 4.2, 20.4, 5, 6.3, 2, 'roof');
  b.ramp(6.3, -7.4, 1.4, 2.8, CAT, 5.46, 3, 'stairs');
  b.crate(6.2, 0, -27.5);
  b.crate(7.7, 0, -27.5);
  b.crate(6.2, 1.5, -27.5);
  b.crate(11.8, 0, -10.6);
  b.box(10.5, 0, -24, 1, 0.9, 3, 'wood');                     // workbench
  b.light(9, 3.2, -8.6, 0xffc27a, 4, 10);
  // Gas cylinders by the east door.
  for (const [x, z] of [[14.2, -16.8], [14.8, -17.4], [14.1, -17.7]]) b.cylinder(x, 0, z, 0.3, 1.5, 'steel', 'y', WHITE);
}

/**
 * The Catwalk: out of the Militia window, east over the containers, south along the back of the
 * Roof building and east again to the tower's first landing.
 */
function catwalk(b: B) {
  const y = CAT - 0.25;
  b.box(-1.45, y, -15.75, 12.1, 0.25, 2, 'floor');            // window landing and the exposed run
  b.box(3.6, y, -9.375, 2, 0.25, 10.75, 'floor');             // behind the Roof building
  b.box(9.05, y, -5, 8.9, 0.25, 2, 'floor');                  // on to the tower
  for (const [x, z] of [[0, -16.6], [0, -14.9], [4.4, -16.6], [2.75, -10], [2.75, -6.2], [8, -4.15], [12, -4.15]]) post(b, x, 0, z, y);
  b.rail(-7.5, -14.75, 2.6, -14.75, CAT);
  b.rail(-0.75, -16.75, 4.6, -16.75, CAT);
  b.rail(2.6, -14.75, 2.6, -4, CAT);
  b.rail(2.6, -4, 13.5, -4, CAT);
  b.rail(7, -6, 13.5, -6, CAT);
}

/**
 * The Tower: a round brick tower with a crow's nest under a tin canopy. A steel fire escape on
 * its north side (BeGone has a ladder) climbs from the catwalk landing in three flights; the
 * generator below is the jump-down hiding spot.
 */
function brickTower(b: B) {
  const cx = 18.5, cz = -1.5;
  b.cylinder(cx, 0, cz, 4.2, 0.35, 'concrete');
  b.cylinder(cx, 0, cz, 3, 11.7, 'brick');
  b.box(18, 11.7, cz, 9, 0.3, 8, 'floor');
  b.rail(13.5, 2.5, 22.5, 2.5, 12);
  b.rail(22.5, -5.5, 22.5, 2.5, 12);
  b.rail(13.5, -4, 13.5, 2.5, 12);
  b.rail(15.5, -5.5, 22.5, -5.5, 12);
  for (const [x, z] of [[13.7, -5.3], [22.3, -5.3], [13.7, 2.3], [22.3, 2.3]]) post(b, x, 12, z, 14.6, RUST);
  b.box(18, 14.6, cz, 9.6, 0.15, 8.6, 'roof');
  b.light(cx, 14.2, cz, 0xffc27a, 4, 12);
  // Fire escape: landing at catwalk height, three flights and two more landings.
  b.box(14.5, CAT - 0.25, -5.55, 2, 0.25, 3.1, 'floor');
  b.ramp(18, -6.15, 5, 1.9, CAT, 7.2, 0, 'stairs');
  b.box(21.5, 6.95, -7.1, 2, 0.25, 3.8, 'floor');
  b.ramp(18, -8.05, 5, 1.9, 7.2, 10.8, 2, 'stairs');
  b.box(14.5, 10.55, -8.05, 2, 0.25, 1.9, 'floor');
  b.ramp(14.5, -6.3, 2, 1.6, 10.8, 12, 1, 'stairs');
  post(b, 15.3, 0.35, -4.15, CAT - 0.25);
  post(b, 13.7, 0, -4.15, CAT - 0.25);
  post(b, 22.3, 0, -8.85, 6.95);
  post(b, 22.3, 0, -5.35, 6.95);
  post(b, 13.7, 0, -8.85, 10.55);
  b.rail(20.5, -9, 22.5, -9, 7.2);
  b.rail(22.5, -9, 22.5, -5.2, 7.2);
  b.rail(13.5, -9, 15.5, -9, 10.8);
  b.paint(b.box(17.3, 0, -10.6, 2.6, 2, 1.8, 'steel'), 0x5b6650);   // generator
  b.paint(b.box(17.3, 2, -10.6, 0.6, 0.5, 0.6, 'steel'), RUST);
}

/** Ammo house: plank walls under an open roof of slats you can see, shoot and throw through. */
function ammoHouse(b: B) {
  shell(b, -25, -18, 0, 15, 0, 3.4, 0.25, 'wood', {
    n: [[-23, -20.5, 0, 2.8]],
    s: [[-22.5, -20, 0, 2.8]],
    w: [[4, 6, 1.1, 2.2], [9, 11, 1.1, 2.2]],
    e: [[3, 5.5, 0, 2.8], [9.5, 12, 0, 2.8]],
  });
  for (let k = 0; k < 15; k++) b.box(-21.5, 3.4, k + 0.3, 7.6, 0.2, 0.6, 'wood');
  b.ammoCrate(-21.5, 0, 7.5);
  b.crate(-23.8, 0, 13.5);
  b.crate(-19.2, 0, 1.5);
}

/** Clockhouse: a plastered one-room house in the corner, windows on every side, the clock over the door. */
function clockhouse(b: B) {
  const windowsNS: Gap[] = [[-20.2, -18.6, 1.1, 2.3], [-17.6, -15.4, 0, 2.6], [-14.4, -12.8, 1.1, 2.3]];
  shell(b, -21, -12, 20.5, 27.5, 0, 4, 0.3, 'plaster', {
    n: windowsNS, s: windowsNS,
    w: [[22.2, 23.8, 1.1, 2.3], [24.6, 26.2, 1.1, 2.3]],
    e: [[24.6, 26.2, 1.1, 2.3]],
  });
  b.box(-16.5, 4, 24, 9.6, 0.25, 7.6, 'roof');
  b.cylinder(-16.5, 2.42, 20.31, 0.78, 0.06, 'steel', 'z', 0x2a2622);      // clock rim
  b.cylinder(-16.5, 2.5, 20.26, 0.7, 0.08, 'slab', 'z', 0xfaf7ee);
  b.paint(b.box(-16.5, 3.2, 20.19, 0.06, 0.55, 0.03, 'steel'), 0x1a1a1a);
  b.paint(b.box(-16.3, 3.17, 20.19, 0.4, 0.06, 0.03, 'steel'), 0x1a1a1a);
  b.crate(-19.8, 0, 26.2);
  b.crate(-13.2, 0, 21.8);
  b.light(-18.3, 2.6, 20.1, 0xffc27a, 4, 10);
}

/** Containers, fences, the SWAT yard and the backdrop. */
function yard(b: B) {
  // ---- Container field ----
  container(b, -21.6, -19.1, -15.5, -9.3);
  container(b, -11.7, -9.2, -15.5, -9.3);
  container(b, -8.7, -6.2, -15.5, -9.3);
  container(b, -5.7, -3.2, -15.5, -9.3);
  container(b, -11.4, -8.9, -8.6, -2.4);
  container(b, -15.3, -9.1, -1.2, 1.3);
  container(b, -8.4, -2.2, -2.2, 0.3);
  container(b, -13.7, -7.5, 3.4, 5.9);
  container(b, -7, -0.8, 2.6, 5.1);
  container(b, -0.3, 5.9, 2.2, 4.7);
  container(b, -13, -6.8, 10.4, 12.9);
  container(b, -6.6, -0.4, 9.6, 12.1);
  container(b, 0, 6.2, 8.8, 11.3);
  container(b, 8.8, 11.3, 1, 7.2);
  container(b, 12.8, 15.3, 6, 12.2);
  container(b, -8.4, -2.2, -2.2, 0.3, 2.6);                  // one stacked on top
  // Boxes added outside the Militia base, and steps up onto the containers.
  b.crate(-7.45, 0, -8.4);
  b.crate(-4.45, 0, -8.4);
  b.crate(-13.2, 0, -12);
  b.crate(-1.5, 0, -3.2);
  b.crate(-1.5, 1.5, -3.2);
  b.crate(-14.6, 0, 7.6);
  b.crate(3.2, 0, 6.6);

  // ---- SWAT yard: twelve slots south of the tower, facing north-west ----
  const slots: [number, number][] = [
    [20, 5], [22.2, 5], [24.4, 5], [26.6, 5],
    [18.5, 8.5], [20.7, 8.5], [22.9, 8.5], [25.1, 8.5],
    [16.5, 12], [18.5, 12], [20.5, 12], [22.5, 12],
  ];
  for (const [x, z] of slots) b.spawn(0, x, 0, z, Math.PI / 4);
  b.cylinder(23, 0, -14, 0.9, 3.2, 'steel', 'x', WHITE);       // tank by the fence
  b.crate(20.5, 0, 16.5);

  // ---- The curved yard fence (stepped), crates stacked at its north end ----
  fence(b, 13.2, -19.5, 28.2, -19.5);
  fence(b, 28.1, -19.5, 28.1, -14);
  fence(b, 28.1, -14, 30.1, -14);
  fence(b, 30.1, -14, 30.1, -5);
  fence(b, 29.1, -5, 30.1, -5);
  fence(b, 29.1, -5, 29.1, 5);
  fence(b, 27.1, 5, 29.1, 5);
  fence(b, 27.1, 5, 27.1, 11);
  fence(b, 24.1, 11, 27.1, 11);
  fence(b, 24.1, 11, 24.1, 23.3);
  fence(b, 24.1, 23.3, 32, 23.3);
  b.crate(26.8, 0, -18.4);
  b.crate(26.8, 1.5, -18.4);
  b.crate(25.2, 0, -18.4);

  // ---- The low plank fence in front of the south lane, crates at its east end ----
  fence(b, -12, 23.3, 16, 23.3, 1.4);
  b.crate(15, 0, 22.3);
  b.crate(15, 1.5, 22.3);
  b.crate(13.4, 0, 22.3);
  // South lane: containers as cover.
  container(b, -2.7, -0.2, 28.4, 34.6);
  container(b, 5.3, 11.5, 28.4, 30.9);
  container(b, 12.8, 19, 33, 35.5);
  b.crate(-6, 0, 30);
  b.crate(21.5, 0, 28.5);

  // ---- West side: the left fence, the yard fence by the shed, rocks behind the ammo house ----
  fence(b, -28.7, -14, -28.7, 3, 2.4);
  fence(b, -32, -14, -28.7, -14, 2.4);
  fence(b, -32, -27.5, -25.25, -27.5, 2.4);
  fence(b, -0.75, -29.5, 4.8, -29.5);
  for (let z = 4.5; z < 36; z += 3.5) b.box(-28.4, -0.3, z, 2.2, 2.9 + (z % 2), 3.8, 'rock');

  // ---- The warehouse front behind the Militia base (out of reach) ----
  b.box(1.5, 0, -40, 21, 9, 12, 'brick');
  b.box(1.5, 9, -40, 21.6, 0.3, 12.6, 'roof');
  b.box(1.5, 0, -33.95, 6, 4.5, 0.1, 'roof');
}
