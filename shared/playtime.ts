/**
 * Online play time: time a human actually spends in a room (lobby idle time does not count; Solo and
 * Practice never reach the server). Per identity the private `player_time` row keeps the seconds
 * credited so far and `since`, the start of the stretch not yet credited (0 = not in a room).
 *
 * - Entering a room (every join path ends in `enterRoom`) opens a stretch at that moment.
 * - Leaving, disconnecting, an idle kick or the room closing credits the stretch and closes it.
 * - Once a minute each room's tick credits the open stretches of the humans in it (one batch per
 *   room per minute, never per tick), so a crash or a long session loses at most about a minute.
 * - A stretch longer than `MAX_STRETCH_MICROS` is not credited at all: with a flush every minute
 *   that only happens when ticks stopped (server down, a stuck row), and it must not add days.
 *
 * Credited seconds also go to `player_day_time` per UTC day (a stretch over midnight is split).
 * Whole seconds are credited; a flush carries the remainder by advancing `since` by whole seconds.
 *
 * This file is pure logic over a small store interface, so tests can run it in memory.
 */
const SECOND = 1_000_000n;
const DAY_MICROS = 86_400_000_000n;
/** How often a room credits its humans' open stretches. */
export const FLUSH_MICROS = 60n * SECOND;
/** Longest stretch credited; anything longer is dropped. */
export const MAX_STRETCH_MICROS = 10n * 60n * SECOND;

export interface PlayTime { seconds: bigint; since: bigint }

/** What the logic needs from the database. */
export interface PlayStore<K> {
  get(id: K): PlayTime | undefined;
  set(id: K, time: PlayTime): void;
  /** Add credited seconds to `id`'s total for one UTC day. */
  addDay(id: K, day: number, seconds: number): void;
}

/** `[day, seconds]` pieces of the `seconds` starting at `from`, split at UTC midnights. */
export function splitDays(from: bigint, seconds: bigint): [number, number][] {
  const out: [number, number][] = [];
  let at = from, left = seconds * SECOND;
  while (left > 0n) {
    const day = at / DAY_MICROS;
    const piece = (day + 1n) * DAY_MICROS - at < left ? (day + 1n) * DAY_MICROS - at : left;
    // Credit whole seconds per day; a split second goes to the day it ends in.
    const end = at + piece;
    const whole = end / SECOND - at / SECOND;
    if (whole > 0n) out.push([Number(day), Number(whole)]);
    at = end; left -= piece;
  }
  return out;
}

/**
 * Credit `id`'s open stretch up to `now`. `open` says whether a stretch stays open afterwards (in a
 * room) or closes (left). Writes nothing when nothing changes.
 */
function credit<K>(store: PlayStore<K>, id: K, now: bigint, open: boolean) {
  const row = store.get(id);
  if (!row && !open) return;
  let seconds = row?.seconds ?? 0n;
  let since = open ? now : 0n;
  if (row && row.since > 0n && now >= row.since) {
    const gap = now - row.since;
    if (gap <= MAX_STRETCH_MICROS) {
      const whole = gap / SECOND;
      if (whole > 0n) {
        seconds += whole;
        for (const [day, s] of splitDays(row.since, whole)) store.addDay(id, day, s);
      }
      // Still in the room: the part-second left over is credited next time.
      if (open) since = row.since + whole * SECOND;
    }
  }
  if (row && row.seconds === seconds && row.since === since) return;
  store.set(id, { seconds, since });
}

/** A human entered a room: open a stretch (crediting one still open, which should not happen). */
export function beginPlay<K>(store: PlayStore<K>, id: K, now: bigint) { credit(store, id, now, true); }

/** A human left their room (leave, disconnect, idle kick, room closed): credit and close the stretch. */
export function endPlay<K>(store: PlayStore<K>, id: K, now: bigint) { credit(store, id, now, false); }

/**
 * The once-a-minute batch for one room: credit every human in it. A human in the room without an
 * open stretch (in a room when this module was first published) starts one now.
 */
export function flushPlay<K>(store: PlayStore<K>, ids: Iterable<K>, now: bigint) {
  for (const id of ids) {
    const row = store.get(id);
    if (row && row.since > 0n && now - row.since < SECOND) continue;
    credit(store, id, now, true);
  }
}

/** Is a flush due on a tick at `now` whose previous tick was at `last`? True once per wall-clock minute. */
export const flushDue = (last: bigint, now: bigint) => now / FLUSH_MICROS !== last / FLUSH_MICROS;

/** Seconds credited plus the open stretch up to `now` (capped like crediting), for live displays. */
export function liveSeconds(time: PlayTime, now: bigint): bigint {
  if (time.since <= 0n || now <= time.since) return time.seconds;
  const gap = now - time.since;
  return time.seconds + (gap <= MAX_STRETCH_MICROS ? gap / SECOND : 0n);
}

/** "3 h 12 m", "45 m", "40 s"; "—" for none. Long totals stay in hours ("312 h 5 m"). */
export function formatPlayTime(seconds: number | bigint): string {
  const s = Math.max(0, Math.floor(Number(seconds)));
  if (s === 0) return '—';
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} m` : `${Math.floor(m / 60)} h ${m % 60} m`;
}
