/**
 * Adaptive resolution, after messenger.abeto.co: a multiplier on the quality's pixel ratio that
 * steps down when the frame rate is poor and back up when it is smooth. Every `sample` seconds the
 * frame rate over that slice is sampled; every `window` seconds the samples are averaged: below
 * `slow` fps the multiplier drops a `step` (not under `min`), at `fast` fps or more it rises a
 * `step` (not over `max`). It waits `delay` seconds of play before the first window (shaders and
 * textures still arrive then) and again after every pause (loading, menus), whose frames never
 * count. After `maxTurns` changes of direction (down then up, or up then down) it settles for good,
 * so a device on the edge does not flicker between two sizes. A step that turns counts and is
 * still taken. With `remember`, a size that once ran slow is never tried again this session: a phone
 * at 57 fps steps down, reaches 60 and stays there instead of climbing back into the size that dropped.
 */
export interface AdaptiveDprOptions { min: number; max: number; step: number; slow: number; fast: number; delay: number; window: number; sample: number; maxTurns: number; remember?: boolean }

export const ADAPTIVE_DPR: AdaptiveDprOptions = { min: 0.6, max: 1, step: 0.1, slow: 30, fast: 60, delay: 2, window: 4, sample: 0.5, maxTurns: 4 };

/**
 * Phones (the low preset): aim for a steady 60. An iPhone measured 57 fps on average with a fifth of
 * its frames late at full size (GPU-bound, CPU at 4 ms), which Messenger's 30 fps floor never acts on.
 */
export const PHONE_ADAPTIVE_DPR: Partial<AdaptiveDprOptions> = { slow: 58, remember: true };

/** Sums of frame times drift: a window of exactly 4 s ends on its last frame. */
const EPS = 1e-6;

export class AdaptiveDpr {
  multiplier: number;
  /** Settled: no more changes this session. */
  settled = false;
  private o: AdaptiveDprOptions;
  private wait: number;
  private sliceTime = 0;
  private sliceFrames = 0;
  private samples: number[] = [];
  private windowTime = 0;
  private direction = 0;
  private turns = 0;
  private wasActive = false;
  /** The largest multiplier still allowed (`remember`): just under the smallest one that ran slow. */
  private ceiling: number;

  constructor(options: Partial<AdaptiveDprOptions> = {}) {
    this.o = { ...ADAPTIVE_DPR, ...options };
    this.multiplier = this.o.max;
    this.ceiling = this.o.max;
    this.wait = this.o.delay;
  }

  /**
   * One rendered frame of `dt` seconds. `active`: a match is being played (not loading, not a menu).
   * Returns true when the multiplier changed (the caller resizes its buffers).
   */
  frame(dt: number, active: boolean): boolean {
    if (this.settled) return false;
    // A frame of half a second or more is a pause too (a hidden tab, a stall), not a frame rate.
    if (!active || dt >= 0.5) { this.wasActive = false; return false; }
    if (!this.wasActive) { this.wasActive = true; this.reset(); return false; }
    if (this.wait > EPS) { this.wait -= dt; return false; }
    this.sliceTime += dt; this.sliceFrames++;
    if (this.sliceTime >= this.o.sample - EPS) {
      this.samples.push(this.sliceFrames / this.sliceTime);
      this.sliceTime = 0; this.sliceFrames = 0;
    }
    this.windowTime += dt;
    if (this.windowTime < this.o.window - EPS || !this.samples.length) return false;
    const fps = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.samples = []; this.windowTime = 0;
    // Rounded: a vsynced 60 Hz screen averages 59.9, which is 60.
    const rounded = Math.round(fps);
    const want = rounded < this.o.slow ? -1 : rounded >= this.o.fast ? 1 : 0;
    if (!want) return false;
    const next = Math.round(Math.min(this.ceiling, Math.max(this.o.min, this.multiplier + want * this.o.step)) * 1000) / 1000;
    if (next === this.multiplier) return false;
    if (want < 0 && this.o.remember) this.ceiling = next;
    if (this.direction && want !== this.direction && ++this.turns >= this.o.maxTurns) this.settled = true;
    this.direction = want;
    this.multiplier = next;
    return true;
  }

  private reset() {
    this.wait = this.o.delay;
    this.sliceTime = 0; this.sliceFrames = 0; this.samples = []; this.windowTime = 0;
  }
}

/**
 * The pixel ratio a quality preset starts from (before the adaptive multiplier). `cap`: the preset's
 * own limit; 'phone' is Messenger's: up to 1.15 on screens of ratio 2 or less, up to 1.5 above.
 */
export function basePixelRatio(cap: number | 'phone', dpr: number) {
  if (cap === 'phone') return dpr <= 2 ? Math.min(dpr, 1.15) : Math.min(dpr, 1.5);
  return Math.min(dpr, cap);
}
