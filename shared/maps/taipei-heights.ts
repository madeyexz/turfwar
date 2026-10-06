import { C, FACE, KERB, Kit, type Rect } from './taipei-cover';
import { SHOP_STOREY } from './taipei-interiors';

/**
 * Level changes of the compact Ximending (a gameplay layer, see taipei-compact.ts): a way up next to
 * each bomb site and a rooftop route across the middle, each screened so it overlooks its own
 * corner of the map and not the length of a street:
 *   - the cinema balcony (戲院騎樓): a deck along the cinema block's front over Cinema Street
 *     (site A), up stairs from Huanhe Rd's sidewalk and from Xining S. Rd;
 *   - a plank bridge from the karaoke house's second storey (taipei-passages.ts) across Hanzhong St
 *     onto a canopy deck along the arcade's front (site B), a drop from the arcade's door;
 *   - the rooftop route: the 7-TWELVE roof behind the karaoke house (the helicopter's pad, up its
 *     stair house) and a covered skybridge across Emei St to the 7-TWELVE roof on the far side (up a
 *     ladder shaft from Militia's passage), both roofs screened by billboard frames;
 *   - sign gantries over Wuchang St, Xining S. Rd and Hanzhong St: big lit signs on frames you walk
 *     under, which cut the long views from the decks, the bridge and the scaffold.
 *
 * Coordinates are the source's (+x east, +z south, metres).
 */
export function heights(k: Kit) {
  balcony(k);
  canopyBridge(k);
  rooftops(k);
  gantry(k, [-816.8, -259.2, -816.0, -246.8], 2.6, 6.4, ['電影街', 'CINEMA STREET · 西門町'], ['西門町', 'XIMENDING · 武昌街'], 0x7a0a0a);
  gantry(k, [-819.2, -261.4, -806.8, -260.9], 2.6, 9.4, ['西門町', 'XIMENDING'], ['西寧南路', 'XINING S. RD · 電影 · 美食'], 0x0a1a3a);
  gantry(k, [-763.2, -262.4, -750.8, -261.9], 2.6, 8.0, ['漢中街', 'HANZHONG ST · 湯瑪熊'], ['西門町', 'XIMENDING · 徒步區'], 0x1a0a3a);
  gantry(k, [-806.6, -213.2, -806.0, -200.8], 2.6, 6.4, ['峨眉街', 'EMEI ST · 西門町'], ['峨眉街', 'EMEI ST · 紅樓'], 0x0a3a2a);
  gantry(k, [-763.2, -215.6, -754.5, -215.1], 2.6, 7.0, ['湯瑪熊', 'ARCADE · 歡樂城'], ['漢中街', 'HANZHONG ST · 西門町'], 0x3a1a4a);
  // The figure shop's roof (up its ladder shaft by site A) is screened on its east side and most of its south side.
  k.box(-819.55, -277.85, -819.3, -259.55, 18.9, 20.3, 'painted', 0x2a2a2e);
  k.box(-828.0, -259.55, -819.3, -259.3, 18.9, 20.3, 'painted', 0x2a2a2e);
  k.sign('billboard', -819.28, 19.6, -268.7, FACE.e, 17, 1.3, '西門町 動漫公仔', '#14041a', '#ff5ad8', 'FIGURES · ANIME · 3F');
}

const STEEL = 0x5a6068, DECK = 0x8a8e92;

/** Stairs over a rect rising toward dir (0 +x, 1 +z, 2 -x, 3 -z), with a rail along each long side. */
function flight(k: Kit, r: Rect, y0: number, y1: number, dir: 0 | 1 | 2 | 3) {
  const [x0, z0, x1, z1] = r, alongX = dir === 0 || dir === 2;
  k.stairs(r, y0, y1, dir);
  const posts = 4;
  for (let i = 0; i <= posts; i++) {
    const t = i / posts, y = dir === 0 || dir === 1 ? y0 + (y1 - y0) * t : y1 - (y1 - y0) * t;
    for (const side of [0, 1]) {
      if (alongX) { const x = x0 + (x1 - x0) * t, z = side ? z1 - 0.04 : z0 + 0.04; k.shape(x - 0.03, z - 0.03, x + 0.03, z + 0.03, y, y + 1.0, 'steel', STEEL); }
      else { const z = z0 + (z1 - z0) * t, x = side ? x1 - 0.04 : x0 + 0.04; k.shape(x - 0.03, z - 0.03, x + 0.03, z + 0.03, y, y + 1.0, 'steel', STEEL); }
    }
  }
  k.claim(r);
}

/** A deck slab over a rect with its top at y, on posts along its street edge. */
function deck(k: Kit, r: Rect, y: number, posts: 'n' | 's' | 'e' | 'w' | '', color = DECK) {
  const [x0, z0, x1, z1] = r;
  k.box(x0, z0, x1, z1, y - 0.2, y, 'slab', color);
  if (!posts) return;
  const alongX = posts === 'n' || posts === 's', from = alongX ? x0 : z0, to = alongX ? x1 : z1, n = Math.max(1, Math.round((to - from) / 6));
  for (let i = 0; i <= n; i++) {
    const a = from + 0.15 + (to - from - 0.3) * i / n;
    const [px, pz] = alongX ? [a, posts === 'n' ? z0 + 0.15 : z1 - 0.15] : [posts === 'w' ? x0 + 0.15 : x1 - 0.15, a];
    k.box(px - 0.1, pz - 0.1, px + 0.1, pz + 0.1, KERB, y - 0.2, 'steel', STEEL);
  }
}

/** Railing panels (waist-high cover) along a rect from y, painted. */
function rail(k: Kit, r: Rect, y: number, color = 0x3a3a3e) {
  const [x0, z0, x1, z1] = r;
  k.box(x0, z0, x1, z1, y, y + 1.0, 'painted', color);
  k.shape(x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02, y + 0.95, y + 1.05, 'steel', 0xc8ccd0);
}

/**
 * The cinema balcony: a deck at 2.9 m (under the marquee) along the cinema block's front on Wuchang
 * St, wrapping both corners, up a stair at each end. Its rail has two gaps to drop back to the street.
 */
function balcony(k: Kit) {
  const y = 2.9, z0 = -248.7, z1 = -246.7, west = -859.8, east = -817.3;
  deck(k, [west, z0, east, z1], y, 'n', 0x6a3a2a);
  // Rail along the street edge, gaps at x -847 and -830, and round both ends beside the stairs.
  for (const [a, c] of [[west, -848.0], [-846.0, -831.0], [-829.0, east]] as const) rail(k, [a, z0, c, z0 + 0.12], y, 0x7a1a1a);
  rail(k, [west, z0 + 0.12, west + 0.12, z1], y, 0x7a1a1a);
  rail(k, [east - 0.12, z0 + 0.12, east, z1], y, 0x7a1a1a);
  flight(k, [-859.4, z1, -857.85, z1 + 6.1], KERB, y, 3);
  flight(k, [-819.25, z1, -817.7, z1 + 6.1], KERB, y, 3);
  // Lit strip under the deck's edge and the marquee bulbs' glow on it.
  k.shape(west, z0 - 0.02, east, z0 + 0.02, y - 0.25, y - 0.2, 'neon', 0xffd890);
  k.sign('board', -853.5, y + 0.5, z0 - 0.03, FACE.n, 5.5, 0.55, '戲院 2F 看台', '#5a1a14', '#ffd890', 'CINEMA BALCONY');
}

/**
 * The plank bridge from the karaoke house's upstairs door (x -763.3, floor 4.2) down across Hanzhong
 * St to a canopy deck at 3 m along the arcade's front, between the street and the arcade's pillars.
 */
function canopyBridge(k: Kit) {
  const top = 3.0, cx0 = -754.4, cx1 = -750.95, zA = -235.9, zB = -213.9, z0 = -235.8, z1 = -234.2;
  deck(k, [cx0, zA, cx1, zB], top, 'w', 0x3a3548);
  for (const [a, c] of [[z1, -229.0], [-227.0, -225.0]] as const) rail(k, [cx0, a, cx0 + 0.12, c], top, 0x5a2a6a);
  k.box(cx0, -225.0, cx0 + 0.15, zB, top, top + 2.4, 'painted', 0x5a2a6a);
  // Screens at both ends: the deck looks over the arcade's front, not along Hanzhong St.
  k.box(cx0, zA, cx1, zA + 0.15, top, top + 2.4, 'painted', 0x5a2a6a);
  k.box(cx0, zB - 0.15, cx1, zB, top, top + 2.4, 'painted', 0x5a2a6a);
  // The bridge: planks on two steel stringers, rising west from the canopy to the upstairs door.
  const w0 = -763.3;
  k.b.ramp(k.s.X((w0 + cx0) / 2), k.s.Z((z0 + z1) / 2), cx0 - w0, z1 - z0, top, SHOP_STOREY, 2);
  for (const z of [z0, z1 - 0.08]) k.shape(w0, z, cx0, z + 0.08, top - 0.25, top, 'steel', STEEL);
  for (const z of [z0 - 0.06, z1]) k.box(w0 + 0.3, z, cx0, z + 0.06, top + 0.6, top + 1.6, 'steel', STEEL);
  k.sign('board', -752.0, top + 0.55, zA - 0.03, FACE.n, 2.0, 0.4, '湯瑪熊', '#5a2a6a', '#ffffff', 'ARCADE 2F');
  k.claim([w0, z0, cx1, z1]);
}

/**
 * The rooftop route: the 7-TWELVE roof behind the karaoke house (13.9 m, its stair house in the
 * north-west corner, the helicopter's pad in the middle) and the 7-TWELVE roof across Emei St (up a
 * ladder shaft), joined by a covered skybridge. Billboard frames screen both roofs' street sides.
 */
function rooftops(k: Kit) {
  const y = 13.9, h = 2.4, t = 0.25, door: [number, number] = [-769.7, -767.3];
  const screen = (r: Rect, color: number) => k.box(...r, y, y + h, 'painted', color);
  // North roof: the south screen (a door to the skybridge), the east screen over Hanzhong St.
  screen([-787, -213.3 - t, door[0], -213.3], 0x2a2a2e);
  screen([door[1], -213.3 - t, -763.3, -213.3], 0x2a2a2e);
  k.box(door[0], -213.3 - t, door[1], -213.3, y + 2.3, y + h, 'painted', 0x2a2a2e);
  screen([-763.3 - t, -230, -763.3, -213.3 - t], 0x2a2a2e);
  // The TAIPEI RUSH billboard over the south screen, facing Emei St.
  k.box(-776.5, -213.3 - t, -766.5, -213.3, y + h, y + h + 3.3, 'painted', C.dark);
  k.sign('billboard', -771.5, y + h + 1.65, -213.28, FACE.s, 9.6, 3.1, '臺北狂飆', '#c8141a', '#ffffff', 'TAIPEI RUSH · 西門町');
  // South roof: screens on its north (with the skybridge's door), east and south sides.
  screen([-776, -200.7, door[0], -200.7 + t], 0x3a2a2a);
  screen([door[1], -200.7, -763.3, -200.7 + t], 0x3a2a2a);
  k.box(door[0], -200.7, door[1], -200.7 + t, y + 2.3, y + h, 'painted', 0x3a2a2a);
  screen([-763.3 - t, -200.7 + t, -763.3, -178.4], 0x3a2a2a);
  screen([-776, -178.4 - t, -763.3 - t, -178.4], 0x3a2a2a);
  k.sign('billboard', -769.6, y + 1.3, -178.38, FACE.s, 11, 2.0, '西門町', '#0a5aa8', '#ffffff', 'XIMENDING · 徒步區');
  // The skybridge: floor, walls and roof across Emei St, lit inside.
  const [x0, x1] = door, z0 = -213.3, z1 = -200.7;
  k.box(x0, z0, x1, z1, y - 0.3, y, 'slab', 0xb8b4ac);
  k.box(x0, z0, x0 + 0.15, z1, y, y + h, 'painted', 0xd8d4cc);
  k.box(x1 - 0.15, z0, x1, z1, y, y + h, 'painted', 0xd8d4cc);
  k.box(x0, z0, x1, z1, y + h, y + h + 0.2, 'slab', 0x8a8e92);
  k.shape(x0 - 0.02, z0, x0, z1, y + 0.9, y + 1.0, 'neon', 0x3ad8ff);
  k.shape(x1, z0, x1 + 0.02, z1, y + 0.9, y + 1.0, 'neon', 0x3ad8ff);
  for (let z = z0 + 2; z < z1; z += 3) k.shape(x0 + 0.4, z - 0.3, x1 - 0.4, z + 0.3, y + h - 0.05, y + h, 'light');
  k.sign('board', x0 - 0.02, y + 1.6, (z0 + z1) / 2, FACE.w, 8, 0.6, '西門天橋', '#0a1a3a', '#3ad8ff', 'XIMEN SKYWALK');
  k.sign('board', x1 + 0.02, y + 1.6, (z0 + z1) / 2, FACE.e, 8, 0.6, '西門天橋', '#0a1a3a', '#3ad8ff', 'XIMEN SKYWALK');
  // Steel trusses under it (the source's 7-TWELVE fronts stay drawn below).
  for (const x of [x0 + 0.2, x1 - 0.2]) k.shape(x - 0.1, z0, x + 0.1, z1, y - 1.0, y - 0.3, 'steel', STEEL);
}

/**
 * A sign gantry across a street: a lit sign panel on a frame, its bottom at y0 (walk under it),
 * on two legs at its ends; the signs face along the street both ways.
 */
function gantry(k: Kit, r: Rect, y0: number, y1: number, front: [string, string], back: [string, string], bg: number) {
  const [x0, z0, x1, z1] = r, alongX = x1 - x0 > z1 - z0;
  k.box(x0, z0, x1, z1, y0, y1, 'painted', bg);
  const legs: Rect[] = alongX ? [[x0, z0, x0 + 0.3, z1], [x1 - 0.3, z0, x1, z1]] : [[x0, z0, x1, z0 + 0.3], [x0, z1 - 0.3, x1, z1]];
  for (const l of legs) k.box(...l, KERB, y0, 'steel', STEEL);
  const color = `#${bg.toString(16).padStart(6, '0')}`;
  const w = (alongX ? x1 - x0 : z1 - z0) - 0.8, hgt = Math.min(y1 - y0 - 0.6, 3.2), yc = (y0 + y1) / 2;
  if (alongX) {
    k.sign('screen', (x0 + x1) / 2, yc, z0 - 0.03, FACE.n, w, hgt, front[0], color, '#ffffff', front[1]);
    k.sign('board', (x0 + x1) / 2, yc, z1 + 0.03, FACE.s, w, hgt, back[0], color, '#ffd23a', back[1]);
  } else {
    k.sign('board', x0 - 0.03, yc, (z0 + z1) / 2, FACE.w, w, hgt, front[0], color, '#ffd23a', front[1]);
    k.sign('board', x1 + 0.03, yc, (z0 + z1) / 2, FACE.e, w, hgt, back[0], color, '#ffffff', back[1]);
  }
  for (const [a, b] of [[y0 - 0.04, y0], [y1, y1 + 0.04]]) k.shape(x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02, a, b, 'neon', 0xffd890);
  k.claim(r);
}
