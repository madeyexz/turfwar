import { describe, expect, it } from 'vitest';
import {
  beginPlay, endPlay, FLUSH_MICROS, flushDue, flushPlay, formatPlayTime, liveSeconds, MAX_STRETCH_MICROS, splitDays, splitHours,
  type PlayStore, type PlayTime,
} from './playtime';

const S = 1_000_000n;
const DAY = 86_400n * S;
/** 2026-10-07 00:00 UTC, in microseconds. */
const T0 = BigInt(Date.UTC(2026, 9, 7)) * 1000n;
const D0 = Number(T0 / DAY);

function memoryStore() {
  const rows = new Map<string, PlayTime>();
  const days = new Map<string, number>();
  const hours = new Map<string, number>();
  let writes = 0;
  const store: PlayStore<string> = {
    get: id => rows.get(id),
    set: (id, t) => { rows.set(id, t); writes++; },
    addDay: (id, day, s) => { days.set(`${id}:${day}`, (days.get(`${id}:${day}`) ?? 0) + s); },
    addHour: (id, hour, s) => { hours.set(`${id}:${hour}`, (hours.get(`${id}:${hour}`) ?? 0) + s); },
  };
  return { store, rows, days, hours, writes: () => writes, seconds: (id: string) => rows.get(id)?.seconds ?? 0n, open: (id: string) => (rows.get(id)?.since ?? 0n) > 0n };
}

describe('play time accrual', () => {
  it('credits the time between joining and leaving', () => {
    const m = memoryStore();
    beginPlay(m.store, 'a', T0 + 10n * S);
    expect(m.open('a')).toBe(true);
    endPlay(m.store, 'a', T0 + 10n * S + 95n * S + 400_000n);
    expect(m.seconds('a')).toBe(95n);
    expect(m.open('a')).toBe(false);
    expect(m.days.get(`a:${D0}`)).toBe(95);
  });

  it('adds up several sessions (leave, rejoin, disconnect)', () => {
    const m = memoryStore();
    beginPlay(m.store, 'a', T0);
    endPlay(m.store, 'a', T0 + 30n * S);
    // Lobby time between rooms does not count.
    beginPlay(m.store, 'a', T0 + 300n * S);
    endPlay(m.store, 'a', T0 + 345n * S);
    beginPlay(m.store, 'a', T0 + 1000n * S);
    endPlay(m.store, 'a', T0 + 1020n * S);
    expect(m.seconds('a')).toBe(95n);
  });

  it('ignores leaving when not in a room, and writes nothing for strangers', () => {
    const m = memoryStore();
    endPlay(m.store, 'ghost', T0);
    expect(m.rows.has('ghost')).toBe(false);
    beginPlay(m.store, 'a', T0);
    endPlay(m.store, 'a', T0 + 5n * S);
    const writes = m.writes();
    endPlay(m.store, 'a', T0 + 500n * S);
    expect(m.seconds('a')).toBe(5n);
    expect(m.writes()).toBe(writes);
  });

  it('flushes open stretches without closing them, carrying part-seconds', () => {
    const m = memoryStore();
    beginPlay(m.store, 'a', T0 + 500_000n);
    beginPlay(m.store, 'b', T0 + 20n * S);
    flushPlay(m.store, ['a', 'b'], T0 + 60n * S);
    expect(m.seconds('a')).toBe(59n);
    expect(m.seconds('b')).toBe(40n);
    expect(m.open('a') && m.open('b')).toBe(true);
    flushPlay(m.store, ['a', 'b'], T0 + 120n * S);
    // a joined half a second in: 119.5 s so far, 119 credited, the half carried.
    expect(m.seconds('a')).toBe(119n);
    endPlay(m.store, 'a', T0 + 150n * S + 600_000n);
    expect(m.seconds('a')).toBe(150n);
    expect(m.seconds('b')).toBe(100n);
  });

  it('skips a flush that has nothing to credit', () => {
    const m = memoryStore();
    beginPlay(m.store, 'a', T0);
    const writes = m.writes();
    flushPlay(m.store, ['a'], T0 + 400_000n);
    expect(m.writes()).toBe(writes);
  });

  it('starts a stretch for a human found in a room without one', () => {
    const m = memoryStore();
    flushPlay(m.store, ['old'], T0);
    expect(m.open('old')).toBe(true);
    expect(m.seconds('old')).toBe(0n);
    flushPlay(m.store, ['old'], T0 + 60n * S);
    expect(m.seconds('old')).toBe(60n);
  });

  it('drops a stretch longer than the cap (ticks stopped, a stuck row), keeping the rest', () => {
    const m = memoryStore();
    beginPlay(m.store, 'a', T0);
    flushPlay(m.store, ['a'], T0 + 60n * S);
    expect(m.seconds('a')).toBe(60n);
    // Ticks stopped for three days: nothing is added, and counting resumes from now.
    flushPlay(m.store, ['a'], T0 + 3n * DAY);
    expect(m.seconds('a')).toBe(60n);
    expect(m.open('a')).toBe(true);
    flushPlay(m.store, ['a'], T0 + 3n * DAY + 60n * S);
    expect(m.seconds('a')).toBe(120n);
    // A stretch of exactly the cap still counts; one microsecond more does not.
    beginPlay(m.store, 'b', T0);
    endPlay(m.store, 'b', T0 + MAX_STRETCH_MICROS);
    expect(m.seconds('b')).toBe(MAX_STRETCH_MICROS / S);
    beginPlay(m.store, 'c', T0);
    endPlay(m.store, 'c', T0 + MAX_STRETCH_MICROS + 1n);
    expect(m.seconds('c')).toBe(0n);
    expect(m.open('c')).toBe(false);
  });

  it('closes the stretch when the room closes or the player disconnects mid-minute', () => {
    const m = memoryStore();
    beginPlay(m.store, 'a', T0);
    beginPlay(m.store, 'b', T0);
    flushPlay(m.store, ['a', 'b'], T0 + 60n * S);
    // Disconnect 20 s after the flush; the room then closes with b in it.
    endPlay(m.store, 'a', T0 + 80n * S);
    endPlay(m.store, 'b', T0 + 90n * S);
    expect([m.seconds('a'), m.seconds('b')]).toEqual([80n, 90n]);
    expect(m.open('a') || m.open('b')).toBe(false);
    // A later flush of the room (reused id) does not credit them unless they are in it.
    flushPlay(m.store, [], T0 + 120n * S);
    expect([m.seconds('a'), m.seconds('b')]).toEqual([80n, 90n]);
  });

  it('switching rooms closes one stretch and opens the next', () => {
    const m = memoryStore();
    beginPlay(m.store, 'a', T0);
    endPlay(m.store, 'a', T0 + 40n * S); // leaveRoom on the way
    beginPlay(m.store, 'a', T0 + 40n * S);
    endPlay(m.store, 'a', T0 + 100n * S);
    expect(m.seconds('a')).toBe(100n);
    // A join while a stretch is (unexpectedly) still open credits it rather than losing it.
    beginPlay(m.store, 'z', T0);
    beginPlay(m.store, 'z', T0 + 30n * S);
    endPlay(m.store, 'z', T0 + 45n * S);
    expect(m.seconds('z')).toBe(45n);
  });

  it('splits a stretch over midnight between the two UTC days', () => {
    const m = memoryStore();
    beginPlay(m.store, 'a', T0 - 30n * S);
    endPlay(m.store, 'a', T0 + 45n * S);
    expect(m.days.get(`a:${D0 - 1}`)).toBe(30);
    expect(m.days.get(`a:${D0}`)).toBe(45);
    expect(m.seconds('a')).toBe(75n);
  });

  it('splits credited time per hour as well as per day', () => {
    const m = memoryStore();
    const H0 = Number(T0 / (3600n * S));
    beginPlay(m.store, 'a', T0 - 90n * S);
    flushPlay(m.store, ['a'], T0 + 30n * S);
    endPlay(m.store, 'a', T0 + 200n * S);
    beginPlay(m.store, 'a', T0 + 3500n * S);
    endPlay(m.store, 'a', T0 + 3620n * S);
    expect(m.hours.get(`a:${H0 - 1}`)).toBe(90);
    expect(m.hours.get(`a:${H0}`)).toBe(300);
    expect(m.hours.get(`a:${H0 + 1}`)).toBe(20);
    expect([...m.hours.values()].reduce((a, b) => a + b, 0)).toBe(Number(m.seconds('a')));
    expect(splitHours(T0 - 500_000n, 2n)).toEqual([[H0 - 1, 1], [H0, 1]]);
  });

  it('splitDays credits exactly the whole seconds, however the start is aligned', () => {
    // 23:59:59.7 to 00:00:01.7: the second that straddles midnight goes to the day it ends in.
    expect(splitDays(T0 - 300_000n, 2n)).toEqual([[D0 - 1, 1], [D0, 1]]);
    for (const offset of [0n, 1n, 499_999n, 999_999n]) {
      const parts = splitDays(T0 - 10n * S + offset, 20n);
      expect(parts.reduce((n, [, s]) => n + s, 0)).toBe(20);
    }
    expect(splitDays(T0, 0n)).toEqual([]);
  });
});

describe('flush schedule', () => {
  it('is due once per wall-clock minute', () => {
    const tick = 33_333n;
    let due = 0;
    for (let now = T0 + tick, last = T0; now < T0 + 5n * FLUSH_MICROS; last = now, now += tick) if (flushDue(last, now)) due++;
    expect(due).toBe(4);
    expect(flushDue(T0 + 10n * S, T0 + 20n * S)).toBe(false);
    expect(flushDue(T0 + 59n * S, T0 + 61n * S)).toBe(true);
  });
});

describe('play time display', () => {
  it('adds the open stretch for a live total, capped like crediting', () => {
    expect(liveSeconds({ seconds: 100n, since: 0n }, T0)).toBe(100n);
    expect(liveSeconds({ seconds: 100n, since: T0 }, T0 + 42n * S)).toBe(142n);
    expect(liveSeconds({ seconds: 100n, since: T0 }, T0 + MAX_STRETCH_MICROS + S)).toBe(100n);
    expect(liveSeconds({ seconds: 100n, since: T0 }, T0 - S)).toBe(100n);
  });

  it('formats hours and minutes', () => {
    expect(formatPlayTime(0)).toBe('—');
    expect(formatPlayTime(40)).toBe('40 s');
    expect(formatPlayTime(45 * 60 + 59)).toBe('45 m');
    expect(formatPlayTime(3 * 3600 + 12 * 60)).toBe('3 h 12 m');
    expect(formatPlayTime(312n * 3600n + 300n)).toBe('312 h 5 m');
  });
});
