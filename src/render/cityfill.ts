import { rng } from '../../shared/math';
import { LOTS, TOWER } from '../../shared/maps/xinyi-data';
import type { SkylineData } from './skyline';

/** The Taipei skyline data, which the dressing loader imports on demand. */
type Far = typeof import('../../shared/maps/taipei-skyline');

/**
 * The city as seen from high up Taipei 101 (the taipei101 map's dressing set): the shared Taipei
 * skyline (its ground, hills, river, roads, Ximending's blocks and the landmarks, less the 101 we
 * stand in), Xinyi's own city lots from the xinyi map's source, the tower's podium mall, and a
 * deterministic fill of blocks over the rest of the basin's flat city ground, so the view down
 * reads as a dense city rather than a bare plain. All source-world coordinates (+x east, +z south).
 */
export function highriseSkyline(far: Far): SkylineData {
  const buildings = [...far.FAR_BUILDINGS];
  for (const [, , x0, z0, x1, z1, , top, tint] of LOTS) buildings.push(x0, z0, x1, z1, top, tint);
  // The podium mall north of the tower (台北101購物中心), six storeys of stone.
  const { cx, cz } = TOWER;
  buildings.push(cx - 34, cz - 86, cx + 34, cz - 31, 60, 0xb8bcb4);

  // Footprints already standing, on a 40 m occupancy grid, and the landmark sites.
  const CELL = 40, taken = new Set<string>();
  const mark = (x0: number, z0: number, x1: number, z1: number) => {
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) taken.add(`${i},${j}`);
  };
  for (let i = 0; i < buildings.length; i += 6) mark(buildings[i], buildings[i + 1], buildings[i + 2], buildings[i + 3]);
  for (const [, , , x, z, w, d] of far.FAR_LANDMARKS) mark(x - w / 2, z - d / 2, x + w / 2, z + d / 2);
  mark(cx - 70, cz - 90, cx + 70, cz + 70);

  // Ground height of the source's city grid (hills rise above 2 m; water lies below 0).
  const g = far.FAR_GROUND, h = far.FAR_HEIGHTS;
  const ground = (x: number, z: number) => {
    const i = Math.round((x - g.x0) / g.spacing), j = Math.round((z - g.z0) / g.spacing);
    if (i < 0 || j < 0 || i >= g.n || j >= g.n) return 99;
    return h[j * g.n + i];
  };
  const onRoad = (x0: number, z0: number, x1: number, z1: number) => far.FAR_ROADS.some(([axis, at, from, to, hw]) =>
    axis === 'x' ? at + hw + 2 > z0 && at - hw - 2 < z1 && to > x0 && from < x1 : at + hw + 2 > x0 && at - hw - 2 < x1 && to > z0 && from < z1);

  // City blocks of 64 m (with 12 m streets) out to about 2.6 km, each split into two to four buildings:
  // mostly 8–16 storeys, some towers, a few walk-ups.
  const r = rng(101), BLOCK = 64, STREET = 12;
  const palette = [0xd8d4cc, 0xcfc8bc, 0xbfc4c8, 0xe2ddd2, 0xb8b0a4, 0xa8b4bc, 0xd0c4b0];
  for (let bx = cx - 2600; bx < cx + 2000; bx += BLOCK) for (let bz = cz - 2400; bz < cz + 1800; bz += BLOCK) {
    const x0 = bx + STREET / 2, z0 = bz + STREET / 2, x1 = bx + BLOCK - STREET / 2, z1 = bz + BLOCK - STREET / 2;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    if (taken.has(`${Math.floor(mx / CELL)},${Math.floor(mz / CELL)}`)) continue;
    const gh = Math.max(ground(x0, z0), ground(x1, z0), ground(x0, z1), ground(x1, z1));
    if (gh > 2 || Math.min(ground(x0, z0), ground(x1, z1)) < -0.1) continue;
    if (onRoad(x0, z0, x1, z1)) continue;
    const dist = Math.hypot(mx - cx, mz - cz);
    if (r() < 0.12 + Math.max(0, dist - 1800) / 1600) continue; // parks and gaps, thinning out with distance
    const split = r() < 0.5, parts = 2 + Math.floor(r() * 3);
    for (let k = 0; k < parts; k++) {
      const a = k / parts, c = (k + 1) / parts, inset = 1 + r() * 3;
      const px0 = split ? x0 + (x1 - x0) * a + inset / 2 : x0 + inset, px1 = split ? x0 + (x1 - x0) * c - inset / 2 : x1 - inset;
      const pz0 = split ? z0 + inset : z0 + (z1 - z0) * a + inset / 2, pz1 = split ? z1 - inset : z0 + (z1 - z0) * c - inset / 2;
      const roll = r(), floors = roll < 0.12 ? 4 + r() * 4 : roll < 0.86 ? 8 + r() * 9 : 18 + r() * 22 * (dist < 1400 ? 1.4 : 1);
      buildings.push(px0, pz0, px1, pz1, Math.round(floors * 3.3), palette[Math.floor(r() * palette.length)]);
    }
  }
  return {
    buildings,
    landmarks: far.FAR_LANDMARKS.filter(l => l[0] !== 'taipei101') as SkylineData['landmarks'],
    hills: far.FAR_HILLS as SkylineData['hills'], roads: far.FAR_ROADS as SkylineData['roads'],
    ground: far.FAR_GROUND, heights: far.FAR_HEIGHTS,
  };
}
