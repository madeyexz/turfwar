import { rng } from '../../shared/math';
import type { SkylineData } from './skyline';

/**
 * The city past a map: a deterministic, procedural Taipei. Blocks of 64 m with 12 m streets, mostly
 * eight to sixteen storeys with a few towers and walk-ups, thinning out with distance and leaving
 * gaps for parks; hills and a river on the ground under them; a few wide avenues. Nothing in it is
 * surveyed or taken from a game: it is a seeded fill that reads as "dense city" from the street or
 * from a tower, laid out round whatever the map itself builds (`clear`). Coordinates are the map's
 * own (+x east, +z south, metres).
 */
interface CityOptions {
  seed: number;
  /** Boxes (x0, z0, x1, z1) the fill leaves alone: the map and its own backdrop. */
  clear: [number, number, number, number][];
  /** Half-extent of the city grid; it is drawn from -extent to +extent on both axes. */
  extent: number;
  /** Hills: x, z, height, radius. */
  hills: [number, number, number, number][];
  /** A river as a polyline of x, z points and a half-width. */
  river?: { points: [number, number][]; halfWidth: number };
  /** Where Taipei 101 stands, if it is in view. */
  tower?: [number, number];
  /** Storeys to add to every building (a denser, higher district). */
  tallness?: number;
}

const BLOCK = 64, STREET = 12, SPACING = 48;
const PALETTE = [0xd8d4cc, 0xcfc8bc, 0xbfc4c8, 0xe2ddd2, 0xb8b0a4, 0xa8b4bc, 0xd0c4b0, 0xc8b8a8];

function distanceToPolyline(x: number, z: number, pts: [number, number][]) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

function city(o: CityOptions): SkylineData {
  const n = Math.ceil((o.extent * 2) / SPACING) + 1, x0 = -o.extent, z0 = -o.extent;
  const heights: number[] = [];
  const groundAt = (x: number, z: number) => {
    let h = 0;
    for (const [hx, hz, hh, hr] of o.hills) h = Math.max(h, hh * Math.exp(-(((x - hx) ** 2 + (z - hz) ** 2) / (hr * hr))));
    if (o.river) {
      const d = distanceToPolyline(x, z, o.river.points);
      if (d < o.river.halfWidth * 1.8) h = Math.min(h, -3 + Math.max(0, d - o.river.halfWidth) / (o.river.halfWidth * 0.8) * 3.2);
    }
    return h;
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights.push(groundAt(x0 + i * SPACING, z0 + j * SPACING));

  const buildings: number[] = [];
  const inClear = (ax: number, az: number, bx: number, bz: number) => o.clear.some(([cx0, cz0, cx1, cz1]) => bx > cx0 && ax < cx1 && bz > cz0 && az < cz1);
  const onTower = (ax: number, az: number, bx: number, bz: number) => !!o.tower && bx > o.tower[0] - 80 && ax < o.tower[0] + 80 && bz > o.tower[1] - 90 && az < o.tower[1] + 80;
  const r = rng(o.seed);
  const tall = o.tallness ?? 0;
  for (let bx = -o.extent; bx < o.extent; bx += BLOCK) for (let bz = -o.extent; bz < o.extent; bz += BLOCK) {
    const px0 = bx + STREET / 2, pz0 = bz + STREET / 2, px1 = bx + BLOCK - STREET / 2, pz1 = bz + BLOCK - STREET / 2;
    const roll = r(); // keep the sequence the same wherever a block is skipped
    if (inClear(px0, pz0, px1, pz1) || onTower(px0, pz0, px1, pz1)) continue;
    const mx = (px0 + px1) / 2, mz = (pz0 + pz1) / 2;
    if (groundAt(mx, mz) > 2 || groundAt(px0, pz0) < -0.1 || groundAt(px1, pz1) < -0.1 || groundAt(px0, pz1) > 2 || groundAt(px1, pz0) > 2) continue;
    const dist = Math.hypot(mx, mz);
    if (roll < 0.1 + Math.max(0, dist - 1700) / 1700) continue; // parks and gaps, thinning out with distance
    const split = r() < 0.5, parts = 2 + Math.floor(r() * 3);
    for (let k = 0; k < parts; k++) {
      const a = k / parts, c = (k + 1) / parts, inset = 1 + r() * 3;
      const ax = split ? px0 + (px1 - px0) * a + inset / 2 : px0 + inset, bx1 = split ? px0 + (px1 - px0) * c - inset / 2 : px1 - inset;
      const az = split ? pz0 + inset : pz0 + (pz1 - pz0) * a + inset / 2, bz1 = split ? pz1 - inset : pz0 + (pz1 - pz0) * c - inset / 2;
      const kind = r();
      const floors = (kind < 0.14 ? 4 + r() * 4 : kind < 0.86 ? 8 + r() * 9 : 18 + r() * 22 * (dist < 1400 ? 1.4 : 1)) + tall;
      buildings.push(ax, az, bx1, bz1, Math.round(floors * 3.3), PALETTE[Math.floor(r() * PALETTE.length)]);
    }
  }

  // Avenues every five blocks, wide and dark; one elevated.
  const roads: SkylineData['roads'] = [];
  for (let at = -Math.floor(o.extent / 320) * 320; at < o.extent; at += 320) {
    const hw = at % 640 === 0 ? 22 : 14;
    roads.push({ axis: 'x', at: at + 26, from: -o.extent, to: o.extent, hw, elevated: at === 640 });
    roads.push({ axis: 'z', at: at - 26, from: -o.extent, to: o.extent, hw, elevated: false });
  }
  const landmarks: SkylineData['landmarks'] = o.tower ? [{ id: 'taipei101', x: o.tower[0], z: o.tower[1] }] : [];
  return { buildings, landmarks, roads, ground: { x0, z0, spacing: SPACING, n, waterLevel: -1.2 }, heights };
}

/**
 * Ximending's city: the old core of Taipei, west of the basin's middle. The Tamsui's tributary runs
 * far to the west, the hills stand east and north, and Taipei 101 stands to the east-south-east.
 */
export function ximendingSkyline(): SkylineData {
  return city({
    seed: 2101, extent: 2300, tallness: 0,
    clear: [[-125, -105, 125, 105]],
    hills: [[2300, 1500, 220, 700], [1900, -1900, 380, 800], [-400, -2400, 600, 900], [-2400, 700, 120, 500]],
    river: { points: [[-1750, -2400], [-1500, -800], [-1650, 800], [-1900, 2400]], halfWidth: 150 },
    tower: [1350, 900],
  });
}

/** Xinyi's city: the tower itself stands in the map, so the fill leaves its district alone. */
export function xinyiSkyline(): SkylineData {
  return city({
    seed: 3311, extent: 2300, tallness: 1,
    clear: [[-210, -230, 210, 230]],
    hills: [[1250, 1650, 220, 600], [1500, -400, 260, 650], [-2000, 1500, 200, 700], [300, -2300, 400, 900]],
    river: { points: [[-2300, -1500], [-1200, -1700], [-300, -2300]], halfWidth: 120 },
  });
}

/** The basin seen from 88F, 383 m up Taipei 101 (the map sets the ground far below): the tower at the origin. */
export function highriseSkyline(): SkylineData {
  const s = city({
    seed: 4177, extent: 2300, tallness: 2,
    clear: [],
    hills: [[1500, 1500, 240, 650], [1600, -500, 300, 700], [-2100, 1200, 220, 700], [200, -2300, 420, 900]],
    river: { points: [[-2300, -1300], [-1300, -1500], [-400, -2300]], halfWidth: 120 },
    tower: [0, 0],
  });
  // The tower's own podium mall, north of its foot, six storeys of stone.
  s.buildings.push(-34, -86, 34, -31, 60, 0xb8bcb4);
  s.landmarks = [];
  return s;
}
