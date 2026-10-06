import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cjkChars, cjkUnicodeRange } from './cjk';

const ROOT = join(__dirname, '../..');
const FONT = join(ROOT, 'public/fonts/noto-sans-tc.woff2');

/** WOFF2's known-table index (flags & 63); 63 means a 4-byte tag follows. */
const KNOWN = 'cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
  .match(/.{4}\s?/g)!.map(s => s.slice(0, 4));

/** The decompressed tables of a WOFF2 file (just enough of the format to read cmap and maxp). */
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
    // glyf/loca are transformed unless version 3; every other table only when version is not 0.
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    dir.push({ tag, length: transformed ? base128() : origLength });
  }
  const data = brotliDecompressSync(file.subarray(p, p + compressed));
  const tables = new Map<string, Buffer>();
  let offset = 0;
  for (const t of dir) { tables.set(t.tag, data.subarray(offset, offset + t.length)); offset += t.length; }
  return tables;
}

/** Code points the font maps to a glyph (cmap formats 4 and 12, Windows Unicode subtables). */
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

/** Every CJK character in the game's source (UI translations, map signage, comments included). */
function sourceChars() {
  const chars = new Set<string>();
  const scan = (path: string) => {
    if (statSync(path).isDirectory()) { for (const f of readdirSync(path)) scan(join(path, f)); return; }
    if (['.ts', '.css', '.html', '.json'].includes(extname(path)) && !path.endsWith('.test.ts')) cjkChars(readFileSync(path, 'utf8'), chars);
  };
  for (const p of ['src', 'shared', 'index.html']) scan(join(ROOT, p));
  return chars;
}

describe('bundled Traditional Chinese font', () => {
  const tables = woff2Tables(readFileSync(FONT));
  const mapped = cmapCodePoints(tables.get('cmap')!);

  it('has every Chinese character the game draws (re-run `bun tools/subset-font.ts` if this fails)', () => {
    const chars = sourceChars();
    expect(chars.size).toBeGreaterThan(500);
    const missing = [...chars].filter(ch => !mapped.has(ch.codePointAt(0)!));
    expect(missing.join('')).toBe('');
  });

  it("has Taiwan's 4,808 common characters and the full-width punctuation", () => {
    const common = readFileSync(join(ROOT, 'tools/font/edu-standard-4808.txt'), 'utf8').split('\n').filter(l => !l.startsWith('#')).join('');
    expect([...common].length).toBe(4808);
    expect([...common].filter(ch => !mapped.has(ch.codePointAt(0)!)).join('')).toBe('');
    expect([...'，。、：；！？（）「」『』《》【】ㄅㄆㄇ'].filter(ch => !mapped.has(ch.codePointAt(0)!)).join('')).toBe('');
    // About 5,000 glyphs; the size stays well under 2 MB.
    expect(tables.get('maxp')!.readUInt16BE(4)).toBeGreaterThan(5000);
    expect(statSync(FONT).size).toBeLessThan(2_000_000);
  });

  it("is declared for exactly the code points src/ui/cjk.ts calls Chinese", () => {
    const css = readFileSync(join(ROOT, 'src/style.css'), 'utf8');
    const face = /@font-face\s*\{[^}]*'Noto Sans TC'[^}]*\}/.exec(css)?.[0] ?? '';
    expect(face).toContain('/fonts/noto-sans-tc.woff2');
    expect(/unicode-range:\s*([^;]+);/.exec(face)?.[1].trim()).toBe(cjkUnicodeRange());
  });
});
