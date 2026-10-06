import type { MapBuilder } from './builder';
import type { Keep, Shift } from './taipei-decor';
import type { BlockStyle, SignStyle } from './types';

/**
 * Cover and climbable structures for Ximending (a gameplay layer over the source's district, like
 * taipei-interiors.ts): the source's pedestrian streets run straight and bare between the blocks,
 * so most fights were long open sightlines. This adds the street life of a Taipei evening, placed
 * so every long street is broken up, each base has covered ways out and both bomb sites have
 * cover to attack and hold:
 *   - a night market (西門夜市) under a tarp roof on Wuchang St between Cinema Street (A) and the
 *     arcade (B), its stalls staggered so no aisle runs straight through;
 *   - a construction site at the north end of Xining S. Rd (SWAT's middle exit): a two-level
 *     scaffold with stairs, a covered walkway under it and hoarding;
 *   - a two-storey container site office with a porch stair and a roof ladder on Hanzhong St
 *     (SWAT's east exit toward B);
 *   - a temple stage (廟口戲台) with an altar on the Hanzhong / Emei crossing (the Emei St stage);
 *   - street cover everywhere else: food carts, crate stacks, delivery vans and a box truck,
 *     newspaper and ticket kiosks, jersey barriers, planters, poster boxes and a roadwork pit.
 * The compact map's own layer (taipei-compact.ts: bases, ring road, passages) builds the
 * frontages along the ring road with the same kit, which is exported for it.
 *
 * Placement follows the bots' navigation grid (nodes every 2.5 m: source x -881 + 2.5i,
 * z -305 + 2.5j): obstacles fill whole cells between the node lines (`cells`), so every aisle left
 * between them keeps a line of nodes and the bots walk the new cover paths.
 *
 * Coordinates are the source's (+x east, +z south, metres). The kit collects boxes (map
 * coordinates) where the source's street dressing must not stand, for streetFurniture's `clear`.
 */
export type Rect = [x0: number, z0: number, x1: number, z1: number];
export type Side = 'n' | 's' | 'e' | 'w';
export const KERB = 0.15;
/** Nav node column / row in source coordinates. */
export const NX = (i: number) => -881 + 2.5 * i, NZ = (j: number) => -305 + 2.5 * j;
/** The nav cells i0..i1 × j0..j1, less an inset on every side. */
export const cells = (i0: number, i1: number, j0: number, j1: number, inset = 0.15): Rect =>
  [NX(i0) - 1.25 + inset, NZ(j0) - 1.25 + inset, NX(i1) + 1.25 - inset, NZ(j1) + 1.25 - inset];
/** Clamp a rect's sides to facade lines (pass undefined to keep a side). */
export const clampTo = (r: Rect, x0?: number, z0?: number, x1?: number, z1?: number): Rect =>
  [x0 ?? r[0], z0 ?? r[1], x1 ?? r[2], z1 ?? r[3]];
/** Sign facing: rotY for a sign read from the given side (0 faces north). */
export const FACE: Record<Side, number> = { n: 0, e: Math.PI / 2, s: Math.PI, w: -Math.PI / 2 };

export const C = {
  tarpBlue: 0x2f6f9f, tarpRed: 0xb8322a, tarpYellow: 0xe0b23a, tarpGreen: 0x3a8a5a, white: 0xf2f0ea,
  steel: 0xb8bcc0, dark: 0x1c1c1e, wood: 0x8a5a3a, red: 0xa81c1c, gold: 0xe8b84a, orange: 0xe8641c,
  netting: 0x2f7d4f, hoarding: 0xdfe6e0, concrete: 0xb4b2aa, container: 0x2f5d8a, bus: 0xeceae2,
};
export const CANOPIES = [C.tarpRed, C.tarpBlue, C.tarpYellow, C.tarpGreen, 0xd8602a, 0x7a4aa0];
const GOODS = [0xe8c070, 0xc8402a, 0x5aa040, 0xf0e0b0, 0x8a4a2a, 0xe87aa0];
export const CRATES = [0xffffff, 0xc84a3a, 0x3a6ab8, 0xd8b040, 0x4a9a5a];
export const FOOD: [string, string][] = [
  ['雞排', 'FRIED CHICKEN'], ['珍珠奶茶', 'BUBBLE TEA'], ['臭豆腐', 'STINKY TOFU'], ['蚵仔煎', 'OYSTER OMELETTE'],
  ['大腸包小腸', 'SAUSAGE ROLL'], ['烤玉米', 'GRILLED CORN'], ['地瓜球', 'SWEET POTATO BALLS'], ['胡椒餅', 'PEPPER BUNS'],
  ['滷味', 'LUWEI'], ['刈包', 'GUA BAO'], ['鹽酥雞', 'POPCORN CHICKEN'], ['芒果冰', 'MANGO ICE'],
  ['甘蔗汁', 'SUGARCANE JUICE'], ['車輪餅', 'WHEEL CAKES'], ['麻糬', 'MOCHI'], ['水煎包', 'PAN BUNS'],
];

export class Kit {
  readonly clear: number[] = [];
  private n = 0;
  constructor(readonly b: MapBuilder, readonly s: Shift, private keep: Keep, private lanes: Rect[] = []) {}
  /** Deterministic pick (the same on every client and the server). */
  pick<T>(list: T[]) { return list[(this.n++ * 7 + 3) % list.length]; }

  box(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, style: BlockStyle, color?: number) {
    const i = this.b.box(this.s.X((x0 + x1) / 2), y0, this.s.Z((z0 + z1) / 2), x1 - x0, y1 - y0, z1 - z0, style);
    if (color !== undefined && style !== 'invisible') this.b.paint(i, color);
    return i;
  }
  shape(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, style: BlockStyle, color?: number) {
    this.b.shape(this.s.X((x0 + x1) / 2), y0, this.s.Z((z0 + z1) / 2), x1 - x0, y1 - y0, z1 - z0, style, color);
  }
  /** Visual cylinder resting on y (upright, or lying along x/z). */
  cyl(x: number, y: number, z: number, r: number, len: number, axis: 'x' | 'y' | 'z', style: BlockStyle, color?: number, sides?: number) {
    this.b.raw({ kind: 'cylinder', x: this.s.X(x), y, z: this.s.Z(z), radius: r, height: len, axis, style, ...(color === undefined ? {} : { color }), ...(sides ? { sides } : {}) });
  }
  ball(x: number, y: number, z: number, r: number, style: BlockStyle, color?: number) {
    this.b.raw({ kind: 'ball', x: this.s.X(x), y, z: this.s.Z(z), radius: r, style, ...(color === undefined ? {} : { color }) });
  }
  sign(style: SignStyle, x: number, y: number, z: number, face: number, w: number, h: number, text: string, bg: string, fg: string, sub = '') {
    this.b.raw({ kind: 'sign', style, x: this.s.X(x), y, z: this.s.Z(z), rotY: face, w, h, text, bg, fg, ...(sub ? { sub } : {}) });
  }
  /** Stairs over a rect, from y0 to y1, rising toward dir (0 +x, 1 +z, 2 -x, 3 -z). */
  stairs([x0, z0, x1, z1]: Rect, y0: number, y1: number, dir: 0 | 1 | 2 | 3) {
    this.b.stairs(this.s.X((x0 + x1) / 2), this.s.Z((z0 + z1) / 2), x1 - x0, z1 - z0, y0, y1, dir);
  }
  ladder(x: number, z: number, y0: number, y1: number, dir: 0 | 1 | 2 | 3, width = 0.9) { this.b.ladder(this.s.X(x), this.s.Z(z), y0, y1, dir, width); }
  crate(x: number, y: number, z: number, w: number, h = w, d = w, color?: number) {
    return this.b.crate(this.s.X(x), y, this.s.Z(z), w, h, d, color);
  }
  /** Keep the street dressing (and its colliders) out of a rect. */
  claim([x0, z0, x1, z1]: Rect, pad = 0.1) {
    this.clear.push(this.s.X(x0) - pad, 0.02, this.s.Z(z0) - pad, this.s.X(x1) + pad, 3, this.s.Z(z1) + pad);
  }
  /** True when a rect stays clear of the spawns, ammo crates, vehicle spots and drive lanes. */
  free([x0, z0, x1, z1]: Rect) {
    const a = this.s.X(x0), c = this.s.X(x1), d = this.s.Z(z0), e = this.s.Z(z1);
    if (this.lanes.some(([lx0, lz0, lx1, lz1]) => x1 > lx0 && x0 < lx1 && z1 > lz0 && z0 < lz1)) return false;
    return !this.keep.some(([x, z, r]) => x > a - r && x < c + r && z > d - r && z < e + r);
  }
}

// ---- Street pieces ------------------------------------------------------------------------

/**
 * A market stall over a rect, its counter on the `face` side: a counter-high front, a body up to
 * 2.25 m behind it (full cover), a striped canopy over the front, its name board and a lamp strip.
 */
export function stall(k: Kit, r: Rect, face: Side, y = KERB) {
  const [x0, z0, x1, z1] = r, canopy = k.pick(CANOPIES), [name, sub] = k.pick(FOOD);
  const depthX = face === 'e' || face === 'w', front = 0.7;
  // Front counter strip and the body behind it.
  const counter: Rect = face === 'n' ? [x0, z0, x1, z0 + front] : face === 's' ? [x0, z1 - front, x1, z1] : face === 'w' ? [x0, z0, x0 + front, z1] : [x1 - front, z0, x1, z1];
  const body: Rect = face === 'n' ? [x0, z0 + front, x1, z1] : face === 's' ? [x0, z0, x1, z1 - front] : face === 'w' ? [x0 + front, z0, x1, z1] : [x0, z0, x1 - front, z1];
  k.box(...counter, y, y + 1.0, 'wood', C.wood);
  k.box(...body, y, y + 2.25, 'painted', 0xe8e4da);
  // A tarp side panel at one end, so no one sees down a row of stalls over the counters.
  if (depthX) k.box(x0, z0, x1, z0 + 0.06, y + 1.0, y + 2.25, 'painted', canopy);
  else k.box(x0, z0, x0 + 0.06, z1, y + 1.0, y + 2.25, 'painted', canopy);
  stallDressing(k, r, face, y, canopy, name, sub, depthX);
  k.claim(r);
}

function stallDressing(k: Kit, [x0, z0, x1, z1]: Rect, face: Side, y: number, canopy: number, name: string, sub: string, depthX: boolean) {
  const over = 0.8;
  // Canopy over the stall and out over its front, in stripes.
  const cx0 = face === 'w' ? x0 - over : x0, cx1 = face === 'e' ? x1 + over : x1, cz0 = face === 'n' ? z0 - over : z0, cz1 = face === 's' ? z1 + over : z1;
  const stripes = 5;
  for (let i = 0; i < stripes; i++) {
    const t0 = i / stripes, t1 = (i + 1) / stripes, color = i % 2 ? C.white : canopy;
    if (depthX) k.shape(cx0, cz0 + (cz1 - cz0) * t0, cx1, cz0 + (cz1 - cz0) * t1, y + 2.3, y + 2.4, 'painted', color);
    else k.shape(cx0 + (cx1 - cx0) * t0, cz0, cx0 + (cx1 - cx0) * t1, cz1, y + 2.3, y + 2.4, 'painted', color);
  }
  // Lamp strip under the canopy's front edge, goods on the counter, the name board above.
  const fx = face === 'w' ? cx0 : face === 'e' ? cx1 : (x0 + x1) / 2, fz = face === 'n' ? cz0 : face === 's' ? cz1 : (z0 + z1) / 2;
  const along = depthX ? z1 - z0 : x1 - x0;
  if (depthX) k.shape(fx - 0.04, z0 + 0.1, fx + 0.04, z1 - 0.1, y + 2.22, y + 2.28, 'neon', 0xfff0c0);
  else k.shape(x0 + 0.1, fz - 0.04, x1 - 0.1, fz + 0.04, y + 2.22, y + 2.28, 'neon', 0xfff0c0);
  const cxF = face === 'w' ? x0 + 0.35 : face === 'e' ? x1 - 0.35 : 0, czF = face === 'n' ? z0 + 0.35 : face === 's' ? z1 - 0.35 : 0;
  for (let i = 0; i < 3; i++) {
    const t = (i + 0.5) / 3, h = 0.12 + (i % 2) * 0.12, c = GOODS[(i * 5 + Math.round(x0 * 3)) % GOODS.length];
    if (depthX) { const z = z0 + (z1 - z0) * t; k.shape(cxF - 0.22, z - 0.25, cxF + 0.22, z + 0.25, y + 1.0, y + 1.0 + h, 'painted', c); }
    else { const x = x0 + (x1 - x0) * t; k.shape(x - 0.25, czF - 0.22, x + 0.25, czF + 0.22, y + 1.0, y + 1.0 + h, 'painted', c); }
  }
  const bg = `#${canopy.toString(16).padStart(6, '0')}`;
  k.sign('board', fx + (face === 'w' ? -0.02 : face === 'e' ? 0.02 : 0), y + 2.68, fz + (face === 'n' ? -0.02 : face === 's' ? 0.02 : 0), FACE[face], Math.min(along - 0.2, 2.6), 0.5, name, bg, '#ffffff', sub);
  // The name board's frame (it stands on the canopy).
  if (depthX) k.shape(fx - 0.03 * (face === 'w' ? -1 : 1), z0 + 0.15, fx, z1 - 0.15, y + 2.4, y + 2.95, 'painted', C.dark);
  else k.shape(x0 + 0.15, fz, x1 - 0.15, fz + 0.03 * (face === 'n' ? 1 : -1), y + 2.4, y + 2.95, 'painted', C.dark);
}

/** A row of stalls splitting a rect along its length (all facing one way). */
export function stalls(k: Kit, [x0, z0, x1, z1]: Rect, face: Side, n: number, y = KERB) {
  const alongX = face === 'n' || face === 's', len = alongX ? x1 - x0 : z1 - z0, gap = 0.1, w = (len - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const a = (alongX ? x0 : z0) + i * (w + gap);
    stall(k, alongX ? [a, z0, a + w, z1] : [x0, a, x1, a + w], face, y);
  }
}

/** A double-sided stall island: counters on both long faces, a shared kitchen core between them. */
export function island(k: Kit, r: Rect, depthAxis: 'x' | 'z', y = KERB) {
  const [x0, z0, x1, z1] = r, front = 0.7;
  if (depthAxis === 'z') {
    k.box(x0, z0, x1, z0 + front, y, y + 1.0, 'wood', C.wood);
    k.box(x0, z1 - front, x1, z1, y, y + 1.0, 'wood', C.wood);
    k.box(x0, z0 + front, x1, z1 - front, y, y + 2.25, 'painted', 0xe8e4da);
    const zm = (z0 + z1) / 2, a = k.pick(FOOD), c = k.pick(FOOD), ca = k.pick(CANOPIES);
    k.box(x0, z0, x0 + 0.06, z1, y + 1.0, y + 2.25, 'painted', ca);
    stallDressing(k, [x0, z0, x1, zm], 'n', y, ca, a[0], a[1], false);
    stallDressing(k, [x0, zm, x1, z1], 's', y, ca, c[0], c[1], false);
  } else {
    k.box(x0, z0, x0 + front, z1, y, y + 1.0, 'wood', C.wood);
    k.box(x1 - front, z0, x1, z1, y, y + 1.0, 'wood', C.wood);
    k.box(x0 + front, z0, x1 - front, z1, y, y + 2.25, 'painted', 0xe8e4da);
    const xm = (x0 + x1) / 2, a = k.pick(FOOD), c = k.pick(FOOD), ca = k.pick(CANOPIES);
    k.box(x0, z0, x1, z0 + 0.06, y + 1.0, y + 2.25, 'painted', ca);
    stallDressing(k, [x0, z0, xm, z1], 'w', y, ca, a[0], a[1], true);
    stallDressing(k, [xm, z0, x1, z1], 'e', y, ca, c[0], c[1], true);
  }
  k.claim(r);
}

/** A food cart (waist-high cover) under a market umbrella. */
export function cart(k: Kit, x: number, z: number, along: 'x' | 'z', y = KERB) {
  const hw = along === 'x' ? 0.9 : 0.45, hd = along === 'x' ? 0.45 : 0.9, r: Rect = [x - hw, z - hd, x + hw, z + hd];
  if (!k.free(r)) return;
  const color = k.pick([0xc83a2a, 0x2a6ab0, 0xe0a030, 0x3a8a5a]);
  k.box(x - hw, z - hd, x + hw, z + hd, y, y + 1.05, 'painted', color);
  k.shape(x - hw + 0.08, z - hd + 0.08, x + hw - 0.08, z + hd - 0.08, y + 1.05, y + 1.45, 'glass');
  k.shape(x - hw, z - hd, x + hw, z + hd, y + 1.45, y + 1.5, 'painted', C.white);
  for (const s of [-1, 1]) {
    if (along === 'x') k.cyl(x + s * 0.55, y, z + hd + 0.02, 0.2, 0.08, 'z', 'painted', C.dark);
    else k.cyl(x + hw + 0.02, y, z + s * 0.55, 0.2, 0.08, 'x', 'painted', C.dark);
  }
  k.shape(x - 0.03, z - 0.03, x + 0.03, z + 0.03, y + 1.5, y + 2.35, 'steel', C.steel);
  k.b.disc(k.s.X(x), y + 2.35, k.s.Z(z), 0, 1, 0, 1.15, 1.15, 0.05, 'painted', k.pick(CANOPIES));
  k.claim(r);
}

/** Crates: two side by side along an axis, a third on top when tall (a step up, or full cover). */
export function crates(k: Kit, x: number, z: number, along: 'x' | 'z', tall: boolean, y = KERB, size = 1.1) {
  const off = size / 2 + 0.02, r: Rect = along === 'x' ? [x - size - 0.02, z - size / 2, x + size + 0.02, z + size / 2] : [x - size / 2, z - size - 0.02, x + size / 2, z + size + 0.02];
  if (!k.free(r)) return;
  const [ax, az] = along === 'x' ? [x - off, z] : [x, z - off], [bx, bz] = along === 'x' ? [x + off, z] : [x, z + off];
  k.crate(ax, y, az, size, size, size, k.pick(CRATES));
  k.crate(bx, y, bz, size, size, size, k.pick(CRATES));
  if (tall) k.crate(ax, y + size, az, size - 0.1, size - 0.1, size - 0.1, k.pick(CRATES));
  k.claim(r);
}

/** A newspaper / lottery kiosk over a rect, serving from its `face` side. */
export function kiosk(k: Kit, r: Rect, face: Side, text: string, sub: string, color = 0x2a7a4a, y = KERB) {
  if (!k.free(r)) return;
  const [x0, z0, x1, z1] = r;
  k.box(x0, z0, x1, z1, y, y + 2.35, 'painted', color);
  k.shape(x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3, y + 2.35, y + 2.5, 'painted', C.white);
  // Serving window and racks of papers and magazines on the front.
  const depthX = face === 'e' || face === 'w', o = face === 'w' || face === 'n' ? -0.04 : 0.04;
  const fx = face === 'w' ? x0 : x1, fz = face === 'n' ? z0 : z1;
  for (let row = 0; row < 3; row++) {
    const yy = y + 0.35 + row * 0.32;
    for (let i = 0; i < 4; i++) {
      const c = GOODS[(row * 4 + i) % GOODS.length];
      if (depthX) { const a = z0 + 0.15 + i * (z1 - z0 - 0.3) / 4; k.shape(fx + (o < 0 ? o * 3 : 0), a, fx + (o > 0 ? o * 3 : 0), a + (z1 - z0 - 0.3) / 4 - 0.06, yy, yy + 0.26, 'painted', c); }
      else { const a = x0 + 0.15 + i * (x1 - x0 - 0.3) / 4; k.shape(a, fz + (o < 0 ? o * 3 : 0), a + (x1 - x0 - 0.3) / 4 - 0.06, fz + (o > 0 ? o * 3 : 0), yy, yy + 0.26, 'painted', c); }
    }
  }
  if (depthX) k.shape(fx + (o < 0 ? o : 0), z0 + 0.3, fx + (o > 0 ? o : 0), z1 - 0.3, y + 1.4, y + 2.1, 'glass');
  else k.shape(x0 + 0.3, fz + (o < 0 ? o : 0), x1 - 0.3, fz + (o > 0 ? o : 0), y + 1.4, y + 2.1, 'glass');
  const w = (depthX ? z1 - z0 : x1 - x0) + 0.4;
  k.sign('board', depthX ? fx + o * 8 : (x0 + x1) / 2, y + 2.75, depthX ? (z0 + z1) / 2 : fz + o * 8, FACE[face], w, 0.45, text, '#c8141a', '#ffffff', sub);
  k.claim(r);
}

/** Concrete jersey barriers (crouch cover) along a rect, in segments of at most 3 m. */
export function jersey(k: Kit, r: Rect, y = KERB) {
  if (!k.free(r)) return;
  const [x0, z0, x1, z1] = r, alongX = x1 - x0 >= z1 - z0, len = alongX ? x1 - x0 : z1 - z0, n = Math.ceil(len / 3), seg = len / n;
  for (let i = 0; i < n; i++) {
    const a = (alongX ? x0 : z0) + i * seg, c = a + seg - 0.05;
    if (alongX) { k.box(a, z0, c, z1, y, y + 0.85, 'concrete'); k.shape(a + 0.05, z0 + 0.08, c - 0.05, z1 - 0.08, y + 0.85, y + 0.9, 'concrete'); }
    else { k.box(x0, a, x1, c, y, y + 0.85, 'concrete'); k.shape(x0 + 0.08, a + 0.05, x1 - 0.08, c - 0.05, y + 0.85, y + 0.9, 'concrete'); }
  }
  k.claim(r);
}

/** Orange-and-white plastic road barriers along a rect (one collider, drawn as linked segments). */
export function roadBarrier(k: Kit, r: Rect, y = KERB) {
  const [x0, z0, x1, z1] = r, alongX = x1 - x0 >= z1 - z0, len = alongX ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(len / 1.6)), seg = len / n;
  k.box(x0, z0, x1, z1, y, y + 1.0, 'invisible');
  for (let i = 0; i < n; i++) {
    const a = (alongX ? x0 : z0) + i * seg, c = a + seg - 0.06, color = i % 2 ? C.white : C.orange;
    if (alongX) k.shape(a, z0, c, z1, y, y + 1.0, 'painted', color);
    else k.shape(x0, a, x1, c, y, y + 1.0, 'painted', color);
    if (alongX) k.shape(a + 0.1, z0 - 0.01, c - 0.1, z1 + 0.01, y + 0.62, y + 0.74, 'painted', i % 2 ? C.orange : C.white);
    else k.shape(x0 - 0.01, a + 0.1, x1 + 0.01, c - 0.1, y + 0.62, y + 0.74, 'painted', i % 2 ? C.orange : C.white);
  }
  k.claim(r);
}

/** A tiled planter box with a clipped hedge (crouch cover). */
export function planter(k: Kit, r: Rect, y = KERB) {
  if (!k.free(r)) return;
  const [x0, z0, x1, z1] = r;
  k.box(x0, z0, x1, z1, y, y + 0.75, 'mosaic', 0xb8a890);
  k.box(x0 + 0.12, z0 + 0.12, x1 - 0.12, z1 - 0.12, y + 0.75, y + 1.35, 'hedge');
  k.claim(r);
}

/** A double-sided lit poster box (movie posters), thin and tall. */
export function posterBox(k: Kit, r: Rect, posters: [string, string, string][], y = KERB) {
  if (!k.free(r)) return;
  const [x0, z0, x1, z1] = r, alongX = x1 - x0 >= z1 - z0;
  k.box(x0, z0, x1, z1, y, y + 2.4, 'painted', C.dark);
  const [a, c] = posters;
  const w = (alongX ? x1 - x0 : z1 - z0) - 0.25;
  if (alongX) {
    k.sign('billboard', (x0 + x1) / 2, y + 1.45, z0 - 0.02, FACE.n, w, 1.7, a[0], a[1], '#ffffff', a[2]);
    k.sign('billboard', (x0 + x1) / 2, y + 1.45, z1 + 0.02, FACE.s, w, 1.7, c[0], c[1], '#ffffff', c[2]);
  } else {
    k.sign('billboard', x0 - 0.02, y + 1.45, (z0 + z1) / 2, FACE.w, w, 1.7, a[0], a[1], '#ffffff', a[2]);
    k.sign('billboard', x1 + 0.02, y + 1.45, (z0 + z1) / 2, FACE.e, w, 1.7, c[0], c[1], '#ffffff', c[2]);
  }
  k.claim(r);
}

/** Black wheels under a vehicle body (visual). */
function wheels(k: Kit, x0: number, z0: number, x1: number, z1: number, alongX: boolean, y: number, radius: number, axles: number[]) {
  for (const t of axles) for (const side of [0, 1]) {
    if (alongX) { const x = x0 + (x1 - x0) * t; k.cyl(x, y, side ? z1 - 0.12 : z0 - 0.02, radius, 0.14, 'z', 'painted', C.dark); }
    else { const z = z0 + (z1 - z0) * t; k.cyl(side ? x1 - 0.12 : x0 - 0.02, y, z, radius, 0.14, 'x', 'painted', C.dark); }
  }
}

const VAN_LENGTH = 5.2;
/** A van's footprint (5.2 × 2 m) from its -x/-z corner, its length along x or z. */
export const vanRect = (x0: number, z0: number, alongX: boolean): Rect => alongX ? [x0, z0, x0 + VAN_LENGTH, z0 + 2.0] : [x0, z0, x0 + 2.0, z0 + VAN_LENGTH];

/**
 * A delivery van parked along an axis, its cab toward `front` (+1 toward +x/+z): a box van up
 * to 2.45 m and a lower cab, each a collider from the ground.
 */
export function van(k: Kit, x0: number, z0: number, alongX: boolean, front: 1 | -1, color: number, label: [string, string], y = KERB) {
  const L = VAN_LENGTH, W = 2.0, [, , x1, z1] = vanRect(x0, z0, alongX);
  if (!k.free([x0, z0, x1, z1])) return;
  const a0 = alongX ? x0 : z0, cab = 1.7;
  // Cab span and cargo span along the length.
  const [c0, c1] = front > 0 ? [a0 + L - cab, a0 + L] : [a0, a0 + cab], [g0, g1] = front > 0 ? [a0, a0 + L - cab] : [a0 + cab, a0 + L];
  const span = (s0: number, s1: number): Rect => alongX ? [s0, z0, s1, z1] : [x0, s0, x1, s1];
  k.box(...span(g0, g1), y, y + 2.45, 'invisible');
  k.box(...span(c0, c1), y, y + 2.0, 'invisible');
  const lift = 0.32;
  k.shape(...span(g0, g1), y + lift, y + 2.45, 'painted', color);
  k.shape(...span(c0, c1), y + lift, y + 1.2, 'painted', color);
  // Cab glasshouse, windscreen toward the front.
  const [w0, w1] = front > 0 ? [c0, c1 - 0.25] : [c0 + 0.25, c1];
  const inset = (r: Rect, d: number): Rect => alongX ? [r[0], r[1] + d, r[2], r[3] - d] : [r[0] + d, r[1], r[2] - d, r[3]];
  k.shape(...inset(span(w0, w1), 0.06), y + 1.2, y + 2.0, 'glass');
  k.shape(...inset(span(w0, w1), 0.08), y + 1.95, y + 2.02, 'painted', color);
  k.shape(...span(front > 0 ? c1 - 0.06 : c0, front > 0 ? c1 + 0.06 : c0 + 0.06), y + 0.35, y + 0.6, 'painted', C.dark);
  const lamp = front > 0 ? c1 : c0;
  for (const side of [0.3, W - 0.3]) {
    if (alongX) k.shape(lamp - 0.05, z0 + side - 0.15, lamp + 0.05, z0 + side + 0.15, y + 0.75, y + 0.9, 'neon', 0xfff4d0);
    else k.shape(x0 + side - 0.15, lamp - 0.05, x0 + side + 0.15, lamp + 0.05, y + 0.75, y + 0.9, 'neon', 0xfff4d0);
  }
  wheels(k, x0, z0, x1, z1, alongX, y, 0.36, front > 0 ? [0.18, 0.82] : [0.18, 0.82]);
  // The company name down both sides of the box.
  const mid = (g0 + g1) / 2, sw = g1 - g0 - 0.4;
  if (alongX) { k.sign('board', mid, y + 1.55, z0 - 0.02, FACE.n, sw, 0.6, label[0], '#ffffff', '#1a5aa8', label[1]); k.sign('board', mid, y + 1.55, z1 + 0.02, FACE.s, sw, 0.6, label[0], '#ffffff', '#1a5aa8', label[1]); }
  else { k.sign('board', x0 - 0.02, y + 1.55, mid, FACE.w, sw, 0.6, label[0], '#ffffff', '#1a5aa8', label[1]); k.sign('board', x1 + 0.02, y + 1.55, mid, FACE.e, sw, 0.6, label[0], '#ffffff', '#1a5aa8', label[1]); }
  k.claim([x0, z0, x1, z1]);
}

/**
 * A broken-down box truck: a cab and a cargo box whose roller door is up, so its floor (a jump
 * up from the street) is a room of cover. Along an axis, cab toward `front`.
 */
export function truck(k: Kit, x0: number, z0: number, alongX: boolean, front: 1 | -1, y = KERB) {
  const L = 7.4, W = 2.4, cab = 2.1, x1 = alongX ? x0 + L : x0 + W, z1 = alongX ? z0 + W : z0 + L;
  if (!k.free([x0, z0, x1, z1])) return;
  const a0 = alongX ? x0 : z0;
  const [c0, c1] = front > 0 ? [a0 + L - cab, a0 + L] : [a0, a0 + cab], [g0, g1] = front > 0 ? [a0, a0 + L - cab - 0.1] : [a0 + cab + 0.1, a0 + L];
  const span = (s0: number, s1: number, d0 = 0, d1 = 0): Rect => alongX ? [s0, z0 + d0, s1, z1 - d1] : [x0 + d0, s0, x1 - d1, s1];
  const floor = y + 1.1, top = y + 3.4, t = 0.08;
  // Cab.
  k.box(...span(c0, c1, 0.05, 0.05), y, y + 2.7, 'invisible');
  k.shape(...span(c0, c1, 0.05, 0.05), y + 0.45, y + 1.6, 'painted', 0x2a5a8a);
  k.shape(...span(front > 0 ? c0 : c0 + 0.3, front > 0 ? c1 - 0.3 : c1, 0.12, 0.12), y + 1.6, y + 2.6, 'glass');
  k.shape(...span(front > 0 ? c0 : c0 + 0.3, front > 0 ? c1 - 0.3 : c1, 0.1, 0.1), y + 2.55, y + 2.7, 'painted', 0x2a5a8a);
  // Cargo box: floor, two side walls, the front wall and the roof; the back stands open.
  const back = front > 0 ? g0 : g1, fw = front > 0 ? g1 : g0;
  k.box(...span(g0, g1), y + 0.5, floor, 'painted', C.dark);
  k.box(...span(g0, g1, 0, W - t), floor, top, 'painted', C.white);
  k.box(...span(g0, g1, W - t, 0), floor, top, 'painted', C.white);
  k.box(...span(front > 0 ? fw - t : fw, front > 0 ? fw : fw + t, t, t), floor, top, 'painted', C.white);
  k.box(...span(g0, g1), top, top + 0.08, 'painted', C.white);
  // The chassis under the box blocks like the body (no crawling under a truck).
  k.box(...span(g0, g1, 0.3, 0.3), y, y + 0.5, 'invisible');
  k.shape(...span(front > 0 ? back : back - 0.25, front > 0 ? back + 0.25 : back, 0.1, 0.1), top - 0.45, top - 0.05, 'painted', 0xb8bcc0);
  wheels(k, x0, z0, x1, z1, alongX, y, 0.48, front > 0 ? [0.15, 0.4, 0.86] : [0.14, 0.6, 0.85]);
  // Hazard triangle behind it.
  const hx = alongX ? back - (front > 0 ? 2 : -2) : (x0 + x1) / 2, hz = alongX ? (z0 + z1) / 2 : back - (front > 0 ? 2 : -2);
  k.shape(hx - 0.25, hz - 0.03, hx + 0.25, hz + 0.03, y, y + 0.08, 'neon', 0xff3a1a);
  k.shape(hx - 0.06, hz - 0.03, hx + 0.06, hz + 0.03, y, y + 0.42, 'neon', 0xff3a1a);
  const mid = (g0 + g1) / 2, sw = g1 - g0 - 0.6;
  if (alongX) { k.sign('board', mid, y + 2.4, z0 - 0.02, FACE.n, sw, 1.0, '西門搬家', '#ffffff', '#c8141a', 'XIMEN MOVERS'); k.sign('board', mid, y + 2.4, z1 + 0.02, FACE.s, sw, 1.0, '西門搬家', '#ffffff', '#c8141a', 'XIMEN MOVERS'); }
  else { k.sign('board', x0 - 0.02, y + 2.4, mid, FACE.w, sw, 1.0, '西門搬家', '#ffffff', '#c8141a', 'XIMEN MOVERS'); k.sign('board', x1 + 0.02, y + 2.4, mid, FACE.e, sw, 1.0, '西門搬家', '#ffffff', '#c8141a', 'XIMEN MOVERS'); }
  k.claim([x0, z0, x1, z1]);
}

/**
 * A broken-down city bus in a kerb lane (hard cover), its roof reachable over two crate steps at
 * its back, with the roof air-con unit to crouch behind up there.
 */
export function bus(k: Kit, x0: number, z0: number, x1: number, z1: number, y = 0) {
  const top = y + 3.15, alongX = x1 - x0 > z1 - z0;
  k.box(x0, z0, x1, z1, y, top, 'invisible');
  k.shape(x0, z0, x1, z1, y + 0.4, top, 'painted', C.bus);
  // Teal stripe, window band down both sides, front screen and the destination board.
  const band = (y0: number, y1: number, style: BlockStyle, color?: number, d = 0.02) =>
    alongX ? (k.shape(x0 + 0.4, z0 - d, x1 - 0.6, z0, y0, y1, style, color), k.shape(x0 + 0.4, z1, x1 - 0.6, z1 + d, y0, y1, style, color))
      : (k.shape(x0 - d, z0 + 0.4, x0, z1 - 0.6, y0, y1, style, color), k.shape(x1, z0 + 0.4, x1 + d, z1 - 0.6, y0, y1, style, color));
  band(y + 0.75, y + 1.05, 'painted', 0x1f7a6a);
  band(y + 1.35, y + 2.6, 'glass');
  if (alongX) {
    k.shape(x0 - 0.02, z0 + 0.15, x0, z1 - 0.15, y + 1.2, y + 2.7, 'glass');
    k.sign('board', x0 - 0.04, y + 2.88, (z0 + z1) / 2, FACE.w, 1.7, 0.26, '故障 暫停服務', '#111111', '#ff9a2a', 'NOT IN SERVICE');
  }
  wheels(k, x0, z0, x1, z1, alongX, y, 0.5, [0.18, 0.78]);
  // Air-con unit on the roof (cover up there), its open engine hatch at the back.
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  k.box(cx - 1.2, cz - 0.7, cx + 1.2, cz + 0.7, top, top + 0.5, 'painted', 0xd8d8d2);
  if (alongX) k.shape(x1, z0 + 0.3, x1 + 0.08, z1 - 0.3, y + 0.5, y + 1.6, 'painted', 0x3a3a3c);
  k.claim([x0, z0, x1, z1]);
}

/** Construction hoarding along a rect (2.4 m): painted panels with a green top band and posters. */
export function hoarding(k: Kit, r: Rect, face: Side, y = KERB, text?: [string, string]) {
  const [x0, z0, x1, z1] = r;
  k.box(x0, z0, x1, z1, y, y + 2.4, 'painted', C.hoarding);
  k.shape(x0 - 0.01, z0 - 0.01, x1 + 0.01, z1 + 0.01, y + 2.1, y + 2.4, 'painted', C.netting);
  k.shape(x0 - 0.01, z0 - 0.01, x1 + 0.01, z1 + 0.01, y, y + 0.25, 'painted', 0x8a8e88);
  if (text) {
    const alongX = x1 - x0 >= z1 - z0, w = Math.min((alongX ? x1 - x0 : z1 - z0) - 0.6, 5);
    const fx = face === 'w' ? x0 - 0.02 : face === 'e' ? x1 + 0.02 : (x0 + x1) / 2, fz = face === 'n' ? z0 - 0.02 : face === 's' ? z1 + 0.02 : (z0 + z1) / 2;
    k.sign('board', fx, y + 1.35, fz, FACE[face], w, 1.0, text[0], '#f2f2ea', '#1f6a3a', text[1]);
  }
  k.claim(r);
}

/**
 * A kerbside bus shelter along x: a glass back toward `back`, a lit advert box closing its west end
 * (full cover across the sidewalk lane), a bench and a roof.
 */
export function shelter(k: Kit, x0: number, z0: number, x1: number, z1: number, back: 'n' | 's', y = KERB) {
  const r: Rect = [x0, z0, x1, z1];
  if (!k.free(r)) return;
  const bz = back === 'n' ? z0 : z1 - 0.06;
  k.box(x0 + 0.3, bz, x1, bz + 0.06, y + 0.1, y + 2.2, 'glass');
  k.box(x0, z0, x0 + 0.3, z1, y, y + 2.4, 'painted', 0x3a4a5a);
  k.sign('billboard', x0 - 0.02, y + 1.3, (z0 + z1) / 2, FACE.w, z1 - z0 - 0.15, 1.8, '公車 BUS', '#1a5aa8', '#ffffff', '西門町 · 臺北車站 · 萬華');
  k.sign('board', x0 + 0.32, y + 1.3, (z0 + z1) / 2, FACE.e, z1 - z0 - 0.15, 1.8, '珍珠奶茶節', '#e8a020', '#3a1a0a', 'BUBBLE TEA FESTIVAL');
  k.shape(x0 - 0.1, z0 - 0.15, x1 + 0.15, z1 + 0.15, y + 2.4, y + 2.52, 'painted', 0xd8dade);
  for (const x of [x0 + 0.3, x1 - 0.06]) for (const z of [z0, z1 - 0.06]) k.shape(x, z, x + 0.06, z + 0.06, y, y + 2.4, 'steel', 0x8a9096);
  const bench = back === 'n' ? z0 + 0.1 : z1 - 0.55;
  k.box(x0 + 0.8, bench, x1 - 0.5, bench + 0.45, y, y + 0.45, 'painted', 0x8a9096);
  k.claim(r);
}

// ---- Structures ---------------------------------------------------------------------------

/**
 * The night market on Wuchang St between Xining S. Rd and Hanzhong St: four sections of stalls in
 * a staggered plan under a tarp roof on posts. Sections leave cross passages between them and
 * alternate which of the street's five lanes they fill, so no lane runs straight through.
 */
function nightMarket(k: Kit) {
  // Rows reach to half a metre of the node lines either side, so their edges overlap across the
  // sections and every line down the street meets a stall somewhere.
  const span = (i0: number, i1: number, z0: number, z1: number): Rect => [cells(i0, i1, 0, 0)[0], z0, cells(i0, i1, 0, 0)[2], z1];
  const north = (i0: number, i1: number) => span(i0, i1, -259.25, NZ(20) - 0.55);
  const south = (i0: number, i1: number) => span(i0, i1, NZ(22) + 0.55, -246.75);
  // S1 and S3: stalls on both sides and an island down the middle (lanes 2 and 4 open). S1's
  // island stops short of the source's street tree in the cross passage.
  for (const i0 of [31, 39]) {
    stalls(k, north(i0, i0 + 2), 's', 3);
    const isl = span(i0, i0 + 2, NZ(20) + 0.55, NZ(22) - 0.55);
    island(k, i0 === 31 ? [isl[0], isl[1], -797.8, isl[3]] : isl, 'z');
    stalls(k, south(i0, i0 + 2), 'n', 3);
  }
  // S2: stalls on both sides with crates stacked in front of the outer ones (the middle lane open).
  stalls(k, north(35, 37), 's', 3);
  stalls(k, south(35, 37), 'n', 3);
  for (const i of [35, 37]) { crates(k, NX(i), NZ(20), 'x', true); crates(k, NX(i), NZ(22), 'x', true); }
  cart(k, NX(36), NZ(20), 'x');
  // S4: a food-court island over three lanes (the side lanes open).
  island(k, span(43, 45, NZ(19) + 0.55, NZ(23) - 0.55), 'z');
  // Tarp roof on posts along the facades, strings of lanterns and the market's gate signs.
  const x0 = -805.6, x1 = -765.6, z0 = -258.9, z1 = -247.1, top = KERB + 3.75;
  k.box(x0, z0, x1, z1, top, top + 0.06, 'invisible');
  const panels = 8;
  for (let i = 0; i < panels; i++) {
    const a = x0 + (x1 - x0) * i / panels, c = x0 + (x1 - x0) * (i + 1) / panels;
    k.shape(a, z0, c, (z0 + z1) / 2, top + (i % 2 ? 0.02 : 0), top + 0.08, 'painted', i % 2 ? C.tarpBlue : C.white);
    k.shape(a, (z0 + z1) / 2, c, z1, top + (i % 2 ? 0 : 0.02), top + 0.08, 'painted', i % 2 ? C.white : C.tarpBlue);
  }
  for (let x = x0 + 0.1; x <= x1; x += 8) for (const z of [-259.18, -246.82]) k.shape(x - 0.06, z - 0.06, x + 0.06, z + 0.06, KERB, top, 'steel', C.steel);
  for (const z of [-255, -250.6]) {
    k.shape(x0, z - 0.01, x1, z + 0.01, top - 0.32, top - 0.3, 'painted', C.dark);
    for (let x = x0 + 1.2; x < x1; x += 2.4) k.shape(x - 0.16, z - 0.16, x + 0.16, z + 0.16, top - 0.72, top - 0.32, 'neon', (Math.round(x) % 2) ? 0xff3a2a : 0xffb02a);
  }
  for (const [x, face] of [[x0 - 0.05, FACE.w], [x1 + 0.05, FACE.e]] as const) {
    k.sign('gate', x, KERB + 3.3, -253, face, 8.5, 0.9, '西門夜市', '#a8141a', '#ffffff', 'XIMEN NIGHT MARKET');
    k.shape(x - 0.04, -257.4, x + 0.04, -248.6, KERB + 2.84, KERB + 2.86, 'painted', C.dark);
  }
}

/**
 * Construction site at the north end of Xining S. Rd, against the block's west facade: a
 * two-level scaffold (decks at 3.4 and 6.8 m) with a covered walkway under it from Civic Blvd to
 * the Wuchang St crossing. Lane W (x -812.25..-809.75) carries the stair from the street to the
 * first deck; lane E (to the facade) the stair from the first deck to the second. Green safety
 * netting makes waist-high cover along the open edges; hoarding closes the street side.
 */
function constructionSite(k: Kit) {
  const xw = -812.0, xm = -809.75, xe = -806.75, zn = -278.0, zs = -261.25, zt = -271.25, zb = -263.75;
  const d1 = KERB + 3.4, d2 = KERB + 6.8, slab = 0.15;
  // Stair 1: lane W, street to deck 1, rising north.
  k.stairs([xw, zt, xm, zb], KERB, d1, 3);
  // Deck 1: both lanes north of the stairs.
  k.box(xw, zn, xe, zt, d1 - slab, d1, 'floor');
  // Stair 2: lane E, deck 1 to deck 2, rising south (it stands over the walkway).
  k.stairs([xm, zt, xe, zb], d1, d2, 1);
  k.shape(xm + 0.05, zt, xe - 0.05, zb, d1 - 0.2, d1 - 0.05, 'steel', 0x6a7076);
  // Deck 2: lane W the whole length, lane E north of stair 2 and its landing at the south end.
  k.box(xw, zn, xm, zs, d2 - slab, d2, 'floor');
  k.box(xm, zn, xe, zt, d2 - slab, d2, 'floor');
  k.box(xm, zb, xe, zs, d2 - slab, d2, 'floor');
  // Safety netting (cover from the decks) on the open edges; the stair openings are left.
  const net = (r: Rect, y: number, h = 1.1) => { k.box(...r, y, y + h, 'painted', C.netting); k.shape(r[0] - 0.01, r[1] - 0.01, r[2] + 0.01, r[3] + 0.01, y + h - 0.08, y + h, 'steel', 0xd8dade); };
  net([xw, zn, xw + 0.08, zt], d1);
  net([xw, zn, xe, zn + 0.08], d1);
  net([xw, zn, xw + 0.08, zs], d2);
  net([xw, zn, xe, zn + 0.08], d2);
  net([xw, zs - 0.08, xe, zs], d2);
  // The hole over stair 2: a rail on its west side.
  k.shape(xm - 0.04, zt, xm + 0.04, zb, d2 + 0.95, d2 + 1.05, 'steel', 0xd8dade);
  // Netting above the cover panels (visual) and the tube frame.
  for (const [y0, y1] of [[d1 + 1.1, d2 - slab], [d2 + 1.1, d2 + 2.3]]) k.shape(xw - 0.02, zn, xw, zs, y0, y1, 'glass');
  for (let z = zn; z <= zs + 0.01; z += (zs - zn) / 6) for (const x of [xw, xm, xe - 0.05]) {
    k.shape(x - 0.04, z - 0.04, x + 0.04, z + 0.04, KERB, d2 + 2.3, 'steel', 0xc8ccd0);
  }
  for (const y of [d1 - 0.1, d2 - 0.1, d2 + 2.3]) {
    k.shape(xw - 0.04, zn, xw + 0.04, zs, y, y + 0.08, 'steel', 0xc8ccd0);
    k.shape(xw, zn - 0.04, xe, zn + 0.04, y, y + 0.08, 'steel', 0xc8ccd0);
  }
  // Collision for the street-side tubes (the walkway's west edge).
  for (const z of [zn + 0.1, -274.6, zs - 0.1]) k.box(xw - 0.06, z - 0.06, xw + 0.06, z + 0.06, KERB, d1 - slab, 'steel', 0xc8ccd0);
  // Hoarding round the stair's foot pocket (under deck 1, lane W) and the site's name boards.
  hoarding(k, [xw - 0.15, zn + 0.2, xw, -272.3], 'w', KERB, ['西門町都更 施工中', 'XIMEN RENEWAL · UNDER CONSTRUCTION']);
  k.sign('board', xw - 0.25, d2 + 1.7, (zn + zs) / 2, FACE.w, 6, 0.9, '安全第一', '#1f6a3a', '#ffffff', 'SAFETY FIRST · 西門建設');
  // Materials on the street's west side: a stack of pipes and bagged cement.
  const px = NX(25);
  for (const [dx, dy] of [[-0.4, 0], [0.4, 0], [0, 0.66]] as const) k.b.cylinder(k.s.X(px + dx), KERB + dy, k.s.Z(-273.5), 0.38, 5.2, 'steel', 'z', 0x7a6a5a);
  k.claim([px - 0.9, -276.2, px + 0.9, -270.8]);
  crates(k, NX(26), NZ(14), 'z', false);
  k.claim([xw, zn, xe, zs]);
}

/**
 * The site office on Hanzhong St (SWAT's way toward B): two containers stacked against the block,
 * a porch stair up to the upper office (a door and a window to fight from), and a sign and
 * sandbags on its roof.
 */
function siteOffice(k: Kit) {
  const x0 = -753.2, x1 = -750.75, z0 = -277.6, z1 = -271.5, h = 2.6, g = KERB, up = g + h, roof = up + h;
  // Lower container (closed), the porch deck beside the upper one and the porch stair.
  k.box(x0, z0, x1, z1, g, up, 'painted', C.container);
  for (const x of [x0 + 0.08, x1 - 0.08]) for (const z of [z0 + 0.08, z1 - 0.08]) k.shape(x - 0.09, z - 0.09, x + 0.09, z + 0.09, g, roof, 'painted', 0x23476a);
  const px0 = -756.6;
  k.box(px0, z0, x0, z1, up - 0.12, up, 'floor');
  k.stairs([px0, z1, px0 + 2.0, z1 + 6.4], g, up, 3);
  k.box(px0, z0, px0 + 0.08, z1, up, up + 1.0, 'steel', 0x5a6068);
  k.box(px0, z0, x0, z0 + 0.08, up, up + 1.0, 'steel', 0x5a6068);
  k.box(px0 + 2.0, z1 - 0.08, x0, z1, up, up + 1.0, 'steel', 0x5a6068);
  for (const z of [z0 + 0.1, z1 - 0.1]) k.shape(px0 + 0.02, z - 0.06, px0 + 0.14, z + 0.06, g, up - 0.12, 'steel', 0x5a6068);
  // Upper office: walls with a door and a window onto the porch, a window facing south, roof.
  const t = 0.1, door: [number, number] = [-276.4, -275.3], win: [number, number] = [-274.4, -272.6];
  const wall = (a: number, b: number, y0: number, y1: number) => k.box(x0, a, x0 + t, b, y0, y1, 'painted', C.container);
  wall(z0, door[0], up, roof); wall(door[1], win[0], up, roof); wall(win[1], z1, up, roof);
  wall(door[0], door[1], up + 2.1, roof); wall(win[0], win[1], up, up + 1.0); wall(win[0], win[1], up + 1.9, roof);
  k.box(x0, z0, x1, z0 + t, up, roof, 'painted', C.container);
  k.box(x0, z1 - t, x1, z1, up, up + 1.0, 'painted', C.container);
  k.box(x0, z1 - t, x1, z1, up + 1.9, roof, 'painted', C.container);
  k.box(x1 - t, z0, x1, z1, up, roof, 'painted', C.container);
  k.box(x0, z0, x1, z1, roof, roof + 0.1, 'painted', 0x23476a);
  k.shape(x0 + t, z0 + t, x1 - t, z1 - t, up, up + 0.02, 'tile', 0xd8d4cc);
  k.shape(x0 + 0.4, z0 + 0.6, x1 - 0.3, z0 + 1.6, up, up + 0.75, 'wood', C.wood);
  k.shape(x0 + 0.5, (z0 + z1) / 2 - 0.3, x1 - 0.3, (z0 + z1) / 2 + 0.3, roof - 0.05, roof - 0.02, 'light');
  // Sandbags and the sign on the roof (out of reach: it would overlook SWAT's cordon).
  k.crate(x0 + 0.5, roof + 0.1, -272.2, 0.9, 0.5, 1.2, 0xa89a70);
  k.crate(x1 - 0.5, roof + 0.1, -272.2, 0.9, 0.5, 1.2, 0xa89a70);
  k.sign('board', x0 - 0.02, up + 1.4, (door[1] + win[0]) / 2 - 0.15, FACE.w, 0.9, 0.35, '工務所', '#ffffff', '#1a3a6a', 'SITE OFFICE');
  k.box(x1 - 0.3, z0 + 0.6, x1 - 0.2, z0 + 0.7, roof + 0.1, roof + 2.4, 'steel', 0x5a6068);
  k.sign('board', x1 - 0.32, roof + 1.7, (z0 + z1) / 2, FACE.w, 4.6, 1.2, '西門建設', '#1f6a3a', '#ffffff', 'XIMEN CONSTRUCTION');
  k.shape(x1 - 0.3, z0 + 0.6, x1 - 0.22, z1 - 0.6, roof + 1.1, roof + 2.3, 'painted', C.dark);
  k.claim([px0, z0, x1, z1 + 6.4]);
  // The source's street tree the porch stair displaces goes with its planter.
  k.claim([-757.9, -272.0, -756.1, -270.2]);
}

/**
 * The temple stage (廟口戲台) of the Emei St stage spot, on the Hanzhong / Emei crossing: a red
 * platform with steps from the south, an altar before a screen wall on its north edge,
 * a tiled roof on four pillars, lanterns and its name board. It splits the crossing into lanes.
 */
function templeStage(k: Kit) {
  const [x0, z0, x1, z1] = cells(49, 51, 39, 41, 0.4), top = KERB + 1.1, RED = 0x9a1c1c, ROOF = 0xc8642a, GREEN = 0x2e7d5b;
  k.box(x0, z0, x1, z1, KERB, top, 'painted', RED);
  k.shape(x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05, top - 0.12, top, 'wood', 0x6a3a22);
  // Steps up from the south (toward Ximen station).
  k.stairs([NX(50) - 1.0, z1, NX(50) + 1.0, z1 + 2.5], KERB, top, 3);
  // Screen wall with the temple's name, the altar before it.
  k.box(x0, z0, x1, z0 + 0.35, top, top + 2.8, 'painted', RED);
  k.shape(x0 + 0.4, z0 + 0.35, x1 - 0.4, z0 + 0.38, top + 0.3, top + 2.5, 'painted', 0xc8a040);
  k.sign('board', (x0 + x1) / 2, top + 2.05, z0 + 0.4, FACE.s, 5.2, 0.85, '西門 福德宮', '#7a1010', '#ffd890', 'XIMEN TEMPLE STAGE');
  k.box(NX(50) - 1.4, z0 + 0.6, NX(50) + 1.4, z0 + 1.5, top, top + 0.95, 'painted', 0xb8201c);
  k.shape(NX(50) - 1.3, z0 + 1.5, NX(50) + 1.3, z0 + 1.52, top + 0.15, top + 0.8, 'painted', C.gold);
  k.cyl(NX(50), top + 0.95, z0 + 1.05, 0.28, 0.35, 'y', 'steel', 0x8a6a2a);
  for (const [dx, c] of [[-0.9, 0xe8a030], [0.9, 0xd83a2a], [-0.5, 0xf0d040]] as const) k.ball(NX(50) + dx, top + 1.1, z0 + 1.0, 0.16, 'painted', c);
  for (const dx of [-0.08, 0, 0.08]) k.shape(NX(50) + dx - 0.01, z0 + 1.04, NX(50) + dx + 0.01, z0 + 1.06, top + 1.3, top + 1.75, 'neon', 0xff8a3a);
  // Pillars and the roof: a solid slab with tiled tiers, a ridge and upswept ends.
  const roofY = top + 3.5;
  for (const [x, z] of [[x0 + 0.3, z0 + 0.3], [x1 - 0.3, z0 + 0.3], [x0 + 0.3, z1 - 0.3], [x1 - 0.3, z1 - 0.3]]) {
    k.box(x - 0.2, z - 0.2, x + 0.2, z + 0.2, top, roofY, 'painted', 0xb81c1c);
    k.shape(x - 0.26, z - 0.26, x + 0.26, z + 0.26, top, top + 0.3, 'painted', 0xd8cfc0);
  }
  k.box(x0 - 0.8, z0 - 0.6, x1 + 0.8, z1 + 0.8, roofY, roofY + 0.3, 'painted', GREEN);
  k.shape(x0 - 0.5, z0 - 0.3, x1 + 0.5, z1 + 0.5, roofY + 0.3, roofY + 0.75, 'painted', ROOF);
  k.shape(x0 + 0.2, z0 + 0.4, x1 - 0.2, z1 - 0.2, roofY + 0.75, roofY + 1.15, 'painted', ROOF);
  k.shape(x0 + 0.9, z0 + 1.2, x1 - 0.9, z1 - 1.0, roofY + 1.15, roofY + 1.4, 'painted', ROOF);
  const rz = (z0 + z1) / 2;
  k.shape(x0 - 0.2, rz - 0.15, x1 + 0.2, rz + 0.15, roofY + 1.4, roofY + 1.7, 'painted', GREEN);
  for (const s of [-1, 1]) {
    const ex = s < 0 ? x0 - 0.2 : x1 + 0.2;
    k.shape(ex - 0.35, rz - 0.12, ex + 0.35, rz + 0.12, roofY + 1.7, roofY + 1.95, 'painted', GREEN);
    k.shape(ex + s * 0.25 - 0.18, rz - 0.1, ex + s * 0.25 + 0.18, rz + 0.1, roofY + 1.95, roofY + 2.35, 'painted', GREEN);
  }
  k.shape((x0 + x1) / 2 - 0.3, rz - 0.3, (x0 + x1) / 2 + 0.3, rz + 0.3, roofY + 1.7, roofY + 2.3, 'painted', C.gold);
  for (const [x, z] of [[x0 - 0.3, z1 + 0.3], [x1 + 0.3, z1 + 0.3], [x0 - 0.3, z0 - 0.1], [x1 + 0.3, z0 - 0.1]]) {
    k.shape(x - 0.01, z - 0.01, x + 0.01, z + 0.01, roofY - 0.6, roofY, 'painted', C.dark);
    k.ball(x, roofY - 0.85, z, 0.3, 'neon', 0xff2a1a);
  }
  // Wing screens on the west side, a low balustrade between them (the south has the steps).
  k.box(x0, z0 + 0.35, x0 + 0.2, z0 + 3.1, top, top + 2.5, 'painted', RED);
  k.box(x0, z1 - 2.3, x0 + 0.2, z1 - 0.55, top, top + 2.5, 'painted', RED);
  k.shape(x0 + 0.2, z0 + 0.6, x0 + 0.22, z0 + 2.9, top + 0.3, top + 2.2, 'painted', C.gold);
  k.shape(x0, z0 + 3.1, x0 + 0.12, z1 - 2.3, top, top + 0.55, 'painted', C.gold);
  k.claim([x0, z0, x1, z1 + 2.5]);
}

// ---- Placement -----------------------------------------------------------------------------

export const MOVIES: [string, string, string][] = [['鬼門關', '#3a0a14', 'GHOST GATE · 9月25日'], ['台北狂飆', '#c8141a', 'TAIPEI RUSH'], ['西門之戀', '#d8507a', 'XIMEN LOVE STORY'], ['夜市英雄', '#1a3a8a', 'NIGHT MARKET HEROES']];

/** Delivery vans parked in the streets: their -x/-z corner, along x, cab toward, colour and livery. */
export const DELIVERY_VANS: [x0: number, z0: number, alongX: boolean, front: 1 | -1, color: number, label: [string, string]][] = [
  [-857.5, -259.25, true, -1, 0xf2f2ee, ['西門快遞', 'XIMEN EXPRESS']],   // Wuchang St, west (Cinema Street, site A)
  [-746.0, -248.75, true, 1, 0xd8d4c8, ['宅配通', 'HOME DELIVERY']],       // Wuchang St, east
  [-762.95, -230.9, false, 1, 0xe8e8e2, ['冷凍宅配', 'COLD CHAIN']],       // Hanzhong St outside the arcade (site B)
];

export function taipeiCover(k: Kit) {
  nightMarket(k);
  constructionSite(k);
  siteOffice(k);
  templeStage(k);

  // ---- Wuchang St, west (Cinema Street, site A) ----
  van(k, ...DELIVERY_VANS[0]);
  crates(k, NX(11), NZ(22), 'x', true);
  jersey(k, [-857.2, -248.4, -854.3, -247.8]);
  kiosk(k, cells(14, 14, 21, 21, -0.1), 'e', '電影售票', 'CINEMA TICKETS', 0x7a1a2a);
  crates(k, NX(17) - 0.2, NZ(20), 'x', true);
  crates(k, NX(19) - 0.3, NZ(20), 'x', false);
  cart(k, NX(19) + 0.6, NZ(23) - 0.1, 'x');
  posterBox(k, [-824.2, -250.0, -822.0, -249.6], [MOVIES[0], MOVIES[1]]);
  planter(k, [-822.4, -256.1, -820.0, -254.0]);

  // ---- Wuchang St, east (Hanzhong St to Zhonghua Rd) ----
  van(k, ...DELIVERY_VANS[1]);
  kiosk(k, clampTo(cells(63, 63, 22, 23), undefined, undefined, undefined, -246.75), 'w', '報攤', 'NEWS', 0x2a6a4a);

  // ---- Hanzhong St outside the arcade (site B) ----
  kiosk(k, [-763.2, -243.6, -759.6, -238.9], 'e', '彩券行', 'LOTTERY · NEWS', 0x2a7a4a);
  van(k, ...DELIVERY_VANS[2]);
  crates(k, NX(51) + 0.3, NZ(25) + 0.4, 'x', true);
  stall(k, [-763.2, -216.1, -760.9, -213.4], 'e');
  island(k, cells(50, 51, 32, 32), 'x');
  posterBox(k, [-752.2, -245.8, -750.8, -245.4], [MOVIES[2], MOVIES[0]]);

  // ---- Xining S. Rd between Wuchang and Emei streets ----
  stalls(k, clampTo(cells(29, 29, 25, 26), undefined, undefined, -806.75), 'w', 2);
  posterBox(k, [-816.3, -243.4, -813.6, -243.0], [MOVIES[2], MOVIES[3]]);
  kiosk(k, [-819.2, -228.6, -817.0, -223.9], 'e', '報攤', 'NEWS', 0x2a6a4a);
  island(k, cells(27, 28, 34, 34), 'x');
  crates(k, NX(26), NZ(36), 'x', true);

  // ---- Hanzhong St from the gateway to Emei St (Militia's middle way in) ----
  island(k, clampTo(cells(49, 50, 44, 44), NX(48) + 0.55), 'z');
  crates(k, NX(51), NZ(48), 'z', true);
  cart(k, NX(48), NZ(43) + 0.5, 'z');
  planter(k, cells(51, 51, 42, 42, 0.3));
}

/**
 * Roadwork over a rect (about 6 × 5 m): an excavated trench under steel plates fenced with road
 * barriers (or walled in hoarding), a dirt pile and a mini excavator at its east end.
 */
export function roadwork(k: Kit, r: Rect, walled = false) {
  const [x0, z0, x1, z1] = r, y = KERB;
  const fence = (f: Rect, face: Side) => walled ? hoarding(k, f, face) : roadBarrier(k, f);
  fence([x0, z0, x1, z0 + 0.45], 'n');
  fence([x0, z1 - 0.45, x1, z1], 's');
  fence([x0, z0 + 0.5, x0 + 0.45, z1 - 0.5], 'w');
  fence([x1 - 0.45, z0 + 0.5, x1, z1 - 0.5], 'e');
  k.shape(x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 0.6, y, y + 0.01, 'painted', 0x3a2e24);
  // Steel plates over the trench, the dirt pile beside it and the excavator at the east end.
  const d0 = x1 - 5.3, d1 = x1 - 3.1;
  k.shape(x0 + 0.8, z0 + 1.0, d0 - 0.2, z1 - 1.0, y + 0.01, y + 0.04, 'steel', 0x6a6e72);
  k.box(d0, z0 + 0.7, d1, z1 - 0.7, y, y + 1.1, 'painted', 0x6a4a30);
  k.box(d0 + 0.4, z0 + 1.2, d1 - 0.4, z1 - 1.2, y + 1.1, y + 2.1, 'painted', 0x5a3e28);
  k.shape(d0 + 0.8, z0 + 2.0, d1 - 0.8, z1 - 2.0, y + 2.1, y + 2.4, 'painted', 0x4a3220);
  const ex = x1 - 1.9, ez = (z0 + z1) / 2;
  k.box(ex - 1.1, ez - 1.0, ex + 1.1, ez + 1.0, y, y + 2.5, 'invisible');
  k.shape(ex - 1.1, ez - 1.0, ex + 1.1, ez - 0.55, y, y + 0.45, 'painted', C.dark);
  k.shape(ex - 1.1, ez + 0.55, ex + 1.1, ez + 1.0, y, y + 0.45, 'painted', C.dark);
  k.shape(ex - 0.9, ez - 0.85, ex + 0.9, ez + 0.85, y + 0.45, y + 1.25, 'painted', 0xe8b020);
  k.shape(ex - 0.6, ez - 0.75, ex + 0.5, ez + 0.2, y + 1.25, y + 2.45, 'glass');
  k.shape(ex - 0.65, ez - 0.8, ex + 0.55, ez + 0.25, y + 2.45, y + 2.52, 'painted', 0xe8b020);
  // The arm reaching over the trench: boom, stick and bucket.
  k.shape(ex - 2.3, ez + 0.3, ex - 0.8, ez + 0.6, y + 1.6, y + 1.9, 'painted', 0xe8b020);
  k.shape(ex - 2.5, ez + 0.3, ex - 2.2, ez + 0.6, y + 0.6, y + 1.9, 'painted', 0xe8b020);
  k.shape(ex - 2.75, ez + 0.15, ex - 2.25, ez + 0.75, y + 0.2, y + 0.65, 'painted', 0x4a4a4c);
  // Traffic cones at the corners and a lamp on the fence.
  for (const [cx, cz] of [[x0 - 0.4, z0 + 0.2], [x1 + 0.4, z0 + 0.2], [x0 - 0.4, z1 - 0.2], [x1 + 0.4, z1 - 0.2]]) {
    k.b.raw({ kind: 'cylinder', x: k.s.X(cx), y, z: k.s.Z(cz), radius: 0.2, height: 0.7, axis: 'y', style: 'painted', color: C.orange, top: 0.03 });
  }
  k.shape(x0 + 0.1, z0 + 0.1, x0 + 0.3, z0 + 0.3, y + 1.0, y + 1.2, 'neon', 0xffb01a);
  k.sign('board', (x0 + x1) / 2, y + 1.35, z1 + 0.02, FACE.s, 3.2, 0.5, '道路施工', '#f2c400', '#1a1a1a', 'ROADWORK');
  k.claim([x0, z0, x1, z1]);
}
