/**
 * Code points the bundled Traditional Chinese face (Noto Sans TC, `public/fonts/noto-sans-tc.woff2`)
 * is used for. Everything else stays on Rajdhani. The `@font-face` in style.css lists the same
 * ranges as its `unicode-range` (so English pages never download it), `tools/subset-font.ts` keeps
 * every such character the game's source uses, and `font.test.ts` checks both.
 */
export const CJK_RANGES: readonly (readonly [number, number])[] = [
  [0x2e80, 0x2fdf], // CJK and Kangxi radicals
  [0x3000, 0x303f], // CJK symbols and punctuation (、。「」『』【】〈〉…)
  [0x3100, 0x312f], // Bopomofo (ㄅㄆㄇ)
  [0x31a0, 0x31bf], // Bopomofo extended
  [0x3400, 0x4dbf], // CJK unified ideographs, extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe1f], // vertical forms
  [0xfe30, 0xfe4f], // CJK compatibility forms
  [0xff00, 0xffef], // half-width and full-width forms (，：！？（）)
];

export const isCjk = (cp: number) => CJK_RANGES.some(([a, b]) => cp >= a && cp <= b);

/** The ranges as a CSS `unicode-range` value. */
export const cjkUnicodeRange = () => CJK_RANGES.map(([a, b]) => `U+${a.toString(16).toUpperCase()}-${b.toString(16).toUpperCase()}`).join(', ');

/** Every distinct CJK character in `text`. */
export function cjkChars(text: string, into = new Set<string>()) {
  for (const ch of text) if (isCjk(ch.codePointAt(0)!)) into.add(ch);
  return into;
}
