import { MapBuilder, fbm } from './builder';
import type { MapDef } from './types';

/**
 * Timbertown: an original homage to BeGone's sixth map (geometry and art are our own). A
 * dilapidated, moss-streaked estate: Militia (team 1) deploys in the fenced west yard behind the
 * Hills, a dirt mound with boulders and a log stack; SWAT (team 0) in the fenced east yard around
 * the Cabin, a broken wooden house with a hole in its roof. Between them stand two columns of
 * two-storey plaster blocks split by a road, with the central Platform (a concrete scaffold over
 * the crossroads) in the gap. Two roofs are walkable, each by switchback stairs: the Militia Roof
 * (north-west block, stairs at its north end) and the SWAT Roof (south-east block, stairs at its
 * south end). A low brick wall runs north–south past the east blocks, leaving the alley on the far
 * right. The single bomb site sits in the SWAT yard west of the Cabin; ammo crates are in the
 * Cabin and under the Platform. BeGone's ladders are stairs here.
 *
 * Coordinates: +X east, +Z south, metres. Deliberately asymmetric, like the original.
 */
const HALF_X = 50, HALF_Z = 45;
/** Plaster blocks: eaves height, walkable roof deck and the ground storey (with its nooks). */
const H = 7, ROOF = H + 0.15, GROUND = 2.7, NOOK = 1.3;
/** Platform deck height. */
const P = 4;
const LOG = 0x6b5a48, PANE = 0x2a2f33, DOOR = 0x5a4632, DECK = 0xf4f0e8;

type B = MapBuilder;

/** Post-and-rail fence along an axis-aligned run; `gaps` are [from, to] spans along it. */
function fence(b: B, x0: number, z0: number, x1: number, z1: number, gaps: [number, number][] = []) {
  const alongX = z0 === z1;
  for (const [a0, a1] of pieces(alongX ? x0 : z0, alongX ? x1 : z1, gaps)) {
    const len = a1 - a0, mid = (a0 + a1) / 2, n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) {
      const a = a0 + (len * i) / n, x = alongX ? a : x0, z = alongX ? z0 : a;
      b.box(x, b.ground(x, z), z, 0.14, 1.25, 0.14, 'wood');
    }
    const x = alongX ? mid : x0, z = alongX ? z0 : mid, y = b.ground(x, z);
    for (const h of [0.35, 0.9]) b.box(x, y + h, z, alongX ? len : 0.07, 0.12, alongX ? 0.07 : len, 'wood');
  }
}

/** Split [a0, a1] around the gaps. */
function pieces(a0: number, a1: number, gaps: [number, number][]) {
  const out: [number, number][] = [];
  let cur = a0;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { if (g0 > cur) out.push([cur, g0]); cur = Math.max(cur, g1); }
  if (cur < a1) out.push([cur, a1]);
  return out;
}

/**
 * Two-storey plaster block. Ground-storey nooks (doorway recesses on the long west/east faces)
 * are the hiding spots; dark window panes face every side; a parapet rings the roof deck, open
 * where the roof stairs arrive.
 */
function apartment(b: B, x0: number, x1: number, z0: number, z1: number, nooks: ['w' | 'e', number][] = [], gap?: { side: 'n' | 's'; from: number; to: number }) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  b.box(cx, GROUND, cz, w, H - GROUND, d, 'plaster');
  b.paint(b.box(cx, H, cz, w + 0.1, 0.15, d + 0.1, 'slab'), DECK);
  b.box(cx, 0, cz, w - 2 * NOOK, GROUND, d, 'plaster');
  for (const side of ['w', 'e'] as const) {
    const sx = side === 'w' ? x0 + NOOK / 2 : x1 - NOOK / 2;
    const at = nooks.filter(n => n[0] === side).map(n => n[1]);
    for (const [a, c] of pieces(z0, z1, at.map(z => [z - 1.2, z + 1.2] as [number, number]))) b.box(sx, 0, (a + c) / 2, NOOK, GROUND, c - a, 'plaster');
    // A boarded door at the back of each nook.
    for (const z of at) b.paint(b.box(side === 'w' ? x0 + NOOK - 0.03 : x1 - NOOK + 0.03, 0, z, 0.08, 2.3, 1.4, 'wood'), DOOR);
  }
  const pane = (x: number, y: number, z: number, alongX: boolean) => b.paint(b.box(x, y, z, alongX ? 1.2 : 0.08, 1.4, alongX ? 0.08 : 1.2, 'steel'), PANE);
  for (let z = z0 + 1.9; z < z1 - 1.2; z += 3.2) for (const [x, side] of [[x0 - 0.03, 'w'], [x1 + 0.03, 'e']] as const) {
    if (!nooks.some(n => n[0] === side && Math.abs(n[1] - z) < 2)) pane(x, 0.9, z, false);
    pane(x, 4.3, z, false);
  }
  for (const x of [cx - w / 4, cx + w / 4]) for (const z of [z0 - 0.03, z1 + 0.03]) for (const y of [0.9, 4.3]) pane(x, y, z, true);
  const py = ROOF, ph = 0.85, t = 0.3;
  for (const [side, z] of [['n', z0 + t / 2], ['s', z1 - t / 2]] as const) {
    const gaps: [number, number][] = gap?.side === side ? [[gap.from, gap.to]] : [];
    for (const [a, c] of pieces(x0, x1, gaps)) b.box((a + c) / 2, py, z, c - a, ph, t, 'plaster');
  }
  for (const x of [x0 + t / 2, x1 - t / 2]) b.box(x, py, cz, t, ph, d - 2 * t, 'plaster');
}

/**
 * Straight stairs along a block's north (side -1) or south (+1) face: the flight climbs from `foot`
 * to `top` (x) beside the wall, then a landing spans `top`..`corner` at the roof's corner, where the
 * parapet opens.
 */
function roofStairs(b: B, faceZ: number, side: -1 | 1, foot: number, top: number, corner: number) {
  const z = faceZ + side * 1.3, sgn = Math.sign(top - foot);
  b.stairs((foot + top) / 2, z, Math.abs(top - foot), 2.6, 0, ROOF, top < foot ? 2 : 0);
  b.box((top + corner) / 2, ROOF - 0.3, z, Math.abs(corner - top), 0.3, 2.6, 'floor');
  for (const x of [top + sgn * 0.15, corner - sgn * 0.15]) b.paint(b.box(x, 0, faceZ + side * 2.45, 0.2, ROOF - 0.3, 0.2, 'steel'), 0x6d6a66);
  b.rail(top, faceZ + side * 2.6, corner, faceZ + side * 2.6, ROOF);
}

/** Boulder cluster: lumps [x, z, w, h, d], each sunk into the ground over its whole footprint. */
function boulders(b: B, lumps: [number, number, number, number, number][]) {
  for (const [x, z, w, h, d] of lumps) {
    const g = Math.min(...[[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].map(([sx, sz]) => b.ground(x + sx * w / 2, z + sz * d / 2)));
    b.box(x, g - 0.2, z, w, h + 0.2, d, 'rock');
  }
}

/** Lying log resting on the lower of its two ends. */
function log(b: B, x: number, z: number, axis: 'x' | 'z', len: number, r = 0.22) {
  const e = len / 2, g = Math.min(b.ground(axis === 'x' ? x - e : x, axis === 'z' ? z - e : z), b.ground(axis === 'x' ? x + e : x, axis === 'z' ? z + e : z));
  b.cylinder(x, g - 0.04, z, r, len, 'wood', axis, LOG);
}

/** Wild bush: two overlapping clipped-hedge lumps. */
function bush(b: B, x: number, z: number, s = 1) {
  b.box(x, b.ground(x, z), z, 1.8 * s, 1.3 * s, 1.6 * s, 'hedge');
  b.box(x + 0.7 * s, b.ground(x + 0.7 * s, z + 0.4 * s), z + 0.4 * s, 1.1 * s, 1.0 * s, 1.2 * s, 'hedge');
}

export function timbertown(): MapDef {
  const b = new MapBuilder({
    id: 'timbertown', name: 'Timbertown', region: 'ABANDONED ESTATE / TIMBER YARDS',
    description: 'Plaster blocks, a central scaffold and two fenced yards: the Hills and the Cabin.',
    theme: 'steppe', halfX: HALF_X, halfZ: HALF_Z, seed: 17, roll: 0, ridge: 0,
    sabotage: { sites: ['A'], attackerSpawn: 1 },
    sun: { x: -0.62, y: 0.6, z: 0.3 },
    // Flat yards and streets inside the fences; dry hills roll up beyond them.
    ground: (x, z) => {
      const e = Math.max(Math.abs(x) - HALF_X, Math.abs(z) - HALF_Z);
      return e > 0 ? Math.min(12, e * 0.45) * (0.8 + 0.5 * fbm(x * 0.04, z * 0.04, 13)) : 0;
    },
  });
  // The Hills: the big mound Militia snipers hold, a rise toward the log stack and a hump by the rocks.
  b.bump(-31, 3, 13, 3.2);
  b.bump(-26, -8, 8, 1.4);
  b.bump(-38, 18, 7, 1.2);
  b.buildTerrain(2);

  // ---- Perimeter fence, the yards' fences and the low brick wall past the east blocks ----
  fence(b, -49.4, -44.6, 49.4, -44.6);
  fence(b, -49.4, 44.6, 49.4, 44.6);
  fence(b, -49.4, -44.6, -49.4, 44.6);
  fence(b, 49.4, -44.6, 49.4, 44.6);
  fence(b, -49.4, -23.5, -20, -23.5);
  fence(b, -49.4, 39.8, -20, 39.8);
  fence(b, 20.8, -19.3, 49.4, -19.3);
  fence(b, 26.3, 19.8, 49.4, 19.8);
  fence(b, 8.8, 32.3, 20.6, 32.3, [[12, 17]]);
  for (const [a, c] of pieces(-44.6, 44.6, [[-28, -24], [-6, -2], [9, 13], [27, 31]])) b.box(20.6, 0, (a + c) / 2, 0.35, 1.1, c - a, 'brick');

  // ---- The road between the block columns, with a stripped trailer on it ----
  b.paint(b.box(-0.75, -0.5, 0, 4.5, 0.56, HALF_Z * 2 - 0.8, 'slab'), 0x8c867e);
  b.paint(b.box(-1.1, 0.06, 26.2, 2.6, 1.0, 8.5, 'steel'), 0x7a4a34);
  b.crate(-1.6, 1.06, 23.6, 1.3);
  b.crate(-0.5, 1.06, 27.6, 1.3);
  b.crate(-1.7, 1.06, 28.2, 1.2);

  // ---- West column: Militia Roof block (walkable), the long block, the small block ----
  apartment(b, -16.6, -8.4, -32.3, -9.5, [['w', -21], ['e', -27], ['e', -15]], { side: 'n', from: -16.6, to: -12.8 });
  roofStairs(b, -32.3, -1, -6.4, -14.4, -16.6);
  apartment(b, -16.6, -8.4, -1.1, 23.6, [['w', 5], ['w', 17], ['e', 11]]);
  apartment(b, -16.6, -8.4, 28.9, 38.2);
  b.point('D', 'Militia Roof', -12.5, ROOF, -21, 6);
  for (const [x, z] of [[-14.3, -28.9], [-10.9, -26.6], [-13.4, -24], [-13.4, -18.4], [-14.3, -15.5], [-10.9, -15.5], [-12.5, -12.5]]) b.crate(x, ROOF, z, 1.2);
  b.crate(-12.2, ROOF + 1.2, -18.4, 1.2);

  // ---- East column: the north block and SWAT Roof block (walkable) ----
  apartment(b, 7.6, 15.8, -32.3, -9.5, [['w', -21], ['e', -27], ['e', -15]]);
  apartment(b, 7.6, 15.8, 1.1, 23.9, [['w', 12], ['e', 6], ['e', 18]], { side: 's', from: 12, to: 15.8 });
  roofStairs(b, 23.9, 1, 5.6, 13.6, 15.8);
  b.point('E', 'SWAT Roof', 10, ROOF, 10.8, 6);
  for (const [x, z] of [[10, 3.6], [12.3, 5.7], [10, 8.2], [11.7, 13.4], [14.5, 13.4], [13, 16.8], [11, 21], [8.6, 17]]) b.crate(x, ROOF, z, 1.2);

  // ---- The Platform: a concrete scaffold over the crossroads, open in the middle. Its stairs are
  // centred on the 2.5 m navigation columns so bots climb them too.
  const deck = (x0: number, x1: number, z0: number, z1: number) => b.paint(b.box((x0 + x1) / 2, P - 0.3, (z0 + z1) / 2, x1 - x0, 0.3, z1 - z0, 'slab'), DECK);
  deck(-8.2, 2.3, -10.5, -7.2); deck(4.7, 6.7, -10.5, -7.2);                       // north arm (east stairwell cut out)
  deck(2, 2.3, -7.2, 0.4); deck(4.7, 6.7, -7.2, 0.4); deck(2.3, 4.7, -5.9, 0.4);    // east arm
  deck(-8.2, -7.7, 0.4, 3.6); deck(-5.3, 6.7, 0.4, 3.6);                           // south arm (west stairwell cut out)
  deck(-8.2, -7.7, -7.2, 0.4); deck(-5.3, -3.4, -7.2, 0.4); deck(-7.7, -5.3, -7.2, -1.2); // west arm
  b.stairs(-6.5, 1.2, 2.4, 4.8, 0, P, 3);                                            // west stairs from the south
  b.stairs(3.5, -8.2, 2.4, 4.6, 0, P, 1);                                            // east stairs from the north
  b.stairs(-1.5, -4.9, 2.4, 4.6, 0, P, 3);                                           // up out of the middle
  b.ladder(0.8, 0.4, 0, P, 1);                                                       // and BeGone's ladder beside them
  const wall = (x0: number, x1: number, z0: number, z1: number) => b.paint(b.box((x0 + x1) / 2, P, (z0 + z1) / 2, x1 - x0, 0.9, z1 - z0, 'slab'), DECK);
  wall(-8.2, 2.3, -10.5, -10.25); wall(4.7, 6.7, -10.5, -10.25);
  wall(-8.2, -7.7, 3.35, 3.6); wall(-5.3, 6.7, 3.35, 3.6);
  wall(-8.2, -7.95, -10.25, 3.35); wall(6.45, 6.7, -10.25, 3.35);
  wall(-3.4, -2.7, -7.45, -7.2); wall(-0.3, 2, -7.45, -7.2); wall(-3.4, 0.2, 0.4, 0.65); wall(1.4, 2, 0.4, 0.65);
  wall(-3.65, -3.4, -7.45, 0.65); wall(2, 2.25, -7.45, 0.65);
  for (const [x, z] of [[-7.95, -10.25], [6.45, -10.25], [-7.95, 3.35], [6.45, 3.35], [-0.75, -10.25], [-0.75, 3.35],
    [-7.95, -3.4], [6.45, -3.4], [-3.65, -7.45], [2, -7.45], [-3.65, 0.65], [2.25, 0.65]]) b.paint(b.box(x, 0, z, 0.45, P - 0.3, 0.45, 'slab'), DECK);
  b.point('B', 'Platform', -0.3, P, -8.85, 6);
  b.ammoCrate(-6, 0, -5);

  // ---- Militia yard: spawn line, the Hills with boulders, the log stack ----
  for (const z of [-18, -14.5, -10.8, -6.6, -2.3, 1.4, 5.2, 8.5, 12.4, 16.6, 20.9, 24.5]) b.spawn(1, -47.4, 0, z, -Math.PI / 2);
  b.point('C', 'Hills', -30, b.ground(-30, 3), 3, 8);
  boulders(b, [[-34, 10, 5, 2.6, 4.2], [-31.2, 11.2, 3.2, 1.9, 3.4], [-35.6, 12, 2.6, 1.5, 2.4]]);
  boulders(b, [[-36.5, 22.5, 3.2, 2.2, 2.8], [-34.3, 23.5, 2.4, 1.5, 2.2], [-36.3, 20.3, 1.5, 1.1, 1.4], [-37.6, 24, 1.6, 1.2, 1.6]]);
  // Log stack: three layers of logs north of the Hills.
  for (const [layer, count] of [[0, 6], [1, 5], [2, 4]]) for (let i = 0; i < count; i++) {
    b.cylinder(-35.7, b.ground(-35.7, -13) + layer * 0.55, -13 + (i - (count - 1) / 2) * 0.64, 0.32, 5, 'wood', 'x', LOG);
  }
  for (const [x, z, axis] of [[-42.3, -32.7, 'z'], [-25, -9.3, 'x'], [-45.7, -5.2, 'x'], [-25, 10.4, 'z'], [-43.6, 25.2, 'z'], [-36.6, 38.4, 'z']] as const) log(b, x, z, axis, 3.2);
  for (const [x, z] of [[-18.2, -7.5], [-15.7, -5.5], [-17.7, -3.6], [-26.1, 20.7], [-24.8, 20.7], [-37.5, 31.4], [-35.3, 33.6]]) b.crate(x, 'ground', z, 1.15);
  b.box(-12.7, 0, -37.6, 3, 1.1, 2.2, 'wood');                     // pallet stack by the roof stairs
  for (const [x, z] of [[4.6, -36.4], [5.9, -36.4], [4.6, -35.1]]) b.crate(x, 0, z, 1.2);

  // ---- SWAT yard: spawn line, the Cabin, stones, the bomb site ----
  for (const z of [-17.7, -14.8, -11.4, -8.3, -5.5, -2.6, 0.1, 2.9, 5.8, 9.1, 12.7, 15.8]) b.spawn(0, 48.1, 0, z, Math.PI / 2);
  b.bunker(40.1, 1.75, 9.4, 12.5, {
    y: 0, h: 3, roof: false, style: 'wood',
    doors: [['w', 4.2, 2], ['e', -0.25, 2], ['n', -0.1, 2]],
    windows: [['w', -3.5, 1.4], ['e', 3.5, 1.4], ['s', 0, 1.6]],
  });
  // Pitched plank roof, ridge north–south; the hole over the stairs breaks the west slope.
  const eave = 2.83, ridge = 4.6, slope = (ridge - eave) / 5.1;
  const west = (x0: number, x1: number, z0: number, z1: number) =>
    b.ramp((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, eave + (x0 - 35) * slope, eave + (x1 - 35) * slope, 0, 'roof');
  west(35, 40.1, -4.9, -1); west(35, 40.1, 3.8, 8.4); west(37.95, 40.1, -1, 3.8); west(35, 35.95, -1, 3.8);
  b.ramp(42.65, 1.75, 5.1, 13.3, eave, ridge, 2, 'roof');
  for (const z of [-4.25, 7.75]) for (const [y, w] of [[3, 6.8], [3.4, 4.4], [3.8, 2.2]]) b.box(40.1, y, z, w, 0.4, 0.5, 'wood');
  // Inside: stairs up the west wall to a loft under the hole, a ladder from the loft out onto the
  // roof (the snipers' perch), crates, the ammo crate.
  b.stairs(36.75, -1.45, 1.6, 4.9, 0, 2.4, 1);
  b.ladder(37.95, 2.4, 2.4, eave + (37.95 - 35) * slope, 0);
  b.box(36.95, 0, 2.4, 2, 2.4, 2.8, 'wood');
  b.crate(43.6, 0, -3.3, 1.2); b.crate(43.6, 1.2, -3.3, 1.2); b.crate(42.4, 0, -3.3, 1.2);
  b.ammoCrate(43.4, 0, 6.6);
  b.light(40.1, 2.7, 1.75, 0xffd8a0, 4, 8);
  b.point('A', 'Cabin', 27.5, 0, 2.2, 6);
  boulders(b, [[41, -14.3, 3, 1.9, 2.6], [42.7, -13, 1.6, 1.1, 1.5]]);
  boulders(b, [[30.4, 8.2, 3, 1.8, 2.6], [31.9, 9.1, 1.4, 1, 1.3]]);
  boulders(b, [[40.4, 15.7, 3.4, 2.2, 3], [38.6, 16.8, 1.8, 1.3, 1.7]]);
  boulders(b, [[47.6, 18.4, 1.9, 1.4, 1.7]]);                     // the corner stone
  for (const [x, z] of [[27.3, -4.7], [28.5, -4.7], [27.3, -3.5], [28.5, -3.5]]) b.crate(x, 0, z, 1.2);
  b.crate(27.9, 1.2, -4.1, 1.2);
  for (const [x, z] of [[25.6, 0.1], [26.4, 1.0]]) for (let k = 0; k < 3; k++) b.cylinder(x, k * 0.26, z, 0.45, 0.26, 'steel', 'y', 0x2a2b2c);
  b.cylinder(27.2, 0, -8, 0.35, 1, 'steel', 'y', 0x5a3a2a);
  b.box(28.1, 0, 15.2, 2.2, 1.2, 3.2, 'wood');
  for (const [x, z, axis] of [[39.7, -23.9, 'x'], [34.2, 24.8, 'x'], [42.2, 24.3, 'z'], [30.4, 30.2, 'x'], [47.2, 33.9, 'z'], [40.6, 35.7, 'x']] as const) log(b, x, z, axis, 3.2);

  // ---- Between the blocks: plank piles, crates, the Garage ----
  b.box(6.3, 0, -14.8, 1.4, 0.9, 5.5, 'wood');
  b.box(16.85, 0, -6.75, 4.3, 1, 2.4, 'wood');
  for (const x of [11.1, 12.5, 13.9]) b.crate(x, 0, -6.8, 1.3);
  b.crate(12.5, 1.3, -6.8, 1.3);
  b.box(10.6, 0, -0.1, 3.6, 0.6, 1.6, 'wood');
  b.bunker(14.5, 39.25, 11, 8.5, { y: 0, h: 3.4, roof: false, style: 'brick', doors: [['n', 0, 5]], windows: [['e', 0, 1.6]] });
  b.box(14.5, 3.4, 39.25, 11.4, 0.2, 8.9, 'roof');
  b.paint(b.box(13, 0, 40.2, 1.8, 1.3, 4.2, 'steel'), 0x6a6f74);  // a dead car
  b.crate(18.2, 0, 41.6, 1.2);

  // ---- Three trees, nine bushes, pines on the hills outside ----
  for (const [x, z] of [[-10.9, -5.7], [3.8, -28.9], [4.5, 8]]) b.tree(x, z, 0.75, 1);
  for (const [x, z] of [[-17.7, -41.6], [-5.9, -18], [-23.4, 29.8], [-5.5, 38.4], [11.7, -38.9], [22.6, -13.4], [35.4, -13], [30.4, -1.2], [5.8, 34.8]]) bush(b, x, z);
  for (const [x, z, s, v] of [[-58, -40, 1.3, 0], [-60, -10, 1.1, 2], [-57, 15, 1.4, 0], [-59, 38, 1.2, 2], [-30, -53, 1.2, 0], [-5, -55, 1.4, 2], [25, -54, 1.1, 0],
    [48, -52, 1.3, 2], [58, -30, 1.2, 0], [60, 0, 1.4, 2], [57, 28, 1.1, 0], [40, 54, 1.3, 2], [10, 56, 1.2, 0], [-20, 55, 1.4, 2]]) b.tree(x, z, s, v);

  return b.build();
}
