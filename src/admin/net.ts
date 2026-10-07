import { median } from '../../shared/netstats';
import { countryOf } from '../../shared/tzcountry';

/**
 * Connection quality on the admin page (pure, for tests): a player's `admin_player_net` row joined by
 * id, medians over players active in a window, and the median ping per country. A player without a
 * row (never reported, or a server whose module predates the view) has no `net`, and every number
 * that would come from it reads "—".
 */
export interface NetOf { pingP50: number; pingP95: number; worstP95: number; correctionsPerMin: number; measuredMinutes: number; lastAtMs: number }

export interface WithNet { tz: string; net?: NetOf }

/** Ping colour: green under 80 ms, amber under 160 ms, red from there. */
export const pingClass = (ms: number) => (ms < 80 ? 'good' : ms < 160 ? 'fair' : 'poor');

/** "42 ms", or "—" without a measurement. */
export const fmtPing = (ms: number | undefined) => (ms === undefined || !Number.isFinite(ms) ? '—' : `${Math.round(ms)} ms`);

/** "0.4", "2.15", "12", or "—" without a measurement. */
export const fmtRate = (perMin: number | undefined) => {
  if (perMin === undefined || !Number.isFinite(perMin)) return '—';
  return perMin >= 10 ? String(Math.round(perMin)) : String(Math.round(perMin * 100) / 100);
};

const activeSince = <T extends WithNet>(players: Iterable<T>, sinceMs: number) => [...players].filter((p): p is T & { net: NetOf } => !!p.net && p.net.lastAtMs >= sinceMs);

/** The median typical p50 of the players whose latest report is at or after `sinceMs` (undefined when none). */
export function medianPing(players: Iterable<WithNet>, sinceMs: number): { ms?: number; players: number } {
  const active = activeSince(players, sinceMs);
  return { ms: median(active.map(p => p.net.pingP50)), players: active.length };
}

/** The median corrections per minute of the players whose latest report is at or after `sinceMs`. */
export function medianCorrections(players: Iterable<WithNet>, sinceMs: number): { perMin?: number; players: number } {
  const active = activeSince(players, sinceMs);
  return { perMin: median(active.map(p => p.net.correctionsPerMin)), players: active.length };
}

/** The median typical p50 per country (time zone → country), most players first, then lowest ping. */
export function pingByCountry(players: Iterable<WithNet>): { country: string; ms: number; players: number }[] {
  const by = new Map<string, number[]>();
  for (const p of players) {
    if (!p.net) continue;
    const c = countryOf(p.tz);
    let list = by.get(c);
    if (!list) by.set(c, list = []);
    list.push(p.net.pingP50);
  }
  return [...by].map(([country, pings]) => ({ country, ms: median(pings)!, players: pings.length }))
    .sort((a, b) => b.players - a.players || (a.country === 'Other' ? 1 : b.country === 'Other' ? -1 : a.ms - b.ms));
}
