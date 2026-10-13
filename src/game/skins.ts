import { cleanSkin, type KnifeSkin, type Skin } from '../../shared/skins';

/**
 * This player's cosmetic skin (shared/skins.ts), picked in the lobby's 外觀 panel and saved per browser.
 * The knife is a 藍白拖 unless they pick the 掃把 or the classic knife; `?classic=1` still shows the
 * knife for one visit. Matches send it to the host (GameLink.wear), which every client draws from.
 */

const KEY = 'lawbreaker.skin';

/** Whether `search` (a URL query) asks for the classic knife. */
export const classicRequested = (search: string) => /(?:^|[?&])classic=(?:1|true|yes)(?:&|$)/i.test(search);

/** The skin saved as `stored` (JSON), with `?classic=1` in `search` swapping the knife back in. */
export function loadSkin(stored: string | null, search = ''): Skin {
  let raw: unknown;
  try { raw = stored ? JSON.parse(stored) : undefined; } catch { /* a damaged entry reads as the defaults */ }
  const skin = cleanSkin(raw);
  return classicRequested(search) ? { ...skin, knife: 'knife' } : skin;
}

const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
let current = loadSkin(stored(), typeof location === 'undefined' ? '' : location.search);
const listeners = new Set<(skin: Skin) => void>();

export const mySkin = (): Skin => current;

/** Wear `skin` from now on (saved; listeners such as the names and the lobby preview follow). */
export function chooseSkin(skin: Skin) {
  current = cleanSkin(skin);
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* storage disabled: this visit only */ }
  for (const f of listeners) f(current);
}

export function onSkinChange(f: (skin: Skin) => void) { listeners.add(f); return () => { listeners.delete(f); }; }

/** Kill-feed mark for a slipper kill: a little blue-and-white 藍白拖 with motion lines. */
export const SLIPPER_ICON = '<svg class="slipper" viewBox="0 0 40 20" aria-hidden="true">'
  + '<path d="M1 6h6M0 10h6M1 14h6" stroke="#ffd34d" stroke-width="1.6" stroke-linecap="round"/>'
  + '<path d="M10 10c0-4.5 3-6.5 8-6.5h11c5.5 0 9.5 2.6 9.5 6.5s-4 6.5-9.5 6.5H18c-5 0-8-2-8-6.5z" fill="#f4f6f4" stroke="#1f5bd1" stroke-width="1.6"/>'
  + '<path d="M26 3.6c1.6 2 1.6 10.8 0 12.8M30.5 3.8c1.6 2 1.6 10.4 0 12.4" stroke="#2f6fe0" stroke-width="3.2" fill="none" stroke-linecap="round"/></svg>';

/** Kill-feed mark for a broom kill: a 掃把 swung through, straw fanned out, with motion lines. */
export const BROOM_ICON = '<svg class="slipper broom" viewBox="0 0 40 20" aria-hidden="true">'
  + '<path d="M1 6h6M0 10h6M1 14h6" stroke="#ffd34d" stroke-width="1.6" stroke-linecap="round"/>'
  + '<path d="M10 10h16" stroke="#c0392b" stroke-width="2.6" stroke-linecap="round"/>'
  + '<path d="M25 7.6l3-.6v6l-3-.6z" fill="#2f8f4e"/>'
  + '<path d="M28 6.8L39 1.5v17L28 13.2z" fill="#e2c26a" stroke="#9b7a2c" stroke-width="1"/>'
  + '<path d="M30 6.5l8-3M30 10h8.5M30 13.5l8 3" stroke="#9b7a2c" stroke-width="0.8"/></svg>';

/** The kill-feed mark for a knife skin ('' for the plain knife). */
export const knifeIcon = (knife: KnifeSkin) => knife === 'slipper' ? SLIPPER_ICON : knife === 'broom' ? BROOM_ICON : '';
