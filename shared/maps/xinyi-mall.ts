import { cover } from './memorial-kit';
import { C, Xinyi, type R } from './xinyi-kit';
import { B1, CEIL, DUG, F2, FILL, GARDEN, IN, MALL, NW_WELL, PASSAGE, PIT, SE_WELL, TOP, WALL } from './xinyi-plan';

/**
 * The podium mall (台北101購物中心 in spirit) east of the tower, opened as the centre of the fight
 * (site A), and the sunken garden beside it (D): a food court sunk to B1 under an atrium that
 * rises to a skylight, a ground-floor ring and a gallery at F2 round it, a bridge across the void,
 * stairs between the three floors, doors north, south and east, and a B1 passage out to a garden
 * with a pool and a pavilion. The upper floors are closed.
 */

/** The ground slab round the dig (solid fill from the bottom of the dig up to the street). */
export function fill(t: Xinyi) {
  for (const r of cover(FILL, DUG)) t.box(r, -6, 0, 'slab', 0xa8a6a2);
  // The floors of the dig.
  t.box(PIT, B1 - 0.25, B1, 'slab', 0xe2ddd2);
  t.box(PASSAGE, B1 - 0.25, B1, 'slab', 0xe2ddd2);
  t.box(GARDEN, B1 - 0.25, B1, 'slab', 0xbdb6a8);
}

/** A balustrade (solid 1.1 m with a rail), along the edge of a rectangle's side, with gaps [from, to] along it. */
function balustrade(t: Xinyi, r: R, y: number, gaps: [number, number][] = [], side: 'n' | 's' | 'e' | 'w' = 'n') {
  const [x0, z0, x1, z1] = r, alongX = side === 'n' || side === 's', lo = alongX ? x0 : z0, hi = alongX ? x1 : z1;
  const at = side === 'n' ? z0 : side === 's' ? z1 : side === 'w' ? x0 : x1;
  const run = (a: number, b: number) => {
    if (b - a < 0.3) return;
    const rect: R = alongX ? [a, at - 0.15, b, at + 0.15] : [at - 0.15, a, at + 0.15, b];
    t.box(rect, y, y + 1.1, 'painted', 0xe8e4da);
    t.shape(alongX ? [a, at - 0.2, b, at + 0.2] : [at - 0.2, a, at + 0.2, b], y + 1.1, y + 1.18, 'steel', 0xc8ccd0);
  };
  let cursor = lo;
  for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) { run(cursor, a); cursor = Math.max(cursor, b); }
  run(cursor, hi);
}

export function mall(t: Xinyi) {
  const [mx0, mz0, mx1, mz1] = MALL;
  const STONE = 0xb8bcb4;
  // Shell: walls from the street to the roof, glazed above the doors. Doors north and south at x = 22, east at z = -20 and 18.
  const door = 5, head = 4.4;
  t.wall('x', mz0 + WALL / 2, mx0, mx1, 0, TOP, [{ at: 22, width: door, top: head }], 'curtain', 0xb8d0d8, WALL);
  t.wall('x', mz1 - WALL / 2, mx0, mx1, 0, TOP, [{ at: 22, width: door, top: head }, { at: 6, width: 3.2, top: head }], 'curtain', 0xb8d0d8, WALL);
  t.wall('z', mx0 + WALL / 2, mz0 + WALL, mz1 - WALL, 0, TOP, [], 'concrete', STONE, WALL);
  t.wall('z', mx1 - WALL / 2, mz0 + WALL, mz1 - WALL, 0, TOP, [{ at: -20, width: door, top: head }, { at: 18, width: door, top: head }], 'curtain', 0xb8d0d8, WALL);
  // A stone base course on the outside of the glass, and signs over the doors.
  for (const [x0, z0, x1, z1] of [[mx0, mz0 - 0.1, mx1, mz0], [mx0, mz1, mx1, mz1 + 0.1]] as R[]) t.shape([x0, z0, x1, z1], 0, 1.2, 'concrete', STONE);
  t.sign('gate', 22, 5.8, mz0 - 0.1, 0, 12, 1.6, '購物中心', '#1a2a3a', '#f4e6c0', 'THE PODIUM MALL');
  t.sign('gate', 22, 5.8, mz1 + 0.1, Math.PI, 12, 1.6, '購物中心', '#1a2a3a', '#f4e6c0', 'THE PODIUM MALL');
  t.sign('gate', mx1 + 0.1, 5.8, -1, Math.PI / 2, 12, 1.6, '購物中心', '#1a2a3a', '#f4e6c0', 'THE PODIUM MALL');
  // The ground-floor floor: polished stone (the fill's top), drawn.
  for (const r of cover(IN, DUG)) t.shape(r, -0.02, 0.012, 'tile', 0xe2ddd2);
  // The gallery floor at F2: a slab over the ring, with the atrium void and the two stairwells cut out.
  for (const r of cover(IN, [PIT, NW_WELL, SE_WELL])) t.box(r, F2 - 0.3, F2, 'slab', 0xe6e0d6);
  // The upper floors (closed): glass and floors over the ring, open over the atrium.
  for (const r of cover(IN, [PIT])) t.box(r, CEIL, TOP - 0.3, 'curtain', 0xd8c8a8);
  t.box(PIT, TOP - 0.3, TOP, 'window', 0xbfe4ff);
  t.box(IN, TOP, TOP + 0.4, 'steel', 0x9aa0a6);
  // The atrium's walls: the dig's sides are the fill; above the gallery a drum of lit shopfront glass rises to the roof.
  for (const [x0, z0, x1, z1] of [[PIT[0] - 0.4, PIT[1] - 0.4, PIT[2] + 0.4, PIT[1]], [PIT[0] - 0.4, PIT[3], PIT[2] + 0.4, PIT[3] + 0.4], [PIT[0] - 0.4, PIT[1], PIT[0], PIT[3]], [PIT[2], PIT[1], PIT[2] + 0.4, PIT[3]]] as R[]) {
    t.shape([x0, z0, x1, z1], CEIL, TOP - 0.3, 'steel', 0xc8ccd0);
    for (let y = F2 + 4.4; y < TOP - 1; y += 4.4) t.shape([x0, z0, x1, z1], y - 0.3, y + 0.3, 'neon', 0xfff0d0);
  }

  // ---- Stairs: the food court up to the ground floor (west and east sides of the pit), the ground floor to the gallery (the wells).
  t.flight([PIT[0], 10, PIT[0] + 9, 15], B1, 0, 2, { base: B1 - 0.25, color: 0xd8d2c6 });
  t.flight([PIT[2] - 9, -15, PIT[2], -10], B1, 0, 0, { base: B1 - 0.25, color: 0xd8d2c6 });
  t.flight([PIT[0] + 6, PIT[3] - 8, PIT[0] + 15, PIT[3]], B1, 0, 1, { base: B1 - 0.25, color: 0xd8d2c6 });
  t.flight(NW_WELL, 0, F2, 3, { color: 0xd8d2c6 });
  t.flight(SE_WELL, 0, F2, 1, { color: 0xd8d2c6 });
  // Balustrades on the ground floor round the atrium (gaps at the stairs) and on the gallery.
  balustrade(t, PIT, 0, [], 'n');
  balustrade(t, PIT, 0, [[PIT[0] + 6, PIT[0] + 15]], 's');
  balustrade(t, [PIT[0], PIT[1], PIT[0] + 0.3, PIT[3]], 0, [[10, 15]], 'w');
  balustrade(t, [PIT[2] - 0.3, PIT[1], PIT[2], PIT[3]], 0, [[-15, -10], [-8, 2]], 'e');
  balustrade(t, PIT, F2, [], 'n'); balustrade(t, PIT, F2, [], 's');
  balustrade(t, [PIT[0], PIT[1], PIT[0] + 0.3, PIT[3]], F2, [[-2, 2]], 'w');
  balustrade(t, [PIT[2] - 0.3, PIT[1], PIT[2], PIT[3]], F2, [[-2, 2]], 'e');
  // The trench of the passage beyond the mall's wall, fenced.
  t.box([MALL[2] - 0.6, PASSAGE[1] - 0.3, GARDEN[0], PASSAGE[1]], 0, 1.1, 'painted', 0xe8e4da);
  t.box([MALL[2] - 0.6, PASSAGE[3], GARDEN[0], PASSAGE[3] + 0.3], 0, 1.1, 'painted', 0xe8e4da);
  // The bridge across the void on the gallery level.
  t.box([PIT[0], -2, PIT[2], 2], F2 - 0.3, F2, 'slab', 0xe6e0d6);
  t.shape([PIT[0] + 0.5, -2.1, PIT[2] - 0.5, 2.1], F2 - 0.9, F2 - 0.3, 'steel', 0x6a7078);

  // ---- Fittings
  // The food court: stalls with a counter and a canopy, tables, a fountain pool in the middle (low cover) and pillars.
  const stalls: R[] = [[12, -26, 15.6, -20], [12, 20, 15.6, 26], [28.4, -26, 32, -20], [28.4, 20, 32, 26], [20, -26, 26, -23.4], [20, 23.4, 26, 26]];
  stalls.forEach((r, i) => {
    t.box(r, B1, B1 + 1.1, 'wood', 0x7a4e30);
    t.shape([r[0] - 0.2, r[1] - 0.2, r[2] + 0.2, r[3] + 0.2], B1 + 3.0, B1 + 3.15, 'painted', [0xc8322a, 0xe8b830, 0x2a6ab8, 0x3f9a50][i % 4]);
    t.sign('board', (r[0] + r[2]) / 2, B1 + 3.6, (r[1] + r[3]) / 2 + (i < 2 ? 3.3 : i < 4 ? 3.3 : 0), 0, 3, 0.6, ['牛肉麵', '珍珠奶茶', '滷肉飯', '臭豆腐', '鹽酥雞', '蚵仔煎'][i], '#7a1a14', '#ffe9b0', ['BEEF NOODLES', 'BUBBLE TEA', 'BRAISED PORK RICE', 'STINKY TOFU', 'FRIED CHICKEN', 'OYSTER OMELETTE'][i]);
  });
  t.box([19, -4, 25, 4], B1, B1 + 0.9, 'concrete', 0xb8b0a0);
  t.b.water(22, B1 + 0.8, 0, 5.4, 7.4);
  for (const [x, z] of [[16, -10], [28, -10], [16, 10], [28, 10], [16, -16], [28, 16]]) t.box([x - 0.5, z - 0.5, x + 0.5, z + 0.5], B1, 0, 'pillar');
  for (const [x, z] of [[14, -2], [30, 2], [14, 6], [30, -6]]) { t.box([x - 0.8, z - 0.8, x + 0.8, z + 0.8], B1, B1 + 0.78, 'wood', 0x8a6a4a); }
  t.sign('screen', 22, F2 + 2.5, PIT[1] + 0.3, 0, 8, 3.4, '', '#000000', '#ffffff');
  // The ground-floor ring: shop counters and kiosks, pillars along the rings, signs.
  const shops: [R, string, string, string][] = [
    [[-1.4, -40, 2.4, -34], '潮牌', 'FASHION', '#141414'], [[-1.4, -28, 2.4, -20], '鞋店', 'SNEAKERS', '#c8141e'], [[-1.4, 20, 2.4, 28], '手機', 'MOBILE', '#0a4a8a'],
    [[-1.4, 34, 2.4, 42], '書店', 'BOOKS', '#3a2a6a'], [[41, -44, 49, -40], '眼鏡', 'OPTICAL', '#ffd24a'], [[41, 40, 49, 44], '藥妝', 'PHARMACY', '#1aa06a'],
    [[2, 36, 8, 38.4], '咖啡', 'COFFEE', '#5a3a28'], [[2, -38.4, 8, -36], '甜點', 'DESSERT', '#e04a8a'],
  ];
  for (const [r, zh, en, bg] of shops) {
    t.box(r, 0, 1.2, 'wood', 0x5a3a2a);
    t.box([r[0], r[1], r[2], r[3]], 1.2, 2.6, 'glass', 0x9ac0cc);
    t.sign('board', (r[0] + r[2]) / 2, 3.4, r[1] > 0 ? r[1] - 0.05 : r[3] + 0.05, r[1] > 0 ? 0 : Math.PI, Math.min(3.6, r[2] - r[0]), 0.7, zh, bg, '#ffffff', en);
  }
  for (const [x, z] of [[-1.5, -12], [-1.5, 12], [8, -42], [30, -44], [8, 42], [30, 44], [44, -12], [44, 12]]) t.box([x - 0.5, z - 0.5, x + 0.5, z + 0.5], 0, F2 - 0.3, 'pillar');
  // The gallery: kiosks and planters, a lit ceiling.
  for (const r of [[3, -44, 7, -41], [30, -46, 36, -43], [3, 41, 7, 44], [38, 40, 44, 42], [-1.4, -8, 2.4, -4], [-1.4, 4, 2.4, 8]] as R[]) {
    t.box(r, F2, F2 + 1.15, 'wood', 0x6a4a34);
    t.shape([r[0] - 0.1, r[1] - 0.1, r[2] + 0.1, r[3] + 0.1], F2 + 1.15, F2 + 1.25, 'painted', 0xe8e4da);
  }
  t.planter([40, -22, 44, -18], F2, 2.4); t.planter([40, 16, 44, 20], F2, 2.4);
  for (let x = mx0 + 4; x < mx1 - 2; x += 5) for (const [z0, z1] of [[IN[1], PIT[1]], [PIT[3], IN[3]]]) t.shape([x - 0.1, z0 + 1, x + 0.1, z1 - 1], F2 + 4.3, F2 + 4.4, 'neon', 0xfff6e8);
  for (let x = 2; x < 50; x += 6) for (const [z0, z1] of [[IN[1], PIT[1]], [PIT[3], IN[3]]]) t.shape([x - 0.1, z0 + 1, x + 0.1, z1 - 1], 4.3, 4.4, 'neon', 0xfff6e8);
  t.b.light(22, 18, 0, 0xfff0d8, 6, 40);
  void C;
}

/** The sunken garden: B1 beside the mall with a stair at each end, a pool with a stone rim, trees in beds, a pavilion and benches. */
export function sunkenGarden(t: Xinyi) {
  const [x0, z0, x1, z1] = GARDEN;
  t.flight([x0 + 12, z0, x0 + 24, z0 + 7.5], B1, 0, 3, { base: B1 - 0.25, color: 0xd0cabe });
  t.flight([x0 + 12, z1 - 7.5, x0 + 24, z1], B1, 0, 1, { base: B1 - 0.25, color: 0xd0cabe });
  // Parapets on the street-level edge, open at the stairs and the mall side's passage.
  balustrade(t, [x0, z0, x1, z0 + 0.3], 0, [[x0 + 12, x0 + 24]], 'n');
  balustrade(t, [x0, z1 - 0.3, x1, z1], 0, [[x0 + 12, x0 + 24]], 's');
  balustrade(t, [x1 - 0.3, z0, x1, z1], 0, [], 'e');
  balustrade(t, [x0, z0, x0 + 0.3, z1], 0, [[PASSAGE[1], PASSAGE[3]]], 'w');
  // Lit cladding on the dig's walls (drawn) and a lit strip under the parapets.
  for (const [a, b2, c, d] of [[x0 - 0.05, z0, x0, PASSAGE[1]], [x0 - 0.05, PASSAGE[3], x0, z1], [x1, z0, x1 + 0.05, z1]] as R[]) t.shape([a, b2, c, d], B1, -0.35, 'concrete', 0xb8ae9c);
  for (const [a, b2, c, d] of [[x0, z0, x0 + 0.1, z1], [x1 - 0.1, z0, x1, z1]] as R[]) t.shape([a, b2, c, d], -0.75, -0.65, 'neon', 0xffe2b0);
  // A reflecting pool with a stone rim (knee-high cover), trees in raised beds, a pavilion and benches.
  t.box([64, -12, 76, 4], B1, B1 + 0.6, 'concrete', 0x8a847a);
  t.b.water(70, B1 + 0.5, -4, 11.4, 15.4);
  for (const [x, z] of [[58, -26], [82, -26], [58, 18], [82, 18]]) { t.box([x - 1.3, z - 1.3, x + 1.3, z + 1.3], B1, B1 + 0.75, 'concrete', 0x6a6460); t.b.tree(x, z, 0.7, 1); }
  for (const [x, z] of [[60, -22], [70, -22], [60, -16], [70, -16]]) t.box([x - 0.25, z - 0.25, x + 0.25, z + 0.25], B1, B1 + 3.2, 'wood', 0x5a3a28);
  t.shape([59.5, -22.5, 70.5, -15.5], B1 + 3.2, B1 + 3.5, 'roof', 0x4a4440);
  t.box([61, -19.6, 69, -18.2], B1, B1 + 0.55, 'wood', 0x8a6a4a);
  t.box([60, 12, 65, 13], B1, B1 + 0.55, 'wood', 0x8a6a4a); t.box([76, 12, 81, 13], B1, B1 + 0.55, 'wood', 0x8a6a4a);
  t.b.light(70, B1 + 3, -4, 0x9fd8ff, 4, 16);
}
