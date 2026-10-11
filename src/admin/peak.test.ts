import { describe, expect, it } from 'vitest';
import { peakBetween, peakFor, peaksBy, type PeakOf } from './peak';

const row = (hour: number, peak: number, phone: number, computer: number, atMs = hour * 3_600_000): PeakOf => ({ hour, peak, phone, computer, atMs });
// Two UTC days: day 20_000 has hours 480_000..480_023.
const rows = [row(480_000, 3, 2, 1), row(480_013, 9, 4, 5), row(480_020, 7, 6, 1), row(480_030, 4, 1, 3)];

describe('peak online', () => {
  it('keeps hours as recorded', () => {
    expect(peaksBy(rows, true).get(480_013)).toEqual({ all: 9, phone: 4, computer: 5, atMs: 480_013 * 3_600_000 });
  });

  it('takes each group\'s highest hour per UTC day, with when the all-player peak was reached', () => {
    const days = peaksBy(rows, false);
    expect(days.get(20_000)).toEqual({ all: 9, phone: 6, computer: 5, atMs: 480_013 * 3_600_000 });
    expect(days.get(20_001)).toEqual({ all: 4, phone: 1, computer: 3, atMs: 480_030 * 3_600_000 });
  });

  it('finds the peak over a span of hours, or nothing without records', () => {
    expect(peakBetween(rows, 480_014, 480_040)).toEqual({ all: 7, phone: 6, computer: 3, atMs: 480_020 * 3_600_000 });
    expect(peakBetween(rows, 480_001, 480_012)).toBeUndefined();
    expect(peakFor(peakBetween(rows, 0, 1e9)!, 'computer')).toBe(5);
  });
});
