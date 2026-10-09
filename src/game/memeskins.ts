/**
 * National Day reskins (cosmetic only): the knife is a 藍白拖 (the blue-and-white rubber slipper) and
 * the M18 is a 珍奶煙霧彈 (a bubble-tea cup; its cloud is milk tea with tapioca pearls). Weapon ids,
 * stats and the rules (smoke still blocks sight exactly as before) are untouched; only models, the
 * cloud's look, sounds and names change. One switch: set DEFAULT to false to turn both off, or open
 * the game with `?classic=1` for the original knife and M18.
 */
const DEFAULT = true;

/** Whether `search` (a URL query) asks for the classic look. */
export const classicRequested = (search: string) => /(?:^|[?&])classic=(?:1|true|yes)(?:&|$)/i.test(search);

/** The reskins are on: the default, unless the page asks for `?classic=1`. */
export function memeSkinsOn(search: string | undefined, fallback = DEFAULT) {
  return fallback && !(search !== undefined && classicRequested(search));
}

export const MEME_SKINS = memeSkinsOn(typeof location === 'undefined' ? undefined : location.search);

if (typeof document !== 'undefined') document.documentElement.classList.toggle('meme-skins', MEME_SKINS);

/** Kill-feed mark for a slipper kill: a little blue-and-white 藍白拖 with motion lines. */
export const SLIPPER_ICON = '<svg class="slipper" viewBox="0 0 40 20" aria-hidden="true">'
  + '<path d="M1 6h6M0 10h6M1 14h6" stroke="#ffd34d" stroke-width="1.6" stroke-linecap="round"/>'
  + '<path d="M10 10c0-4.5 3-6.5 8-6.5h11c5.5 0 9.5 2.6 9.5 6.5s-4 6.5-9.5 6.5H18c-5 0-8-2-8-6.5z" fill="#f4f6f4" stroke="#1f5bd1" stroke-width="1.6"/>'
  + '<path d="M26 3.6c1.6 2 1.6 10.8 0 12.8M30.5 3.8c1.6 2 1.6 10.4 0 12.4" stroke="#2f6fe0" stroke-width="3.2" fill="none" stroke-linecap="round"/></svg>';
