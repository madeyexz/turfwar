import { describe, expect, it } from 'vitest';
import { activeByDay, niceStep, pingByDay, sideOf, splitBySide, sumByDay } from './groups';

describe('admin phone and computer groups', () => {
  it('puts phones and tablets on the phone side, computers on the other, and the rest only in All', () => {
    expect(sideOf('phone')).toBe('phone');
    expect(sideOf('tablet')).toBe('phone');
    expect(sideOf('desktop')).toBe('computer');
    expect(sideOf(undefined)).toBeUndefined();
    expect(sideOf('watch')).toBeUndefined();
    const g = splitBySide([{ side: 'phone' as const }, { side: 'computer' as const }, { side: undefined }, { side: 'phone' as const }]);
    expect([g.all.length, g.phone.length, g.computer.length]).toEqual([4, 2, 1]);
  });

  it('counts active and new players per day', () => {
    const players = [{ firstDay: 10, days: new Set([10, 12]) }, { firstDay: 11, days: new Set([11, 12]) }, { firstDay: 12, days: new Set<number>() }];
    expect([...activeByDay(players, 10, 13)]).toEqual([
      [10, { active: 1, fresh: 1 }], [11, { active: 1, fresh: 1 }], [12, { active: 3, fresh: 1 }], [13, { active: 0, fresh: 0 }],
    ]);
  });

  it('sums play time per day and takes the median ping of each day\'s players', () => {
    expect([...sumByDay([new Map([[1, 60], [2, 30]]), undefined, new Map([[2, 90]])])]).toEqual([[1, 60], [2, 120]]);
    const ping = pingByDay([
      new Map([[5, { p50: 40, p95: 90, seconds: 120, corrections: 2 }]]),
      new Map([[5, { p50: 60, p95: 110, seconds: 60, corrections: 1 }], [6, { p50: 200, p95: 300, seconds: 60, corrections: 0 }]]),
      new Map([[5, { p50: 100, p95: 400, seconds: 60, corrections: 1 }]]),
    ]);
    expect(ping.get(5)).toEqual({ players: 3, p50: 60, p95: 110, correctionsPerMin: 1 });
    expect(ping.get(6)).toEqual({ players: 1, p50: 200, p95: 300, correctionsPerMin: 0 });
  });

  it('picks round axis steps', () => {
    expect(niceStep(80)).toBe(20);
    expect(niceStep(73)).toBe(20);
    expect(niceStep(250)).toBe(100);
    expect(niceStep(3, true)).toBe(1);
    expect(niceStep(2.4)).toBe(1);
    expect(niceStep(0)).toBe(1);
  });
});
