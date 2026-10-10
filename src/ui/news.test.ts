import { describe, expect, it } from 'vitest';
import { NEWS, shortDate } from './news';

describe('latest update (news)', () => {
  it('every entry has a unique id, a real date, newest first, and short text in both languages', () => {
    expect(new Set(NEWS.map(n => n.id)).size).toBe(NEWS.length);
    for (const n of NEWS) {
      expect(n.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(n.date))).toBe(false);
      for (const text of [n.text['zh-TW'], n.text.en]) { expect(text.trim().length).toBeGreaterThan(0); expect(text.length).toBeLessThanOrEqual(90); }
    }
    expect([...NEWS].sort((a, b) => b.date.localeCompare(a.date))).toEqual(NEWS);
  });
  it('dates read as month/day', () => { expect(shortDate('2026-10-10')).toBe('10/10'); expect(shortDate('2026-01-05')).toBe('1/5'); });
});
