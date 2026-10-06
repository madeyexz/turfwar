/**
 * Builds the Traditional Chinese UI font: Noto Sans TC (SIL OFL 1.1, Google Fonts), cut down to the
 * characters the game needs and saved as `public/fonts/noto-sans-tc.woff2` with its license next to it.
 *
 *   bun tools/subset-font.ts
 *
 * Kept: every CJK character in src/, shared/ and index.html (UI translations in src/ui/i18n.ts, map
 * signage drawn on canvases from shared/maps and src/render), Taiwan's 4,808 common characters
 * (tools/font/edu-standard-4808.txt, so player names and chat mostly render), CJK punctuation,
 * Bopomofo and the full-width forms. The weight axis is cut to 500–900: the UI uses 500/600/700
 * (Rajdhani's weights) and the canvas signs 900.
 *
 * Needs Python with fontTools and brotli. With `uv` installed nothing else is needed (it runs the
 * pinned versions below in a throwaway environment); otherwise `pip install fonttools==4.62.1 brotli`.
 * Re-run after adding Chinese text to the source; `bun run test` (src/ui/font.test.ts) fails while
 * any character is missing.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { CJK_RANGES, cjkChars } from '../src/ui/cjk';

const ROOT = join(import.meta.dir, '..');
const WORK = join(import.meta.dir, '.font-work');
const OUT = join(ROOT, 'public/fonts/noto-sans-tc.woff2');
const LICENSE = join(ROOT, 'public/fonts/NotoSansTC-OFL.txt');
/** google/fonts at a fixed commit, so a re-run produces the same font. */
const SOURCE = 'https://raw.githubusercontent.com/google/fonts/3be1884c48c3e45b52ecc725676a08f87776373e/ofl/notosanstc';
const FONTTOOLS = ['fonttools==4.62.1', 'brotli==1.1.0'];

mkdirSync(WORK, { recursive: true });
async function fetchOnce(name: string, file: string) {
  const path = join(WORK, file);
  if (!existsSync(path)) {
    console.log(`downloading ${name}`);
    const res = await fetch(`${SOURCE}/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return path;
}
const ttf = await fetchOnce('NotoSansTC[wght].ttf', 'NotoSansTC-VF.ttf');
const ofl = await fetchOnce('OFL.txt', 'OFL.txt');

// ---- Characters ----
const chars = new Set<string>();
const SCAN = ['src', 'shared', 'index.html'];
const TEXT = new Set(['.ts', '.css', '.html', '.json']);
function scan(path: string) {
  if (statSync(path).isDirectory()) { for (const f of readdirSync(path)) scan(join(path, f)); return; }
  // Tests are not drawn (i18n.test.ts lists Simplified characters on purpose).
  if (TEXT.has(extname(path)) && !path.endsWith('.test.ts')) cjkChars(readFileSync(path, 'utf8'), chars);
}
for (const p of SCAN) scan(join(ROOT, p));
const fromSource = chars.size;
const common = readFileSync(join(import.meta.dir, 'font/edu-standard-4808.txt'), 'utf8').split('\n').filter(l => !l.startsWith('#')).join('');
cjkChars(common, chars);
// Punctuation, Bopomofo and full-width forms in full (the ranges are small).
const BLOCKS: [number, number][] = [[0x3000, 0x303f], [0x3105, 0x312f], [0xfe10, 0xfe19], [0xfe30, 0xfe4f], [0xff01, 0xff65]];
for (const [a, b] of BLOCKS) for (let cp = a; cp <= b; cp++) chars.add(String.fromCodePoint(cp));
for (const ch of chars) {
  const cp = ch.codePointAt(0)!;
  if (!CJK_RANGES.some(([a, b]) => cp >= a && cp <= b)) throw new Error(`U+${cp.toString(16)} is outside the font's unicode-range`);
}
const textFile = join(WORK, 'chars.txt');
writeFileSync(textFile, [...chars].sort().join(''));
console.log(`${chars.size} characters (${fromSource} from the source)`);

// ---- Instance and subset ----
const uv = spawnSync('uv', ['--version']).status === 0;
function python(args: string[]) {
  const cmd = uv ? 'uv' : 'python3';
  const full = uv ? ['run', '--no-project', '--quiet', ...FONTTOOLS.flatMap(p => ['--with', p]), 'python', ...args] : args;
  const r = spawnSync(cmd, full, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${full.join(' ')} failed (${r.status})`);
  return r.stdout;
}
const limited = join(WORK, 'NotoSansTC-500-900.ttf');
python(['-m', 'fontTools.varLib.instancer', ttf, 'wght=500:900', '-o', limited, '-q']);
python(['-m', 'fontTools.subset', limited, `--text-file=${textFile}`, '--flavor=woff2', `--output-file=${OUT}`,
  // Name table: keep the family and license records; drop hinting the browsers ignore for CJK.
  '--name-IDs=0,1,2,3,4,5,6,13,14', '--no-hinting', '--desubroutinize']);
copyFileSync(ofl, LICENSE);

const stats = python(['-c', `from fontTools.ttLib import TTFont; f = TTFont(${JSON.stringify(OUT)}); print(f['maxp'].numGlyphs, len(f.getBestCmap()))`]).trim().split(' ');
console.log(`${OUT}: ${(statSync(OUT).size / 1024).toFixed(0)} KB, ${stats[0]} glyphs, ${stats[1]} characters mapped`);
