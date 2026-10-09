import { median } from '../../shared/netstats';

/**
 * Phone and computer side by side on the admin page (pure, for tests). Every figure is shown for all
 * players and for each side; a player belongs to the side of the device they last played on online
 * (`admin_player_device`): phones and tablets (touch) are "Phone", computers "Computer". Players
 * without a device report count only in "All". Per-day figures use that same latest device for every
 * day, an approximation for the few who switch.
 */
export type Side = 'phone' | 'computer';
export type GroupId = 'all' | Side;
export const SIDES: readonly Side[] = ['phone', 'computer'];
export const GROUPS: readonly { id: GroupId; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'phone', label: 'Phone' }, { id: 'computer', label: 'Computer' }];

/** The side of a reported device kind; undefined without one. */
export const sideOf = (device: string | undefined): Side | undefined =>
  device === 'phone' || device === 'tablet' ? 'phone' : device === 'desktop' ? 'computer' : undefined;

/** Players by group: everyone, then each side. */
export function splitBySide<T extends { side?: Side }>(players: readonly T[]): Record<GroupId, T[]> {
  return { all: [...players], phone: players.filter(p => p.side === 'phone'), computer: players.filter(p => p.side === 'computer') };
}

/** Active and new players per UTC day from `from` to `to`, from each player's active days and first day. */
export function activeByDay(players: Iterable<{ firstDay: number; days: ReadonlySet<number> }>, from: number, to: number): Map<number, { active: number; fresh: number }> {
  const out = new Map<number, { active: number; fresh: number }>();
  for (let d = from; d <= to; d++) out.set(d, { active: 0, fresh: 0 });
  for (const p of players) {
    for (const d of p.days) { const row = out.get(d); if (row) row.active++; }
    const first = out.get(p.firstDay);
    if (first) { first.fresh++; if (!p.days.has(p.firstDay)) first.active++; }
  }
  return out;
}

/** Seconds per UTC day summed over players' per-day maps. */
export function sumByDay(perPlayer: Iterable<ReadonlyMap<number, number> | undefined>): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of perPlayer) if (m) for (const [d, s] of m) out.set(d, (out.get(d) ?? 0) + s);
  return out;
}

/** A player's connection on one day (`admin_player_day_net`). */
export interface DayNet { p50: number; p95: number; seconds: number; corrections: number }

/** Per UTC day: the median over that day's players of their mean p50 and p95, the players, and corrections per minute over everyone's time. */
export function pingByDay(perPlayer: Iterable<ReadonlyMap<number, DayNet> | undefined>): Map<number, { players: number; p50: number; p95: number; correctionsPerMin: number }> {
  const acc = new Map<number, { p50: number[]; p95: number[]; seconds: number; corrections: number }>();
  for (const m of perPlayer) {
    if (!m) continue;
    for (const [d, r] of m) {
      let a = acc.get(d);
      if (!a) acc.set(d, (a = { p50: [], p95: [], seconds: 0, corrections: 0 }));
      a.p50.push(r.p50); a.p95.push(r.p95); a.seconds += r.seconds; a.corrections += r.corrections;
    }
  }
  const out = new Map<number, { players: number; p50: number; p95: number; correctionsPerMin: number }>();
  for (const [d, a] of acc) out.set(d, { players: a.p50.length, p50: Math.round(median(a.p50)!), p95: Math.round(median(a.p95)!), correctionsPerMin: a.seconds ? (a.corrections * 60) / a.seconds : 0 });
  return out;
}

/** A round axis step giving about four grid lines up to `max` (1, 2 or 5 times a power of ten; at least 1 for counts). */
export function niceStep(max: number, counts = false): number {
  if (!(max > 0)) return 1;
  const raw = max / 4, pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw * (1 - 1e-9))!;
  return counts ? Math.max(1, step) : step;
}
