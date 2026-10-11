/**
 * Reaching the game server. Every game server we offer is always on (Taipei, Maincloud, a local dev
 * server), so a failed ping or connect only means "can't reach it" (a bad network, a restart): the
 * screen keeps saying "connecting", the driver retries gently, and after 30 s it says unreachable,
 * with Retry.
 *
 *   idle → probing → ready                 a reachable server (a slow one only says "connecting")
 *            │ 30 s without an answer
 *            ▼
 *          unreachable → probing           Retry (or pressing play) starts over
 *
 * A live connection that drops goes back to probing. `step` is the pure state machine; `ConnectDriver`
 * runs it with one `/v1/ping` in flight at a time (every 2–3 s while failing) and one connection in
 * flight at a time, opened at once, then after the host answers a ping (or every 15 s regardless).
 * Nothing retries on its own once unreachable. A play action pressed meanwhile is queued and runs
 * once, when the connection is up. (The file was `wake.ts` while the Singapore server slept when idle;
 * it was retired on 2026-10-11 and its sleeping-server handling is gone.)
 */
export type ConnectPhase = 'idle' | 'probing' | 'ready' | 'unreachable';

export interface ConnectState<A> {
  phase: ConnectPhase;
  /** When this attempt to reach the server began (ms on the driver's clock). */
  since: number;
  /** Failed pings and connects in this attempt (sets the retry backoff). */
  failures: number;
  /** This attempt has run `slowMs` without an answer. */
  slow: boolean;
  /** A play action pressed before the server was up: it runs once, on `ready`. */
  queued?: A;
}

export type ConnectEvent<A> =
  | { type: 'start' } // begin (no-op unless idle)
  | { type: 'retry' } // start over after giving up
  | { type: 'cold'; from: 'ping' | 'connect' } // a ping that was not a 200 (5xx, network error, timeout), or a failed connect
  | { type: 'up' } // the connection is live
  | { type: 'down' } // a live connection dropped
  | { type: 'tick' } // time passed
  | { type: 'queue'; action: A } // a play button: run now if ready, else when ready
  | { type: 'stop' }; // leave (a match starts, the admin page switches server)

export const CONNECT = {
  /** No answer this long on an attempt makes it `slow` (analytics only: the screen keeps saying "connecting"). */
  slowMs: 6000,
  /** Give up (unreachable) after this long. */
  giveUpMs: 30_000,
  /** One ping may take this long. */
  pingTimeoutMs: 4000,
  /** A connection that is not live by then is dropped (a new one follows the next good ping). */
  connectTimeoutMs: 20_000,
  /** While pings fail, still try a connection this often (in case pings are blocked). */
  connectEveryMs: 15_000,
};
export type ConnectLimits = typeof CONNECT;

export const idleConnect = <A>(): ConnectState<A> => ({ phase: 'idle', since: 0, failures: 0, slow: false });

/** The state machine: the next state for an event at `now`, and the queued action to run (at most once). */
export function step<A>(s: ConnectState<A>, e: ConnectEvent<A>, now: number, limits: ConnectLimits = CONNECT): { state: ConnectState<A>; run?: A } {
  const begin = (queued: A | undefined): ConnectState<A> => ({ phase: 'probing', since: now, failures: 0, slow: false, queued });
  const trying = s.phase === 'probing';
  switch (e.type) {
    case 'start': return { state: s.phase === 'idle' ? begin(undefined) : s };
    case 'retry': return { state: s.phase === 'unreachable' ? begin(s.queued) : s };
    case 'down': return { state: s.phase === 'ready' ? begin(s.queued) : s };
    case 'stop': return { state: s.phase === 'idle' ? s : idleConnect<A>() };
    case 'cold': {
      if (!trying) return { state: s };
      const failures = s.failures + 1;
      if (now - s.since >= limits.giveUpMs) return { state: { ...s, phase: 'unreachable', failures } };
      return { state: { ...s, failures } };
    }
    case 'up': {
      if (!trying) return { state: s };
      return { state: { ...s, phase: 'ready', queued: undefined }, run: s.queued };
    }
    case 'tick': {
      // (Timers pause while a laptop sleeps: one tick may jump past both limits.)
      if (trying && now - s.since >= limits.giveUpMs) return { state: { ...s, phase: 'unreachable' } };
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
  }
}

/** Whole seconds since this attempt began. */
export const connectSeconds = (s: ConnectState<unknown>, now: number) => Math.max(0, Math.floor((now - s.since) / 1000));

/** Gentle backoff between pings while failing: 2 s, then 2.5 s, then every 3 s. */
export const retryDelay = (failures: number) => Math.min(3000, 2000 + 500 * Math.max(0, failures - 1));

/** A connection the driver opens: `live` settles once (resolves when usable, rejects when it failed). */
export interface ConnectLink {
  live: Promise<void>;
  stop(): void;
  /** Milliseconds the connection spent loading its code (the lazy SDK chunk) before it could dial, once known. */
  importMs?(): number | undefined;
}

/** How the current attempt went, for `connect_slow`: the first ping, and the connection that came up. */
export interface ConnectTimings {
  /** The first ping's round trip (ms) and whether it answered 200. */
  pingMs?: number; pingOk?: boolean;
  /** The connection that went live: dial to live (ms), and the part of it spent loading its code. */
  connectMs?: number; importMs?: number;
}

export interface ConnectDeps {
  /** One `/v1/ping`: true when the host answered 200 (false or a rejection: not up). */
  ping(signal: AbortSignal): Promise<boolean>;
  /** Open the real connection; `lost` is called if it drops after being live. */
  connect(lost: () => void): ConnectLink;
  now?: () => number;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * Runs the state machine: pings, connects, the 1 s tick and the queued action. `onChange` fires on
 * every state change and every second while trying (the elapsed time moves); `onRun` gets the
 * queued action when the server is up. Both are called after the driver's own bookkeeping, so they
 * may call back into it (a queued Quick Play stops the lobby's connection to open the game's).
 */
export class ConnectDriver<A> {
  private s: ConnectState<A> = idleConnect<A>();
  /** Bumped on every new attempt and on stop: answers from an older attempt are ignored. */
  private gen = 0;
  private pingAbort?: AbortController;
  private pingTimer?: Timer;
  private tickTimer?: ReturnType<typeof setInterval>;
  /** The connection: in flight, or live. Never more than one. */
  private link?: ConnectLink;
  private linkLive = false;
  private connectStarted = -Infinity;
  /** Timings of this attempt (reset when a new one begins). */
  timings: ConnectTimings = {};

  constructor(
    private deps: ConnectDeps,
    private onChange: (s: ConnectState<A>) => void,
    private onRun: (action: A) => void,
    private limits: ConnectLimits = CONNECT,
  ) {}

  get state() { return this.s; }
  /** Begin reaching the server (no-op while already trying or connected). */
  start() { this.dispatch({ type: 'start' }); }
  /** After giving up: try again. */
  retry() { this.dispatch({ type: 'retry' }); }
  /** A play action: runs now when connected, else once the server is up. */
  queue(action: A) { this.dispatch({ type: 'queue', action }); }
  /** Stop trying and close the connection. */
  stop() { this.dispatch({ type: 'stop' }); }

  private now() { return this.deps.now ? this.deps.now() : performance.now(); }
  private trying() { return this.s.phase === 'probing'; }

  private dispatch(e: ConnectEvent<A>) {
    const before = this.s;
    const { state, run } = step(before, e, this.now(), this.limits);
    this.s = state;
    this.effects(before, state);
    if (state !== before || (e.type === 'tick' && this.trying())) this.onChange(state);
    if (run !== undefined) this.onRun(run);
  }

  /** Side effects of a transition: a new attempt starts pinging and connecting; leaving `trying` stops them. */
  private effects(before: ConnectState<A>, after: ConnectState<A>) {
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
    if (!up) this.dispatch({ type: 'cold', from: 'ping' });
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
    const link: ConnectLink = this.deps.connect(() => this.lost(link));
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

  private failed(link: ConnectLink) {
    if (this.link !== link || this.linkLive) return;
    this.link = undefined;
    try { link.stop(); } catch { /* already closed */ }
    this.dispatch({ type: 'cold', from: 'connect' });
  }

  private lost(link: ConnectLink) {
    // Before it was live, a drop is a failed connect (`live` rejects).
    if (this.link !== link || !this.linkLive) return;
    this.link = undefined; this.linkLive = false;
    this.dispatch({ type: 'down' });
  }
}
