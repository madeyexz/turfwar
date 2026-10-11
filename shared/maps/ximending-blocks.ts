import { C, TINTS, Ximen, type R, type Side } from './ximending-kit';
import { X, Z } from './ximending-plan';

/**
 * Ximending's ordinary blocks (ximending.ts): the walk-ups along the three lanes and the two
 * outer columns, the alleys that cut through them, and the paving and paint of the ground.
 * Lane, alley and gate centres sit on the bots' 2.5 m lattice.
 */

/** A building: footprint, storeys, tint, arcade side ('' for none), sides facing a street. */
type Bldg = [r: R, floors: number, tint: number, arcade: Side | '', street: string];

const [cream, salmon, grey, mint, blueGrey, white, tan, pink, ochre] = TINTS;

/** Row N, between the north sidewalk and lane N: fascias on the lane, the mall passage in the west. */
const ROW_N: Bldg[] = [
  [[-68, -50, -59, -37.5], 5, salmon, 's', 'nswe'], [[-54, -50, -47.5, -37.5], 4, cream, 's', 'nse'],
  [[-37.5, -50, -26, -37.5], 4, blueGrey, 's', 'nsw'],
  [[5, -50, 19, -37.5], 6, pink, 's', 'nsw'], [[19, -50, 37.5, -37.5], 4, mint, 's', 'nse'],
  [[47.5, -50, 68, -37.5], 5, tan, 's', 'nswe'],
];
/** Row S, between lane S and the south sidewalk (the Red House's plaza takes the middle). */
const ROW_S: Bldg[] = [
  [[-68, 37.5, -47.5, 50], 4, ochre, 'n', 'nswe'],
  [[5, 37.5, 22, 50], 4, white, 'n', 'nsw'], [[22, 37.5, 37.5, 50], 5, grey, 'n', 'nse'],
  [[47.5, 37.5, 68, 50], 4, salmon, 'n', 'nswe'],
];
/** Row NM, between lane N and lane M: the west flank of SWAT's plaza, the west and middle blocks, the east flank of the yard. */
const ROW_NM: Bldg[] = [
  [[-68, -27.5, -60, -15], 4, cream, '', 'nwse'], [[-55, -27.5, -47.5, -15], 4, grey, '', 'nse'],
  [[-37.5, -27.5, -21, -5], 5, salmon, 'n', 'nwse'], [[-16, -27.5, -5, -5], 4, mint, 'n', 'nswe'],
  [[47.5, -27.5, 57, -15], 4, tan, '', 'nws'], [[62, -27.5, 68, -15], 4, pink, '', 'nse'],
];
/** Row MS, between lane M and lane S. */
const ROW_MS: Bldg[] = [
  [[-68, 15, -60, 27.5], 4, tan, '', 'swne'], [[-55, 15, -47.5, 27.5], 4, mint, '', 'sne'],
  [[-37.5, 5, -33, 27.5], 5, pink, 's', 'nwse'], [[-28, 5, -5, 27.5], 4, cream, 's', 'nswe'],
  [[5, 5, 19, 27.5], 4, blueGrey, 's', 'nswe'],
  [[47.5, 15, 52, 27.5], 4, grey, '', 'nws'], [[57, 15, 68, 27.5], 4, ochre, '', 'nse'],
];

/** The passages through the blocks: the mall in the north-west and the two alleys beside the plazas. */
export const MALL: R = [-59, -50, -54, -37.5];

/** A shop partition across an arcade (騎樓) at the middle of its run, so a colonnade never gives a long view down its length. */
function partition(t: Ximen, r: R, side: Side, color: number) {
  const [x0, z0, x1, z1] = r, depth = 3.5, alongX = side === 'n' || side === 's';
  const len = alongX ? x1 - x0 : z1 - z0;
  if (len < 12) return;
  const mid = (alongX ? x0 + x1 : z0 + z1) / 2, at = side === 'n' ? z0 : side === 's' ? z1 - depth : side === 'w' ? x0 : x1 - depth;
  const wall: R = alongX ? [mid - 0.25, at, mid + 0.25, at + depth - 0.6] : [at, mid - 0.25, at + depth - 0.6, mid + 0.25];
  t.box(wall, 0, 3.0, 'painted', color);
  const out = alongX ? [mid, at + depth - 0.6] : [at + depth - 0.6, mid];
  void out;
}

export function streets(t: Ximen) {
  let seed = 1;
  const build = (list: Bldg[]) => {
    for (const [r, floors, tint, arcade, street] of list) {
      t.walkup(r, floors, tint, seed++, street, arcade || undefined);
      if (arcade) partition(t, r, arcade, 0xc8b8a0);
    }
  };
  build(ROW_N); build(ROW_S); build(ROW_NM); build(ROW_MS);
  // The mall's bridge: upper storeys over the passage.
  t.box([MALL[0], MALL[1], MALL[2], MALL[3]], 4.4, 20.2, 'facade', pink);
  t.shape([MALL[0], MALL[1] + 0.02, MALL[2], MALL[1] + 0.06], 3.9, 4.4, 'neon', 0xff4ad0);
  t.shape([MALL[0], MALL[3] - 0.06, MALL[2], MALL[3] - 0.02], 3.9, 4.4, 'neon', 0xff4ad0);
  t.sign('gate', (MALL[0] + MALL[2]) / 2, 3.2, MALL[3] + 0.08, Math.PI, 4.6, 0.8, '西門商場', '#14306a', '#ffd24a', 'XIMEN MALL');
  t.sign('gate', (MALL[0] + MALL[2]) / 2, 3.2, MALL[1] - 0.08, 0, 4.6, 0.8, '西門商場', '#14306a', '#ffd24a', 'XIMEN MALL');
  ground(t);
}

/** Paving: the lanes, plazas and sidewalks tiled; asphalt on the ring; road paint. */
function ground(t: Ximen) {
  const asphalt = 0x4a4c50;
  // The ring road: four asphalt bands, the corners joining them.
  t.floor([-81, -66, 81, -54], asphalt, 'asphalt', -0.03, 0.004);
  t.floor([-81, 54, 81, 66], asphalt, 'asphalt', -0.03, 0.004);
  t.floor([-81, -54, -72, 54], asphalt, 'asphalt', -0.03, 0.004);
  t.floor([72, -54, 81, 54], asphalt, 'asphalt', -0.03, 0.004);
  // Sidewalks along the ring, pale tiles.
  t.floor([-72, -54, 72, -50], 0xffffff, 'paving');
  t.floor([-72, 50, 72, 54], 0xffffff, 'paving');
  t.floor([-72, -50, -68, 50], 0xffffff, 'paving');
  t.floor([68, -50, 72, 50], 0xffffff, 'paving');
  // The pedestrian lanes and streets: warm tiles with a darker inlay down the middle.
  const lanes: R[] = [
    [-68, Z.laneN[0], 68, Z.laneN[1]], [-47.5, Z.laneM[0], 47.5, Z.laneM[1]], [-68, Z.laneS[0], 68, Z.laneS[1]],
    [X.stW[0], -50, X.stW[1], 50], [X.hanzhong[0], -50, X.hanzhong[1], 34], [X.stE[0], -50, X.stE[1], 50],
  ];
  for (const r of lanes) t.floor(r, 0xfff1dc, 'paving');
  for (const [x0, z0, x1, z1] of lanes) {
    const alongX = x1 - x0 > z1 - z0;
    t.shape(alongX ? [x0, (z0 + z1) / 2 - 0.45, x1, (z0 + z1) / 2 + 0.45] : [(x0 + x1) / 2 - 0.45, z0, (x0 + x1) / 2 + 0.45, z1], 0.012, 0.02, 'paving', 0xd8a070);
  }
  // The plazas: SWAT's station plaza (grey stone), the yard (poured concrete), the Red House's square (red brick).
  t.floor([-68, -15, -47.5, 15], 0xc9ccd0, 'tile', -0.02, 0.016);
  t.floor([47.5, -15, 68, 15], 0xa8a49c, 'slab', -0.02, 0.016);
  t.floor([-37.5, 34, 5, 50], 0xb8705a, 'cobble', -0.02, 0.016);
  // Alleys through the blocks.
  for (const r of [[-60, -27.5, -55, -15], [-60, 15, -55, 27.5], [57, -27.5, 62, -15], [52, 15, 57, 27.5], [-21, -27.5, -16, -5], [-33, 5, -28, 27.5]] as R[]) t.floor(r, 0xb4b0a8, 'slab');
  // The mall passage and the ring's lane lines.
  t.floor([-59, -50, -54, -37.5], 0xf0e8d8, 'tile');
  const mark = (x: number, z: number, w: number, d: number, color: number) => t.raw({ kind: 'marking', x, y: 0.02, z, w, d, color });
  for (let x = -78; x < 78; x += 6) { mark(x + 1.5, -60, 3, 0.15, 0xf0f0e8); mark(x + 1.5, 60, 3, 0.15, 0xf0f0e8); }
  for (let z = -48; z < 48; z += 6) { mark(-76.5, z + 1.5, 0.15, 3, 0xf0f0e8); mark(76.5, z + 1.5, 0.15, 3, 0xf0f0e8); }
  // Kerb paint and zebra crossings where the streets meet the ring.
  for (const [x0, x1] of [[-72, 72]]) { mark((x0 + x1) / 2, -54.1, x1 - x0, 0.12, 0xc8302a); mark((x0 + x1) / 2, 54.1, x1 - x0, 0.12, 0xc8302a); }
  for (const x of [-42.5, 0, 42.5]) for (let i = 0; i < 6; i++) { mark(x - 5 + i * 1.8 + 0.6, -56.2, 0.9, 3, 0xf0f0e8); mark(x - 5 + i * 1.8 + 0.6, 56.2, 0.9, 3, 0xf0f0e8); }
  void C;
}
