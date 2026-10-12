import { rng } from '../../shared/math';

/**
 * The models the dressing renderer instances (src/render/dressing.ts), built in code from boxes,
 * prisms and leaf cards: a Taiwanese 125 cc scooter, street trees and potted plants. Each model is
 * a triangle soup with colours (the instance colour tints them), an optional part tag per vertex
 * (the scooter's top box and delivery box) and a flag for the upper side of a crown. They face
 * local +z and stand on y = 0.
 */
export interface ModelData { position: number[]; normal?: number[]; uv?: number[]; color?: number[]; tag?: number[]; top?: number[] }

type Vec = [number, number, number];

/** A small triangle-soup builder. Faces are quads given counter-clockwise as seen from outside. */
class Soup {
  position: number[] = []; color: number[] = []; uv: number[] = []; tag: number[] = []; top: number[] = [];

  private tri(a: Vec, b: Vec, c: Vec, rgb: Vec, uv: [number, number][], tag: number, top: number) {
    for (const [i, p] of [a, b, c].entries()) {
      this.position.push(...p); this.color.push(...rgb); this.uv.push(...uv[i]); this.tag.push(tag, 0, 0); this.top.push(top);
    }
  }
  quad(a: Vec, b: Vec, c: Vec, d: Vec, rgb: Vec, tag = 0, uv: [number, number][] = [[0.06, 0.94], [0.06, 0.94], [0.06, 0.94], [0.06, 0.94]], top = 0) {
    this.tri(a, b, c, rgb, [uv[0], uv[1], uv[2]], tag, top);
    this.tri(a, c, d, rgb, [uv[0], uv[2], uv[3]], tag, top);
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number, tag = 0) {
    const c = rgb(hex);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], c, tag);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], c, tag);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], c, tag);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], c, tag);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], c, tag);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], c, tag);
  }

  /** Upright prism from r0 at y0 to r1 at y1 (a frustum), capped on top. */
  prism(x: number, z: number, y0: number, y1: number, r0: number, r1: number, sides: number, hex: number, tag = 0) {
    const c = rgb(hex);
    const at = (i: number, y: number, r: number): Vec => [x + Math.cos((i / sides) * Math.PI * 2) * r, y, z + Math.sin((i / sides) * Math.PI * 2) * r];
    for (let i = 0; i < sides; i++) {
      this.quad(at(i + 1, y0, r0), at(i, y0, r0), at(i, y1, r1), at(i + 1, y1, r1), c, tag);
      if (r1 > 0) this.tri([x, y1, z], at(i + 1, y1, r1), at(i, y1, r1), c, [[0.06, 0.94], [0.06, 0.94], [0.06, 0.94]], tag, 0);
    }
  }

  /** A wheel or roller: a prism lying along x, between x0 and x1. */
  roller(x0: number, x1: number, y: number, z: number, r: number, sides: number, hex: number) {
    const c = rgb(hex);
    const at = (i: number, xx: number): Vec => [xx, y + Math.cos((i / sides) * Math.PI * 2) * r, z + Math.sin((i / sides) * Math.PI * 2) * r];
    for (let i = 0; i < sides; i++) {
      this.quad(at(i, x1), at(i + 1, x1), at(i + 1, x0), at(i, x0), c);
      this.tri([x1, y, z], at(i, x1), at(i + 1, x1), c, [[0.06, 0.94], [0.06, 0.94], [0.06, 0.94]], 0, 0);
      this.tri([x0, y, z], at(i + 1, x0), at(i, x0), c, [[0.06, 0.94], [0.06, 0.94], [0.06, 0.94]], 0, 0);
    }
  }

  /** A leaf card: a square of side `size` centred at `at`, turned about y by `yaw` and tipped by `tilt`. */
  card(at: Vec, size: number, yaw: number, tilt: number, hex: number, top = 0) {
    const c = rgb(hex), h = size / 2;
    const ct = Math.cos(tilt), st = Math.sin(tilt), cy = Math.cos(yaw), sy = Math.sin(yaw);
    // Local corners (u along the card, v up its face), tipped about the u axis then turned about y.
    const p = (u: number, v: number): Vec => {
      const vy = v * ct, vz = v * st;
      return [at[0] + u * cy + vz * sy, at[1] + vy, at[2] - u * sy + vz * cy];
    };
    this.quad(p(-h, -h), p(h, -h), p(h, h), p(-h, h), c, 0, LEAF_UV, top);
  }

  data(): ModelData { return { position: this.position, color: this.color, uv: this.uv, tag: this.tag, top: this.top }; }
}

/** The leaf texture's leafy part (its white corner, drawn for trunks, is left out). */
const LEAF_UV: [number, number][] = [[0.16, 0.16], [0.96, 0.16], [0.96, 0.96], [0.16, 0.96]];

function rgb(hex: number): Vec { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }

/** A 125 cc scooter, 1.8 m long. Body panels are white (the instance colour paints them); tag 1 is the top box, tag 2 the delivery box. */
function scooter(): ModelData {
  const s = new Soup(), TYRE = 0x161618, SEAT = 0x25262a, CHROME = 0x8a8e92;
  s.roller(-0.06, 0.06, 0.24, -0.6, 0.24, 10, TYRE);          // rear wheel
  s.roller(-0.05, 0.05, 0.22, 0.66, 0.22, 10, TYRE);          // front wheel
  s.box(-0.2, 0.2, -0.05, 0.2, 0.27, 0.5, 0xffffff);          // floorboard
  s.box(-0.27, 0.3, -0.75, 0.27, 0.64, 0.02, 0xffffff);       // rear body and cowl
  s.box(-0.18, 0.64, -0.62, 0.18, 0.74, 0.0, SEAT);           // seat
  s.box(-0.2, 0.27, 0.45, 0.2, 1.02, 0.58, 0xffffff);         // leg shield
  s.box(-0.04, 0.2, 0.58, 0.04, 0.92, 0.66, CHROME);          // fork
  s.box(-0.36, 0.98, 0.5, 0.36, 1.04, 0.6, SEAT);             // handlebar
  s.box(-0.1, 0.86, 0.6, 0.1, 0.98, 0.7, 0xfff0c0);           // headlight
  s.box(-0.1, 0.5, -0.78, 0.1, 0.58, -0.74, 0xc01818);        // tail light
  s.box(-0.1, 0.18, -0.82, 0.1, 0.26, -0.5, CHROME);          // exhaust
  s.box(-0.2, 0.74, -0.95, 0.2, 1.12, -0.58, 0xffffff, 1);    // top box
  s.box(-0.27, 0.74, -1.02, 0.27, 1.36, -0.52, 0xffffff, 2);  // delivery box
  return s.data();
}

/** A street tree: a trunk and a crown of leaf cards. `reach` is the crown's radius, `base` the height it starts at. */
function tree(seed: number, trunkR: number, trunk: number, reach: number, cards: number, size: number, roots = 0): ModelData {
  const s = new Soup(), r = rng(seed), BARK = 0x5a4632;
  s.prism(0, 0, 0, trunk, trunkR * 1.35, trunkR, 8, BARK);
  // Limbs spreading into the crown.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r(), len = reach * 0.6;
    s.box(Math.cos(a) * len * 0.5 - 0.1, trunk + len * 0.25 - 0.1, Math.sin(a) * len * 0.5 - 0.1, Math.cos(a) * len * 0.5 + 0.1, trunk + len * 0.25 + 0.1, Math.sin(a) * len * 0.5 + 0.1, BARK);
  }
  for (let i = 0; i < cards; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * reach, up = trunk + reach * (0.15 + r() * 0.8) * (1 - (d / reach) * 0.35);
    const shade = 0.78 + r() * 0.3, g = Math.round(255 * shade);
    s.card([Math.cos(a) * d, up, Math.sin(a) * d], size * (0.8 + r() * 0.5), r() * Math.PI, (r() - 0.5) * 1.3, (g << 16) | (g << 8) | g, up > trunk + reach * 0.7 ? 1 : 0);
  }
  // Aerial roots hanging from the banyan's limbs.
  for (let i = 0; i < roots; i++) {
    const a = r() * Math.PI * 2, d = reach * (0.3 + r() * 0.5), h = 1.5 + r() * 2.5;
    s.box(Math.cos(a) * d - 0.03, trunk - h + 1.2, Math.sin(a) * d - 0.03, Math.cos(a) * d + 0.03, trunk + 1.2, Math.sin(a) * d + 0.03, 0x6a5a40);
  }
  return s.data();
}

/** Plants for lobbies and offices: the origin is the rim of the pot the map draws under them. */
function plant(seed: number, kind: 'moneyTree' | 'bush' | 'clump'): ModelData {
  const s = new Soup(), r = rng(seed);
  if (kind === 'clump') {
    // Grass and strap leaves in a low tuft.
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2, d = r() * 0.25;
      s.card([Math.cos(a) * d, 0.3 + r() * 0.2, Math.sin(a) * d], 0.55 + r() * 0.3, r() * Math.PI, (r() - 0.5) * 0.9, 0xffffff);
    }
    return s.data();
  }
  if (kind === 'bush') {
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2, d = r() * 0.3;
      s.card([Math.cos(a) * d, 0.2 + r() * 0.6, Math.sin(a) * d], 0.7 + r() * 0.3, r() * Math.PI, (r() - 0.5) * 1.2, 0xffffff);
    }
    return s.data();
  }
  s.prism(0, 0, 0, 0.75, 0.05, 0.035, 6, 0x6a5a40);
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2, d = r() * 0.28;
    s.card([Math.cos(a) * d, 0.7 + r() * 0.5, Math.sin(a) * d], 0.55 + r() * 0.25, r() * Math.PI, (r() - 0.5) * 1.1, 0xffffff);
  }
  return s.data();
}

let built: Record<string, ModelData> | undefined;
/** Every instanced model, built on first use. */
export function builtModels(): Record<string, ModelData> {
  return built ??= {
    scooter: scooter(),
    'tree:camphor': tree(11, 0.28, 4.6, 4.2, 26, 3.6),
    'tree:banyan': tree(23, 0.45, 3.4, 6.2, 34, 4.2, 14),
    'plant:moneyTree': plant(31, 'moneyTree'),
    'plant:bush': plant(37, 'bush'),
    'plant:clump': plant(41, 'clump'),
  };
}
