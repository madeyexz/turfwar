import { describe, expect, it } from 'vitest';
import { averageDaily, BEGONE_TAIWAN, versus } from './benchmarks';

describe('benchmarks', () => {
  it('averages players active per UTC day over a span', () => {
    const players = [{ days: new Set([10, 11, 12]) }, { days: new Set([11]) }, { days: new Set([9, 12]) }];
    expect(averageDaily(players, 10, 12)).toBeCloseTo((1 + 2 + 2) / 3);
    expect(averageDaily(players, 13, 12)).toBe(0);
  });

  it('places a figure against a benchmark range', () => {
    const ccu = BEGONE_TAIWAN.find(b => b.metric === 'Peak CCU')!;
    expect([versus(8, ccu), versus(10, ccu), versus(25, ccu), versus(26, ccu)]).toEqual(['below', 'within', 'within', 'above']);
  });
});
