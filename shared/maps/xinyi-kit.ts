import { rng } from '../math';
import { C, Ximen, shadeHex, type R } from './ximending-kit';
import type { BlockStyle } from './types';

/**
 * Kit for Xinyi (xinyi.ts), on top of the street kit Ximending shares: glass office towers with
 * a stone podium, fins and lit crowns, buses and street cover for the boulevards, and a stair
 * with drawn steps. Rectangles are map coordinates [x0, z0, x1, z1] (+x east, +z south).
 */
export { C, shadeHex };
export type { R };

/** Glass tints of the towers: blue-green, grey-blue, bronze, silver. */
export const GLASS = [0x8fb8c8, 0x9aa8b8, 0xb8a890, 0xc0c8cc, 0x86b0a8];

export class Xinyi extends Ximen {
  /**
   * An office tower over `r` rising to `h`: a stone podium two storeys high (cover and a lit canopy
   * over the entrance side), then curtain wall with vertical fins, a stepped crown and a mast.
   * Drawn only when `solid` is false (the city past the bounds).
   */
  office(r: R, h: number, tint: number, seed: number, front: 'n' | 's' | 'e' | 'w' = 's') {
    const [x0, z0, x1, z1] = r, random = rng(seed * 977 + 13);
    this.box(r, 0, 9, 'concrete', 0xb8b4aa);
    this.box([x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 0.6], 9, h, 'curtain', tint);
    // Fins up the glass, one every 6 m on each face; a lit band under the crown.
    for (let x = x0 + 3; x < x1 - 1; x += 6) for (const z of [z0, z1]) this.shape([x - 0.15, z - 0.3, x + 0.15, z + 0.3], 9, h - 1, 'steel', 0xa8b0b6);
    for (let z = z0 + 3; z < z1 - 1; z += 6) for (const x of [x0, x1]) this.shape([x - 0.3, z - 0.15, x + 0.3, z + 0.15], 9, h - 1, 'steel', 0xa8b0b6);
    this.shape([x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3], h - 1.6, h - 1.2, 'neon', random() < 0.5 ? 0xffe0a0 : 0xbfe4ff);
    // Crown: a setback box and a mast.
    this.shape([x0 + 2.5, z0 + 2.5, x1 - 2.5, z1 - 2.5], h, h + 3.2, 'curtain', shadeHex(tint, 0.8));
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.shape([cx - 0.15, cz - 0.15, cx + 0.15, cz + 0.15], h + 3.2, h + 9, 'steel', 0x8a9096);
    this.b.mast(cx, h + 9, cz, 0);
    // The entrance canopy on `front`, lit, 3.4 m up.
    const w = 14, d = 3;
    const cano: R = front === 'n' ? [cx - w / 2, z0 - d, cx + w / 2, z0] : front === 's' ? [cx - w / 2, z1, cx + w / 2, z1 + d] : front === 'w' ? [x0 - d, cz - w / 2, x0, cz + w / 2] : [x1, cz - w / 2, x1 + d, cz + w / 2];
    this.shape(cano, 3.4, 3.7, 'steel', 0x5a6068);
    this.shape([cano[0] + 0.3, cano[1] + 0.3, cano[2] - 0.3, cano[3] - 0.3], 3.3, 3.4, 'neon', 0xfff0d0);
    return h;
  }

  /** A bus (12 × 2.6, 3.1 high): cover on a road; its sides are painted with a band of windows and a route sign. */
  bus(r: R, color: number, route = '307') {
    this.box(r, 0.3, 3.1, 'painted', color);
    this.block([r[0] + 0.5, r[1] + 0.2, r[2] - 0.5, r[3] - 0.2], 0, 0.3, 'metal');
    const [x0, z0, x1, z1] = r, alongX = x1 - x0 >= z1 - z0;
    const band = (a: number, b2: number, y0: number, y1: number, c: number) => alongX
      ? [this.shape([x0 + a, z0 - 0.03, x1 - b2, z0 + 0.01], y0, y1, 'painted', c), this.shape([x0 + a, z1 - 0.01, x1 - b2, z1 + 0.03], y0, y1, 'painted', c)]
      : [this.shape([x0 - 0.03, z0 + a, x0 + 0.01, z1 - b2], y0, y1, 'painted', c), this.shape([x1 - 0.01, z0 + a, x1 + 0.03, z1 - b2], y0, y1, 'painted', c)];
    band(0.5, 0.5, 1.7, 2.7, 0x1c2430);
    band(0, 0, 0.9, 1.3, shadeHex(color, 0.7));
    const mid = alongX ? (x0 + x1) / 2 : (z0 + z1) / 2;
    if (alongX) { this.sign('board', mid, 3.4, z0 - 0.05, 0, 2.4, 0.6, route, '#101418', '#ffb02a'); this.sign('board', mid, 3.4, z1 + 0.05, Math.PI, 2.4, 0.6, route, '#101418', '#ffb02a'); }
    else { this.sign('board', x0 - 0.05, 3.4, mid, -Math.PI / 2, 2.4, 0.6, route, '#101418', '#ffb02a'); this.sign('board', x1 + 0.05, 3.4, mid, Math.PI / 2, 2.4, 0.6, route, '#101418', '#ffb02a'); }
  }

  /** A solid stone planter with a clipped hedge (cover to head height). */
  hedge(r: R, h = 2.2) {
    this.planter(r, 0, h);
  }

  /** A low wall: solid, knee to chest high. */
  wallBox(r: R, h: number, style: BlockStyle = 'slab', color = 0xb8b4ae) {
    this.box(r, 0, h, style, color);
  }
}
