/**
 * Retention on the admin page (pure, for tests): who came back, from the `admin_player_day` view
 * (every UTC day each player was active) joined to `admin_players` by id. Days are UTC day numbers
 * (days since 1970-01-01), like the rest of the page.
 *
 * Day-N retention is the classic one: of the players whose first day was D, the share active on day
 * D + N exactly. A cohort's day N is complete once that day is over, in progress while it is today,
 * and not reached before. The pooled figure counts only complete days, so a young cohort never drags
 * it down.
 */
export const RETENTION_DAYS = [1, 3, 7, 14, 30] as const;

export interface ActiveDays { firstDay: number; days: ReadonlySet<number> }

/** Each player's active days, by short id, from the view's rows. */
export function daysById(rows: Iterable<{ id: string; day: number }>): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const r of rows) {
    let days = out.get(r.id);
    if (!days) out.set(r.id, (days = new Set()));
    days.add(r.day);
  }
  return out;
}

/** A player's first day: the day first seen, or an earlier active day (never later than either). */
export function firstDayOf(firstSeenDay: number, days: ReadonlySet<number> | undefined): number {
  let first = firstSeenDay;
  if (days) for (const d of days) if (d < first) first = d;
  return first;
}

/** Players back on day N of a cohort: `back` of `players`, `rate` 0–1; `open` while that day is today. */
export interface Cell { players: number; back: number; rate: number; open: boolean }
/** A cohort (players whose first day is `day`) and its cells, one per `RETENTION_DAYS` (undefined: not reached). */
export interface Cohort { day: number; size: number; cells: (Cell | undefined)[] }

const cell = (players: number, back: number, open: boolean): Cell => ({ players, back, rate: players ? back / players : 0, open });

/**
 * The cohorts of the `span` days up to `today` that have players (newest first), and the pooled
 * retention of every cohort whose day N is complete (undefined when none is yet).
 */
export function cohorts(players: Iterable<ActiveDays>, today: number, span = 14, offsets: readonly number[] = RETENTION_DAYS): { rows: Cohort[]; overall: (Cell | undefined)[] } {
  const groups = new Map<number, ActiveDays[]>();
  for (const p of players) {
    let g = groups.get(p.firstDay);
    if (!g) groups.set(p.firstDay, (g = []));
    g.push(p);
  }
  const pooled = offsets.map(() => ({ players: 0, back: 0 }));
  const rows: Cohort[] = [];
  for (const [day, members] of groups) {
    const cells = offsets.map((n, i) => {
      const target = day + n;
      if (target > today) return undefined;
      let back = 0;
      for (const m of members) if (m.days.has(target)) back++;
      if (target < today) { pooled[i].players += members.length; pooled[i].back += back; }
      return cell(members.length, back, target === today);
    });
    if (day > today - span && day <= today) rows.push({ day, size: members.length, cells });
  }
  rows.sort((a, b) => b.day - a.day);
  return { rows, overall: pooled.map(p => (p.players ? cell(p.players, p.back, false) : undefined)) };
}

/** Players active on any day from `from` to `to` (inclusive). */
export function activeBetween(players: Iterable<{ days: ReadonlySet<number> }>, from: number, to: number): number {
  let n = 0;
  for (const p of players) {
    for (const d of p.days) if (d >= from && d <= to) { n++; break; }
  }
  return n;
}

/** Players whose first day falls from `from` to `to` (inclusive). */
export function newBetween(players: Iterable<{ firstDay: number }>, from: number, to: number): number {
  let n = 0;
  for (const p of players) if (p.firstDay >= from && p.firstDay <= to) n++;
  return n;
}

/** The change from `prev` to `cur`: "+18%", "−5%", "±0%", "new" (from nothing), or undefined when both are nothing. */
export function change(cur: number, prev: number): { text: string; dir: 'up' | 'down' | 'flat' } | undefined {
  if (!prev) return cur ? { text: 'new', dir: 'up' } : undefined;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return pct > 0 ? { text: `+${pct}%`, dir: 'up' } : pct < 0 ? { text: `−${-pct}%`, dir: 'down' } : { text: '±0%', dir: 'flat' };
}

/** "12%", "<1%" for a sliver, "0%" for none; "—" without a figure. */
export const fmtRetention = (c: Cell | undefined) => (!c ? '—' : c.back > 0 && c.rate < 0.005 ? '<1%' : `${Math.round(c.rate * 100)}%`);

/** Of the players whose first day is before `today`, how many played again on a later day. */
export function cameBack(players: Iterable<ActiveDays>, today: number): Cell | undefined {
  let n = 0, back = 0;
  for (const p of players) {
    if (p.firstDay >= today) continue;
    n++;
    for (const d of p.days) if (d > p.firstDay) { back++; break; }
  }
  return n ? cell(n, back, false) : undefined;
}
