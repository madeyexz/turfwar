import { describe, expect, it } from 'vitest';
import {
  acceptPerf, acceptVisit, channelOf, COUNT_STEP_MAX, countRoomEvent, FrameHistogram, foldRoomMinute, noteMilestones, PERF_RATE_LIMIT_MICROS,
  VISIT_RATE_LIMIT_MICROS, type PerfReport, type VisitReport,
} from './metrics';

const S = 1_000_000n;

describe('frame histogram', () => {
  it('gives the median fps and the 1% low', () => {
    const h = new FrameHistogram();
    for (let i = 0; i < 990; i++) h.add(16.7);
    for (let i = 0; i < 10; i++) h.add(50);
    const s = h.stats();
    expect(s.frames).toBe(1000);
    expect(s.fps).toBeCloseTo(58.8, 1);
    expect(s.low).toBeCloseTo(58.8, 1);
    h.add(50); h.add(50);
    expect(h.stats().low).toBe(20);
  });
  it('ignores gaps (a hidden tab) and nonsense, and resets', () => {
    const h = new FrameHistogram();
    h.add(5000); h.add(-1); h.add(NaN); h.add(0);
    expect(h.stats()).toEqual({ fps: 0, low: 0, frames: 0, seconds: 0 });
    h.add(400);
    expect(h.stats().low).toBe(4);
    h.reset();
    expect(h.frames).toBe(0);
  });
});

describe('perf reports', () => {
  const r = (o: Partial<PerfReport> = {}): PerfReport => ({ fps: 60, low: 40, seconds: 120, waitMs: 0, bootMs: 0, ...o });
  it('folds frame rate weighted by seconds and averages load times', () => {
    const a = acceptPerf(undefined, r({ waitMs: 3000, bootMs: 5000 }), 1000n * S)!;
    expect(a).toMatchObject({ reports: 1, seconds: 120, fpsSum: 7200, lowSum: 4800, waits: 1, waitMsSum: 3000, boots: 1, bootMsSum: 5000 });
    const b = acceptPerf(a, r({ fps: 30, low: 20, seconds: 60 }), 1000n * S + 120n * S)!;
    expect(b.seconds).toBe(180);
    expect(b.fpsSum / b.seconds).toBe(50);
    expect(b.waits).toBe(1);
  });
  it('rate limits, clamps and refuses empty reports', () => {
    const a = acceptPerf(undefined, r(), 1000n * S)!;
    expect(acceptPerf(a, r(), 1000n * S + PERF_RATE_LIMIT_MICROS - 1n)).toBeUndefined();
    // Seconds cannot exceed the wall clock since the previous report (plus a minute).
    const b = acceptPerf(a, r({ seconds: 86_400 }), 1000n * S + 40n * S)!;
    expect(b.seconds - a.seconds).toBe(100);
    const c = acceptPerf(undefined, r({ fps: 999, low: 999 }), 0n)!;
    expect(c.lastFps).toBe(240); expect(c.lastLow).toBe(240);
    expect(acceptPerf(undefined, r({ low: 90 }), 0n)!.lastLow).toBe(60);
    expect(acceptPerf(undefined, r({ fps: 0, seconds: 0 }), 0n)).toBeUndefined();
    // A load time alone counts; one over two minutes does not.
    expect(acceptPerf(undefined, r({ fps: 0, seconds: 0, waitMs: 4000 }), 0n)!.waits).toBe(1);
    expect(acceptPerf(undefined, r({ fps: 0, seconds: 0, waitMs: 500_000 }), 0n)).toBeUndefined();
  });
});

describe('visits', () => {
  const v = (o: Partial<VisitReport> = {}): VisitReport => ({ source: 'threads', medium: 'social', campaign: 'launch', inApp: 'threads', refBy: '', ref: 'abc12345', shares: 0, duels: 0, ...o });
  it('keeps the first touch, the app and the arrival code once', () => {
    const a = acceptVisit(undefined, v({ refBy: 'zzz99999', source: 'Threads!' }), 1n)!;
    expect(a).toMatchObject({ source: 'threads', medium: 'social', inApp: 'threads', refBy: 'zzz99999', ref: 'abc12345' });
    const b = acceptVisit(a, v({ source: 'google', inApp: '', refBy: 'yyy88888' }), 1n + VISIT_RATE_LIMIT_MICROS)!;
    expect(b).toMatchObject({ source: 'threads', inApp: 'threads', refBy: 'zzz99999' });
    expect(acceptVisit(undefined, v({ source: '' }), 1n)!.source).toBe('direct');
  });
  it('never counts a player as invited by their own code; bad codes are dropped', () => {
    expect(acceptVisit(undefined, v({ refBy: 'abc12345' }), 1n)!.refBy).toBe('');
    expect(acceptVisit(undefined, v({ refBy: 'BAD!', ref: 'x' }), 1n)).toMatchObject({ refBy: '', ref: '' });
  });
  it('lets counts only grow, a little per report', () => {
    const a = acceptVisit(undefined, v({ shares: 3, duels: 1 }), 1n)!;
    const b = acceptVisit(a, v({ shares: 1, duels: 10_000 }), 1n + VISIT_RATE_LIMIT_MICROS)!;
    expect(b.shares).toBe(3);
    expect(b.duels).toBe(1 + COUNT_STEP_MAX);
    expect(acceptVisit(b, v(), 2n + VISIT_RATE_LIMIT_MICROS)).toBeUndefined();
  });
  it('names the channel: the in-app browser, else the source', () => {
    expect(channelOf({ source: 'google', inApp: 'threads' })).toBe('threads app');
    expect(channelOf({ source: 'google', inApp: '' })).toBe('google');
  });
});

describe('milestones', () => {
  it('stamps each first once', () => {
    const a = noteMilestones(undefined, { room: true }, 10n)!;
    expect(a).toEqual({ room: 10n, round: 0n, kill: 0n, match: 0n });
    expect(noteMilestones(a, { room: true }, 20n)).toBeUndefined();
    const b = noteMilestones(a, { rounds: 1, kills: 0 }, 30n)!;
    expect(b).toEqual({ room: 10n, round: 30n, kill: 0n, match: 0n });
    const c = noteMilestones(b, { rounds: 2, kills: 1, matches: 1 }, 40n)!;
    expect(c).toEqual({ room: 10n, round: 30n, kill: 40n, match: 40n });
  });
});

describe('room hours', () => {
  it('adds a room minute and counts events', () => {
    let h = foldRoomMinute(undefined, { seats: 12, humans: 3, bots: 9 });
    h = foldRoomMinute(h, { seats: 2, humans: 2, bots: 0 });
    h = countRoomEvent(countRoomEvent(h, 'joins'), 'drops');
    expect(h).toEqual({ roomMinutes: 2, seatMinutes: 14, humanMinutes: 5, botMinutes: 9, joins: 1, leaves: 0, drops: 1, kicks: 0 });
  });
});
