/**
 * Downloads the CC0 Poly Haven surface textures used by the battlefields and re-encodes them
 * as compact 1K WebP files in public/assets/tex. Run: bun tools/fetch-textures.ts
 * Poly Haven assets are CC0 1.0 (https://polyhaven.com/license).
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dir, '../public/assets/tex');
mkdirSync(OUT, { recursive: true });

// [Poly Haven asset id, local name]
const TEXTURES: [string, string][] = [
  ['sand_01', 'sand'], ['rock_face', 'cliff'], ['dry_ground_rocks', 'dirt'],
  ['snow_02', 'snow'], ['rock_boulder_cracked', 'icerock'],
  ['forest_ground_04', 'moss'], ['lichen_rock', 'lichen'], ['grass_path_2', 'path'],
  ['concrete_floor_02', 'concrete'], ['metal_plate', 'metalplate'], ['container_side', 'container'],
];

const credits: string[] = [];
for (const [id, name] of TEXTURES) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json() as Record<string, Record<string, Record<string, { url: string }>>>;
  for (const [map, suffix] of [['Diffuse', 'diff'], ['nor_gl', 'nor'], ['Rough', 'rough']] as const) {
    const url = files[map]?.['1k']?.jpg?.url;
    if (!url) { console.warn('missing', id, map); continue; }
    const input = Buffer.from(await (await fetch(url)).arrayBuffer());
    const out = await sharp(input).resize(1024, 1024).webp({ quality: suffix === 'diff' ? 82 : 78 }).toBuffer();
    writeFileSync(join(OUT, `${name}_${suffix}.webp`), out);
    console.log(name, suffix, out.length);
  }
  credits.push(`${name}: https://polyhaven.com/a/${id}`);
}
writeFileSync(join(OUT, 'LICENSE.txt'), `Surface textures from Poly Haven (https://polyhaven.com), CC0 1.0 Universal.\nResized to 1024px WebP by tools/fetch-textures.ts.\n\n${credits.join('\n')}\n`);
