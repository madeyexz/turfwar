import { MapBuilder } from './builder';
import {
  BOXES, CIRCLES, CITY, DECKS, HILLS, LOTS, PLAZA_101, ROADS, SHOPS, SIGNS, SIGN_ART, SLOPES, TOWER, TOWER_BOXES,
  TOWER_CYLINDERS, TOWER_LAMPS, TOWER_LOFTS, TOWER_ORNAMENTS, XINYI_MALLS,
} from './xinyi-data';
import type { BlockStyle, MapDef, SignStyle } from './types';
import { parkXinyiVehicles } from './xinyi-vehicles';

/**
 * Xinyi (信義): Taipei 101 and the blocks around it, from 臺北狂飆 / TAIPEI RUSH
 * by @aicodewithme (taipei-gta.vercel.app). shared/maps/xinyi-data.ts, which
 * tools/import-xinyi.ts extracts from that game's built code, supplies the street plan, the
 * basin's hills, every section of the tower as the source lofts it (base, eight segments, crown,
 * spire, ruyi and coin ornaments), the podium mall's shell, the Xinyi Plaza Malls (信義新天地),
 * the Xinyi Skywalk (信義空橋) with its stairs and piers, the 101 west plaza, Four Four South
 * Village (四四南村) and the city lots between them.
 *
 * The source models the mall and the tower as closed volumes. This map opens the podium mall
 * (台北101購物中心) as the centre of the fight and adds the level changes a firefight needs:
 *   A — the mall atrium: a sunken food court (B1) under two galleries (GF and 2F), with a bridge
 *       across the void, shops along both sides, stairs between all three floors, doors north,
 *       south and east, and a B1 passage out to a sunken garden on the east side;
 *   B — the 101 west plaza under the skywalk's spur to the tower, around the sculpture, the taxi
 *       stand and a new MRT exit (捷運台北101/世貿站);
 *   C–E are landmarks bots roam to: the skywalk, the sunken garden and Four Four South Village.
 * SWAT (team 0) deploys in front of the Xinyi Plaza Malls across Xinyi Rd (north); Militia
 * (team 1, Sabotage attackers) on Songzhi Rd by the village (south). Elephant Mountain's foot
 * rises along the east edge, behind the Songren Rd towers.
 *
 * Coordinates: the source's (+x east, +z south, metres), shifted so the playable area is centred on 0.
 */
const AREA = { x0: 655, x1: 925, z0: 62, z1: 350 };
const OX = (AREA.x0 + AREA.x1) / 2, OZ = (AREA.z0 + AREA.z1) / 2;
const HALF_X = (AREA.x1 - AREA.x0) / 2, HALF_Z = (AREA.z1 - AREA.z0) / 2;
/** Sidewalks, plazas and the mall's ground floor stand 15 cm above the asphalt. */
const KERB = 0.15;
const MEDIAN = 0.2;
/** How far past the bounds the city is built as a backdrop. */
const BACKDROP = 55;
/** Sunken floors (the atrium's B1 food court, its passage and the east garden) and the mall's 2F. */
const B1 = -4.35, F2 = 6.65, SKY = 8.05;

type B = MapBuilder;
const X = (x: number) => x - OX, Z = (z: number) => z - OZ;

interface Rect { x0: number; z0: number; x1: number; z1: number }
const rect = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });
const overlaps = (a: Rect, b: Rect) => a.x1 > b.x0 && a.x0 < b.x1 && a.z1 > b.z0 && a.z0 < b.z1;
const within = (x: number, z: number, r: Rect, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;

// ---- The mall's plan (source coordinates) ------------------------------------------------
/** Podium mall shell (its stone base in the source) and the inside of its walls. */
const MALL = rect(764, 167, 798, 253), WALL = 0.6;
const IN = rect(MALL.x0 + WALL, MALL.z0 + WALL, MALL.x1 - WALL, MALL.z1 - WALL);
/** The atrium void, open from the B1 food court to the skylight. */
const PIT = rect(773, 186, 789, 234);
/** B1 passage from the food court out under the east gallery, and the sunken garden it reaches. */
const PASSAGE = rect(789, 203, 803, 213);
const GARDEN = rect(803, 180, 823, 236);
/** Stairwells cut through the 2F floor (GF → 2F flights). */
const NW_WELL = rect(IN.x0, IN.z0, 770, 186), SE_WELL = rect(792, 234, IN.x1, IN.z1);
/** Everything dug below the paving, and the solid fill around it (hides the terrain's blend). */
const DUG = [PIT, PASSAGE, GARDEN];
const FILL = rect(760, 170, 830, 246);

/** Rectangles covering `area` minus `holes`, merged greedily row by row. */
function cover(area: Rect, holes: Rect[]): Rect[] {
  const cut = holes.filter(h => overlaps(h, area));
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
    while (j1 + 1 < zs.length - 1) {
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

// ---- Terrain -------------------------------------------------------------------------------
/** The source's basin hills: flat inside the city box, rising toward each hill outside it (plan.hillHeight). */
function hill(x: number, z: number) {
  const dx = Math.max(CITY.minX - x, 0, x - CITY.maxX), dz = Math.max(CITY.minZ - z, 0, z - CITY.maxZ);
  if (dx <= 0 && dz <= 0) return 0;
  const near = z >= -1030 && x >= -960;
  let h = 0;
  for (const [hx, hz, height, radius, f0, f1] of HILLS) {
    if (near && (hz < -1030 || hx < -960)) continue;
    const q = ((x - hx) ** 2 + (z - hz) ** 2) / radius ** 2;
    if (q >= 9) continue;
    let fade = 1;
    if (f1 !== undefined) {
      if (z >= f1) continue;
      if (z > f0) { const t = (f1 - z) / (f1 - f0); fade = t * t * (3 - 2 * t); }
    }
    h += height * fade * Math.exp(-2.302585 * q);
  }
  const c = Math.min(1, Math.hypot(dx, dz) / 140);
  return h * c * c * (3 - 2 * c);
}

// ---- Helpers (source coordinates) -----------------------------------------------------------
/** Solid box from source-world corners, bottom y0 to top y1. */
function box(b: B, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, style: BlockStyle, color?: number) {
  // Low concrete reads as a jersey barrier (hazard band) in the renderer: planters and kerbs are slab.
  if (style === 'concrete' && y1 - y0 < 1.6) style = 'slab';
  const i = b.box(X((x0 + x1) / 2), y0, Z((z0 + z1) / 2), x1 - x0, y1 - y0, z1 - z0, style);
  return color === undefined ? i : b.paint(i, color);
}
/** Decorative box (no collision) from source-world corners. */
function detail(b: B, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, style: BlockStyle, color?: number) {
  if (style === 'concrete' && y1 - y0 < 1.6) style = 'slab';
  b.detail(X((x0 + x1) / 2), y0, Z((z0 + z1) / 2), x1 - x0, y1 - y0, z1 - z0, style, color);
}
/** Stair flight over a source rectangle rising from y0 to y1 toward dir (0 +x, 1 +z, 2 −x, 3 −z). */
function stairs(b: B, r: Rect, y0: number, y1: number, dir: 0 | 1 | 2 | 3) {
  b.stairs(X((r.x0 + r.x1) / 2), Z((r.z0 + r.z1) / 2), r.x1 - r.x0, r.z1 - r.z0, y0, y1, dir);
}
function sign(b: B, style: SignStyle, x: number, y: number, z: number, facing: number, w: number, h: number, text: string, bg: string, fg: string, sub = '') {
  b.raw({ kind: 'sign', style, x: X(x), y, z: Z(z), rotY: facing, w, h, text, bg, fg, ...(sub ? { sub } : {}) });
}
/** A wall along x or z with door gaps ([from, to] along it), each gap topped by a lintel from `head` up. */
function wallWithGaps(b: B, axis: 'x' | 'z', at: number, from: number, to: number, t: number, y0: number, y1: number, gaps: [number, number][], head: number, style: BlockStyle, color?: number) {
  let cursor = from;
  const seg = (a: number, c: number, ya: number, yb: number) => {
    if (c - a < 0.05 || yb - ya < 0.05) return;
    if (axis === 'x') box(b, a, at - t / 2, c, at + t / 2, ya, yb, style, color);
    else box(b, at - t / 2, a, at + t / 2, c, ya, yb, style, color);
  };
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { seg(cursor, g0, y0, y1); seg(g0, g1, head, y1); cursor = g1; }
  seg(cursor, to, y0, y1);
}
/** Free-standing parapet along a run (1 m: cover to a crouch, a stand shoots over it). */
function parapet(b: B, axis: 'x' | 'z', at: number, from: number, to: number, y: number, color = 0xb8b4ae) {
  if (to - from < 0.2) return;
  if (axis === 'x') box(b, from, at - 0.15, to, at + 0.15, y, y + 1.0, 'slab', color);
  else box(b, at - 0.15, from, at + 0.15, to, y, y + 1.0, 'slab', color);
  // Brushed-steel handrail on top.
  if (axis === 'x') detail(b, from, at - 0.2, to, at + 0.2, y + 1.0, y + 1.08, 'steel', 0xc8ccd0);
  else detail(b, at - 0.2, from, at + 0.2, to, y + 1.0, y + 1.08, 'steel', 0xc8ccd0);
}
const LIGHT = 0xffe2b0, COOL = 0xbfe4ff;

// ---- Streets ---------------------------------------------------------------------------------
type Road = (typeof ROADS)[number];
const carriageway = (r: Road): Rect => {
  const [, , , axis, at, from, to, , hw] = r;
  return axis === 'x' ? rect(from, at - hw, to, at + hw) : rect(at - hw, from, at + hw, to);
};
/** Floor height at a source point: asphalt on a carriageway, else kerb height (sunken floors aside). */
function floorAt(x: number, z: number) {
  if (DUG.some(r => within(x, z, r))) return B1;
  for (const r of ROADS) {
    const c = carriageway(r), off = Math.abs((r[3] === 'x' ? z : x) - r[4]);
    if (within(x, z, c)) return off > r[10] / 2 ? 0 : MEDIAN;
  }
  return KERB;
}

/** Everything inside the built area that is not a carriageway or dug out is paved at kerb height. */
function paving(b: B) {
  // The city box ends at x = 900: Elephant Mountain's slope takes over from there.
  const area = rect(AREA.x0 - BACKDROP, AREA.z0 - BACKDROP, Math.min(CITY.maxX, AREA.x1 + BACKDROP), AREA.z1 + BACKDROP);
  const holes = [...ROADS.map(carriageway), ...DUG, IN];
  for (const r of cover(area, holes)) box(b, r.x0, r.z0, r.x1, r.z1, -0.35, KERB, 'slab', 0xa8a6a2);
  // Asphalt on the carriageways (the terrain beyond the city is the hills' grass).
  for (const road of ROADS) {
    const c = carriageway(road), r = rect(Math.max(c.x0, area.x0), Math.max(c.z0, area.z0), Math.min(c.x1, area.x1), Math.min(c.z1, area.z1));
    if (r.x1 > r.x0 && r.z1 > r.z0) box(b, r.x0, r.z0, r.x1, r.z1, -0.35, 0, 'slab', 0x3c3d42);
  }
  // The mall's floor: polished stone instead of street paving.
  for (const r of cover(IN, DUG)) box(b, r.x0, r.z0, r.x1, r.z1, -0.35, KERB, 'slab', 0xe2ddd2);
}

/** Medians (planted on Songren Rd), lane lines and zebra crossings, like the source's street paint. */
function streets(b: B) {
  const lo = (r: Road) => r[3] === 'x' ? Math.max(r[5], AREA.x0 - BACKDROP) : Math.max(r[5], AREA.z0 - BACKDROP);
  const hi = (r: Road) => r[3] === 'x' ? Math.min(r[6], AREA.x1 + BACKDROP) : Math.min(r[6], AREA.z1 + BACKDROP);
  const WHITE = 0xe4e2da, YELLOW = 0xd8a830;
  const mark = (x0: number, z0: number, x1: number, z1: number, color: number) =>
    b.raw({ kind: 'marking', x: X((x0 + x1) / 2), y: 0.012, z: Z((z0 + z1) / 2), w: Math.abs(x1 - x0), d: Math.abs(z1 - z0), color });
  for (const r of ROADS) {
    const [, , , axis, at, , , , hw, , median, lanes, , , treeMedian] = r;
    const a0 = lo(r), a1 = hi(r);
    if (a1 <= a0) continue;
    const crossings = ROADS.filter(c => c[3] !== axis && c[4] > a0 - 30 && c[4] < a1 + 30 && at >= c[5] - 0.5 && at <= c[6] + 0.5)
      .map(c => ({ at: c[4], half: c[8] })).sort((p, q) => p.at - q.at);
    const runs: [number, number][] = [];
    let cursor = a0;
    for (const c of crossings) { const g0 = c.at - c.half - 3.5, g1 = c.at + c.half + 3.5; if (g0 > cursor) runs.push([cursor, Math.min(g0, a1)]); cursor = Math.max(cursor, g1); }
    if (cursor < a1) runs.push([cursor, a1]);
    const along = (s0: number, s1: number, o0: number, o1: number, color: number) =>
      axis === 'x' ? mark(s0, at + o0, s1, at + o1, color) : mark(at + o0, s0, at + o1, s1, color);
    for (const [s0, s1] of runs) {
      if (s1 - s0 < 1) continue;
      if (median > 0) {
        const m = median / 2;
        if (axis === 'x') box(b, s0, at - m, s1, at + m, -0.35, MEDIAN, 'slab', 0x9a9894);
        else box(b, at - m, s0, at + m, s1, -0.35, MEDIAN, 'slab', 0x9a9894);
        if (treeMedian) for (let s = s0 + 5; s < s1 - 4; s += 11) {
          const [tx, tz] = axis === 'x' ? [s, at] : [at, s];
          if (within(tx, tz, AREA, 20)) b.tree(X(tx), Z(tz), 0.75, 1);
        }
      } else along(s0, s1, -0.08, 0.08, YELLOW);
      for (const side of [-1, 1]) {
        const inner = median / 2, lane = (hw - inner) / lanes;
        for (let k = 1; k < lanes; k++) {
          const o = side * (inner + k * lane);
          for (let s = s0 + 1; s + 3 < s1; s += 9) along(s, s + 3, o - 0.07, o + 0.07, WHITE);
        }
        const edge = side * (hw - 0.35);
        along(s0, s1, edge - 0.07, edge + 0.07, WHITE);
      }
    }
    for (const c of crossings) for (const side of [-1, 1]) {
      const s = c.at + side * (c.half + 2.2);
      if (s < a0 || s > a1) continue;
      for (let o = -hw + 0.6; o < hw - 0.6; o += 1.1) {
        if (median > 0 && Math.abs(o + 0.3) < median / 2) continue;
        along(s - 1.6, s + 1.6, o, o + 0.6, WHITE);
      }
    }
  }
}

// ---- City lots ----------------------------------------------------------------------------------
/**
 * The source's generic lots, given facade depth: glass curtain walls on Xinyi's office towers
 * (walk-up plaster below ten storeys), a crown and parapet, mullion fins, a lit canopy over the
 * street-front ground floor, and rooftop plant, water tanks and aviation lights.
 */
function lots(b: B) {
  const near = rect(AREA.x0 - 25, AREA.z0 - 25, AREA.x1 + 25, AREA.z1 + 25);
  let masts = 0;
  LOTS.forEach(([type, , x0, z0, x1, z1, gH, top, tint, , volumes], li) => {
    if (!overlaps(rect(x0, z0, x1, z1), rect(AREA.x0 - BACKDROP, AREA.z0 - BACKDROP, AREA.x1 + BACKDROP, AREA.z1 + BACKDROP))) return;
    const tall = top >= 30, close = overlaps(rect(x0, z0, x1, z1), near);
    const vols = volumes.split(';').map(v => v.split(' ').map(Number));
    for (const [vx0, vz0, vx1, vz1, y0, y1, column] of vols) {
      if (column) { box(b, vx0, vz0, vx1, vz1, y0, y1, 'concrete', 0xb8b2a8); continue; }
      const style: BlockStyle = tall ? 'curtain' : 'facade';
      box(b, vx0, vz0, vx1, vz1, y0, y1, style, tall ? glassTint(tint) : tint);
      // Crown: a parapet band standing proud of the wall.
      detail(b, vx0 - 0.2, vz0 - 0.2, vx1 + 0.2, vz1 + 0.2, y1 - 0.9, y1 + 0.5, 'slab', tall ? 0x8a9298 : 0xc8c2b6);
      if (!close) continue;
      // Mullion fins up the glass, one every 4.5 m on each face, from the lobby to the crown.
      if (tall) for (const [a0, a1, at, alongX, out] of [[vx0, vx1, vz0, true, -1], [vx0, vx1, vz1, true, 1], [vz0, vz1, vx0, false, -1], [vz0, vz1, vx1, false, 1]] as [number, number, number, boolean, number][]) {
        const n = Math.max(1, Math.round((a1 - a0) / 4.5));
        for (let k = 1; k < n; k++) {
          const s = a0 + (k * (a1 - a0)) / n, f0 = at + out * 0.02, f1 = at + out * 0.5;
          if (alongX) detail(b, s - 0.12, Math.min(f0, f1), s + 0.12, Math.max(f0, f1), gH + 0.4, y1 - 0.9, 'steel', 0x5a646a);
          else detail(b, Math.min(f0, f1), s - 0.12, Math.max(f0, f1), s + 0.12, gH + 0.4, y1 - 0.9, 'steel', 0x5a646a);
        }
      }
    }
    if (!close) return;
    // Street canopy and its lit edge over every side that faces a road (the source's street flags
    // are the sides on the lot's block edge; a lot touching a road's sidewalk counts).
    const [bx0, bz0, bx1, bz1] = [x0, z0, x1, z1];
    const onRoad = (x: number, z: number) => ROADS.some(r => { const c = carriageway(r); return within(x, z, rect(c.x0, c.z0, c.x1, c.z1), 8); });
    const canopy = (cx0: number, cz0: number, cx1: number, cz1: number) => {
      detail(b, cx0, cz0, cx1, cz1, gH - 0.1, gH + 0.25, 'steel', 0x3a3e44);
      detail(b, cx0, cz0, cx1, cz1, gH - 0.16, gH - 0.1, 'neon', li % 3 ? LIGHT : COOL);
    };
    if (type !== 'low') {
      if (onRoad((bx0 + bx1) / 2, bz0 - 2)) canopy(bx0 + 0.5, bz0 - 1.8, bx1 - 0.5, bz0);
      if (onRoad((bx0 + bx1) / 2, bz1 + 2)) canopy(bx0 + 0.5, bz1, bx1 - 0.5, bz1 + 1.8);
      if (onRoad(bx0 - 2, (bz0 + bz1) / 2)) canopy(bx0 - 1.8, bz0 + 0.5, bx0, bz1 - 0.5);
      if (onRoad(bx1 + 2, (bz0 + bz1) / 2)) canopy(bx1, bz0 + 0.5, bx1 + 1.8, bz1 - 0.5);
    }
    // Rooftop: plant room on the towers (and a beacon on the tallest), water tanks on walk-ups.
    const main = vols.filter(v => !v[6]).sort((p, q) => q[5] - p[5])[0];
    if (!main) return;
    const [mx0, mz0, mx1, mz1, , my1] = main, cx = (mx0 + mx1) / 2, cz = (mz0 + mz1) / 2, w = mx1 - mx0, d = mz1 - mz0;
    if (tall) {
      detail(b, cx - w * 0.22, cz - d * 0.22, cx + w * 0.22, cz + d * 0.22, my1, my1 + 3.2, 'steel', 0x6a7278);
      if (my1 > 90 && masts++ < 3) b.raw({ kind: 'mast', x: X(cx), y: my1 + 3.2, z: Z(cz), height: 10 });
      else detail(b, cx - 0.4, cz - 0.4, cx + 0.4, cz + 0.4, my1 + 3.2, my1 + 3.6, 'neon', 0xff3a2a);
    } else {
      b.raw({ kind: 'cylinder', x: X(cx - w * 0.2), y: my1, z: Z(cz), radius: 0.9, height: 1.8, axis: 'y', style: 'steel', color: 0xd8d4c8 });
      detail(b, cx, cz - d * 0.3, cx + w * 0.35, cz + d * 0.1, my1, my1 + 2.4, 'roof', 0x9aa0a4);
    }
  });
}
/** Office glass tinted from the source's facade colour: cool blue-greens, never chalk white. */
function glassTint(c: number) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, bl = c & 255;
  const mix = (v: number, t: number) => Math.round(v * 0.45 + t * 0.55);
  return (mix(r, 0x7a) << 16) | (mix(g, 0xa4) << 8) | mix(bl, 0xb4);
}

// ---- Taipei 101 ------------------------------------------------------------------------------
/** The tower's glass: the source paints it near-white under a green-blue texture; ours is tinted. */
const GLASS_101 = 0x8cc8b4;

function tower(b: B) {
  const { cx, cz } = TOWER;
  const top = TOWER_LOFTS[TOWER_LOFTS.length - 1][1];
  for (const [y0, y1, h0, n0, h1, n1, color, glow] of TOWER_LOFTS) {
    // Lit bands at each segment's top and the crown's rings; metal caps; glass everywhere else.
    const lit = glow >= 2.5, glass = color === 0xe6fbf6;
    const style: BlockStyle = lit ? 'neon' : glass ? 'curtain' : 'steel';
    const tint = lit ? 0xfff0c8 : glass ? (glow > 1 ? 0xa8e0cc : GLASS_101) : color;
    b.loft(X(cx), Z(cz), y0, y1, h0, n0, h1, n1, style, tint, y1 === top);
  }
  for (const [x, z, r0, r1, y0, y1, color, glow] of TOWER_CYLINDERS) {
    if (y0 < 10) continue;
    b.raw({ kind: 'cylinder', x: X(x), y: y0, z: Z(z), radius: r0, top: r1, height: y1 - y0, axis: 'y', style: glow >= 2 ? 'neon' : 'steel', color: glow >= 2 ? 0xfff0c8 : color });
  }
  for (const [x, y, z, r] of TOWER_LAMPS) b.raw({ kind: 'ball', x: X(x), y, z: Z(z), radius: r, style: 'neon', color: 0xff3020 });
  for (const [x, y, z, nx, ny, nz, rx, ry, depth, color, glow] of TOWER_ORNAMENTS) {
    // Ruyi and coin ornaments in gold (the coins' red centres), the segment corner ornaments in metal.
    const gold = color === 15252309, red = color === 12869968;
    // Floodlit at night: the gold reads warm, the red centres stay paint.
    if (red) b.disc(X(x), y, Z(z), nx, ny, nz, rx, ry, depth, 'slab', 0xa83a2c);
    else b.disc(X(x), y, Z(z), nx, ny, nz, rx, ry, depth, 'neon', gold ? 0x8a6a2a : 0x4a5a5a);
  }
  // Granite piers at the base are solid; the lit cubes on the segments' corners are lamps.
  for (const [x0, y0, z0, x1, y1, z1, color, glow] of TOWER_BOXES) {
    if (y0 < 1) box(b, x0, z0, x1, z1, 0, y1, 'concrete', color);
    else detail(b, x0, z0, x1, z1, y0, y1, glow > 0 ? 'neon' : 'steel', glow > 0 ? 0xfff0c8 : color);
  }
  // Collision: the base's notched square, stepped in with its taper; each segment and the crown inside its glass.
  const notched = (y0: number, y1: number, n: number, r: number) => {
    box(b, cx - n, cz - (n - 2 * r), cx + n, cz + (n - 2 * r), y0, y1, 'invisible');
    box(b, cx - (n - r), cz - (n - r), cx + (n - r), cz + (n - r), y0, y1, 'invisible');
    box(b, cx - (n - 2 * r), cz - n, cx + (n - 2 * r), cz + n, y0, y1, 'invisible');
  };
  const base = TOWER_LOFTS.filter(l => l[1] <= TOWER.baseTop + 0.01 && l[1] > l[0]);
  for (const [y0, y1, , , h1, n1] of base) notched(y0 < 1 ? 0 : y0, y1, h1, n1);
  for (const [y0, y1, h0] of TOWER_LOFTS.filter(l => l[0] >= TOWER.baseTop - 0.01 && l[2] === TOWER.segHalf0 && l[1] > l[0])) {
    const s = h0 - 0.5;
    box(b, cx - s, cz - s, cx + s, cz + s, y0, y1 + 34 * 0.38, 'invisible');
  }
  box(b, cx - 12, cz - 12, cx + 12, cz + 12, TOWER.baseTop + 8 * TOWER.segH, TOWER.crownTop, 'invisible');
  // The skywalk's door into the tower (closed), and the north entrance's glass doors under its canopy.
  detail(b, 700.15, 192, 700.45, 197, SKY, SKY + 3.4, 'curtain', 0x9ad0c8);
  detail(b, 724, 181.6, 736, 182.05, KERB, 5.6, 'curtain', 0xb8e0d8);
  detail(b, 724, 181.5, 736, 181.6, 5.6, 5.75, 'neon', LIGHT);
}

/** The 101 north plaza (the source's planters, benches, fountains, canopy and vertical sign). */
function plaza(b: B) {
  for (const [x0, y0, z0, x1, y1, z1, color, glow] of PLAZA_101) {
    if (y1 < 0.3) continue;                                   // paving
    if (overlaps(rect(x0, z0, x1, z1), rect(MALL.x0 + 1, MALL.z0 + 1, MALL.x1 - 1, MALL.z1 - 1))) continue; // the mall (built below)
    if (x0 >= 699 && x1 <= 765 && z0 >= 243 && y1 > 10) { box(b, x0, z0, x1, z1, 0, y1, 'curtain', 0x9ec4c8); continue; } // the low wing
    if (glow >= 2) detail(b, x0, z0, x1, z1, y0, y1, 'neon', LIGHT);
    else detail(b, x0, z0, x1, z1, y0, y1, 'steel', color);    // the entrance canopy
  }
  for (const [x, z, r0, , y0, y1, color] of TOWER_CYLINDERS) if (y0 < 10) b.cylinder(X(x), y0, Z(z), r0, y1 - y0, 'steel', 'y', color);
}

// ---- Colliders of the source district ------------------------------------------------------------
/** Where the source's own colliders give way to this map's buildings. */
const REPLACED = [rect(MALL.x0 - 1.5, MALL.z0 - 1.5, MALL.x1 + 1.5, MALL.z1 + 1.5), rect(GARDEN.x0 - 3, GARDEN.z0 - 3, GARDEN.x1 + 3, GARDEN.z1 + 3)];

function district(b: B, mallFootprints: Rect[]) {
  const inBuilding = (x0: number, z0: number, x1: number, z1: number) => mallFootprints.some(f => overlaps(rect(x0, z0, x1, z1), rect(f.x0 + 0.3, f.z0 + 0.3, f.x1 - 0.3, f.z1 - 0.3)));
  for (const [x0, z0, x1, z1, y0, y1, tag, src] of BOXES) {
    const r = rect(x0, z0, x1, z1);
    if (src === 'taipei101' && (tag === 'landmark' || tag === 'building')) continue; // tower and mall: built here
    if (src === 'xinyi-mall' && tag === 'building') continue;                        // from the malls' paint
    if (src === 'skywalk' && (tag === 'stairs' || tag === 'skybridge')) continue;    // flights and decks: below
    if (REPLACED.some(q => overlaps(r, q)) || inBuilding(x0, z0, x1, z1)) continue;
    const h = y1 - y0;
    switch (tag) {
      case 'rail': box(b, x0, z0, x1, z1, y0, y1, 'glass'); detail(b, x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, y1, y1 + 0.08, 'steel', 0xc8ccd0); break;
      case 'bridge': box(b, x0, z0, x1, z1, y0 - 0.2, y1, 'slab', 0xd9dde0); break;
      case 'bench': box(b, x0, z0, x1, z1, 0, y1, 'wood', 0x8a6a4a); break;
      case 'building': box(b, x0, z0, x1, z1, 0, y1, 'brick', 0x8a5a48); break;
      case 'wall':
        if (src === 'skywalk') box(b, x0, z0, x1, z1, y0, y1, 'concrete', 0xb8c0c4);
        else if (h > 6) box(b, x0, z0, x1, z1, 0, y1, 'steel', 0xc83a3a);           // the plaza sculpture
        else if (h > 4) { box(b, x0, z0, x1, z1, 0, y1, 'concrete', 0x2b2f33); }   // the vertical 台北101 sign
        else box(b, x0, z0, x1, z1, Math.min(0, y0), y1, src === 'village' ? 'brick' : 'concrete', src === 'village' ? 0x9a5a44 : 0x9a968e);
        break;
      default: box(b, x0, z0, x1, z1, Math.min(0, y0), y1, 'concrete');
    }
  }
  for (const [x, z, r, y0, y1, tag, src] of CIRCLES) {
    if (REPLACED.some(q => within(x, z, q)) || inBuilding(x - r, z - r, x + r, z + r)) continue;
    switch (tag) {
      case 'tree': b.tree(X(x), Z(z), Math.max(0.6, (y1 + 0.5) / 5.5), src === 'village' ? 0 : 1); break;
      case 'pillar': b.cylinder(X(x), y0, Z(z), r, y1 - y0, 'concrete', 'y', 0xc4c8cc); break;
      case 'wall':
        if (r > 3) { b.cylinder(X(x), 0, Z(z), r, y1, 'concrete', 'y', 0x9a968e); b.water(X(x), y1 - 0.12, Z(z), r * 1.35, r * 1.35); }
        else b.cylinder(X(x), 0, Z(z), r, y1, 'concrete', 'y', 0x7a766e);
        break;
      default: {
        // Poles, bollards and lamp posts: a thin post (lamps get a glowing head).
        const s = Math.max(0.18, r * 1.6);
        box(b, x - s / 2, z - s / 2, x + s / 2, z + s / 2, Math.min(0, y0), y1, 'steel', 0x5a5e62);
        if (tag === 'pole' && y1 > 4) detail(b, x - 0.25, z - 0.25, x + 0.25, z + 0.25, y1, y1 + 0.18, 'neon', LIGHT);
      }
    }
  }
}

/** The Xinyi Skywalk: decks on piers, glass rails, a canopy roof, its trusses over the roads and its stairs. */
function skywalk(b: B) {
  for (const [x0, z0, x1, z1, y, tag] of DECKS) {
    if (!overlaps(rect(x0, z0, x1, z1), rect(AREA.x0 - BACKDROP, AREA.z0 - BACKDROP, AREA.x1 + BACKDROP, AREA.z1 + BACKDROP))) continue;
    box(b, x0, z0, x1, z1, y - 0.8, y, 'slab', tag === 'bridge' ? 0xd9dde0 : 0xcfd4d6);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, wide = x1 - x0 > z1 - z0;
    detail(b, wide ? x0 + 0.5 : mx - 0.12, wide ? mz - 0.12 : z0 + 0.5, wide ? x1 - 0.5 : mx + 0.12, wide ? mz + 0.12 : z1 - 0.5, y - 0.82, y - 0.8, 'neon', COOL);
    // Over a carriageway the deck rides on a truss.
    for (const r of ROADS) {
      const c = carriageway(r), alongZ = x1 - x0 < z1 - z0;
      if (!overlaps(rect(x0, z0, x1, z1), c)) continue;
      if (alongZ && r[3] === 'x') b.raw({ kind: 'truss', x0: X((x0 + x1) / 2), y0: y - 1.9, z0: Z(Math.max(z0, c.z0 - 3)), x1: X((x0 + x1) / 2), y1: y - 1.9, z1: Z(Math.min(z1, c.z1 + 3)), w: x1 - x0 - 0.4, h: 1.1, color: 0xc8ccd0 });
    }
    if (tag !== 'skybridge') continue;
    // Canopy: slim posts along the rails and a glazed roof 3.3 m over the deck.
    const alongX = x1 - x0 > z1 - z0, len = alongX ? x1 - x0 : z1 - z0;
    for (let s = 3; s < len - 1; s += 6) for (const side of [0, 1]) {
      const px = alongX ? x0 + s : side ? x1 - 0.2 : x0 + 0.2, pz = alongX ? (side ? z1 - 0.2 : z0 + 0.2) : z0 + s;
      detail(b, px - 0.08, pz - 0.08, px + 0.08, pz + 0.08, y + 1.15, y + 3.3, 'steel', 0xb8bec2);
    }
    detail(b, x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3, y + 3.3, y + 3.42, 'glass');
    detail(b, x0 - 0.35, z0 - 0.35, x1 + 0.35, z1 + 0.35, y + 3.42, y + 3.5, 'steel', 0xd8dcde);
  }
  for (const [x0, z0, x1, z1, low, high, dir] of SLOPES) stairs(b, rect(x0, z0, x1, z1), low, high, dir as 0 | 1 | 2 | 3);
  // 信義空橋 banner on the span over Xinyi Rd (the source names the skywalk on its spans).
  for (const f of [0, Math.PI]) sign(b, 'board', f ? 665.6 : 659.2, SKY + 2.1, 120, f ? Math.PI / 2 : -Math.PI / 2, 5.6, 1.05, '信義空橋', '#ffffff', '#1a3d6d', 'XINYI SKYWALK · 台北101 ▸');
}

// ---- The 101 mall ---------------------------------------------------------------------------------
function mall(b: B) {
  const STONE = 0xcfc8bb, TOP = 28.18, ROOF = 32.18, CEIL = 13;
  // Ground floor shell (stone base): doors north, south and east (GF), the B1 passage under the east wall.
  wallWithGaps(b, 'x', MALL.z0 + WALL / 2, MALL.x0, MALL.x1, WALL, KERB, 6.3, [[773, 789]], 4.6, 'concrete', STONE);
  wallWithGaps(b, 'x', MALL.z1 - WALL / 2, MALL.x0, MALL.x1, WALL, KERB, 6.3, [[775, 787]], 4.6, 'concrete', STONE);
  box(b, MALL.x0, IN.z0, IN.x0, IN.z1, KERB, 6.3, 'concrete', STONE);
  wallWithGaps(b, 'z', MALL.x1 - WALL / 2, IN.z0, IN.z1, WALL, KERB, 6.3, [[214, 222]], 4.6, 'concrete', STONE);
  // Upper storeys: glass from 2F to the crown, as the source paints them, with its stone bands.
  for (const [x0, z0, x1, z1] of [[MALL.x0, MALL.z0, MALL.x1, MALL.z0 + WALL], [MALL.x0, MALL.z1 - WALL, MALL.x1, MALL.z1], [MALL.x0, IN.z0, IN.x0, IN.z1], [IN.x1, IN.z0, MALL.x1, IN.z1]])
    box(b, x0, z0, x1, z1, 6.3, TOP, 'curtain', 0xa8c8d0);
  for (const [x0, y0, z0, x1, y1, z1, color] of PLAZA_101) if (y0 > 6 && x0 > 760 && z1 - z0 > 80) {
    if (y1 - y0 < 1) {
      // Bands round the facade (the source draws them as plates through the building).
      for (const [a0, c0, a1, c1] of [[x0, z0, x1, MALL.z0], [x0, MALL.z1, x1, z1], [x0, MALL.z0, MALL.x0, MALL.z1], [MALL.x1, MALL.z0, x1, MALL.z1]])
        detail(b, a0, c0, a1, c1, y0, y1, 'concrete', color);
    }
    else if (y0 > 28) box(b, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, y0, y1, 'concrete', color); // crown
  }
  // Skylight over the atrium, set into the roof.
  for (const r of cover(rect(MALL.x0, MALL.z0, MALL.x1, MALL.z1), [PIT])) box(b, r.x0, r.z0, r.x1, r.z1, TOP - 0.3, TOP, 'slab', 0x9a9690);
  box(b, PIT.x0, PIT.z0, PIT.x1, PIT.z1, TOP - 0.1, TOP, 'glass');
  for (let z = PIT.z0 + 4; z < PIT.z1; z += 4) detail(b, PIT.x0, z - 0.1, PIT.x1, z + 0.1, TOP - 0.4, TOP - 0.1, 'steel', 0xd0d4d8);

  // Entrances: glass doors set back in the openings, canopies and the 台北101購物中心 signs.
  for (const [x0, x1, z, out] of [[773, 789, MALL.z0, -1], [775, 787, MALL.z1, 1]] as [number, number, number, number][]) {
    detail(b, x0, Math.min(z, z + out * 4.5), x1, Math.max(z, z + out * 4.5), 4.9, 5.25, 'steel', 0x2e3236);
    detail(b, x0, Math.min(z + out * 4.3, z + out * 4.5), x1, Math.max(z + out * 4.3, z + out * 4.5), 4.75, 4.9, 'neon', LIGHT);
    detail(b, x0, z - 0.05, x1, z + 0.05, 4.6, 6.3, 'curtain', 0xc8e0e8);
  }
  detail(b, MALL.x1, 214, MALL.x1 + 3.5, 222, 4.9, 5.25, 'steel', 0x2e3236);
  for (const [key, x, y, z, w, h, facing] of SIGNS) {
    if (key !== 'mall101' && key !== 'taipei101') continue;
    const [text, sub, bg, fg] = SIGN_ART[key];
    sign(b, 'board', x, y, z, facing, w, h, text, bg, fg, sub);
  }
  sign(b, 'board', 781, 5.9, MALL.z1 + 0.05, Math.PI, 10, 1.1, '台北101購物中心', '#16191c', '#f5efe2', 'TAIPEI 101 MALL · SOUTH');
  sign(b, 'board', MALL.x1 + 0.05, 5.9, 218, Math.PI / 2, 7, 1.0, '台北101購物中心', '#16191c', '#f5efe2', 'EAST GARDEN 下沉花園');

  // B1: the food court floor in the atrium, the passage and (below) the sunken garden.
  for (const r of [PIT, PASSAGE]) box(b, r.x0, r.z0, r.x1, r.z1, B1 - 0.25, B1, 'slab', 0xd8cfc0);
  // Retaining walls of the dig, faced in stone where they show (the fill behind hides the terrain).
  for (const r of cover(FILL, DUG)) box(b, r.x0, r.z0, r.x1, r.z1, -5.6, -0.35, 'concrete', 0x9a948a);
  // Stairs between B1 and GF at both ends of the atrium.
  stairs(b, rect(777, PIT.z0, 785, PIT.z0 + 9), B1, KERB, 3);
  stairs(b, rect(777, PIT.z1 - 9, 785, PIT.z1), B1, KERB, 1);
  // GF parapets round the void, open where the stairs come up and where the passage leaves.
  parapet(b, 'x', PIT.z0 - 0.15, PIT.x0 - 0.3, 777, KERB); parapet(b, 'x', PIT.z0 - 0.15, 785, PIT.x1 + 0.3, KERB);
  parapet(b, 'x', PIT.z1 + 0.15, PIT.x0 - 0.3, 777, KERB); parapet(b, 'x', PIT.z1 + 0.15, 785, PIT.x1 + 0.3, KERB);
  parapet(b, 'z', PIT.x0 - 0.15, PIT.z0, PIT.z1, KERB); parapet(b, 'z', PIT.x1 + 0.15, PIT.z0, PIT.z1, KERB);
  // Stone facing on the void's B1 walls, and the stairs' brushed-steel balustrades.
  for (const [x0, z0, x1, z1] of [[PIT.x0 - 0.05, PIT.z0, PIT.x0, PIT.z1], [PIT.x1, PIT.z0, PIT.x1 + 0.05, PASSAGE.z0], [PIT.x1, PASSAGE.z1, PIT.x1 + 0.05, PIT.z1]])
    detail(b, x0, z0, x1, z1, B1, -0.35, 'concrete', 0xd8d0c2);
  for (const z of [PIT.z0, PIT.z1 - 9]) for (const x of [776.7, 785]) box(b, x, z, x + 0.3, z + 9, B1, KERB + 1, 'glass');

  // Food court: tables in two rows, a planter ring round the centre, a kiosk at each end.
  for (const x of [775.5, 786.5]) for (const z of [199, 203.5, 216.5, 221]) box(b, x - 0.9, z - 0.9, x + 0.9, z + 0.9, B1, B1 + 0.95, 'wood', 0x8a5a3a);
  box(b, 779, 207, 783, 213, B1, B1 + 0.9, 'concrete', 0x6a6460);
  b.tree(X(781), Z(210), 0.6, 1);
  box(b, 774, 225.5, 776.5, 228.5, B1, B1 + 1.2, 'steel', 0xc8a24a);
  box(b, 785.5, 191.5, 788, 194.5, B1, B1 + 1.2, 'steel', 0x3a8a8a);
  for (const [x, z, f, name] of [[775.25, 227, Math.PI / 2, '鼎泰瘋 小籠包'], [786.75, 193, -Math.PI / 2, '一蘭蘭拉麵']] as [number, number, number, string][])
    sign(b, 'board', x + Math.sin(f) * 1.3, B1 + 2.1, z, f, 2.6, 0.7, name, '#2a1a12', '#ffd890');
  // B1 lighting strips under the GF galleries' edge.
  for (const [x0, z0, x1, z1] of [[PIT.x0, PIT.z0, PIT.x0 + 0.1, PIT.z1], [PIT.x1 - 0.1, PIT.z0, PIT.x1, PIT.z1]]) detail(b, x0, z0, x1, z1, -0.7, -0.6, 'neon', LIGHT);

  // GF shops: units along both side walls, open to the galleries, with counters and displays.
  const names = SHOPS.filter(s => ['fashion', 'luxury', 'optical', 'telecom', 'dessert', 'coffee', 'bakery', 'pharmacy', 'tea', 'flowers'].includes(s[0]));
  let n = 0;
  const shopRow = (x0: number, x1: number, front: number, facing: number, cuts: number[], skip: [number, number][]) => {
    for (const c of cuts) box(b, x0, c - 0.15, x1, c + 0.15, KERB, 6.3, 'concrete', 0xe8e2d8);
    const edges = [PIT.z0, ...cuts, PIT.z1];
    for (let i = 0; i < edges.length - 1; i++) {
      const z0 = edges[i], z1 = edges[i + 1], zc = (z0 + z1) / 2;
      if (skip.some(([s0, s1]) => zc > s0 && zc < s1)) continue;
      const [, category, list] = names[n++ % names.length];
      // Fascia and its sign over the open front, a counter and a display table inside.
      detail(b, Math.min(front, front + facing * 0.3), z0 + 0.15, Math.max(front, front + facing * 0.3), z1 - 0.15, 3.6, 6.3, 'concrete', 0x2a2c30);
      sign(b, 'board', front + facing * 0.32, 4.6, zc, facing > 0 ? Math.PI / 2 : -Math.PI / 2, Math.min(6.5, z1 - z0 - 1.5), 1.1, list[n % list.length], '#141618', '#f4ead8', category);
      const back = facing > 0 ? x0 : x1;
      box(b, back + facing * 0.6, z0 + 1.2, back + facing * 1.4, z1 - 1.2, KERB, 1.05, 'wood', 0x6a4a34);
      box(b, back + facing * 2.6, zc - 1.1, back + facing * 3.6, zc + 1.1, KERB, 0.95, 'steel', 0xd8d4cc);
      detail(b, Math.min(back, front), z0 + 0.4, Math.max(back, front), z1 - 0.4, 6.0, 6.1, 'neon', i % 2 ? LIGHT : 0xfff6e8);
    }
  };
  shopRow(IN.x0, 769.6, 769.6, 1, [195.6, 205.2, 214.8, 224.4], []);
  shopRow(792.4, IN.x1, 792.4, -1, [195.6, PASSAGE.z0, 223], [[213, 223]]);
  // The east door's corridor between the shops.
  box(b, 792.4, 222.6, IN.x1, 223.4, KERB, 6.3, 'concrete', 0xe8e2d8);

  // North lobby: information desk and planters; south lobby: a display car on a plinth and benches.
  b.cylinder(X(781), KERB, Z(176), 2.2, 1.1, 'concrete', 'y', 0xe8e2d8);
  sign(b, 'board', 781, 2.2, 173.75, 0, 3.6, 0.8, '服務台', '#1a1d22', '#e9f1f5', 'INFORMATION');
  for (const x of [774.5, 787.5]) box(b, x - 1.2, 179.5, x + 1.2, 181.9, KERB, 0.9, 'concrete', 0x6a6460);
  for (const x of [774.5, 787.5]) b.tree(X(x), Z(180.7), 0.45, 1);
  box(b, 777, 241, 785, 245.5, KERB, 0.5, 'concrete', 0x2a2c30);
  box(b, 777.8, 241.6, 784.2, 244.9, 0.5, 1.75, 'steel', 0xc81e28);
  for (const x of [768, 789.5]) box(b, x - 1.4, 248.5, x + 1.4, 249.3, KERB, 0.55, 'wood', 0x8a6a4a);

  // 2F: galleries round the void on a slab over the ground floor, stairwells cut through it.
  const slab = [rect(770, IN.z0, IN.x1, PIT.z0), rect(IN.x0, PIT.z0, PIT.x0, IN.z1), rect(PIT.x0, PIT.z1, 792, IN.z1), rect(PIT.x1, PIT.z0, IN.x1, PIT.z1)];
  for (const r of slab) box(b, r.x0, r.z0, r.x1, r.z1, F2 - 0.35, F2, 'slab', 0xe2ddd2);
  // The bridge across the void, over the food court.
  box(b, PIT.x0, 208, PIT.x1, 212, F2 - 0.35, F2, 'slab', 0xe2ddd2);
  for (const z of [208.15, 211.85]) parapet(b, 'x', z, PIT.x0, PIT.x1, F2);
  // 2F parapets round the void and the stairwells.
  parapet(b, 'x', PIT.z0 - 0.15, PIT.x0 - 0.3, PIT.x1 + 0.3, F2); parapet(b, 'x', PIT.z1 + 0.15, PIT.x0 - 0.3, PIT.x1 + 0.3, F2);
  parapet(b, 'z', PIT.x0 - 0.15, PIT.z0, 208, F2); parapet(b, 'z', PIT.x0 - 0.15, 212, PIT.z1, F2);
  parapet(b, 'z', PIT.x1 + 0.15, PIT.z0, 208, F2); parapet(b, 'z', PIT.x1 + 0.15, 212, PIT.z1, F2);
  parapet(b, 'z', NW_WELL.x1 + 0.15, IN.z0, 173, F2); parapet(b, 'x', 173.5, 765.3, NW_WELL.x1 + 0.3, F2);
  parapet(b, 'z', SE_WELL.x0 - 0.15, 247, IN.z1, F2); parapet(b, 'x', 246.5, SE_WELL.x0 - 0.3, 796.7, F2);
  // GF → 2F flights in the stairwells (escalator-width), landing on the west and east galleries.
  stairs(b, rect(765.3, 174, 769.3, PIT.z0), KERB, F2, 1);
  stairs(b, rect(792.7, PIT.z1, 796.7, 246), KERB, F2, 3);
  for (const x of [765.1, 769.3]) box(b, x, 174, x + 0.2, PIT.z0, KERB, F2 + 1, 'glass');
  for (const x of [792.5, 796.7]) box(b, x, PIT.z1, x + 0.2, 246, KERB, F2 + 1, 'glass');
  // 2F cover: kiosks, a café counter, benches and planters along the galleries.
  for (const [x0, z0, x1, z1, h, style, color] of [
    [766, 196, 768.5, 199, 1.2, 'steel', 0x8a2a4a], [766, 222, 768.5, 225, 1.2, 'steel', 0x2a5a8a], [793.5, 190, 796, 193, 1.2, 'steel', 0x3a7a5a],
    [793.5, 226, 796, 229, 1.2, 'steel', 0x7a5a2a], [776, 170, 786, 171.2, 1.05, 'wood', 0x6a4a34], [772, 240, 776, 241.2, 0.55, 'wood', 0x8a6a4a],
    [786, 249, 790, 250.2, 0.55, 'wood', 0x8a6a4a], [781, 238, 783.5, 240.5, 0.9, 'concrete', 0x6a6460],
  ] as [number, number, number, number, number, BlockStyle, number][]) box(b, x0, z0, x1, z1, F2, F2 + h, style, color);
  sign(b, 'board', 781, F2 + 2.1, 170.5, Math.PI, 5, 0.9, '路易沙咖啡', '#3a2416', '#ffe2b0', 'COFFEE · 2F');
  // Upper storeys (3F–5F) round the void: closed floors whose inner faces are lit shopfronts.
  for (const r of [rect(IN.x0, IN.z0, IN.x1, PIT.z0), rect(IN.x0, PIT.z0, PIT.x0, PIT.z1), rect(IN.x0, PIT.z1, IN.x1, IN.z1), rect(PIT.x1, PIT.z0, IN.x1, PIT.z1)])
    box(b, r.x0, r.z0, r.x1, r.z1, CEIL, TOP - 0.3, 'curtain', 0xd8c8a8);
  for (let y = CEIL + 4.4; y < TOP - 1; y += 4.4) for (const [x0, z0, x1, z1] of [[PIT.x0 - 0.4, PIT.z0 - 0.4, PIT.x1 + 0.4, PIT.z0], [PIT.x0 - 0.4, PIT.z1, PIT.x1 + 0.4, PIT.z1 + 0.4], [PIT.x0 - 0.4, PIT.z0, PIT.x0, PIT.z1], [PIT.x1, PIT.z0, PIT.x1 + 0.4, PIT.z1]])
    detail(b, x0, z0, x1, z1, y - 0.3, y + 0.35, 'concrete', 0xece6dc);
  // 2F ceiling: the upper floors' soffit, lit in bands; GF ceiling (the 2F slab's underside) likewise.
  for (const r of slab) for (let x = r.x0 + 2; x < r.x1 - 1; x += 4.2) detail(b, x - 0.1, r.z0 + 0.8, x + 0.1, r.z1 - 0.8, F2 - 0.45, F2 - 0.35, 'neon', 0xfff6e8);
  for (let x = 767; x < IN.x1; x += 6) for (const [z0, z1] of [[IN.z0, PIT.z0], [PIT.z1, IN.z1]]) detail(b, x - 0.1, z0 + 1, x + 0.1, z1 - 1, CEIL - 0.3, CEIL - 0.2, 'neon', 0xfff6e8);
  // Seal the gap between the tower and the mall's west wall at the north end.
  box(b, 756.5, 182.4, MALL.x0, 183.6, KERB, 6.3, 'curtain', 0x9ec4c8);
}

/** East garden: sunk to B1 beside the mall, with stairs at both ends, a pool, trees and a pavilion. */
function sunkenGarden(b: B) {
  box(b, GARDEN.x0, GARDEN.z0, GARDEN.x1, GARDEN.z1, B1 - 0.25, B1, 'slab', 0xbdb6a8);
  box(b, PASSAGE.x1 - 5, PASSAGE.z0, PASSAGE.x1, PASSAGE.z1, B1 - 0.25, B1, 'slab', 0xbdb6a8);
  stairs(b, rect(807, GARDEN.z0, 819, GARDEN.z0 + 9), B1, KERB, 3);
  stairs(b, rect(807, GARDEN.z1 - 9, 819, GARDEN.z1), B1, KERB, 1);
  // Parapets on the garden's edge at street level, open at the stairs.
  parapet(b, 'z', GARDEN.x1 + 0.15, GARDEN.z0, GARDEN.z1, KERB);
  parapet(b, 'z', GARDEN.x0 - 0.15, GARDEN.z0, PASSAGE.z0, KERB); parapet(b, 'z', GARDEN.x0 - 0.15, PASSAGE.z1, GARDEN.z1, KERB);
  parapet(b, 'x', PASSAGE.z0 - 0.15, MALL.x1, GARDEN.x0, KERB); parapet(b, 'x', PASSAGE.z1 + 0.15, MALL.x1, GARDEN.x0, KERB);
  for (const z of [GARDEN.z0 - 0.15, GARDEN.z1 + 0.15]) { parapet(b, 'x', z, GARDEN.x0 - 0.3, 807, KERB); parapet(b, 'x', z, 819, GARDEN.x1 + 0.3, KERB); }
  // Stone cladding where the dig's walls show, and a lit strip under the parapets.
  for (const [x0, z0, x1, z1] of [[GARDEN.x0 - 0.05, GARDEN.z0, GARDEN.x0, PASSAGE.z0], [GARDEN.x0 - 0.05, PASSAGE.z1, GARDEN.x0, GARDEN.z1], [GARDEN.x1, GARDEN.z0, GARDEN.x1 + 0.05, GARDEN.z1]])
    detail(b, x0, z0, x1, z1, B1, -0.35, 'concrete', 0xb8ae9c);
  for (const [x0, z0, x1, z1] of [[GARDEN.x0, GARDEN.z0, GARDEN.x0 + 0.1, GARDEN.z1], [GARDEN.x1 - 0.1, GARDEN.z0, GARDEN.x1, GARDEN.z1]]) detail(b, x0, z0, x1, z1, -0.75, -0.65, 'neon', LIGHT);
  // Reflecting pool with a stone rim (knee-high cover), trees in raised beds, a pavilion and benches.
  box(b, 809, 200, 817, 216, B1, B1 + 0.6, 'concrete', 0x8a847a);
  b.water(X(813), B1 + 0.5, Z(208), 7.4, 15.4);
  for (const [x, z] of [[806, 194], [820, 194], [806, 224], [820, 224]] as [number, number][]) {
    box(b, x - 1.3, z - 1.3, x + 1.3, z + 1.3, B1, B1 + 0.75, 'concrete', 0x6a6460);
    b.tree(X(x), Z(z), 0.7, 1);
  }
  for (const [x, z] of [[808.2, 190.8], [817.8, 190.8], [808.2, 197.2], [817.8, 197.2]] as [number, number][]) box(b, x - 0.25, z - 0.25, x + 0.25, z + 0.25, B1, B1 + 3.2, 'wood', 0x5a3a28);
  detail(b, 807.5, 190, 818.5, 198, B1 + 3.2, B1 + 3.5, 'roof', 0x4a4440);
  box(b, 810, 193.2, 816, 194.8, B1, B1 + 0.55, 'wood', 0x8a6a4a);
  box(b, 806, 228.5, 809, 229.5, B1, B1 + 0.55, 'wood', 0x8a6a4a);
  box(b, 817, 228.5, 820, 229.5, B1, B1 + 0.55, 'wood', 0x8a6a4a);
}

/** The west plaza around site B: an MRT exit pavilion and a coffee kiosk join the source's sculpture and planters. */
function westPlaza(b: B) {
  // 捷運台北101/世貿站 exit: a glazed pavilion over the stairs down (closed below street level).
  box(b, 667, 236, 674, 247, KERB, 3.2, 'concrete', 0x3a3e44);
  detail(b, 666.6, 235.6, 674.4, 247.4, 3.2, 3.5, 'glass');
  detail(b, 666.5, 235.5, 674.5, 235.7, 3.2, 3.5, 'neon', 0xd02a2a);
  sign(b, 'board', 670.5, 2.6, 235.95, 0, 6, 0.9, '捷運 台北101/世貿站', '#d22a2a', '#ffffff', 'MRT TAIPEI 101 / WORLD TRADE CENTER  EXIT 4');
  // Coffee kiosk under the spur, and two big planter cubes for cover in the open.
  box(b, 673.5, 199.5, 676.5, 203, KERB, 2.6, 'wood', 0x5a3a28);
  detail(b, 673, 199, 677, 203.5, 2.6, 2.8, 'steel', 0x2a2c30);
  sign(b, 'board', 675, 2.2, 199.45, 0, 2.8, 0.5, '星八克', '#1e5a3a', '#ffffff');
  for (const [x, z] of [[683, 214], [672, 226.5]] as [number, number][]) box(b, x - 1.3, z - 1.3, x + 1.3, z + 1.3, KERB, 1.2, 'concrete', 0x6a6460);
  // LOVE-style sculpture's sign plate and the vertical 台北101 sign of the north plaza.
  sign(b, 'blade', 706, 3.2, 152, Math.PI / 2, 1.0, 4.4, '台北101', '#23272b', '#f4e6c0');
}

/** Four Four South Village (四四南村): the source's houses, with the middle row opened up as homes to fight through. */
function village(b: B) {
  // The middle row (750–794 × 309–316.5): brick walls with doors and windows, three rooms, a tin roof.
  b.bunker(X(772), Z(312.75), 44, 7.5, {
    y: KERB, h: 4.0, style: 'brick', roof: true,
    doors: [['n', -14, 1.8], ['n', 2, 1.8], ['s', -6, 1.8], ['s', 14, 1.8], ['w', 0, 1.8]],
    windows: [['n', -6, 1.6], ['n', 12, 1.6], ['s', -16, 1.6], ['s', 4, 1.6]],
  });
  for (const x of [764, 780]) box(b, x - 0.15, 309.5, x + 0.15, 316, KERB, KERB + 4, 'plaster', 0xe8e0d0);
  // A ladder up to its roof, the village's lookout over Heping Rd.
  b.ladder(X(793.6), Z(318.5), KERB, KERB + 4.35, 3);
  sign(b, 'gate', 748, 4.4, 322, -Math.PI / 2, 4.2, 1.2, '四四南村', '#5a1a14', '#ffd890', 'FOUR FOUR SOUTH VILLAGE');
  for (const z of [319.6, 324.4]) box(b, 747.6, z - 0.2, 748.4, z + 0.2, KERB, 5.1, 'wood', 0x5a3a28);
}

/** Elephant Mountain's foot: woods on the slope, the trailhead gate and a boulder or two. */
function hillside(b: B) {
  const trees: [number, number, number][] = [];
  for (let x = 904; x < AREA.x1 + 40; x += 10) for (let z = AREA.z0 + 4; z < AREA.z1 + 40; z += 11) {
    const jx = ((x * 37 + z * 11) % 7) - 3, jz = ((x * 13 + z * 29) % 5) - 2;
    if (Math.abs(z + jz - 330) < 4 && x < 935) continue;      // the trail
    trees.push([x + jx, z + jz, 0.8 + ((x + z) % 5) * 0.12]);
  }
  for (const [x, z, s] of trees) b.tree(X(x), Z(z), s, (x + z) % 3 ? 1 : 2);
  // The trailhead (象山親山步道): its gate over the first steps, as the source frames it.
  for (const z of [326, 334]) box(b, 899.6, z - 0.2, 900.4, z + 0.2, 0, 4.2, 'wood', 0x6b4a2a);
  detail(b, 899.4, 325.6, 900.6, 334.4, 4.2, 4.6, 'wood', 0x6b4a2a);
  sign(b, 'gate', 899.2, 3.4, 330, -Math.PI / 2, 6.2, 1.2, '象山親山步道', '#3d6b35', '#ffffff', 'ELEPHANT MOUNTAIN TRAIL');
  for (const [x, z, s] of [[912, 300, 2.2], [916, 262, 1.8], [908, 352, 2.6], [918, 200, 2]] as [number, number, number][])
    box(b, x - s, z - s * 0.8, x + s, z + s * 0.8, hill(x, z) - 0.5, hill(x, z) + s * 0.9, 'rock');
}

/** Xinyi Plaza Malls: the source's paint as visuals; its stone bases as the buildings' collision. */
function xinyiMalls(b: B): Rect[] {
  const footprints: Rect[] = [];
  for (const [x0, y0, z0, x1, y1, z1, color, glow] of XINYI_MALLS) {
    if (y1 < 0.3) continue;
    const thin = Math.min(x1 - x0, z1 - z0) < 0.3 || y1 - y0 < 0.4;
    if (y0 < 1 && y1 > 5 && !thin) {
      // A building's base storey: solid, and the footprint every storey above stands on.
      footprints.push(rect(x0, z0, x1, z1));
      box(b, x0, z0, x1, z1, 0, y1, glow > 0.5 ? 'curtain' : 'concrete', glow > 0.5 ? 0xf0e0c0 : color);
      continue;
    }
    if (y0 > 7 && y0 < 11 && x1 - x0 > 9 && z1 - z0 < 6 && z0 > 90) continue; // the bridge deck and rails: colliders below
    const style: BlockStyle = glow >= 3 ? 'neon' : glow > 0.5 ? 'curtain' : color === 0xa9c4cf ? 'glass' : thin ? 'steel' : 'concrete';
    detail(b, x0, z0, x1, z1, y0, y1, style, style === 'curtain' ? (glow > 1 ? 0xb8d0e0 : 0x90b0c4) : color);
  }
  for (const [key, x, y, z, w, h, facing] of SIGNS) {
    const art = SIGN_ART[key];
    if (!art || key === 'mall101' || key === 'taipei101') continue;
    const [text, sub, bg, fg] = art;
    if (!text) sign(b, 'screen', x, y, z, facing, w, h, '', '#101826', '#5ad8ff');
    else sign(b, 'board', x, y, z, facing, w, h, text, bg, fg, sub);
  }
  return footprints;
}

export function xinyi(): MapDef {
  const b = new MapBuilder({
    id: 'xinyi', name: 'Taipei 101 · Xinyi', region: 'XINYI 信義 / TAIPEI',
    description: 'Taipei 101 and its podium mall from 臺北狂飆: a sunken atrium, the Xinyi Skywalk, the 101 plaza and Four Four South Village under Elephant Mountain.',
    theme: 'xinyi', halfX: HALF_X, halfZ: HALF_Z, seed: 101, roll: 0, ridge: 0,
    sabotage: { sites: ['A', 'B'], attackerSpawn: 1 },
    big: true,
    // Moonlight from the north-east, over the hills.
    sun: { x: 0.45, y: 0.62, z: -0.4 },
    // The hills as the source raises them, eased down toward the edge of the terrain grid so
    // Elephant Mountain's flank reads as a ridge instead of a cliff where the grid ends.
    // In the city the ground sits just under the asphalt and paving (which cover all of it).
    ground: (x, z) => {
      const h = hill(x + OX, z + OZ) * (1 - 0.8 * Math.min(1, Math.max(0, (Math.max(Math.abs(x), Math.abs(z)) - 165) / 45)) ** 2);
      return h > 0.06 ? h : -0.06;
    },
  });
  // The dig under the mall and the east garden: one pad, its blend hidden inside the fill walls.
  b.pad(X((FILL.x0 + FILL.x1) / 2), Z((FILL.z0 + FILL.z1) / 2), FILL.x1 - FILL.x0 - 6, FILL.z1 - FILL.z0 - 6, -5.8, 2.6);
  b.buildTerrain(3);

  paving(b);
  streets(b);
  lots(b);
  const footprints = xinyiMalls(b);
  tower(b);
  plaza(b);
  district(b, footprints);
  skywalk(b);
  mall(b);
  sunkenGarden(b);
  westPlaza(b);
  village(b);
  hillside(b);
  b.light(X(781), 20, Z(210), 0xfff0d8, 6, 40);
  b.light(X(813), B1 + 3, Z(208), 0x9fd8ff, 4, 16);

  // ---- Overlay: bases, sites, landmarks and ammo ------------------------------------------
  const spawn = (team: 0 | 1, x: number, z: number, yaw: number) => b.spawn(team, X(x), floorAt(x, z), Z(z), yaw);
  // SWAT on the Xinyi Plaza Malls' frontage, facing south across Xinyi Rd to the tower.
  for (let i = 0; i < 12; i++) spawn(0, 727 + (i % 6) * 8, i < 6 ? 99 : 103.5, Math.PI);
  // Militia on Songzhi Rd beside Four Four South Village, facing north to the tower.
  for (let i = 0; i < 12; i++) spawn(1, i % 2 ? 742 : 738, 315 + Math.floor(i / 2) * 6, 0);
  b.point('A', 'Mall Atrium 購物中心中庭', X(781), B1, Z(216.5), 7);
  b.point('B', 'West Plaza 101西側廣場', X(679), KERB, Z(213), 7);
  b.point('C', 'Xinyi Skywalk 信義空橋', X(669), SKY, Z(172), 5);
  b.point('D', 'Sunken Garden 下沉花園', X(813), B1, Z(222), 6);
  b.point('E', 'Four Four South Village 四四南村', X(800), KERB, Z(326), 7);
  for (const [x, z] of [[735, 160], [668, 205], [790.5, 230], [806, 218], [808, 324], [858, 262], [697, 268], [671, 178]] as [number, number][])
    b.ammoCrate(X(x), floorAt(x, z), Z(z));
  b.ammoCrate(X(795), F2, Z(184));
  b.ammoCrate(X(669), SKY, Z(185));

  // ---- Drivable vehicles (shared/maps/xinyi-vehicles.ts) ----------------------------------
  parkXinyiVehicles(b, X, Z, floorAt);

  return b.build();
}
