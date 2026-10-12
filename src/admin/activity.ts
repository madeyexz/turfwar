import type { PeakOf } from './peak';

/**
 * The admin page's headline activity metrics (pure, for tests): DAU, MAU, CCU per hour and PCCU per
 * day, from views the module already has. Days are UTC days (days since the epoch), hours are hours
 * since the epoch. "Players" are SpacetimeDB identities on the server shown.
 *
 * - DAU (day d): players with a `player_day` row for d. A row is written when an identity says
 *   `hello` (it opened an Online connection: pressed Play Online), reconnects, or enters a room;
 *   Solo and Practice never reach the server.
 * - MAU (day d): players with a `player_day` row in the 30 UTC days ending on d (rolling, d included).
 * - CCU (hour h): players in Online rooms (humans; bots, spectating lobbies and the room list do not
 *   count). Two readings per hour: the average at once (`room_hour.humanMinutes / 60`: every live room
 *   adds its humans once per wall-clock minute) and the peak at once (`peak_hour.peak`: raised at every
 *   room entry, the only moment the count can rise, and checked at each room's minute flush).
 * - PCCU (day d): the highest `peak_hour.peak` of d's 24 hours.
 */

export const DAY_HOURS = 24;
export const MAU_DAYS = 30;

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

/** One UTC day's PCCU: the highest hourly peak, when it was reached, and whether recording began during the day. */
export interface DayPeak { peak: number; atMs: number; partial: boolean }

/** PCCU per UTC day from `from` to `to`: undefined before `peak_hour` began, 0 for a recorded day nobody played. */
export function pccuByDay(peaks: Iterable<PeakOf>, from: number, to: number): Map<number, DayPeak | undefined> {
  const list = [...peaks];
  const firstHour = list.reduce((m, p) => Math.min(m, p.hour), Infinity);
  const byDay = new Map<number, DayPeak>();
  for (const p of list) {
    const d = Math.floor(p.hour / DAY_HOURS), cur = byDay.get(d);
    if (!cur || p.peak > cur.peak) byDay.set(d, { peak: p.peak, atMs: p.atMs, partial: false });
  }
  const firstDay = Math.floor(firstHour / DAY_HOURS);
  const out = new Map<number, DayPeak | undefined>();
  for (let d = from; d <= to; d++) {
    if (!(d >= firstDay)) { out.set(d, undefined); continue; }
    const r = byDay.get(d) ?? { peak: 0, atMs: 0, partial: false };
    out.set(d, { ...r, partial: d === firstDay && firstHour % DAY_HOURS !== 0 });
  }
  return out;
}

/** The average at once over a UTC day from its play seconds (the day in progress: over the time elapsed). */
export function averageAtOnce(seconds: number, day: number, nowMs: number): number {
  const start = day * 86_400_000;
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

/** Launch-week peaks (Taipei days "MM-DD" of `year`) as UTC days: a Taipei evening falls on the same UTC date. */
export function launchDay(mmdd: string, year = 2026): number {
  const [m, d] = mmdd.split('-').map(Number);
  return Math.floor(Date.UTC(year, m - 1, d) / 86_400_000);
}
