import { describe, expect, it } from 'vitest';
import { SCORE_BAR_MAX, SCORE_BAR_MIN, SCORE_BAR_MIN_CHIPS, scoreBarFit, scoreBarRoom, type Box } from './scorebarfit';

/** The default top-left round buttons (menu, scoreboard, chat, store) on a phone this wide. */
const topButtons = (w: number, size = 40): Box[] => [0.03, 0.085, 0.14, 0.195].map(x => ({ left: x * w - size / 2, right: x * w + size / 2, top: 9, width: size }));

describe('score bar on touch screens', () => {
  it('keeps clear of the top buttons on both sides, whichever side they are on', () => {
    // iPhone 14: the store button ends at 185 px, so the centred bar keeps 197 px each side.
    expect(scoreBarRoom(844, topButtons(844))).toBeCloseTo(844 - 2 * (0.195 * 844 + 20 + 12), 6);
    // Left-handed (mirrored) gives the same room.
    const mirrored = topButtons(844).map(b => ({ ...b, left: 844 - b.right, right: 844 - b.left }));
    expect(scoreBarRoom(844, mirrored)).toBeCloseTo(scoreBarRoom(844, topButtons(844)), 6);
    // Buttons lower down (binoculars, jump) and hidden ones do not count.
    expect(scoreBarRoom(844, [{ left: 700, right: 744, top: 56, width: 44 }, { left: 10, right: 400, top: 0, width: 0 }])).toBe(844 - 16);
  });

  it('6v6 on an iPhone 14 keeps the chips at about the usual size', () => {
    const fit = scoreBarFit(scoreBarRoom(844, topButtons(844)), 608, () => 224);
    expect(fit.tight).toBe(false);
    expect(fit.scale).toBeGreaterThan(0.7);
    expect(fit.scale * 608).toBeLessThanOrEqual(scoreBarRoom(844, topButtons(844)) + 1e-6);
  });

  it('24v24 drops the chips and shows the scores and clock at the usual size', () => {
    const fit = scoreBarFit(scoreBarRoom(844, topButtons(844)), 908, () => 224);
    expect(fit).toEqual({ scale: SCORE_BAR_MAX, tight: true });
  });

  it('never grows past the usual size nor shrinks past the floor', () => {
    expect(scoreBarFit(2000, 300, () => 200).scale).toBe(SCORE_BAR_MAX);
    expect(scoreBarFit(120, 900, () => 600)).toEqual({ scale: SCORE_BAR_MIN, tight: true });
    const edge = scoreBarFit(SCORE_BAR_MIN_CHIPS * 600, 600, () => 224);
    expect(edge.tight).toBe(false);
  });
});
