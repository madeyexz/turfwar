import { C, Ximen, shadeHex, type R } from './ximending-kit';
import { ARCADE_HALL, BALCONY, CINEMA, CROSS_WING, GALLERY, HOTEL, LADDERS, PAD, PLAZA, RED_HOUSE, ROOF, YARD } from './ximending-plan';

/**
 * Ximending's set pieces (ximending.ts): the cinema on lane N with its marquee balcony (site A),
 * the Red House and its square on lane S (site B), the game arcade across lane M with its
 * helicopter roof, the hotel and the skybridge between them, the night market, SWAT's station
 * plaza and Militia's construction yard.
 */

const SHOP = 4.2;

/**
 * A rim round a roof rectangle: a solid parapet 1 m high all round, and above it wall panels up to
 * 2.1 m with a window every 5 m, so a soldier on the roof looks out across the street but never
 * along it, and the roof sees no further than the lane is wide. `gaps` are full-height openings
 * (a ladder, the skybridge): [side, from, to] along that side.
 */
function parapet(t: Ximen, r: R, y: number, gaps: { side: 'n' | 's' | 'e' | 'w'; from: number; to: number }[] = [], color = 0xd8d2c6) {
  const [x0, z0, x1, z1] = r, th = 0.3;
  const piece = (side: 'n' | 's' | 'e' | 'w', a: number, c: number, lo: number, hi: number) => {
    if (c - a < 0.05) return;
    const rect: R = side === 'n' ? [a, z0, c, z0 + th] : side === 's' ? [a, z1 - th, c, z1] : side === 'w' ? [x0, a, x0 + th, c] : [x1 - th, a, x1, c];
    t.box(rect, y + lo, y + hi, 'painted', color);
  };
  const run = (side: 'n' | 's' | 'e' | 'w', lo: number, hi: number) => {
    // Free stretches between the gaps; each gets its parapet, and panels between windows.
    const opens = gaps.filter(g => g.side === side).sort((p, q) => p.from - q.from);
    const spans: [number, number][] = [];
    let cursor = lo;
    for (const g of opens) { if (g.from > cursor) spans.push([cursor, g.from]); cursor = Math.max(cursor, g.to); }
    if (hi > cursor) spans.push([cursor, hi]);
    for (const [a, c] of spans) {
      piece(side, a, c, 0, 1.0);
      // Panels with a 1.4 m window every 5 m, none within 4.4 m of a corner or a gap (a window at a corner sees along the street).
      let cur = a;
      for (let w = a + 4.4; w + 1.4 <= c - 4.4; w += 5) { piece(side, cur, w, 1.0, 2.1); cur = w + 1.4; }
      piece(side, cur, c, 1.0, 2.1);
    }
  };
  run('n', x0, x1); run('s', x0, x1); run('w', z0 + th, z1 - th); run('e', z0 + th, z1 - th);
}

/** A sign on a roof facing south: the panel on two steel legs standing on the roof at `y` (the legs are cover). */
function roofSign(t: Ximen, x: number, y: number, z: number, w: number, h: number, text: string, bg: string, fg: string, sub: string, style: 'billboard' | 'gate' = 'billboard') {
  const lift = 1.0;
  t.sign(style, x, y + lift + h / 2, z, Math.PI, w, h, text, bg, fg, sub);
  for (const lx of [x - w / 2 + 0.4, x + w / 2 - 0.4]) t.box([lx - 0.09, z - 0.12, lx + 0.09, z + 0.06], y, y + lift + h, 'steel', C.iron);
  t.shape([x - w / 2 + 0.3, z - 0.1, x + w / 2 - 0.3, z - 0.04], y + lift - 0.12, y + lift, 'steel', C.iron);
}

/** The cinema: a lobby open to the lane, a back door to the north sidewalk, a marquee balcony over the lane with a stair at each end. */
export function cinema(t: Ximen) {
  const [x0, z0, x1, z1] = CINEMA, w = 0.8;
  const floor = 0x2a2a30;
  // Walls: the lane side with three doors, the back with one, the Hanzhong side with one; the west is shared with the next building.
  t.wall('x', z1 - w / 2, x0, x1, 0, SHOP, [{ at: -21, width: 3.2, top: 3.2 }, { at: -15.5, width: 3.6, top: 3.2 }, { at: -10, width: 3.2, top: 3.2 }], 'mosaic', 0xe8d8c8, w);
  t.wall('x', z0 + w / 2, x0, x1, 0, SHOP, [{ at: -15.5, width: 3, top: 3 }], 'mosaic', 0xd8c8b8, w);
  t.wall('z', x0 + w / 2, z0 + w, z1 - w, 0, SHOP, [], 'mosaic', 0xd8c8b8, w);
  t.wall('z', x1 - w / 2, z0 + w, z1 - w, 0, SHOP, [{ at: -43.5, width: 3, top: 3 }], 'mosaic', 0xe8d8c8, w);
  // The storeys above: a tall block with the screen halls.
  t.box(CINEMA, SHOP, 24.6, 'facade', 0xcfc4e0);
  t.shape([x0 + w, z0 + w, x1 - w, z1 - w], 0, 0.03, 'carpet', floor);
  // The ceiling, with lit panels.
  t.shape([x0 + w, z0 + w, x1 - w, z1 - w], SHOP - 0.06, SHOP, 'painted', 0x2a2438);
  for (let lx = x0 + 3; lx < x1 - 2; lx += 6) t.shape([lx, z0 + 2, lx + 3, z1 - 2], SHOP - 0.09, SHOP - 0.06, 'light');
  // Lobby fittings: ticket desk, two snack counters, four columns, poster light boxes on the back wall.
  t.box([-19, -43, -12, -41.8], 0, 1.15, 'wood', 0x5a3a2a);
  t.shape([-19, -43.05, -12, -41.75], 1.15, 1.2, 'painted', 0x1a1a1a);
  t.sign('board', -15.5, 2.4, -43.05, Math.PI, 5, 0.7, '售票口', '#101418', '#ffd24a', 'TICKETS');
  t.box([-24.6, -46, -22.2, -44.8], 0, 1.2, 'wood', 0x7a4a2a);
  t.box([-8.8, -46, -6.4, -44.8], 0, 1.2, 'wood', 0x7a4a2a);
  for (const [px, pz] of [[-21, -41], [-10, -41], [-21, -47], [-10, -47]]) t.box([px - 0.45, pz - 0.45, px + 0.45, pz + 0.45], 0, SHOP, 'pillar');
  for (const [x, text] of [[-21, '午夜場'], [-15.5, '新片上映'], [-10, '首映']] as const) t.sign('billboard', x, 2.3, z0 + w + 0.1, 0, 3, 2.4, text, '#2c2c54', '#ffd24a', 'NOW SHOWING');
  // The marquee: a deck over the lane with a bulb strip and a name sign above it.
  const deck: R = [-24, z1, -7, z1 + 4];
  t.box([deck[0], deck[1], deck[2], deck[3]], BALCONY - 0.3, BALCONY, 'floor');
  for (const x of [-23.6, -7.4, -15.5]) t.box([x - 0.2, z1 + 3.55, x + 0.2, z1 + 3.95], 0, BALCONY - 0.3, 'steel', C.iron);
  t.box([deck[0], deck[3] - 0.25, deck[2], deck[3]], BALCONY, BALCONY + 1.2, 'painted', 0xe8e0d0);
  // Seats and a planter on the deck.
  t.box([-20.5, z1 + 0.4, -17.5, z1 + 1.4], BALCONY, BALCONY + 1.15, 'wood', 0x5a3a2a);
  t.planter([-12, z1 + 0.3, -9, z1 + 1.3], BALCONY, 2.4);
  t.sign('marquee', -15.5, BALCONY - 0.65, deck[3] + 0.05, Math.PI, 17, 0.9, '', '#2a0a14', '#ffe08a');
  t.sign('gate', -15.5, 8.2, z1 + 0.1, Math.PI, 14, 2.2, '星光戲院', '#14102a', '#ffd24a', 'STARLIGHT CINEMA');
  t.sign('screen', -15.5, 13, z1 + 0.1, Math.PI, 10, 5.5, '', '#000000', '#ffffff');
  // A stair at each end of the deck, along the lane's north edge.
  t.flight([-32, z1, -24, z1 + 3.5], 0, BALCONY, 0, { base: 0, color: 0xc8c0b0 });
  t.flight([-7, z1, 1, z1 + 3.5], 0, BALCONY, 2, { base: 0, color: 0xc8c0b0 });
  t.cheek([-32, z1 + 3.5, -24, z1 + 3.8], 0, 0, BALCONY, 0, 4, 0xd8d0c0, 0.9);
  t.cheek([-7, z1 + 3.5, 1, z1 + 3.8], 0, 0, BALCONY, 2, 4, 0xd8d0c0, 0.9);
}

/** The game arcade across lane M: a hall full of cabinets, doors on all four sides, a roof with the helicopter's pad and ladders up. */
export function arcade(t: Ximen) {
  const [x0, z0, x1, z1] = ARCADE_HALL, w = 0.8;
  const lintel = 3.2;
  t.wall('z', x0 + w / 2, z0 + w, z1 - w, 0, SHOP, [{ at: -20, width: 3.2, top: lintel }, { at: -12, width: 3.2, top: lintel }], 'mosaic', 0x7a6a9a, w);
  t.wall('x', z1 - w / 2, x0, x1, 0, SHOP, [{ at: 10, width: 3.2, top: lintel }, { at: 21, width: 4, top: lintel }, { at: 32, width: 3.2, top: lintel }], 'mosaic', 0x7a6a9a, w);
  t.wall('z', x1 - w / 2, z0 + w, z1 - w, 0, SHOP, [{ at: -16, width: 3.2, top: lintel }], 'mosaic', 0x7a6a9a, w);
  t.wall('x', z0 + w / 2, x0, x1, 0, SHOP, [{ at: 21, width: 3.2, top: lintel }], 'mosaic', 0x7a6a9a, w);
  t.box(ARCADE_HALL, SHOP, ROOF, 'facade', 0xb8b0d0);
  t.shape([x0, z0, x1, z1], ROOF - 0.02, ROOF + 0.012, 'slab', 0x9a968c);
  t.shape([x0 + w, z0 + w, x1 - w, z1 - w], 0, 0.03, 'carpet', 0x24203a);
  // The ceiling, with strips of neon between the cabinet rows.
  t.shape([x0 + w, z0 + w, x1 - w, z1 - w], SHOP - 0.06, SHOP, 'painted', 0x1a1630);
  for (let lx = x0 + 3; lx < x1 - 2; lx += 5.5) t.shape([lx, z0 + 1.5, lx + 0.4, z1 - 1.5], SHOP - 0.1, SHOP - 0.06, 'neon', lx % 11 < 5.5 ? 0xa02a88 : 0x2a90a0);
  // Cabinets in rows along z with crossings, lit fronts facing the aisles; columns every 8 m.
  const rows: [number, number, number][] = [[10.5, -25.5, -16.5], [10.5, -14.5, -7], [16, -25.5, -19.5], [16, -17, -7.5], [26.5, -25.5, -19], [26.5, -16.5, -7.5], [32, -25.5, -17.5]];
  rows.forEach(([x, za, zb], i) => {
    t.box([x - 0.7, za, x + 0.7, zb], 0, 1.95, 'painted', [0x2a2060, 0x3a1a50, 0x1a3a60][i % 3]);
    t.shape([x - 0.72, za + 0.2, x - 0.69, zb - 0.2], 1.0, 1.7, 'neon', [0xa02a88, 0x2a90a0, 0xa07018][i % 3]);
    t.shape([x + 0.69, za + 0.2, x + 0.72, zb - 0.2], 1.0, 1.7, 'neon', [0x2a90a0, 0xa07018, 0xa02a88][i % 3]);
  });
  // A claw-machine island and a prize counter in the middle.
  t.box([20, -17, 22.4, -14.6], 0, 2.1, 'glass', 0xa8d8e8);
  t.box([19.8, -13.2, 22.6, -12], 0, 1.15, 'wood', 0x5a3a2a);
  for (const [px, pz] of [[13.5, -10], [24, -10], [13.5, -22], [24, -22], [35, -10], [35, -22]]) t.box([px - 0.5, pz - 0.5, px + 0.5, pz + 0.5], 0, SHOP, 'pillar');
  t.sign('gate', 21, 5.4, z1 + 0.1, Math.PI, 15, 1.8, '星際電玩城', '#101030', '#5af0ff', 'PIXEL PALACE ARCADE');
  t.sign('blade', x0 - 0.7, 8, -20, -Math.PI / 2, 0.9, 4.6, '電玩', '#7a2ab0', '#ffe0ff');
  t.sign('blade', x1 + 0.7, 8, -10, Math.PI / 2, 0.9, 4.6, '娃娃機', '#1aa06a', '#ffffff');
  t.sign('screen', 12, 9, z1 + 0.1, Math.PI, 6, 3.4, '', '#000000', '#ffffff');
  // The roof: a solid parapet with gaps at the three ladders and the skybridge, the pad, and some rooftop cover.
  const roof: R = [x0, z0, x1, z1];
  const [west, east, south] = LADDERS;
  parapet(t, roof, ROOF, [{ side: 'w', from: west[1] - 0.6, to: west[1] + 0.6 }, { side: 'e', from: east[1] - 0.6, to: east[1] + 0.6 }, { side: 's', from: 26, to: 31 }]);
  void south;
  helipad(t);
  // AC units and a water tank in the corners (cover on the roof).
  for (const [ax, az] of [[7, -26], [10, -26], [7, -7], [35.6, -7], [35.6, -26]]) t.box([ax, az, ax + 1.6, az + 1.0], ROOF, ROOF + 1.2, 'painted', 0xe4e4de);
  t.box([12, -25, 15, -22], ROOF, ROOF + 0.9, 'steel', C.iron);
  t.raw({ kind: 'cylinder', x: 13.5, y: ROOF + 0.9, z: -23.5, radius: 1.3, height: 1.8, axis: 'y', style: 'painted', color: C.steel, sides: 12 });
  t.box([8, -14, 11, -11], ROOF, ROOF + 2.6, 'painted', 0xc8c0b0);
  // The stair house, a cooling unit and pipe racks round the pad.
  t.box([14, -21, 17.5, -17.5], ROOF, ROOF + 2.6, 'painted', 0xc8c0b0);
  t.box([19.5, -23.5, 22.5, -21], ROOF, ROOF + 1.8, 'steel', 0x9aa0a6);
  t.box([19.5, -13, 23.5, -11.6], ROOF, ROOF + 1.3, 'steel', C.iron);
  t.box([34, -14, 36, -11.6], ROOF, ROOF + 1.6, 'painted', 0xe4e4de);
  // Ladders: from Hanzhong St up the west face, from East St up the east face.
  for (const [lx, lz, dir] of [west, east]) t.b.ladder(lx, lz, 0, ROOF, dir);
  roofSign(t, 10, ROOF, z1 - 0.4, 8, 3, '電玩', '#2c2c54', '#ffd24a', 'ARCADE');
}

/** The helicopter's pad on the arcade roof: an H in a square, lamps at the corners. */
function helipad(t: Ximen) {
  const [x0, z0, x1, z1] = PAD, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, y = ROOF + 0.014, PAINT = 0xf2efe6;
  const mark = (dx: number, dz: number, w: number, d: number) => t.raw({ kind: 'marking', x: cx + dx, y, z: cz + dz, w, d, color: PAINT });
  for (const s of [-1, 1]) { mark(s * 4.2, 0, 0.3, 8.7); mark(0, s * 4.2, 8.7, 0.3); mark(s * 1.3, 0, 0.45, 3.6); }
  mark(0, 0, 2.6, 0.45);
  // Flush lamps at the corners (nothing to trip on or walk through).
  for (const [lx, lz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) t.shape([lx - 0.16, lz - 0.16, lx + 0.16, lz + 0.16], ROOF, ROOF + 0.06, 'neon', 0x5aff8a);
}

/** The hotel across lane M: a four-storey block whose roof the skybridge reaches, with a ladder down its south face. */
export function hotel(t: Ximen) {
  const [x0, z0, x1, z1] = HOTEL;
  const h = t.apartment(HOTEL, 4, 0xe2c0b0, 91, { street: ['n', 's', 'e', 'w'], addon: false, tanks: 0, blades: 2 });
  for (const s of ['n', 's', 'e'] as const) t.fascia(HOTEL, s, 700 + s.charCodeAt(0), { roof: h });
  const [lx, lz, dir] = LADDERS[2];
  parapet(t, HOTEL, h, [{ side: 'n', from: 26, to: 31 }, { side: 's', from: lx - 0.6, to: lx + 0.6 }]);
  roofSign(t, 31, h, z1 - 0.4, 9, 1.6, '旅館', '#8a1a3a', '#ffd0e0', 'HOTEL', 'gate');
  for (const [ax, az] of [[21, 7], [33, 7], [21, 24], [35, 24]]) t.box([ax, az, ax + 1.6, az + 1.0], h, h + 1.2, 'painted', 0xe4e4de);
  t.box([29, 12, 33, 16], h, h + 2.6, 'painted', 0xc8c0b0);
  t.b.ladder(lx, lz, 0, h, dir);
  // The skybridge: a deck with solid rails and a truss under it, from the arcade's roof to the hotel's.
  const bx0 = 26, bx1 = 31, y = ROOF;
  t.box([bx0, -5.05, bx1, 5.05], y - 0.35, y, 'floor');
  // Glazed sides and a roof: a corridor with a window on each side, shut to shots from the street.
  t.box([bx0, -5, bx0 + 0.2, 5], y, y + 2.7, 'window', 0x9ac0cc);
  t.box([bx1 - 0.2, -5, bx1, 5], y, y + 2.7, 'window', 0x9ac0cc);
  t.box([bx0, -5, bx1, 5], y + 2.7, y + 2.9, 'steel', 0x5a6068);
  t.shape([bx0 + 0.1, -4.9, bx1 - 0.1, 4.9], y - 1.2, y - 0.35, 'steel', 0x4a4e54);
  t.sign('blade', bx0 - 0.1, y + 2.2, 0, -Math.PI / 2, 0.8, 2.6, '天橋', '#0a4a8a', '#ffe24a');
  void z0; void x0; void shadeHex;
}

/**
 * Collision for an upright octagon (faces square to the axes, `apothem` from its centre to each
 * face): `n` boxes stepping along the diagonal faces, each corner on the face, so the stairstep
 * stays within a few centimetres of the drawn wall.
 */
function octagonBlock(t: Ximen, cx: number, cz: number, apothem: number, y0: number, y1: number, n = 12) {
  const half = apothem * Math.tan(Math.PI / 8);
  for (let j = 0; j < n; j++) {
    const k = j / (n - 1), hx = half + (apothem - half) * k, hz = apothem - (apothem - half) * k;
    t.block([cx - hx, cz - hz, cx + hx, cz + hz], y0, y1, 'concrete');
  }
}

/** The Red House (西門紅樓): an octagonal brick hall with a lantern and a cross-shaped wing behind it, on a brick square. */
export function redHouse(t: Ximen) {
  const { x, z, r } = RED_HOUSE, RED = 0xffffff, STONE = 0xf0e8dc, TILE = 0x6a7a70;
  // Collision: stepped boxes that fill each storey's octagon out to its faces (a fan of boxes
  // inscribed in a circle left a metre of brick to walk and shoot through at the diagonal faces).
  const apothem = (radius: number) => radius * Math.cos(Math.PI / 8);
  octagonBlock(t, x, z, apothem(r), 0, 4.6);
  octagonBlock(t, x, z, apothem(r + 0.3), 4.6, 5.3);
  octagonBlock(t, x, z, apothem(r - 0.2), 5.3, 10.4);
  octagonBlock(t, x, z, apothem(r + 0.5), 10.4, 11.6, 8);
  octagonBlock(t, x, z, apothem(3.7), 11.6, 16.1, 6);
  const oct = (radius: number, y0: number, y1: number, style: 'brick' | 'plaster' | 'slab' | 'steel', color: number, top = radius) =>
    t.raw({ kind: 'cylinder', x, y: y0, z, radius, height: y1 - y0, axis: 'y', style, color, sides: 8, top });
  oct(r, 0, 4.6, 'brick', RED); oct(r + 0.3, 4.6, 5.3, 'plaster', STONE);
  oct(r - 0.2, 5.3, 9.6, 'brick', RED); oct(r + 0.5, 9.6, 10.4, 'plaster', STONE);
  oct(r + 0.9, 10.4, 12.8, 'slab', TILE, 3.4);
  oct(3.3, 12.8, 15.4, 'brick', RED); oct(3.7, 15.4, 16.1, 'plaster', STONE);
  oct(3.9, 16.1, 18.8, 'slab', TILE, 0.3);
  oct(0.14, 18.8, 21, 'steel', 0x3a3a3c);
  // Arched windows on the four faces square to the axes, and the doors.
  const a = r * 0.924;
  for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const k of [-2.2, 0, 2.2]) {
      const px = x + fx * (a + 0.03) + (fz !== 0 ? k : 0), pz = z + fz * (a + 0.03) + (fx !== 0 ? k : 0);
      t.b.detail(px, 5.9, pz, fz !== 0 ? 1.0 : 0.1, 2.2, fx !== 0 ? 1.0 : 0.1, 'window', 0x2a3a4a);
      t.b.detail(px, 1.0, pz, fz !== 0 ? 1.0 : 0.1, 2.4, fx !== 0 ? 1.0 : 0.1, 'window', k === 0 ? 0x3a2a1a : 0x2a3a4a);
    }
  }
  t.sign('board', x, 9.0, z - a - 0.1, 0, 5, 0.9, '西門紅樓', '#5a1a14', '#ffd890', 'THE RED HOUSE');
  // The cross wing: two brick bars with hipped roofs, windows on the long faces.
  for (const [i, bar] of CROSS_WING.entries()) {
    t.box(bar, 0, 8.4, 'brick', RED);
    t.shape([bar[0] - 0.3, bar[1] - 0.3, bar[2] + 0.3, bar[3] + 0.3], 8.4, 9.0, 'plaster', STONE);
    t.shape([bar[0] + 0.5, bar[1] + 0.5, bar[2] - 0.5, bar[3] - 0.5], 9.0, 11.2 - i, 'roof', TILE);
    const alongX = bar[2] - bar[0] > bar[3] - bar[1];
    for (let k = bar[alongX ? 0 : 1] + 2.4; k < bar[alongX ? 2 : 3] - 1.5; k += 3.2) {
      if (alongX) {
        t.b.detail(k, 1.2, bar[3] + 0.03, 1.0, 2.6, 0.1, 'window', 0x2a3a4a); t.b.detail(k, 5.0, bar[3] + 0.03, 1.0, 2.2, 0.1, 'window', 0x2a3a4a);
      } else {
        t.b.detail(bar[0] - 0.03, 1.2, k, 0.1, 2.6, 1.0, 'window', 0x2a3a4a); t.b.detail(bar[2] + 0.03, 1.2, k, 0.1, 2.6, 1.0, 'window', 0x2a3a4a);
      }
    }
  }
  // The square: a ring of café tables with umbrellas, a gate arch at the lane, stalls and trees.
  for (const [tx, tz] of [[-34, 36], [-20, 32], [-3, 31.5], [1.5, 36]]) {
    t.box([tx - 0.8, tz - 0.8, tx + 0.8, tz + 0.8], 0, 0.8, 'wood', 0x7a4e30);
    t.raw({ kind: 'cylinder', x: tx, y: 2.3, z: tz, radius: 1.5, height: 0.25, axis: 'y', style: 'painted', color: [0xd8302a, 0x2a6ab8, 0xe8b830, 0x3f9a50][(tx + tz) & 3], sides: 10 });
    t.shape([tx - 0.04, tz - 0.04, tx + 0.04, tz + 0.04], 0.8, 2.3, 'steel', C.iron);
  }
  t.raw({ kind: 'instances', model: 'tree:camphor', data: [-34, 0, 48, 0.4, 1.0, 0, 0xffffff, 0, 3, 0, 48, 0.2, 1.1, 0, 0xffffff, 0] });
  t.trunk(-34, 48, 1.0); t.trunk(3, 48, 1.1);
  t.sign('gate', -14, 8, 27.5 + 0.1, 0, 11, 1.6, '西門紅樓廣場', '#5a1a14', '#ffd890', 'RED HOUSE SQUARE');
  void HOTEL;
}

/** The covered night market along lane M: a tarp roof over rows of stalls and lanterns, kept clear at the alleys. */
export function nightMarket(t: Ximen) {
  const roof: R = [-36, -5, -6, 5];
  t.box([roof[0], roof[1], roof[2], roof[3]], 3.6, 3.68, 'painted', 0xc8322a);
  for (let x = roof[0] + 1; x < roof[2]; x += 6) {
    t.shape([x, roof[1], x + 2.8, roof[3]], 3.68, 3.74, 'painted', 0xe8b830);
    for (const z of [-4.6, 4.6]) t.shape([x - 0.05, z - 0.05, x + 0.05, z + 0.05], 0, 3.6, 'steel', C.iron);
    t.lantern(x + 1.4, 3.1, -2.4); t.lantern(x + 4.4, 3.1, 2.4, 0xffb02a);
  }
  // Stall rows against both walls, broken at the alley mouths (x -21..-16 north, -33..-28 south) and the street crossing.
  const gaps: [number, number, number][] = [[-21, -16, -1], [-33, -28, 1]];
  let seed = 3;
  for (const side of [-1, 1]) for (let x = -36.5; x + 3.8 < -5.5; x += 4.8) {
    const skip = gaps.some(([a, b, s]) => s === side && x + 3.8 > a - 0.5 && x < b + 0.5);
    if (skip) continue;
    const z0 = side < 0 ? -5 : 4, z1 = side < 0 ? -4 : 5;
    t.tarpStall([x, z0, x + 3.8, z1], [0xc8322a, 0x2f5fa8, 0xe8b830, 0x3f9a50][seed++ % 4], seed);
    // Goods hang from the stall's back rail: a shelf wall from the counter up to head height, drawn
    // as what it is (it stops shots), with rows of stock on it.
    const shelf: R = side < 0 ? [x, z0, x + 3.8, z0 + 0.4] : [x, z1 - 0.4, x + 3.8, z1];
    t.box(shelf, 0.95, 2.3, 'wood', 0x6a4a32);
    const front = side < 0 ? shelf[3] : shelf[1], out = side < 0 ? 1 : -1;
    for (const [k, y] of [[0, 1.25], [1, 1.75]] as const) for (let i = 0; i < 4; i++) {
      const gx = x + 0.15 + i * 0.92;
      t.shape([gx, Math.min(front, front + out * 0.12), gx + 0.75, Math.max(front, front + out * 0.12)], y, y + 0.32, 'painted', [0xd84a2a, 0xe8c040, 0x7ab040, 0xf0ece0, 0x2a6ab8][(seed + i + k) % 5]);
    }
  }
  t.sign('gate', -6.2, 4.4, 0, Math.PI / 2, 8, 0.9, '西門夜市', '#14306a', '#ffd24a', 'NIGHT MARKET');
}

/** SWAT's plaza by the MRT exit: the station pavilion, bus shelters, planters and bike docks. */
export function stationPlaza(t: Ximen) {
  const [x0, z0, x1, z1] = PLAZA;
  // The plaza's west edge, either side of the pavilion: a hedge wall, so the ring road's long views end at it.
  t.planter([x0, -15, x0 + 1.2, -7], 0, 3.2);
  t.planter([x0, 7, x0 + 1.2, 15], 0, 3.2);
  // The exit pavilion: glass walls on three sides, a canopy, an escalator well.
  t.box([x0, -7, x0 + 0.5, 7], 0, 3.6, 'glass', 0x9ac0cc);
  t.box([x0, -7, x0 + 5.2, -6.5], 0, 3.6, 'glass', 0x9ac0cc);
  t.box([x0, 6.5, x0 + 5.2, 7], 0, 3.6, 'glass', 0x9ac0cc);
  t.shape([x0, -7.2, x0 + 6, 7.2], 3.6, 3.85, 'steel', 0x4a5058);
  for (const z of [-7, 7]) t.box([x0 + 5.2, z - 0.15, x0 + 5.6, z + 0.15], 0, 3.6, 'steel', 0x4a5058);
  t.shape([x0 + 0.6, -3.5, x0 + 4.6, 3.5], 0, 0.04, 'tile', 0x202428);
  for (let i = 0; i < 6; i++) t.shape([x0 + 0.8 + i * 0.6, -3.2, x0 + 1.1 + i * 0.6, 3.2], 0.04, 0.07, 'steel', 0x6a7078);
  t.sign('gate', x0 + 5.7, 4.6, 0, Math.PI / 2, 7, 1.1, '捷運西門站', '#14306a', '#ffffff', 'XIMEN STATION');
  // A bus shelter and a bike dock row on the north edge, planters on the south.
  t.shelter(-54.8, -14.8, 3.2, true, -1);
  for (let i = 0; i < 8; i++) t.shape([-63.8 + i * 0.55, -14.6, -63.5 + i * 0.55, -13.2], 0, 0.9, 'steel', i & 1 ? 0xffb02a : 0x6a7078);
  t.block([-63.8, -14.6, -59.65, -13.2], 0, 0.9, 'metal');
  // Hedge baffles in front of the two alley mouths, so nobody sees from alley to alley across the plaza.
  t.planter([-61.5, -10.5, -53.5, -9.5], 0, 2.4);
  t.planter([-61.5, 9.5, -53.5, 10.5], 0, 2.4);
  t.raw({ kind: 'instances', model: 'tree:camphor', data: [-66, 0, 12, 0, 0.9, 0, 0xffffff, 0, -66, 0, -12, 1, 0.9, 0, 0xffffff, 0] });
  t.trunk(-66, 12, 0.9); t.trunk(-66, -12, 0.9);
  t.sign('billboard', -57.5, 9.2, z0 + 0.4, 0, 8, 3, '西門町', '#c8141e', '#ffffff', 'XIMENDING');
  void z1; void x1;
}

/** Militia's construction yard: hoarding with two gates, a site office on stacked containers, mixer, crane and materials. */
export function yard(t: Ximen) {
  const [x0, z0, x1, z1] = YARD;
  // The site office: two stacked containers at the back.
  t.container([62, -4.2, 67.8, -1.8], 0x2f5fa8);
  t.container([62, -4.2, 67.8, -1.8], 0xc8641a, 2.6);
  t.container([62, 1.8, 67.8, 4.2], 0x3f9a50);
  t.sign('board', 62 - 0.06, 3.6, -3, -Math.PI / 2, 2.2, 0.7, '工地辦公室', '#f2c400', '#1a1a1a', 'SITE OFFICE');
  // Back fence along the walk, with two staggered gates.
  t.hoarding([x1 - 0.5, z0, x1, -9], 'w', ['安全第一', 'SAFETY FIRST'], 0x4a6a3a);
  t.hoarding([x1 - 0.5, -5.5, x1, z1], 'w', undefined, 0x4a6a3a);
  // Baffles inside the yard, in front of the two alley mouths: nobody sees from alley to alley across the base.
  t.hoarding([56, -12.7, 63, -12.3], 's', undefined, 0x4a6a3a);
  t.hoarding([51.5, 12.3, 58, 12.7], 'n', undefined, 0x4a6a3a);
  // Mixer, rebar piles, pallets of bricks, a crane's base.
  t.b.cylinder(58.5, 0, -10.5, 1.0, 1.9, 'steel', 'y', 0xd8a838);
  // (Nothing low stands against the baffles or the screens: no stepping up onto them to see over the base's screens.)
  t.box([55, 8.6, 58.5, 10.3], 0, 1.0, 'steel', 0x6a5a4a);
  t.box([60, 9, 63, 11.2], 0, 1.3, 'brick', 0xb8683e);
  t.box([60.6, -10.6, 63.2, -8.8], 0, 1.4, 'crate', 0xa07848);
  t.box([56.5, -15, 58.5, -14.2], 0, 1.1, 'crate', 0xb08a5a);
  t.box([66, 11, 67.6, 12.6], 0, 2.6, 'painted', 0x3f6a9a);
  // The crane's mast (solid: cover, and nobody walks through it) and its jib.
  t.box([x1 - 3, z0 + 0.2, x1 - 1, z0 + 2.2], 0, 28, 'steel', 0xd8a838);
  t.shape([x1 - 14, z0 + 0.8, x1 - 1, z0 + 1.4], 27, 28.4, 'steel', 0xd8a838);
  t.sign('billboard', x1 - 4, 4.6, z1 - 0.3, Math.PI, 8, 2.4, '鴻運建設', '#f2c400', '#1a1a1a', 'CONSTRUCTION');
  void x0;
}

/**
 * Covered galleries: roofed stretches over the ends of the lanes and the stations' mouths (a steel
 * frame under a sheet roof at GALLERY, open at the sides). Nobody on a roof sees into them, which
 * keeps both bases and the lanes' far ends out of the roofs' long views; and nothing near them is
 * high enough to jump onto their tops from, so nobody stands up there and looks down a lane.
 */
export function galleries(t: Ximen) {
  const roof = (band: R, color: number) => {
    const [under, top] = GALLERY;
    // Its north and south edges stand 1.1 m off the buildings' faces there, clear of the AC units and
    // blade signs on them.
    const r: R = [band[0], band[1] + 1.1, band[2], band[3] - 1.1];
    t.box(r, under, top, 'roof', color);
    const [x0, z0, x1, z1] = r;
    // Posts along the long edges, a lit tube under the eaves.
    const alongX = x1 - x0 >= z1 - z0, len = alongX ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(len / 7));
    // (Never in an alley's mouth, and never through a container, a van or a scooter already
    // standing there: a post steps along the edge to the nearest clear spot, or is left out.)
    const alleys = [[-60.6, -54.4], [51.4, 62.6]];
    const post = (a: number, e: number): R => alongX ? [a - 0.15, e - 0.15, a + 0.15, e + 0.15] : [e - 0.15, a - 0.15, e + 0.15, a + 0.15];
    const free = ([px0, pz0, px1, pz1]: R) => !t.b.solids.some(s => s.minY < under && s.maxY > 0.1 && s.minX < px1 + 0.05 && s.maxX > px0 - 0.05 && s.minZ < pz1 + 0.05 && s.maxZ > pz0 - 0.05);
    for (let i = 0; i <= n; i++) {
      const p = (alongX ? x0 : z0) + (len * i) / n;
      if (alongX && alleys.some(([a, b]) => p > a && p < b)) continue;
      for (const e of alongX ? [z0 + 0.25, z1 - 0.25] : [x0 + 0.25, x1 - 0.25]) {
        for (const shift of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
          const a = Math.min(Math.max(p + shift, (alongX ? x0 : z0) + 0.2), (alongX ? x1 : z1) - 0.2);
          if (alongX && alleys.some(([l, h]) => a > l && a < h)) continue;
          if (!free(post(a, e))) continue;
          t.box(post(a, e), 0, under, 'steel', C.iron);
          break;
        }
      }
    }
    t.shape(alongX ? [x0 + 0.5, (z0 + z1) / 2 - 0.1, x1 - 0.5, (z0 + z1) / 2 + 0.1] : [(x0 + x1) / 2 - 0.1, z0 + 0.5, (x0 + x1) / 2 + 0.1, z1 - 0.5], under - 0.06, under, 'neon', 0xf4f0e0);
  };
  // The lane ends of N and S, west and east of the cross streets.
  roof([-68, -37.5, -47.5, -27.5], 0x7ab0c8); roof([47.5, -37.5, 68, -27.5], 0xc8b070);
  roof([-68, 27.5, -47.5, 37.5], 0xc8b070); roof([47.5, 27.5, 68, 37.5], 0x7ab0c8);
  // Over each station mouth, across the cross street and the plaza's edge.
  roof([-50, -15, -43, 15], 0x9ac0cc); roof([43, -15, 50, 15], 0xe8a860);
}
