import { describe, expect, it } from 'vitest';
import { beginPlay, endPlay, flushPlay, type PlayStore, type PlayTime } from '../../shared/playtime';
import { rebuildTaipeiDays, taipeiPlayStore, type HourRecord } from '../src/admin';

const SECOND = 1_000_000n;
const midnight = BigInt(Date.parse('2026-10-13T16:00:00Z')) * 1000n;
const day = Date.UTC(2026, 9, 14) / 86_400_000;

/** Public play-time operations over the same adapter used by the module's playStore. */
function recording() {
  const times = new Map<string, PlayTime>();
  const utc = new Map<number, number>(), hours = new Map<number, number>(), taipei = new Map<number, number>();
  const active = new Set<number>();
  let coverage: bigint | undefined;
  const add = (map: Map<number, number>, key: number, seconds: number) => map.set(key, (map.get(key) ?? 0) + seconds);
  const base: PlayStore<string> = {
    get: id => times.get(id),
    set: (id, time) => { times.set(id, time); },
    addDay: (_id, day, seconds) => { add(utc, day, seconds); },
    addHour: (_id, hour, seconds) => { add(hours, hour, seconds); },
  };
  const store = (now: bigint) => taipeiPlayStore(base, {
    startedAt: () => coverage ??= now,
    active: (_id, day) => { active.add(day); },
    addDay: (_id, day, seconds) => { add(taipei, day, seconds); },
  }, now);
  return { times, utc, hours, taipei, active, store, coverage: () => coverage };
}

describe('Taipei play-time collection', () => {
  it('records activity on entering and across Taipei midnight, splitting seconds without changing UTC or lifetime credit', () => {
    const r = recording(), from = midnight - 30n * SECOND, to = midnight + 30n * SECOND;
    beginPlay(r.store(from), 'player', from);
    expect(r.active).toEqual(new Set([day - 1]));
    flushPlay(r.store(to), ['player'], to);
    expect(r.active).toEqual(new Set([day - 1, day]));
    expect(r.taipei).toEqual(new Map([[day - 1, 30], [day, 30]]));
    expect([...r.utc.values()]).toEqual([60]); // Taipei midnight is not UTC midnight.
    expect([...r.hours.values()]).toEqual([30, 30]);
    expect(r.times.get('player')).toEqual({ seconds: 60n, since: to });
    expect(r.coverage()).toBe(from);
  });

  it('starts coverage on the first post-upgrade flush and never imports the preexisting open stretch', () => {
    const r = recording(), now = midnight + 30n * SECOND;
    r.times.set('player', { seconds: 500n, since: now - 600n * SECOND });
    expect(r.coverage()).toBeUndefined();
    flushPlay(r.store(now), ['player'], now);
    expect(r.coverage()).toBe(now);
    expect(r.taipei.size).toBe(0);
    expect(r.active).toEqual(new Set([day]));
    expect(r.times.get('player')?.seconds).toBe(1100n);
    flushPlay(r.store(now + 60n * SECOND), ['player'], now + 60n * SECOND);
    expect(r.taipei.get(day)).toBe(60);
    expect(r.coverage()).toBe(now);
  });

  it('caps another preexisting stretch at the shared collection start, including an hour split', () => {
    const r = recording(), from = midnight - 60n * SECOND, started = midnight - 10n * SECOND, to = midnight + 30n * SECOND;
    beginPlay(r.store(started), 'new-player', started);
    r.times.set('old-player', { seconds: 0n, since: from });
    endPlay(r.store(to), 'old-player', to);
    expect(r.taipei).toEqual(new Map([[day - 1, 10], [day, 30]]));
    expect(r.times.get('old-player')).toEqual({ seconds: 90n, since: 0n });
    expect(r.coverage()).toBe(started);
  });

  it('does not credit a fractional second before coverage, but preserves lifetime rounding', () => {
    const r = recording(), started = midnight + SECOND / 2n, to = midnight + 10n * SECOND;
    beginPlay(r.store(started), 'new-player', started);
    r.times.set('old-player', { seconds: 0n, since: midnight - SECOND / 2n });
    endPlay(r.store(to), 'old-player', to);
    // The hour callback has 9 seconds (the split second went to the previous hour).
    // Conservative coverage clipping discards its first fractional second too.
    expect(r.taipei).toEqual(new Map([[day, 8]]));
    expect(r.times.get('old-player')?.seconds).toBe(10n);
  });

  it('records current activity even when an overlong stretch is dropped, without adding history', () => {
    const r = recording(), now = midnight + SECOND;
    r.times.set('player', { seconds: 100n, since: now - 601n * SECOND });
    flushPlay(r.store(now), ['player'], now);
    expect(r.active).toEqual(new Set([day]));
    expect(r.taipei.size).toBe(0);
    expect(r.utc.size).toBe(0);
    expect(r.times.get('player')).toEqual({ seconds: 100n, since: now });
    expect(r.coverage()).toBe(now);
  });

  it('initializes coverage and activity for a playing identity without an open time row', () => {
    const r = recording(), now = midnight + SECOND;
    flushPlay(r.store(now), ['player'], now);
    expect(r.coverage()).toBe(now);
    expect(r.active).toEqual(new Set([day]));
    expect(r.taipei.size).toBe(0);
    expect(r.times.get('player')).toEqual({ seconds: 0n, since: now });
  });
});

describe('rebuilding Taipei days from records kept before Taipei collection', () => {
  // Oct 10 Taipei begins at UTC hour H0 (16:00 on UTC day D0 = Oct 9).
  const D0 = Date.UTC(2026, 9, 9) / 86_400_000, T = D0 + 1, H0 = D0 * 24 + 16;
  const hour = (id: string, h: number, seconds = 0, net = { reports: 0, netSeconds: 0, p50Sum: 0, p95Sum: 0, corrections: 0 }): HourRecord => ({ id, hour: h, seconds, ...net });
  const at = (h: number) => BigInt(h) * 3_600_000_000n;
  const none = new Map<string, bigint>();
  const days = (r: ReturnType<typeof rebuildTaipeiDays>, id: string) => [...r.active.values()].filter(a => a.id === id).map(a => a.day).sort();

  it('rebuilds every Taipei day with hourly records exactly, splitting at Taipei (not UTC) midnight', () => {
    const r = rebuildTaipeiDays({
      hours: [hour('a', H0, 600), hour('a', H0 + 23, 60, { reports: 2, netSeconds: 100, p50Sum: 4000, p95Sum: 9000, corrections: 1 }), hour('a', H0 + 24, 30)],
      days: [], time: [], net: [], firstSeen: none,
    });
    expect(r.exactFrom).toBe(T);
    expect(r.estimatedFrom).toBeUndefined();
    expect(days(r, 'a')).toEqual([T, T + 1]);
    expect(r.time.get(`a:${T}`)?.seconds).toBe(660);
    expect(r.time.get(`a:${T + 1}`)?.seconds).toBe(30);
    expect(r.net.get(`a:${T}`)).toMatchObject({ reports: 2, seconds: 100, corrections: 1 });
  });

  it('keeps what the straddling UTC day leaves unexplained for the Taipei day before hourly records', () => {
    const r = rebuildTaipeiDays({
      hours: [hour('a', H0 + 2, 300), hour('b', H0 + 3, 120), hour('d', H0, 0)],
      // a: 900 s that UTC day, 300 of them hourly: 600 s in the early hours. b: all of it hourly. c: no late hours at all.
      days: [{ id: 'a', day: D0 }, { id: 'b', day: D0 }, { id: 'c', day: D0 }, { id: 'd', day: D0 }],
      time: [{ id: 'a', day: D0, seconds: 900 }, { id: 'b', day: D0, seconds: 120 }],
      net: [],
      // d joined in the early hours (first seen then) without play time, and again after.
      firstSeen: new Map([['d', at(D0 * 24 + 5)]]),
    });
    expect(r.exactFrom).toBe(T);
    expect(r.estimatedFrom).toBe(D0);
    expect(days(r, 'a')).toEqual([D0, T]);
    expect(r.time.get(`a:${D0}`)?.seconds).toBe(600);
    expect(days(r, 'b')).toEqual([T]);
    expect(days(r, 'c')).toEqual([D0]);
    expect(days(r, 'd')).toEqual([D0, T]);
  });

  it('estimates earlier UTC days as the Taipei day holding most of their hours, or the true day of firstSeen', () => {
    const r = rebuildTaipeiDays({
      hours: [hour('x', H0, 10)],
      days: [{ id: 'a', day: D0 - 2 }, { id: 'b', day: D0 - 2 }, { id: 'b', day: D0 - 1 }],
      time: [{ id: 'b', day: D0 - 2, seconds: 500 }],
      net: [{ id: 'b', day: D0 - 2, reports: 1, seconds: 100, p50Sum: 3000, p95Sum: 6000, corrections: 0 }],
      // b was first seen at 20:00 UTC: already the next Taipei day.
      firstSeen: new Map([['b', at((D0 - 2) * 24 + 20)]]),
    });
    expect(days(r, 'a')).toEqual([D0 - 2]);
    expect(days(r, 'b')).toEqual([D0 - 1]);
    expect(r.time.get(`b:${D0 - 1}`)?.seconds).toBe(500);
    expect(r.net.get(`b:${D0 - 1}`)?.reports).toBe(1);
    expect(r.estimatedFrom).toBe(D0 - 2);
  });

  it('estimates everything from UTC days when no hourly records exist', () => {
    const r = rebuildTaipeiDays({ hours: [], days: [{ id: 'a', day: D0 }], time: [], net: [], firstSeen: none });
    expect(r.exactFrom).toBeUndefined();
    expect(days(r, 'a')).toEqual([D0]);
    expect(r.estimatedFrom).toBe(D0);
  });
});
