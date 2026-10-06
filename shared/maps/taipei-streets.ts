import { C, FACE, KERB, Kit, crates, hoarding, island, kiosk, roadwork, stalls, truck, van, type Rect } from './taipei-cover';

/**
 * Street cover of the compact Ximending (a gameplay layer, see taipei-compact.ts): Emei St as the
 * cut-through cars can take across the core, and the blocks of cover that keep every street's
 * views short.
 *
 * Emei St's drive lane (EMEI) runs in bands along one side of the street or the other, swinging
 * across at three bends; what stands in the street stands on the band the lane is not using, so
 * a car weaves through and nobody sees down the street's length. The crossings get a kiosk each in
 * the middle, the pedestrian streets' long runs a block of stalls or a van.
 *
 * Coordinates are the source's (+x east, +z south, metres).
 */
const N0 = -213.0, N1 = -208.4, S0 = -205.6, S1 = -201.0;
/** Emei St's drive lane, west to east: bands and the bends between them (source rects). */
export const EMEI: Rect[] = [
  [-861.5, N0, -834, N1],     // from Huanhe Rd along the north side, past the truck and the stalls
  [-834, N0, -825, S1],       // bend
  [-825, S0, -802, S1],       // the south side, past Militia's barricade at Xining S. Rd
  [-802, N0, -793, S1],       // bend
  [-793, N0, -752, N1],       // the north side, past the 7-TWELVE and the temple stage
  [-752, N0, -743, S1],       // bend
  [-743, S0, -715, S1],       // the south side out to Zhonghua Rd
];

export function streetCover(k: Kit) {
  emei(k);
  crossings(k);
}

/**
 * Emei St: cover on the side of the street the lane is not using, full height from that side's
 * facades to the lane's edge, and close up to the bends (so no line runs down the street between
 * the two sides' cover).
 */
function emei(k: Kit) {
  const n = N1 + 0.4, s = S0 - 0.4;
  // West of Xining S. Rd (the lane on the north side): a moving truck parked across the south side,
  // stalls up to the first bend.
  truck(k, -851.0, n, false, 1);
  island(k, [-842.0, n, -834.2, -204.8], 'x');
  stalls(k, [-842.0, -204.6, -834.2, -200.75], 'n', 3);
  // At Xining S. Rd (the lane past the barricade on the south side): a screen by the tea house's
  // door, a stall island, and a van with a newsstand in front of it, all on the north side.
  hoarding(k, [-825.4, -213.25, -825.0, s], 'w', KERB, ['茶館 2F', 'TEA HOUSE · CAMERAS']);
  island(k, [-819.2, -212.9, -809.4, s], 'x');
  van(k, -807.6, -213.25, true, 1, 0xc8d8e8, ['西門快遞', 'XIMEN EXPRESS']);
  kiosk(k, [-807.4, -210.9, -802.6, s], 's', '報攤', 'NEWS', 0x2a6a4a);
  // Past the 7-TWELVE (the lane on the north side): a walled roadwork, then stalls either side of
  // the sneaker hall's door, then the temple stage (taipei-cover.ts).
  roadwork(k, [-793.0, n, -787.6, -200.9], true);
  island(k, [-779.6, n, -772.4, -204.8], 'x');
  stalls(k, [-779.6, -204.6, -772.4, -200.75], 'n', 3);
  // East of Hanzhong St (the lane on the south side): a stall island, a van behind a betel-nut
  // booth and a lottery booth.
  island(k, [-743.0, -212.9, -739.6, s], 'x');
  van(k, -733.5, -213.25, true, -1, 0xf0f0ea, ['宅配通', 'HOME DELIVERY']);
  kiosk(k, [-733.3, -211.0, -728.5, s], 's', '檳榔', 'BETEL NUT', 0x1a1a1a);
  kiosk(k, [-727.5, -213.1, -721.5, s], 's', '彩券', 'LOTTERY', 0xc8641a);
}

/** A kiosk in the middle of each crossing of the pedestrian streets, and the side streets' blockers. */
function crossings(k: Kit) {
  kiosk(k, [-817.4, -255.0, -809.0, -251.0], 's', '派出所', 'POLICE BOX · 西門', 0x1a3a7a);
  kiosk(k, [-761.0, -255.0, -753.0, -251.0], 'n', '彩券', 'LOTTERY · 刮刮樂', 0x2a7a4a);
  // Wuchang St east of Hanzhong St: a construction compound along the north side, a booth on the south.
  compound(k, [-747.0, -259.2, -731.0, -254.0]);
  kiosk(k, [-738.0, -254.0, -734.5, -248.5], 'w', '雞蛋糕', 'EGG CAKES', 0xc8641a);
  // A ticket booth under the cinema balcony, east of the lobby's door.
  kiosk(k, [-831.5, -249.6, -828.5, -246.8], 'n', '售票', 'TICKETS · 電影街', 0x7a1a2a);
  // Sign boards over the stall islands in Xining S. Rd (views over the stalls stop at them).
  topBoard(k, [-819.2, -212.9, -809.4, S0 - 0.4], '西門 夜市', 'NIGHT MARKET');
  topBoard(k, [-814.6, -221.1, -809.9, -218.9], '西門 美食', 'STREET FOOD');
  kiosk(k, [-752.8, -194.6, -750.8, -191.2], 'w', '冰', 'SHAVED ICE', 0x1a7a3a);
  kiosk(k, [-761.0, -220.6, -757.6, -217.2], 'e', '雞排', 'FRIED CHICKEN', 0xc8641a);
  // The arcade's prize booth under its canopy (site B), and the Emei St sign over the Xining S. Rd crossing.
  kiosk(k, [-754.0, -229.0, -751.6, -225.6], 'w', '兌獎', 'PRIZES · 湯瑪熊', 0x5a2a6a);
  kiosk(k, [-753.6, -217.2, -751.2, -214.2], 'w', '夾娃娃', 'CLAW MACHINES', 0xd8507a);
}

/** A lit sign board on top of a stall island, along its long axis (to 3.95 m). */
function topBoard(k: Kit, [x0, z0, x1, z1]: Rect, text: string, sub: string) {
  const alongX = x1 - x0 >= z1 - z0, y0 = KERB + 2.2, y1 = KERB + 3.8;
  if (alongX) {
    const z = (z0 + z1) / 2;
    k.box(x0 + 0.3, z - 0.1, x1 - 0.3, z + 0.1, y0, y1, 'painted', C.dark);
    k.sign('board', (x0 + x1) / 2, (y0 + y1) / 2, z - 0.12, FACE.n, x1 - x0 - 0.8, 1.2, text, '#a8141a', '#ffffff', sub);
    k.sign('board', (x0 + x1) / 2, (y0 + y1) / 2, z + 0.12, FACE.s, x1 - x0 - 0.8, 1.2, text, '#a8141a', '#ffffff', sub);
  } else {
    const x = (x0 + x1) / 2;
    k.box(x - 0.1, z0 + 0.3, x + 0.1, z1 - 0.3, y0, y1, 'painted', C.dark);
    k.sign('board', x - 0.12, (y0 + y1) / 2, (z0 + z1) / 2, FACE.w, z1 - z0 - 0.8, 1.2, text, '#a8141a', '#ffffff', sub);
    k.sign('board', x + 0.12, (y0 + y1) / 2, (z0 + z1) / 2, FACE.e, z1 - z0 - 0.8, 1.2, text, '#a8141a', '#ffffff', sub);
  }
}

/**
 * A construction compound against a facade (its north side): hoarding round the other three sides
 * with a gate in the south one, materials and a site toilet inside.
 */
function compound(k: Kit, [x0, z0, x1, z1]: Rect) {
  const t = 0.2, gate = (x0 + x1) / 2;
  hoarding(k, [x0, z1 - t, gate - 1.4, z1], 's', KERB, ['西門都更', 'XIMEN RENEWAL']);
  hoarding(k, [gate + 1.4, z1 - t, x1, z1], 's');
  hoarding(k, [x0, z0 + 0.1, x0 + t, z1 - t], 'w');
  hoarding(k, [x1 - t, z0 + 0.1, x1, z1 - t], 'e');
  crates(k, x0 + 2.2, z0 + 1.4, 'x', true);
  crates(k, x1 - 2.4, z0 + 1.4, 'x', false);
  for (const [dx, dy] of [[-0.4, 0], [0.4, 0], [0, 0.66]] as const) k.b.cylinder(k.s.X(gate + 3.5 + dx), KERB + dy, k.s.Z(z0 + 3.6), 0.38, 4.8, 'steel', 'x', 0x7a6a5a);
  k.box(x0 + 0.5, z1 - 1.6, x0 + 1.7, z1 - 0.4, KERB, KERB + 2.3, 'painted', 0x2a6ab0);
  k.claim([x0, z0, x1, z1]);
}
