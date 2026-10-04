import * as THREE from 'three';
import type { Assets } from '../assets';
import type { VoxelId } from '../../shared/maps/types';

/** Kenney Voxel Pack tiles (CC0, see public/assets/voxel/LICENSE.txt) loaded by loadAssets. */
export const VOXEL_TILES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobble', 'gravel', 'sand', 'planks', 'planks_red', 'log_side', 'log_top',
  'leaves', 'stonebrick', 'brick', 'glass', 'water', 'ore_coal', 'ore_gold', 'ore_diamond', 'wool_blue', 'wool_red', 'snow', 'snow_side',
] as const;
type Tile = (typeof VOXEL_TILES)[number];

/** Tiles for the top, the top metre of the sides, the rest of the sides, and the bottom. */
const FACES: Record<VoxelId, [Tile, Tile, Tile, Tile]> = {
  grass: ['grass_top', 'grass_side', 'dirt', 'dirt'],
  snow: ['snow', 'snow_side', 'dirt', 'dirt'],
  dirt: ['dirt', 'dirt', 'dirt', 'dirt'],
  stone: ['stone', 'stone', 'stone', 'stone'],
  cobble: ['cobble', 'cobble', 'cobble', 'cobble'],
  gravel: ['gravel', 'gravel', 'gravel', 'gravel'],
  sand: ['sand', 'sand', 'sand', 'sand'],
  planks: ['planks', 'planks', 'planks', 'planks'],
  planksRed: ['planks_red', 'planks_red', 'planks_red', 'planks_red'],
  log: ['log_top', 'log_side', 'log_side', 'log_top'],
  leaves: ['leaves', 'leaves', 'leaves', 'leaves'],
  stonebrick: ['stonebrick', 'stonebrick', 'stonebrick', 'stonebrick'],
  brick: ['brick', 'brick', 'brick', 'brick'],
  glass: ['glass', 'glass', 'glass', 'glass'],
  coal: ['ore_coal', 'ore_coal', 'ore_coal', 'ore_coal'],
  gold: ['ore_gold', 'ore_gold', 'ore_gold', 'ore_gold'],
  diamond: ['ore_diamond', 'ore_diamond', 'ore_diamond', 'ore_diamond'],
  woolBlue: ['wool_blue', 'wool_blue', 'wool_blue', 'wool_blue'],
  woolRed: ['wool_red', 'wool_red', 'wool_red', 'wool_red'],
};

/** One material per tile, keyed `voxel:<tile>` in the level's material table. */
export function voxelMaterials(assets: Assets) {
  const out: Record<string, THREE.Material> = {};
  for (const tile of VOXEL_TILES) {
    const map = assets.textures.get(`voxel_${tile}`);
    const transparent = tile === 'glass' || tile === 'water';
    out[`voxel:${tile}`] = new THREE.MeshStandardMaterial({
      map, roughness: tile === 'glass' || tile === 'water' ? 0.2 : 0.95, metalness: 0, vertexColors: true,
      transparent, opacity: tile === 'water' ? 0.78 : 1, alphaTest: tile === 'glass' ? 0.1 : 0, depthWrite: tile !== 'water',
    });
  }
  return out;
}

/**
 * Faces of a block-textured box: one tile per metre in world space, so merged boxes of any size
 * read as a grid of 1 m cubes. Calls add(materialKey, geometry) for each tile used.
 */
export function voxelBox(id: VoxelId, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, add: (key: string, g: THREE.BufferGeometry) => void, scale = 1) {
  const [top, band, side, bottom] = FACES[id];
  const bandY = Math.max(minY, maxY - scale);
  add(`voxel:${top}`, quad([minX, maxY, maxZ], [maxX, maxY, maxZ], [maxX, maxY, minZ], [minX, maxY, minZ], [minX, -maxZ], [maxX, -maxZ], [maxX, -minZ], [minX, -minZ], scale, 1));
  if (minY > -1) add(`voxel:${bottom}`, quad([minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ], [minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ], scale, 0.8));
  const sides = (y0: number, y1: number, tile: Tile, v0: number) => {
    if (y1 - y0 < 0.01) return;
    const key = `voxel:${tile}`;
    const vb = v0, vt = v0 + (y1 - y0);
    // +Z, -Z, +X, -X faces, counter-clockwise from outside.
    add(key, quad([minX, y0, maxZ], [maxX, y0, maxZ], [maxX, y1, maxZ], [minX, y1, maxZ], [minX, vb], [maxX, vb], [maxX, vt], [minX, vt], scale, 0.86));
    add(key, quad([maxX, y0, minZ], [minX, y0, minZ], [minX, y1, minZ], [maxX, y1, minZ], [-maxX, vb], [-minX, vb], [-minX, vt], [-maxX, vt], scale, 0.86));
    add(key, quad([maxX, y0, maxZ], [maxX, y0, minZ], [maxX, y1, minZ], [maxX, y1, maxZ], [-maxZ, vb], [-minZ, vb], [-minZ, vt], [-maxZ, vt], scale, 0.93));
    add(key, quad([minX, y0, minZ], [minX, y0, maxZ], [minX, y1, maxZ], [minX, y1, minZ], [minZ, vb], [maxZ, vb], [maxZ, vt], [minZ, vt], scale, 0.93));
  };
  if (band === side) sides(minY, maxY, side, minY);
  else {
    // The grass band always shows the top metre of its tile, even on half-block steps.
    sides(bandY, maxY, band, scale - (maxY - bandY));
    sides(minY, bandY, side, minY);
  }
}

/** Quad with per-vertex UVs (in metres, divided by scale) and a flat shade for cheap face lighting. */
function quad(a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[], scale: number, shade: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  const uv = [ua, ub, uc, ua, uc, ud].flatMap(([u, v]) => [u / scale, v / scale]);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(18).fill(shade), 3));
  g.computeVertexNormals();
  return g;
}
