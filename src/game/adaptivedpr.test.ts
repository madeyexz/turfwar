import { describe, expect, it } from 'vitest';
import { AdaptiveDpr, basePixelRatio } from './adaptivedpr';

/** Run `seconds` of frames at `fps`; returns how many times the multiplier changed. */
function run(a: AdaptiveDpr, fps: number, seconds: number, active = true) {
  let changes = 0;
  for (let i = Math.round(seconds * fps); i > 0; i--) if (a.frame(1 / fps, active)) changes++;
  return changes;
}
/** The first active frame and the 2 s grace after it. */
const start = (a: AdaptiveDpr, fps: number) => run(a, fps, 2 + 1 / fps);

describe('AdaptiveDpr', () => {
  it('starts at full size and waits 2 s before judging', () => {
    const a = new AdaptiveDpr();
    expect(a.multiplier).toBe(1);
    run(a, 20, 2);
    expect(a.multiplier).toBe(1);
  });

  it('steps down 0.1 per 4 s window below 30 fps, to no less than 0.6', () => {
    const a = new AdaptiveDpr();
    start(a, 20);
    run(a, 20, 4);
    expect(a.multiplier).toBe(0.9);
    run(a, 20, 4);
    expect(a.multiplier).toBe(0.8);
    run(a, 20, 40);
    expect(a.multiplier).toBe(0.6);
  });

  it('holds between 30 and 60 fps and climbs back at 60', () => {
    const a = new AdaptiveDpr();
    start(a, 20);
    run(a, 20, 8);
    expect(a.multiplier).toBe(0.8);
    run(a, 45, 20);
    expect(a.multiplier).toBe(0.8);
    run(a, 60, 4);
    expect(a.multiplier).toBe(0.9);
    run(a, 60, 40);
    expect(a.multiplier).toBe(1);
  });

  it('a vsynced 60 Hz screen (59.9 fps) counts as 60', () => {
    const a = new AdaptiveDpr();
    start(a, 20);
    run(a, 20, 4);
    expect(a.multiplier).toBe(0.9);
    run(a, 59.9, 4.01);
    expect(a.multiplier).toBe(1);
  });

  it('ignores paused frames (loading, menus) and waits again after a pause', () => {
    const a = new AdaptiveDpr();
    run(a, 10, 30, false);
    expect(a.multiplier).toBe(1);
    start(a, 20);
    run(a, 20, 3);
    run(a, 20, 1, false);
    // The window restarts after the 2 s grace: 3 s more of slow frames is not a full window.
    start(a, 20);
    run(a, 20, 3);
    expect(a.multiplier).toBe(1);
    run(a, 20, 1);
    expect(a.multiplier).toBe(0.9);
  });

  it('treats a long frame (a hidden tab) as a pause, not a slow frame rate', () => {
    const a = new AdaptiveDpr();
    start(a, 60);
    run(a, 60, 3.9);
    a.frame(30, true);
    run(a, 60, 0.5);
    expect(a.multiplier).toBe(1);
  });

  it('settles for good after 4 changes of direction', () => {
    const a = new AdaptiveDpr();
    start(a, 20);
    const flip = (fps: number) => run(a, fps, 4);
    flip(20); // 0.9, down
    flip(60); // 1.0, turn 1
    flip(20); // 0.9, turn 2
    flip(60); // 1.0, turn 3
    expect(a.settled).toBe(false);
    flip(20); // 0.9, turn 4: taken, then settled
    expect(a.multiplier).toBe(0.9);
    expect(a.settled).toBe(true);
    expect(run(a, 60, 20)).toBe(0);
    expect(a.multiplier).toBe(0.9);
  });

  it('does not count a step it cannot take (already at the limit)', () => {
    const a = new AdaptiveDpr();
    expect(start(a, 60) + run(a, 60, 40)).toBe(0);
    expect(a.multiplier).toBe(1);
  });
});

describe('basePixelRatio', () => {
  it("is Messenger's phone cap: 1.15 up to ratio 2, 1.5 above", () => {
    expect(basePixelRatio('phone', 1)).toBe(1);
    expect(basePixelRatio('phone', 2)).toBe(1.15);
    expect(basePixelRatio('phone', 3)).toBe(1.5);
    expect(basePixelRatio('phone', 2.625)).toBe(1.5);
  });
  it('caps a number at the screen', () => {
    expect(basePixelRatio(1.5, 1)).toBe(1);
    expect(basePixelRatio(1.5, 2)).toBe(1.5);
  });
});
