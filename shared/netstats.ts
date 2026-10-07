/**
 * Connection quality: each online player's real ping and movement corrections.
 *
 * Client (src/net/online.ts): the round trip of a movement report (`report`, `vehicle_report`) is
 * sampled at most every 500 ms, the same samples the HUD's "120 MS" is smoothed from, into a
 * `NetMeter` ring of the last 600 (about five minutes). The meter also counts the server's
 * corrections of our soldier (rejected movement reports, replicated as `roster.corrections`) and the
 * time spent in an online room (a backgrounded tab dropped from its room does not count).
 *
 * `NetReporter` decides when to tell whom:
 * - the server (`net_stats`): every 2 minutes in a room, and once on leaving, so a closed tab loses at
 *   most 2 minutes; each report covers the stretch since the previous one;
 * - PostHog: `net_sample` every 5 minutes of a long match, and the match's numbers on `match_left`.
 *
 * Server (`net_stats` in spacetimedb/src/index.ts): `acceptNetReport` validates and clamps a report
 * and folds it into the identity's `player_net` row (and `foldNetDay` into `player_day_net`). One
 * report per identity per 30 s; the rest are ignored.
 *
 * This file is pure logic, so tests can run it with fake clocks.
 */

/** Round-trip samples kept (the newest), about five minutes at two a second. */
export const RING_SIZE = 600;
/** Samples are taken at most this often (ms). */
export const SAMPLE_EVERY_MS = 500;
/** Highest round trip recorded (ms): a longer one (a tab back from the background) counts as this. */
export const PING_MAX_MS = 5000;
export const SAMPLES_MAX = 100_000;
export const SECONDS_MAX = 86_400;
/** The server ticks at 30 Hz and corrects a soldier at most once per tick. */
export const CORRECTIONS_PER_SECOND_MAX = 30;
/** Client: a report to the server this often while in a match (ms). */
export const REPORT_EVERY_MS = 120_000;
/** Client: a `net_sample` analytics event this often in a long match (ms). */
export const EVENT_EVERY_MS = 300_000;
/** Server: one report per identity per 30 s. */
export const RATE_LIMIT_MICROS = 30_000_000n;
/** Server: a report may claim this many seconds more than the wall clock since the previous one. */
export const SECONDS_SLACK = 60;
const U32 = 0xffffffff;

/** The `p`th percentile (0–100) of `values`, interpolated between neighbours; undefined when empty. */
export function percentile(values: ArrayLike<number>, p: number): number | undefined {
  const sorted = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const at = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

export const median = (values: ArrayLike<number>) => percentile(values, 50);

// ---- Client: measuring --------------------------------------------------------------------

/** A point in the meter's history; a window runs from a mark to now. */
export interface NetMark { at: number; samples: number; corrections: number; roomMs: number }

/** What a window measured: round-trip percentiles over its newest ≤600 samples, corrections and room time. */
export interface NetWindow { p50: number; p95: number; samples: number; corrections: number; seconds: number }

/** Round-trip samples (a ring of the newest 600), corrections, and the time spent in a room. Times in ms. */
export class NetMeter {
  private ring = new Float64Array(RING_SIZE);
  /** Samples ever taken (the ring holds the newest `RING_SIZE`). */
  samples = 0;
  corrections = 0;
  /** Time in an online room so far, up to the last `clock` call. */
  private roomMs = 0;
  private clockAt: number;
  private inRoom = true;

  constructor(now: number) { this.clockAt = now; }

  /** A round trip in ms (clamped to 0–5000; anything not finite is ignored). */
  sample(ms: number) {
    if (!Number.isFinite(ms)) return;
    this.ring[this.samples % RING_SIZE] = Math.min(PING_MAX_MS, Math.max(0, ms));
    this.samples++;
  }

  /** The server corrected our soldier `n` times. */
  correct(n = 1) { if (n > 0 && Number.isFinite(n)) this.corrections += Math.round(n); }

  /** Advance the room clock to `now`; `inRoom` says whether we have a soldier in a room from now on. */
  clock(now: number, inRoom = this.inRoom) {
    if (this.inRoom && now > this.clockAt) this.roomMs += now - this.clockAt;
    this.clockAt = Math.max(this.clockAt, now);
    this.inRoom = inRoom;
  }

  /** The newest `n` samples (at most the ring), oldest first. */
  recent(n = RING_SIZE): number[] {
    const count = Math.min(n, this.samples, RING_SIZE);
    const out: number[] = [];
    for (let i = this.samples - count; i < this.samples; i++) out.push(this.ring[i % RING_SIZE]);
    return out;
  }

  mark(now: number): NetMark { this.clock(now); return { at: now, samples: this.samples, corrections: this.corrections, roomMs: this.roomMs }; }

  /** What was measured since `mark` (percentiles over the newest ≤600 of its samples). */
  since(mark: NetMark, now: number): NetWindow {
    this.clock(now);
    const samples = this.samples - mark.samples;
    const recent = this.recent(samples);
    return {
      p50: percentile(recent, 50) ?? 0, p95: percentile(recent, 95) ?? 0, samples,
      corrections: this.corrections - mark.corrections, seconds: (this.roomMs - mark.roomMs) / 1000,
    };
  }
}

/** The `net_stats` reducer's arguments. */
export interface NetReport { p50Ms: number; p95Ms: number; samples: number; corrections: number; seconds: number }

/** Analytics fields (`net_sample`, and `match_left` without `seconds`, which it already has). */
export interface NetFields { ping_p50: number; ping_p95: number; samples: number; corrections: number; corrections_per_min: number; seconds: number }

const round2 = (n: number) => Math.round(n * 100) / 100;
export const perMinute = (corrections: number, seconds: number) => (seconds >= 1 ? round2(corrections / (seconds / 60)) : 0);

export const toReport = (w: NetWindow): NetReport => ({
  p50Ms: Math.round(w.p50), p95Ms: Math.round(w.p95), samples: w.samples, corrections: w.corrections, seconds: Math.round(w.seconds),
});
export const toFields = (w: NetWindow): NetFields => ({
  ping_p50: Math.round(w.p50), ping_p95: Math.round(w.p95), samples: w.samples, corrections: w.corrections,
  corrections_per_min: perMinute(w.corrections, w.seconds), seconds: Math.round(w.seconds),
});

/** A window worth sending: it has samples and at least a second in a room. */
const worth = (w: NetWindow) => w.samples >= 1 && w.seconds >= 1;

/**
 * When to report. `poll` (call it every few seconds) hands out the server report every 2 minutes and
 * the analytics sample every 5; a window without samples (dead, spectating) waits and carries over
 * into the next. `leave` hands out the last server report (skipped when the previous one went out
 * under 30 s ago: the server would ignore it) and the match's numbers, and closes the reporter.
 */
export class NetReporter {
  readonly meter: NetMeter;
  private start: NetMark;
  private toServer: NetMark;
  private toEvent: NetMark;
  private lastSent = -Infinity;
  private closed = false;

  constructor(now: number) {
    this.meter = new NetMeter(now);
    this.start = this.toServer = this.toEvent = this.meter.mark(now);
  }

  get done() { return this.closed; }

  poll(now: number, inRoom?: boolean): { report?: NetReport; event?: NetFields } {
    if (this.closed) return {};
    this.meter.clock(now, inRoom);
    const out: { report?: NetReport; event?: NetFields } = {};
    if (now - this.toServer.at >= REPORT_EVERY_MS) {
      const w = this.meter.since(this.toServer, now);
      if (worth(w)) { out.report = toReport(w); this.toServer = this.meter.mark(now); this.lastSent = now; }
    }
    if (now - this.toEvent.at >= EVENT_EVERY_MS) {
      const w = this.meter.since(this.toEvent, now);
      if (worth(w)) { out.event = toFields(w); this.toEvent = this.meter.mark(now); }
    }
    return out;
  }

  /** The match's numbers so far (percentiles over the newest ≤600 samples; totals for the rest). */
  totals(now: number): NetFields { return toFields(this.meter.since(this.start, now)); }

  leave(now: number): { report?: NetReport; totals: NetFields } {
    const totals = this.totals(now);
    if (this.closed) return { totals };
    this.closed = true;
    const w = this.meter.since(this.toServer, now);
    const report = worth(w) && now - this.lastSent >= Number(RATE_LIMIT_MICROS / 1000n) ? toReport(w) : undefined;
    return { report, totals };
  }
}

// ---- Server: validating and recording -----------------------------------------------------

/** A `player_net` row: reports so far, the latest and the typical (time-weighted mean) percentiles, totals. */
export interface NetRecord {
  reports: number; lastP50: number; lastP95: number; avgP50: number; avgP95: number; worstP95: number;
  corrections: number; measuredSeconds: number; lastAt: bigint;
}

/** A report after cleaning: whole ms 0–5000 (p95 ≥ p50), samples 1–100000, seconds 1–86400, corrections capped. */
export interface CleanNetReport { p50: number; p95: number; samples: number; corrections: number; seconds: number }

const whole = (v: number, max: number) => (Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : 0);

/**
 * Validate and clamp a report, or refuse it (undefined): no samples or under a second measured.
 * `maxSeconds` caps the seconds further (the wall clock since the identity's previous report);
 * corrections are capped at what the 30 Hz tick could have made in those seconds.
 */
export function cleanNetReport(r: NetReport, maxSeconds = SECONDS_MAX): CleanNetReport | undefined {
  const samples = whole(r.samples, SAMPLES_MAX);
  const seconds = whole(r.seconds, Math.max(1, Math.min(SECONDS_MAX, maxSeconds)));
  if (samples < 1 || seconds < 1) return undefined;
  const p50 = whole(r.p50Ms, PING_MAX_MS);
  const p95 = Math.max(p50, whole(r.p95Ms, PING_MAX_MS));
  return { p50, p95, samples, seconds, corrections: whole(r.corrections, seconds * CORRECTIONS_PER_SECOND_MAX) };
}

/** May an identity whose record is `prev` report at `now`? One report per 30 s. */
export const netReportAllowed = (prev: Pick<NetRecord, 'lastAt'> | undefined, now: bigint) => !prev || now - prev.lastAt >= RATE_LIMIT_MICROS;

const add32 = (a: number, b: number) => Math.min(U32, a + b);

/** Fold a clean report into a record: the typical percentiles are means weighted by measured seconds. */
export function foldNetReport(prev: NetRecord | undefined, r: CleanNetReport, now: bigint): NetRecord {
  const m = prev?.measuredSeconds ?? 0;
  const mean = (old: number, v: number) => (m > 0 ? (old * m + v * r.seconds) / (m + r.seconds) : v);
  return {
    reports: add32(prev?.reports ?? 0, 1), lastP50: r.p50, lastP95: r.p95,
    avgP50: mean(prev?.avgP50 ?? 0, r.p50), avgP95: mean(prev?.avgP95 ?? 0, r.p95), worstP95: Math.max(prev?.worstP95 ?? 0, r.p95),
    corrections: add32(prev?.corrections ?? 0, r.corrections), measuredSeconds: add32(m, r.seconds), lastAt: now,
  };
}

/**
 * The whole `net_stats` rule: refused (undefined) inside 30 s of the identity's previous report or
 * when the report is not worth keeping; otherwise the cleaned report and the new record. A report
 * may not claim more seconds than the wall clock since the previous one (plus a minute of slack).
 */
export function acceptNetReport(prev: NetRecord | undefined, r: NetReport, now: bigint): { record: NetRecord; report: CleanNetReport } | undefined {
  if (!netReportAllowed(prev, now)) return undefined;
  const maxSeconds = prev ? Math.min(SECONDS_MAX, Number((now - prev.lastAt) / 1_000_000n) + SECONDS_SLACK) : SECONDS_MAX;
  const report = cleanNetReport(r, maxSeconds);
  if (!report) return undefined;
  return { report, record: foldNetReport(prev, report, now) };
}

/** A `player_day_net` row: one player's reports on one UTC day (sums weighted by seconds, so means can be taken). */
export interface NetDay { reports: number; seconds: number; p50Sum: number; p95Sum: number; corrections: number }

export function foldNetDay(prev: NetDay | undefined, r: CleanNetReport): NetDay {
  return {
    reports: add32(prev?.reports ?? 0, 1), seconds: add32(prev?.seconds ?? 0, r.seconds),
    p50Sum: (prev?.p50Sum ?? 0) + r.p50 * r.seconds, p95Sum: (prev?.p95Sum ?? 0) + r.p95 * r.seconds,
    corrections: add32(prev?.corrections ?? 0, r.corrections),
  };
}
