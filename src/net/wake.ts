/**
 * Reaching the game server, and waking it when it sleeps. Of our servers only Singapore (InstaCloud)
 * scales to zero (`scalesToZero` in servers.ts): after a quiet spell its machine stops, and the next
 * request (HTTP or websocket) boots it, the container first and then the database. That takes from a
 * few seconds to a minute or two, and meanwhile the edge answers 502/503/504, holds the request or
 * times out. For such a server the lobby and /admin show "waking" (asleep, not down) and keep trying
 * gently until it answers, giving up after 3 minutes. Taipei, Maincloud and a local dev server are
 * always on: a failed ping or connect there only means "can't reach it" (a bad network, a restart),
 * so the screen keeps saying "connecting", retries for 30 s and then says unreachable. `sleeps` in the
 * limits picks the behaviour (`ALWAYS_ON` is the second set).
 *
 *   idle → probing → ready                 a reachable server: nothing extra is shown (a slow one only says "connecting")
 *            │ a failed ping or connect
 *            ▼  (sleeping servers only)
 *          waking → ready                  it booted; a play action pressed meanwhile runs now, once
 *            │ 3 minutes (always-on: 30 s) without an answer
 *            ▼
 *          unreachable → probing           Retry (or pressing play) starts over
 *
 * A live connection that drops goes back to probing. `step` is the pure state machine; `WakeDriver`
 * runs it with one `/v1/ping` in flight at a time (every 2–3 s while failing) and one connection in
 * flight at a time, opened at once, then after the host answers a ping (or every 15 s regardless).
 * Nothing retries on its own once unreachable: a server that is really down is left alone, and a
 * sleeping one is not woken by a forgotten tab.
 */
export type WakePhase = 'idle' | 'probing' | 'waking' | 'ready' | 'unreachable';

export interface WakeState<A> {
  phase: WakePhase;
  /** When this attempt to reach the server began (ms on the driver's clock): the waking timer counts from here. */
  since: number;
  /** Failed pings and connects in this attempt (sets the retry backoff). */
  failures: number;
  /** The host answered `/v1/ping`: the machine is up, the database may still be loading. */
  hostUp: boolean;
  /** This attempt went through `waking`: a ping or connect failed (the server was asleep or restarting). */
  woke: boolean;
  /** This attempt has run `slowMs` without an answer (not necessarily asleep: see `woke`). */
  slow: boolean;
  /** A play action pressed before the server was up: it runs once, on `ready`. */
  queued?: A;
}

export type WakeEvent<A> =
  | { type: 'start' } // begin (no-op unless idle)
  | { type: 'retry' } // start over after giving up
  | { type: 'cold'; from: 'ping' | 'connect' } // a ping that was not a 200 (5xx, network error, timeout), or a failed connect
  | { type: 'hostUp' } // `/v1/ping` answered 200
  | { type: 'up' } // the connection is live
  | { type: 'down' } // a live connection dropped
  | { type: 'tick' } // time passed
  | { type: 'queue'; action: A } // a play button: run now if ready, else when ready
  | { type: 'cancel' } // drop the queued action
  | { type: 'stop' }; // leave (a match starts, the admin page switches server)

export const WAKE = {
  /**
   * No answer this long on an attempt makes it `slow` (analytics only: the screen keeps saying "connecting").
   * Only a failed ping or connect says the server is asleep; the always-on Taipei server took 3–6 s to answer a
   * quarter of visitors (phones, a lazy chunk, cold TLS), and "asleep" copy for that was wrong.
   */
  slowMs: 6000,
  /** True: a failed ping or connect means the server is asleep (`waking`); false: it only means unreachable. */
  sleeps: true,
  /** Give up (unreachable) after this long. */
  giveUpMs: 180_000,
  /** How long a wake usually takes: the copy says "about 30 s" and the bar fills by then. */
  expectMs: 30_000,
  /** One ping may take this long (the edge can hold a request while the machine boots). */
  pingTimeoutMs: 4000,
  /** A connection that is not live by then is dropped (a new one follows the next good ping). */
  connectTimeoutMs: 20_000,
  /** While pings fail, still try a connection this often (in case pings are blocked). */
  connectEveryMs: 15_000,
};
export type WakeLimits = typeof WAKE;
/** For a server that never sleeps: failures are not "asleep", and unreachable comes after 30 s of trying. */
export const ALWAYS_ON: WakeLimits = { ...WAKE, sleeps: false, giveUpMs: 30_000 };

export const idleWake = <A>(): WakeState<A> => ({ phase: 'idle', since: 0, failures: 0, hostUp: false, woke: false, slow: false });

/** The state machine: the next state for an event at `now`, and the queued action to run (at most once). */
export function step<A>(s: WakeState<A>, e: WakeEvent<A>, now: number, limits: WakeLimits = WAKE): { state: WakeState<A>; run?: A } {
  const begin = (queued: A | undefined): WakeState<A> => ({ phase: 'probing', since: now, failures: 0, hostUp: false, woke: false, slow: false, queued });
  const trying = s.phase === 'probing' || s.phase === 'waking';
  switch (e.type) {
    case 'start': return { state: s.phase === 'idle' ? begin(undefined) : s };
    case 'retry': return { state: s.phase === 'unreachable' ? begin(s.queued) : s };
    case 'down': return { state: s.phase === 'ready' ? begin(s.queued) : s };
    case 'stop': return { state: s.phase === 'idle' ? s : idleWake<A>() };
    case 'cold': {
      if (!trying) return { state: s };
      const failures = s.failures + 1;
      // A failed connect while the host answers pings: the machine is up, the database is still loading.
      const hostUp = e.from === 'connect' && s.hostUp;
      if (now - s.since >= limits.giveUpMs) return { state: { ...s, phase: 'unreachable', failures, hostUp: false } };
      // A server that never sleeps is not "waking": it stays probing (counting failures) until it answers or we give up.
      return { state: limits.sleeps ? { ...s, phase: 'waking', woke: true, failures, hostUp } : { ...s, failures, hostUp } };
    }
    case 'hostUp': return { state: trying && !s.hostUp ? { ...s, hostUp: true } : s };
    case 'up': {
      if (!trying) return { state: s };
      return { state: { ...s, phase: 'ready', hostUp: true, queued: undefined }, run: s.queued };
    }
    case 'tick': {
      // (Timers pause while a laptop sleeps: one tick may jump past both limits.)
      if (trying && now - s.since >= limits.giveUpMs) return { state: { ...s, phase: 'unreachable', hostUp: false } };
      if (trying && !s.slow && now - s.since >= limits.slowMs) return { state: { ...s, slow: true } };
      return { state: s };
    }
    case 'queue': {
      if (s.phase === 'ready') return { state: s, run: e.action };
      // Pressing play after giving up tries again, and plays once the server is up.
      if (s.phase === 'unreachable') return { state: begin(e.action) };
      if (s.phase === 'idle') return { state: s };
      return { state: s.queued === e.action ? s : { ...s, queued: e.action } };
    }
    case 'cancel': return { state: s.queued === undefined ? s : { ...s, queued: undefined } };
  }
}

/** Whole seconds since this attempt began. */
export const wakeSeconds = (s: WakeState<unknown>, now: number) => Math.max(0, Math.floor((now - s.since) / 1000));

/**
 * The waking bar, 0..1: fills to 90% over the expected wake time, then creeps on towards 99% so a
 * slow wake still moves without ever looking finished.
 */
export function wakeProgress(ms: number, expect = WAKE.expectMs) {
  if (ms <= 0) return 0;
  if (ms <= expect) return 0.9 * (ms / expect);
  return 0.9 + 0.09 * (1 - Math.exp(-(ms - expect) / (expect * 2)));
}

/** Gentle backoff between pings while waking: 2 s, then 2.5 s, then every 3 s. */
export const retryDelay = (failures: number) => Math.min(3000, 2000 + 500 * Math.max(0, failures - 1));

/** A connection the driver opens: `live` settles once (resolves when usable, rejects when it failed). */
export interface WakeLink {
  live: Promise<void>;
  stop(): void;
  /** Milliseconds the connection spent loading its code (the lazy SDK chunk) before it could dial, once known. */
  importMs?(): number | undefined;
}

/** How the current attempt went, for `server_woke`: the first ping, and the connection that came up. */
export interface WakeTimings {
  /** The first ping's round trip (ms) and whether it answered 200. */
  pingMs?: number; pingOk?: boolean;
  /** The connection that went live: dial to live (ms), and the part of it spent loading its code. */
  connectMs?: number; importMs?: number;
}

export interface WakeDeps {
  /** One `/v1/ping`: true when the host answered 200 (false or a rejection: not up). */
  ping(signal: AbortSignal): Promise<boolean>;
  /** Whether the server being reached scales to zero (asked afresh at every event: the lobby can switch servers). */
  sleeps?(): boolean;
  /** Open the real connection; `lost` is called if it drops after being live. */
  connect(lost: () => void): WakeLink;
  now?: () => number;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * Runs the state machine: pings, connects, the 1 s tick and the queued action. `onChange` fires on
 * every state change and every second while trying (the elapsed time moves); `onRun` gets the
 * queued action when the server is up. Both are called after the driver's own bookkeeping, so they
 * may call back into it (a queued Quick Play stops the lobby's connection to open the game's).
 */
export class WakeDriver<A> {
  private s: WakeState<A> = idleWake<A>();
  /** Bumped on every new attempt and on stop: answers from an older attempt are ignored. */
  private gen = 0;
  private pingAbort?: AbortController;
  private pingTimer?: Timer;
  private tickTimer?: ReturnType<typeof setInterval>;
  /** The connection: in flight, or live. Never more than one. */
  private link?: WakeLink;
  private linkLive = false;
  private connectStarted = -Infinity;
  /** Timings of this attempt (reset when a new one begins). */
  timings: WakeTimings = {};

  constructor(
    private deps: WakeDeps,
    private onChange: (s: WakeState<A>) => void,
    private onRun: (action: A) => void,
    private limits: WakeLimits = WAKE,
  ) {}

  get state() { return this.s; }
  /** Begin reaching the server (no-op while already trying or connected). */
  start() { this.dispatch({ type: 'start' }); }
  /** After giving up: try again. */
  retry() { this.dispatch({ type: 'retry' }); }
  /** A play action: runs now when connected, else once the server is up. */
  queue(action: A) { this.dispatch({ type: 'queue', action }); }
  cancel() { this.dispatch({ type: 'cancel' }); }
  /** Stop trying and close the connection. */
  stop() { this.dispatch({ type: 'stop' }); }

  /** The limits for the server in play: the given ones, or ALWAYS_ON when it never sleeps (and no limits were given for a test). */
  private limitsNow(): WakeLimits {
    return this.deps.sleeps && !this.deps.sleeps() ? { ...this.limits, sleeps: false, giveUpMs: ALWAYS_ON.giveUpMs } : this.limits;
  }
  private now() { return this.deps.now ? this.deps.now() : performance.now(); }
  private trying() { return this.s.phase === 'probing' || this.s.phase === 'waking'; }

  private dispatch(e: WakeEvent<A>) {
    const before = this.s;
    const { state, run } = step(before, e, this.now(), this.limitsNow());
    this.s = state;
    this.effects(before, state);
    if (state !== before || (e.type === 'tick' && this.trying())) this.onChange(state);
    if (run !== undefined) this.onRun(run);
  }

  /** Side effects of a transition: a new attempt starts pinging and connecting; leaving `trying` stops them. */
  private effects(before: WakeState<A>, after: WakeState<A>) {
    const fresh = after.phase === 'probing' && (before.phase !== 'probing' || after.since !== before.since);
    if (fresh) {
      this.halt(true);
      this.timings = {};
      const gen = this.gen;
      this.tickTimer = setInterval(() => this.dispatch({ type: 'tick' }), 1000);
      this.connect(gen, true);
      void this.ping(gen);
      return;
    }
    if (after.phase === before.phase) return;
    if (after.phase === 'ready') this.halt(false);
    else if (after.phase === 'unreachable' || after.phase === 'idle') this.halt(true);
  }

  /** Stop pinging and ticking; with `closeLink`, also drop the connection (live or not). */
  private halt(closeLink: boolean) {
    this.gen++;
    clearInterval(this.tickTimer); this.tickTimer = undefined;
    clearTimeout(this.pingTimer); this.pingTimer = undefined;
    this.pingAbort?.abort(); this.pingAbort = undefined;
    if (closeLink && this.link) {
      const link = this.link;
      this.link = undefined; this.linkLive = false;
      try { link.stop(); } catch { /* already closed */ }
    }
  }

  private async ping(gen: number) {
    if (gen !== this.gen || this.pingAbort) return;
    const abort = this.pingAbort = new AbortController();
    const pingStart = this.now();
    const timeout = setTimeout(() => abort.abort(), this.limits.pingTimeoutMs);
    let up = false;
    try { up = await this.deps.ping(abort.signal); } catch { up = false; } finally { clearTimeout(timeout); }
    if (this.pingAbort === abort) this.pingAbort = undefined;
    if (gen !== this.gen || !this.trying()) return;
    if (this.timings.pingMs === undefined) { this.timings.pingMs = Math.round(this.now() - pingStart); this.timings.pingOk = up; }
    this.dispatch(up ? { type: 'hostUp' } : { type: 'cold', from: 'ping' });
    if (gen !== this.gen || !this.trying()) return;
    this.connect(gen, up);
    this.pingTimer = setTimeout(() => void this.ping(gen), retryDelay(this.s.failures));
  }

  /** Open the connection unless one is in flight: at once when the host answered (or `force`), else at most every `connectEveryMs`. */
  private connect(gen: number, hostAnswered: boolean) {
    if (this.link || gen !== this.gen || !this.trying()) return;
    const now = this.now();
    if (!hostAnswered && now - this.connectStarted < this.limits.connectEveryMs) return;
    this.connectStarted = now;
    const link: WakeLink = this.deps.connect(() => this.lost(link));
    this.link = link; this.linkLive = false;
    const timeout = setTimeout(() => this.failed(link), this.limits.connectTimeoutMs);
    link.live.then(() => {
      clearTimeout(timeout);
      if (this.link !== link) return;
      this.linkLive = true;
      this.timings.connectMs = Math.round(this.now() - this.connectStarted);
      const loaded = link.importMs?.();
      if (loaded !== undefined) this.timings.importMs = Math.round(loaded);
      this.dispatch({ type: 'up' });
    }, () => { clearTimeout(timeout); this.failed(link); });
  }

  private failed(link: WakeLink) {
    if (this.link !== link || this.linkLive) return;
    this.link = undefined;
    try { link.stop(); } catch { /* already closed */ }
    this.dispatch({ type: 'cold', from: 'connect' });
  }

  private lost(link: WakeLink) {
    // Before it was live, a drop is a failed connect (`live` rejects).
    if (this.link !== link || !this.linkLive) return;
    this.link = undefined; this.linkLive = false;
    this.dispatch({ type: 'down' });
  }
}
