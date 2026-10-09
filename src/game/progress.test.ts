import { describe, expect, it } from 'vitest';
import { GOALS, XP, apply, fresh, goalFor, isRookie, levelOf, rollDay } from './progress';

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
    expect(p.xp).toBe(XP.round + XP.roundWon);
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

  it('goals rotate across days', () => {
    const kinds = new Set(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'].map(goalFor));
    expect(kinds.size).toBe(4);
  });

  it('a new player is a rookie until they have played a few rounds', () => {
    let p = fresh('2026-10-09');
    expect(isRookie(p)).toBe(true);
    for (let i = 0; i < 10; i++) p = apply(p, { type: 'round', won: false }, '2026-10-09').next;
    expect(isRookie(p)).toBe(false);
  });
});
