import { describe, expect, it } from 'vitest';
import { latestStart, mergeViews, sumFields, sumPeakHours, sumRoomHours } from './merge';

describe('All production: servers added together', () => {
  it('shows a view only when every server has it, and says missing when any lacks it', () => {
    expect(mergeViews([{ a: 'on', b: 'on', c: 'on' }, { a: 'wait', b: 'missing', c: 'on' }])).toEqual({ a: 'wait', b: 'missing', c: 'on' });
    expect(mergeViews([{ a: 'missing' }, { a: 'wait' }])).toEqual({ a: 'missing' });
  });

  it('adds the overview counts, skipping a server without a row', () => {
    expect(sumFields([{ onlineNow: 3, rooms: 1 }, undefined, { onlineNow: 4, rooms: 2 }])).toEqual({ onlineNow: 7, rooms: 3 });
    expect(sumFields([undefined, undefined])).toBeUndefined();
  });

  it('adds room hours per hour and keeps other hours', () => {
    const row = (hour: number, n: number, afk?: number) => ({ hour, roomMinutes: n, seatMinutes: 2 * n, humanMinutes: 3 * n, botMinutes: 4 * n, joins: n, leaves: n, drops: n, kicks: n, afk });
    const a = row(10, 1, 2);
    const out = sumRoomHours([a, row(10, 5), row(11, 7, 1)]).sort((x, y) => x.hour - y.hour);
    expect(out).toEqual([row(10, 6, 2), row(11, 7, 1)]);
    expect(a.roomMinutes).toBe(1);
  });

  it('adds each hour\'s peaks and keeps the moment of the larger server', () => {
    const a = { hour: 10, peak: 3, phone: 1, computer: 2, atMs: 100 };
    const out = sumPeakHours([a, { hour: 10, peak: 5, phone: 4, computer: 1, atMs: 200 }, { hour: 12, peak: 1, phone: 0, computer: 1, atMs: 300 }]);
    expect(out.sort((x, y) => x.hour - y.hour)).toEqual([
      { hour: 10, peak: 8, phone: 5, computer: 3, atMs: 200 },
      { hour: 12, peak: 1, phone: 0, computer: 1, atMs: 300 },
    ]);
    expect(a.peak).toBe(3);
  });

  it('covers a window only from the latest server start', () => {
    expect(latestStart([20_000, 20_004])).toBe(20_004);
    expect(latestStart([20_000, undefined])).toBeUndefined();
    expect(latestStart([])).toBeUndefined();
  });
});
