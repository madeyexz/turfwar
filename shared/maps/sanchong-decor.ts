import { rng } from '../math';
import { C, TINTS, Town, type R } from './sanchong-kit';
import { LEVEE_X } from './sanchong-plan';

/**
 * Sanchong's dressing (sanchong.ts): rows of parked scooters (each row on its own collider), shop
 * boards over the arcades, the earth-god shrine (土地公廟) and its banyan in the alley pocket, and
 * the city round the map: the blocks that close it (solid where a soldier can reach them) and the
 * districts beyond (drawn only).
 */
export function dressing(t: Town) {
  scooterRows(t);
  boards(t);
  shrine(t);
}

/** Scooters parked everywhere: along the kerbs, under the bridge, in the market's open ends and the alleys. */
function scooterRows(t: Town) {
  let seed = 11;
  // Side by side, noses toward the wall: [x0, z0, count, alongX, nose].
  const rows: [number, number, number, boolean, 1 | -1][] = [
    // Main street, both kerbs.
    [-52, -43, 8, true, -1], [-39.5, -43, 7, true, -1], [28, -43, 8, true, -1], [48.5, -43, 8, true, -1],
    [-48, -37, 8, true, 1], [-9, -37, 7, true, 1], [45, -37, 8, true, 1],
    // Under the bridge, against the north wall and along row N.
    [-22, -63, 9, true, -1], [8, -63, 9, true, -1], [31, -63, 12, true, -1],
    [-38, -54, 7, true, 1], [27, -54, 10, true, 1], [48.5, -54, 8, true, 1],
    // The market's open ends.
    [-52, -5.55, 7, true, -1], [-36.5, -5.55, 7, true, -1], [-40, 5.55, 6, true, 1], [48, -5.55, 8, true, -1], [36, 5.55, 6, true, 1], [48, 5.55, 8, true, 1],
    // The bases' car parks.
    [-75, -11.05, 7, true, -1], [57, 11.05, 6, true, 1],
  ];
  for (const [x, z, n, alongX, nose] of rows) t.scooters(x, z, n, alongX, nose, seed++);
  // Nose to tail along the alley walls (the alleys stay passable).
  const lines: [number, number, number, boolean][] = [
    [-53, 28.55, 4, true], [-25.5, 38.55, 3, true], [45, 41.45, 3, true], [-61.5, -50, 4, false], [69.6, 15.5, 4, false],
    [14, 46.45, 3, true],
  ];
  for (const [x, z, n, alongX] of lines) t.scooters(x, z, n, alongX, 1, seed++, true);
}

/** Shop boards (招牌) along the arcades' fronts, a storey up. */
function boards(t: Town) {
  const names: [string, string, string][] = [
    ['建興五金', '#1d5fa8', '#ffffff'], ['阿義豬腳', '#c8141e', '#ffe9b0'], ['福利麵包', '#f0c040', '#7a1010'], ['順發機車', '#1a1a1a', '#ff6a2a'],
    ['長春藥局', '#2a8a3a', '#ffffff'], ['金龍銀樓', '#8a1a14', '#ffd860'], ['好客自助餐', '#ff7a1a', '#ffffff'], ['三和水電', '#0a4a8a', '#ffe24a'],
    ['新生診所', '#ffffff', '#1d6fb8'], ['大眾書局', '#3a2a6a', '#ffffff'], ['萬發茶行', '#2a5a2a', '#f0e0b0'], ['美美髮廊', '#e04a8a', '#ffffff'],
    ['永和豆漿', '#f0e8d0', '#c8141e'], ['正義眼鏡', '#ffd24a', '#1a1a1a'], ['阿婆魯肉飯', '#c8141e', '#ffffff'], ['大同電器', '#f0f0f0', '#d81e1e'],
  ];
  let k = 0;
  const row = (x0: number, x1: number, z: number, rot: number) => {
    for (let x = x0 + 0.4; x + 2.8 <= x1 - 0.4; x += 4.4) {
      const [text, bg, fg] = names[k++ % names.length], w = 2.8 + (k % 3) * 0.5;
      if (x + w > x1 - 0.3) break;
      t.sign('board', x + w / 2, 4.95 + (k % 2) * 0.15, z, rot, w, 0.85, text, bg, fg);
    }
  };
  // Row N's fronts face south onto the main street, row M's north.
  for (const [x0, x1] of [[-54, -43], [-43, -32], [-28, -17], [-17, -4], [26, 35], [35, 43], [47, 56]]) row(x0, x1, -43.95, Math.PI);
  for (const [x0, x1] of [[-54, -42], [-38, -26], [-26, -14], [-14, -2], [2, 14], [24, 38], [42, 49], [49, 56]]) row(x0, x1, -36.05, 0);
}

/** The earth-god shrine (土地公廟 / 福德祠) in the alley pocket, with its banyan and burner. */
function shrine(t: Town) {
  const r: R = [6, 38, 12, 42.5];
  t.box(r, 0, 3.2, 'painted', C.red);
  t.shape([5.6, 37.8, 12.4, 42.9], 3.2, 3.5, 'roof', C.roofOrange);
  t.shape([6.6, 38.4, 11.4, 42.1], 3.5, 4.1, 'roof', C.roofOrange);
  t.shape([8.75, 38.1, 9.25, 42.4], 4.1, 4.45, 'painted', 0xc8401e);
  for (const s of [38.1, 42.4]) t.shape([8.8, s - 0.3, 9.2, s + 0.3], 4.3, 4.8, 'painted', 0xc8401e);
  t.shape([7.2, 42.5, 10.8, 42.56], 0.4, 2.6, 'painted', 0x3a1a10);
  t.raw({ kind: 'cylinder', x: 9, y: 0.9, z: 42.8, radius: 0.25, height: 0.4, axis: 'y', style: 'painted', color: 0x4a3a2a, sides: 10 });
  t.sign('board', 9, 2.9, 42.56, Math.PI, 2.4, 0.6, '福德祠', '#14306a', '#f0c050');
  for (const x of [6.8, 11.2]) t.raw({ kind: 'cylinder', x, y: 2.2, z: 42.9, radius: 0.2, height: 0.4, axis: 'y', style: 'neon', color: 0xff3020, sides: 8 });
  // The shrine's paper furnace (金爐) beside it: brick, a tiled cap and a chimney (cover; it also
  // breaks the view along the alleys through the pocket).
  t.box([13, 42.6, 15, 44.4], 0, 2.2, 'brick', 0xc87a5a);
  t.shape([13.6, 43.1, 14.4, 43.9], 0.8, 1.4, 'neon', 0xff7020);
  t.shape([12.8, 42.4, 15.2, 44.6], 2.2, 2.45, 'roof', C.roofOrange);
  t.box([13.65, 43.15, 14.35, 43.85], 2.45, 4.6, 'brick', 0xb86a4a);
  // The banyan in the pocket (its trunk is cover), and a ring of stools under it.
  t.box([19.5, 43.5, 20.5, 44.5], 0, 3.2, 'invisible');
  t.raw({ kind: 'instances', model: 'tree:banyan', data: [20, 0, 44, 0.6, 1.1, 0, 0x7aa85a, 0] });
  t.box([17.4, 45.4, 18.4, 46.4], 0, 0.45, 'painted', 0xd8302a);
  t.box([22, 42.8, 23, 43.8], 0, 0.45, 'painted', 0x2a6ab8);
}

/** The city round the map: solid where a soldier can reach it, drawn only beyond. */
export function backdrop(t: Town) {
  const random = rng(4242);
  const tint = () => TINTS[Math.floor(random() * TINTS.length)];
  // North: the blocks behind the bridge (z < -64), as tall as the deck is high and more.
  for (let x = -76; x < LEVEE_X; ) {
    const w = 10 + Math.floor(random() * 6), x1 = Math.min(LEVEE_X, x + w);
    t.apartment([x, -78, x1, -64], 5 + Math.floor(random() * 3), tint(), 900 + x, { street: ['s'], blades: 1 });
    x = x1;
  }
  // West: behind the car park.
  t.apartment([-90, -12, -76, 12], 6, C.grey, 950, { street: ['e'], blades: 2 });
  // South: the blocks behind the alleys (z > 47).
  for (let x = -76; x < LEVEE_X; ) {
    const w = 10 + Math.floor(random() * 6), x1 = Math.min(LEVEE_X, x + w);
    t.apartment([x, 47, x1, 60], 4 + Math.floor(random() * 3), tint(), 960 + x, { street: ['n'], blades: 0 });
    x = x1;
  }
  // Beyond: districts of walk-ups and a few towers, drawn only.
  const far = (x0: number, z0: number, x1: number, z1: number, lo: number, hi: number) => {
    for (let x = x0; x < x1; x += 14 + random() * 8) for (let z = z0; z < z1; z += 14 + random() * 8) {
      if (random() < 0.15) continue;
      const w = 10 + random() * 6, d = 10 + random() * 6, h = lo + random() * (hi - lo) * (random() < 0.1 ? 2.2 : 1);
      t.shape([x, z, x + w, z + d], 0, h, 'facade', tint());
      if (random() < 0.5) t.shape([x + 1, z + 1, x + w * 0.6, z + d * 0.6], h, h + 2.8, 'roof', [C.tinBlue, C.tinWhite, C.tinRust][Math.floor(random() * 3)]);
    }
  };
  far(-170, -170, 70, -80, 12, 26);
  far(-180, -80, -92, 70, 12, 24);
  far(-170, 62, 70, 160, 12, 26);
}
