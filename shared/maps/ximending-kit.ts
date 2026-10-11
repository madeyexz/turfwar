import { rng } from '../math';
import { C, TINTS, Town, shadeHex, type R, type Side } from './sanchong-kit';
import type { BlockStyle } from './types';

/**
 * Street furniture and shopfronts for Ximending (ximending.ts), on top of the walk-up kit that
 * Sanchong shares (sanchong-kit.ts): neon fascias and roofline tubes, booths, vans, stalls under
 * tarps, bus shelters, hoardings, shipping containers and scaffold. Rectangles are map
 * coordinates [x0, z0, x1, z1] (+x east, +z south); everything a soldier can reach has a collider.
 */
export { C, TINTS, shadeHex };
export type { R, Side };

/** Neon sign colours: tube red, magenta, cyan, amber, violet, green. */
export const NEON = [0xff3a5a, 0xff4ad0, 0x4af0ff, 0xffb02a, 0xa86aff, 0x5aff8a] as const;

/** Shop signs: [zh, en, background, text]. The names are generic (a noodle shop, a game hall), not brands. */
export const SHOPS: [string, string, string, string][] = [
  ['潮流服飾', 'STREETWEAR', '#141414', '#5af0ff'], ['手搖飲', 'TEA BAR', '#e94b77', '#ffffff'], ['麵線', 'NOODLES', '#f0c040', '#7a1010'],
  ['電玩', 'ARCADE', '#2c2c54', '#ffd24a'], ['滷味', 'BRAISED SNACKS', '#c8141e', '#ffe9b0'], ['藥妝', 'DRUGSTORE', '#ffffff', '#1d6fb8'],
  ['刺青', 'TATTOO', '#101418', '#ff4ad0'], ['鞋店', 'SNEAKERS', '#ffcc00', '#c8141e'], ['雞排', 'FRIED CHICKEN', '#ff7a1a', '#ffffff'],
  ['卡拉OK', 'KTV', '#7a2ab0', '#ffe0ff'], ['娃娃機', 'CLAW GAMES', '#1aa06a', '#ffffff'], ['眼鏡', 'OPTICAL', '#ffd24a', '#1a1a1a'],
  ['豆花', 'TOFU PUDDING', '#f0e8d0', '#c8141e'], ['唱片行', 'RECORDS', '#3a2a6a', '#ffffff'], ['冰品', 'SHAVED ICE', '#2ab0c8', '#ffffff'],
  ['手機配件', 'PHONE GEAR', '#0a4a8a', '#ffe24a'], ['鐵板燒', 'TEPPANYAKI', '#3a3e44', '#ffb02a'], ['美甲', 'NAILS', '#e04a8a', '#ffffff'],
];

export class Ximen extends Town {
  private shopCount = 0;

  /** A lit shop sign board over the ground floor of a street face, and neon tubes along the roofline. */
  fascia(r: R, side: Side, seed: number, opts: { roof?: number; y?: number; arcade?: number } = {}) {
    const [x0, z0, x1, z1] = r, alongX = side === 'n' || side === 's', out = side === 'n' || side === 'w' ? -1 : 1;
    const lo = alongX ? x0 : z0, hi = alongX ? x1 : z1, face = side === 'n' ? z0 : side === 's' ? z1 : side === 'w' ? x0 : x1;
    const random = rng(seed * 31 + 5), y = opts.y ?? 3.75, rotY = alongX ? (out > 0 ? Math.PI : 0) : (out > 0 ? Math.PI / 2 : -Math.PI / 2);
    // Boards, one per 6 m or so.
    const n = Math.max(1, Math.floor((hi - lo) / 6.5)), step = (hi - lo) / n;
    for (let i = 0; i < n; i++) {
      const [zh, en, bg, fg] = SHOPS[(this.shopCount++ * 5 + Math.floor(random() * 4)) % SHOPS.length];
      const w = Math.min(step - 0.6, 4.8), along = lo + step * (i + 0.5), at = face + out * 0.06;
      this.sign('board', alongX ? along : at, y, alongX ? at : along, rotY, w, 0.8, zh, bg, fg, en);
    }
    // A vertical neon blade standing out from the wall, in a tube colour.
    const colour = NEON[Math.floor(random() * NEON.length)];
    if (opts.roof !== undefined && hi - lo > 6) {
      const [zh, , bg, fg] = SHOPS[(this.shopCount++ * 3) % SHOPS.length], along = lo + (hi - lo) * (0.2 + random() * 0.6);
      const height = Math.min(opts.roof - 6.2, 5.2), at = face + out * 0.7;
      if (height > 2.5) {
        this.sign('blade', alongX ? along : at, opts.roof - 1 - height / 2, alongX ? at : along, rotY, 0.9, height, zh, bg, fg);
        // Its brackets to the wall, top and bottom.
        for (const by of [opts.roof - 1.1, opts.roof - 1 - height + 0.1]) {
          const [w0, w1] = [Math.min(face, at), Math.max(face, at)];
          this.shape(alongX ? [along - 0.035, w0, along + 0.035, w1] : [w0, along - 0.035, w1, along + 0.035], by - 0.05, by + 0.05, 'steel', C.iron);
        }
      }
      // The tube along the parapet.
      const strip: R = alongX ? [lo + 0.3, face + out * 0.02 - 0.04, hi - 0.3, face + out * 0.02 + 0.04] : [face + out * 0.02 - 0.04, lo + 0.3, face + out * 0.02 + 0.04, hi - 0.3];
      this.shape(strip, opts.roof - 0.25, opts.roof - 0.15, 'neon', colour);
    }
  }

  /** A walk-up with fascias on every street side. Returns the roof height. */
  walkup(r: R, floors: number, tint: number, seed: number, street: string, arcade?: Side) {
    const sides = [...street] as Side[];
    const h = this.apartment(r, floors, tint, seed, { street: sides, blades: 1, ...(arcade ? { arcade: [arcade, 3.5] as [Side, number] } : {}) });
    for (const s of sides) this.fascia(r, s, seed + s.charCodeAt(0), { roof: h });
    return h;
  }

  /**
   * A kiosk (檳榔攤, lottery stand) with a counter, a lit window and an awning over the side it opens
   * on, `facing`, and its lit board standing on the awning there (cover: the whole box). The awning
   * overhangs only the open side and the two ends, never the back (a van may park against it).
   */
  booth(r: R, facing: Side, zh: string, en: string, color: number, bg = '#18a050') {
    const [x0, z0, x1, z1] = r;
    const alongX = facing === 'n' || facing === 's', out = facing === 'n' || facing === 'w' ? -1 : 1;
    this.box(r, 0, 0.95, 'painted', 0xe8e8e0);
    this.box([x0 + 0.05, z0 + 0.05, x1 - 0.05, z1 - 0.05], 0.95, 2.45, 'painted', 0x9ab4b8);
    // The awning: 12 cm proud on the open side and the ends, flush at the back.
    const g = 0.12, awning: R = [x0 - (facing === 'e' ? 0 : g), z0 - (facing === 's' ? 0 : g), x1 + (facing === 'w' ? 0 : g), z1 + (facing === 'n' ? 0 : g)];
    this.box(awning, 2.45, 2.7, 'painted', color);
    const face = facing === 'n' ? z0 : facing === 's' ? z1 : facing === 'w' ? x0 : x1;
    const rotY = alongX ? (out > 0 ? Math.PI : 0) : (out > 0 ? Math.PI / 2 : -Math.PI / 2);
    const mid = alongX ? (x0 + x1) / 2 : (z0 + z1) / 2, len = alongX ? x1 - x0 : z1 - z0;
    // The lit window over the counter on the open side, and the vendor's shelves behind it.
    const lo = (alongX ? x0 : z0) + 0.15, hi = (alongX ? x1 : z1) - 0.15, w0 = Math.min(face, face + out * 0.03), w1 = Math.max(face, face + out * 0.03);
    this.shape(alongX ? [lo, w0, hi, w1] : [w0, lo, w1, hi], 1.1, 2.3, 'light');
    this.shape(alongX ? [lo, w0 - 0.01, hi, w1 + 0.01] : [w0 - 0.01, lo, w1 + 0.01, hi], 1.62, 1.66, 'steel', C.iron);
    // The board stands on the awning's front edge; the neon tube runs along it.
    const at = face + out * 0.06;
    this.sign('board', alongX ? mid : at, 3.05, alongX ? at : mid, rotY, Math.min(len, 3.4), 0.7, zh, bg, '#ffffff', en);
    const edge = face + out * g, e0 = Math.min(edge, edge - out * 0.04), e1 = Math.max(edge, edge - out * 0.04);
    this.shape(alongX ? [x0 - g, e0, x1 + g, e1] : [e0, z0 - g, e1, z1 + g], 2.5, 2.58, 'neon', NEON[(x0 * 3 + z0) & 3 & 1 ? 1 : 2]);
  }

  /** A bus shelter: a glass back panel and posts under a roof (the panel and posts are cover). */
  shelter(x0: number, z0: number, len: number, alongX: boolean, backSide: 1 | -1) {
    const w = 1.6, t = 0.12;
    const [bx0, bz0, bx1, bz1]: R = alongX ? [x0, z0 + (backSide > 0 ? w - t : 0), x0 + len, z0 + (backSide > 0 ? w : t)] : [x0 + (backSide > 0 ? w - t : 0), z0, x0 + (backSide > 0 ? w : t), z0 + len];
    this.box([bx0, bz0, bx1, bz1], 0, 2.1, 'glass', 0x9ac0cc);
    const roof: R = alongX ? [x0 - 0.2, z0 - 0.2, x0 + len + 0.2, z0 + w + 0.2] : [x0 - 0.2, z0 - 0.2, x0 + w + 0.2, z0 + len + 0.2];
    this.shape(roof, 2.45, 2.6, 'steel', C.iron);
    for (const p of [0, len]) {
      const post: R = alongX ? [x0 + p - 0.06, z0 + (backSide > 0 ? 0 : w - 0.12), x0 + p + 0.06, z0 + (backSide > 0 ? 0.12 : w)] : [x0 + (backSide > 0 ? 0 : w - 0.12), z0 + p - 0.06, x0 + (backSide > 0 ? 0.12 : w), z0 + p + 0.06];
      this.box(post, 0, 2.45, 'steel', C.iron);
    }
    // A lit timetable panel on the back.
    const mx = alongX ? x0 + len / 2 : (bx0 + bx1) / 2, mz = alongX ? (bz0 + bz1) / 2 : z0 + len / 2;
    this.sign('board', mx, 1.35, mz, alongX ? (backSide > 0 ? 0 : Math.PI) : (backSide > 0 ? -Math.PI / 2 : Math.PI / 2), Math.min(len - 0.4, 1.8), 0.9, '公車站', '#1f4fa0', '#ffffff', 'BUS');
  }

  /** A concrete jersey barrier, knee-high cover. */
  jersey(r: R, color = 0xb8b6ae) {
    this.box(r, 0, 0.85, 'concrete', color);
    this.shape([r[0] + 0.02, r[1] + 0.02, r[2] - 0.02, r[3] - 0.02], 0.85, 0.9, 'concrete', shadeHex(color, 0.9));
  }

  /** A stripe-painted construction hoarding, 2.4 m high (full cover), with a sign on one face. */
  hoarding(r: R, side: Side, text?: [string, string], color = 0x3a6a8a) {
    this.box(r, 0, 2.4, 'painted', color);
    const [x0, z0, x1, z1] = r, alongX = x1 - x0 >= z1 - z0, len = alongX ? x1 - x0 : z1 - z0;
    this.shape([x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02], 2.4, 2.5, 'steel', 0xb8bcc0);
    if (alongX) for (let x = x0 + 0.8; x < x1; x += 2.4) this.shape([x - 0.03, z0 - 0.04, x + 0.03, z1 + 0.04], 0, 2.4, 'steel', 0x2a3a4a);
    else for (let z = z0 + 0.8; z < z1; z += 2.4) this.shape([x0 - 0.04, z - 0.03, x1 + 0.04, z + 0.03], 0, 2.4, 'steel', 0x2a3a4a);
    if (text && len > 3) {
      const out = side === 'n' || side === 'w' ? -1 : 1, rotY = side === 'n' ? 0 : side === 's' ? Math.PI : side === 'w' ? -Math.PI / 2 : Math.PI / 2;
      const px = side === 'w' ? x0 - 0.04 : side === 'e' ? x1 + 0.04 : (x0 + x1) / 2, pz = side === 'n' ? z0 - 0.04 : side === 's' ? z1 + 0.04 : (z0 + z1) / 2;
      this.sign('board', px, 1.55, pz, rotY, Math.min(len - 0.5, 4.5), 1.1, text[0], '#f2c400', '#1a1a1a', text[1]);
      void out;
    }
  }

  /** A shipping container, 6 × 2.4 and 2.6 high by default (cover; a flat roof to climb onto). */
  container(r: R, color: number, y = 0, h = 2.6) {
    // Painted (the rusty plate behind 'steel' turns a container's colour near black in the shade).
    this.box(r, y, y + h, 'painted', color);
    const [x0, z0, x1, z1] = r, alongX = x1 - x0 >= z1 - z0;
    // Corrugation ribs.
    const len = alongX ? x1 - x0 : z1 - z0;
    for (let i = 1; i < Math.floor(len / 0.5); i++) {
      const p = (alongX ? x0 : z0) + i * 0.5;
      this.shape(alongX ? [p - 0.03, z0 - 0.03, p + 0.03, z1 + 0.03] : [x0 - 0.03, p - 0.03, x1 + 0.03, p + 0.03], y + 0.1, y + h - 0.1, 'painted', shadeHex(color, 0.82));
    }
  }

  /** A market stall under a tarp, roof high enough to walk under; the counter is cover. */
  tarpStall(r: R, tarp: number, seed: number) {
    this.stall(r, tarp, [0xd84a2a, 0x7ab040, 0xe8c040, 0xf0ece0].slice(seed % 2));
  }

  /** A lantern: a lit globe with a gold cap, hanging on a cord from whatever is above it at `from` (decorative, out of reach). */
  lantern(x: number, y: number, z: number, color = 0xff3a2a, from = y + 0.5) {
    this.raw({ kind: 'ball', x, y, z, radius: 0.28, style: 'neon', color });
    this.shape([x - 0.08, z - 0.08, x + 0.08, z + 0.08], y + 0.28, y + 0.38, 'steel', 0xd8a838);
    if (from > y + 0.38) this.shape([x - 0.012, z - 0.012, x + 0.012, z + 0.012], y + 0.38, from, 'painted', 0x18181a);
  }

  /** A street lamp: a pole with a lit head over the kerb (the pole is cover). */
  lamp(x: number, z: number, h = 6.5) {
    this.box([x - 0.12, z - 0.12, x + 0.12, z + 0.12], 0, h, 'steel', 0x4a4e54);
    this.shape([x - 0.5, z - 0.12, x + 0.12, z + 0.12], h - 0.1, h + 0.1, 'steel', 0x4a4e54);
    this.shape([x - 0.48, z - 0.1, x - 0.1, z + 0.1], h - 0.16, h - 0.1, 'neon', 0xffe6b0);
  }

  /**
   * The collider of a street tree (the renderer's 'tree:camphor', its trunk 4.6 m at scale 1): up
   * the trunk and into the crown where the limbs spread, so it is cover and nobody can stand on it.
   */
  trunk(x: number, z: number, scale = 1) {
    this.box([x - 0.35, z - 0.35, x + 0.35, z + 0.35], 0, 4.6 * scale + 1, 'invisible');
  }

  /** Paving and paint on the ground over a rectangle (decorative, flush). */
  floor(r: R, color: number, style: BlockStyle = 'paving', y0 = -0.02, y1 = 0.012) {
    this.shape(r, y0, y1, style, color);
  }
}
