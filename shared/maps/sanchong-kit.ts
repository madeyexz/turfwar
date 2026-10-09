import { rng } from '../math';
import { Kit, type R } from './memorial-kit';
import type { BlockStyle, Decor, SignStyle } from './types';

/**
 * Building kit for Sanchong (sanchong.ts): the old walk-ups (公寓) of New Taipei with their
 * shopfront ground floors, arcades (騎樓), iron window cages (鐵窗), rooftop tin shacks (頂樓加蓋)
 * and water tanks, plus shop signs, parked scooters and overhead wires. Rectangles are map
 * coordinates [x0, z0, x1, z1] (+x east, +z south); every piece a soldier can reach has a collider.
 */
export type { R };
export type Side = 'n' | 's' | 'e' | 'w';

/** Palette: tiled facades, tin sheet, temple red and gold, market tarps, kerb and asphalt greys. */
export const C = {
  cream: 0xe8dcc4, salmon: 0xd9a58c, grey: 0xc4c0b8, mint: 0xb8c8b0, blueGrey: 0xb0bcc6, white: 0xeeeae2,
  tan: 0xc4a888, pink: 0xe2b8b0, ochre: 0xd8bc84,
  // Corrugated sheet (the 'roof' look) is a dark photo: its tints are near white.
  tinBlue: 0x8ab8f8, tinWhite: 0xffffff, tinRust: 0xf0a878, tinGreen: 0xa8e0b0,
  steel: 0xc8ccd0, iron: 0x3c4044, ink: 0x26282c, concrete: 0xb8b4ac, kerb: 0xa8a49c,
  red: 0xa8281e, redDeep: 0x7a1a14, gold: 0xd8a838, roofOrange: 0xff8a50, roofGreen: 0x7ad898, stone: 0x9c9a94,
  wood: 0x7a4e30, tarpRed: 0xc8322a, tarpBlue: 0x2f5fa8, tarpYellow: 0xe8b830, tarpGreen: 0x3f9a50,
  brick: 0xb86a4e, lamp: 0xffd9a0, neonRed: 0xff3a2a,
} as const;

/** The tiled facade colours of the walk-ups. */
export const TINTS = [C.cream, C.salmon, C.grey, C.mint, C.blueGrey, C.white, C.tan, C.pink, C.ochre];
const TINS = [C.tinBlue, C.tinBlue, C.tinWhite, C.tinRust, C.tinGreen];

/** Ground floor (shopfront, the renderer draws it on 'facade' blocks standing on the street) and the floors above. */
export const SHOP = 4.2, FLOOR = 3.2;
/** Facade window bays: the renderer's sheet repeats every 3.1 m from x = 0 (z = 0) on every face. */
const BAY = 3.1;

/** Shop names for the vertical blade signs (招牌), with their colours. */
const BLADES: [string, string, string][] = [
  ['機車行', '#c8141e', '#ffffff'], ['當舖', '#1a1a1a', '#ffd24a'], ['檳榔', '#18a050', '#ffffff'], ['麵店', '#e8b830', '#7a1010'],
  ['五金行', '#1d5fa8', '#ffffff'], ['中藥行', '#5a2a10', '#ffd88a'], ['牙醫診所', '#ffffff', '#1d6fb8'], ['卡拉OK', '#7a2ab0', '#ffe0ff'],
  ['自助餐', '#ff7a1a', '#ffffff'], ['冰果室', '#2ab0c8', '#ffffff'], ['彩券行', '#d81e1e', '#ffe24a'], ['洗衣店', '#3a9ad8', '#ffffff'],
  ['理髮', '#e8e8e8', '#c8141e'], ['鐵工廠', '#3a3e44', '#ffb02a'], ['印刷', '#1a3a6a', '#ffffff'], ['眼鏡行', '#ffd24a', '#1a1a1a'],
  ['補習班', '#1aa06a', '#ffffff'], ['滷肉飯', '#c8141e', '#ffe9b0'], ['網咖', '#101418', '#5af0ff'], ['藥局', '#2a8a3a', '#ffffff'],
  ['水電行', '#0a4a8a', '#ffe24a'], ['旅社', '#8a1a3a', '#ffd0e0'], ['電器行', '#f0f0f0', '#d81e1e'], ['早餐店', '#ffcf3a', '#c8141e'],
];

export interface ApartmentOpts {
  /** Ground floor open to an arcade (騎樓) of this depth along this side. */
  arcade?: [Side, number];
  /** Sides that face a street or lane (they get window cages, AC units and signs). */
  street?: Side[];
  /** A tin shack on the roof (頂樓加蓋); default true. */
  addon?: boolean;
  /** Water tanks on the roof; default 1. */
  tanks?: number;
  /** Blade signs on the street sides; default 1 per street side. */
  blades?: number;
  /** Plain style for older brick or plaster houses (no shopfront sheet). */
  style?: BlockStyle;
}

export class Town extends Kit {
  private signs = 0;

  /** A decor item straight into the map (no mirroring: Sanchong is laid out by hand, unmirrored). */
  raw(d: Decor) { this.b.raw(d); }

  /**
   * A walk-up (公寓) over `r`: `floors` storeys of tiled facade with a shopfront ground floor,
   * optionally an arcade along one side (the upper floors overhang it on square columns), a
   * parapet, a tin shack and water tanks on the roof, window cages, AC units and blade signs
   * on the sides that face a street. Returns the roof height.
   */
  apartment(r: R, floors: number, tint: number, seed: number, o: ApartmentOpts = {}) {
    const [x0, z0, x1, z1] = r, h = SHOP + (floors - 1) * FLOOR, style = o.style ?? 'facade';
    const random = rng(seed * 7919 + 17);
    if (o.arcade) {
      const [side, depth] = o.arcade, arc = strip(r, side, depth), rest = shrink(r, side, depth);
      this.box(rest, 0, h, style, tint);
      this.box(arc, SHOP, h, style, tint);
      // Columns along the arcade's street edge, tiled to the second floor.
      const [ax0, az0, ax1, az1] = arc, alongX = side === 'n' || side === 's';
      const len = alongX ? ax1 - ax0 : az1 - az0, n = Math.max(1, Math.round(len / 4));
      const edge = side === 'n' ? az0 : side === 's' ? az1 : side === 'w' ? ax0 : ax1, inward = side === 'n' || side === 'w' ? 1 : -1;
      for (let i = 0; i <= n; i++) {
        const p = (alongX ? ax0 : az0) + len * i / n, a = Math.min(Math.max(p, (alongX ? ax0 : az0) + 0.3), (alongX ? ax1 : az1) - 0.3);
        const e0 = edge, e1 = edge + inward * 0.6;
        const col: R = alongX ? [a - 0.3, Math.min(e0, e1), a + 0.3, Math.max(e0, e1)] : [Math.min(e0, e1), a - 0.3, Math.max(e0, e1), a + 0.3];
        this.box(col, 0, SHOP, 'mosaic', tint);
      }
      // Tiled arcade floor and a fluorescent tube under the soffit between each pair of columns.
      this.shape(arc, 0, 0.03, 'slab', 0xe0d4c4);
      for (let i = 0; i < n; i++) {
        const p = (alongX ? ax0 : az0) + len * (i + 0.5) / n, mid = alongX ? (az0 + az1) / 2 : (ax0 + ax1) / 2;
        this.shape(alongX ? [p - 0.6, mid - 0.06, p + 0.6, mid + 0.06] : [mid - 0.06, p - 0.6, mid + 0.06, p + 0.6], SHOP - 0.1, SHOP - 0.04, 'neon', 0xf4f0e0);
      }
    } else {
      this.box(r, 0, h, style, tint);
    }
    // Parapet round the roof, a shade darker than the tiles.
    const dark = shadeHex(tint, 0.8), t = 0.22;
    for (const p of [[x0, z0, x1, z0 + t], [x0, z1 - t, x1, z1], [x0, z0 + t, x0 + t, z1 - t], [x1 - t, z0 + t, x1, z1 - t]] as R[]) this.shape(p, h, h + 0.9, 'painted', dark);
    // A tin shack on part of the roof (頂樓加蓋), with an overhanging sheet roof.
    if (o.addon !== false && x1 - x0 > 5 && z1 - z0 > 5) {
      const w = (x1 - x0) * (0.45 + random() * 0.35), d = (z1 - z0) * (0.45 + random() * 0.35);
      const ax = x0 + 0.6 + random() * (x1 - x0 - w - 1.2), az = z0 + 0.6 + random() * (z1 - z0 - d - 1.2);
      const tin = TINS[Math.floor(random() * TINS.length)], ah = 2.6 + random() * 0.4;
      this.shape([ax, az, ax + w, az + d], h, h + ah, 'roof', tin);
      this.shape([ax - 0.3, az - 0.3, ax + w + 0.3, az + d + 0.3], h + ah, h + ah + 0.08, 'roof', shadeHex(tin, 0.85));
    }
    // Water tanks on steel stands (stainless, or the old blue plastic ones).
    const tanks = o.tanks ?? 1;
    for (let k = 0; k < tanks; k++) {
      const tx = x0 + 1.2 + random() * Math.max(0.1, x1 - x0 - 2.4), tz = z0 + 1.2 + random() * Math.max(0.1, z1 - z0 - 2.4);
      this.shape([tx - 0.6, tz - 0.6, tx + 0.6, tz + 0.6], h, h + 0.9, 'steel', C.iron);
      this.raw({ kind: 'cylinder', x: tx, y: h + 0.9, z: tz, radius: 0.62, height: 1.5, axis: 'y', style: 'painted', color: random() < 0.7 ? C.steel : C.tinBlue, sides: 12 });
    }
    // Street sides: window cages on the upper floors, AC units and a blade sign or two.
    for (const side of o.street ?? []) this.streetFace(r, side, floors, h, random, o.blades ?? 1, !!o.arcade && o.arcade[0] === side ? o.arcade[1] : 0);
    return h;
  }

  /** Iron window cages (鐵窗), AC units and blade signs on one face. */
  private streetFace(r: R, side: Side, floors: number, h: number, random: () => number, blades: number, arcade: number) {
    const [x0, z0, x1, z1] = r, alongX = side === 'n' || side === 's';
    const out = side === 'n' || side === 'w' ? -1 : 1;
    const face = (side === 'n' ? z0 : side === 's' ? z1 : side === 'w' ? x0 : x1);
    const lo = alongX ? x0 : z0, hi = alongX ? x1 : z1;
    // Bay centres of the facade sheet on this face.
    const first = Math.ceil((lo + 0.9) / BAY - 0.5), last = Math.floor((hi - 0.9) / BAY - 0.5);
    for (let f = 1; f < floors; f++) for (let k = first; k <= last; k++) {
      const c = (k + 0.5) * BAY, y = SHOP + (f - 1) * FLOOR + 0.9;
      const roll = random();
      if (roll < 0.42) this.cage(alongX, face, out, c, y);
      else if (roll < 0.62) {
        // An AC unit under the window on a bracket.
        const at = face + out * 0.3;
        this.shape(alongX ? [c + 0.2, Math.min(at, at + out * 0.5), c + 0.95, Math.max(at, at + out * 0.5)] : [Math.min(at, at + out * 0.5), c + 0.2, Math.max(at, at + out * 0.5), c + 0.95], y - 0.75, y - 0.2, 'painted', 0xe4e4de);
      }
    }
    for (let i = 0; i < blades; i++) {
      const [text, bg, fg] = BLADES[(this.signs++ * 7 + Math.floor(random() * 5)) % BLADES.length];
      const t = 0.2 + 0.6 * (blades === 1 ? random() : (i + 0.5) / blades), along = lo + (hi - lo) * t;
      const height = Math.min(h - SHOP - 0.6, 2.4 + text.length * 0.55), y = SHOP + 0.4 + height / 2 + random() * Math.max(0, h - SHOP - height - 1.2);
      const off = face + out * (0.55 + arcade * 0);
      const rotY = alongX ? (out > 0 ? Math.PI : 0) : (out > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.raw({ kind: 'sign', style: 'blade', x: alongX ? along : off, y, z: alongX ? off : along, rotY, w: 0.9, h: height, text, bg, fg });
      // The blade's steel bracket to the wall.
      this.shape(alongX ? [along - 0.04, Math.min(face, off), along + 0.04, Math.max(face, off)] : [Math.min(face, off), along - 0.04, Math.max(face, off), along + 0.04], y + height / 2 - 0.1, y + height / 2, 'steel', C.iron);
    }
  }

  /** One window cage standing out from a face: frame, bars and a little tin roof (decorative, out of reach). */
  cage(alongX: boolean, face: number, out: number, c: number, y: number) {
    const d = 0.45, w = 1.95, hh = 1.8, z0 = face, z1 = face + out * d;
    const a = Math.min(z0, z1), b = Math.max(z0, z1), bar = 0.045;
    const box = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, style: BlockStyle = 'steel', color: number = C.iron) =>
      this.shape(alongX ? [u0, v0, u1, v1] : [v0, u0, v1, u1], y0, y1, style, color);
    const fa = out > 0 ? b - bar : a, fb = out > 0 ? b : a + bar;
    // Front frame: sill rail, top rail and the sides; bars between.
    box(c - w / 2, c + w / 2, fa, fb, y - 0.05, y + 0.02);
    box(c - w / 2, c + w / 2, fa, fb, y + hh - 0.06, y + hh);
    for (let k = 0; k <= 6; k++) { const u = c - w / 2 + (w * k) / 6; box(u - bar / 2, u + bar / 2, fa, fb, y, y + hh - 0.05); }
    // Side frames and a tin hood.
    box(c - w / 2, c - w / 2 + bar, a, b, y, y + hh); box(c + w / 2 - bar, c + w / 2, a, b, y, y + hh);
    box(c - w / 2 - 0.08, c + w / 2 + 0.08, a, b + (out > 0 ? 0.12 : 0), y + hh, y + hh + 0.06, 'roof', C.tinWhite);
    // Potted plants on the sill of some cages.
    if ((Math.floor(c * 3.7 + y) & 3) === 0) box(c - 0.6, c + 0.2, fa - out * 0.3, fa, y, y + 0.35, 'painted', 0x4f8a3a);
  }

  /** A sign decor (no collision), its face turned to `rotY` (0 north, π/2 east, π south, -π/2 west). */
  sign(style: SignStyle, x: number, y: number, z: number, rotY: number, w: number, h: number, text: string, bg: string, fg: string, sub?: string) {
    this.raw({ kind: 'sign', style, x, y, z, rotY, w, h, text, bg, fg, ...(sub ? { sub } : {}) });
  }

  /**
   * A row of parked scooters, side by side along x or z, each pointing across the row (nose to
   * `facing`), on one collider (knee-high cover a soldier cannot walk through). Rows of model
   * instances: x, y, z, heading, scale, roll, colour, seed.
   */
  scooters(x0: number, z0: number, count: number, alongX: boolean, nose: 1 | -1, seed = 1, parallel = false, y = 0) {
    const random = rng(seed * 131 + 7), gap = parallel ? 2.0 : 0.78, data: number[] = [];
    const colors = [0xd8d8d8, 0x2a2a2e, 0xc8141e, 0x1d5fa8, 0xf0f0f0, 0x8a8a8a, 0xe8b830, 0x3a7a4a, 0xf2b8c8, 0x6a4a8a];
    for (let i = 0; i < count; i++) {
      const x = alongX ? x0 + i * gap : x0, z = alongX ? z0 : z0 + i * gap;
      // The model faces local +z, turned by -heading: heading 0 along +z, π/2 along -x. Side by
      // side, a row's scooters point across it; nose to tail (parallel), along it.
      const across = alongX ? (nose > 0 ? 0 : Math.PI) : (nose > 0 ? -Math.PI / 2 : Math.PI / 2);
      const heading = parallel ? across + Math.PI / 2 : across;
      data.push(x + (random() - 0.5) * 0.08, y, z + (random() - 0.5) * 0.08, heading + (random() - 0.5) * 0.12, 1, 0, colors[Math.floor(random() * colors.length)], Math.floor(random() * 1000));
    }
    this.raw({ kind: 'instances', model: 'scooter', data });
    const len = (count - 1) * gap, half = parallel ? 0.95 : 0.4, deep = parallel ? 0.4 : 0.95;
    const r: R = alongX ? [x0 - half, z0 - deep, x0 + len + half, z0 + deep] : [x0 - deep, z0 - half, x0 + deep, z0 + len + half];
    this.block(r, y, y + 1.05, 'metal');
  }

  /** Overhead wires across a street: a few dark cables at slightly different heights (decorative). */
  wires(alongX: boolean, at: number, a: number, b: number, y: number, n = 3) {
    for (let i = 0; i < n; i++) {
      const yy = y + i * 0.22 - (i % 2) * 0.1, off = (i - (n - 1) / 2) * 0.35;
      this.shape(alongX ? [a, at + off - 0.02, b, at + off + 0.02] : [at + off - 0.02, a, at + off + 0.02, b], yy, yy + 0.04, 'painted', 0x18181a);
    }
  }

  /** A steel utility pole with a transformer can (cover: the pole's collider). */
  pole(x: number, z: number, h = 9) {
    this.box([x - 0.18, z - 0.18, x + 0.18, z + 0.18], 0, h, 'concrete', 0x9a9a94);
    this.raw({ kind: 'cylinder', x: x + 0.45, y: h - 2.6, z, radius: 0.32, height: 1.0, axis: 'y', style: 'painted', color: 0x7a8288, sides: 10 });
    this.shape([x - 0.9, z - 0.06, x + 0.9, z + 0.06], h - 0.5, h - 0.4, 'steel', C.iron);
  }

  /** A stall counter with a tarp awning above (counter is cover; the tarp is out of reach). */
  stall(r: R, color: number, goods: number[] = [0xd84a2a, 0x7ab040, 0xe8c040, 0xf0ece0]) {
    this.box(r, 0, 0.95, 'wood', C.wood);
    const [x0, z0, x1, z1] = r;
    // Produce in trays on the counter.
    const n = Math.max(1, Math.round(Math.max(x1 - x0, z1 - z0) / 0.8));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 0.9) / n;
      const p: R = x1 - x0 >= z1 - z0 ? [x0 + (x1 - x0) * t0, z0 + 0.1, x0 + (x1 - x0) * t1, z1 - 0.1] : [x0 + 0.1, z0 + (z1 - z0) * t0, x1 - 0.1, z0 + (z1 - z0) * t1];
      this.shape(p, 0.95, 1.12, 'painted', goods[i % goods.length]);
    }
    this.shape(grow(r, 0.35), 2.45, 2.52, 'painted', color);
    // Posts at the counter's corners.
    for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) this.shape([px - 0.04, pz - 0.04, px + 0.04, pz + 0.04], 0.95, 2.45, 'steel', C.iron);
  }
}

/** The strip of `r` `depth` deep along `side`. */
export function strip(r: R, side: Side, depth: number): R {
  const [x0, z0, x1, z1] = r;
  return side === 'n' ? [x0, z0, x1, z0 + depth] : side === 's' ? [x0, z1 - depth, x1, z1] : side === 'w' ? [x0, z0, x0 + depth, z1] : [x1 - depth, z0, x1, z1];
}
/** `r` less the strip `depth` deep along `side`. */
export function shrink(r: R, side: Side, depth: number): R {
  const [x0, z0, x1, z1] = r;
  return side === 'n' ? [x0, z0 + depth, x1, z1] : side === 's' ? [x0, z0, x1, z1 - depth] : side === 'w' ? [x0 + depth, z0, x1, z1] : [x0, z0, x1 - depth, z1];
}
export function grow(r: R, d: number): R { return [r[0] - d, r[1] - d, r[2] + d, r[3] + d]; }
export function shadeHex(hex: number, k: number) {
  const r = Math.round(((hex >> 16) & 255) * k), g = Math.round(((hex >> 8) & 255) * k), b = Math.round((hex & 255) * k);
  return (r << 16) | (g << 8) | b;
}
