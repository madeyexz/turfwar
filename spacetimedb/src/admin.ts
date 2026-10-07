import { constantTimeEqual, sha256Hex } from '../../shared/sha256';
import { median, perMinute, type NetDay } from '../../shared/netstats';

/**
 * The owner's admin dashboard (`/admin`), checked inside the module: no owner token anywhere.
 * The owner holds a secret admin key; only its SHA-256 lives here. `admin_login(key)` hashes the
 * key and, on a match, adds the caller's identity to the private `admin` table; the `admin_*` views
 * return data only to identities in that table (empty for everyone else).
 *
 * Rotating the key: choose a new key, put its hash below (`printf %s "$NEW_KEY" | shasum -a 256`),
 * publish the module (`--delete-data=never`), and call `admin_revoke_all` from an admin session so
 * every browser logged in with the old key has to log in again with the new one.
 *
 * This file is pure logic over a small store interface, so tests can run it with a test hash.
 */
export const ADMIN_KEY_SHA256 = '636dec36cc64bd40054fd54285fc60948484d414b1d0631025b36c31e447c3e9';
/** Failed logins one identity may make per window; the next attempt is refused until it passes. */
export const ADMIN_MAX_FAILURES = 5;
export const ADMIN_WINDOW_MICROS = 10n * 60n * 1_000_000n;
/** Longer keys are refused without hashing them. */
const KEY_MAX = 256;

export interface AdminAttempts { windowStart: bigint; failures: number }

/** What the logic needs from the database; identities are hex strings here. */
export interface AdminStore {
  isAdmin(id: string): boolean;
  grant(id: string): void;
  revoke(id: string): void;
  revokeAll(): void;
  attempts(id: string): AdminAttempts | undefined;
  setAttempts(id: string, attempts: AdminAttempts | undefined): void;
}

export class AdminError extends Error {}

/** Does `key` hash to `hash`? Compared in constant time. */
export function keyMatches(key: string, hash = ADMIN_KEY_SHA256): boolean {
  if (key.length === 0 || key.length > KEY_MAX) return false;
  return constantTimeEqual(sha256Hex(key), hash.toLowerCase());
}

/** Failures that still count at `now` (a window starts with its first failure and lasts 10 minutes). */
export function failuresAt(attempts: AdminAttempts | undefined, now: bigint): number {
  return attempts && now - attempts.windowStart < ADMIN_WINDOW_MICROS ? attempts.failures : 0;
}

/**
 * Log in with the admin key. Right key: the caller becomes an admin and its failures are cleared.
 * Wrong key: one more failure is recorded and `{ ok: false }` comes back (the caller's reducer must
 * return normally, or the failure would roll back with it). Locked out: throws before checking.
 */
export function adminLogin(store: AdminStore, id: string, key: string, now: bigint, hash = ADMIN_KEY_SHA256): { ok: boolean; left: number } {
  const prev = store.attempts(id);
  const failures = failuresAt(prev, now);
  if (failures >= ADMIN_MAX_FAILURES) throw new AdminError('Too many attempts; try again in 10 minutes');
  if (keyMatches(key, hash)) {
    store.grant(id);
    store.setAttempts(id, undefined);
    return { ok: true, left: ADMIN_MAX_FAILURES };
  }
  store.setAttempts(id, { windowStart: failures > 0 && prev ? prev.windowStart : now, failures: failures + 1 });
  return { ok: false, left: ADMIN_MAX_FAILURES - failures - 1 };
}

export function adminLogout(store: AdminStore, id: string) { store.revoke(id); }

/** Sign every browser out (key rotation, a lost device). Only an admin may. */
export function adminRevokeAll(store: AdminStore, id: string) {
  if (!store.isAdmin(id)) throw new AdminError('Admins only');
  store.revokeAll();
}

/** A view's rows for admins; nothing for anyone else. */
export function forAdmin<T>(store: Pick<AdminStore, 'isAdmin'>, id: string, rows: () => T[]): T[] {
  return store.isAdmin(id) ? rows() : [];
}

// ---- What the views return ----------------------------------------------------------------

export const DAY_MICROS = 86_400_000_000n;
/** UTC day number (days since 1970-01-01). */
export const dayOf = (micros: bigint) => Number(micros / DAY_MICROS);
export const dateOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
/** A short anonymous id for a player (not the identity itself). */
export const shortId = (identityHex: string) => sha256Hex(`player:${identityHex}`).slice(0, 10);

export interface SeenLike { identity: string; firstSeen: bigint; lastSeen: bigint; sessions: number; tz: string; lang: string; name?: string }
export interface ProfileLike { identity: string; name: string; kills: number; matchesPlayed: number }

export interface PlayerRow { id: string; name: string; firstSeen: bigint; lastSeen: bigint; sessions: number; tz: string; lang: string; matches: number; kills: number }

/** One row per player ever seen (callsign of the latest join, else the profile's), with career numbers from `profile`, newest activity first. */
export function playerRows(seen: Iterable<SeenLike>, profiles: Iterable<ProfileLike>): PlayerRow[] {
  const byId = new Map<string, ProfileLike>();
  for (const p of profiles) byId.set(p.identity, p);
  const rows: PlayerRow[] = [];
  for (const s of seen) {
    const p = byId.get(s.identity);
    rows.push({ id: shortId(s.identity), name: s.name || p?.name || '', firstSeen: s.firstSeen, lastSeen: s.lastSeen, sessions: s.sessions, tz: s.tz, lang: s.lang, matches: p?.matchesPlayed ?? 0, kills: p?.kills ?? 0 });
  }
  return rows.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0));
}

export interface DailyRow { day: number; date: string; newPlayers: number; activePlayers: number }

/**
 * New and active players per UTC day for the 30 days ending with the latest day anyone was seen
 * (views cannot read the clock; the page fills in quiet days up to today). `activeOn(day)` counts
 * the players active that day.
 */
export function dailyRows(seen: Iterable<SeenLike>, activeOn: (day: number) => number, days = 30): DailyRow[] {
  const firstDays = new Map<number, number>();
  let last = -1;
  for (const s of seen) {
    const d = dayOf(s.firstSeen);
    firstDays.set(d, (firstDays.get(d) ?? 0) + 1);
    last = Math.max(last, dayOf(s.lastSeen));
  }
  if (last < 0) return [];
  const rows: DailyRow[] = [];
  for (let day = last - days + 1; day <= last; day++) rows.push({ day, date: dateOf(day), newPlayers: firstDays.get(day) ?? 0, activePlayers: activeOn(day) });
  return rows;
}

// ---- Play time (views of their own: changing the row type of an existing view would disconnect
// every client on publish, so the views above keep their columns) ----------------------------

/** A `player_time` row: seconds credited, and the start of the open stretch (0 = not in a room). */
export interface TimeLike { identity: string; seconds: bigint; since: bigint }
export interface RoundsLike { identity: string; roundsPlayed: number }

/** Matches `PlayerRow.id`: rounds played (from `profile`) and online play time per player. */
export interface PlayTimeRow { id: string; rounds: number; playSeconds: bigint; playingSince: bigint }

/** One row per player ever seen (`ids` are identity hex), by the same short id as `playerRows`; zeros for players without stats or time. */
export function playTimeRows(ids: Iterable<string>, profiles: Iterable<RoundsLike>, times: Iterable<TimeLike>): PlayTimeRow[] {
  const rounds = new Map<string, number>();
  for (const p of profiles) rounds.set(p.identity, p.roundsPlayed);
  const timeOf = new Map<string, TimeLike>();
  for (const t of times) timeOf.set(t.identity, t);
  const rows: PlayTimeRow[] = [];
  for (const id of ids) {
    const t = timeOf.get(id);
    rows.push({ id: shortId(id), rounds: rounds.get(id) ?? 0, playSeconds: t?.seconds ?? 0n, playingSince: t?.since ?? 0n });
  }
  return rows;
}

export interface DailyTimeRow { day: number; date: string; playSeconds: bigint }

/**
 * Online play time (credited seconds, all players) per UTC day for the `days` days ending with
 * `lastDay` (the latest day anyone was seen or credited; -1 = none). `playOn(day)` sums a day.
 */
export function dailyTimeRows(lastDay: number, playOn: (day: number) => bigint, days = 30): DailyTimeRow[] {
  if (lastDay < 0) return [];
  const rows: DailyTimeRow[] = [];
  for (let day = lastDay - days + 1; day <= lastDay; day++) rows.push({ day, date: dateOf(day), playSeconds: playOn(day) });
  return rows;
}

// ---- Connection quality (shared/netstats.ts; views of their own, like play time) -------------

/** A `player_net` row (identity hex, `lastAt` in epoch microseconds). */
export interface NetLike { identity: string; avgP50: number; avgP95: number; worstP95: number; corrections: number; measuredSeconds: number; lastAt: bigint }

/** Matches `PlayerRow.id`: typical ping (time-weighted mean of the reported p50 and p95), the worst p95, corrections per minute in a room. */
export interface PlayerNetRow { id: string; pingP50: number; pingP95: number; worstP95: number; correctionsPerMin: number; measuredMinutes: number; lastAt: bigint }

/** One row per player who has reported connection quality (players without one have no row). */
export function playerNetRows(rows: Iterable<NetLike>): PlayerNetRow[] {
  const out: PlayerNetRow[] = [];
  for (const r of rows) {
    out.push({
      id: shortId(r.identity), pingP50: Math.round(r.avgP50), pingP95: Math.round(r.avgP95), worstP95: r.worstP95,
      correctionsPerMin: perMinute(r.corrections, r.measuredSeconds), measuredMinutes: Math.round((r.measuredSeconds / 60) * 10) / 10, lastAt: r.lastAt,
    });
  }
  return out;
}

export interface DailyNetRow { day: number; date: string; players: number; medianP50: number; medianP95: number; correctionsPerMin: number }

/**
 * Connection quality per UTC day for the `days` days ending with `lastDay` (-1 = none): the median
 * over that day's players of each one's mean p50 and p95 (weighted by seconds), and corrections per
 * minute over everyone's time in rooms. A day without reports has `players` 0.
 */
export function dailyNetRows(lastDay: number, rowsOn: (day: number) => Iterable<NetDay>, days = 30): DailyNetRow[] {
  if (lastDay < 0) return [];
  const rows: DailyNetRow[] = [];
  for (let day = lastDay - days + 1; day <= lastDay; day++) {
    const p50: number[] = [], p95: number[] = [];
    let seconds = 0, corrections = 0;
    for (const r of rowsOn(day)) {
      if (r.seconds <= 0) continue;
      p50.push(r.p50Sum / r.seconds); p95.push(r.p95Sum / r.seconds);
      seconds += r.seconds; corrections += r.corrections;
    }
    rows.push({ day, date: dateOf(day), players: p50.length, medianP50: Math.round(median(p50) ?? 0), medianP95: Math.round(median(p95) ?? 0), correctionsPerMin: perMinute(corrections, seconds) });
  }
  return rows;
}
