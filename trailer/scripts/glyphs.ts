/**
 * Checks that the zh-TW card copy only uses characters the game's subset Noto Sans TC has (a missing
 * one would render as tofu or in a fallback font). The WOFF2 cmap reader follows src/ui/font.test.ts.
 *   bun trailer/scripts/glyphs.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { CARDS_ZH } from '../edit';
import { REPO } from './util';

/** WOFF2's known-table index (flags & 63); 63 means a 4-byte tag follows. */
const KNOWN = 'cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
  .match(/.{4}\s?/g)!.map(s => s.slice(0, 4));

function woff2Tables(file: Buffer) {
  if (file.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');
  const numTables = file.readUInt16BE(12), compressed = file.readUInt32BE(20);
  let p = 48;
  const base128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const b = file[p++]; v = v * 128 + (b & 127); if (!(b & 128)) return v; } throw new Error('bad UIntBase128'); };
  const dir: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = file[p++];
    const tag = (flags & 63) === 63 ? file.toString('latin1', p, (p += 4)) : KNOWN[flags & 63];
    const version = flags >> 6, origLength = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    dir.push({ tag, length: transformed ? base128() : origLength });
  }
  const data = brotliDecompressSync(file.subarray(p, p + compressed));
  const tables = new Map<string, Buffer>();
  let offset = 0;
  for (const t of dir) { tables.set(t.tag, data.subarray(offset, offset + t.length)); offset += t.length; }
  return tables;
}

function cmapCodePoints(cmap: Buffer) {
  const out = new Set<number>();
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8), encoding = cmap.readUInt16BE(6 + i * 8), at = cmap.readUInt32BE(8 + i * 8);
    if (platform !== 3 && platform !== 0) continue;
    const format = cmap.readUInt16BE(at);
    if (format === 12) {
      const groups = cmap.readUInt32BE(at + 12);
      for (let g = 0; g < groups; g++) {
        const start = cmap.readUInt32BE(at + 16 + g * 12), end = cmap.readUInt32BE(at + 20 + g * 12);
        for (let c = start; c <= end; c++) out.add(c);
      }
    } else if (format === 4 && encoding !== 0) {
      const segs = cmap.readUInt16BE(at + 6) / 2;
      const ends = at + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
      for (let s = 0; s < segs; s++) {
        const end = cmap.readUInt16BE(ends + s * 2), start = cmap.readUInt16BE(starts + s * 2);
        const delta = cmap.readInt16BE(deltas + s * 2), range = cmap.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const glyph = range === 0 ? (c + delta) & 0xffff : cmap.readUInt16BE(ranges + s * 2 + range + (c - start) * 2);
          if (glyph) out.add(c);
        }
      }
    }
  }
  return out;
}

/** Characters of the zh-TW copy (beyond Latin and general punctuation) the font lacks. */
export function missingGlyphs() {
  const have = cmapCodePoints(woff2Tables(readFileSync(join(REPO, 'public/fonts/noto-sans-tc.woff2'))).get('cmap')!);
  const missing = new Set<string>();
  for (const lines of Object.values(CARDS_ZH)) for (const ch of lines.join('')) if (ch.codePointAt(0)! > 0x2e7f && !have.has(ch.codePointAt(0)!)) missing.add(ch);
  return [...missing];
}

if (import.meta.main) {
  const missing = missingGlyphs();
  if (missing.length) { console.error(`not in Noto Sans TC (subset): ${missing.join(' ')}`); process.exit(1); }
  console.log('every zh-TW card character is in the game font');
}
