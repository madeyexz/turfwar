import { describe, expect, it } from 'vitest';
import { GOALS, XP, apply, dailyXp, fresh, goalFor, levelOf, rollDay, streakOn } from './progress';

describe('progress: XP, levels and the daily goal', () => {
  it('levels need 100, then 60 more each', () => {
    expect(levelOf(0)).toEqual({ level: 1, into: 0, need: 100 });
    expect(levelOf(99).level).toBe(1);
    expect(levelOf(100)).toEqual({ level: 2, into: 0, need: 160 });
    expect(levelOf(260)).toEqual({ level: 3, into: 0, need: 220 });
  });

  it('rounds, wins, kills and headshots give XP', () => {
    let p = fresh('2026-10-09');
    p = apply(p, { type: 'round', won: true }, '2026-10-09').next;
    expect(p.xp).toBe(XP.round + XP.roundWon + dailyXp(1));
    const k = apply(p, { type: 'kill', head: true }, '2026-10-09');
    expect(k.gained).toBe(XP.kill + XP.headshot + (k.goalDone ? GOALS[p.goal.kind].xp : 0));
    expect(k.next.kills).toBe(1); expect(k.next.headshots).toBe(1);
  });

  it('the daily goal counts the right things, pays once, and resets the next day', () => {
    const day = Object.entries({ a: '2026-10-09', b: '2026-10-10', c: '2026-10-11', d: '2026-10-12' }).map(([, d]) => d).find(d => goalFor(d) === 'winRounds')!;
    let p = fresh(day);
    expect(p.goal.kind).toBe('winRounds');
    p = apply(p, { type: 'round', won: false }, day).next;
    expect(p.goal.count).toBe(0);
    p = apply(p, { type: 'round', won: true }, day).next;
    p = apply(p, { type: 'round', won: true }, day).next;
    const third = apply(p, { type: 'round', won: true }, day);
    expect(third.goalDone).toBe(true);
    expect(third.gained).toBe(XP.round + XP.roundWon + GOALS.winRounds.xp);
    const fourth = apply(third.next, { type: 'round', won: true }, day);
    expect(fourth.goalDone).toBe(false);
    expect(fourth.next.goal.count).toBe(GOALS.winRounds.target);
    // The next day: a new goal, totals kept.
    const nextDay = rollDay(fourth.next, '2099-01-01');
    expect(nextDay.goal.done).toBe(false);
    expect(nextDay.goal.count).toBe(0);
    expect(nextDay.roundsWon).toBe(fourth.next.roundsWon);
  });

  it('the first round of a day pays the daily bonus once; days in a row raise it, a missed day starts again', () => {
    const round = (p: ReturnType<typeof fresh>, day: string) => apply(p, { type: 'round', won: false }, day);
    let r = round(fresh('2026-10-30'), '2026-10-30');
    expect(r.daily).toEqual({ streak: 1, xp: 50 });
    r = round(r.next, '2026-10-30');
    expect(r.daily).toBeUndefined();
    expect(r.gained).toBe(XP.round);
    // Across a month's end, then a day missed.
    r = round(r.next, '2026-10-31'); expect(r.daily).toEqual({ streak: 2, xp: 100 });
    r = round(r.next, '2026-11-01'); expect(r.daily).toEqual({ streak: 3, xp: 150 });
    expect(streakOn(r.next, '2026-11-02')).toBe(3);
    expect(streakOn(r.next, '2026-11-03')).toBe(0);
    r = round(r.next, '2026-11-03'); expect(r.daily).toEqual({ streak: 1, xp: 50 });
    // Capped from the fifth day.
    for (const d of ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']) r = round(r.next, d);
    expect(r.daily).toEqual({ streak: 6, xp: 250 });
    // Kills and match ends never pay it.
    expect(apply(fresh('2026-12-01'), { type: 'kill', head: false }, '2026-12-01').daily).toBeUndefined();
  });

  it('goals rotate across days', () => {
    const kinds = new Set(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'].map(goalFor));
    expect(kinds.size).toBe(4);
  });
});
