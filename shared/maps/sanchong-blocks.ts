import { ARCADE, LEVEE_X, TERRACE, TERRACE_Y } from './sanchong-plan';
import { C, SHOP, TINTS, Town, type R, type Side } from './sanchong-kit';

/**
 * Sanchong's ordinary blocks (sanchong.ts): the walk-ups along the main street (rows N and M, with
 * arcades), the blocks between the market and the alleys (row S), the old houses of the back
 * alleys, the buildings that close the west street, and what stands in the lanes: the delivery
 * van, the betel-nut kiosk, shop fronts built out into the arcades, utility poles. Lane and gate
 * centres sit on the bots' 2.5 m lattice.
 */

/** A building: footprint, storeys, tint, arcade side ('' for none), sides facing a street. */
type Bldg = [r: R, floors: number, tint: number, arcade: Side | '', street: string];

const [cream, salmon, grey, mint, blueGrey, white, tan, pink, ochre] = TINTS;

/** Row N, between the under-bridge lane (north) and the main street (south): arcades on the street. */
const ROW_N: Bldg[] = [
  [[-54, -53, -43, -44], 4, cream, 's', 'ns'], [[-43, -53, -32, -44], 5, salmon, 's', 'nse'],
  [[-28, -53, -17, -44], 4, mint, 's', 'nsw'], [[-17, -53, -4, -44], 5, grey, 's', 'nse'],
  [[26, -53, 35, -44], 4, blueGrey, 's', 'ns'], [[35, -53, 43, -44], 5, tan, 's', 'nse'], [[47, -53, 56, -44], 4, white, 's', 'nswe'],
];
/** Row M, between the main street (north, arcades) and the market (south); lanes at x = -40, 0 / 5 (a dog-leg) and 40. */
const ROW_M: Bldg[] = [
  [[-54, -36, -42, -21], 5, pink, 'n', 'nwe'], [[-54, -21, -42, -6.5], 4, grey, '', 'wes'],
  [[-38, -36, -26, -21], 4, ochre, 'n', 'nw'], [[-26, -36, -14, -21], 5, cream, 'n', 'n'], [[-14, -36, -2, -21], 4, salmon, 'n', 'ne'],
  [[-38, -21, -20, -6.5], 4, mint, '', 'ws'], [[-20, -21, -2, -6.5], 5, blueGrey, '', 'se'],
  [[-2, -18, 3, -6.5], 3, white, '', 'nes'],
  [[2, -36, 14, -22], 4, tan, 'n', 'nws'], [[14, -36, 24, -22], 5, pink, 'n', 'n'], [[24, -36, 38, -22], 4, cream, 'n', 'ne'],
  [[7, -22, 20, -6.5], 4, grey, '', 'nws'], [[20, -22, 38, -6.5], 5, salmon, '', 'es'],
  [[42, -36, 49, -21], 5, mint, 'n', 'nw'], [[49, -36, 56, -21], 4, ochre, 'n', 'ne'], [[42, -21, 56, -6.5], 4, blueGrey, '', 'wse'],
];
/** Row S, between the market (north) and the alleys (south); lanes at x = -30, -10 and 30. The ironworks are landmarks. */
const ROW_S: Bldg[] = [
  [[-54, 6.5, -43, 28], 4, cream, '', 'nws'], [[-43, 6.5, -32, 28], 5, salmon, '', 'nes'],
  [[-28, 6.5, -20, 28], 4, white, '', 'nw'], [[-20, 6.5, -12, 28], 4, pink, '', 'ne'],
  [[32, 6.5, 44, 28], 4, mint, '', 'nw'], [[44, 6.5, 56, 28], 5, tan, '', 'ne'],
];
/** The back alleys' old houses, two and three storeys. */
const HOUSES: Bldg[] = [
  [[-62, 32, -52, 47], 3, ochre, '', 'n'], [[-52, 32, -42, 47], 2, grey, '', 'n'], [[-42, 32, -32, 47], 3, tan, '', 'ne'],
  [[-28, 28, -20, 38], 3, pink, '', 'ws'], [[-20, 28, -12, 38], 2, mint, '', 'se'],
  [[-32, 42, -20, 47], 2, cream, '', 'n'], [[-20, 42, -8, 47], 3, tan, '', 'n'],
  [[4, 32, 16, 38], 3, white, '', 'ns'], [[16, 32, 28, 38], 2, salmon, '', 'nse'],
  [[32, 28, 44, 38], 3, cream, '', 'ws'], [[44, 28, 56, 38], 2, grey, '', 'se'],
  [[28, 42, 44, 47], 2, pink, '', 'n'], [[44, 42, 58, 47], 3, mint, '', 'n'], [[58, 42, LEVEE_X, 47], 2, cream, '', 'n'],
  // A small warehouse juts into the levee road (it breaks the road's long view).
  [[56, 22, 62, 32], 2, blueGrey, '', 'nes'],
];
/** West of the west street, and the car park's walls. */
const WEST: Bldg[] = [
  [[-76, -64, -62, -45], 5, grey, '', 'e'], [[-76, -45, -62, -28], 4, salmon, '', 'e'], [[-76, -28, -62, -12], 5, cream, '', 'es'],
  [[-76, 12, -62, 30], 4, mint, '', 'en'], [[-76, 30, -62, 47], 3, tan, '', 'e'],
];

export function streets(t: Town) {
  let seed = 1;
  const build = (list: Bldg[]) => {
    for (const [r, floors, tint, arcade, street] of list) {
      t.apartment(r, floors, tint, seed++, {
        ...(arcade ? { arcade: [arcade, ARCADE] as [Side, number] } : {}),
        street: [...street] as Side[], blades: arcade ? 2 : 1,
      });
    }
  };
  build(ROW_N); build(ROW_M); build(ROW_S); build(HOUSES); build(WEST);
  terraceHouse(t);
  ground(t);
  lanes(t);
}

/** The two-storey house in the alleys with a roof terrace: a ladder up its back from the shrine pocket. */
function terraceHouse(t: Town) {
  const [x0, z0, x1, z1] = TERRACE, y = TERRACE_Y;
  t.box(TERRACE, 0, y, 'facade', C.salmon);
  // Parapet (solid, chest high) and a tin canopy over half the terrace, on posts.
  // (The south side is open where the ladder arrives, at x = -5.)
  for (const p of [[x0, z0, x1, z0 + 0.25], [x0, z1 - 0.25, -5.65, z1], [-4.35, z1 - 0.25, x1, z1], [x0, z0 + 0.25, x0 + 0.25, z1 - 0.25], [x1 - 0.25, z0 + 0.25, x1, z1 - 0.25]] as R[]) t.box(p, y, y + 1.1, 'painted', C.cream);
  t.shape([x0 + 0.2, z0 + 0.2, x0 + 6, z1 - 0.2], y + 2.6, y + 2.68, 'roof', C.tinBlue);
  for (const [px, pz] of [[x0 + 0.4, z0 + 0.4], [x0 + 5.8, z0 + 0.4], [x0 + 0.4, z1 - 0.4], [x0 + 5.8, z1 - 0.4]]) t.box([px - 0.06, pz - 0.06, px + 0.06, pz + 0.06], y, y + 2.6, 'steel', C.iron);
  // Potted plants and a laundry rack (cover on the roof).
  t.box([x1 - 3.2, z0 + 0.5, x1 - 0.5, z0 + 1.2], y, y + 0.7, 'painted', 0x8a5a3a);
  for (let i = 0; i < 4; i++) t.shape([x1 - 3.1 + i * 0.68, z0 + 0.55, x1 - 2.6 + i * 0.68, z0 + 1.15], y + 0.7, y + 1.3, 'painted', 0x5a9a4a);
  t.box([x0 + 7, z1 - 2.2, x0 + 9.5, z1 - 1.9], y, y + 1.6, 'steel', C.steel);
  t.shape([x0 + 7, z1 - 2.3, x0 + 9.5, z1 - 1.8], y + 0.6, y + 1.5, 'painted', 0xe8e4f0);
  // Water tank on the canopy side.
  t.raw({ kind: 'cylinder', x: x0 + 2, y: y + 2.68, z: z0 + 2, radius: 0.6, height: 1.4, axis: 'y', style: 'painted', color: C.steel, sides: 12 });
  // The ladder up the back wall from the pocket (south face, z = z1), climbing north into the wall.
  t.b.ladder(-5, z1, 0, y, 3);
  t.shape([-5.6, z1, -4.4, z1 + 0.04], 0, 0.02, 'painted', C.iron);
}

/** Paving: the square, the arcades' fronts, the market, the alleys and the lots; road paint. */
function ground(t: Town) {
  // Concrete alleys and lanes (the terrain is asphalt; its sidewalk splat runs along every wall).
  t.shape([-62, 28, 56, 47], -0.02, 0.015, 'slab', 0xb4b0a8);
  t.shape([-42, -36, -38, -6.5], -0.02, 0.015, 'slab', 0xb4b0a8);
  t.shape([-2, -36, 2, -18], -0.02, 0.015, 'slab', 0xb4b0a8);
  t.shape([-2, -22, 7, -18], -0.02, 0.014, 'slab', 0xb4b0a8);
  t.shape([3, -18, 7, -6.5], -0.02, 0.015, 'slab', 0xb4b0a8);
  t.shape([38, -36, 42, -6.5], -0.02, 0.015, 'slab', 0xb4b0a8);
  t.shape([-32, -53, -28, -44], -0.02, 0.015, 'slab', 0xb4b0a8);
  t.shape([43, -53, 47, -44], -0.02, 0.015, 'slab', 0xb4b0a8);
  for (const x of [-32, -12, 28]) t.shape([x, 6.5, x + 4, 28], -0.02, 0.015, 'slab', 0xb4b0a8);
  // Main street: lane lines and the kerbs' red no-parking paint.
  const mark = (x: number, z: number, w: number, d: number, color: number) => t.raw({ kind: 'marking', x, y: 0.02, z, w, d, color });
  for (let x = -60; x < 12; x += 6) mark(x + 1.5, -40, 3, 0.15, 0xf0f0e8);
  for (let x = 28; x < 55; x += 6) mark(x + 1.5, -40, 3, 0.15, 0xf0f0e8);
  for (const [x0, x1] of [[-62, 14], [26, 56]]) { mark((x0 + x1) / 2, -43.9, x1 - x0, 0.12, 0xc8302a); mark((x0 + x1) / 2, -36.1, x1 - x0, 0.12, 0xc8302a); }
  // The levee road's centre line and the west street's.
  for (let z = -60; z < 40; z += 6) mark(64, z + 1.5, 0.15, 3, 0xf0d040);
  for (let z = -62; z < 30; z += 6) if (z < -14 || z > 12) mark(-58, z + 1.5, 0.15, 3, 0xf0f0e8);
  // A zebra crossing at the market's west mouth.
  for (let i = 0; i < 6; i++) mark(-58, -5 + i * 2, 6, 0.9, 0xf0f0e8);
}

/** What stands in the lanes: cover and the breaks in the long views. */
function lanes(t: Town) {
  // ---- Main street ----
  // Parked on the north side: a delivery van, and a pilgrims' tour bus (進香團) by the temple
  // square; between them on the south side the betel-nut kiosk (檳榔攤). They overlap across the
  // street, so no view runs its length.
  van(t, [-46, -43.6, -41, -41.1], 0xf0f0ec, true);
  tourBus(t, [-15.5, -43.6, -4.5, -41.1]);
  kiosk(t, [-30, -41.5, -26, -36.2], '檳榔', '#18a050');
  // Shop fronts built out into the arcades (騎樓 are rarely continuous).
  for (const [x0, x1, z0, z1, tint] of [[-22, -20, -47.5, -44, C.cream], [-20, -17, -36, -32.5, C.salmon], [5, 8, -36, -32.5, C.tan], [44, 47, -36, -32.5, C.mint]] as [number, number, number, number, number][]) {
    t.box([x0, z0, x1, z1], 0, SHOP, 'painted', tint);
    const face = z0 < -40 ? z1 : z0;
    t.shape([x0 + 0.15, face - 0.05, x1 - 0.15, face + 0.05], 0.2, 3.0, 'roof', 0xe8ecf0);
  }
  // Utility poles at the corners (concrete posts are cover; wires run between them).
  for (const [x, z] of [[-55, -44.5], [-29, -35.5], [-1, -44.5], [27, -35.5], [55, -35.5], [-31.5, 27.5], [-11.5, 32.5], [31.5, 32.5]]) t.pole(x, z);
  // Wires over the main street and its lanes, the alleys and the market's open ends.
  for (const x of [-50, -36, -24, -8, 30, 44, 52]) t.wires(false, x, -47.5, -32.5, 7.2 + (x % 3) * 0.2);
  t.wires(true, -40, -62, -54, 7.5); t.wires(true, -30, -54, -38, 7.8);
  for (const x of [-56, -44, -36, -20, -10, 2, 14, 24, 36, 48]) t.wires(false, x, 28, 32, 6 + (x % 4) * 0.15, 2);
  for (const x of [-26, -16, 0, 20, 40, 50]) t.wires(false, x, 38, 42, 6.2, 2);
  t.wires(true, 30, -62, -54, 6.8, 2); t.wires(true, -20, 28, 32, 6.4, 2); t.wires(false, -58, -6.5, 6.5, 7.6); t.wires(false, 50, -6.5, 6.5, 7.4);
  // ---- West street: buildings jut into it from alternate sides (a dog-leg) ----
  t.apartment([-58, -30, -54, -24], 2, C.ochre, 401, { street: ['w', 'n', 's'], addon: false });
  t.apartment([-62, 18, -58, 24], 2, C.blueGrey, 402, { street: ['e', 'n', 's'], addon: false });
  // ---- Alleys: crates, a water barrel, a parked tricycle cart, bins: knee-to-chest cover ----
  t.box([-48, 28.2, -46.4, 29.4], 0, 1.1, 'crate', 0xb08a5a);
  t.box([-38.8, 30.8, -37, 32], 0, 1.4, 'painted', 0x2f6aa8);
  t.box([-24, 38.2, -22.2, 39.4], 0, 1.2, 'painted', 0x3a7a3a);
  t.box([18, 30.6, 21.2, 32], 0, 1.3, 'wood', C.wood);
  t.box([40, 40.6, 42.5, 42], 0, 1.2, 'painted', 0x8a8a8a);
  t.box([50.5, 38, 52, 39.6], 0, 1.4, 'crate', 0xa07848);
  t.box([-56.5, 28.2, -55, 29.6], 0, 1.0, 'painted', 0x2f6aa8);
  // Laundry on bamboo poles across the alleys (decorative, out of reach).
  for (const [x, z0, z1] of [[-45, 28, 32], [-17, 38, 42], [36, 38, 42]] as [number, number, number][]) {
    t.shape([x - 0.03, z0, x + 0.03, z1], 3.4, 3.46, 'wood', 0xc8b080);
    for (let k = 0; k < 4; k++) t.shape([x - 0.02, z0 + 0.4 + k * 0.9, x + 0.02, z0 + 1.0 + k * 0.9], 2.6, 3.4, 'painted', [0xe8e0d0, 0x4a7ab8, 0xd84a4a, 0xf0d060][k]);
  }
}

/** A boxy van (cover): body, cab and windscreen. */
export function van(t: Town, r: R, color: number, alongX: boolean) {
  const [x0, z0, x1, z1] = r;
  t.box(r, 0.25, 2.3, 'painted', color);
  t.block([x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3], 0, 0.25, 'metal');
  // Wheels, a dark windscreen band at the cab end and a roof rack.
  const wheel = (u: number, v: number) => t.shape(alongX ? [u - 0.35, v - 0.12, u + 0.35, v + 0.12] : [v - 0.12, u - 0.35, v + 0.12, u + 0.35], 0, 0.7, 'painted', 0x1a1a1a);
  if (alongX) { for (const u of [x0 + 0.9, x1 - 0.9]) for (const v of [z0 - 0.02, z1 + 0.02]) wheel(u, v); t.shape([x1 - 0.02, z0 + 0.15, x1 + 0.02, z1 - 0.15], 1.3, 2.0, 'painted', 0x20262c); }
  else { for (const u of [z0 + 0.9, z1 - 0.9]) for (const v of [x0 - 0.02, x1 + 0.02]) wheel(u, v); t.shape([x0 + 0.15, z1 - 0.02, x1 - 0.15, z1 + 0.02], 1.3, 2.0, 'painted', 0x20262c); }
  t.shape([x0 + 0.4, z0 + 0.3, x1 - 0.4, z1 - 0.3], 2.3, 2.45, 'steel', C.iron);
}

/** A pilgrims' tour bus (進香團遊覽車) along x: body, dark windows, a banner and the temple flags on its roof. */
function tourBus(t: Town, r: R) {
  const [x0, z0, x1, z1] = r;
  t.box([x0, z0, x1, z1], 0.35, 3.3, 'painted', 0xf0ece4);
  t.block([x0 + 0.4, z0 + 0.3, x1 - 0.4, z1 - 0.3], 0, 0.35, 'metal');
  for (const z of [z0 - 0.02, z1 + 0.02]) {
    t.shape([x0 + 0.6, z - 0.02, x1 - 0.3, z + 0.02], 1.7, 2.8, 'painted', 0x1c2430);
    t.shape([x0, z - 0.02, x1, z + 0.02], 0.9, 1.25, 'painted', 0xc8321e);
    for (const x of [x0 + 1.5, x1 - 2.2]) t.shape([x - 0.5, z - 0.05, x + 0.5, z + 0.05], 0, 0.9, 'painted', 0x1a1a1a);
  }
  t.shape([x1 - 0.02, z0 + 0.2, x1 + 0.02, z1 - 0.2], 1.4, 2.9, 'painted', 0x1c2430);
  t.sign('board', (x0 + x1) / 2, 2.25, z1 + 0.06, Math.PI, 5.5, 0.8, '神農宮進香團', '#c8141e', '#ffe08a');
  t.sign('board', (x0 + x1) / 2, 2.25, z0 - 0.06, 0, 5.5, 0.8, '神農宮進香團', '#c8141e', '#ffe08a');
  for (let i = 0; i < 4; i++) t.shape([x0 + 1.5 + i * 2.6, (z0 + z1) / 2 - 0.03, x0 + 1.56 + i * 2.6, (z0 + z1) / 2 + 0.03], 3.3, 5.0, 'steel', C.iron);
  for (let i = 0; i < 4; i++) t.shape([x0 + 1.56 + i * 2.6, (z0 + z1) / 2 - 0.02, x0 + 2.4 + i * 2.6, (z0 + z1) / 2 + 0.02], 4.2, 4.95, 'painted', [0xf0c020, 0xc8141e, 0x2a6ab8, 0x2a9a5a][i]);
}

/** A betel-nut kiosk (檳榔攤): a glass box with neon trim and a lit sign. */
export function kiosk(t: Town, r: R, text: string, bg: string) {
  const [x0, z0, x1, z1] = r;
  t.box([x0, z0, x1, z1], 0, 0.9, 'painted', 0xe8e8e0);
  t.box([x0 + 0.05, z0 + 0.05, x1 - 0.05, z1 - 0.05], 0.9, 2.5, 'painted', 0x3a5058);
  t.box([x0 - 0.1, z0 - 0.1, x1 + 0.1, z1 + 0.1], 2.5, 2.75, 'painted', 0x18a050);
  t.shape([x0 - 0.12, z0 - 0.12, x1 + 0.12, z0 - 0.08], 2.52, 2.6, 'neon', 0xff4ad0);
  t.shape([x0 - 0.12, z1 + 0.08, x1 + 0.12, z1 + 0.12], 2.52, 2.6, 'neon', 0x4affd0);
  t.sign('board', (x0 + x1) / 2, 3.15, z1 + 0.05, Math.PI, x1 - x0, 0.75, text, bg, '#ffffff');
  t.sign('board', (x0 + x1) / 2, 3.15, z0 - 0.05, 0, x1 - x0, 0.75, text, bg, '#ffffff');
  t.box([x0, z0 - 0.02, x1, z1 + 0.02], 2.75, 3.55, 'painted', 0x14181c);
}
