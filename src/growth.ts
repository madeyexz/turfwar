/**
 * The client side of the owner's growth metrics (shared/metrics.ts): frame rate and load times,
 * shares and invites, and a player's first kill. What reaches the server goes through
 * src/net/online.ts (`perf_stats` with the connection report, `visit` after `hello`); the same
 * numbers go to PostHog on `match_joined` (`wait_ms`), `match_left` (`fps`, `fps_low`), `lobby_ready`
 * (`boot_ms`) and `first_kill`.
 */
import { FrameHistogram, type FrameStats, type PerfReport, type VisitReport } from '../shared/metrics';
import { track } from './analytics';
import { inAppBrowserName, readEnv } from './game/device';
import { shareRef } from './game/challenge';
import { currentFirstTouch } from './visit';

const local = (() => { try { return localStorage; } catch { return undefined; } })();
const get = (k: string) => { try { return local?.getItem(k) ?? null; } catch { return null; } };
const set = (k: string, v: string) => { try { local?.setItem(k, v); } catch { /* storage disabled */ } };

// ---- Frame rate and load times ---------------------------------------------------------------

/** The match's frames (for `match_left`) and the frames since the last server report. */
const matchFrames = new FrameHistogram(), reportFrames = new FrameHistogram();
/** When Play was pressed (ms on the page clock), until the match is on screen. */
let playAt: number | undefined;
/** Load times not yet sent to the server (0 = none). */
let pendingWait = 0, pendingBoot = 0;

/** A rendered match frame took `ms` (the interval since the previous one); gaps over a second are ignored. */
export function frameTook(ms: number) {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  matchFrames.add(ms); reportFrames.add(ms);
}

/** The lobby is ready (assets loaded): the page's load time, sent once to PostHog and with the next server report. */
export function lobbyReady() {
  const ms = Math.round(performance.now());
  pendingBoot = ms;
  track('lobby_ready', { boot_ms: ms });
}

/** Play was pressed (a queued press keeps its first time). */
export function playPressed() { playAt ??= performance.now(); }

/** The match is on screen: its frames start over; returns the wait since Play (ms), if Play was pressed. */
export function matchStarted(): number | undefined {
  matchFrames.reset(); reportFrames.reset();
  if (playAt === undefined) return undefined;
  const wait = Math.round(performance.now() - playAt);
  playAt = undefined;
  pendingWait = wait;
  return wait;
}

/** Joining failed: the next press starts its own wait. */
export function playFailed() { playAt = undefined; }

/** The match's frame rate so far (for `match_left`). */
export const matchFrameStats = (): FrameStats => matchFrames.stats();

/** The `perf_stats` report since the previous one (frames, and load times not yet sent); undefined when there is nothing. */
export function takePerfReport(): PerfReport | undefined {
  const s = reportFrames.stats();
  if (s.seconds < 1 && !pendingWait && !pendingBoot) return undefined;
  const report: PerfReport = { fps: s.seconds >= 1 ? s.fps : 0, low: s.seconds >= 1 ? s.low : 0, seconds: s.seconds, waitMs: pendingWait, bootMs: pendingBoot };
  reportFrames.reset(); pendingWait = 0; pendingBoot = 0;
  return report;
}

// ---- Shares, invites and the first kill -------------------------------------------------------

const SHARES = 'turfwar.shares', DUELS = 'turfwar.duels', REF_BY = 'turfwar.refBy', FIRST_KILL = 'turfwar.firstKill';
const count = (k: string) => { const n = Number(get(k)); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };

/** A share card went out (any method). */
export function noteShare() { set(SHARES, String(count(SHARES) + 1)); }
/** 約朋友單挑 was pressed. */
export function noteDuel() { set(DUELS, String(count(DUELS) + 1)); }
/** This browser arrived through someone's share code: kept once. */
export function noteArrival(ref: string | undefined) { if (ref && !get(REF_BY)) set(REF_BY, ref); }

/** The `visit` reducer's report: first touch, in-app browser, the code we arrived through, our own and our running counts. */
export function visitReport(): VisitReport {
  return {
    ...currentFirstTouch(), inApp: inAppBrowserName(readEnv()) ?? '', refBy: get(REF_BY) ?? '', ref: shareRef(local),
    shares: count(SHARES), duels: count(DUELS),
  };
}

/** Our soldier made a kill: the first ever in this browser goes to PostHog once (activation). */
let killed = false;
export function noteKill(online: boolean) {
  if (killed || get(FIRST_KILL)) return;
  killed = true;
  set(FIRST_KILL, new Date().toISOString().slice(0, 10));
  track('first_kill', { online }, { setOnce: { first_kill_at: new Date().toISOString() } });
}
