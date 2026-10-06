/**
 * App icons for the web app manifest and iOS, drawn from the game's brand mark (the favicon in
 * index.html: a dark tile, a cyan orbit and a white diamond) with no dependencies: the mark is
 * rasterised analytically with 6×6 supersampling and written as PNG through node:zlib.
 *
 *   bun tools/make-icons.ts      → public/icons/{icon,maskable}-{192,512}.png, apple-touch-icon.png
 *
 * "any" icons keep the rounded tile with transparent corners; maskable ones (Android adaptive icons)
 * fill the square and keep the mark inside the central safe zone; the Apple icon is a full square
 * (iOS rounds it itself).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = join(import.meta.dir, '..', 'public', 'icons');
const BG = [5, 9, 12], RING = [127, 246, 255], GEM = [233, 243, 245];

/** Coverage of the mark's parts at a point of its 64-unit box. */
function sample(x: number, y: number, tile: 'rounded' | 'full') {
  // Tile.
  let bg = 1;
  if (tile === 'rounded') {
    const r = 12, cx = Math.max(r, Math.min(64 - r, x)), cy = Math.max(r, Math.min(64 - r, y));
    bg = x >= 0 && x <= 64 && y >= 0 && y <= 64 && Math.hypot(x - cx, y - cy) <= r ? 1 : 0;
  }
  // Orbit: ellipse rx 27, ry 12 rotated -40° about the centre, stroke 3.
  const a = 40 * Math.PI / 180, dx = x - 32, dy = y - 32;
  const ex = dx * Math.cos(a) - dy * Math.sin(a), ey = dx * Math.sin(a) + dy * Math.cos(a);
  const rx = 27, ry = 12, f = (ex / rx) ** 2 + (ey / ry) ** 2 - 1;
  const grad = 2 * Math.hypot(ex / (rx * rx), ey / (ry * ry)) || 1;
  const ring = Math.abs(f) / grad <= 1.5 ? 1 : 0;
  // Diamond: (32,14) (46,32) (32,50) (18,32).
  const gem = Math.abs(dx) / 14 + Math.abs(dy) / 18 <= 1 ? 1 : 0;
  return { bg, ring, gem };
}

function render(size: number, tile: 'rounded' | 'full', scale: number): Buffer {
  const px = Buffer.alloc(size * size * 4);
  const N = 6;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0, al = 0;
    for (let sj = 0; sj < N; sj++) for (let si = 0; si < N; si++) {
      // Pixel to the 64-unit box; the mark (not the tile) shrinks by `scale` about the centre.
      const ux = (i + (si + 0.5) / N) / size * 64, uy = (j + (sj + 0.5) / N) / size * 64;
      const mx = 32 + (ux - 32) / scale, my = 32 + (uy - 32) / scale;
      const tileHit = sample(ux, uy, tile).bg, s = sample(mx, my, tile);
      if (!tileHit) continue;
      const c = s.gem ? GEM : s.ring ? RING : BG;
      r += c[0]; g += c[1]; b += c[2]; al += 1;
    }
    const o = (j * size + i) * 4;
    if (al) { px[o] = Math.round(r / al); px[o + 1] = Math.round(g / al); px[o + 2] = Math.round(b / al); }
    px[o + 3] = Math.round(al / (N * N) * 255);
  }
  return png(size, px);
}

// ---- PNG --------------------------------------------------------------------------------------

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf: Buffer) => { let c = -1; for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size: number, rgba: Buffer) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(OUT, { recursive: true });
const icons: [string, number, 'rounded' | 'full', number][] = [
  ['icon-192.png', 192, 'rounded', 1], ['icon-512.png', 512, 'rounded', 1],
  // Maskable: the launcher may crop to a circle of 80% of the square; keep the mark well inside it.
  ['maskable-192.png', 192, 'full', 0.72], ['maskable-512.png', 512, 'full', 0.72],
  ['apple-touch-icon.png', 180, 'full', 0.86],
];
for (const [name, size, tile, scale] of icons) {
  writeFileSync(join(OUT, name), render(size, tile, scale));
  console.log('wrote', join('public/icons', name));
}
