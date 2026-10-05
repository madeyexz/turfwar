import type { Surface } from '../collision';
import type { MapBuilder } from './builder';
import { CAR_BAYS, MRT_EXIT, SCOOTER_ROWS, STREET_SOLIDS } from './taipei-furniture';
import { minusHoles } from './taipei-underpass';
import type { BlockStyle, Decor } from './types';

/**
 * Taipei's street dressing, kept apart from the layout in taipei.ts: the source's street furniture
 * (drawn from a dressing set the renderer loads on demand, with its colliders here), parked cars in
 * the source's car bays, and Ximen station's exit 6. Every function takes the source-to-map shift.
 */
export interface Shift { X: (x: number) => number; Z: (z: number) => number; ox: number; oz: number }

/** Places the dressing must leave clear: spawns, ammo crates and bomb sites (x, z, radius in map coordinates). */
export type Keep = [number, number, number][];
const blocked = (keep: Keep, x0: number, z0: number, x1: number, z1: number) =>
  keep.some(([x, z, r]) => x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r);

/**
 * The source's street furniture: the look comes from the 'taipei' dressing set (trees, lamps,
 * signals, bus stops, YouBike docks, bollards, hydrants, postboxes, planters, scooters, signs) and
 * the source's colliders for it are solids here. Rows of parked scooters block as one low box each.
 */
export function streetFurniture(b: MapBuilder, s: Shift, keep: Keep, cuts: number[] = [], clear: number[] = []) {
  b.raw({ kind: 'dressing', set: 'taipei', x: s.ox, z: s.oz, cut: cuts, clear });
  const cut = [...cuts, ...clear];
  // Nothing of the dressing stands in the cut boxes (the map builds there).
  const inCut = (x0: number, z0: number, x1: number, z1: number) => {
    for (let i = 0; i < cut.length; i += 6) if (x1 > cut[i] && x0 < cut[i + 3] && z1 > cut[i + 2] && z0 < cut[i + 5] && cut[i + 1] < 1) return true;
    return false;
  };
  const surface = (tag: string): Surface => (tag === 'tree' ? 'rock' : tag === 'wall' ? 'concrete' : 'metal');
  for (const [x0, z0, x1, z1, y0, y1, tag] of STREET_SOLIDS) {
    const X0 = s.X(x0), X1 = s.X(x1), Z0 = s.Z(z0), Z1 = s.Z(z1);
    if (blocked(keep, X0, Z0, X1, Z1) || inCut(X0, Z0, X1, Z1)) continue;
    // Thin poles keep at least 16 cm of cover so a shot never slips through a drawn pole.
    const w = Math.max(X1 - X0, 0.16), d = Math.max(Z1 - Z0, 0.16);
    b.box((X0 + X1) / 2, y0, (Z0 + Z1) / 2, w, y1 - y0, d, 'invisible', surface(tag));
  }
  // A row loses the stretch inside a cut (the renderer drops those scooters too, see dressing.ts).
  const holes: [number, number, number, number][] = [];
  for (let i = 0; i < cut.length; i += 6) if (cut[i + 1] < 1) holes.push([cut[i] - 0.4, cut[i + 2] - 0.4, cut[i + 3] + 0.4, cut[i + 5] + 0.4]);
  for (const [x0, z0, x1, z1] of SCOOTER_ROWS) {
    for (const [X0, Z0, X1, Z1] of minusHoles([s.X(x0), s.Z(z0), s.X(x1), s.Z(z1)], holes)) {
      if (Math.max(X1 - X0, Z1 - Z0) < 0.6 || blocked(keep, X0, Z0, X1, Z1)) continue;
      b.box((X0 + X1) / 2, 0.15, (Z0 + Z1) / 2, X1 - X0, 1.0, Z1 - Z0, 'invisible', 'metal');
    }
  }
}

/** Deterministic 0..1 from a position (the same on every client and the server). */
const hash = (x: number, z: number) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
const CAR_COLORS = [0xf2f2f0, 0x1c1c1e, 0x9aa0a6, 0x2a3f6a, 0x8a1c1c, 0xd8d8d4, 0x3a4a3a, 0x5a5e66];

/**
 * Parked cars and taxis in the source's numbered car bays (where its traffic parks): about two in
 * three bays taken, one car in four a yellow taxi. Each blocks as a car-sized box.
 */
export function parkedCars(b: MapBuilder, s: Shift, keep: Keep) {
  const cars: number[] = [], taxis: number[] = [];
  for (const [x, z, heading] of CAR_BAYS) {
    const r = hash(x, z);
    if (r > 0.68) continue;
    const X = s.X(x), Z = s.Z(z), along = Math.abs(Math.sin(heading)) > 0.5;
    const w = along ? 4.5 : 1.8, d = along ? 1.8 : 4.5;
    if (blocked(keep, X - w / 2, Z - d / 2, X + w / 2, Z + d / 2)) continue;
    const taxi = r < 0.17;
    // Bays run along the kerb; cars park either way round.
    const facing = heading + (hash(z, x) < 0.5 ? 0 : Math.PI);
    (taxi ? taxis : cars).push(X, 0, Z, facing, 1, 0, taxi ? 0xf6c400 : CAR_COLORS[Math.floor(hash(x + 1, z) * CAR_COLORS.length)], 0);
    b.box(X, 0, Z, w - 0.2, 1.45, d - 0.2, 'invisible', 'metal');
  }
  if (cars.length) b.raw({ kind: 'instances', model: 'car', data: cars });
  if (taxis.length) b.raw({ kind: 'instances', model: 'taxi', data: taxis });
}

/**
 * Ximen station exit 6 where the source's transit layer puts it: a glass entrance canopy over the
 * stair well, opening toward the Zhonghua Rd junction, with the MRT sign. It stands on the map's
 * edge, so it blocks as one box.
 */
export function mrtExit(b: MapBuilder, s: Shift, kerb: number) {
  const e = MRT_EXIT, dir = Math.sign(Math.sin(e.heading)) || 1;
  const x0 = s.X(e.x) - dir * e.front, x1 = s.X(e.x) + dir * (e.pit + e.back), z = s.Z(e.z), hw = e.hw;
  const [a, c] = [Math.min(x0, x1), Math.max(x0, x1)], y = kerb;
  const box = (bx0: number, bz0: number, bx1: number, bz1: number, by0: number, by1: number, style: BlockStyle, color?: number) =>
    b.shape((bx0 + bx1) / 2, by0, (bz0 + bz1) / 2, bx1 - bx0, by1 - by0, bz1 - bz0, style, color);
  b.box((a + c) / 2, y, z, c - a, 2.9, hw * 2, 'invisible', 'glass');
  // Glass sides and back on a steel frame, a curved-looking two-step roof, the dark stair well.
  box(a, z - hw, c, z - hw + 0.06, y + 0.25, y + 2.6, 'glass');
  box(a, z + hw - 0.06, c, z + hw, y + 0.25, y + 2.6, 'glass');
  box(c - 0.08, z - hw, c, z + hw, y, y + 2.6, 'steel', 0xd8dade);
  for (const px of [a, (a + c) / 2, c - 0.1]) for (const pz of [z - hw, z + hw - 0.1]) box(px, pz, px + 0.1, pz + 0.1, y, y + 2.7, 'steel', 0xc8ccd0);
  box(a, z - hw - 0.1, c, z + hw + 0.1, y + 0.25 - 0.25, y + 0.25, 'concrete', 0x8a8e92);
  box(a - 0.3, z - hw - 0.25, c + 0.1, z + hw + 0.25, y + 2.7, y + 2.85, 'steel', 0xe6e8ea);
  box(a, z - hw + 0.4, c - 0.4, z + hw - 0.4, y + 2.85, y + 3.0, 'steel', 0xe6e8ea);
  const sign = (text: string, sub: string, w: number, sy: number, facing: number, sx: number) => b.raw({ kind: 'sign', style: 'board', x: sx, y: sy, z, rotY: facing, w, h: 0.55, text, sub, bg: '#0a5aa8', fg: '#ffffff' } as Decor);
  // The name board over the mouth, facing out of it.
  const mouth = dir > 0 ? a : c;
  sign('捷運西門站 出口 6', 'MRT XIMEN STATION · EXIT 6', hw * 2 - 0.2, y + 2.45, dir > 0 ? -Math.PI / 2 : Math.PI / 2, mouth - dir * 0.02);
}
