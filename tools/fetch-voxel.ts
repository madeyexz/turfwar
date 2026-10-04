/**
 * Downloads Kenney's CC0 Voxel Pack and copies the block tiles the voxel battlefield uses into
 * public/assets/voxel as small WebP files. Run: bun tools/fetch-voxel.ts
 * Kenney assets are CC0 1.0 (https://kenney.nl/assets/voxel-pack).
 */
import sharp from 'sharp';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PACK = 'https://kenney.nl/media/pages/assets/voxel-pack/a3a73d0ff7-1677662501/kenney_voxel-pack.zip';
const OUT = join(import.meta.dir, '../public/assets/voxel');

// [pack tile, local name]; local names match VoxelId faces in src/render/voxel.ts.
const TILES: [string, string][] = [
  ['grass_top', 'grass_top'], ['dirt_grass', 'grass_side'], ['dirt', 'dirt'], ['stone', 'stone'],
  ['greystone', 'cobble'], ['gravel_stone', 'gravel'], ['sand', 'sand'], ['wood', 'planks'],
  ['trunk_side', 'log_side'], ['trunk_top', 'log_top'], ['leaves', 'leaves'], ['brick_grey', 'stonebrick'],
  ['brick_red', 'brick'], ['glass_frame', 'glass'], ['water', 'water'], ['stone_coal', 'ore_coal'],
  ['stone_gold', 'ore_gold'], ['stone_diamond', 'ore_diamond'], ['cotton_blue', 'wool_blue'], ['cotton_red', 'wool_red'],
  ['snow', 'snow'], ['dirt_snow', 'snow_side'], ['wheat_stage4', 'wheat'], ['wood_red', 'planks_red'],
];

const work = mkdtempSync(join(tmpdir(), 'voxel-'));
const zip = join(work, 'pack.zip');
writeFileSync(zip, Buffer.from(await (await fetch(PACK)).arrayBuffer()));
const unzip = Bun.spawnSync(['unzip', '-q', zip, '-d', work]);
if (unzip.exitCode !== 0) throw new Error(unzip.stderr.toString());

mkdirSync(OUT, { recursive: true });
for (const [tile, name] of TILES) {
  const out = await sharp(readFileSync(join(work, 'PNG/Tiles', `${tile}.png`))).resize(64, 64).webp({ lossless: true }).toBuffer();
  writeFileSync(join(OUT, `${name}.webp`), out);
  console.log(name, out.length);
}
writeFileSync(join(OUT, 'LICENSE.txt'), `Block tiles from Kenney's Voxel Pack (https://kenney.nl/assets/voxel-pack), CC0 1.0 Universal.
Resized to 64px lossless WebP by tools/fetch-voxel.ts.

${TILES.map(([tile, name]) => `${name}: PNG/Tiles/${tile}.png`).join('\n')}
`);
