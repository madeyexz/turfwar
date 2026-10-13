import { describe, expect, it } from 'vitest';
import {
  activation, channels, dayN, firstsSince, grade, minutesPerActiveDay, pct, quality, qualityByBrowser, roomHealth, roomHealthBy, roundBuckets, secs,
  TARGETS, virality, worse, worstStep, type GrowthPlayer, type SourceOf,
} from './growth';

const DAY = 86_400_000;
const today = 20_000;
const now = today * DAY + 12 * 3_600_000;
const src = (o: Partial<SourceOf> = {}): SourceOf => ({ source: 'direct', medium: '', campaign: '', inApp: '', referred: false, shares: 0, duels: 0, invited: 0, invitedPlayed: 0, ...o });
const player = (o: Partial<GrowthPlayer> & { day?: number } = {}): GrowthPlayer => {
  const day = o.day ?? today - 3;
  return { name: 'p', firstSeenMs: day * DAY + 3_600_000, firstDay: day, days: new Set([day]), rounds: 0, playTime: 0, ...o };
};

describe('grading', () => {
  it('grades higher- and lower-is-better targets', () => {
    expect(grade(0.35, TARGETS.d1)).toBe('good');
    expect(grade(0.25, TARGETS.d1)).toBe('watch');
    expect(grade(0.1, TARGETS.d1)).toBe('bad');
    expect(grade(undefined, TARGETS.d1)).toBe('none');
    expect(grade(0.02, TARGETS.drops)).toBe('good');
    expect(grade(0.3, TARGETS.drops)).toBe('bad');
    expect(worse('good', 'bad')).toBe('bad');
    expect(worse('none', 'watch')).toBe('watch');
  });
});

describe('activation', () => {
  it('counts each step within the first 24 hours, from when firsts are recorded', () => {
    const at = (h: number, day = today - 3) => day * DAY + 3_600_000 + h * 3_600_000;
    const players = [
      player({ firsts: { room: at(0), round: at(0.1), kill: at(0.2), match: at(0.5) }, days: new Set([today - 3, today - 2]) }),
      player({ firsts: { room: at(0), round: at(0.1), kill: at(30), match: 0 } }), // kill after 24 h does not count
      player({ firsts: { room: at(0), round: 0, kill: 0, match: 0 } }),
      player({}), // connected, never entered a room
      player({ day: today, firsts: { room: today * DAY + 3_600_000, round: 0, kill: 0, match: 0 } }), // 24 h not over
      player({ day: today - 40, firsts: { room: 1, round: 1, kill: 1, match: 1 } }), // before firsts were recorded
    ];
    const since = firstsSince(players);
    expect(since).toBe(at(0, today - 3));
    const { cohort, steps } = activation(players, now - 14 * DAY, now, now, since);
    expect(cohort).toBe(4);
    expect(steps.map(s => s.n)).toEqual([4, 3, 2, 1, 1, 1]);
    expect(steps[3].rate).toBe(0.25);
    expect(steps[3].fromPrev).toBe(0.5);
    expect(worstStep(steps)?.key).toBe('kill');
  });
  it('is empty before any firsts are recorded', () => {
    expect(activation([player()], 0, now, now, undefined).cohort).toBe(0);
  });
});

describe('channels and retention', () => {
  it('gives day-N retention of the players whose day N is over', () => {
    const ps = [player({ days: new Set([today - 3, today - 2]) }), player({}), player({ day: today })];
    expect(dayN(ps, 1, today)).toEqual({ players: 2, back: 1, rate: 0.5 });
    expect(dayN(ps, 7, today)).toBeUndefined();
  });
  it('splits new players by in-app browser or source', () => {
    const ps = [
      player({ src: src({ inApp: 'threads', source: 'threads.net' }), days: new Set([today - 3, today - 2]), playTime: 600 }),
      player({ src: src({ inApp: 'threads' }) }),
      player({ src: src({ source: 'google' }) }),
      player({}), // no visit reported: left out
      player({ day: today - 40, src: src({ source: 'google' }) }), // too old
    ];
    const rows = channels(ps, today - 29, now);
    expect(rows.map(r => [r.channel, r.players])).toEqual([['threads app', 2], ['google', 1]]);
    expect(rows[0]).toMatchObject({ share: 2 / 3, d1: 0.5, d1n: 2, minutes: 5 });
  });
  it('completes channel D1 and D7 at Taipei midnight, not eight hours later', () => {
    const ps = [
      player({ day: today - 1, src: src(), days: new Set([today - 1, today]) }),
      player({ day: today - 7, src: src(), days: new Set([today - 7]) }),
    ];
    const midnight = today * DAY + 16 * 3_600_000;
    expect(channels(ps, today - 7, midnight - 1)[0]).toMatchObject({ d1: 0, d1n: 1, d7: undefined, d7n: 0 });
    expect(channels(ps, today - 7, midnight)[0]).toMatchObject({ d1: 0.5, d1n: 2, d7: 0, d7n: 1 });
  });
});

describe('engagement', () => {
  it('buckets players by rounds with the core group', () => {
    const r = roundBuckets([player({ rounds: 2 }), player({ rounds: 8 }), player({ rounds: 40 }), player({ rounds: 150 }), player({ rounds: 0 })]);
    expect(r.players).toBe(4);
    expect(r.rows.map(b => b.players)).toEqual([1, 1, 0, 1, 1]);
    expect(r.core.players).toBe(2);
    expect(r.core.roundShare).toBeCloseTo(190 / 200);
  });
  it('averages minutes over player-days with play', () => {
    const ps = [player({ daySeconds: new Map([[today, 1200], [today - 1, 600]]) }), player({ daySeconds: new Map([[today, 0], [today - 30, 9999]]) })];
    expect(minutesPerActiveDay(ps, today - 6, today)).toBe(15);
    expect(minutesPerActiveDay([], 0, 1)).toBeUndefined();
  });
});

describe('virality', () => {
  it('gives the K-factor: players brought (who played) per reporting player', () => {
    const v = virality([
      player({ src: src({ shares: 3, duels: 1, invited: 2, invitedPlayed: 1 }) }),
      player({ src: src({ referred: true }) }),
      player({ src: src() }), player({ src: src() }),
      player({}),
    ]);
    expect(v).toMatchObject({ reporting: 4, sharers: 1, invites: 4, brought: 2, broughtPlayed: 1, referred: 1, k: 0.25, perSharer: 4, conversion: 0.25 });
  });
});

describe('server health', () => {
  const rows = [
    { hour: 100, roomMinutes: 60, seatMinutes: 720, humanMinutes: 180, botMinutes: 540, joins: 20, leaves: 15, drops: 2, kicks: 1 },
    { hour: 101, roomMinutes: 60, seatMinutes: 120, humanMinutes: 120, botMinutes: 0, joins: 0, leaves: 0, drops: 0, kicks: 0 },
  ];
  it('gives fill, humans per room and drops per join', () => {
    expect(roomHealth(rows, 100, 101)).toMatchObject({ fill: 300 / 840, humansPerRoom: 2.5, dropRate: 0.1, kickRate: 0.05 });
    expect(roomHealth(rows, 0, 1).fill).toBeUndefined();
    expect([...roomHealthBy(rows, [99, 100, 101], true).keys()]).toEqual([100, 101]);
  });
  it('splits room hours at 16:00Z while keeping hourly buckets unchanged', () => {
    const boundary = [
      { ...rows[0], hour: today * 24 + 15 },
      { ...rows[1], hour: today * 24 + 16 },
    ];
    const daily = roomHealthBy(boundary, [today - 1, today, today + 1], false);
    expect([...daily.keys()]).toEqual([today, today + 1]);
    expect(daily.get(today)).toMatchObject({ fill: 0.25, humansPerRoom: 3, joins: 20, dropRate: 0.1 });
    expect(daily.get(today + 1)).toMatchObject({ fill: 1, humansPerRoom: 2, joins: 0, dropRate: undefined });
    expect(roomHealthBy(boundary, [today * 24 + 16], true).get(today * 24 + 16)).toEqual(daily.get(today + 1));
  });
});

describe('quality', () => {
  const perf = (fps: number, o = {}) => ({ fps, low: fps / 2, seconds: 60, waitMs: 2000, waits: 1, bootMs: 4000, boots: 1, lastAtMs: now, ...o });
  it('gives medians and the share under 30 fps', () => {
    const q = quality([player({ perf: perf(60) }), player({ perf: perf(20) }), player({ perf: perf(40) }), player({ perf: perf(99, { lastAtMs: 0 }) })], now - DAY);
    expect(q).toMatchObject({ players: 3, fps: 40, low: 20, waitMs: 2000, bootMs: 4000 });
    expect(q.slowShare).toBeCloseTo(1 / 3);
  });
  it('ranks browsers slowest first', () => {
    const rows = qualityByBrowser([player({ perf: perf(60) }), player({ perf: perf(20), src: src({ inApp: 'line' }) })], 0);
    expect(rows.map(r => r.browser)).toEqual(['line app', 'browser']);
  });
});

describe('formatting', () => {
  it('formats shares and durations', () => {
    expect(pct(0.421)).toBe('42%');
    expect(pct(0.001)).toBe('<1%');
    expect(pct(undefined)).toBe('—');
    expect(secs(850)).toBe('850 ms');
    expect(secs(4200)).toBe('4.2 s');
    expect(secs(42_000)).toBe('42 s');
  });
});
