import { van } from './sanchong-blocks';
import { C, Ximen, shadeHex, type R } from './ximending-kit';

/**
 * What stands in Ximending's lanes and streets (ximending.ts): the chicanes that break every long
 * view. A chicane is two walls of street clutter (a van and a booth, a container, a poster
 * hoarding, a bus shelter and a planter) standing out from opposite sides of a lane, one after the
 * other along it, each reaching past the middle: nobody sees down the lane, and everybody walks
 * (or drives) the S-bend between them. Walls are at least 2.4 m high, so they cut eye-level lines.
 */
interface Piece {
  /** Thickness along the lane. */
  w: number;
  /** Fill `r`, whose long side runs across the lane (`near` is the lane edge it grows from: -1 the low side, 1 the high side). */
  build: (t: Ximen, r: R, alongX: boolean, near: 1 | -1, i: number) => void;
}

const VAN_COLORS = [0xf0f0ec, 0xe8d8a8, 0xb8d0e0, 0xd8b8b0];

/** Split `r` along its long side: the first `len` metres from the near end, and what is left. */
function split(r: R, alongX: boolean, near: 1 | -1, len: number): [R, R | undefined] {
  const [x0, z0, x1, z1] = r;
  // The lane runs along x: the piece is long in z; near -1 grows from z0, near 1 from z1.
  if (alongX) {
    const cut = near < 0 ? z0 + len : z1 - len;
    const a: R = near < 0 ? [x0, z0, x1, cut] : [x0, cut, x1, z1], b: R = near < 0 ? [x0, cut, x1, z1] : [x0, z0, x1, cut];
    return [a, Math.abs(b[3] - b[1]) > 0.6 ? b : undefined];
  }
  const cut = near < 0 ? x0 + len : x1 - len;
  const a: R = near < 0 ? [x0, z0, cut, z1] : [cut, z0, x1, z1], b: R = near < 0 ? [cut, z0, x1, z1] : [x0, z0, cut, z1];
  return [a, Math.abs(b[2] - b[0]) > 0.6 ? b : undefined];
}

const PIECES: Piece[] = [
  // A shipping container along the cross axis, a jersey barrier for the rest.
  { w: 2.4, build: (t, r, alongX, near, i) => {
    const [a, b] = split(r, alongX, near, 6.0);
    t.container(a, [0x2f5fa8, 0xc8641a, 0x3f9a50, 0x8a2a2a][i % 4]);
    if (b) t.jersey(b);
  } },
  // A delivery van across the lane and a booth at its end.
  { w: 2.2, build: (t, r, alongX, near, i) => {
    const [a, b] = split(r, alongX, near, 4.6);
    van(t, a, VAN_COLORS[i % VAN_COLORS.length], !alongX);
    if (b) t.booth(b, alongX ? (near < 0 ? 'n' : 's') : (near < 0 ? 'w' : 'e'), ['檳榔', '彩券', '報攤', '冰'][i % 4], ['BETEL NUT', 'LOTTERY', 'NEWS', 'ICE'][i % 4], [0x18a050, 0xc8641a, 0x2a6a4a, 0x1a7a3a][i % 4]);
  } },
  // A poster hoarding: a thin wall with a billboard on both faces.
  { w: 0.5, build: (t, r, alongX, near, i) => {
    t.box(r, 0, 2.6, 'painted', [0x3a2a6a, 0x14306a, 0x6a1a3a, 0x1a4a4a][i % 4]);
    const [x0, z0, x1, z1] = r, len = alongX ? z1 - z0 : x1 - x0, mid = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
    const text = [['新片上映', 'NOW SHOWING'], ['夏日特賣', 'SUMMER SALE'], ['演唱會', 'LIVE'], ['潮流市集', 'POP-UP']][i % 4];
    const w = Math.min(len - 0.8, 4.4);
    if (alongX) {
      t.sign('board', x0 - 0.05, 1.45, mid, -Math.PI / 2, w, 1.6, text[0], '#ffcc00', '#c8141e', text[1]);
      t.sign('board', x1 + 0.05, 1.45, mid, Math.PI / 2, w, 1.6, text[0], '#ffcc00', '#c8141e', text[1]);
    } else {
      t.sign('board', mid, 1.45, z0 - 0.05, 0, w, 1.6, text[0], '#ffcc00', '#c8141e', text[1]);
      t.sign('board', mid, 1.45, z1 + 0.05, Math.PI, w, 1.6, text[0], '#ffcc00', '#c8141e', text[1]);
    }
    void near;
  } },
  // A tall billboard wall (4.6 m): for the chicanes that must cut the view from the cinema's deck and stairs.
  { w: 0.5, build: (t, r, alongX, near, i) => {
    t.box(r, 0, 4.6, 'painted', [0x14102a, 0x2a0a14, 0x0a2a2a][i % 3]);
    const [x0, z0, x1, z1] = r, len = alongX ? z1 - z0 : x1 - x0, mid = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
    const w = Math.min(len - 0.6, 5.5);
    const text = [['星光戲院', 'STARLIGHT'], ['潮流市集', 'POP-UP'], ['夜市', 'NIGHT MARKET']][i % 3];
    if (alongX) {
      t.sign('billboard', x0 - 0.05, 3.0, mid, -Math.PI / 2, w, 3, text[0], '#ff4ad0', '#ffffff', text[1]);
      t.sign('billboard', x1 + 0.05, 3.0, mid, Math.PI / 2, w, 3, text[0], '#4af0ff', '#101030', text[1]);
    } else {
      t.sign('billboard', mid, 3.0, z0 - 0.05, 0, w, 3, text[0], '#ff4ad0', '#ffffff', text[1]);
      t.sign('billboard', mid, 3.0, z1 + 0.05, Math.PI, w, 3, text[0], '#4af0ff', '#101030', text[1]);
    }
    void near;
  } },
  // A glass bus shelter and a planter of tall hedge.
  { w: 1.6, build: (t, r, alongX, near, i) => {
    const [a, b] = split(r, alongX, near, 4.0);
    if (alongX) t.shelter(a[0], a[1], a[3] - a[1], false, i & 1 ? 1 : -1); else t.shelter(a[0], a[1], a[2] - a[0], true, i & 1 ? 1 : -1);
    if (b) t.planter(b, 0, 3.0);
  } },
];

/**
 * A chicane across a lane. `alongX`: the lane runs east–west, its band is z in [lo, hi] and the
 * chicane stands at x = c; otherwise the lane runs north–south in x in [lo, hi] at z = c. The
 * first wall grows from the low edge when `first` is 0, from the high edge when 1.
 */
export function chicane(t: Ximen, alongX: boolean, c: number, lo: number, hi: number, i: number, opts: { first?: 0 | 1; gap?: number; kinds?: [number, number] } = {}) {
  const [ka, kb] = opts.kinds ?? [i % PIECES.length, (i + 1 + Math.floor(i / PIECES.length)) % PIECES.length];
  const A = PIECES[ka], B = PIECES[kb], g = opts.gap ?? 3.5, depth = Math.min(hi - lo, (hi - lo) / 2 + 1.5);
  const firstLow = (opts.first ?? (i & 1)) === 0;
  // Wall A is the nearer one along the lane (lower coordinate), B the further.
  const rectA = (low: boolean): R => alongX
    ? [c - g / 2 - A.w, low ? lo : hi - depth, c - g / 2, low ? lo + depth : hi]
    : [low ? lo : hi - depth, c - g / 2 - A.w, low ? lo + depth : hi, c - g / 2];
  const rectB = (low: boolean): R => alongX
    ? [c + g / 2, low ? lo : hi - depth, c + g / 2 + B.w, low ? lo + depth : hi]
    : [low ? lo : hi - depth, c + g / 2, low ? lo + depth : hi, c + g / 2 + B.w];
  A.build(t, rectA(firstLow), alongX, firstLow ? -1 : 1, i);
  B.build(t, rectB(!firstLow), alongX, !firstLow ? -1 : 1, i + 1);
}

/** East–west lanes: [c, lo, hi] (lo and hi are z). */
export const LANE_CHICANES: { alongX: boolean; at: ([c: number, lo: number, hi: number] | [c: number, lo: number, hi: number, tall: true])[] }[] = [
  // Lane N, lane M (the market's aisle, then east of Hanzhong St) and lane S.
  { alongX: true, at: [[-51, -37.5, -27.5], [-35, -37.5, -27.5], [12, -37.5, -27.5], [31, -37.5, -27.5, true], [51, -37.5, -27.5]] },
  { alongX: true, at: [[-23, -4, 4], [-9.5, -4, 4], [18, -5, 5]] },
  { alongX: true, at: [[-51, 27.5, 37.5], [-42, 27.5, 37.5], [-28, 27.5, 37.5], [12, 27.5, 37.5], [31, 27.5, 37.5], [62, 27.5, 37.5]] },
  // West, Hanzhong and East streets: [c, lo, hi] with lo and hi in x.
  { alongX: false, at: [[-45, -47.5, -37.5], [-20, -47.5, -37.5], [20, -47.5, -37.5], [43, -47.5, -37.5]] },
  { alongX: false, at: [[-43, -5, 5], [-22, -5, 5, true], [20, -5, 5], [43, -5, 5]] },
  { alongX: false, at: [[-45, 37.5, 47.5], [-20, 37.5, 47.5], [20, 37.5, 47.5], [43, 37.5, 47.5]] },
];

/** Every chicane of the map. */
export function lanes(t: Ximen) {
  let i = 0;
  for (const { alongX, at } of LANE_CHICANES) for (const [c, lo, hi, tall] of at) { chicane(t, alongX, c, lo, hi, i, tall ? { kinds: [4, i % 4] } : {}); i++; }
  void C; void shadeHex;
}
