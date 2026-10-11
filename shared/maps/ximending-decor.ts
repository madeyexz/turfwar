import { rng } from '../math';
import { C, NEON, TINTS, Ximen, type R } from './ximending-kit';

/**
 * Ximending's dressing (ximending.ts): scooters parked in rows (each on its own collider), trees
 * and lamps along the ring road's sidewalks, wires and neon gantries over the lanes, string
 * lanterns, and the city round the map (the blocks that close it, drawn only beyond the bounds).
 */
export function dressing(t: Ximen) {
  lamps(t);
  scooterRows(t);
  trees(t);
  overhead(t);
}

/** Scooters side by side, noses to the wall: [x0, z0, count, alongX, nose]. */
function scooterRows(t: Ximen) {
  let seed = 21;
  const rows: [number, number, number, boolean, 1 | -1][] = [
    // Lane N and lane S, against the building faces.
    [-66, -36.7, 5, true, -1], [-47, -36.7, 3, true, -1], [-37, -36.7, 4, true, -1], [8, -36.7, 7, true, -1], [41, -36.7, 3, true, -1], [51, -36.7, 8, true, -1],
    [-66, 36.7, 7, true, 1], [-47, 36.7, 3, true, 1], [8, 36.7, 8, true, 1], [41, 36.7, 3, true, 1], [51, 36.7, 6, true, 1],
    // The ring's sidewalks, against the buildings.
    [-65, -50.8, 8, true, 1], [-26, -50.8, 9, true, 1], [20, -50.8, 6, true, 1], [-62, 50.8, 6, true, -1], [-2, 50.8, 4, true, -1], [26, 50.8, 8, true, -1], [50, 50.8, 5, true, -1],
    // West, Hanzhong and East streets.
    [-47, -20, 4, false, -1], [-38, 21, 4, false, 1], [-4.2, -20, 4, false, -1], [4.2, 21, 4, false, 1], [38, -9, 4, false, -1], [46.5, 20, 4, false, 1],
  ];
  // A row stops short of anything already standing where a scooter would (a chicane's container, a
  // lamp post): the scooters either side of it park as rows of their own.
  const clear = (x: number, z: number, alongX: boolean) => {
    const [hx, hz] = alongX ? [0.36, 0.7] : [0.7, 0.36];
    let free = true;
    t.b.solids.forEach(s => { if (free && s.minY < 1 && s.maxY > 0.2 && s.minX < x + hx && s.maxX > x - hx && s.minZ < z + hz && s.maxZ > z - hz) free = false; });
    return free;
  };
  for (const [x, z, n, alongX, nose] of rows) {
    let run: [number, number][] = [];
    const park = () => { if (run.length) t.scooters(run[0][0], run[0][1], run.length, alongX, nose, seed++); run = []; };
    for (let i = 0; i < n; i++) {
      const sx = alongX ? x + i * 0.78 : x, sz = alongX ? z : z + i * 0.78;
      if (clear(sx, sz, alongX)) run.push([sx, sz]); else park();
    }
    park();
  }
}

/** Street trees along the ring's sidewalks (the trunk is cover) and in the squares. */
function trees(t: Ximen) {
  const data: number[] = [];
  const add = (x: number, z: number, scale = 1) => {
    data.push(x, 0, z, ((x * 7 + z * 3) % 6.28), scale, 0, 0xffffff, 0);
    t.trunk(x, z, scale);
    // The tree pit's grate.
    t.shape([x - 0.9, z - 0.9, x + 0.9, z + 0.9], 0, 0.03, 'steel', 0x3c3a36);
  };
  for (let x = -66; x <= 54; x += 12) { add(x, -52.6, 0.9 + ((x * 3) & 3) * 0.05); add(x + 6, 52.6, 0.9 + ((x * 5) & 3) * 0.05); }
  for (let z = -42; z <= 42; z += 14) { add(-70, z, 1.0); add(70, z, 1.0); }
  t.raw({ kind: 'instances', model: 'tree:camphor', data });
}

/** Wires across the lanes and streets, neon gantries and string lanterns (all out of reach). */
function overhead(t: Ximen) {
  const random = rng(77);
  for (const x of [-64, -52, -33, -10, 12, 26, 45, 60]) t.wires(false, x, -37.5, -27.5, 7.2 + (x % 3) * 0.2);
  for (const x of [-64, -52, -26, 12, 26, 60]) t.wires(false, x, 27.5, 37.5, 7.4 + (x % 3) * 0.2);
  for (const z of [-44, -16, 16, 44]) { t.wires(true, z, -47.5, -37.5, 7.4); t.wires(true, z, -5, 5, 7.6); t.wires(true, z, 37.5, 47.5, 7.2); }
  // Gantries: a steel frame over each lane's mouth with a lit board.
  const gantry = (x: number, z: number, alongX: boolean, text: [string, string], color: string, neon: number) => {
    const len = alongX ? 10 : 10;
    t.shape(alongX ? [x - len / 2, z - 0.15, x + len / 2, z + 0.15] : [x - 0.15, z - len / 2, x + 0.15, z + len / 2], 6.6, 6.9, 'steel', C.iron);
    // The posts are solid (cover; nobody walks through them), the frame and board above are out of reach.
    for (const s of [-1, 1]) t.box(alongX ? [x + s * len / 2 - 0.12, z - 0.12, x + s * len / 2 + 0.12, z + 0.12] : [x - 0.12, z + s * len / 2 - 0.12, x + 0.12, z + s * len / 2 + 0.12], 0, 6.9, 'steel', C.iron);
    t.shape(alongX ? [x - len / 2 + 0.3, z - 0.18, x + len / 2 - 0.3, z + 0.18] : [x - 0.18, z - len / 2 + 0.3, x + 0.18, z + len / 2 - 0.3], 6.4, 6.5, 'neon', neon);
    for (const s of [0, 1]) t.sign('board', alongX ? x : x + (s ? 0.2 : -0.2), 7.7, alongX ? z + (s ? 0.2 : -0.2) : z, alongX ? (s ? Math.PI : 0) : (s ? Math.PI / 2 : -Math.PI / 2), 7.5, 1.4, text[0], color, '#ffffff', text[1]);
  };
  // Posts stand in the sidewalk strips next to the buildings' faces, clear of the lanes' middles.
  gantry(0, -50.1, true, ['漢中街', 'HANZHONG ST'], '#c8141e', 0xff3a5a);
  gantry(-42.5, -50.1, true, ['西寧街', 'XINING ST'], '#14306a', 0x4af0ff);
  gantry(42.5, -50.1, true, ['成都路', 'CHENGDU RD'], '#1a6a3a', 0x5aff8a);
  gantry(0, 50.1, true, ['漢中街', 'HANZHONG ST'], '#c8141e', 0xff3a5a);
  // String lanterns across lane S by the Red House.
  for (let x = -36; x < 4; x += 4) t.lantern(x, 5.4 + random() * 0.3, 32.5 + (random() - 0.5) * 3, random() < 0.5 ? 0xff3a2a : 0xffb02a);
  void NEON;
}

/** Street lamps along the lanes' edges and the ring's sidewalks. */
function lamps(t: Ximen) {
  for (const x of [-64, -50, -34, -8, 14, 30, 52, 62]) { t.lamp(x, -37.0); t.lamp(x + 6, 37.0); }
  for (const z of [-42, -12, 12, 42]) { t.lamp(-47.0, z); t.lamp(-38.0, z); t.lamp(4.4, z); t.lamp(38.0, z); t.lamp(47.0, z); }
  // Hanzhong St's west kerb, but not where the Red House stands on it.
  for (const z of [-42, -12, 12]) t.lamp(-4.4, z);
}

/**
 * The city round the map: walk-ups close it on every side (drawn, and solid where the map's ring
 * road brushes them), then taller blocks behind. Their collision is dropped past the bounds.
 */
export function backdrop(t: Ximen) {
  const random = rng(515);
  const tint = () => TINTS[Math.floor(random() * TINTS.length)];
  const band = (axis: 'x' | 'z', at: number, from: number, to: number, depth: number, side: 1 | -1, lo: number, hi: number, seed: number, _facing: string) => {
    for (let a = from; a < to; ) {
      const w = 10 + Math.floor(random() * 7), a1 = Math.min(to, a + w);
      const r: R = axis === 'z' ? [a, side > 0 ? at : at - depth, a1, side > 0 ? at + depth : at] : [side > 0 ? at : at - depth, a, side > 0 ? at + depth : at, a1];
      t.apartment(r, lo + Math.floor(random() * (hi - lo + 1)), tint(), seed + a, { street: [], blades: 0 });
      a = a1;
    }
  };
  // First ring: against the bounds' edges, then a taller second ring behind.
  band('z', -68, -96, 96, 14, -1, 5, 8, 800, 's'); band('z', 68, -96, 96, 14, 1, 5, 8, 830, 'n');
  band('x', -83, -68, 68, 14, -1, 5, 8, 860, 'e'); band('x', 83, -68, 68, 14, 1, 5, 8, 890, 'w');
  band('z', -82, -100, 100, 14, -1, 8, 13, 920, ''); band('z', 82, -100, 100, 14, 1, 8, 13, 950, '');
  band('x', -97, -80, 80, 14, -1, 8, 13, 980, ''); band('x', 97, -80, 80, 14, 1, 8, 13, 1010, '');
}
