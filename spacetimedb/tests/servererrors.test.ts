import { describe, expect, it } from 'vitest';
import { expiredErrorIds, serverErrorSummary } from '../src/servererrors';

describe('private server error summaries', () => {
  it('accepts only fixed categories and bounded counts, never raw log text', () => {
    expect(serverErrorSummary('panic', 2)).toBe('Panic lines in server log: 2. Inspect VM logs for details.');
    for (const [kind, count] of [['secret', 1], ['error', 0], ['panic', 2001], ['error', 1.5]] as const) expect(() => serverErrorSummary(kind, count)).toThrow();
  });
  it('keeps the newest 200 IDs regardless of iteration order or timestamp ties', () => {
    expect(expiredErrorIds(Array.from({ length: 203 }, (_, i) => ({ id: BigInt(203 - i) })))) .toEqual([1n, 2n, 3n]);
    expect(expiredErrorIds([{ id: 9n }])).toEqual([]);
  });
});
