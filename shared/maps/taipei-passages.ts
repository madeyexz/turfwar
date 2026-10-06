import type { MapBuilder } from './builder';
import type { Shift } from './taipei-decor';
import { KERB, SHOP_STOREY, type Fitter, type Shop } from './taipei-interiors';
import type { BlockStyle } from './types';

/**
 * Passages through the Ximending blocks (the compact map's interiors, built by taipei-interiors.ts's
 * machinery): the source's blocks are solid, so every street was the only way between two places.
 * These ground floors open through:
 *   - the Ximen Mall (西門商場) through the block in front of SWAT's cordon, from Civic Blvd's
 *     sidewalk to Wuchang St (SWAT's middle way out), its shop rows zig-zagging the walk;
 *   - a karaoke house (KTV) behind the 7-TWELVE from Wuchang St to the 7-TWELVE (and on through it
 *     to Emei St), with a door onto Hanzhong St by the arcade (site B) and a second storey up a
 *     stair, its windows over Hanzhong St and a door onto a plank bridge across to the arcade's
 *     canopy (taipei-compact.ts);
 *   - a run of shops through the block south of Emei St, from Militia's barricade in Xining S. Rd
 *     east to the 7-TWELVE on Hanzhong St, with doors onto Emei St (Militia's east way out);
 *   - a sneaker shop from the barricade west and out onto Zhongxiao W. Rd's sidewalk (Militia's
 *     west way out);
 *   - the cinema's back corridor from its lobby on Cinema Street (site A) to a shop on Emei St and
 *     Xining S. Rd, whose second storey looks over Xining S. Rd;
 *   - a board-game café from Zhonghua Rd's sidewalk into the back of the arcade (site B).
 * Doors and aisles sit on the bots' navigation lines (x -868.5 + 2.5i, z -295 + 2.5j); fittings
 * stand between them.
 *
 * Coordinates are the source's (+x east, +z south, metres).
 */
type Rect = [number, number, number, number];

const PAINT = { mall: 0xf0ece4, ktv: 0x3a2a4a, neon: 0xff5ad8, shop: 0xe8e4dc, wood: 0x6a4a34, shelf: 0xf0f0ec, red: 0xa81c1c };

/** A shop row's partition (2.4 m): painted back, a neon strip and a lit sign along its top. */
function partition(f: Fitter, [x0, z0, x1, z1]: Rect, color: number, neon: number) {
  f.box(x0, z0, x1, z1, KERB, 2.4, 'painted', color);
  f.shape(x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02, 2.3, 2.38, 'neon', neon);
}

/** A low counter (waist-high cover) with a lit top. */
function counter(f: Fitter, [x0, z0, x1, z1]: Rect, color: number, y = KERB) {
  f.box(x0, z0, x1, z1, y, y + 1.05, 'wood', color);
  f.shape(x0 + 0.05, z0 + 0.05, x1 - 0.05, z1 - 0.05, y + 1.05, y + 1.08, 'light');
}

/** Shelving (1.6 m) along a rect. */
function shelves(f: Fitter, [x0, z0, x1, z1]: Rect, y = KERB) {
  f.box(x0, z0, x1, z1, y, y + 1.6, 'painted', PAINT.shelf);
  const alongX = x1 - x0 >= z1 - z0;
  for (const h of [0.5, 1.0, 1.45]) {
    if (alongX) f.shape(x0 + 0.05, z0 - 0.02, x1 - 0.05, z1 + 0.02, y + h, y + h + 0.03, 'painted', 0xc8c4bc);
    else f.shape(x0 - 0.02, z0 + 0.05, x1 + 0.02, z1 - 0.05, y + h, y + h + 0.03, 'painted', 0xc8c4bc);
  }
}

/** A sofa (crouch cover) along a rect, its back on the `back` side. */
function sofa(f: Fitter, [x0, z0, x1, z1]: Rect, y: number, color: number) {
  f.box(x0, z0, x1, z1, y, y + 0.75, 'painted', color);
  f.shape(x0 + 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.1, y + 0.75, y + 0.8, 'painted', 0x1a1a1e);
}

export const PASSAGES: Shop[] = [
  // The Ximen Mall through the block in front of the cordon: doors at both ends a column apart,
  // two shop rows across the walk between them (in at x -786, out at x -781).
  {
    rect: [-791, -278.1, -778, -259.3], top: 14.9, wall: PAINT.mall,
    openings: [
      { side: 'n', a: -787.25, b: -784.75 }, { side: 'n', a: -783.5, b: -779.5, glass: true },
      { side: 's', a: -782.25, b: -779.75 }, { side: 's', a: -789.5, b: -783.5, glass: true },
    ],
    fit: f => {
      partition(f, [-784.75, -271.6, -778.3, -270.9], 0xe8d8c8, 0x3ad8ff);
      partition(f, [-790.7, -266.6, -782.25, -265.9], 0xd8e4e8, 0xff5ad8);
      counter(f, [-790.4, -274.0, -788.9, -272.5], PAINT.wood);
      counter(f, [-779.9, -264.0, -778.4, -262.5], PAINT.wood);
      shelves(f, [-790.6, -262.6, -789.9, -260.2]);
      shelves(f, [-778.9, -277.6, -778.4, -274.4]);
      f.b.raw({ kind: 'sign', style: 'board', x: f.s.X(-781.5), y: 2.0, z: f.s.Z(-270.88), rotY: Math.PI, w: 5, h: 0.5, text: '西門商場', sub: 'XIMEN MALL · 手機 · 公仔 · 古著', bg: '#1a1a2a', fg: '#ffd23a' });
    },
  },
  // The karaoke house behind the 7-TWELVE: lobby and bar downstairs, rooms upstairs.
  {
    rect: [-787, -246.7, -763.3, -230], top: 17.9, wall: PAINT.ktv,
    openings: [
      { side: 'n', a: -777.25, b: -774.75 }, { side: 'n', a: -774, b: -770, glass: true },
      { side: 'e', a: -238.75, b: -236.25 }, { side: 'e', a: -235.5, b: -232, glass: true },
      { side: 's', a: -772.25, b: -769.75 },
    ],
    upper: {
      stair: [-786.6, -243.3, -777.6, -241.7], dir: 0,
      openings: [
        { side: 'e', a: -244.4, b: -242.4, glass: true }, { side: 'e', a: -240.6, b: -238.6, glass: true },
        { side: 'e', a: -236.25, b: -233.75 }, { side: 'e', a: -232.4, b: -230.8, glass: true },
      ],
      fit: f => {
        const y = SHOP_STOREY;
        // Karaoke rooms along the south side (partitions with open fronts), sofas by the windows.
        for (const x of [-779.75, -772.25]) f.box(x - 0.25, -236.9, x + 0.25, -230.3, y, y + 2.4, 'painted', PAINT.ktv);
        f.box(-786.7, -238.85, -781.25, -238.15, y, y + 2.4, 'painted', PAINT.ktv);
        sofa(f, [-767.6, -244.4, -766.9, -241.6], y, 0xa81c4a);
        sofa(f, [-767.6, -232.4, -766.9, -230.4], y, 0x2a4aa8);
        f.box(-778.5, -244.1, -774.5, -243.4, y, y + 1.05, 'wood', PAINT.wood);
        for (const [x, c] of [[-783.5, 0xff5ad8], [-776, 0x3ad8ff]] as const) f.shape(x - 1.5, -246.38, x + 1.5, -246.35, y + 0.8, y + 2.2, 'neon', c);
      },
    },
    fit: f => {
      counter(f, [-770.5, -241.6, -765.5, -240.9], PAINT.wood);
      partition(f, [-779.9, -238.6, -779.6, -233.6], PAINT.ktv, PAINT.neon);
      sofa(f, [-776.5, -245.8, -773.5, -245.1], KERB, 0x6a2a8a);
      sofa(f, [-786.4, -238.6, -785.7, -234.4], KERB, 0x6a2a8a);
      f.b.raw({ kind: 'sign', style: 'board', x: f.s.X(-768), y: 3.3, z: f.s.Z(-246.4), rotY: 0, w: 4.5, h: 0.6, text: '錢貴KTV', sub: 'KARAOKE · 歡唱包廂', bg: '#0a0a0a', fg: '#ffd23a' });
    },
  },
  // The shops through the block south of Emei St, west to east: a drugstore (from the barricade),
  // a sneaker hall and the 7-TWELVE (taipei-interiors.ts), each door a row off the last.
  {
    rect: [-806.7, -200.7, -791, -178.4], top: 15.9, wall: PAINT.shop,
    openings: [
      { side: 'w', a: -191.25, b: -188.75 }, { side: 'w', a: -187, b: -183, glass: true },
      { side: 'n', a: -799.75, b: -797.25 }, { side: 'n', a: -796.5, b: -792, glass: true },
      { side: 'e', a: -183.75, b: -181.25 },
    ],
    fit: f => {
      for (const x of [-801.25, -796.25]) shelves(f, [x - 0.3, -196.5, x + 0.3, -191]);
      shelves(f, [-803.5, -186.55, -797.5, -185.95]);
      counter(f, [-795.4, -188.9, -792.6, -187.4], 0xf2f2ee);
      f.b.raw({ kind: 'sign', style: 'board', x: f.s.X(-798.5), y: 3.3, z: f.s.Z(-200.4), rotY: Math.PI, w: 5, h: 0.6, text: '藥妝', sub: 'DRUGSTORE · 美妝', bg: '#e8007a', fg: '#ffffff' });
    },
  },
  {
    rect: [-791, -200.7, -776, -178.4], top: 19.9, wall: 0xd8dcd8,
    openings: [
      { side: 'w', a: -183.75, b: -181.25 },
      { side: 'n', a: -787.25, b: -784.75 }, { side: 'n', a: -783.5, b: -779, glass: true },
      { side: 'e', a: -196.25, b: -193.75 },
    ],
    fit: f => {
      for (const z of [-188.75, -183.75]) shelves(f, [-789, z - 0.3, -781.5, z + 0.3]);
      partition(f, [-780.2, -192.6, -779.6, -185.4], 0x2a2a2e, 0xff9a2a);
      counter(f, [-789.6, -197.4, -787.4, -195.9], PAINT.wood);
      f.b.raw({ kind: 'sign', style: 'board', x: f.s.X(-781.2), y: 3.3, z: f.s.Z(-200.4), rotY: Math.PI, w: 5, h: 0.6, text: '潮牌球鞋', sub: 'SNEAKERS · 古著', bg: '#0a0a0a', fg: '#ffffff' });
    },
  },
  // The sneaker shop west of the barricade, out onto Zhongxiao W. Rd's sidewalk.
  {
    rect: [-838.5, -195.8, -819.3, -178.4], top: 22.9, wall: 0xe0dcd4,
    openings: [
      { side: 'e', a: -188.75, b: -186.25 }, { side: 'e', a: -185, b: -181, glass: true },
      { side: 's', a: -834.75, b: -832.25 }, { side: 's', a: -830.5, b: -825, glass: true },
    ],
    fit: f => {
      shelves(f, [-831.55, -194.5, -830.95, -186.5]);
      shelves(f, [-826.55, -190.0, -825.95, -181.5]);
      partition(f, [-838.2, -184.05, -833.5, -183.45], 0x1a1a1e, 0x3aff8a);
      counter(f, [-823.6, -194.6, -821.6, -193.1], PAINT.wood);
      f.b.raw({ kind: 'sign', style: 'board', x: f.s.X(-828.5), y: 3.3, z: f.s.Z(-178.7), rotY: Math.PI, w: 5, h: 0.6, text: '球鞋', sub: 'SNEAKER OUTLET', bg: '#c8141a', fg: '#ffffff' });
    },
  },
  // The cinema's back corridor, from the lobby (site A) to the shop behind it.
  {
    rect: [-845.7, -236.1, -832.3, -229], top: 20.9, wall: 0x2a1418,
    openings: [{ side: 'n', a: -837.25, b: -834.75 }, { side: 's', a: -837.25, b: -834.75 }],
    fit: f => {
      counter(f, [-844.6, -234.0, -840.6, -233.5], PAINT.red);
      for (const x of [-844, -841.5]) f.shape(x - 0.8, -229.36, x + 0.8, -229.33, 0.9, 2.6, 'neon', 0xffd890);
      f.b.raw({ kind: 'sign', style: 'board', x: f.s.X(-836), y: 3.2, z: f.s.Z(-235.8), rotY: Math.PI, w: 3.2, h: 0.5, text: '影廳 1–4', sub: 'SCREENS 1–4 · EXIT', bg: '#1a0a0a', fg: '#ffb21a' });
    },
  },
  // The shop behind the cinema, on Emei St and Xining S. Rd: a camera shop downstairs, a tea house
  // up a stair, its windows over Xining S. Rd.
  {
    rect: [-838.5, -229, -819.3, -213.3], top: 24.9, wall: 0xe4dccc,
    openings: [
      { side: 'n', a: -837.25, b: -834.75 },
      { side: 's', a: -824.75, b: -822.25 }, { side: 's', a: -833.5, b: -829.5, glass: true },
      { side: 'e', a: -223.75, b: -221.25 }, { side: 'e', a: -220, b: -216, glass: true },
    ],
    upper: {
      stair: [-836.1, -215.8, -827.1, -214.2], dir: 0,
      openings: [{ side: 'e', a: -227.6, b: -225.4, glass: true }, { side: 'e', a: -223.1, b: -220.9, glass: true }, { side: 'e', a: -218.6, b: -216.4, glass: true }],
      fit: f => {
        const y = SHOP_STOREY;
        for (const z of [-226.25, -221.25]) f.box(-827.5, z - 0.4, -825, z + 0.4, y, y + 0.8, 'wood', PAINT.wood);
        f.box(-837.9, -228.7, -833.5, -228.1, y, y + 1.9, 'painted', 0xe8e0d0);
        sofa(f, [-821.4, -228.5, -820.7, -224.5], y, 0x3a6a4a);
      },
    },
    fit: f => {
      shelves(f, [-829.05, -227.0, -828.45, -219.5]);
      shelves(f, [-830.5, -219.05, -826.5, -218.45]);
      counter(f, [-824.5, -226.6, -821.5, -225.9], PAINT.wood);
      counter(f, [-836.4, -221.6, -833.1, -220.9], 0x2a2a2e);
      f.b.raw({ kind: 'sign', style: 'board', x: f.s.X(-831.5), y: 3.3, z: f.s.Z(-213.6), rotY: Math.PI, w: 4.5, h: 0.6, text: '相機 · 茶館 2F', sub: 'CAMERAS · TEA HOUSE 2F', bg: '#1a3a2a', fg: '#ffffff' });
    },
  },
  // The board-game café from Zhonghua Rd's sidewalk through to the back of the arcade (site B).
  {
    rect: [-733, -236, -718.9, -213.3], top: 28.9, wall: 0xe8d8c0,
    openings: [
      { side: 'e', a: -226.25, b: -223.75 }, { side: 'e', a: -221.5, b: -217, glass: true },
      { side: 'w', a: -226.25, b: -223.75 },
    ],
    fit: f => {
      for (const [x, z] of [[-729.75, -231.25], [-724.75, -231.25], [-729.75, -218.75], [-724.75, -218.75]] as const) {
        f.box(x - 0.6, z - 0.6, x + 0.6, z + 0.6, KERB, 0.9, 'wood', PAINT.wood);
      }
      shelves(f, [-732.4, -235.6, -726.5, -235.0]);
      shelves(f, [-728.0, -214.2, -722.0, -213.6]);
      partition(f, [-727.55, -229.5, -726.95, -226.6], 0x2a0a3a, 0xffd23a);
      f.b.raw({ kind: 'sign', style: 'board', x: f.s.X(-719.2), y: 3.3, z: f.s.Z(-219.5), rotY: Math.PI / 2, w: 4.5, h: 0.6, text: '桌遊天堂', sub: 'BOARD GAME CAFÉ', bg: '#2a0a3a', fg: '#ffd23a' });
    },
  },
];

/** Source boxes the passages open up: the arcade's back wall (rebuilt with a door) and the lobby counter in front of the cinema's back corridor. */
export const OPENED: [number, number, number, number, number, number][] = [
  [-734, -236, -733, -213.3, 0, 15.9],
  [-836.2, -238.15, -833, -237.25, 0, 1.2],
];

/** The arcade's back wall with its new door, and the district cuts (map coordinates) round both openings. */
export function openings(b: MapBuilder, s: Shift): number[] {
  const box = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, style: BlockStyle, color?: number) => {
    const i = b.box(s.X((x0 + x1) / 2), y0, s.Z((z0 + z1) / 2), x1 - x0, y1 - y0, z1 - z0, style);
    if (color !== undefined && style !== 'invisible') b.paint(i, color);
  };
  // The wall up to the arcade's ceiling (the storeys above are the arcade's own mass), a lit frame round the door.
  const ARCADE = 0x3a3548, top = 4.7;
  box(-734, -236, -733, -226.25, 0, top, 'painted', ARCADE);
  box(-734, -223.75, -733, -213.3, 0, top, 'painted', ARCADE);
  box(-734, -226.25, -733, -223.75, 2.9, top, 'painted', ARCADE);
  b.shape(s.X(-734.03), 2.9, s.Z(-225), 0.06, 0.12, 2.7, 'neon', 0xff5ad8);
  return [
    s.X(-734.4), 0.05, s.Z(-236), s.X(-732.9), top - 0.05, s.Z(-213.3),
    s.X(-836.3), 0.05, s.Z(-238.3), s.X(-832.9), 1.35, s.Z(-237.1),
  ];
}
