import { describe, expect, it, vi } from 'vitest';
import { firstTaipeiDay, taipeiDay, taipeiDayOfHour, taipeiDayStart, taipeiTimestamp } from './taipei';

const midnight = Date.parse('2026-10-12T16:00:00Z');
const day = Date.UTC(2026, 9, 13) / 86_400_000;

describe('Taipei calendar helpers', () => {
  it('changes date exactly at 16:00Z, not at UTC midnight', () => {
    expect(taipeiDay(midnight - 1)).toBe(day - 1);
    expect(taipeiDay(midnight)).toBe(day);
    expect(taipeiDay(Date.parse('2026-10-13T00:00:00Z'))).toBe(day);
    expect(taipeiDayStart(day)).toBe(midnight);
    expect(taipeiDayOfHour(midnight / 3_600_000 - 1)).toBe(day - 1);
    expect(taipeiDayOfHour(midnight / 3_600_000)).toBe(day);
  });

  it('keeps an exact midnight coverage start, but excludes a partially collected day', () => {
    expect(firstTaipeiDay(midnight)).toBe(day);
    expect(firstTaipeiDay(midnight + 1)).toBe(day + 1);
    expect(firstTaipeiDay(midnight + 12 * 3_600_000)).toBe(day + 1);
    expect(firstTaipeiDay(midnight - 1)).toBe(day);
  });

  it('formats Taipei wall time without browser-local date or time methods', () => {
    const spies = ['getFullYear', 'getMonth', 'getDate', 'getHours', 'toLocaleString'] as const;
    try {
      for (const method of spies) vi.spyOn(Date.prototype, method).mockImplementation(() => { throw new Error('browser-local time'); });
      expect(taipeiTimestamp(midnight - 1000)).toBe('2026-10-12 23:59:59');
      expect(taipeiTimestamp(midnight)).toBe('2026-10-13 00:00:00');
      expect(taipeiTimestamp(Date.parse('2026-07-01T00:00:00Z'))).toBe('2026-07-01 08:00:00');
    } finally { vi.restoreAllMocks(); }
  });
});
