import { C, type Kit, type R } from './memorial-kit';

/**
 * Memorial Hall's museum (memorial.ts): what stands in the rooms of the ground floor (G, 0 m) and the
 * upper gallery (M, 4.5 m). Display cases are cover: tall glass cases stop a soldier and his view,
 * table cases only his legs. Everything leaves the doorways' lanes (on the nav lattice) clear.
 */
const G = 0, M = 4.5, G_TOP = 4, M_TOP = 8.5;

/** Glass display case on a wooden plinth, with something inside. tall: 2.1 m (full cover), else a 1.1 m table case. */
function vitrine(k: Kit, r: R, y: number, tall: boolean, exhibit = 0) {
  const top = y + (tall ? 2.1 : 1.1), plinth = y + (tall ? 0.7 : 0.8);
  k.block(r, y, top, 'glass');
  k.shape(r, y, plinth, 'wood', C.woodDark);
  k.shape([r[0] + 0.03, r[1] + 0.03, r[2] - 0.03, r[3] - 0.03], plinth, top - 0.06, 'glass');
  k.shape(r, top - 0.06, top, 'painted', C.bronzeDark);
  // A lit strip under the lid, and the exhibit: porcelain, a bronze vessel or a scroll.
  k.shape([r[0] + 0.1, r[1] + 0.1, r[2] - 0.1, r[3] - 0.1], top - 0.1, top - 0.07, 'neon', 0xfff0d0);
  const cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2;
  if (exhibit % 3 === 0) {
    k.b.raw({ kind: 'cylinder', x: cx, y: plinth, z: cz, radius: 0.16, height: 0.32, axis: 'y', style: 'painted', color: 0xe8eef4, top: 0.1 });
    k.b.raw({ kind: 'cylinder', x: cx, y: plinth + 0.32, z: cz, radius: 0.1, height: 0.16, axis: 'y', style: 'painted', color: 0x3a6ab0, top: 0.06 });
  } else if (exhibit % 3 === 1) {
    k.b.raw({ kind: 'cylinder', x: cx, y: plinth, z: cz, radius: 0.22, height: 0.26, axis: 'y', style: 'painted', color: 0x4a5a3a, top: 0.26 });
  } else {
    const w = r[2] - r[0] > r[3] - r[1];
    k.shape(w ? [cx - 0.5, cz - 0.15, cx + 0.5, cz + 0.15] : [cx - 0.15, cz - 0.5, cx + 0.15, cz + 0.5], plinth, plinth + 0.03, 'painted', 0xeae0c8);
  }
}

/** Wall-hung exhibit panels (drawn only): a framed print on the face of a wall at x or z. */
function panel(k: Kit, axis: 'x' | 'z', face: number, out: number, a: number, c: number, y: number, h = 1.6, color: number = 0x8a6a4a) {
  const r: R = axis === 'x' ? [a, Math.min(face, face + out), c, Math.max(face, face + out)] : [Math.min(face, face + out), a, Math.max(face, face + out), c];
  k.shape(r, y, y + h, 'painted', C.bronzeDark);
  const inner: R = axis === 'x' ? [a + 0.08, r[1] - 0.005 * Math.sign(out), c - 0.08, r[3] + 0.005 * Math.sign(out)] : [r[0] - 0.005 * Math.sign(out), a + 0.08, r[2] + 0.005 * Math.sign(out), c - 0.08];
  k.shape(inner, y + 0.08, y + h - 0.08, 'painted', color);
}

/** Ceiling light panels in a grid over a room (drawn only, lit). */
function lights(k: Kit, r: R, y: number, step = 5) {
  for (let x = r[0] + step / 2; x < r[2]; x += step) for (let z = r[1] + step / 2; z < r[3]; z += step) {
    k.shape([x - 0.6, z - 0.6, x + 0.6, z + 0.6], y - 0.06, y - 0.02, 'light');
  }
}

export function galleries(k: Kit) {
  entranceHall(k);
  for (const s of [-1, 1]) {
    exhibitionWest(k, s);
    exhibitionCentre(k, s);
  }
  lectureHall(k);
  galleryHall(k);
  lobby(k);
  library(k);
  giftShop(k);
  exhibitionFive(k);
  upperGallery(k);
}

/** Entrance hall under the grand staircase: the scale model of the hall, the information desks and benches. */
function entranceHall(k: Kit) {
  // Scale model of the hall on a plinth (cover in the middle of the hall).
  k.box([-35.5, -2, -31.5, 2], G, 1, 'painted', C.woodDark);
  k.block([-35, -1.5, -32, 1.5], 1, 2.3);
  k.shape([-35.2, -1.7, -31.8, 1.7], 1, 1.25, 'painted', C.marble);
  k.shape([-34.8, -1.3, -32.2, 1.3], 1.25, 1.5, 'painted', C.marble);
  k.shape([-34.4, -0.9, -32.6, 0.9], 1.5, 1.95, 'painted', C.marble);
  k.b.raw({ kind: 'cylinder', x: -33.5, y: 1.95, z: 0, radius: 1.15, height: 0.18, axis: 'y', style: 'painted', color: C.blue, sides: 8, top: 0.8 });
  k.b.raw({ kind: 'cylinder', x: -33.5, y: 2.13, z: 0, radius: 0.75, height: 0.35, axis: 'y', style: 'painted', color: C.blue, sides: 8, top: 0.08 });
  k.shape([-36.3, -0.75, -35.2, 0.75], 1, 1.12, 'painted', C.step);
  // Information desks by the west doors.
  for (const s of [-1, 1]) {
    k.box([-38.5, s < 0 ? -7 : 5, -36.5, s < 0 ? -5 : 7], G, 1.1, 'wood', C.wood);
    k.shape([-38.6, s < 0 ? -7.1 : 4.9, -36.4, s < 0 ? -4.9 : 7.1], 1.1, 1.16, 'painted', C.marble);
    k.box([-30, s * 11, -28, s * 12], G, 0.5, 'wood', C.wood);
    // A photo wall between the west doors and the Gallery Hall's doors.
    const [p0, p1] = s < 0 ? [-8.5, -4] : [4, 8.5];
    k.box([-33.5, p0, -33, p1], G, 2.4, 'painted', C.cream);
    panel(k, 'z', -33.5, -0.04, p0 + 0.3, p1 - 0.3, 0.6, 1.6, 0x4a5a6a);
    panel(k, 'z', -33, 0.04, p0 + 0.3, p1 - 0.3, 0.6, 1.6, 0x6a5a4a);
  }
  for (const z of [-11, 11]) panel(k, 'x', z > 0 ? 13.35 : -13.35, z > 0 ? -0.06 : 0.06, -39.5, -28, 1.2, 2, 0x5a6a7a);
  panel(k, 'z', -26.65, -0.06, -6, 6, 1.0, 2.4, 0x7a5a3a);
  lights(k, [-40.75, -13.35, -26.65, 13.35], G_TOP);
}

/** West exhibition rooms (north and south of the entrance hall). */
function exhibitionWest(k: Kit, s: number) {
  const Z = (a: number, c: number): [number, number] => s < 0 ? [a, c] : [-c, -a];
  const r = (x0: number, za: number, x1: number, zc: number): R => { const [p, q] = Z(za, zc); return [x0, p, x1, q]; };
  // Tall cases along the walls, table cases in the middle (lanes from every door kept open).
  vitrine(k, r(-40.6, -21, -39.6, -16), G, true, 0);
  vitrine(k, r(-40.6, -33.1, -36, -32.1), G, true, 1);
  vitrine(k, r(-29.4, -33.1, -27, -32.1), G, true, 2);
  vitrine(k, r(-37.75, -28.75, -35.25, -26.75), G, true, 1);
  vitrine(k, r(-37.75, -21.25, -35.25, -19.25), G, false, 0);
  vitrine(k, r(-30.25, -26.25, -28.75, -22.75), G, true, 2);
  vitrine(k, r(-30.25, -19.25, -28.75, -16.25), G, false, 1);
  k.box(r(-34, -17.25, -31, -16.75), G, 2.4, 'painted', C.cream);
  for (const [a, c] of [[-40, -38], [-36, -34]]) panel(k, 'x', s < 0 ? -33.25 : 33.25, s < 0 ? 0.06 : -0.06, a, c, 1.1, 1.8);
  lights(k, r(-40.75, -33.25, -26.65, -14.15), G_TOP);
}

/** Exhibition rooms either side of the Gallery Hall (with the stairs up to the upper gallery). */
function exhibitionCentre(k: Kit, s: number) {
  const Z = (a: number, c: number): [number, number] => s < 0 ? [a, c] : [-c, -a];
  const r = (x0: number, za: number, x1: number, zc: number): R => { const [p, q] = Z(za, zc); return [x0, p, x1, q]; };
  vitrine(k, r(-25.7, -33.1, -21, -32.1), G, true, 0);
  vitrine(k, r(-15, -33.1, -12, -32.1), G, true, 2);
  vitrine(k, r(-21.25, -30.25, -18.75, -28.75), G, true, 1);
  vitrine(k, r(-15.25, -30.25, -12.75, -28.75), G, true, 0);
  vitrine(k, r(-21.25, -17.5, -18.75, -12.5), G, true, 2);
  vitrine(k, r(-13.75, -19.75, -12.25, -17.25), G, false, 1);
  vitrine(k, r(-25.7, -16.25, -24.7, -11.25), G, true, 0);
  panel(k, 'z', -11.65, -0.06, s < 0 ? -26 : 20, s < 0 ? -20 : 26, 1.1, 1.8, 0x6a4a3a);
  lights(k, r(-25.85, -33.25, -11.65, -9.15), G_TOP);
}

/** Lecture hall (north of the Gallery Hall): a stage, a screen and rows of seats (low cover). */
function lectureHall(k: Kit) {
  k.box([-9.5, -33.25, 4.5, -30.5], G, 0.45, 'wood', C.wood);
  k.box([-3.2, -31.9, -1.8, -31.1], 0.45, 1.6, 'wood', C.woodDark);
  k.shape([-8, -33.27, 3, -33.2], 1.4, 3.6, 'painted', 0x20242a);
  k.shape([-7.8, -33.2, 2.8, -33.18], 1.55, 3.45, 'neon', 0x7aa4d8);
  for (let z = -26.25; z <= -13.75; z += 2.5) {
    for (const [x0, x1] of [[-9.5, -4], [-1, 4.5]]) {
      k.box([x0, z - 0.3, x1, z + 0.3], G, 0.5, 'painted', C.red);
      k.box([x0, z + 0.2, x1, z + 0.4], G, 0.95, 'wood', C.woodDark);
    }
  }
  lights(k, [-10.85, -33.25, 5.85, -9.15], G_TOP, 4);
}

/** Gallery Hall (site A): double height under the upper gallery's balconies; the vintage black limousine on show, big cases. */
function galleryHall(k: Kit) {
  // The limousine (cover): body, cabin, wheels and chrome, behind stanchions.
  const [x0, x1, z0, z1] = [-8, -2, -1.05, 1.05];
  k.box([x0, z0, x1, z1], G + 0.3, 1.05, 'painted', 0x141618);
  k.box([x0 + 1.4, z0 + 0.1, x1 - 1.1, z1 - 0.1], 1.05, 1.6, 'painted', 0x141618);
  k.shape([x0 + 1.5, z0 + 0.08, x1 - 1.2, z1 - 0.08], 1.12, 1.52, 'glass');
  k.block([x0, z0, x1, z1], G, 0.3, 'metal');
  for (const wx of [x0 + 1.0, x1 - 1.0]) for (const wz of [z0 + 0.05, z1 - 0.37]) {
    k.b.raw({ kind: 'cylinder', x: wx, y: G, z: wz + 0.16, radius: 0.38, height: 0.32, axis: 'z', style: 'painted', color: 0x1a1a1a });
  }
  k.shape([x0 - 0.06, z0 + 0.2, x0, z1 - 0.2], 0.45, 0.85, 'painted', 0xd8dade);
  k.shape([x1, z0 + 0.2, x1 + 0.06, z1 - 0.2], 0.45, 0.8, 'painted', 0xd8dade);
  k.shape([x0 - 1.2, z0 - 1.2, x1 + 1.2, z1 + 1.2], G + 0.03, G + 0.12, 'painted', C.ink);
  for (const [px, pz] of [[x0 - 1.1, z0 - 1.1], [x1 + 1.1, z0 - 1.1], [x0 - 1.1, z1 + 1.1], [x1 + 1.1, z1 + 1.1]]) {
    k.b.raw({ kind: 'cylinder', x: px, y: G, z: pz, radius: 0.08, height: 0.95, axis: 'y', style: 'painted', color: C.gold });
  }
  // Tall cases at the void's corners and along the walls; table cases between.
  vitrine(k, [-11.75, -6.25, -10.75, -3.75], G, true, 0);
  vitrine(k, [-11.75, 3.75, -10.75, 6.25], G, true, 1);
  vitrine(k, [1.75, -6.25, 2.75, -3.75], G, true, 2);
  vitrine(k, [1.75, 3.75, 2.75, 6.25], G, true, 0);
  vitrine(k, [-18.75, -2, -16.25, 2], G, true, 1);
  vitrine(k, [-24.5, -2.25, -23, 2.25], G, true, 2);
  vitrine(k, [-3.5, -5, -1.5, -4], G, true, 2);
  vitrine(k, [-3.5, 4, -1.5, 5], G, true, 0);
  vitrine(k, [-24.5, -8.2, -21.5, -7.2], G, true, 2);
  vitrine(k, [-24.5, 7.2, -21.5, 8.2], G, true, 1);
  vitrine(k, [-15.5, 4.25, -13, 6.25], G, true, 0);
  vitrine(k, [-15.5, -6.25, -13, -4.25], G, false, 2);
  vitrine(k, [3, -1.25, 4.5, 1.25], G, true, 1);
  // Big photographic panels under the balconies, a banner hanging in the void.
  for (const z of [-8.35, 8.35]) panel(k, 'x', z, z < 0 ? 0.06 : -0.06, -10, -4, 1.2, 2.4, 0x6a7a8a);
  k.shape([-6.2, -0.04, -4.3, 0.04], 4.9, 8.2, 'painted', C.red);
  k.shape([-6.05, -0.06, -4.45, 0.06], 5.1, 8.0, 'painted', 0xd8b060);
  lights(k, [-25.85, -8.35, -11.25, 8.35], G_TOP);
  lights(k, [1.25, -8.35, 5.85, 8.35], G_TOP);
  lights(k, VOIDR, M_TOP, 4);
}
const VOIDR: R = [-11.25, -6.25, 1.25, 6.25];

/** East lobby: the stair up the middle, ticket counters, lifts and planters. */
function lobby(k: Kit) {
  // Ticket counters screen the east doors from the Gallery Hall.
  for (const s of [-1, 1]) {
    const z = (a: number, c: number): [number, number] => s < 0 ? [-c, -a] : [a, c];
    const [p, q] = z(3.25, 5.75);
    k.box([25.5, p, 29.5, q], G, 1.15, 'wood', C.wood);
    k.shape([25.4, p - 0.1, 29.6, q + 0.1], 1.15, 1.2, 'painted', C.marble);
    const [pp, qq] = z(3.5, 5.5);
    k.box([23, pp, 24.5, qq], G, 2.4, 'painted', C.marbleShade);
    // Lifts on the lobby's side walls.
    for (const x of [29.5, 32]) {
      const face = s < 0 ? -8.35 : 8.35, out = s < 0 ? 0.08 : -0.08;
      k.shape([x - 0.75, Math.min(face, face + out), x + 0.75, Math.max(face, face + out)], G, 2.6, 'steel', 0x8a8e92);
      k.shape([x - 0.03, Math.min(face, face + out * 1.4), x + 0.03, Math.max(face, face + out * 1.4)], G, 2.6, 'painted', 0x3a3e42);
      k.shape([x - 0.25, Math.min(face, face + out * 1.4), x + 0.25, Math.max(face, face + out * 1.4)], 2.8, 2.95, 'neon', 0xffb050);
    }
    // Planters with small trees either side of the stair's foot.
    const [a, c] = z(4.25, 6.75);
    k.box([20.75, a, 22.25, c], G, 0.9, 'painted', C.marbleShade);
    k.shape([20.95, a + 0.2, 22.05, c - 0.2], 0.9, 2.1, 'hedge', C.hedge);
    k.block([20.95, a + 0.2, 22.05, c - 0.2], 0.9, 2.1, 'dirt');
  }
  k.shape([14, -8.3, 18, -8.33], 1.6, 3.2, 'painted', C.bronzeDark);
  lights(k, [6.65, -8.35, 35.75, 8.35], G_TOP);
}

/** Library and reading room (north-east): shelves in blocks, reading tables, a help desk in the middle. */
function library(k: Kit) {
  for (const z of [-30, -27.5, -15, -12.5]) {
    for (const [x0, x1] of [[8.75, 18.75], [26.25, 33.75]]) {
      k.box([x0, z - 0.35, x1, z + 0.35], G, 2.2, 'wood', C.woodDark);
      for (let x = x0 + 0.3; x < x1 - 0.2; x += 1.2) k.shape([x, z - 0.37, x + 0.9, z + 0.37], 0.35, 2.0, 'painted', [0x8a3a2a, 0x2a4a6a, 0x5a6a3a, 0xc8b080][Math.floor(x * 7) & 3]);
    }
  }
  for (const [x0, z0] of [[10, -22.5], [14, -22.5], [28, -22.5], [32, -22.5]]) {
    k.box([x0 - 1, z0 - 0.6, x0 + 1, z0 + 0.6], G, 0.78, 'wood', C.wood);
  }
  for (const x of [14, 30]) k.box([x - 0.4, -24.5, x + 0.4, -17], G, 2.2, 'wood', C.woodDark);
  k.box([20.5, -21.25, 24.5, -18.75], G, 1.1, 'wood', C.wood);
  k.box([21.75, -20.6, 23.25, -19.4], G, 2.6, 'painted', C.marbleShade);
  lights(k, [6.65, -33.25, 35.75, -9.15], G_TOP);
}

/** Gift shop (south-east): shelving islands, a display table in the middle and the till. */
function giftShop(k: Kit) {
  for (const z of [13.75, 26.25]) for (const [x0, x1] of [[9, 18], [27, 34]]) {
    k.box([x0, z - 0.45, x1, z + 0.45], G, 1.6, 'painted', 0xe8e0d0);
    for (let x = x0 + 0.2; x < x1 - 0.3; x += 0.7) k.shape([x, z - 0.5, x + 0.5, z + 0.5], 0.4 + (x * 3 % 1) * 0.2, 1.0 + (x * 7 % 1) * 0.4, 'painted', [0xc83a2a, 0x3a6ab0, 0xe8c040, 0x3a8a5a][Math.floor(x * 3) & 3]);
  }
  k.box([20.75, 18.75, 24.25, 21.25], G, 1.0, 'wood', C.wood);
  k.box([21.75, 19.4, 23.25, 20.6], 1.0, 2.4, 'glass');
  k.box([31, 30.5, 35.6, 32], G, 1.1, 'wood', C.wood);
  k.shape([31.2, 30.6, 32.2, 31.4], 1.1, 1.45, 'painted', 0x2a2a2a);
  lights(k, [6.65, 9.15, 35.75, 33.25], G_TOP);
}

/** South-centre exhibition room (calligraphy and documents in table cases). */
function exhibitionFive(k: Kit) {
  vitrine(k, [-9.5, 12.5, -7, 15], G, false, 2);
  vitrine(k, [-9.5, 20, -7, 22.5], G, true, 2);
  vitrine(k, [-1, 15.75, 1.5, 19.25], G, true, 2);
  vitrine(k, [3.25, 23.75, 5.75, 26.25], G, false, 2);
  vitrine(k, [-6, 29.5, -1, 30.5], G, false, 2);
  vitrine(k, [1.5, 32.1, 5.7, 33.1], G, true, 1);
  for (const [a, c] of [[-9, -5], [-3, 1]]) panel(k, 'x', 33.25, -0.06, a, c, 1.1, 2, 0xe8dcc0);
  lights(k, [-10.85, 9.15, 5.85, 33.25], G_TOP);
}

/** Upper gallery (M): cases, benches on the balconies and the lifts beside the stairwells. */
function upperGallery(k: Kit) {
  for (const s of [-1, 1]) {
    const Z = (a: number, c: number): [number, number] => s < 0 ? [a, c] : [-c, -a];
    const r = (x0: number, za: number, x1: number, zc: number): R => { const [p, q] = Z(za, zc); return [x0, p, x1, q]; };
    // West gallery behind the grand staircase.
    vitrine(k, r(-30.6, -20, -29.6, -15), M, true, 0);
    vitrine(k, r(-27.5, -13.75, -25, -11.25), M, false, 1);
    if (s < 0) { vitrine(k, [-30.6, -4, -29.6, 4], M, true, 2); vitrine(k, [-16.5, -1, -13.5, 1], M, true, 1); }
    // Centre: cases north of the balconies, benches facing the void.
    vitrine(k, r(-18.75, -21.25, -16.25, -17.25), M, true, 1);
    vitrine(k, r(-8.75, -23.75, -6.25, -18.75), M, true, 0);
    vitrine(k, r(-13.75, -16.25, -11.25, -13.75), M, true, 2);
    vitrine(k, r(8.75, -22.5, 11.25, -20), M, true, 0);
    vitrine(k, r(15, -14.5, 18, -8.5), M, true, 1);
    if (s < 0) vitrine(k, [4, -3.25, 6.5, 3.25], M, true, 2);
    k.box(r(-8, -8.6, -4, -8), M, M + 0.45, 'wood', C.wood);
    // Lifts beside the stairwell to the chamber.
    k.shape(r(13.0, -13.6, 13.08, -12.1), M, M + 2.6, 'steel', 0x8a8e92);
    k.shape(r(13.0, -11.6, 13.08, -10.1), M, M + 2.6, 'steel', 0x8a8e92);
    // East gallery behind the rear staircase.
    vitrine(k, r(27, -22.5, 28.1, -17.5), M, true, 1);
    vitrine(k, r(23.75, -13.75, 26.25, -11.25), M, false, 2);
    lights(k, r(-30.75, -25.75, 28.25, -6.65), M_TOP);
  }
  lights(k, [-30.75, -6.65, -11.65, 6.65], M_TOP);
  lights(k, [1.65, -6.65, 28.25, 6.65], M_TOP);
}
