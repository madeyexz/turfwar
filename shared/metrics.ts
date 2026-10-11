/**
 * The owner's growth metrics beyond players, play time and ping (docs/DEVELOPMENT.md, "Players,
 * analytics and the admin page"): frame rate and load times, where players came from and whom they
 * invited, how far a new player gets, and how full rooms are.
 *
 * Client:
 * - `FrameMeter` (src/perf.ts): every rendered match frame's interval in a 1 ms histogram, for the
 *   median frame rate and the 1% low; the `perf_stats` report goes with the 2-minute connection report
 *   (src/net/online.ts) and the match's numbers go on `match_left`.
 * - `visit` (src/net/online.ts, once per online connection after `hello`): the browser's first touch
 *   (UTM source, medium and campaign, else the referrer's host, else `direct`), the in-app browser,
 *   the share code it arrived through, its own share code and its running share and duel counts.
 *
 * Server (spacetimedb/src/index.ts), per-identity bookkeeping that never loads a match:
 * - `acceptPerf` folds a report into `player_perf` (one per identity per 30 s, clamped);
 * - `acceptVisit` keeps the first touch and the arrival code once, and lets the counts only grow
 *   (a little per report), into `player_source`;
 * - `noteMilestones` stamps the first room, round, kill and finished match in `player_milestone`;
 * - `foldRoomMinute` adds each room's minute to `room_hour` (seats, humans), with joins, leaves and drops.
 *
 * This file is pure logic, so tests can run it.
 */

const U32 = 0xffffffff;
const add32 = (a: number, b: number) => Math.min(U32, a + b);
const whole = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : 0);

// ---- Frame rate (client) -------------------------------------------------------------------

/** Frame intervals are counted in whole ms up to this; slower frames land in the last bucket. */
export const FRAME_MAX_MS = 250;
/** A longer gap is not a frame (a hidden tab, a debugger): ignored. */
export const FRAME_GAP_MS = 1000;

/** What a stretch of frames measured: median frames per second, the 1% low (fps at the 99th-percentile frame), frames and seconds. */
export interface FrameStats { fps: number; low: number; frames: number; seconds: number }

/** Frame intervals in a 1 ms histogram: no allocation per frame, percentiles on demand. */
export class FrameHistogram {
  private bins = new Uint32Array(FRAME_MAX_MS + 1);
  frames = 0;
  ms = 0;
  add(ms: number) {
    if (!(ms > 0) || ms > FRAME_GAP_MS) return;
    this.bins[Math.min(FRAME_MAX_MS, Math.max(1, Math.round(ms)))]++;
    this.frames++; this.ms += ms;
  }
  /** The frame interval (ms) at percentile `p` (0–100); 0 without frames. */
  at(p: number): number {
    if (!this.frames) return 0;
    const target = Math.max(1, Math.ceil((p / 100) * this.frames));
    let seen = 0;
    for (let ms = 1; ms <= FRAME_MAX_MS; ms++) { seen += this.bins[ms]; if (seen >= target) return ms; }
    return FRAME_MAX_MS;
  }
  stats(): FrameStats {
    const median = this.at(50), p99 = this.at(99);
    return { fps: median ? Math.round(10_000 / median) / 10 : 0, low: p99 ? Math.round(10_000 / p99) / 10 : 0, frames: this.frames, seconds: Math.round(this.ms / 1000) };
  }
  reset() { this.bins.fill(0); this.frames = 0; this.ms = 0; }
}

// ---- Frame rate and load times (server) ----------------------------------------------------

/** The `perf_stats` reducer's arguments: frame rate since the previous report, and load times (0 = none in this report). */
export interface PerfReport { fps: number; low: number; seconds: number; waitMs: number; bootMs: number }
/** A `player_perf` row (identity aside): sums weighted by seconds (so means can be taken), the latest figures and load-time sums. */
export interface PerfRecord {
  reports: number; seconds: number; fpsSum: number; lowSum: number; lastFps: number; lastLow: number;
  waits: number; waitMsSum: number; boots: number; bootMsSum: number; lastAt: bigint;
}
export const FPS_MAX = 240;
/** Load times above this are not load times (a tab left on the loading screen): dropped. */
export const LOAD_MAX_MS = 120_000;
export const PERF_RATE_LIMIT_MICROS = 30_000_000n;
const PERF_SECONDS_SLACK = 60;

/**
 * The whole `perf_stats` rule: refused (undefined) inside 30 s of the identity's previous report, or
 * when it carries nothing (no frames and no load time); otherwise the new record. Frame rates are
 * clamped to 0–240 (the 1% low never above the median), seconds to the wall clock since the previous
 * report (plus a minute), load times to 0–120 s.
 */
export function acceptPerf(prev: PerfRecord | undefined, r: PerfReport, now: bigint): PerfRecord | undefined {
  if (prev && now - prev.lastAt < PERF_RATE_LIMIT_MICROS) return undefined;
  const maxSeconds = prev ? Math.min(86_400, Number((now - prev.lastAt) / 1_000_000n) + PERF_SECONDS_SLACK) : 86_400;
  const fps = whole(r.fps, FPS_MAX), low = Math.min(fps, whole(r.low, FPS_MAX));
  const seconds = fps > 0 ? whole(r.seconds, maxSeconds) : 0;
  const wait = whole(r.waitMs, LOAD_MAX_MS + 1), boot = whole(r.bootMs, LOAD_MAX_MS + 1);
  const waitOk = wait > 0 && wait <= LOAD_MAX_MS, bootOk = boot > 0 && boot <= LOAD_MAX_MS;
  if (seconds < 1 && !waitOk && !bootOk) return undefined;
  const p: PerfRecord = prev ?? { reports: 0, seconds: 0, fpsSum: 0, lowSum: 0, lastFps: 0, lastLow: 0, waits: 0, waitMsSum: 0, boots: 0, bootMsSum: 0, lastAt: 0n };
  return {
    reports: add32(p.reports, 1),
    seconds: add32(p.seconds, seconds), fpsSum: p.fpsSum + fps * seconds, lowSum: p.lowSum + low * seconds,
    lastFps: seconds >= 1 ? fps : p.lastFps, lastLow: seconds >= 1 ? low : p.lastLow,
    waits: waitOk ? add32(p.waits, 1) : p.waits, waitMsSum: p.waitMsSum + (waitOk ? wait : 0),
    boots: bootOk ? add32(p.boots, 1) : p.boots, bootMsSum: p.bootMsSum + (bootOk ? boot : 0),
    lastAt: now,
  };
}

// ---- Where players came from, and whom they invited ----------------------------------------

/** The `visit` reducer's arguments. */
export interface VisitReport { source: string; medium: string; campaign: string; inApp: string; refBy: string; ref: string; shares: number; duels: number }
/** A `player_source` row (identity aside). The first touch, the app and `refBy` are kept from the first report that has them. */
export interface VisitRecord { source: string; medium: string; campaign: string; inApp: string; refBy: string; ref: string; shares: number; duels: number; firstAt: bigint; lastAt: bigint }

export const VISIT_RATE_LIMIT_MICROS = 10_000_000n;
/** Share and duel counts may grow at most this much per report (a running count, so a replay changes nothing). */
export const COUNT_STEP_MAX = 50;
const REF = /^[a-z0-9]{6,12}$/;
/** Tags as `src/visit.ts` keeps them: lower case letters, digits and . _ -, at most 40 characters. */
export const cleanTag = (v: unknown, max = 40) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, max) : '');
const cleanRef = (v: unknown) => (typeof v === 'string' && REF.test(v) ? v : '');

/**
 * The whole `visit` rule: refused inside 10 s of the identity's previous report; otherwise the new
 * record. Source, medium and campaign come as one first touch (an empty source is `direct`), set once;
 * the in-app browser and the code the player arrived through are set once too (never their own code);
 * their own code follows the latest report; the counts only grow, by at most 50 a report.
 */
export function acceptVisit(prev: VisitRecord | undefined, r: VisitReport, now: bigint): VisitRecord | undefined {
  if (prev && now - prev.lastAt < VISIT_RATE_LIMIT_MICROS) return undefined;
  const ref = cleanRef(r.ref) || prev?.ref || '';
  const refBy = prev?.refBy || (cleanRef(r.refBy) !== ref ? cleanRef(r.refBy) : '');
  const grow = (old: number, v: unknown) => Math.max(old, Math.min(old + COUNT_STEP_MAX, whole(v, U32)));
  const touch = prev ? { source: prev.source, medium: prev.medium, campaign: prev.campaign } : { source: cleanTag(r.source) || 'direct', medium: cleanTag(r.medium), campaign: cleanTag(r.campaign) };
  return {
    ...touch, inApp: prev?.inApp || cleanTag(r.inApp, 20), refBy, ref,
    shares: grow(prev?.shares ?? 0, r.shares), duels: grow(prev?.duels ?? 0, r.duels), firstAt: prev?.firstAt ?? now, lastAt: now,
  };
}

/** What the visit says about where a player came from, for the admin page: the in-app browser, else the source. */
export const channelOf = (v: { source: string; inApp: string }) => (v.inApp ? `${v.inApp} app` : v.source || 'direct');

// ---- How far a new player gets ---------------------------------------------------------------

/** A `player_milestone` row (identity aside): when each first happened (epoch µs, 0 = not yet). */
export interface Milestones { room: bigint; round: bigint; kill: bigint; match: bigint }
export const NO_MILESTONES: Milestones = { room: 0n, round: 0n, kill: 0n, match: 0n };

/** Stamp the firsts that `happened` now (career counts above zero); undefined when nothing new. */
export function noteMilestones(prev: Milestones | undefined, happened: { room?: boolean; rounds?: number; kills?: number; matches?: number }, now: bigint): Milestones | undefined {
  const m = { ...(prev ?? NO_MILESTONES) };
  let changed = !prev;
  const stamp = (k: keyof Milestones, yes: boolean) => { if (yes && !m[k]) { m[k] = now; changed = true; } };
  stamp('room', !!happened.room || (happened.rounds ?? 0) > 0);
  stamp('round', (happened.rounds ?? 0) > 0);
  stamp('kill', (happened.kills ?? 0) > 0);
  stamp('match', (happened.matches ?? 0) > 0);
  return changed ? m : undefined;
}

// ---- How full rooms are ----------------------------------------------------------------------

/** A `room_hour` row (hour aside): room-minutes, seat-minutes and human-minutes, and the hour's joins, leaves, drops and idle kicks. */
export interface RoomHour { roomMinutes: number; seatMinutes: number; humanMinutes: number; botMinutes: number; joins: number; leaves: number; drops: number; kicks: number }
export const EMPTY_ROOM_HOUR: RoomHour = { roomMinutes: 0, seatMinutes: 0, humanMinutes: 0, botMinutes: 0, joins: 0, leaves: 0, drops: 0, kicks: 0 };

/** One room's minute: its seats (both teams), the humans and the bots in it. */
export function foldRoomMinute(prev: RoomHour | undefined, room: { seats: number; humans: number; bots: number }): RoomHour {
  const h = prev ?? EMPTY_ROOM_HOUR;
  return {
    ...h, roomMinutes: add32(h.roomMinutes, 1), seatMinutes: add32(h.seatMinutes, whole(room.seats, 1000)),
    humanMinutes: add32(h.humanMinutes, whole(room.humans, 1000)), botMinutes: add32(h.botMinutes, whole(room.bots, 1000)),
  };
}

/** A join, a leave (left on purpose), a drop (the connection closed while in a room) or an idle kick. */
export function countRoomEvent(prev: RoomHour | undefined, kind: 'joins' | 'leaves' | 'drops' | 'kicks'): RoomHour {
  const h = prev ?? EMPTY_ROOM_HOUR;
  return { ...h, [kind]: add32(h[kind], 1) };
}
