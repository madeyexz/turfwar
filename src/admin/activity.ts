import type { PeakOf } from './peak';
import { taipeiDayOfHour, taipeiDayStart } from '../../shared/taipei';

/**
 * The admin page's headline activity metrics (pure, for tests): DAU, MAU, CCU per hour and PCCU per
 * day, from admin views. Days encode Taipei calendar dates; hours are hours
 * since the epoch. "Players" are SpacetimeDB identities on the server shown.
 *
 * - DAU (day d): players with a `taipei_player_day` row for d. A row is written when an identity says
 *   `hello` (it opened an Online connection), reconnects, enters a room, or keeps playing;
 *   Solo and Practice never reach the server.
 * - MAU (day d): players active in the 30 Taipei days ending on d (rolling, d included).
 * - CCU (hour h): players in Online rooms (humans; bots, spectating lobbies and the room list do not
 *   count). Two readings per hour: the average at once (`room_hour.humanMinutes / 60`: every live room
 *   adds its humans once per wall-clock minute) and the peak at once (`peak_hour.peak`: raised at every
 *   room entry, the only moment the count can rise, and checked at each room's minute flush).
 * - PCCU (day d): the highest `peak_hour.peak` of d's 24 hours.
 */

export const DAY_HOURS = 24;
export const MAU_DAYS = 30;

/**
 * What counts as an active user, switchable on the page: minutes of Online play on the Taipei day (summed
 * over the day's stretches, from `taipei_player_day_time`), or 0 for any activity (`taipei_player_day`).
 */
export const ACTIVE_MINUTES = [0, 3, 5, 10] as const;
export type ActiveMinutes = (typeof ACTIVE_MINUTES)[number];

/**
 * Players as the active-user counts see them under a bar of `minutes`: with 0, every day they were
 * active; otherwise only the days with at least that much Online play (today adds the stretch still
 * open, not yet credited). `firstDay` becomes their first such day, so "new" means new to that bar;
 * players who never reached it are left out.
 */
export function qualifying(
  players: Iterable<{ firstDay: number; days: ReadonlySet<number>; daySeconds?: ReadonlyMap<number, number>; openSeconds?: number }>,
  minutes: number, today: number,
): { firstDay: number; days: Set<number> }[] {
  const out: { firstDay: number; days: Set<number> }[] = [];
  for (const p of players) {
    if (minutes <= 0) { out.push({ firstDay: p.firstDay, days: new Set(p.days) }); continue; }
    const days = new Set<number>();
    const seconds = new Map(p.daySeconds ?? []);
    if (p.openSeconds) seconds.set(today, (seconds.get(today) ?? 0) + p.openSeconds);
    for (const [d, s] of seconds) if (s >= minutes * 60) days.add(d);
    if (days.size) out.push({ firstDay: Math.min(...days), days });
  }
  return out;
}

/** Distinct players active per day from `from` to `to` (inclusive). */
export function dauByDay(players: Iterable<{ days: ReadonlySet<number> }>, from: number, to: number): Map<number, number> {
  const out = new Map<number, number>();
  for (let d = from; d <= to; d++) out.set(d, 0);
  for (const p of players) for (const d of p.days) if (d >= from && d <= to) out.set(d, out.get(d)! + 1);
  return out;
}

/** Distinct players active in the `window` days ending on each day from `from` to `to` (rolling MAU for 30). */
export function rollingActive(players: Iterable<{ days: ReadonlySet<number> }>, from: number, to: number, window = MAU_DAYS): Map<number, number> {
  const out = new Map<number, number>();
  if (to < from) return out;
  // Each player counts on the days d where one of their active days falls in [d - window + 1, d]: mark those spans.
  const diff = new Array<number>(to - from + 2).fill(0);
  for (const p of players) {
    const days = [...p.days].filter(d => d <= to && d + window - 1 >= from).sort((a, b) => a - b);
    let coveredTo = from - 1;
    for (const d of days) {
      const lo = Math.max(from, d, coveredTo + 1), hi = Math.min(to, d + window - 1);
      if (hi < lo) continue;
      diff[lo - from]++; diff[hi - from + 1]--;
      coveredTo = hi;
    }
  }
  let run = 0;
  for (let d = from; d <= to; d++) { run += diff[d - from]; out.set(d, run); }
  return out;
}

/** The earliest day in anyone's active days (undefined without any). */
export function firstActiveDay(players: Iterable<{ days: ReadonlySet<number> }>): number | undefined {
  let first: number | undefined;
  for (const p of players) for (const d of p.days) if (first === undefined || d < first) first = d;
  return first;
}

/** A `room_hour` row as far as CCU needs it. */
export interface RoomMinutesOf { hour: number; humanMinutes: number }

/** One hour's CCU: the average and the peak at once; `source` says where the average came from. */
export interface HourCcu { avg?: number; peak?: number; peakAtMs?: number; source?: 'rooms' | 'play' }

/**
 * CCU per hour from `from` to `to` (inclusive). An hour after a source began recording but without a
 * row had nobody in rooms (0); an hour before any source recorded is undefined (no data). The average
 * comes from `room_hour`; hours before its first row fall back to the players' hourly play time
 * (`player_hour`, seconds / 3600) where that exists. `nowMs` caps the hour in progress: its average is
 * over the minutes elapsed so far.
 */
export function ccuByHour(o: {
  rooms: Iterable<RoomMinutesOf>; peaks: Iterable<PeakOf>; playSeconds?: ReadonlyMap<number, number>; from: number; to: number; nowMs: number;
}): Map<number, HourCcu> {
  const rooms = new Map<number, number>(), peaks = new Map<number, PeakOf>();
  let roomsFrom = Infinity, peaksFrom = Infinity, playFrom = Infinity;
  for (const r of o.rooms) { rooms.set(r.hour, r.humanMinutes); roomsFrom = Math.min(roomsFrom, r.hour); }
  for (const p of o.peaks) { peaks.set(p.hour, p); peaksFrom = Math.min(peaksFrom, p.hour); }
  for (const h of o.playSeconds?.keys() ?? []) playFrom = Math.min(playFrom, h);
  const nowHour = Math.floor(o.nowMs / 3_600_000);
  const out = new Map<number, HourCcu>();
  for (let h = o.from; h <= o.to; h++) {
    if (h > nowHour) { out.set(h, {}); continue; }
    // The hour in progress: minutes elapsed (at least one, so a fresh hour does not divide by zero).
    const minutes = h === nowHour ? Math.max(1, (o.nowMs - h * 3_600_000) / 60_000) : 60;
    const cell: HourCcu = {};
    if (h >= roomsFrom) { cell.avg = (rooms.get(h) ?? 0) / minutes; cell.source = 'rooms'; }
    else if (o.playSeconds && h >= playFrom) { cell.avg = (o.playSeconds.get(h) ?? 0) / (minutes * 60); cell.source = 'play'; }
    if (h >= peaksFrom) {
      const p = peaks.get(h);
      cell.peak = p?.peak ?? 0;
      if (p) cell.peakAtMs = p.atMs;
    }
    out.set(h, cell);
  }
  return out;
}

/** One Taipei day's PCCU: the highest hourly peak, when it was reached, and whether recording began during the day. */
export interface DayPeak { peak: number; atMs: number; partial: boolean }

/** PCCU per Taipei day from `from` to `to`: undefined before `peak_hour` began, 0 for a recorded day nobody played. */
export function pccuByDay(peaks: Iterable<PeakOf>, from: number, to: number): Map<number, DayPeak | undefined> {
  const list = [...peaks];
  const firstHour = list.reduce((m, p) => Math.min(m, p.hour), Infinity);
  const byDay = new Map<number, DayPeak>();
  for (const p of list) {
    const d = taipeiDayOfHour(p.hour), cur = byDay.get(d);
    if (!cur || p.peak > cur.peak) byDay.set(d, { peak: p.peak, atMs: p.atMs, partial: false });
  }
  const firstDay = taipeiDayOfHour(firstHour);
  const out = new Map<number, DayPeak | undefined>();
  for (let d = from; d <= to; d++) {
    if (!(d >= firstDay)) { out.set(d, undefined); continue; }
    const r = byDay.get(d) ?? { peak: 0, atMs: 0, partial: false };
    out.set(d, { ...r, partial: d === firstDay && (firstHour + 8) % DAY_HOURS !== 0 });
  }
  return out;
}

/** The average at once over a Taipei day from its play seconds (the day in progress: over the time elapsed). */
export function averageAtOnce(seconds: number, day: number, nowMs: number): number {
  const start = taipeiDayStart(day);
  const span = Math.min(86_400_000, Math.max(60_000, nowMs - start)) / 1000;
  return seconds / span;
}

/**
 * A KPI's change against the period before: the relative change (undefined without a base) and its
 * direction. `flat` within half a percent.
 */
export function kpiChange(now: number | undefined, before: number | undefined): { ratio?: number; dir: 'up' | 'down' | 'flat' } | undefined {
  if (now === undefined || before === undefined) return undefined;
  if (before === 0) return now === 0 ? { ratio: 0, dir: 'flat' } : { dir: 'up' };
  const ratio = now / before - 1;
  return { ratio, dir: Math.abs(ratio) < 0.005 ? 'flat' : ratio > 0 ? 'up' : 'down' };
}

/** 1,284 / 12.9K / 4.2M: compact from ten thousand up. */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`;
  return Math.round(n).toLocaleString('en-US');
}

/** Launch-week peaks as Taipei calendar day numbers ("MM-DD" of `year`). */
export function launchDay(mmdd: string, year = 2026): number {
  const [m, d] = mmdd.split('-').map(Number);
  return Math.floor(Date.UTC(year, m - 1, d) / 86_400_000);
}
