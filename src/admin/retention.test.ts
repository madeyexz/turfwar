import { describe, expect, it } from 'vitest';
import { activeBetween, cameBack, change, cohorts, daysById, firstDayOf, fmtRetention, newBetween, type ActiveDays } from './retention';

const player = (firstDay: number, ...later: number[]): ActiveDays => ({ firstDay, days: new Set([firstDay, ...later]) });

describe('admin retention', () => {
  it('collects each player\'s active days and their first day', () => {
    const days = daysById([{ id: 'a', day: 10 }, { id: 'b', day: 11 }, { id: 'a', day: 12 }, { id: 'a', day: 10 }]);
    expect([...days.get('a')!].sort()).toEqual([10, 12]);
    expect(firstDayOf(11, days.get('a'))).toBe(10);
    expect(firstDayOf(11, days.get('b'))).toBe(11);
    expect(firstDayOf(11, undefined)).toBe(11);
  });

  it('measures day-N retention per cohort: complete, in progress (today) or not reached', () => {
    const today = 100;
    const players = [player(90, 91, 97), player(90, 91), player(90), player(90, 104), player(99, 100), player(99), player(100), player(70, 71)];
    const { rows, overall } = cohorts(players, today, 14, [1, 7, 30]);
    expect(rows.map(r => [r.day, r.size])).toEqual([[100, 1], [99, 2], [90, 4]]); // newest first; day 70 is older than 14 days
    const d90 = rows[2].cells;
    expect(d90[0]).toEqual({ players: 4, back: 2, rate: 0.5, open: false });
    expect(d90[1]).toEqual({ players: 4, back: 1, rate: 0.25, open: false });
    expect(d90[2]).toBeUndefined(); // day 120 has not come
    expect(rows[1].cells[0]).toEqual({ players: 2, back: 1, rate: 0.5, open: true }); // day 100 is today
    expect(rows[0].cells).toEqual([undefined, undefined, undefined]);
    // Pooled over complete days only: day 1 from cohorts 70 and 90 (3 of 5), not the open 99.
    expect(overall[0]).toEqual({ players: 5, back: 3, rate: 0.6, open: false });
    expect(overall[1]).toEqual({ players: 5, back: 1, rate: 0.2, open: false }); // cohort 70's day 77: nobody
    expect(overall[2]).toBeUndefined(); // cohort 70's day 30 is today: not complete yet
  });

  it('has nothing to say without players or complete days', () => {
    expect(cohorts([], 100)).toEqual({ rows: [], overall: [undefined, undefined, undefined, undefined, undefined] });
    expect(cohorts([player(100)], 100).overall.every(c => c === undefined)).toBe(true);
    expect(fmtRetention(undefined)).toBe('—');
    expect(fmtRetention({ players: 1000, back: 1, rate: 0.001, open: false })).toBe('<1%');
    expect(fmtRetention({ players: 3, back: 1, rate: 1 / 3, open: false })).toBe('33%');
  });

  it('counts the players who ever came back after their first day', () => {
    expect(cameBack([player(90, 95), player(90), player(99, 99), player(100)], 100)).toEqual({ players: 3, back: 1, rate: 1 / 3, open: false });
    expect(cameBack([player(100, 101)], 100)).toBeUndefined();
  });

  it('counts active and new players in a range of days', () => {
    const players = [player(90, 95), player(96), player(80, 89), { firstDay: 50, days: new Set<number>() }];
    expect(activeBetween(players, 94, 100)).toBe(2);
    expect(activeBetween(players, 87, 93)).toBe(2);
    expect(newBetween(players, 94, 100)).toBe(1);
  });

  it('describes a change from one period to the next', () => {
    expect(change(118, 100)).toEqual({ text: '+18%', dir: 'up' });
    expect(change(95, 100)).toEqual({ text: '−5%', dir: 'down' });
    expect(change(100, 100)).toEqual({ text: '±0%', dir: 'flat' });
    expect(change(5, 0)).toEqual({ text: 'new', dir: 'up' });
    expect(change(0, 0)).toBeUndefined();
  });
});
