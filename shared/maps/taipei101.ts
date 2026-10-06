import { MapBuilder } from './builder';
import { TOWER, TOWER_CYLINDERS, TOWER_LAMPS, TOWER_LOFTS, TOWER_ORNAMENTS } from './xinyi-data';
import type { BlockStyle, MapDef, SignStyle } from './types';

/**
 * Taipei 101 · 88F (台北101・高樓辦公層): a close-quarters fight on an office floor near the top of
 * Taipei 101, built for 1v1 and 6v6 (Elimination and Sabotage). The floor plate is the tower's
 * notched square (its sawtooth corners), 50 m across at the glass, set at the height the xinyi map's
 * tower loft reaches that width in its top segment (about 383 m), so the segments below the glass
 * and the city around it (the shared Taipei skyline, the Xinyi lots and a procedural fill of blocks,
 * all client-side dressing) lie where they would.
 *
 * The plan is a 3 × 3 grid round a stone core:
 *   north   the Chairman's suite (NW) · the Sky Lobby where SWAT steps out of the lifts · the CEO's suite (NE)
 *   middle  A — the server room (W) · the damper hall in the core · B — the boardroom (E)
 *   south   open office (SW) · the floor under renovation by the fire stairs, where Militia comes up ·
 *           open office and glass meeting rooms (SE)
 * with the pantry between the server room and the SW office and the copy room between the boardroom
 * and the SE office. Three lanes: the west rooms, the east rooms, and the core's damper hall between
 * them. The core is double height: the tuned mass damper (a 5.8 m gold sphere on eight cables over
 * its hydraulic pedestal) hangs in a shaft from the hall up through 89F, where a viewing gallery runs
 * round the shaft, reached by a stair on each side of the hall.
 *
 * Glass (the curtain wall, the balustrades and the meeting rooms' walls) stops bullets, as glass
 * does on every map. Doors sit on the bots' 2.5 m navigation grid.
 * Coordinates: +x east, +z south, metres; 88F's floor at y = 0.
 */
export const TAIPEI101_NAME_ZH = '台北101・高樓辦公層';

/** Half-size of the floor plate at the glass and the step of its sawtooth corners (the xinyi tower's 1.6 m). */
export const H = 25, NOTCH = 1.6;
/** 88F's ceiling, 89F's floor (the gallery), 89F's ceiling and the top of the damper shaft. */
export const CEIL = 4.2, F2 = 4.8, CEIL2 = 9, SHAFT_TOP = 15;
/** The stone core (outer faces) and its wall. */
export const CORE = { x: 12, z: 11 }, CORE_T = 0.6;
/** Inside faces of the core, the damper shaft's half-size, and the gallery stairs (east one; the west mirrors it). */
const IX = CORE.x - CORE_T, IZ = CORE.z - CORE_T;
export const SHAFT = 6.9;
export const STAIRS = { x0: 9.4, x1: IX, z0: -5, z1: 3 };
/** Interior partitions and door head height. */
const T = 0.2, DOOR = 2.4;
/** Balustrades stand higher than a soldier can jump (1.2 m), so nobody perches on them. */
const RAIL = 1.25;
/** Damper: the sphere's centre and radius, and its pedestal. */
export const DAMPER = { y: 5.6, r: 2.9, base: 3.3, baseTop: 1.6 };

/** Height of 88F above the street: where the top segment's flare reaches half-size H. */
export const FLOOR_Y = (() => {
  const top = TOWER.baseTop + (TOWER.segCount - 1) * TOWER.segH;
  for (const [y0, y1, h0, , h1] of TOWER_LOFTS) if (y0 >= top - 0.01 && y1 > y0 && h0 <= H && h1 >= H) return y0 + (y1 - y0) * (H - h0) / (h1 - h0);
  return 382.7;
})();

// ---- Palette ---------------------------------------------------------------------------------
const WHITE_WALL = 0xe9e4da, STONE = 0xc9bba4, STONE_DARK = 0x7a7068, WALNUT = 0x5e3c28, OAK = 0xc49a6a;
const FRAME = 0x3c3f42, MULLION = 0x4a463f, FABRIC = 0x7d8a96, DESK = 0xe8e6e0, BLACK = 0x1b1d20, LEATHER = 0x3a2e28;
const CARPET_OFFICE = 0x8a939c, CARPET_EXEC = 0xa08a76, CARPET_BOARD = 0x7e6a62, CARPET_GALLERY = 0x6a625c;
const GOLD = 0xf0c050, LED_GREEN = 0x1c8a40, LED_BLUE = 0x2060a0;
const N = 0, S = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;

type B = MapBuilder;
interface Rect { x0: number; z0: number; x1: number; z1: number }
const rect = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });

function rbox(b: B, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, style: BlockStyle, color?: number) {
  const i = b.box((x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, style);
  return color === undefined || style === 'invisible' ? i : b.paint(i, color);
}
function rdetail(b: B, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, style: BlockStyle, color?: number) {
  b.detail((x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, style, color);
}
const fill = (b: B, r: Rect, y0: number, y1: number, style: BlockStyle, color?: number) => rbox(b, r.x0, r.z0, r.x1, r.z1, y0, y1, style, color);
/** A sign facing `facing` (0 north, π/2 east, π south). */
function sign(b: B, style: SignStyle, x: number, y: number, z: number, facing: number, w: number, h: number, text: string, bg: string, fg: string, sub = '') {
  b.raw({ kind: 'sign', style, x, y, z, rotY: facing, w, h, text, bg, fg, ...(sub ? { sub } : {}) });
}

/** Rectangles covering `area` minus `holes` (greedy, row by row). */
function cover(area: Rect, holes: Rect[]): Rect[] {
  const cut = holes.filter(h => h.x1 > area.x0 && h.x0 < area.x1 && h.z1 > area.z0 && h.z0 < area.z1);
  const xs = [...new Set([area.x0, area.x1, ...cut.flatMap(h => [h.x0, h.x1])])].filter(v => v >= area.x0 && v <= area.x1).sort((a, c) => a - c);
  const zs = [...new Set([area.z0, area.z1, ...cut.flatMap(h => [h.z0, h.z1])])].filter(v => v >= area.z0 && v <= area.z1).sort((a, c) => a - c);
  const open = (i: number, j: number) => {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    return !cut.some(h => cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1);
  };
  const done = new Set<string>(), out: Rect[] = [];
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
    if (done.has(`${i},${j}`) || !open(i, j)) continue;
    let i1 = i;
    while (i1 + 1 < xs.length - 1 && open(i1 + 1, j) && !done.has(`${i1 + 1},${j}`)) i1++;
    let j1 = j;
    for (;;) {
      if (j1 + 1 >= zs.length - 1) break;
      let ok = true;
      for (let k = i; k <= i1; k++) if (!open(k, j1 + 1) || done.has(`${k},${j1 + 1}`)) ok = false;
      if (!ok) break;
      j1++;
    }
    for (let jj = j; jj <= j1; jj++) for (let ii = i; ii <= i1; ii++) done.add(`${ii},${jj}`);
    out.push(rect(xs[i], zs[j], xs[i1 + 1], zs[j1 + 1]));
  }
  return out;
}

/** The notched plate as non-overlapping rectangles: the middle column, two side strips and four corner steps. */
const A = H - 2 * NOTCH, M = H - NOTCH;
const PLATE: Rect[] = [
  rect(-A, -H, A, H), rect(-H, -A, -A, A), rect(A, -A, H, A),
  rect(-M, -M, -A, -A), rect(A, -M, M, -A), rect(-M, A, -A, M), rect(A, A, M, M),
];
/** Parts of r inside the plate. */
function onPlate(r: Rect): Rect[] {
  const out: Rect[] = [];
  for (const p of PLATE) {
    const q = rect(Math.max(r.x0, p.x0), Math.max(r.z0, p.z0), Math.min(r.x1, p.x1), Math.min(r.z1, p.z1));
    if (q.x1 - q.x0 > 0.01 && q.z1 - q.z0 > 0.01) out.push(q);
  }
  return out;
}
/** Is (x, z) on the floor plate? */
export const inPlate = (x: number, z: number) => PLATE.some(p => x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1);

/** The plate's outline: the notched square, each corner stepped in twice. */
function outline(): [number, number][] {
  const quarter: [number, number][] = [[H, A], [M, A], [M, M], [A, M], [A, H]];
  const out: [number, number][] = [];
  for (let k = 0; k < 4; k++) for (const [x, z] of quarter) {
    let a = x, c = z;
    for (let t = 0; t < k; t++) [a, c] = [-c, a];
    out.push([a, c]);
  }
  return out;
}

// ---- Walls ---------------------------------------------------------------------------------------
type Gap = [centre: number, width: number];
interface WallOpts { t?: number; y0?: number; y1?: number; head?: number; frame?: number }

/** Wall along x at z (t thick), from x0 to x1, with door gaps (a lintel above each up to the ceiling). */
function wallX(b: B, z: number, x0: number, x1: number, gaps: Gap[], style: BlockStyle, color?: number, o: WallOpts = {}) {
  const t = o.t ?? T, y0 = o.y0 ?? 0, y1 = o.y1 ?? CEIL, head = o.head ?? DOOR;
  let cursor = x0;
  for (const [c, w] of [...gaps].sort((p, q) => p[0] - q[0])) {
    const a = c - w / 2, e = c + w / 2;
    if (a > cursor + 0.01) rbox(b, cursor, z - t / 2, a, z + t / 2, y0, y1, style, color);
    if (y1 > head) rbox(b, a, z - t / 2, e, z + t / 2, y0 + head, y1, style, color);
    if (o.frame !== undefined) doorFrame(b, 'x', z, a, e, t, y0 + head, o.frame);
    cursor = e;
  }
  if (x1 > cursor + 0.01) rbox(b, cursor, z - t / 2, x1, z + t / 2, y0, y1, style, color);
}
/** Wall along z at x. */
function wallZ(b: B, x: number, z0: number, z1: number, gaps: Gap[], style: BlockStyle, color?: number, o: WallOpts = {}) {
  const t = o.t ?? T, y0 = o.y0 ?? 0, y1 = o.y1 ?? CEIL, head = o.head ?? DOOR;
  let cursor = z0;
  for (const [c, w] of [...gaps].sort((p, q) => p[0] - q[0])) {
    const a = c - w / 2, e = c + w / 2;
    if (a > cursor + 0.01) rbox(b, x - t / 2, cursor, x + t / 2, a, y0, y1, style, color);
    if (y1 > head) rbox(b, x - t / 2, a, x + t / 2, e, y0 + head, y1, style, color);
    if (o.frame !== undefined) doorFrame(b, 'z', x, a, e, t, y0 + head, o.frame);
    cursor = e;
  }
  if (z1 > cursor + 0.01) rbox(b, x - t / 2, cursor, x + t / 2, z1, y0, y1, style, color);
}
/** Jambs and head of a doorway, standing 3 cm proud of both faces. */
function doorFrame(b: B, axis: 'x' | 'z', at: number, a: number, e: number, t: number, head: number, color: number) {
  const d = t / 2 + 0.03, f = 0.07;
  if (axis === 'x') {
    rdetail(b, a - f, at - d, a, at + d, 0, head + f, 'painted', color);
    rdetail(b, e, at - d, e + f, at + d, 0, head + f, 'painted', color);
    rdetail(b, a, at - d, e, at + d, head, head + f, 'painted', color);
  } else {
    rdetail(b, at - d, a - f, at + d, a, 0, head + f, 'painted', color);
    rdetail(b, at - d, e, at + d, e + f, 0, head + f, 'painted', color);
    rdetail(b, at - d, a, at + d, e, head, head + f, 'painted', color);
  }
}

/** Glass partition along x or z: panes in slim frames, a frosted band at eye level, doors in the gaps. */
function glassWall(b: B, axis: 'x' | 'z', at: number, from: number, to: number, gaps: Gap[]) {
  const t = 0.08;
  if (axis === 'x') wallX(b, at, from, to, gaps, 'glass', undefined, { t });
  else wallZ(b, at, from, to, gaps, 'glass', undefined, { t });
  const seg = (s0: number, s1: number, y0: number, y1: number, color: number, d = 0.07) =>
    axis === 'x' ? rdetail(b, s0, at - d, s1, at + d, y0, y1, 'painted', color) : rdetail(b, at - d, s0, at + d, s1, y0, y1, 'painted', color);
  seg(from, to, CEIL - 0.08, CEIL, FRAME);
  const posts = new Set<number>([from, to]);
  let cursor = from;
  for (const [c, w] of [...gaps].sort((p, q) => p[0] - q[0])) {
    const a = c - w / 2, e = c + w / 2;
    seg(cursor, a, 0, 0.08, FRAME);
    seg(cursor, a, 1.25, 1.55, 0xf4f6f8, 0.045);
    posts.add(a); posts.add(e);
    seg(a, e, DOOR - 0.08, DOOR, FRAME);
    cursor = e;
  }
  seg(cursor, to, 0, 0.08, FRAME);
  seg(cursor, to, 1.25, 1.55, 0xf4f6f8, 0.045);
  for (let s = from + 1.25; s < to - 0.6; s += 1.25) if (!gaps.some(([c, w]) => Math.abs(s - c) < w / 2 + 0.2)) posts.add(s);
  for (const s of posts) seg(s - 0.03, s + 0.03, 0, CEIL, FRAME);
}

// ---- Shell: floors, ceilings, the curtain wall --------------------------------------------------
/** Zones of 88F with their floor finish (they tile the plate). */
const ZONES: [Rect, BlockStyle, number][] = [
  [rect(-H, -H, -18, -CORE.z), 'carpet', CARPET_EXEC],             // Chairman's office
  [rect(-18, -H, -CORE.x, -CORE.z), 'carpet', CARPET_EXEC],        // its anteroom
  [rect(-CORE.x, -H, CORE.x, -CORE.z), 'tile', 0xe2d6c2],          // Sky Lobby
  [rect(CORE.x, -H, 18, -CORE.z), 'carpet', CARPET_EXEC],          // CEO's anteroom
  [rect(18, -H, H, -CORE.z), 'carpet', CARPET_EXEC],               // CEO's office
  [rect(-H, -CORE.z, -CORE.x, 0), 'painted', 0xc4c8cc],            // server room (raised floor)
  [rect(-CORE.x, -CORE.z, CORE.x, CORE.z), 'tile', STONE_DARK],    // damper hall
  [rect(CORE.x, -CORE.z, H, 0), 'carpet', CARPET_BOARD],           // boardroom
  [rect(-H, 0, -CORE.x, CORE.z), 'painted', 0xd8cdb8],              // pantry
  [rect(CORE.x, 0, H, CORE.z), 'carpet', CARPET_OFFICE],           // copy room
  [rect(-H, CORE.z, -CORE.x, H), 'carpet', CARPET_OFFICE],         // open office (SW)
  [rect(-CORE.x, CORE.z, CORE.x, H), 'slab', 0xa9a59d],            // renovation floor
  [rect(CORE.x, CORE.z, H, H), 'carpet', CARPET_OFFICE],           // open office (SE)
];

function shell(b: B) {
  for (const [r, style, color] of ZONES) for (const q of onPlate(r)) fill(b, q, -0.3, 0, style, color);
  // 88F's ceiling (the slab under 89F) over everything outside the core; the core has the gallery floor.
  for (const r of cover(rect(-H, -H, H, H), [rect(-CORE.x, -CORE.z, CORE.x, CORE.z)])) for (const q of onPlate(r)) fill(b, q, CEIL, F2, 'painted', 0xf2efe8);
  curtainWall(b);
}

/** Floor-to-ceiling glass round the plate: panes just outside the outline, bronze mullions every 1.5 m, a stone sill. */
function curtainWall(b: B) {
  const G = 0.25, poly = outline();
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
    const lx0 = Math.min(x0, x1), lx1 = Math.max(x0, x1), lz0 = Math.min(z0, z1), lz1 = Math.max(z0, z1);
    const alongX = lz1 - lz0 < 1e-6, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    // Outward is the side of the edge that is not floor.
    const out = alongX ? (inPlate(mx, mz - 0.1) ? 1 : -1) : (inPlate(mx - 0.1, mz) ? 1 : -1);
    // The pane, overlapping its neighbours by its thickness so nothing slips between at the corners.
    if (alongX) rbox(b, lx0 - G, out > 0 ? lz0 : lz0 - G, lx1 + G, out > 0 ? lz0 + G : lz0, 0, CEIL, 'window');
    else rbox(b, out > 0 ? lx0 : lx0 - G, lz0 - G, out > 0 ? lx0 + G : lx0, lz1 + G, 0, CEIL, 'window');
    // Sill, window head and mullions on the inside.
    const line = alongX ? lz0 : lx0;
    const strip = (d: number, y0: number, y1: number, style: BlockStyle, color: number, s0: number, s1: number) => {
      const p = line - out * d, q = line;
      if (alongX) rdetail(b, s0, Math.min(p, q), s1, Math.max(p, q), y0, y1, style, color);
      else rdetail(b, Math.min(p, q), s0, Math.max(p, q), s1, y0, y1, style, color);
    };
    const s0 = alongX ? lx0 : lz0, s1 = alongX ? lx1 : lz1;
    strip(0.2, 0, 0.12, 'painted', 0x7a6e62, s0, s1);
    strip(0.25, CEIL - 0.22, CEIL, 'painted', 0xd8d4cc, s0, s1);
    const n = Math.max(1, Math.round((s1 - s0) / 1.5));
    for (let k = 0; k <= n; k++) {
      const s = s0 + ((s1 - s0) * k) / n;
      strip(0.1, 0, CEIL, 'painted', MULLION, s - 0.04, s + 0.04);
    }
  }
}

// ---- The core: damper hall (88F), gallery (89F) and the shaft -----------------------------------
function core(b: B) {
  const X = CORE.x, Z = CORE.z, t = CORE_T, frame = 0x4a4038;
  // Stone walls from 88F to 89F's ceiling; 88F doors to the lobby (N), the renovation floor (S),
  // the server room (W) and the boardroom (E).
  wallX(b, -Z + t / 2, -X, X, [[0, 3]], 'painted', STONE, { t, y1: CEIL2, head: 2.7, frame });
  wallX(b, Z - t / 2, -X, X, [[0, 3]], 'painted', STONE, { t, y1: CEIL2, head: 2.7, frame });
  wallZ(b, -X + t / 2, -Z + t, Z - t, [[-7.5, 2.4]], 'painted', STONE, { t, y1: CEIL2, frame });
  wallZ(b, X - t / 2, -Z + t, Z - t, [[-7.5, 2.4]], 'painted', STONE, { t, y1: CEIL2, frame });

  // 89F's floor over the hall: a structural slab with the gallery's carpet on it, open over the
  // shaft and the two stairs.
  const inside = rect(-IX, -IZ, IX, IZ);
  const holes = [rect(-SHAFT, -SHAFT, SHAFT, SHAFT), rect(-STAIRS.x1, STAIRS.z0, -STAIRS.x0, STAIRS.z1), rect(STAIRS.x0, STAIRS.z0, STAIRS.x1, STAIRS.z1)];
  for (const r of cover(inside, holes)) { fill(b, r, CEIL, F2 - 0.04, 'painted', 0xb0a698); fill(b, r, F2 - 0.04, F2, 'carpet', CARPET_GALLERY); }
  // 89F's ceiling round the shaft, and the shaft's walls rising past it to the cable anchorage.
  for (const r of cover(inside, [holes[0]])) fill(b, r, CEIL2, CEIL2 + 0.3, 'painted', 0x2c2a28);
  for (const s of [-1, 1]) {
    rbox(b, -SHAFT - 0.3, s > 0 ? SHAFT : -SHAFT - 0.3, SHAFT + 0.3, s > 0 ? SHAFT + 0.3 : -SHAFT, CEIL2, SHAFT_TOP, 'painted', 0x34312e);
    rbox(b, s > 0 ? SHAFT : -SHAFT - 0.3, -SHAFT, s > 0 ? SHAFT + 0.3 : -SHAFT, SHAFT, CEIL2, SHAFT_TOP, 'painted', 0x34312e);
  }
  rbox(b, -SHAFT - 0.3, -SHAFT - 0.3, SHAFT + 0.3, SHAFT + 0.3, SHAFT_TOP, SHAFT_TOP + 0.4, 'painted', 0x2a2826);
  // Anchorage girders across the top of the shaft.
  for (const s of [-2.2, 2.2]) {
    rdetail(b, -SHAFT, s - 0.3, SHAFT, s + 0.3, SHAFT_TOP - 0.9, SHAFT_TOP, 'painted', 0x5a5e62);
    rdetail(b, s - 0.3, -SHAFT, s + 0.3, SHAFT, SHAFT_TOP - 1.5, SHAFT_TOP - 0.9, 'painted', 0x5a5e62);
  }
  // Columns at the shaft's corners carry the gallery.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (SHAFT + 0.5), z = sz * (SHAFT + 0.5);
    rbox(b, x - 0.5, z - 0.5, x + 0.5, z + 0.5, 0, CEIL, 'painted', STONE);
  }

  damper(b);
  hall(b);
  gallery(b);
}

/**
 * The tuned mass damper (風阻尼器): 41 plates of steel welded into a 660-tonne sphere, painted gold,
 * slung on eight cables from 92F, its swing taken by eight hydraulic dampers on a pedestal below
 * and a bumper ring round its waist.
 */
function damper(b: B) {
  const { y, r, base, baseTop } = DAMPER;
  // Pedestal: an octagonal steel drum (collision: a fan of boxes) with a lit amber rim.
  b.cylinder(0, 0, 0, base, baseTop, 'invisible');
  b.raw({ kind: 'cylinder', x: 0, y: 0, z: 0, radius: base, height: baseTop, axis: 'y', style: 'steel', color: 0x3c4044, sides: 8 });
  b.raw({ kind: 'cylinder', x: 0, y: baseTop - 0.12, z: 0, radius: base + 0.06, height: 0.12, axis: 'y', style: 'neon', color: 0x7a5a10, sides: 8 });
  b.raw({ kind: 'cylinder', x: 0, y: baseTop, z: 0, radius: 2.6, height: 0.25, axis: 'y', style: 'steel', color: 0x6a6e72, sides: 8 });
  // Eight hydraulic dampers from the pedestal to the cradle under the sphere.
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) / 8 * Math.PI * 2, px = Math.cos(a) * 1.9, pz = Math.sin(a) * 1.9;
    b.raw({ kind: 'cylinder', x: px, y: baseTop + 0.25, z: pz, radius: 0.2, height: 0.75, axis: 'y', style: 'steel', color: 0xc8a020 });
    b.raw({ kind: 'cylinder', x: px, y: baseTop + 1.0, z: pz, radius: 0.09, height: y - r - baseTop - 0.6, axis: 'y', style: 'steel', color: 0xd0d4d8 });
  }
  rbox(b, -1.9, -1.9, 1.9, 1.9, baseTop, y - r + 0.5, 'invisible');
  b.raw({ kind: 'cylinder', x: 0, y: y - r - 0.2, z: 0, radius: 2.1, height: 0.3, axis: 'y', style: 'steel', color: 0x4a4e52 });
  // The sphere as it is built: 41 steel plates stacked and welded, every other one a hair smaller
  // so the seams show. Its collision: the inscribed cube and two cross slabs.
  const plates = 41, t = (2 * r) / plates;
  for (let k = 0; k < plates; k++) {
    const y0 = y - r + k * t, mid = y0 + t / 2 - y;
    b.raw({ kind: 'cylinder', x: 0, y: y0, z: 0, radius: Math.sqrt(Math.max(0.04, r * r - mid * mid)) * (k % 2 ? 0.988 : 1), height: t, axis: 'y', style: 'gold', color: GOLD });
  }
  const c = r * 0.75;
  rbox(b, -c, -c, c, c, y - c, y + c, 'invisible');
  rbox(b, -2.5, -1, 2.5, 1, y - 1.1, y + 1.1, 'invisible');
  rbox(b, -1, -2.5, 1, 2.5, y - 1.1, y + 1.1, 'invisible');
  // Bumper ring round the waist, and the eight cables (four pairs) up to the anchorage.
  b.raw({ kind: 'cylinder', x: 0, y: y - 0.18, z: 0, radius: r + 0.12, height: 0.36, axis: 'y', style: 'steel', color: 0x2e3134, sides: 16 });
  for (let k = 0; k < 4; k++) for (const d of [-0.16, 0.16]) {
    const a = k / 4 * Math.PI * 2 + Math.PI / 4 + d;
    b.raw({ kind: 'cylinder', x: Math.cos(a) * (r + 0.05), y: y + 0.18, z: Math.sin(a) * (r + 0.05), radius: 0.07, height: SHAFT_TOP - 1 - y, axis: 'y', style: 'steel', color: 0x8a9096 });
  }
  // Spotlights from the shaft's top.
  b.light(0, SHAFT_TOP - 1.7, -3.2, 0xffe2a8, 7, 26);
  b.light(0, SHAFT_TOP - 1.7, 3.2, 0xffe2a8, 7, 26);
}

/** 88F round the pedestal: the stairs up to the gallery, benches and the info stands. */
function hall(b: B) {
  // Feature stairs on the west and east sides, rising north to 89F, glass along the open side.
  for (const s of [-1, 1]) {
    const x = s * (STAIRS.x0 + STAIRS.x1) / 2, w = STAIRS.x1 - STAIRS.x0, run = STAIRS.z1 - STAIRS.z0;
    b.stairs(x, (STAIRS.z0 + STAIRS.z1) / 2, w, run, 0, F2, 3);
    const edge = s * STAIRS.x0, n = 8;
    for (let i = 0; i < n; i++) {
      const z1 = STAIRS.z1 - (i * run) / n, z0 = z1 - run / n, top = Math.min(CEIL, F2 * ((i + 1) / n) + 0.95);
      rbox(b, s > 0 ? edge - 0.08 : edge, z0, s > 0 ? edge : edge + 0.08, z1, 0, top, 'glass');
      rdetail(b, s > 0 ? edge - 0.1 : edge - 0.02, z0, s > 0 ? edge + 0.02 : edge + 0.1, z1, top - 0.05, top, 'gold', 0xb08a3a);
    }
    sign(b, 'board', x, 3.7, STAIRS.z1 + 0.05, S, 1.9, 0.42, '89F 觀景台 ▲', '#1e1b18', '#f0d690', 'DAMPER GALLERY');
  }
  // Benches facing the damper and the info stands.
  for (const s of [-1, 1]) rbox(b, s * 8.25 - 1.2, 8.1, s * 8.25 + 1.2, 8.7, 0, 0.45, 'painted', WALNUT);
  for (const [x, z] of [[-4.6, -7.9], [4.6, 7.9]]) {
    rbox(b, x - 0.6, z - 0.2, x + 0.6, z + 0.2, 0, 1.3, 'painted', 0x2a2724);
    sign(b, 'board', x, 0.95, z + (z < 0 ? 0.21 : -0.21), z < 0 ? S : N, 1.1, 0.6, '風阻尼器', '#2a2724', '#f2cf74', 'TUNED MASS DAMPER · 660 t · Ø 5.5 m');
  }
  // Downlights round the gallery's underside and a cove of warm light along the core walls.
  for (const sx of [-1, 1]) for (const z of [-8.5, -3, 3, 8.5]) rdetail(b, sx * 8 - 0.4, z - 0.4, sx * 8 + 0.4, z + 0.4, CEIL - 0.04, CEIL, 'light');
  for (const sz of [-1, 1]) for (const x of [-3, 3]) rdetail(b, x - 0.4, sz * 8.4 - 0.4, x + 0.4, sz * 8.4 + 0.4, CEIL - 0.04, CEIL, 'light');
  for (const s of [-1, 1]) {
    rdetail(b, -IX, s > 0 ? IZ - 0.06 : -IZ, IX, s > 0 ? IZ : -IZ + 0.06, CEIL - 0.3, CEIL - 0.26, 'neon', 0xffc070);
    rdetail(b, s > 0 ? IX - 0.06 : -IX, -IZ, s > 0 ? IX : -IX + 0.06, IZ, CEIL - 0.3, CEIL - 0.26, 'neon', 0xffc070);
  }
}

/** 89F: the viewing gallery round the shaft. */
function gallery(b: B) {
  // Glass balustrade with a brass handrail round the shaft and the stairwells.
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    rbox(b, x0, z0, x1, z1, F2, F2 + RAIL, 'glass');
    rdetail(b, x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, F2 + RAIL, F2 + RAIL + 0.06, 'gold', 0xb08a3a);
  };
  const e = SHAFT + 0.08;
  rail(-e, -e, e, -SHAFT); rail(-e, SHAFT, e, e); rail(-e, -SHAFT, -SHAFT, SHAFT); rail(SHAFT, -SHAFT, e, SHAFT);
  for (const s of [-1, 1]) {
    const inner = s * STAIRS.x0;
    rail(s > 0 ? inner - 0.08 : inner, STAIRS.z0, s > 0 ? inner : inner + 0.08, STAIRS.z1 + 0.08);
    rail(s > 0 ? STAIRS.x0 - 0.08 : -STAIRS.x1, STAIRS.z1, s > 0 ? STAIRS.x1 : -STAIRS.x0 + 0.08, STAIRS.z1 + 0.08);
  }
  // Display walls: backlit panels on the core's inner faces and a gold reveal under the ceiling.
  for (const s of [-1, 1]) {
    rdetail(b, -5, s > 0 ? IZ - 0.05 : -IZ, 5, s > 0 ? IZ : -IZ + 0.05, F2 + 0.9, F2 + 3.2, 'neon', 0x6a5a40);
    rdetail(b, -IX, s > 0 ? IZ - 0.04 : -IZ, IX, s > 0 ? IZ : -IZ + 0.04, CEIL2 - 0.35, CEIL2 - 0.3, 'neon', 0xffc070);
    rdetail(b, s > 0 ? IX - 0.04 : -IX, -IZ, s > 0 ? IX : -IX + 0.04, IZ, CEIL2 - 0.35, CEIL2 - 0.3, 'neon', 0xffc070);
  }
  sign(b, 'board', 0, F2 + 2.05, -IZ + 0.07, S, 9.6, 1.5, '台北101 風阻尼器', '#14110e', '#f2cf74', 'TUNED MASS DAMPER · 87F–92F · 660 TONNES');
  sign(b, 'board', 0, F2 + 2.05, IZ - 0.07, N, 9.6, 1.5, '88F · 89F 觀景台', '#14110e', '#f2cf74', 'DAMPER GALLERY · PLEASE DO NOT LEAN ON THE GLASS');
  // The damper babies (阻尼器寶寶), the gallery's mascots, by the south wall.
  [0xd8262a, 0xf2c21a, 0x2a9a4a, 0x2a2a2e].forEach((c, i) => {
    const x = -2.4 + i * 1.6, z = IZ - 0.7;
    b.raw({ kind: 'ball', x, y: F2 + 0.55, z, radius: 0.5, style: 'painted', color: c });
    for (const dx of [-0.17, 0.17]) b.raw({ kind: 'ball', x: x + dx, y: F2 + 0.7, z: z - 0.42, radius: 0.09, style: 'painted', color: 0xffffff });
  });
  rbox(b, -2.95, IZ - 1.25, 2.95, IZ - 0.15, F2, F2 + 0.6, 'invisible');
  // Benches under the north sign.
  for (const s of [-1, 1]) rbox(b, s * 3.2 - 1.2, -IZ + 0.15, s * 3.2 + 1.2, -IZ + 0.7, F2, F2 + 0.45, 'painted', WALNUT);
  // Downlights.
  for (const sx of [-1, 1]) for (const z of [-8.5, -3, 3, 8.5]) rdetail(b, sx * 8 - 0.35, z - 0.35, sx * 8 + 0.35, z + 0.35, CEIL2 - 0.04, CEIL2, 'light');
  for (const sz of [-1, 1]) for (const x of [-3, 3]) rdetail(b, x - 0.35, sz * 8.4 - 0.35, x + 0.35, sz * 8.4 + 0.35, CEIL2 - 0.04, CEIL2, 'light');
}

// ---- Furniture ---------------------------------------------------------------------------------
let plants: Record<string, number[]> = {};
function plant(b: B, x: number, z: number, scale = 1, model = 'plant:moneyTree', y = 0) {
  b.cylinder(x, y, z, 0.32 * scale, 0.55 * scale, 'painted', 'y', 0x3a3632);
  (plants[model] ??= []).push(x, y + 0.5 * scale, z, (x * 7.1 + z * 3.3) % 6.28, scale, 0, 0xe0e8d0, 0xffffff);
}
/** Office chair (decorative), its sitter facing `facing`. */
function chair(b: B, x: number, z: number, facing: number, color = BLACK) {
  b.raw({ kind: 'cylinder', x, y: 0, z, radius: 0.28, height: 0.06, axis: 'y', style: 'painted', color: 0x2a2a2c, sides: 5 });
  b.raw({ kind: 'cylinder', x, y: 0.06, z, radius: 0.04, height: 0.38, axis: 'y', style: 'steel', color: 0x8a8e92 });
  rdetail(b, x - 0.25, z - 0.25, x + 0.25, z + 0.25, 0.44, 0.52, 'painted', color);
  const bx = x - Math.sin(facing) * 0.24, bz = z + Math.cos(facing) * 0.24;
  if (Math.abs(Math.sin(facing)) > 0.5) rdetail(b, bx - 0.04, z - 0.24, bx + 0.04, z + 0.24, 0.55, 1.05, 'painted', color);
  else rdetail(b, x - 0.24, bz - 0.04, x + 0.24, bz + 0.04, 0.55, 1.05, 'painted', color);
}
/** Monitor on a desk at height y, its screen facing `facing`. */
function monitor(b: B, x: number, y: number, z: number, facing: number) {
  const fx = Math.sin(facing), fz = -Math.cos(facing);
  if (Math.abs(fx) > 0.5) {
    rdetail(b, x - 0.03, z - 0.3, x + 0.03, z + 0.3, y + 0.12, y + 0.48, 'painted', BLACK);
    rdetail(b, x + fx * 0.03 - 0.004, z - 0.27, x + fx * 0.03 + 0.004, z + 0.27, y + 0.15, y + 0.45, 'neon', 0x1c2a3a);
  } else {
    rdetail(b, x - 0.3, z - 0.03, x + 0.3, z + 0.03, y + 0.12, y + 0.48, 'painted', BLACK);
    rdetail(b, x - 0.27, z + fz * 0.03 - 0.004, x + 0.27, z + fz * 0.03 + 0.004, y + 0.15, y + 0.45, 'neon', 0x1c2a3a);
  }
  rdetail(b, x - 0.06, z - 0.06, x + 0.06, z + 0.06, y, y + 0.14, 'painted', 0x3a3c3e);
}
/**
 * A pod of four desks (2 × 2) round a cross of 1.3 m fabric screens, centred on (x, z), the long
 * side along x: low cover in the open offices (3.4 × 1.8 m).
 */
function pod(b: B, x: number, z: number) {
  const w = 1.6, d = 0.8;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = x + sx * (w / 2 + 0.05), cz = z + sz * (d / 2 + 0.05);
    rbox(b, cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 0, 0.74, 'painted', DESK);
    monitor(b, cx, 0.74, z + sz * 0.3, sz > 0 ? S : N);
    chair(b, cx, z + sz * (d + 0.55), sz > 0 ? N : S);
  }
  rbox(b, x - w - 0.1, z - 0.04, x + w + 0.1, z + 0.04, 0, 1.3, 'painted', FABRIC);
  rbox(b, x - 0.04, z - d - 0.1, x + 0.04, z + d + 0.1, 0, 1.3, 'painted', FABRIC);
  rdetail(b, x - w - 0.12, z - 0.06, x + w + 0.12, z + 0.06, 1.3, 1.34, 'painted', 0xb8bcc0);
}
/** Ceiling light panels on a grid over r. */
function panels(b: B, r: Rect, step = 2.5, y = CEIL) {
  for (let x = r.x0 + step / 2; x < r.x1; x += step) for (let z = r.z0 + step / 2; z < r.z1; z += step)
    if (inPlate(x, z)) rdetail(b, x - 0.3, z - 0.6, x + 0.3, z + 0.6, y - 0.05, y, 'light');
}
function sofa(b: B, x0: number, z0: number, x1: number, z1: number, back: 'n' | 's' | 'e' | 'w', color = LEATHER) {
  rbox(b, x0, z0, x1, z1, 0, 0.45, 'painted', color);
  const t = 0.22;
  if (back === 'n') rdetail(b, x0, z0, x1, z0 + t, 0.45, 0.85, 'painted', color);
  if (back === 's') rdetail(b, x0, z1 - t, x1, z1, 0.45, 0.85, 'painted', color);
  if (back === 'w') rdetail(b, x0, z0, x0 + t, z1, 0.45, 0.85, 'painted', color);
  if (back === 'e') rdetail(b, x1 - t, z0, x1, z1, 0.45, 0.85, 'painted', color);
}

// ---- North: the Sky Lobby (SWAT) and the executive suites ----------------------------------------
function lobby(b: B) {
  const X = CORE.x, Z = CORE.z;
  // Side walls to the suites, stone on both faces.
  wallZ(b, -X, -H, -Z, [[-17.5, 2.4]], 'painted', STONE, { frame: 0x4a4038 });
  wallZ(b, X, -H, -Z, [[-17.5, 2.4]], 'painted', STONE, { frame: 0x4a4038 });
  // Lift doors on the core's north face: three cars each side of the hall's entrance, with floor indicators.
  for (const x of [-8.5, -6, -3.5, 3.5, 6, 8.5]) {
    rdetail(b, x - 0.75, -Z - 0.06, x + 0.75, -Z, 0, 2.55, 'painted', 0x4a443e);
    rdetail(b, x - 0.6, -Z - 0.08, x - 0.01, -Z - 0.06, 0, 2.4, 'painted', 0xb8bcc0);
    rdetail(b, x + 0.01, -Z - 0.08, x + 0.6, -Z - 0.06, 0, 2.4, 'painted', 0xb8bcc0);
    sign(b, 'board', x, 2.8, -Z - 0.07, N, 0.7, 0.26, '▼ 88', '#0e0e10', '#ffb040');
  }
  sign(b, 'board', 0, 3.25, -Z - 0.07, N, 3.2, 0.5, '風阻尼器 DAMPER ▲', '#14110e', '#f2cf74');
  // Reception: a walnut desk before the logo wall, a lounge between it and the glass.
  rbox(b, -3.5, -19.4, 3.5, -18.5, 0, 1.1, 'painted', WALNUT);
  rdetail(b, -3.6, -19.5, 3.6, -18.4, 1.1, 1.16, 'painted', 0xe8e0d0);
  rbox(b, -5, -21.6, 5, -21.1, 0, 3.6, 'painted', 0x6a4630);
  rdetail(b, -5.1, -21.08, 5.1, -21.0, 3.45, 3.6, 'gold', 0xb08a3a);
  sign(b, 'board', 0, 2.2, -21.04, S, 6.4, 1.6, 'TAIPEI 101', '#2a1a10', '#f2cf74', '台北101 · 88F · SKY LOBBY 高層轉乘大廳');
  sign(b, 'board', 0, 2.2, -21.66, N, 4.2, 0.8, '台北101', '#2a1a10', '#f2cf74', '88F');
  chair(b, -1.6, -20.2, S); chair(b, 1.6, -20.2, S);
  monitor(b, -1.6, 1.1, -19.0, N); monitor(b, 1.6, 1.1, -19.0, N);
  sofa(b, -7.2, -24.6, -3.2, -23.7, 'n', 0x5a4a3e);
  sofa(b, 3.2, -24.6, 7.2, -23.7, 'n', 0x5a4a3e);
  rbox(b, -6.2, -22.9, -4.2, -22.1, 0, 0.42, 'painted', WALNUT);
  rbox(b, 4.2, -22.9, 6.2, -22.1, 0, 0.42, 'painted', WALNUT);
  // Two of the floor's columns stand in the lobby.
  for (const s of [-1, 1]) rbox(b, s * 8.2 - 0.6, -21.1, s * 8.2 + 0.6, -19.9, 0, CEIL, 'painted', STONE);
  plant(b, -10.8, -12.2, 1.2); plant(b, 10.8, -12.2, 1.2); plant(b, -10.8, -24, 1.3); plant(b, 10.8, -24, 1.3);
  // Cove light along the lift wall, and the ceiling.
  rdetail(b, -X + 0.2, -Z - 0.3, X - 0.2, -Z - 0.24, CEIL - 0.25, CEIL - 0.2, 'neon', 0xffc070);
  panels(b, rect(-X, -H, X, -Z), 3);
}

/** The Chairman's (NW) and CEO's (NE) suites: a corner office behind an anteroom with the assistant's desk. */
function suites(b: B) {
  for (const s of [-1, 1]) {
    const at = (x: number) => s * x;
    const lo = (a: number, c: number) => Math.min(at(a), at(c)), hi = (a: number, c: number) => Math.max(at(a), at(c));
    // Walnut partition between the anteroom and the corner office.
    wallZ(b, at(18), -H, -CORE.z, [[-20, 2.2]], 'painted', WALNUT, { frame: 0x3a2618 });
    // Corner office: desk facing the door, credenza, sofa group by the glass, a bookcase.
    rbox(b, lo(21.2, 23.6), -18.4, hi(21.2, 23.6), -16.6, 0, 0.76, 'painted', WALNUT);
    rdetail(b, lo(21.15, 23.65), -18.45, hi(21.15, 23.65), -16.55, 0.76, 0.8, 'painted', 0x2a2420);
    monitor(b, at(22.4), 0.8, -17.5, s > 0 ? E : W);
    chair(b, at(24.2), -17.5, s > 0 ? W : E, LEATHER);
    rbox(b, lo(24.3, 24.8), -15.4, hi(24.3, 24.8), -12, 0, 0.9, 'painted', WALNUT);
    sofa(b, lo(18.6, 21.6), -24.2, hi(18.6, 21.6), -23.3, 'n');
    sofa(b, lo(22.2, 23.1), -23, hi(22.2, 23.1), -20.6, s > 0 ? 'e' : 'w');
    rbox(b, lo(19.6, 21.4), -22.4, hi(19.6, 21.4), -21.4, 0, 0.42, 'painted', 0x2a2420);
    rbox(b, lo(18.1, 18.6), -14.6, hi(18.1, 18.6), -11.2, 0, 2.3, 'painted', 0x5a3a26);
    plant(b, at(24.2), -19.6, 1.1); plant(b, at(18.9), -24.3, 1.2);
    // Anteroom: the assistant's desk and a waiting bench by the glass.
    rbox(b, lo(13.4, 16.6), -23.4, hi(13.4, 16.6), -22.6, 0, 0.76, 'painted', WALNUT);
    monitor(b, at(15), 0.76, -23.1, S); chair(b, at(15), -24.1, S);
    sofa(b, lo(12.3, 13.2), -21.5, hi(12.3, 13.2), -19, s > 0 ? 'e' : 'w');
    plant(b, at(17.2), -12, 1.1);
    sign(b, 'board', at(18 - 0.12), 2.75, -20, s > 0 ? W : E, 1.8, 0.36, s > 0 ? '執行長室' : '董事長室', '#2a1a10', '#f2cf74', s > 0 ? 'CEO' : 'CHAIRMAN');
    panels(b, rect(lo(12, 18), -H, hi(12, 18), -CORE.z), 3);
    panels(b, rect(lo(18, H), -H, hi(18, H), -CORE.z), 3);
  }
}

// ---- Middle: A (server room), B (boardroom), the pantry and the copy room ----------------------------
function serverRoom(b: B) {
  // Walls: the anteroom above (door at the east end), the pantry below (door at the west end).
  wallX(b, -CORE.z, -H, -CORE.x, [[-15, 2.4]], 'painted', 0xc9cdd1, { frame: FRAME });
  wallX(b, 0, -H, -CORE.x, [[-20, 2.4]], 'painted', 0xc9cdd1, { frame: FRAME });
  // Two rows of racks in a zigzag: the north row open at its east end, the south row at its west end.
  const rack = (x0: number, x1: number, z0: number, z1: number) => {
    rbox(b, x0, z0, x1, z1, 0, 2.1, 'painted', 0x17191c);
    for (let x = x0 + 0.3; x < x1 - 0.2; x += 0.6) for (const zf of [z0 - 0.012, z1]) {
      for (let k = 0; k < 5; k++) rdetail(b, x - 0.12, zf, x + 0.12, zf + 0.012, 0.4 + k * 0.32, 0.43 + k * 0.32, 'neon', (k + Math.round(x * 3)) % 3 ? LED_GREEN : LED_BLUE);
    }
  };
  rack(-23.8, -16.6, -8, -7);
  rack(-20.6, -12.6, -4, -3);
  // The raised floor's 60 cm tiles.
  for (let x = -24.4; x < -12.2; x += 0.6) b.raw({ kind: 'marking', x, y: 0.003, z: -5.5, w: 0.025, d: 10.8, color: 0x7a8088 });
  for (let z = -10.4; z < -0.2; z += 0.6) b.raw({ kind: 'marking', x: -18.5, y: 0.003, z, w: 12.8, d: 0.025, color: 0x7a8088 });
  // Cooling units against the glass, fire-suppression bottles, cable trays overhead.
  rbox(b, -24.8, -10.8, -23.6, -9, 0, 2, 'painted', 0xd8dadc);
  rbox(b, -24.8, -2.4, -23.6, -0.6, 0, 2, 'painted', 0xd8dadc);
  for (const z of [-10.4, -9.9, -9.4]) b.cylinder(-13, 0, z, 0.2, 1.6, 'painted', 'y', 0xc02a22);
  for (const z of [-7.5, -3.5]) rdetail(b, -24, z - 0.3, -12.6, z + 0.3, 2.6, 2.7, 'painted', 0x8a8e92);
  sign(b, 'board', -15, 2.95, -CORE.z - 0.12, N, 1.6, 0.36, '機房 SERVER', '#1a2a3a', '#7fd0ff');
  sign(b, 'board', -20, 2.95, 0.12, S, 1.6, 0.36, '機房 SERVER', '#1a2a3a', '#7fd0ff');
  panels(b, rect(-H, -CORE.z, -CORE.x, 0), 2.5);
}

function boardroom(b: B) {
  wallX(b, -CORE.z, CORE.x, H, [[15, 2.4]], 'painted', WALNUT, { frame: 0x3a2618 });
  // To the copy room: glass with a frosted band, the door at its east end.
  glassWall(b, 'x', 0, CORE.x, H, [[20, 1.8]]);
  // The board table (low cover) and its chairs, the credenza and a screen wall.
  rbox(b, 15.4, -6.5, 21.6, -4.5, 0, 0.76, 'painted', 0x4a3020);
  rdetail(b, 15.35, -6.55, 21.65, -4.45, 0.76, 0.8, 'painted', 0x1e1a18);
  for (let x = 16; x <= 21.1; x += 1.25) { chair(b, x, -7.1, S, LEATHER); chair(b, x, -3.9, N, LEATHER); }
  chair(b, 14.8, -5.5, E, LEATHER); chair(b, 22.2, -5.5, W, LEATHER);
  rbox(b, 17, -10.8, 22, -10.2, 0, 0.8, 'painted', WALNUT);
  rdetail(b, 17.4, -10.88, 21.6, -10.8, 1.1, 3.3, 'painted', 0x101214);
  sign(b, 'screen', 19.5, 2.2, -10.77, S, 4, 2, '', '#101826', '#5ad8ff');
  plant(b, 24.2, -10.2, 1.1); plant(b, 24.2, -1, 1.1);
  sign(b, 'board', 15, 2.95, -CORE.z - 0.12, N, 2.2, 0.36, '董事會議室', '#2a1a10', '#f2cf74', 'BOARDROOM');
  for (const [x0, z0, x1, z1] of [[15.2, -7, 21.8, -6.9], [15.2, -4.1, 21.8, -4], [15.2, -7, 15.3, -4], [21.7, -7, 21.8, -4]]) rdetail(b, x0, z0, x1, z1, CEIL - 0.06, CEIL - 0.02, 'neon', 0xffd8a0);
  panels(b, rect(CORE.x, -CORE.z, H, 0), 3);
}

function pantry(b: B) {
  wallX(b, CORE.z, -H, -CORE.x, [[-15, 2.4]], 'painted', WHITE_WALL, { frame: FRAME });
  // Kitchen run on the north wall (sink, fridge, coffee machine), vending machines on the core wall.
  rbox(b, -24.8, 0.1, -21.6, 0.75, 0, 0.92, 'painted', 0xf0ece4);
  rdetail(b, -24.8, 0.1, -21.6, 0.8, 0.92, 0.96, 'painted', 0x3a3a3c);
  rdetail(b, -24.8, 0.1, -21.6, 0.5, 1.5, 2.3, 'painted', 0xf0ece4);
  rbox(b, -18.5, 0.1, -17.5, 0.85, 0, 1.9, 'painted', 0xc8ccd0);
  rdetail(b, -23.6, 0.3, -23.1, 0.65, 0.96, 1.4, 'painted', 0x2a2a2c);
  for (const [z, c] of [[2.2, 0xc8202a], [3.5, 0x1a5ab8]] as [number, number][]) {
    rbox(b, -12.9, z - 0.6, -12.1, z + 0.6, 0, 1.9, 'painted', c);
    rdetail(b, -12.93, z - 0.45, -12.9, z + 0.45, 0.5, 1.7, 'neon', 0xd8e8ff);
  }
  // Tables with chairs, and a bar along the glass with stools.
  for (const [x, z] of [[-19, 4.5], [-19, 8]] as [number, number][]) {
    rbox(b, x - 1.2, z - 0.5, x + 1.2, z + 0.5, 0, 0.74, 'painted', OAK);
    for (const dx of [-0.6, 0.6]) { chair(b, x + dx, z - 0.95, S, 0xc8a070); chair(b, x + dx, z + 0.95, N, 0xc8a070); }
  }
  rbox(b, -24.8, 2, -24.2, 9.5, 0, 1.05, 'painted', OAK);
  for (let z = 2.6; z < 9.5; z += 1.2) b.raw({ kind: 'cylinder', x: -23.6, y: 0, z, radius: 0.2, height: 0.75, axis: 'y', style: 'painted', color: 0x2a2a2c });
  plant(b, -13.2, 9.8, 1.1); plant(b, -16, 0.9, 0.9);
  sign(b, 'board', -15, 2.95, CORE.z + 0.12, S, 1.8, 0.36, '茶水間 PANTRY', '#f4efe6', '#3a2a1a');
  panels(b, rect(-H, 0, -CORE.x, CORE.z), 2.5);
}

function copyRoom(b: B) {
  wallX(b, CORE.z, CORE.x, H, [[15, 2.4]], 'painted', WHITE_WALL, { frame: FRAME });
  // Copiers along the core wall, a sorting table, paper shelves (tall cover), lockers by the glass, a mail counter.
  for (const z of [2, 4, 6]) {
    rbox(b, 12.1, z - 0.6, 13.1, z + 0.6, 0, 1.15, 'painted', 0xdcdcd8);
    rdetail(b, 12.3, z - 0.4, 12.9, z + 0.4, 1.15, 1.2, 'painted', 0x3a3c40);
  }
  rbox(b, 16.4, 4.2, 19.4, 5.4, 0, 0.9, 'painted', 0xd8d4cc);
  rbox(b, 20.8, 2.6, 21.6, 7.6, 0, 2.1, 'painted', 0x6a7078);
  for (let k = 0; k < 4; k++) rdetail(b, 20.75, 2.7, 21.65, 7.5, 0.3 + k * 0.5, 0.34 + k * 0.5, 'painted', 0xf4f4f0);
  rbox(b, 24.2, 3, 24.8, 9.5, 0, 1.8, 'painted', 0x8a9096);
  rbox(b, 19, 9.6, 22.5, 10.8, 0, 1.1, 'painted', 0xc8c4bc);
  plant(b, 24.2, 1, 1); plant(b, 13, 10.2, 1);
  sign(b, 'board', 15, 2.95, CORE.z + 0.12, S, 1.8, 0.36, '影印室 COPY', '#f4efe6', '#1a2a3a');
  panels(b, rect(CORE.x, 0, H, CORE.z), 2.5);
}

// ---- South: the open offices and the floor under renovation (Militia) ---------------------------
function offices(b: B) {
  // SW: three pods of desks, filing cabinets and a printer.
  pod(b, -20.75, 15); pod(b, -20.75, 20.5); pod(b, -15.75, 21.25);
  rbox(b, -19.2, 11.2, -17, 11.8, 0, 1.3, 'painted', 0xb8bcc0);
  rbox(b, -24.8, 11.3, -23.6, 12.3, 0, 1.2, 'painted', 0xdcdcd8);
  plant(b, -12.9, 24, 1.2); plant(b, -24.2, 17.75, 1);
  panels(b, rect(-H, CORE.z, -CORE.x, H), 2.5);
  // SE: two pods and two glass meeting rooms along the glass.
  pod(b, 17.5, 14.75); pod(b, 23, 14.75);
  glassWall(b, 'x', 18.75, CORE.x, A, [[15, 1.8], [20, 1.8]]);
  glassWall(b, 'z', 17.5, 18.75, H, []);
  glassWall(b, 'z', A, 18.75, M, []);
  for (const [x0, x1] of [[13, 16.6], [18.4, 21]]) {
    const x = (x0 + x1) / 2;
    rbox(b, x0, 21.6, x1, 23.2, 0, 0.74, 'painted', OAK);
    for (const dx of [-0.8, 0, 0.8]) { chair(b, x + dx, 21.0, S); chair(b, x + dx, 23.8, N); }
  }
  sign(b, 'board', 15, 2.75, 18.66, N, 1.4, 0.32, '會議室 A', '#f4efe6', '#1a2a3a', 'MEETING');
  sign(b, 'board', 20, 2.75, 18.66, N, 1.4, 0.32, '會議室 B', '#f4efe6', '#1a2a3a', 'MEETING');
  rbox(b, 24, 11.3, 24.8, 13.5, 0, 1.3, 'painted', 0xb8bcc0);
  plant(b, 12.9, 12, 1.1); plant(b, 24.2, 17.4, 1.1);
  panels(b, rect(CORE.x, CORE.z, H, H), 2.5);
}

/** Militia comes up the fire stairs onto a floor being fitted out: bare slab, building stock, services overhead. */
function renovation(b: B) {
  const X = CORE.x;
  wallZ(b, -X, CORE.z, H, [[17.5, 2.4]], 'painted', 0xbcb8b0, { frame: FRAME });
  wallZ(b, X, CORE.z, H, [[17.5, 2.4]], 'painted', 0xbcb8b0, { frame: FRAME });
  // Fire stair enclosure (east) and the freight lift (west) against the core.
  rbox(b, 4, CORE.z, 9.5, 14.4, 0, CEIL, 'concrete', 0xc8c4bc);
  rdetail(b, 5.6, 14.4, 7.2, 14.47, 0, 2.2, 'painted', 0x9a3a2a);
  sign(b, 'board', 6.4, 2.6, 14.48, S, 1.4, 0.4, '安全梯', '#14883a', '#ffffff', 'FIRE STAIRS · EXIT');
  rbox(b, -9.5, CORE.z, -4, 14.4, 0, CEIL, 'concrete', 0xc8c4bc);
  rdetail(b, -8, 14.4, -5.5, 14.47, 0, 2.5, 'painted', 0x8a8e92);
  sign(b, 'board', -6.75, 2.85, 14.48, S, 1.6, 0.36, '貨梯 FREIGHT', '#2a2a2c', '#ffd040');
  // Building stock: drywall stacks, a pallet of tiles, a cable drum, a scissor lift.
  rbox(b, -11, 21.5, -9.4, 22.7, 0, 1.15, 'painted', 0xe8e6e0);
  rbox(b, 9.4, 21.5, 11, 22.7, 0, 1.15, 'painted', 0xe8e6e0);
  rbox(b, -2.2, 23, 2.2, 24.4, 0, 0.9, 'crate', 0xc8b090);
  b.cylinder(-10.6, 0, 15.4, 0.7, 1.1, 'wood', 'y', 0x8a6a48);
  rbox(b, 9.8, 14.7, 11.6, 16, 0, 1.4, 'painted', 0xd8a020);
  rdetail(b, 9.8, 14.7, 11.6, 16, 1.4, 1.5, 'painted', 0x3a3c3e);
  // Exposed services overhead: ducts and a cable tray, work lights.
  for (const x of [-7.5, 7.5]) rdetail(b, x - 0.5, 14.4, x + 0.5, H - 0.3, CEIL - 0.7, CEIL - 0.1, 'painted', 0xa8acb0);
  rdetail(b, -X, 19.6, X, 20, CEIL - 0.45, CEIL - 0.3, 'painted', 0x6a6e72);
  for (const x of [-9, -3, 3, 9]) for (const z of [17, 22.5]) rdetail(b, x - 0.6, z - 0.08, x + 0.6, z + 0.08, CEIL - 0.3, CEIL - 0.24, 'light');
  sign(b, 'board', 0, 3.1, 24.4, N, 3.4, 0.6, '施工中 請勿進入', '#e0b020', '#1a1a1a', 'FIT-OUT IN PROGRESS · AUTHORISED STAFF ONLY');
}

// ---- Outside: the rest of the tower --------------------------------------------------------------
/**
 * The xinyi map's Taipei 101 round this floor, shifted down by its height: the segments below the
 * glass, and above the window head the top segment's lit band, the crown, the spire and its
 * beacons (seen out of the windows looking down, and from outside in the menu's backdrop).
 */
function towerOutside(b: B) {
  const glass = 0x8cc8b4, head = FLOOR_Y + CEIL + 0.05;
  const section = (y0: number, y1: number, h0: number, n0: number, h1: number, n1: number, color: number, glow: number) => {
    const lit = glow >= 2.5, isGlass = color === 0xe6fbf6;
    const style: BlockStyle = lit ? 'neon' : isGlass ? 'curtain' : 'steel';
    b.loft(0, 0, y0 - FLOOR_Y, y1 - FLOOR_Y, h0, n0, h1, n1, style, lit ? 0xffe0a0 : isGlass ? glass : color, y1 === TOWER.crownTop);
  };
  const at = (y0: number, y1: number, h0: number, h1: number, y: number) => h0 + (h1 - h0) * (y - y0) / (y1 - y0);
  for (const [y0, y1, h0, n0, h1, n1, color, glow] of TOWER_LOFTS) {
    if (y0 < FLOOR_Y) section(y0, Math.min(y1, FLOOR_Y - 0.02), h0, n0, y1 > FLOOR_Y ? at(y0, y1, h0, h1, FLOOR_Y) : h1, n1, color, glow);
    if (y1 > head) section(Math.max(y0, head), y1, y0 < head ? at(y0, y1, h0, h1, head) : h0, n0, h1, n1, color, glow);
  }
  for (const [x, y, z, nx, ny, nz, rx, ry, depth, color] of TOWER_ORNAMENTS) {
    if (y > FLOOR_Y - 3 && y < head + 3) continue;
    const gold = color === 15252309;
    b.disc(x - TOWER.cx, y - FLOOR_Y, z - TOWER.cz, nx, ny, nz, rx, ry, depth, gold ? 'neon' : 'steel', gold ? 0x8a6a2a : 0x4a5a5a);
  }
  for (const [x, z, r0, r1, y0, y1, color, glow] of TOWER_CYLINDERS) {
    if (y0 < head) continue;
    b.raw({ kind: 'cylinder', x: x - TOWER.cx, y: y0 - FLOOR_Y, z: z - TOWER.cz, radius: r0, top: r1, height: y1 - y0, axis: 'y', style: glow >= 2 ? 'neon' : 'steel', color: glow >= 2 ? 0xfff0c8 : color });
  }
  for (const [x, y, z, r] of TOWER_LAMPS) if (y > FLOOR_Y + SHAFT_TOP + 1) b.raw({ kind: 'ball', x: x - TOWER.cx, y: y - FLOOR_Y, z: z - TOWER.cz, radius: r, style: 'neon', color: 0xff3020 });
}

export function taipei101(): MapDef {
  const b = new MapBuilder({
    id: 'taipei101', name: 'Taipei 101 · 88F', region: `88F ${TAIPEI101_NAME_ZH} / XINYI, TAIPEI`,
    description: 'An office floor 383 m up Taipei 101: the server room and the boardroom either side of the tuned mass damper, its gallery above, the city at golden hour below.',
    theme: 'highrise', halfX: 28.5, halfZ: 28.5, seed: 88, roll: 0, ridge: 0,
    sabotage: { sites: ['A', 'B'], attackerSpawn: 1 },
    // Late-afternoon sun low in the west-north-west, across the server room and the pantry.
    sun: { x: -0.84, y: 0.3, z: -0.2 },
    // The street, far below (the skyline's ground covers it).
    ground: () => -FLOOR_Y - 6,
  });
  b.buildTerrain(4);
  plants = {};

  shell(b);
  core(b);
  lobby(b);
  suites(b);
  serverRoom(b);
  boardroom(b);
  pantry(b);
  copyRoom(b);
  offices(b);
  renovation(b);
  towerOutside(b);
  for (const [model, data] of Object.entries(plants)) b.raw({ kind: 'instances', model, data });
  // The city round the tower, 383 m down (client dressing: the Taipei skyline, Xinyi's lots and a fill of blocks).
  b.raw({ kind: 'dressing', set: 'taipei101', x: TOWER.cx, z: TOWER.cz, y: -FLOOR_Y });

  // ---- Bases, sites, landmarks and ammo ------------------------------------------------------
  // SWAT steps out of the lifts into the Sky Lobby; Militia comes up the fire stairs onto the renovation floor.
  for (const z of [-13.5, -16]) for (const x of [-8.5, -6, -3.5, 3.5, 6, 8.5]) b.spawn(0, x, 0, z, S);
  for (const z of [16, 18.5]) for (const x of [-8.5, -6, -3.5, 3.5, 6, 8.5]) b.spawn(1, x, 0, z, N);
  b.point('A', 'Server Room 機房', -18.5, 0, -5.5, 4);
  b.point('B', 'Boardroom 董事會議室', 18.5, 0, -5.5, 4);
  b.point('C', 'Damper Gallery 風阻尼器觀景台', 0, F2, -8.25, 3.5);
  b.point('D', 'Pantry 茶水間', -18.5, 0, 5.5, 4);
  b.point('E', 'Open Office 開放式辦公區', 18.5, 0, 16.75, 4);
  for (const [x, y, z] of [[-10.5, 0, -19.5], [10.6, 0, 23.6], [-5, 0, 9.5], [8.75, F2, 8.75], [-13.6, 0, 6.5], [23.6, 0, 16.75], [-13.6, 0, -1.2], [13.6, 0, -1.2]] as [number, number, number][])
    b.ammoCrate(x, y, z);

  return b.build();
}
