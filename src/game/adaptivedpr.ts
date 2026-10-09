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
 * With `lateShare`, a window in which more than that share of frames was late (`LATE_FRAME_MS`) steps
 * down even when its average is fine, and a step up also needs the late share at or under it.
 */
export interface AdaptiveDprOptions { min: number; max: number; step: number; slow: number; fast: number; delay: number; window: number; sample: number; maxTurns: number; remember?: boolean; lateShare?: number; lateFloor?: number }

/** A late frame: slower than a 60 Hz frame with 1.5 ms of scheduling slack (the benchmark's measure too). */
export const LATE_FRAME_MS = 1000 / 60 + 1.5;

export const ADAPTIVE_DPR: AdaptiveDprOptions = { min: 0.6, max: 1, step: 0.1, slow: 30, fast: 60, delay: 2, window: 4, sample: 0.5, maxTurns: 4 };

/**
 * Phones (the low preset): aim for a steady 60. An iPhone measured 57 fps on average with a fifth of
 * its frames late at full size (GPU-bound, CPU at 4 ms), which Messenger's 30 fps floor never acts on.
 * Another averaged 58.4 fps with 13% of its frames late: every window averaged 58 or more, so only
 * the late share (over 5%) catches it.
 *
 * Late frames are not always the pixels: the same iPhone dropped all the way to 0.6 (671×378) and still
 * had 8% of its frames late. So a step taken for late frames alone goes no lower than `lateFloor`, and
 * one that does not cut the late share by a third is undone and late frames stop steering (see frame).
 */
export const PHONE_ADAPTIVE_DPR: Partial<AdaptiveDprOptions> = { slow: 58, remember: true, lateShare: 0.05, lateFloor: 0.8 };

/** A step for late frames must cut the late share to this fraction of what it was, or it is undone. */
const LATE_HELPS = 0.67;

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
  private windowFrames = 0;
  private windowLate = 0;
  private direction = 0;
  private turns = 0;
  private wasActive = false;
  /** The largest multiplier still allowed (`remember`): just under the smallest one that ran slow. */
  private ceiling: number;
  /** The late share of the window that made the last step for late frames (checked by the next window). */
  private lateBefore?: number;
  /** Late frames stopped steering: a smaller size did not help, so they are not the pixels' fault. */
  private lateOff = false;

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
    this.windowTime += dt; this.windowFrames++;
    if (dt * 1000 > LATE_FRAME_MS) this.windowLate++;
    if (this.windowTime < this.o.window - EPS || !this.samples.length) return false;
    const fps = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    const share = this.windowFrames ? this.windowLate / this.windowFrames : 0;
    const late = this.o.lateShare !== undefined && !this.lateOff && share > this.o.lateShare;
    this.samples = []; this.windowTime = 0; this.windowFrames = 0; this.windowLate = 0;
    // The window after a step for late frames: if the smaller size did not help, take it back.
    if (this.lateBefore !== undefined) {
      const before = this.lateBefore;
      this.lateBefore = undefined;
      if (share > before * LATE_HELPS) {
        this.lateOff = true;
        const back = Math.round(Math.min(this.o.max, this.multiplier + this.o.step) * 1000) / 1000;
        this.ceiling = Math.max(this.ceiling, back);
        if (back !== this.multiplier) { this.multiplier = back; return true; }
        return false;
      }
    }
    // Rounded: a vsynced 60 Hz screen averages 59.9, which is 60.
    const rounded = Math.round(fps);
    const want = rounded < this.o.slow || late ? -1 : rounded >= this.o.fast ? 1 : 0;
    if (!want) return false;
    // A step for late frames alone (the average is fine) stops at lateFloor.
    const lateOnly = want < 0 && Math.round(fps) >= this.o.slow;
    const floor = lateOnly ? Math.max(this.o.min, this.o.lateFloor ?? this.o.min) : this.o.min;
    const next = Math.round(Math.min(this.ceiling, Math.max(floor, this.multiplier + want * this.o.step)) * 1000) / 1000;
    if (next === this.multiplier) return false;
    if (lateOnly) this.lateBefore = share;
    if (want < 0 && this.o.remember) this.ceiling = next;
    if (this.direction && want !== this.direction && ++this.turns >= this.o.maxTurns) this.settled = true;
    this.direction = want;
    this.multiplier = next;
    return true;
  }

  private reset() {
    this.wait = this.o.delay;
    this.sliceTime = 0; this.sliceFrames = 0; this.samples = []; this.windowTime = 0; this.windowFrames = 0; this.windowLate = 0;
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
