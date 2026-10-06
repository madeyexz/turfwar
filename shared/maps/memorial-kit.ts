import type { MapBuilder } from './builder';
import type { BlockStyle } from './types';

/**
 * Building kit for Memorial Hall (memorial.ts): rectangles in map coordinates (+x east, +z south),
 * walls with door gaps, slabs with holes, and stone stairs whose every step is drawn.
 */
export type R = [x0: number, z0: number, x1: number, z1: number];

/** Palette: white marble, granite, the blue glaze of the roof tiles, dark bronze and gold leaf. */
export const C = {
  marble: 0xf4f2ec, marbleShade: 0xe6e2da, granite: 0xd9d4ca, step: 0xe6e1d8, plaza: 0xcbc4b8,
  redGranite: 0xc98a78, chamberFloor: 0xe8ddd0, blue: 0x2a5cb8, blueDeep: 0x173f8a, bronze: 0x5c4630,
  bronzeDark: 0x3a2c1f, gold: 0xd4a94a, wood: 0x7a4e30, woodDark: 0x4e3020, cream: 0xf1e6cf, red: 0xa82a22,
  ink: 0x2a2a2e, hedge: 0x6a9a4e, lawn: 0x7aa85a,
} as const;

/** Rectangles covering `area` minus `holes`, merged greedily row by row. */
export function cover(area: R, holes: R[]): R[] {
  const [ax0, az0, ax1, az1] = area;
  const cut = holes.filter(h => h[2] > ax0 && h[0] < ax1 && h[3] > az0 && h[1] < az1);
  const xs = [...new Set([ax0, ax1, ...cut.flatMap(h => [h[0], h[2]])])].filter(v => v >= ax0 && v <= ax1).sort((a, c) => a - c);
  const zs = [...new Set([az0, az1, ...cut.flatMap(h => [h[1], h[3]])])].filter(v => v >= az0 && v <= az1).sort((a, c) => a - c);
  const open = (i: number, j: number) => {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    return !cut.some(h => cx > h[0] && cx < h[2] && cz > h[1] && cz < h[3]);
  };
  const done = new Set<string>(), out: R[] = [];
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
    if (done.has(`${i},${j}`) || !open(i, j)) continue;
    let i1 = i;
    while (i1 + 1 < xs.length - 1 && open(i1 + 1, j) && !done.has(`${i1 + 1},${j}`)) i1++;
    let j1 = j;
    while (j1 + 1 < zs.length - 1) {
      let ok = true;
      for (let k = i; k <= i1; k++) if (!open(k, j1 + 1) || done.has(`${k},${j1 + 1}`)) ok = false;
      if (!ok) break;
      j1++;
    }
    for (let jj = j; jj <= j1; jj++) for (let ii = i; ii <= i1; ii++) done.add(`${ii},${jj}`);
    out.push([xs[i], zs[j], xs[i1 + 1], zs[j1 + 1]]);
  }
  return out;
}

/** A door or window in a wall: centre along the wall, width, and the top of the opening (its sill for a window). */
export interface Gap { at: number; width: number; top?: number; sill?: number }

export class Kit {
  constructor(readonly b: MapBuilder) {}

  /** Solid box over a rectangle, bottom y0 to top y1. */
  box(r: R, y0: number, y1: number, style: BlockStyle, color?: number) {
    const i = this.b.box((r[0] + r[2]) / 2, y0, (r[1] + r[3]) / 2, r[2] - r[0], y1 - y0, r[3] - r[1], style);
    return color === undefined || i < 0 ? i : this.b.paint(i, color);
  }

  /** Drawn-only box (no collision). */
  shape(r: R, y0: number, y1: number, style: BlockStyle, color?: number) {
    this.b.shape((r[0] + r[2]) / 2, y0, (r[1] + r[3]) / 2, r[2] - r[0], y1 - y0, r[3] - r[1], style, color);
  }

  /** Collision only. */
  block(r: R, y0: number, y1: number, surface: 'concrete' | 'metal' | 'glass' | 'dirt' | 'rock' = 'concrete') {
    this.b.box((r[0] + r[2]) / 2, y0, (r[1] + r[3]) / 2, r[2] - r[0], y1 - y0, r[3] - r[1], 'invisible', surface);
  }

  /** Slab over `area` with `holes` cut out of it. */
  slab(area: R, holes: R[], y0: number, y1: number, style: BlockStyle, color?: number) {
    for (const r of cover(area, holes)) this.box(r, y0, y1, style, color);
  }

  /**
   * Wall of thickness t centred on `at`, running from a to b along x (axis 'x', at = z) or along z
   * (axis 'z', at = x), y0..y1, with door gaps (lintel above `top`) and windows (sill to top).
   */
  wall(axis: 'x' | 'z', at: number, a: number, b: number, y0: number, y1: number, gaps: Gap[], style: BlockStyle, color?: number, t = 0.8) {
    const piece = (p: number, q: number, lo: number, hi: number) => {
      if (q - p < 0.02 || hi - lo < 0.02) return;
      const r: R = axis === 'x' ? [p, at - t / 2, q, at + t / 2] : [at - t / 2, p, at + t / 2, q];
      this.box(r, lo, hi, style, color);
    };
    let cursor = a;
    for (const g of [...gaps].sort((p, q) => p.at - q.at)) {
      const p = g.at - g.width / 2, q = g.at + g.width / 2;
      piece(cursor, p, y0, y1);
      if (g.sill !== undefined) piece(p, q, y0, y0 + g.sill);
      piece(p, q, g.top ?? y0 + 3, y1);
      cursor = q;
    }
    piece(cursor, b, y0, y1);
  }

  /**
   * A stone flight: the ramp is the walking surface, a stepped fill under it (every block below the
   * slope, down to `base`) stops anyone walking through it, and each of `steps` steps is drawn.
   * dir: 0 rises toward +x, 1 +z, 2 -x, 3 -z.
   */
  flight(r: R, y0: number, y1: number, dir: 0 | 1 | 2 | 3, opts: { steps?: number; base?: number; style?: BlockStyle; color?: number } = {}) {
    const [x0, z0, x1, z1] = r, base = opts.base ?? y0;
    this.b.ramps.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, y0, y1, dir, surface: 'concrete' });
    const alongX = dir === 0 || dir === 2, sign = dir === 0 || dir === 1 ? 1 : -1;
    const run = alongX ? x1 - x0 : z1 - z0, start = sign > 0 ? (alongX ? x0 : z0) : (alongX ? x1 : z1);
    const slice = (t0: number, t1: number): R => {
      const a = start + sign * t0 * run, c = start + sign * t1 * run;
      return alongX ? [Math.min(a, c), z0, Math.max(a, c), z1] : [x0, Math.min(a, c), x1, Math.max(a, c)];
    };
    // A flat ramp apron on the top landing (coplanar with the floor there): the bots' graph only
    // climbs more than a step where the climb is on a ramp, and the nearest lattice point past the
    // top can stand up to a metre off the flight. (Where a flight runs straight on into the next,
    // the next one's slope is higher than the apron and wins.)
    const [ax0, az0, ax1, az1] = slice(1, 1 + 1.3 / run);
    this.b.ramps.push({ minX: ax0, maxX: ax1, minZ: az0, maxZ: az1, y0: y1, y1, dir, surface: 'concrete' });
    // The fill under the slope steps every 30 cm, so a lattice point on it stands within 20 cm of the ramp.
    const n = Math.max(1, Math.ceil(run / 0.3));
    for (let i = 1; i < n; i++) {
      const top = y0 + (y1 - y0) * (i / n) - 0.03;
      if (top - base < 0.15) continue;
      this.block(slice(i / n, (i + 1) / n), base - 0.05, top);
    }
    const steps = opts.steps ?? Math.max(2, Math.round((y1 - y0) / 0.16));
    for (let i = 0; i < steps; i++) {
      const top = y0 + (y1 - y0) * (i + 1) / steps;
      this.shape(slice(i / steps, (i + 1) / steps), base - 0.04, top, opts.style ?? 'paving', opts.color ?? C.step);
    }
  }

  /**
   * Cheek wall along a flight's side: a solid wall from `base` to a metre above the slope, in
   * `segments` stepped pieces. `side` is the strip it stands on; the flight rises y0 → y1 along dir.
   */
  cheek(side: R, base: number, y0: number, y1: number, dir: 0 | 1 | 2 | 3, segments = 4, color: number = C.marble, rail = 1.0) {
    const [x0, z0, x1, z1] = side, alongX = dir === 0 || dir === 2, sign = dir === 0 || dir === 1 ? 1 : -1;
    const run = alongX ? x1 - x0 : z1 - z0, start = sign > 0 ? (alongX ? x0 : z0) : (alongX ? x1 : z1);
    for (let i = 0; i < segments; i++) {
      const a = start + sign * run * i / segments, c = start + sign * run * (i + 1) / segments;
      const r: R = alongX ? [Math.min(a, c), z0, Math.max(a, c), z1] : [x0, Math.min(a, c), x1, Math.max(a, c)];
      const top = y0 + (y1 - y0) * (i + 1) / segments + rail;
      this.box(r, base, top, 'painted', color);
      this.shape(alongX ? [r[0], z0 - 0.06, r[2], z1 + 0.06] : [x0 - 0.06, r[1], x1 + 0.06, r[3]], top, top + 0.1, 'painted', C.marbleShade);
    }
  }

  /** Marble planter box on y with a clipped shrub to `h` above it (full cover). */
  planter(r: R, y: number, h = 3.2) {
    this.box(r, y, y + 0.9, 'painted', C.marbleShade);
    this.shape([r[0] - 0.05, r[1] - 0.05, r[2] + 0.05, r[3] + 0.05], y + 0.82, y + 0.95, 'painted', C.marble);
    // The shrub is drawn inside the box's rim; its collider fills the box (no thin gap above the rim).
    this.shape([r[0] + 0.2, r[1] + 0.2, r[2] - 0.2, r[3] - 0.2], y + 0.9, y + h, 'hedge', C.hedge);
    this.block(r, y + 0.9, y + h, 'dirt');
  }

  /** Marble balustrade over a rectangle standing on y: a solid rail with a coping and posts every ~2 m. */
  balustrade(r: R, y: number, h = 1.05) {
    this.box(r, y, y + h - 0.1, 'painted', C.marble);
    const [x0, z0, x1, z1] = r, alongX = x1 - x0 >= z1 - z0;
    this.shape(alongX ? [x0, z0 - 0.06, x1, z1 + 0.06] : [x0 - 0.06, z0, x1 + 0.06, z1], y + h - 0.1, y + h, 'painted', C.marbleShade);
    const len = alongX ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i <= n; i++) {
      const p = (alongX ? x0 : z0) + len * i / n;
      const post: R = alongX ? [p - 0.13, z0 - 0.05, p + 0.13, z1 + 0.05] : [x0 - 0.05, p - 0.13, x1 + 0.05, p + 0.13];
      this.shape(post, y, y + h + 0.12, 'painted', C.marbleShade);
    }
    // A sunk panel line along both faces suggests the carved balusters.
    const band = 0.03;
    if (alongX) { this.shape([x0 + 0.1, z0 - band, x1 - 0.1, z0], y + 0.25, y + h - 0.3, 'painted', 0xd8d3c8); this.shape([x0 + 0.1, z1, x1 - 0.1, z1 + band], y + 0.25, y + h - 0.3, 'painted', 0xd8d3c8); }
    else { this.shape([x0 - band, z0 + 0.1, x0, z1 - 0.1], y + 0.25, y + h - 0.3, 'painted', 0xd8d3c8); this.shape([x1, z0 + 0.1, x1 + band, z1 - 0.1], y + 0.25, y + h - 0.3, 'painted', 0xd8d3c8); }
  }

  /**
   * Balustrade along the edge of a rectangle's side, `inset` thick inside it, with gaps [from, to]
   * along that side. side: 'n' (z = z0), 's' (z = z1), 'w' (x = x0), 'e' (x = x1).
   */
  edge(area: R, side: 'n' | 's' | 'e' | 'w', y: number, gaps: [number, number][] = [], t = 0.4) {
    const [x0, z0, x1, z1] = area, alongX = side === 'n' || side === 's';
    const lo = alongX ? x0 : z0, hi = alongX ? x1 : z1;
    let cursor = lo;
    const run = (a: number, c: number) => {
      if (c - a < 0.3) return;
      const r: R = side === 'n' ? [a, z0, c, z0 + t] : side === 's' ? [a, z1 - t, c, z1] : side === 'w' ? [x0, a, x0 + t, c] : [x1 - t, a, x1, c];
      this.balustrade(r, y);
    };
    for (const [a, c] of [...gaps].sort((p, q) => p[0] - q[0])) { run(cursor, a); cursor = Math.max(cursor, c); }
    run(cursor, hi);
  }
}
