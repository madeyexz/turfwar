import type { MapBuilder } from './builder';
import type { Shift } from './taipei-decor';
import type { BlockStyle } from './types';

/**
 * Enterable ground floors and rooftop access in Ximending (a gameplay layer over the source's
 * district, which draws its shops as closed fronts). Each building listed here replaces its source
 * collision box: a shop storey behind open storefronts (doors and glass where the source hangs the
 * shop's front), fitted out as cover (counters, shelves, fridges, claw machines, tea bars), the
 * storeys above as one mass, and on two buildings a way up: a switchback stair to the roof of the
 * 7-TWELVE / claw-machine corner on Emei and Hanzhong streets, and a ladder shaft to the roof over
 * Wuchang St by bomb site A. Their roofs get parapets to fight from.
 *
 * Coordinates are the source's (x east, z south); `cuts` collects the boxes (map coordinates) where
 * the renderer drops the source's own ground-floor shopfront so these interiors show instead.
 */
type Side = 'n' | 's' | 'e' | 'w';
/** An opening along a wall: [from, to] along it (x on n/s walls, z on e/w), a door or shop glass. */
interface Opening { side: Side; a: number; b: number; glass?: boolean }
interface Shop {
  rect: [number, number, number, number];
  top: number;
  openings: Opening[];
  wall: number;
  fit: (f: Fitter) => void;
  /** Rect kept open from the ground to the roof (a stairwell or ladder shaft). */
  shaft?: [number, number, number, number];
  climb?: (f: Fitter) => void;
  parapet?: boolean;
}
export const SHOP_STOREY = 4.2;
const KERB = 0.15, T = 0.25;

export interface Fitter {
  /** Collidable box on source corners. */
  box(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, style: BlockStyle, color?: number): void;
  /** Visual-only box. */
  shape(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, style: BlockStyle, color?: number): void;
  b: MapBuilder; s: Shift;
}

/*
 * Cover stands between the lines of the bots' navigation grid (nodes every 2.5 m from the playable
 * bounds plus 1 m: source x -881 + 2.5k, z -305 + 2.5k), so every aisle keeps a line of nodes.
 * Shelves and counters are centred on the midlines (x -879.75 + 2.5k, z -303.75 + 2.5k) and are at
 * most 1.5 m deep.
 */
const SHELF = 0xf0f0ec, WOOD = 0x6a4a34;

const SHOPS: Shop[] = [
  // 7-TWELVE (south front on Emei St) and the claw-machine shop (east front on Hanzhong St), one
  // storey through, with a switchback stair in the north-west corner up to the 13.9 m roof.
  {
    rect: [-787, -230, -763.3, -213.3], top: 13.9, wall: 0xe8e2d6, parapet: true,
    openings: [
      { side: 's', a: -773.3, b: -770.6 }, { side: 's', a: -770.4, b: -764.6, glass: true },
      { side: 'e', a: -222.6, b: -220.2 }, { side: 'e', a: -219.8, b: -216.8, glass: true },
      { side: 's', a: -784, b: -776.5, glass: true },
    ],
    shaft: [-786.75, -229.75, -777.5, -223.75],
    fit: f => {
      for (const x of [-774.75, -772.25, -769.75]) f.box(x - 0.25, -222.5, x + 0.25, -216.5, KERB, 1.55, 'steel', SHELF);
      f.box(-776, -229.6, -765, -228.9, KERB, 2.1, 'glass');                         // fridge wall
      claws(f, -764.75, -224, -764.75, -218.4);
      f.box(-768.4, -216.75, -765.6, -215.75, KERB, 1.05, 'wood', 0xf2f2ee);           // till
      f.box(-782.5, -221, -782, -216, KERB, 1.6, 'steel', 0xd8dadc);                  // magazine rack
      f.box(-786.5, -218.75, -785.6, -216.25, KERB, 1.05, 'wood', WOOD);              // ATM and copier corner
    },
    climb: f => stairs(f, [-786.75, -229.75, -777.5, -223.75], -226.25, KERB, 13.9),
  },
  // The corner building over Wuchang St (site A): a figure shop with a ladder shaft to its 17.9 m roof.
  {
    rect: [-832, -278.1, -819.3, -259.3], top: 17.9, wall: 0xeadcc0, parapet: true,
    openings: [{ side: 's', a: -830.6, b: -828.2 }, { side: 's', a: -827.8, b: -821, glass: true }, { side: 'e', a: -265, b: -262.6 }],
    shaft: [-821.2, -277.85, -819.55, -276.1],
    fit: f => {
      for (const z of [-271.25, -266.25]) f.box(-830, z - 0.35, -823, z + 0.35, KERB, 1.8, 'steel', 0xc8b49a);   // display cases
      f.box(-824.5, -264.25, -822, -263.25, KERB, 1.05, 'wood', 0x5a3a2a);           // till
      f.box(-831.5, -277.6, -823, -276.9, KERB, 2.2, 'wood', 0x7a5a3a);               // back shelves
    },
    climb: f => ladderShaft(f, [-821.2, -277.85, -819.55, -276.1], 17.9),
  },
  // 51嵐 tea shop on Wuchang St, facing site A: a long bar and a queue rail.
  {
    rect: [-829.6, -246.7, -819.3, -229], top: 31.9, wall: 0xd8e4ec,
    openings: [{ side: 'n', a: -828.8, b: -826.4 }, { side: 'n', a: -826, b: -820.2, glass: true }],
    fit: f => {
      f.box(-828.5, -241.7, -821, -240.8, KERB, 1.1, 'wood', 0x2a5a8a);               // order bar
      f.box(-828.5, -236.55, -821, -235.95, KERB, 2.0, 'steel', 0xe6e6e2);            // tea machines
      f.box(-828.5, -231.7, -826, -230.8, KERB, 1.2, 'steel', 0x9aa0a6);              // ice chest
      f.box(-824.9, -245, -824.6, -242.2, KERB, 1.0, 'steel', 0xb0b4b8);              // queue rail
    },
  },
  // 7-TWELVE at the Hanzhong St / Emei St corner by the gateway (doors on both streets).
  {
    rect: [-776, -200.7, -763.3, -178.4], top: 13.9, wall: 0xeadcc0,
    openings: [{ side: 'e', a: -186.4, b: -184 }, { side: 'e', a: -183.6, b: -179.4, glass: true }, { side: 'n', a: -770.5, b: -768.1 }],
    fit: f => {
      for (const x of [-772.25, -769.75]) f.box(x - 0.25, -197, x + 0.25, -190, KERB, 1.55, 'steel', SHELF);
      f.box(-775.6, -199, -774.9, -180, KERB, 2.1, 'glass');                          // fridge wall
      f.box(-767.75, -182.5, -766.75, -180.5, KERB, 1.05, 'wood', 0xf2f2ee);          // till
    },
  },
  // 7-TWELVE and the claw-machine shop facing Hanzhong St (west), with a side door on Emei St.
  {
    rect: [-750.7, -200.7, -735, -178.4], top: 21.9, wall: 0xc4c8cc,
    openings: [{ side: 'w', a: -197.6, b: -195.2 }, { side: 'w', a: -194.8, b: -191, glass: true }, { side: 'w', a: -187.4, b: -183.8 }, { side: 'n', a: -742, b: -739.6 }],
    fit: f => {
      for (const x of [-744.75, -742.25]) f.box(x - 0.25, -199, x + 0.25, -192.5, KERB, 1.55, 'steel', SHELF);
      f.box(-735.9, -199, -735.3, -192, KERB, 2.1, 'glass');                          // fridge wall
      f.box(-749.5, -194.25, -747.5, -193.25, KERB, 1.05, 'wood', 0xf2f2ee);          // till
      claws(f, -746, -188.75, -737, -188.75);
      claws(f, -746, -181.25, -737, -181.25);
    },
  },
];

/** A row of claw machines (tall cabinets) between two points. */
function claws(f: Fitter, x0: number, z0: number, x1: number, z1: number) {
  const n = Math.max(1, Math.floor(Math.hypot(x1 - x0, z1 - z0) / 1.1));
  const colors = [0xff7ab8, 0x7ad0ff, 0xffd84a, 0xb88aff];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1), x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    f.box(x - 0.45, z - 0.45, x + 0.45, z + 0.45, KERB, 2.0, 'steel', colors[i % colors.length]);
    f.shape(x - 0.42, z - 0.42, x + 0.42, z + 0.42, 2.0, 2.06, 'light');
  }
}

/**
 * Switchback stair in a shaft (flights along x in two lanes split at z = mid), landings at both
 * ends (the east one 2.5 m deep so a line of nav nodes rests on it), from y0 to the roof.
 */
function stairs(f: Fitter, [x0, z0, x1, z1]: [number, number, number, number], mid: number, y0: number, top: number) {
  const flights = 6, rise = (top - y0) / flights;
  const xs = x0 + 1.4, xe = x1 - 2.5, s = f.s;
  for (let k = 0; k < flights; k++) {
    const a = y0 + k * rise, b = a + rise, east = k % 2 === 0;
    const [lz0, lz1] = east ? [z0, mid] : [mid, z1];
    // b.stairs centres on (x, z) and rises toward dir: 0 = +x (east), 2 = -x (west).
    f.b.stairs(s.X((xs + xe) / 2), s.Z((lz0 + lz1) / 2), xe - xs, lz1 - lz0, a, b, east ? 0 : 2);
    // Landing at the top of the flight across both lanes.
    const [lx0, lx1] = east ? [xe, x1] : [x0, xs];
    f.box(lx0, z0, lx1, z1, b - 0.25, b, 'slab', 0xb8b4ac);
  }
  // Rails between the lanes and the shaft lining.
  f.shape(xs, mid - 0.03, xe, mid + 0.03, y0, top + 1, 'steel', 0x5a5e62);
  lining(f, [x0, z0, x1, z1], SHOP_STOREY, top, 0xe8e2d6);
  // The rooftop stair house: walls on three sides and a roof, open toward the roof's south.
  const h = top + 2.7;
  f.box(x0, z0 - 0.2, x1, z0, top, h, 'plaster', 0xd8d4cc);
  f.box(x1, z0 - 0.2, x1 + 0.2, z1 + 0.2, top, h, 'plaster', 0xd8d4cc);
  f.box(x0 - 0.2, z0 - 0.2, x0, z1 + 0.2, top, h, 'plaster', 0xd8d4cc);
  f.box(x0 + 2.4, z1, x1, z1 + 0.2, top, h, 'plaster', 0xd8d4cc);
  f.box(x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2, h, h + 0.2, 'slab', 0xb8b4ac);
}

/** A ladder up a 1.65 m shaft to the roof (rungs on the shaft's west wall, stepping off west onto the roof). */
function ladderShaft(f: Fitter, r: [number, number, number, number], top: number) {
  const [x0, z0, x1, z1] = r, s = f.s;
  lining(f, r, SHOP_STOREY, top, 0xeadcc0);
  // The ladder's wall: a pier from the floor to the roof on the shaft's west side.
  f.box(x0 - 0.3, z0, x0, z1, KERB, SHOP_STOREY, 'plaster', 0xeadcc0);
  f.b.ladder(s.X(x0), s.Z((z0 + z1) / 2), KERB, top, 2);
  // A hatch housing on the roof, open to the west.
  f.box(x0 - 0.15, z0 - 0.15, x1 + 0.15, z0, top, top + 1.2, 'steel', 0x8a9096);
  f.box(x0 - 0.15, z1, x1 + 0.15, z1 + 0.15, top, top + 1.2, 'steel', 0x8a9096);
  f.box(x1, z0, x1 + 0.15, z1, top, top + 1.2, 'steel', 0x8a9096);
}

/** Visual walls lining a shaft from y0 to y1 (the district's own meshes draw only the outside). */
function lining(f: Fitter, [x0, z0, x1, z1]: [number, number, number, number], y0: number, y1: number, color: number) {
  const t = 0.05;
  f.shape(x0, z0, x1, z0 + t, y0, y1, 'plaster', color);
  f.shape(x0, z1 - t, x1, z1, y0, y1, 'plaster', color);
  f.shape(x0, z0, x0 + t, z1, y0, y1, 'plaster', color);
  f.shape(x1 - t, z0, x1, z1, y0, y1, 'plaster', color);
}

/** Rects (source x0, z0, x1, z1, top) of the buildings replaced here, to skip their source boxes. */
export const INTERIOR_BUILDINGS = SHOPS.map(s => [...s.rect, s.top]);

/** Build every interior; returns the cut boxes (map coordinates) for the renderer. */
export function interiors(b: MapBuilder, s: Shift): number[] {
  const cuts: number[] = [];
  const f: Fitter = {
    b, s,
    box: (x0, z0, x1, z1, y0, y1, style, color) => {
      const i = b.box(s.X((x0 + x1) / 2), y0, s.Z((z0 + z1) / 2), x1 - x0, y1 - y0, z1 - z0, style);
      if (color !== undefined && style !== 'invisible') b.paint(i, color);
    },
    shape: (x0, z0, x1, z1, y0, y1, style, color) => b.shape(s.X((x0 + x1) / 2), y0, s.Z((z0 + z1) / 2), x1 - x0, y1 - y0, z1 - z0, style, color),
  };
  for (const shop of SHOPS) {
    const [x0, z0, x1, z1] = shop.rect, gf = SHOP_STOREY;
    // The storeys above as invisible mass (the district meshes draw them), around the shaft.
    mass(f, shop.rect, shop.shaft, gf, shop.top);
    // Ground-floor walls, inset from the facade, broken by the doors and the shop glass.
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      const along = side === 'n' || side === 's', from = along ? x0 : z0, to = along ? x1 : z1;
      const ops = shop.openings.filter(o => o.side === side).sort((p, q) => p.a - q.a);
      const seg = (a: number, c: number, y0: number, y1: number, style: BlockStyle = 'plaster') => {
        if (c - a < 0.05) return;
        const [bx0, bz0, bx1, bz1] = side === 'n' ? [a, z0 + 0.05, c, z0 + 0.05 + T] : side === 's' ? [a, z1 - 0.05 - T, c, z1 - 0.05]
          : side === 'w' ? [x0 + 0.05, a, x0 + 0.05 + T, c] : [x1 - 0.05 - T, a, x1 - 0.05, c];
        f.box(bx0, bz0, bx1, bz1, y0, y1, style, style === 'plaster' ? shop.wall : undefined);
      };
      let cursor = from;
      for (const o of ops) {
        seg(cursor, o.a, KERB, gf);
        if (o.glass) { seg(o.a, o.b, KERB, 0.6); seg(o.a, o.b, 0.6, 2.9, 'glass'); }
        seg(o.a, o.b, 2.9, gf);
        cursor = o.b;
      }
      seg(cursor, to, KERB, gf);
    }
    // Floor, ceiling and lights.
    f.shape(x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3, KERB, KERB + 0.02, 'tile');
    f.shape(x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3, gf - 0.12, gf - 0.02, 'plaster', 0xf4f2ee);
    for (let x = x0 + 2.5; x < x1 - 1.5; x += 4) for (let z = z0 + 2.5; z < z1 - 1.5; z += 4) {
      if (shop.shaft && x > shop.shaft[0] - 1 && x < shop.shaft[2] + 1 && z > shop.shaft[1] - 1 && z < shop.shaft[3] + 1) continue;
      f.shape(x - 0.6, z - 0.3, x + 0.6, z + 0.3, gf - 0.15, gf - 0.12, 'light');
    }
    shop.fit(f);
    shop.climb?.(f);
    if (shop.parapet) parapet(f, shop.rect, shop.top, shop.wall);
    // The renderer drops the source's closed shopfront here (and anything it put over the shaft).
    const pad = 0.9;
    cuts.push(s.X(x0) - pad, 0.05, s.Z(z0) - pad, s.X(x1) + pad, 3.05, s.Z(z1) + pad);
    if (shop.shaft) { const [a, c, d, e] = shop.shaft; cuts.push(s.X(a) - 0.3, shop.top - 0.2, s.Z(c) - 0.3, s.X(d) + 0.3, shop.top + 6, s.Z(e) + 0.3); }
  }
  return cuts;
}

/** Invisible storeys from y0 to y1 over a rect, leaving a hole for the shaft. */
function mass(f: Fitter, [x0, z0, x1, z1]: [number, number, number, number], hole: [number, number, number, number] | undefined, y0: number, y1: number) {
  if (!hole) { f.box(x0, z0, x1, z1, y0, y1, 'invisible'); return; }
  const [hx0, hz0, hx1, hz1] = hole;
  if (hz0 > z0) f.box(x0, z0, x1, hz0, y0, y1, 'invisible');
  if (hz1 < z1) f.box(x0, hz1, x1, z1, y0, y1, 'invisible');
  if (hx0 > x0) f.box(x0, hz0, hx0, hz1, y0, y1, 'invisible');
  if (hx1 < x1) f.box(hx1, hz0, x1, hz1, y0, y1, 'invisible');
}

/** A waist-high parapet round a roof you can reach. */
function parapet(f: Fitter, [x0, z0, x1, z1]: [number, number, number, number], top: number, color: number) {
  const h = top + 1.0, t = 0.25;
  f.box(x0, z0, x1, z0 + t, top, h, 'plaster', color);
  f.box(x0, z1 - t, x1, z1, top, h, 'plaster', color);
  f.box(x0, z0 + t, x0 + t, z1 - t, top, h, 'plaster', color);
  f.box(x1 - t, z0 + t, x1, z1 - t, top, h, 'plaster', color);
}
