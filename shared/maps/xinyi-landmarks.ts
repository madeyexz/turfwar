import { towerLofts, towerNeedle, towerBeacons, towerOrnaments, TOWER, GLASS as TOWER_GLASS } from './tower101';
import { C, Xinyi, type R } from './xinyi-kit';
import { MILITIA_COURT, PLAZA, ROAD, SKY, SKYWALK, SWAT_COURT, TOWER_AT, VILLAGE, hillAt } from './xinyi-plan';

/**
 * Xinyi's set pieces (xinyi.ts): Taipei 101's base and the tower above it (drawn, from
 * shared/maps/tower101.ts), the west plaza with its MRT exit and sculpture (site B), the skywalk
 * over Xinyi Rd (site C), the village (site E), the helicopter's pad and the foot of Elephant
 * Mountain.
 */

/** Taipei 101: only its base collides; the tower above is drawn (client scenery). */
export function tower(t: Xinyi) {
  const { x, z } = TOWER_AT, h = TOWER.baseHalf0;
  // The base: a solid box with a lit lobby band, doors drawn on the four faces.
  t.box([x - h + 1, z - h + 1, x + h - 1, z + h - 1], 0, 14, 'curtain', 0x9ec4c8);
  const b = t.b;
  for (const [y0, y1, h0, n0, h1, n1, color, glow] of towerLofts()) {
    if (y1 < 13 && y0 < 13) continue;
    const lit = glow >= 2.5, isGlass = color === TOWER_GLASS;
    b.loft(x, z, Math.max(y0, 13.5), y1, h0, n0, h1, n1, lit ? 'neon' : isGlass ? 'curtain' : 'steel', lit ? 0xffe0a0 : isGlass ? 0x8cc8b4 : color, y1 === TOWER.crownTop);
  }
  for (const [ox, y, oz, nx, ny, nz, rx, ry, depth] of towerOrnaments()) b.disc(x + ox, y, z + oz, nx, ny, nz, rx, ry, depth, 'neon', 0x8a6a2a);
  for (const [r0, r1, y0, y1, color, glow] of towerNeedle()) b.raw({ kind: 'cylinder', x, y: y0, z, radius: r0, top: r1, height: y1 - y0, axis: 'y', style: glow >= 2 ? 'neon' : 'steel', color: glow >= 2 ? 0xfff0c8 : color });
  for (const [dx, y, dz, r] of towerBeacons()) b.raw({ kind: 'ball', x: x + dx, y, z: z + dz, radius: r, style: 'neon', color: 0xff3020 });
  // Entrance canopies and the vertical name sign on the west face.
  t.sign('blade', x - h - 0.2, 6, z + 8, -Math.PI / 2, 1.2, 5.4, '台北101', '#23272b', '#f4e6c0');
  t.sign('gate', x - h - 0.1, 9, z - 8, -Math.PI / 2, 10, 1.4, '台北101', '#14181c', '#ffd890', 'TAIPEI 101');
}

/** The west plaza: an MRT exit pavilion, a coffee kiosk, a sculpture, planters and trees (site B). */
export function westPlaza(t: Xinyi) {
  const [x0, z0, x1, z1] = PLAZA;
  // The exit pavilion (glazed, over the stairs down) in the south-west corner.
  t.box([-114, 34, -107, 46], 0, 3.2, 'concrete', 0x3a3e44);
  t.shape([-114.4, 33.6, -106.6, 46.4], 3.2, 3.5, 'glass', 0x9ac0cc);
  t.sign('board', -110.5, 2.6, 33.55, 0, 6, 0.9, '捷運 101/世貿站', '#d22a2a', '#ffffff', 'MRT EXIT 4');
  // The sculpture (a stack of blocks) at the plaza's heart, a kiosk and planters for cover.
  t.box([-93.5, -3.5, -90.5, -0.5], 0, 1.2, 'concrete', 0x8a847a);
  t.box([-92.8, -2.8, -91.2, -1.2], 1.2, 3.8, 'painted', 0xd82a2a);
  t.box([-92.2, -2.2, -91.8, -1.8], 3.8, 5.2, 'steel', 0xc8ccd0);
  t.booth([-107, -22, -103.8, -19.8], 'e', '咖啡', 'COFFEE', 0x1e5a3a, '#1e5a3a');
  for (const r of [[-100, 14, -94, 16], [-84, -26, -78, -24], [-84, 24, -78, 26], [-106, -40, -100, -38]] as R[]) t.planter(r, 0, 2.2);
  const data: number[] = [];
  for (const [x, z] of [[-112, -50], [-112, -10], [-112, 20], [-76, -52], [-76, 46], [-100, 48]]) { data.push(x, 0, z, 0.3, 1, 0, 0xffffff, 0); t.box([x - 0.4, z - 0.4, x + 0.4, z + 0.4], 0, 3.6, 'invisible'); }
  t.raw({ kind: 'instances', model: 'tree:banyan', data });
  t.sign('billboard', -114, 7, -58, Math.PI / 2, 9, 3, '信義', '#c8141e', '#ffffff', 'XINYI');
  void x0; void z0; void x1; void z1;
}

/** The skywalk: a deck 8 m up over Xinyi Rd from the department stores' alley to the plaza, with a stair down and a ladder up from the sidewalk (site C). */
export function skywalk(t: Xinyi) {
  const [x0, z0, x1, z1] = SKYWALK;
  const deck: R = [x0, z0, x1, z1];
  t.box(deck, SKY - 0.4, SKY, 'floor');
  // Glazed sides (a window band above a solid sill), the east one open at the ladder.
  for (const [a, b2] of [[z0, -104.6], [-103.4, z1]]) t.box([x1 - 0.2, a, x1, b2], SKY, SKY + 1.2, 'window', 0x9ac0cc);
  t.box([x0, z0, x0 + 0.2, z1], SKY, SKY + 1.2, 'window', 0x9ac0cc);
  // A solid roof over the deck makes it a glazed corridor: the roads see no one on it.
  t.shape([x0 - 0.1, z0, x1 + 0.1, z1], SKY + 3.2, SKY + 3.4, 'steel', 0x5a6068);
  t.shape([(x0 + x1) / 2 - 0.15, z0, (x0 + x1) / 2 + 0.15, z1], SKY + 3.12, SKY + 3.2, 'neon', 0xf4f0e0);
  // The north end meets the department stores' alley: an end wall. A ladder up the east side from the forecourt's sidewalk.
  t.box([x0, z0, x1, z0 + 0.3], SKY, SKY + 3.2, 'window', 0x9ac0cc);
  t.b.ladder(x1, -104, 0, SKY, 2, 0.9);
  // The plaza end: a flight down, and the mid-span pier in Xinyi Rd's median.
  t.flight([x0, -68, x1, -52], 0, SKY, 3, { base: 0, color: 0xd0cabe });
  t.cheek([x0 - 0.3, -68, x0, -52], 0, 0, SKY, 3, 4, 0xd8d4ca, 1.0);
  t.cheek([x1, -68, x1 + 0.3, -52], 0, 0, SKY, 3, 4, 0xd8d4ca, 1.0);
  t.box([-95.4, -89.1, -92.6, -86.9], 0, SKY - 0.4, 'concrete', 0xb8b4aa);
  t.sign('gate', -94, SKY + 4.4, z0 + 20, Math.PI / 2, 10, 1.2, '信義空橋', '#14306a', '#ffffff', 'XINYI SKYWALK');
  // Cover on the deck: planters and a seat (the deck is the only place to see along the road from up here).
  t.planter([x0 + 0.4, -96, x0 + 2.4, -93], SKY, 2.2); t.planter([x1 - 2.4, -84, x1 - 0.4, -81], SKY, 2.2); t.planter([x0 + 0.4, -76, x0 + 2.4, -73], SKY, 2.2);
  void SWAT_COURT; void C;
}

/** The village (四四南村 in spirit): rows of low brick houses with tin roofs and lanes between, a middle row to fight through with a roof lookout (site E). */
export function village(t: Xinyi) {
  const [vx0, vz0, vx1, vz1] = VILLAGE;
  // Front row, facing Heping Rd's south sidewalk: houses 12 × 7, with 4 m gaps (gates).
  const house = (r: R, tin: number) => {
    t.box(r, 0, 3.6, 'brick', 0xffffff);
    t.shape([r[0] - 0.4, r[1] - 0.4, r[2] + 0.4, r[3] + 0.4], 3.6, 3.75, 'roof', tin);
    t.shape([r[0] + 0.5, r[1] + 0.5, r[2] - 0.5, r[3] - 0.5], 3.75, 4.9, 'roof', tin);
    for (let x = r[0] + 2; x < r[2] - 1; x += 3.5) { t.b.detail(x, 1.0, r[1] - 0.03, 1.1, 1.4, 0.1, 'window', 0x2a3a4a); t.b.detail(x, 1.0, r[3] + 0.03, 1.1, 1.4, 0.1, 'window', 0x2a3a4a); }
  };
  const tins = [0x8ab8f8, 0xf0a878, 0xa8e0b0, 0xffffff];
  let k = 0;
  for (let x = vx0 + 2; x + 12 <= vx1 - 2; x += 16) house([x, vz0 + 2, x + 12, vz0 + 9], tins[k++ % 4]);
  // Back row.
  for (let x = vx0 + 6; x + 12 <= vx1 - 2; x += 17) house([x, vz1 - 9, x + 12, vz1 - 2], tins[k++ % 4]);
  // The middle row: an enterable range of rooms (brick walls, doors and windows, a tin roof) with a ladder up to its roof.
  t.b.bunker(40, 125, 40, 7.5, {
    y: 0, h: 4.0, style: 'brick', roof: true,
    doors: [['n', -14, 1.8], ['n', 2, 1.8], ['s', -6, 1.8], ['s', 14, 1.8], ['w', 0, 1.8], ['e', 0, 1.8]],
    windows: [['n', -6, 1.6], ['n', 12, 1.6], ['s', -16, 1.6], ['s', 4, 1.6]],
  });
  for (const x of [32, 48]) t.box([x - 0.15, 121.5, x + 0.15, 128], 0, 4, 'plaster', 0xe8e0d0);
  t.b.ladder(60.4, 125, 0, 4.35, 2);
  t.sign('gate', 20, 4.4, vz0 + 0.1, 0, 4.2, 1.2, '眷村', '#5a1a14', '#ffd890', 'THE VILLAGE');
  // Crates, barrels and a hand cart in the lanes (cover).
  for (const [x, z, w] of [[12, 118, 1.6], [30, 134, 1.4], [70, 118, 1.6], [84, 134, 1.5], [52, 111, 1.4]]) t.box([x, z, x + w, z + w], 0, 1.2, 'crate', 0xa07848);
  void vz1;
}

/** The foot of Elephant Mountain: woods on the slope, the trailhead gate and boulders. */
export function hillside(t: Xinyi) {
  for (let x = 120; x < 134; x += 9) for (let z = -138; z < 140; z += 10) {
    const jx = ((x * 37 + z * 11) % 7) - 3, jz = ((x * 13 + z * 29) % 5) - 2;
    if (Math.abs(z + jz - 60) < 4) continue; // the trail
    t.b.tree(x + jx, z + jz, 0.8 + ((x + z) % 5) * 0.12, (x + z) % 3 ? 1 : 2);
  }
  for (const z of [56, 64]) t.box([118.6, z - 0.2, 119.4, z + 0.2], 0, 4.2, 'wood', 0x6b4a2a);
  t.shape([118.4, 55.6, 119.6, 64.4], 4.2, 4.6, 'wood', 0x6b4a2a);
  t.sign('gate', 118.2, 3.4, 60, -Math.PI / 2, 6.2, 1.2, '象山親山步道', '#3d6b35', '#ffffff', 'ELEPHANT MOUNTAIN TRAIL');
  for (const [x, z, s] of [[124, 20, 2.2], [126, -40, 1.8], [122, 100, 2.6], [128, -100, 2]]) t.box([x - s, z - s * 0.8, x + s, z + s * 0.8], hillAt(x, z) - 0.5, hillAt(x, z) + s * 0.9, 'rock');
}

/** The helicopter's pad on Xinyi Rd's east end: an H in a square, lamps at the corners. */
export function helipad(t: Xinyi, x: number, z: number) {
  const y = 0.014, PAINT = 0xf2efe6;
  const mark = (dx: number, dz: number, w: number, d: number) => t.raw({ kind: 'marking', x: x + dx, y, z: z + dz, w, d, color: PAINT });
  for (const s of [-1, 1]) { mark(s * 4.2, 0, 0.3, 8.7); mark(0, s * 4.2, 8.7, 0.3); mark(s * 1.3, 0, 0.45, 3.6); }
  mark(0, 0, 2.6, 0.45);
  for (const [dx, dz] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]) t.shape([x + dx - 0.12, z + dz - 0.12, x + dx + 0.12, z + dz + 0.12], 0, 0.4, 'neon', 0x5aff8a);
  void ROAD; void SWAT_COURT; void MILITIA_COURT;
}
