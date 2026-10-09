/**
 * Generate browser, home-screen and Android adaptive icons from app-icon.png.
 * The source artwork was generated with Amp Painter for Turf War: Taipei.
 * Run: bun install --cwd tools --frozen-lockfile && bun tools/make-icons.ts
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const OUT = join(import.meta.dir, '..', 'public', 'icons');
const SOURCE = join(import.meta.dir, 'app-icon.png');
const background = '#05090c';

mkdirSync(OUT, { recursive: true });
const icons: [string, number, number][] = [
  ['favicon-16.png', 16, 1], ['favicon-32.png', 32, 1],
  ['icon-192.png', 192, 1], ['icon-512.png', 512, 1],
  // Keep the entire emblem inside Android's central 80%-diameter safe circle.
  ['maskable-192.png', 192, 0.7], ['maskable-512.png', 512, 0.7],
  // iOS applies its own rounded mask to the full, opaque square.
  ['apple-touch-icon.png', 180, 1],
];
for (const [name, size, scale] of icons) {
  const mark = await sharp(SOURCE).resize(Math.round(size * scale)).flatten({ background }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 3, background } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png().toFile(join(OUT, name));
  console.log('wrote', join('public/icons', name));
}
