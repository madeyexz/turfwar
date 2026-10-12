import { describe, expect, it } from 'vitest';
import { terrainHeight } from '../../shared/collision';
import { loadMap } from '../../shared/maps/index';
import { highriseSkyline, xinyiSkyline, ximendingSkyline } from './cityscape';
import { nearField } from './level';
import { SKYLINE_SINK, skylineGround, underMap, type NearField, type SkylineData } from './skyline';

const flat: NearField = { minX: -100, maxX: 100, minZ: -80, maxZ: 80, lowest: () => 0 };

describe('underMap', () => {
  it('keeps the city ground under the map near it and leaves it alone further out', () => {
    expect(underMap(0, 0, 0.25, flat, 48)).toBe(SKYLINE_SINK);
    expect(underMap(140, 0, 0.25, flat, 48)).toBe(SKYLINE_SINK); // within one grid step of the edge
    expect(underMap(0, 0, -2, flat, 48)).toBe(-2); // already lower: unchanged
    expect(underMap(200, 0, 0.25, flat, 48)).toBe(0.25);
    expect(underMap(0, 0, 0.25, undefined, 48)).toBe(0.25);
  });
});

/** The city ground's height at (x, z), as its triangles draw it (the triangulation of skylineGround). */
function surfaceAt(pos: { getY(k: number): number }, d: SkylineData, x: number, z: number) {
  const { x0, z0, spacing, n } = d.ground;
  const fi = (x - x0) / spacing, fj = (z - z0) / spacing, i = Math.floor(fi), j = Math.floor(fj);
  if (i < 0 || j < 0 || i >= n - 1 || j >= n - 1) return -Infinity;
  const u = fi - i, v = fj - j, k = j * n + i;
  const h00 = pos.getY(k), h10 = pos.getY(k + 1), h01 = pos.getY(k + n), h11 = pos.getY(k + n + 1);
  return u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
}

/**
 * How far the city ground comes up through the map's own ground at worst (the sink when it stays
 * under), sampled every 2 m over the map's heightfield, placed as the map's dressing set places it.
 */
function worstOverMap(data: SkylineData, mapId: string, keepUnder: boolean) {
  const def = loadMap(mapId).def, t = def.terrain, f = nearField(t);
  const y = def.decor.reduce((a, d) => (d.kind === 'dressing' && d.y !== undefined ? d.y : a), 0);
  const near: NearField = { ...f, lowest: (x0, z0, x1, z1) => f.lowest(x0, z0, x1, z1) - y };
  const pos = skylineGround(data, 0, 0, keepUnder ? near : undefined).getAttribute('position');
  let worst = -Infinity;
  for (let x = f.minX; x <= f.maxX; x += 2) for (let z = f.minZ; z <= f.maxZ; z += 2) {
    worst = Math.max(worst, surfaceAt(pos, data, x, z) + y - terrainHeight(t, x, z));
  }
  return worst;
}

describe('skyline ground under the map', () => {
  const cases: [string, () => SkylineData][] = [['taipei', ximendingSkyline], ['xinyi', xinyiSkyline], ['taipei101', highriseSkyline]];
  for (const [mapId, data] of cases) {
    it(`${mapId}: never comes up through the map's ground (the paving and the feet of everything on it show)`, () => {
      expect(worstOverMap(data(), mapId, true)).toBeLessThanOrEqual(SKYLINE_SINK + 1e-3);
    });
  }

  it('came up through Ximending and Xinyi before it was kept under (so the check can tell)', () => {
    expect(worstOverMap(ximendingSkyline(), 'taipei', false)).toBeGreaterThan(0.3);
    expect(worstOverMap(xinyiSkyline(), 'xinyi', false)).toBeGreaterThan(5);
  });
});
