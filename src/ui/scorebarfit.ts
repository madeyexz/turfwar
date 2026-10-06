/**
 * Fitting the HUD's score bar between the touch buttons along the top edge (pure, so it is tested
 * without a browser; `Hud.fitScoreBar` measures and applies it).
 */

/** The bar's usual scale on touch screens, and the smallest at which the soldier chips stay readable. */
export const SCORE_BAR_MAX = 0.78;
export const SCORE_BAR_MIN_CHIPS = 0.55;
/** Never smaller than this (scores and clock alone always fit a phone at it). */
export const SCORE_BAR_MIN = 0.45;
/** Clear space kept between the bar and a button. */
const GAP = 12;

export interface Box { left: number; right: number; top: number; width: number }

/**
 * The room the centred bar has on a screen `width` wide: the buttons in the top band (above `band`)
 * push it in from whichever side they sit on, the same on both sides since it stays centred.
 */
export function scoreBarRoom(width: number, buttons: readonly Box[], band = 46): number {
  let reserve = 8;
  for (const b of buttons) {
    if (!b.width || b.top > band) continue;
    reserve = Math.max(reserve, (b.left + b.right) / 2 < width / 2 ? b.right + GAP : width - b.left + GAP);
  }
  return Math.max(120, width - 2 * reserve);
}

/**
 * The scale for a bar `full` pixels wide (with chips) in `room`: as large as fits up to the usual
 * scale; if the chips would drop below readable, without them (`tight()` measures that width).
 */
export function scoreBarFit(room: number, full: number, tight: () => number): { scale: number; tight: boolean } {
  const fit = (w: number) => Math.min(SCORE_BAR_MAX, room / Math.max(1, w));
  const withChips = fit(full);
  if (withChips >= SCORE_BAR_MIN_CHIPS) return { scale: withChips, tight: false };
  return { scale: Math.max(SCORE_BAR_MIN, fit(tight())), tight: true };
}
