import type { PeakOf } from './peak';
import type { RoomHourOf } from './growth';

/**
 * "All production" on the admin page (pure, for tests): several servers' admin views added together.
 * Each server has its own identities, so nothing here de-duplicates a person who played on both.
 */

export type ViewState = 'wait' | 'on' | 'missing';

/** One state per view for several servers: on only when every server has it, missing when any lacks it. */
export function mergeViews<K extends string>(each: readonly Record<K, ViewState>[]): Record<K, ViewState> {
  const out = { ...each[0] };
  for (const k of Object.keys(out) as K[]) {
    out[k] = each.some(v => v[k] === 'missing') ? 'missing' : each.every(v => v[k] === 'on') ? 'on' : 'wait';
  }
  return out;
}

/** Rows of counts added field by field (the overview: online now, rooms, players…); undefined without rows. */
export function sumFields<T extends Record<string, number>>(rows: readonly (T | undefined)[]): T | undefined {
  const have = rows.filter((r): r is T => !!r);
  if (!have.length) return undefined;
  const out = { ...have[0] };
  for (const r of have.slice(1)) for (const k of Object.keys(out) as (keyof T)[]) (out[k] as number) += r[k] as number;
  return out;
}

/** Room hours of several servers: every count adds up per hour (room, seat and human minutes, joins, drops…). */
export function sumRoomHours(rows: Iterable<RoomHourOf>): RoomHourOf[] {
  const out = new Map<number, RoomHourOf>();
  for (const r of rows) {
    const o = out.get(r.hour);
    if (!o) { out.set(r.hour, { ...r }); continue; }
    o.roomMinutes += r.roomMinutes; o.seatMinutes += r.seatMinutes; o.humanMinutes += r.humanMinutes; o.botMinutes += r.botMinutes;
    o.joins += r.joins; o.leaves += r.leaves; o.drops += r.drops; o.kicks += r.kicks; o.afk = (o.afk ?? 0) + (r.afk ?? 0);
  }
  return [...out.values()];
}

/**
 * Peak hours of several servers: each hour's peaks added. The servers can peak at different minutes of
 * the hour, so the sum is an upper bound of the most players at once; `atMs` is the larger server's moment.
 */
export function sumPeakHours(rows: Iterable<PeakOf>): PeakOf[] {
  const out = new Map<number, PeakOf & { top: number }>();
  for (const r of rows) {
    const o = out.get(r.hour);
    if (!o) { out.set(r.hour, { ...r, top: r.peak }); continue; }
    if (r.peak > o.top) { o.top = r.peak; o.atMs = r.atMs; }
    o.peak += r.peak; o.phone += r.phone; o.computer += r.computer;
  }
  return [...out.values()].map(({ top: _top, ...p }) => p);
}

/** The latest of several servers' first recorded days or moments: a window is covered only when every server covers it. */
export const latestStart = (starts: readonly (number | undefined)[]) =>
  starts.length && starts.every(s => s !== undefined) ? Math.max(...(starts as number[])) : undefined;
