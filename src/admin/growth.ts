import { median } from '../../shared/netstats';
import { channelOf } from '../../shared/metrics';

/**
 * The growth scorecard on the admin page (pure, for tests): one question per stage of the funnel,
 * answered from the module's views, graded against a target, with what to look at when it is off.
 *
 * Stages: Acquisition (new players, by channel), Activation (how far a new player gets in their first
 * 24 hours), Retention (day 1 and day 7), Engagement (play time per active day, the 30+ round core),
 * Virality (invites that became players: the K-factor), Server health (drops, room fill) and
 * Quality (frame rate, load times). Everything is online play only: Solo never reaches the server.
 */

const DAY_MS = 86_400_000;

// ---- Targets ---------------------------------------------------------------------------------

/**
 * What counts as on track (`good`) and as a problem (below `watch`, or above it when lower is better).
 * Rules of thumb for free browser and mobile shooters; tune them here as the game's own history grows.
 */
export const TARGETS = {
  /** New players this week against last week (a change; −0.3 = 30% fewer). */
  growth: { good: 0, watch: -0.3, why: 'new players this week vs last week' },
  /** New players who made a kill within 24 hours of first connecting. */
  activation: { good: 0.6, watch: 0.4, why: 'a first kill in the first 24 h' },
  /** New players back on the next UTC day. Mobile and web games: ~25–35% is healthy. */
  d1: { good: 0.3, watch: 0.2, why: 'D1 of 30%+ is healthy for web and mobile games' },
  d7: { good: 0.1, watch: 0.05, why: 'D7 of 10%+ is healthy' },
  /** Online minutes per player per active day. */
  minutes: { good: 20, watch: 10, why: 'minutes per player per active day' },
  /** New players brought by shares per player (K-factor). Above 0.3 sharing is a real channel. */
  k: { good: 0.3, watch: 0.1, why: 'K above 0.3 makes sharing a real channel' },
  /** Connections that closed in a room, per join (lower is better). */
  drops: { good: 0.05, watch: 0.15, lower: true, why: 'drops per join' },
  /** Seats taken by humans (bots fill the rest). */
  fill: { good: 0.5, watch: 0.25, why: 'human share of seats' },
  /** Median frames per second on phones. */
  fps: { good: 50, watch: 30, why: 'median fps; under 30 feels broken in a shooter' },
} as const;

export type Status = 'good' | 'watch' | 'bad' | 'none';
interface Target { good: number; watch: number; lower?: boolean }

/** How a value stands against a target (`none` without a value). */
export function grade(v: number | undefined, t: Target): Status {
  if (v === undefined || !Number.isFinite(v)) return 'none';
  if (t.lower) return v <= t.good ? 'good' : v <= t.watch ? 'watch' : 'bad';
  return v >= t.good ? 'good' : v >= t.watch ? 'watch' : 'bad';
}
const STATUS_ORDER: Record<Status, number> = { bad: 0, watch: 1, good: 2, none: 3 };
/** The worse of two statuses (`none` only when both are). */
export const worse = (a: Status, b: Status): Status => (STATUS_ORDER[a] <= STATUS_ORDER[b] ? a : b);

// ---- The players the page knows ------------------------------------------------------------------

/** Firsts in ms since the epoch: 0 = not yet, 1 = before they were recorded. */
export interface FirstsOf { room: number; round: number; kill: number; match: number }
export interface SourceOf { source: string; medium: string; campaign: string; inApp: string; referred: boolean; shares: number; duels: number; invited: number; invitedPlayed: number }
export interface PerfOf { fps: number; low: number; seconds: number; waitMs: number; waits: number; bootMs: number; boots: number; lastAtMs: number }

/** What these functions need of an admin page player. */
export interface GrowthPlayer {
  name: string; firstSeenMs: number; firstDay: number; days: ReadonlySet<number>; rounds: number; playTime: number;
  daySeconds?: ReadonlyMap<number, number>; firsts?: FirstsOf; src?: SourceOf; perf?: PerfOf;
}

/** When firsts began to be recorded: the earliest real first room (undefined before any). */
export function firstsSince(players: Iterable<GrowthPlayer>): number | undefined {
  let since: number | undefined;
  for (const p of players) { const r = p.firsts?.room ?? 0; if (r > 1 && (since === undefined || r < since)) since = r; }
  return since;
}

// ---- Activation ------------------------------------------------------------------------------

export const FUNNEL_STEPS = [
  { key: 'seen', label: 'Connected', hint: 'pressed Play Online', fix: '' },
  { key: 'room', label: 'Entered a room', hint: 'within 24 h', fix: 'Joining fails or takes too long: check Wait to match, join errors (error_shown in PostHog) and the server choice.' },
  { key: 'round', label: 'Finished a round', hint: 'within 24 h', fix: 'Players leave before their first round ends: shorten freeze and buy time for newcomers, or make the first spawn closer to the fight.' },
  { key: 'kill', label: 'Made a kill', hint: 'within 24 h', fix: 'Players never land a kill: look at the first two minutes (spawn to first fight, rookie bots, touch aim assist).' },
  { key: 'match', label: 'Finished a match', hint: 'within 24 h', fix: 'Matches outlast new players: consider shorter matches for rookies, or reward stopping mid-match less harshly.' },
  { key: 'back', label: 'Came back', hint: 'on a later UTC day', fix: '' },
] as const;
export type StepKey = (typeof FUNNEL_STEPS)[number]['key'];
export interface Step { key: StepKey; label: string; hint: string; fix: string; n: number; rate: number; fromPrev: number }

/**
 * New players' first 24 hours: of the players first seen from `fromMs` to `toMs` (only those whose
 * 24 hours are over by `nowMs`, and only since firsts are recorded), how many reached each step.
 * `rate` is of everyone in the cohort, `fromPrev` of the step before.
 */
export function activation(players: Iterable<GrowthPlayer>, fromMs: number, toMs: number, nowMs: number, since: number | undefined): { cohort: number; steps: Step[] } {
  const start = Math.max(fromMs, since ?? Infinity), end = Math.min(toMs, nowMs - DAY_MS);
  const counts: Record<StepKey, number> = { seen: 0, room: 0, round: 0, kill: 0, match: 0, back: 0 };
  for (const p of players) {
    if (p.firstSeenMs < start || p.firstSeenMs > end) continue;
    counts.seen++;
    const within = (at: number | undefined) => !!at && at > 1 && at - p.firstSeenMs <= DAY_MS;
    if (within(p.firsts?.room)) counts.room++;
    if (within(p.firsts?.round)) counts.round++;
    if (within(p.firsts?.kill)) counts.kill++;
    if (within(p.firsts?.match)) counts.match++;
    for (const d of p.days) if (d > p.firstDay) { counts.back++; break; }
  }
  const steps = FUNNEL_STEPS.map((s, i) => {
    // Coming back is measured against everyone who connected, not the step before it.
    const n = counts[s.key], prev = s.key === 'back' ? counts.seen : i ? counts[FUNNEL_STEPS[i - 1].key] : n;
    return { ...s, n, rate: counts.seen ? n / counts.seen : 0, fromPrev: prev ? n / prev : 0 };
  });
  return { cohort: counts.seen, steps };
}

/** The step (after the first) that loses the largest share of the players who reached the one before. */
export function worstStep(steps: Step[]): Step | undefined {
  let worst: Step | undefined;
  for (const s of steps.slice(1)) if (s.key !== 'back' && steps[0].n && (!worst || s.fromPrev < worst.fromPrev)) worst = s;
  return worst;
}

// ---- Retention by day ---------------------------------------------------------------------

/** Of the players whose day N is over, the share active exactly N days after their first (undefined without any). */
export function dayN(players: Iterable<GrowthPlayer>, n: number, today: number): { players: number; back: number; rate: number } | undefined {
  let total = 0, back = 0;
  for (const p of players) {
    if (p.firstDay + n >= today) continue;
    total++;
    if (p.days.has(p.firstDay + n)) back++;
  }
  return total ? { players: total, back, rate: back / total } : undefined;
}

// ---- Channels ----------------------------------------------------------------------------

export interface ChannelRow {
  channel: string; players: number; share: number; activated?: number; d1?: number; d1n: number; d7?: number; d7n: number; minutes?: number;
}

/**
 * New players from `fromDay` on by channel (the in-app browser, else the first-touch source; players
 * from before sources were recorded are left out): how many, the share of them, how many made a kill
 * in their first 24 hours, D1 and D7 (of those whose day is over) and their median online minutes.
 */
export function channels(players: Iterable<GrowthPlayer>, fromDay: number, nowMs: number): ChannelRow[] {
  const today = Math.floor(nowMs / DAY_MS);
  const by = new Map<string, GrowthPlayer[]>();
  let total = 0;
  for (const p of players) {
    if (!p.src || p.firstDay < fromDay) continue;
    const c = channelOf(p.src);
    let list = by.get(c);
    if (!list) by.set(c, (list = []));
    list.push(p); total++;
  }
  const rows: ChannelRow[] = [];
  for (const [channel, list] of by) {
    const tracked = list.filter(p => p.firsts && p.firsts.room > 1 && p.firstSeenMs <= nowMs - DAY_MS);
    const killed = tracked.filter(p => p.firsts!.kill > 1 && p.firsts!.kill - p.firstSeenMs <= DAY_MS).length;
    const d1 = dayN(list, 1, today), d7 = dayN(list, 7, today);
    rows.push({
      channel, players: list.length, share: total ? list.length / total : 0, activated: tracked.length ? killed / tracked.length : undefined,
      d1: d1?.rate, d1n: d1?.players ?? 0, d7: d7?.rate, d7n: d7?.players ?? 0, minutes: (median(list.map(p => p.playTime / 60)) ?? 0),
    });
  }
  return rows.sort((a, b) => b.players - a.players || a.channel.localeCompare(b.channel));
}

// ---- Engagement --------------------------------------------------------------------------

export const ROUND_BUCKETS = [
  { label: '1–4', min: 1, max: 4 }, { label: '5–9', min: 5, max: 9 }, { label: '10–29', min: 10, max: 29 },
  { label: '30–99', min: 30, max: 99 }, { label: '100+', min: 100, max: Infinity },
] as const;
export const CORE_ROUNDS = 30;

/** Players by career rounds (players with none left out), with each bucket's share of players and of all rounds played. */
export function roundBuckets(players: Iterable<GrowthPlayer>) {
  const rows = ROUND_BUCKETS.map(b => ({ ...b, players: 0, rounds: 0, playerShare: 0, roundShare: 0 }));
  let players_ = 0, rounds = 0;
  for (const p of players) {
    if (p.rounds < 1) continue;
    const row = rows.find(r => p.rounds >= r.min && p.rounds <= r.max)!;
    row.players++; row.rounds += p.rounds; players_++; rounds += p.rounds;
  }
  for (const r of rows) { r.playerShare = players_ ? r.players / players_ : 0; r.roundShare = rounds ? r.rounds / rounds : 0; }
  const core = rows.filter(r => r.min >= CORE_ROUNDS);
  return {
    rows, players: players_, rounds,
    core: { players: core.reduce((n, r) => n + r.players, 0), playerShare: core.reduce((n, r) => n + r.playerShare, 0), roundShare: core.reduce((n, r) => n + r.roundShare, 0) },
  };
}

/** Online minutes per player per active day from `from` to `to` (UTC days): play time over player-days with any play. */
export function minutesPerActiveDay(players: Iterable<GrowthPlayer>, from: number, to: number): number | undefined {
  let seconds = 0, playerDays = 0;
  for (const p of players) for (const [d, s] of p.daySeconds ?? []) if (d >= from && d <= to && s > 0) { seconds += s; playerDays++; }
  return playerDays ? seconds / 60 / playerDays : undefined;
}

// ---- Virality ----------------------------------------------------------------------------

/**
 * Invites and what they brought, over every player who reported a visit: sharers, invites (share
 * cards sent plus duels opened), players a share brought who entered a room, and the K-factor (those
 * players per player). Running totals since visits were recorded.
 */
export function virality(players: Iterable<GrowthPlayer>) {
  let reporting = 0, sharers = 0, invites = 0, brought = 0, broughtPlayed = 0, referred = 0;
  for (const p of players) {
    const s = p.src;
    if (!s) continue;
    reporting++;
    const sent = s.shares + s.duels;
    if (sent > 0) sharers++;
    invites += sent; brought += s.invited; broughtPlayed += s.invitedPlayed;
    if (s.referred) referred++;
  }
  return {
    reporting, sharers, invites, brought, broughtPlayed, referred,
    sharerShare: reporting ? sharers / reporting : undefined,
    perSharer: sharers ? invites / sharers : undefined,
    conversion: invites ? broughtPlayed / invites : undefined,
    k: reporting ? broughtPlayed / reporting : undefined,
  };
}

// ---- Server health -----------------------------------------------------------------------

export interface RoomHourOf { hour: number; roomMinutes: number; seatMinutes: number; humanMinutes: number; botMinutes: number; joins: number; leaves: number; drops: number; kicks: number }
export interface RoomHealth { roomMinutes: number; fill?: number; humansPerRoom?: number; joins: number; drops: number; kicks: number; leaves: number; dropRate?: number; kickRate?: number }

/** Rooms over the hours from `from` to `to` (inclusive): human share of seats, humans per room, drops and idle kicks per join. */
export function roomHealth(rows: Iterable<RoomHourOf>, from: number, to: number): RoomHealth {
  const t = { roomMinutes: 0, seatMinutes: 0, humanMinutes: 0, joins: 0, leaves: 0, drops: 0, kicks: 0 };
  for (const r of rows) {
    if (r.hour < from || r.hour > to) continue;
    t.roomMinutes += r.roomMinutes; t.seatMinutes += r.seatMinutes; t.humanMinutes += r.humanMinutes;
    t.joins += r.joins; t.leaves += r.leaves; t.drops += r.drops; t.kicks += r.kicks;
  }
  return {
    roomMinutes: t.roomMinutes, joins: t.joins, drops: t.drops, kicks: t.kicks, leaves: t.leaves,
    fill: t.seatMinutes ? t.humanMinutes / t.seatMinutes : undefined, humansPerRoom: t.roomMinutes ? t.humanMinutes / t.roomMinutes : undefined,
    dropRate: t.joins ? t.drops / t.joins : undefined, kickRate: t.joins ? t.kicks / t.joins : undefined,
  };
}

/** Room health per bucket (hours, or UTC days of 24 hours). */
export function roomHealthBy(rows: readonly RoomHourOf[], keys: readonly number[], hourly: boolean): Map<number, RoomHealth> {
  const out = new Map<number, RoomHealth>();
  for (const k of keys) {
    const h = hourly ? roomHealth(rows, k, k) : roomHealth(rows, k * 24, k * 24 + 23);
    if (h.roomMinutes || h.joins) out.set(k, h);
  }
  return out;
}

// ---- Quality -----------------------------------------------------------------------------

/** Frame rate and load times over players who reported since `sinceMs`: medians, and the share under 30 fps. */
export function quality(players: Iterable<GrowthPlayer>, sinceMs: number) {
  const fps: number[] = [], low: number[] = [], wait: number[] = [], boot: number[] = [];
  let slow = 0;
  for (const p of players) {
    const f = p.perf;
    if (!f || f.lastAtMs < sinceMs) continue;
    if (f.seconds > 0 && f.fps > 0) { fps.push(f.fps); low.push(f.low); if (f.fps < 30) slow++; }
    if (f.waits) wait.push(f.waitMs);
    if (f.boots) boot.push(f.bootMs);
  }
  return {
    players: fps.length, fps: median(fps), low: median(low), slowShare: fps.length ? slow / fps.length : undefined,
    waitMs: median(wait), waits: wait.length, bootMs: median(boot), boots: boot.length,
  };
}

/** Frame rate by in-app browser (or plain browser) among players who reported since `sinceMs`, slowest first. */
export function qualityByBrowser(players: Iterable<GrowthPlayer>, sinceMs: number) {
  const by = new Map<string, GrowthPlayer[]>();
  for (const p of players) {
    if (!p.perf || p.perf.lastAtMs < sinceMs || !(p.perf.seconds > 0)) continue;
    const k = p.src?.inApp ? `${p.src.inApp} app` : 'browser';
    let list = by.get(k);
    if (!list) by.set(k, (list = []));
    list.push(p);
  }
  return [...by].map(([browser, list]) => ({ browser, ...quality(list, sinceMs) })).sort((a, b) => (a.fps ?? 0) - (b.fps ?? 0));
}

// ---- Formatting --------------------------------------------------------------------------

/** A share as "42%", "<1%" for a sliver; "—" without one. */
export const pct = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '—' : v > 0 && v < 0.005 ? '<1%' : `${Math.round(v * 100)}%`);
/** Milliseconds as "850 ms" or "4.2 s"; "—" without them. */
export const secs = (ms: number | undefined) => (ms === undefined ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
