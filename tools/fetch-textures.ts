/**
 * Downloads the CC0 Poly Haven surface textures used by the battlefields and re-encodes them
 * as compact 1K WebP files in public/assets/tex. Run: bun tools/fetch-textures.ts [name ...]
 * (names limit the download to those sets; the license file always lists every set).
 * Poly Haven assets are CC0 1.0 (https://polyhaven.com/license).
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dir, '../public/assets/tex');
mkdirSync(OUT, { recursive: true });

// [Poly Haven asset id, local name, diffuse saturation (1 = unchanged)]
const TEXTURES: [string, string, number?][] = [
  ['sand_01', 'sand'], ['rock_face', 'cliff'], ['dry_ground_rocks', 'dirt'],
  // The cracked boulder is warm brown; mostly desaturated it reads as glacial rock under the cold tint.
  ['snow_02', 'snow'], ['rock_boulder_cracked', 'icerock', 0.2],
  ['forest_ground_04', 'moss'], ['lichen_rock', 'lichen'], ['grass_path_2', 'path'],
  ['concrete_floor_02', 'concrete'], ['metal_plate', 'metalplate'], ['container_side', 'container'],
  // Realistic architecture for the BeGone maps.
  ['brick_wall_001', 'brick'], ['raw_plank_wall', 'planks'], ['worn_corrugated_iron', 'corrugated'],
  ['worn_mossy_plasterwall', 'plaster'], ['cobblestone_floor_08', 'cobble'],
  // Taipei: road asphalt, square sidewalk tiles, shop floors and mosaic-tiled facades.
  ['asphalt_02', 'asphalt'], ['grey_tiles', 'sidewalk', 0], ['floor_tiles_06', 'floortile'], ['long_white_tiles', 'facadetile'],
];

const only = process.argv.slice(2);
for (const [id, name, saturation = 1] of TEXTURES) {
  if (only.length && !only.includes(name)) continue;
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json() as Record<string, Record<string, Record<string, { url: string }>>>;
  for (const [map, suffix] of [['Diffuse', 'diff'], ['nor_gl', 'nor'], ['Rough', 'rough']] as const) {
    const url = files[map]?.['1k']?.jpg?.url;
    if (!url) { console.warn('missing', id, map); continue; }
    const input = Buffer.from(await (await fetch(url)).arrayBuffer());
    let image = sharp(input).resize(1024, 1024);
    if (suffix === 'diff' && saturation !== 1) image = image.modulate({ saturation });
    const out = await image.webp({ quality: suffix === 'diff' ? 82 : 78 }).toBuffer();
    writeFileSync(join(OUT, `${name}_${suffix}.webp`), out);
    console.log(name, suffix, out.length);
  }
}
const credits = TEXTURES.map(([id, name]) => `${name}: https://polyhaven.com/a/${id}`);
writeFileSync(join(OUT, 'LICENSE.txt'), `Surface textures from Poly Haven (https://polyhaven.com), CC0 1.0 Universal.\nResized to 1024px WebP by tools/fetch-textures.ts (icerock diffuse desaturated to 20%, sidewalk fully).\n\n${credits.join('\n')}\n`);
