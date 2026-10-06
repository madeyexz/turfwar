/**
 * Fonts for canvas-drawn text. CSS falls from Rajdhani (Latin) to the bundled Noto Sans TC for
 * Chinese (style.css); canvases use the same stacks. A canvas paints with whatever is loaded at
 * that moment, so code that bakes Chinese into a texture (the Taipei signs) waits for
 * `cjkFontReady(text)` first.
 */
export const CJK_FAMILY = 'Noto Sans TC';
/** Chinese signs and plates: the bundled face, then the platforms' own Traditional Chinese fonts. */
export const CJK_STACK = `'${CJK_FAMILY}','PingFang TC','Microsoft JhengHei','Heiti TC',sans-serif`;
/** HUD-style canvas text: Rajdhani for Latin, then the Chinese stack. */
export const UI_STACK = `Rajdhani,'Arial Narrow',${CJK_STACK}`;

/**
 * Resolves once the faces `text` needs at `weight` are loaded (immediately when it has no Chinese:
 * the face's unicode-range keeps it from downloading). Never rejects; gives up after `timeoutMs`
 * so a slow network cannot hold a level back for good.
 */
export function cjkFontReady(text: string, weight = 900, timeoutMs = 10_000): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  const load = document.fonts.load(`${weight} 32px '${CJK_FAMILY}'`, text || ' ').then(() => undefined, () => undefined);
  return Promise.race([load, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);
}
