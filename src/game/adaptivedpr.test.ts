import { describe, expect, it } from 'vitest';
import { AdaptiveDpr, PHONE_ADAPTIVE_DPR, basePixelRatio } from './adaptivedpr';

/** Run `seconds` of frames at `fps`; returns how many times the multiplier changed. */
function run(a: AdaptiveDpr, fps: number, seconds: number, active = true) {
  let changes = 0;
  for (let i = Math.round(seconds * fps); i > 0; i--) if (a.frame(1 / fps, active)) changes++;
  return changes;
}
/** The first active frame and the 2 s grace after it. */
const start = (a: AdaptiveDpr, fps: number) => run(a, fps, 2 + 1 / fps);
/**
 * Run `seconds` of a GPU-bound phone: 13 frames in every 100 take 22 ms (late), the rest 16.2 ms,
 * so the frame rate averages about 59 fps. Returns how many times the multiplier changed.
 */
function runStutter(a: AdaptiveDpr, seconds: number) {
  let changes = 0;
  for (let i = 0, t = 0; t < seconds; i++) {
    const dt = (i * 13) % 100 < 13 ? 0.022 : 0.0162;
    t += dt;
    if (a.frame(dt, true)) changes++;
  }
  return changes;
}

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

  it('on phones, a steady 57 fps steps down once and stays at the size that holds 60', () => {
    const a = new AdaptiveDpr(PHONE_ADAPTIVE_DPR);
    start(a, 57);
    run(a, 57, 4);
    expect(a.multiplier).toBe(0.9);
    // Smooth at the smaller size: it does not climb back into the size that ran slow.
    expect(run(a, 60, 60)).toBe(0);
    expect(a.multiplier).toBe(0.9);
  });

  it('on phones, a heavy stretch steps further down and recovers only to the last size that held', () => {
    const a = new AdaptiveDpr(PHONE_ADAPTIVE_DPR);
    start(a, 57);
    run(a, 57, 4);      // 1 → 0.9 (1 ran slow)
    run(a, 40, 8);      // 0.9 → 0.8 → 0.7 (a heavy fight)
    expect(a.multiplier).toBe(0.7);
    run(a, 60, 60);     // smooth again: nothing above 0.7 is proven, so it stays
    expect(a.multiplier).toBe(0.7);
  });

  it('on phones, 13% late frames step down once even at a 59 fps average, then hold at 60', () => {
    const a = new AdaptiveDpr(PHONE_ADAPTIVE_DPR);
    start(a, 60);
    expect(runStutter(a, 4)).toBe(1);
    expect(a.multiplier).toBe(0.9);
    // Clean at the smaller size: it stays there (the full size ran late).
    expect(run(a, 60, 60)).toBe(0);
    expect(a.multiplier).toBe(0.9);
  });

  it('on phones, a clean vsynced 59.9 fps with no late frames never steps', () => {
    const a = new AdaptiveDpr(PHONE_ADAPTIVE_DPR);
    expect(start(a, 59.9) + run(a, 59.9, 60)).toBe(0);
    expect(a.multiplier).toBe(1);
  });

  it('desktops ignore late frames: the same 13%-late pattern does not step', () => {
    const a = new AdaptiveDpr();
    start(a, 60);
    expect(runStutter(a, 40)).toBe(0);
    expect(a.multiplier).toBe(1);
  });

  it('desktops keep the 30 fps floor: 57 fps is fine', () => {
    const a = new AdaptiveDpr();
    start(a, 57);
    expect(run(a, 57, 40)).toBe(0);
    expect(a.multiplier).toBe(1);
  });

  it('on phones, a step for late frames that does not help is undone and late frames stop steering', () => {
    // The iPhone case: still ~13% late at a smaller size, so the pixels were not the cause.
    const a = new AdaptiveDpr(PHONE_ADAPTIVE_DPR);
    start(a, 60);
    runStutter(a, 4.05);
    expect(a.multiplier).toBe(0.9);
    runStutter(a, 4.05);              // no better at 0.9: back to full size
    expect(a.multiplier).toBe(1);
    expect(runStutter(a, 60)).toBe(0); // and late frames alone no longer move it
    expect(a.multiplier).toBe(1);
  });

  it('on phones, late frames alone never take it under 0.8; a low average still can', () => {
    const a = new AdaptiveDpr(PHONE_ADAPTIVE_DPR);
    start(a, 60);
    runStutter(a, 4.05);              // late: 1 → 0.9
    run(a, 60, 4.01);                 // that helped (no late frames): keeps 0.9
    expect(a.multiplier).toBe(0.9);
    runStutter(a, 4.05);              // late again: 0.9 → 0.8
    run(a, 60, 4.01);
    expect(a.multiplier).toBe(0.8);
    runStutter(a, 20);                // late again, but 0.8 is the floor for late frames
    expect(a.multiplier).toBe(0.8);
    run(a, 25, 8.1);                  // a genuinely slow phone (25 fps) still steps down
    expect(a.multiplier).toBeLessThan(0.8);
  });
});

