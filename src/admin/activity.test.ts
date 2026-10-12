import { describe, expect, it } from 'vitest';
import { averageAtOnce, ccuByHour, compact, dauByDay, firstActiveDay, kpiChange, launchDay, pccuByDay, rollingActive } from './activity';
import type { PeakOf } from './peak';

const p = (...days: number[]) => ({ days: new Set(days) });
const peak = (hour: number, n: number, atMs = hour * 3_600_000 + 60_000): PeakOf => ({ hour, peak: n, phone: 0, computer: 0, atMs });
const H = 3_600_000;

/** Brute force: players with an active day in [d - window + 1, d]. */
const naive = (ps: { days: Set<number> }[], d: number, w: number) => ps.filter(x => [...x.days].some(a => a <= d && a > d - w)).length;

describe('DAU and MAU', () => {
  const players = [p(10, 11, 12), p(11), p(12, 40), p(5), p(45)];

  it('counts distinct players per day, zero on empty days', () => {
    const dau = dauByDay(players, 10, 13);
    expect([...dau]).toEqual([[10, 1], [11, 2], [12, 2], [13, 0]]);
  });

  it('rolls a 30-day window, each player once', () => {
    const mau = rollingActive(players, 10, 50);
    for (let d = 10; d <= 50; d++) expect(mau.get(d), `day ${d}`).toBe(naive(players, d, 30));
    expect(mau.get(12)).toBe(4); // day 5 still in the window ending on 12
    expect(mau.get(35)).toBe(3); // day 5's player has fallen out (its window ends on 34)
  });

  it('matches brute force on a random population, any window', () => {
    let s = 7;
    const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
    const ps = Array.from({ length: 200 }, () => p(...Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => Math.floor(rnd() * 90))));
    for (const w of [1, 7, 30]) {
      const r = rollingActive(ps, 0, 100, w);
      for (let d = 0; d <= 100; d++) expect(r.get(d)).toBe(naive(ps, d, w));
    }
  });

  it('finds the first recorded day', () => {
    expect(firstActiveDay(players)).toBe(5);
    expect(firstActiveDay([])).toBeUndefined();
  });
});

describe('CCU per hour', () => {
  const rooms = [{ hour: 100, humanMinutes: 120 }, { hour: 102, humanMinutes: 30 }];
  const peaks = [peak(100, 4), peak(102, 1)];

  it('averages human-minutes and keeps the hourly peak; recorded hours without rows are zero, earlier ones unknown', () => {
    const c = ccuByHour({ rooms, peaks, from: 99, to: 102, nowMs: 200 * H });
    expect(c.get(99)).toEqual({});
    expect(c.get(100)).toEqual({ avg: 2, peak: 4, peakAtMs: 100 * H + 60_000, source: 'rooms' });
    expect(c.get(101)).toEqual({ avg: 0, peak: 0, source: 'rooms' });
    expect(c.get(102)?.avg).toBe(0.5);
  });

  it('falls back to hourly play time before room minutes were recorded', () => {
    const c = ccuByHour({ rooms, peaks, playSeconds: new Map([[98, 5400], [99, 0]]), from: 97, to: 100, nowMs: 200 * H });
    expect(c.get(97)).toEqual({});
    expect(c.get(98)).toEqual({ avg: 1.5, source: 'play' });
    expect(c.get(99)).toEqual({ avg: 0, source: 'play' });
    expect(c.get(100)?.source).toBe('rooms');
  });

  it('averages the hour in progress over the minutes so far, and leaves future hours empty', () => {
    const c = ccuByHour({ rooms, peaks, from: 102, to: 103, nowMs: 102 * H + 15 * 60_000 });
    expect(c.get(102)?.avg).toBe(2);
    expect(c.get(103)).toEqual({});
  });
});

describe('PCCU per day', () => {
  it('takes the highest hour of each UTC day; unknown before recording, partial on its first day', () => {
    const rows = [peak(24 * 3 + 10, 5), peak(24 * 3 + 20, 9), peak(24 * 5 + 1, 2)];
    const d = pccuByDay(rows, 2, 6);
    expect(d.get(2)).toBeUndefined();
    expect(d.get(3)).toEqual({ peak: 9, atMs: (24 * 3 + 20) * H + 60_000, partial: true });
    expect(d.get(4)).toEqual({ peak: 0, atMs: 0, partial: false });
    expect(d.get(5)?.peak).toBe(2);
    expect(d.get(6)?.peak).toBe(0);
  });

  it('is not partial when recording began at midnight', () => {
    expect(pccuByDay([peak(48, 3)], 2, 2).get(2)?.partial).toBe(false);
  });
});

describe('helpers', () => {
  it('averages a day at once, over the elapsed part of today', () => {
    expect(averageAtOnce(86_400 * 3, 10, 20 * 86_400_000)).toBe(3);
    expect(averageAtOnce(3600, 10, 10 * 86_400_000 + H)).toBe(1);
  });

  it('describes a change', () => {
    expect(kpiChange(12, 10)).toEqual({ ratio: expect.closeTo(0.2), dir: 'up' });
    expect(kpiChange(9, 10)?.dir).toBe('down');
    expect(kpiChange(0, 0)).toEqual({ ratio: 0, dir: 'flat' });
    expect(kpiChange(3, 0)).toEqual({ dir: 'up' });
    expect(kpiChange(3, undefined)).toBeUndefined();
  });

  it('compacts big numbers and maps launch days', () => {
    expect([compact(1284), compact(12_900), compact(129_000), compact(4_200_000)]).toEqual(['1,284', '12.9K', '129K', '4.2M']);
    expect(new Date(launchDay('10-07') * 86_400_000).toISOString().slice(0, 10)).toBe('2026-10-07');
  });
});
