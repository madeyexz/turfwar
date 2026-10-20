import { captureException, track, type ClientErrorKind, type Events } from './analytics';
import { asFailure, chunkIdsByFile, exceptionList, scrub, type Failure } from './exceptions';

/** At most this many failures are reported from one page load (a broken frame loop would repeat forever). */
export const MAX_CLIENT_ERRORS = 5;

/**
 * A reporter that passes each message on once and stops after `max`,
 * trimming and cleaning the message and its source. `failure` (the error and its stack, when there is one)
 * goes along. Returns whether it reported.
 */
export function errorReporter(send: (kind: ClientErrorKind, message: string, source?: string, failure?: Failure, extra?: Extra) => void, max = MAX_CLIENT_ERRORS) {
  const seen = new Set<string>();
  return (kind: ClientErrorKind, message: string, source?: string, failure?: Failure, extra?: Extra) => {
    const text = scrub(message || 'unknown').slice(0, 200);
    const key = text;
    if (seen.size >= max || seen.has(key)) return false;
    seen.add(key);
    send(kind, text, source?.slice(0, 120), failure, extra);
    return true;
  };
}
/** More properties for one `client_error` (numbers, flags and fixed names only: never what a player typed). */
type Extra = Partial<Omit<Events['client_error'], 'kind' | 'message' | 'source' | 'in_match'>>;

/** `file.js:12:34` from an error event's location (the file name only: no host or query). */
export function errorSource(filename: string | undefined, line?: number, column?: number) {
  if (!filename) return undefined;
  const file = filename.split(/[?#]/)[0].split('/').pop() || filename;
  return `${file}:${line ?? 0}:${column ?? 0}`;
}

/** An error event with no file and no line: the browser withheld the details ("Script error."). */
export const isOpaque = (ev: Pick<ErrorEvent, 'message' | 'filename' | 'lineno'>) => ev.message === 'Script error.' && !ev.filename && !ev.lineno;

/** What little can tell an opaque error apart: how long the page had run, whether it was installed, whether it was visible. */
function opaqueContext() {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
  return { uptime_s: Math.round(performance.now() / 1000), standalone, visible: document.visibilityState === 'visible' };
}

/** The page's origin, to tell our own scripts from injected ones in a stack. */
const appOrigin = () => (typeof location === 'undefined' ? '' : location.origin);
/** `window._posthogChunkIds` (written into every script by the build's source map upload), read afresh: scripts load lazily. */
const chunks = () => chunkIdsByFile((globalThis as { _posthogChunkIds?: Record<string, string> })._posthogChunkIds, appOrigin());

/** How an uncaught failure was caught, as PostHog names the mechanisms. */
const MECHANISM: Partial<Record<ClientErrorKind, string>> = { error: 'onerror', rejection: 'onunhandledrejection', boot: 'boot' };

/**
 * Both reports of one failure, from one budget: `client_error` (message, `file:line:col`, `in_match`; the
 * events older queries read) and, for failures that are code throwing, `$exception` with the stack, so
 * PostHog's error tracking groups them into issues and shows the original source lines.
 */
export function failureReporter(inMatch: () => boolean) {
  return errorReporter((kind, message, source, failure, extra) => {
    track('client_error', { ...extra, kind, message, ...(source ? { source } : {}), in_match: inMatch() });
    const mechanism = MECHANISM[kind];
    if (mechanism && failure) captureException(exceptionList({ ...failure, message }, mechanism, chunks(), appOrigin()), { kind, in_match: inMatch() });
  });
}

/**
 * The page's own failures go to PostHog (`client_error` and `$exception`), so a crash a player reports
 * leaves a trace: uncaught errors, promises nobody caught, and the browser taking the graphics (WebGL)
 * context away (a black screen), which calls `onGraphicsLost`; browsers usually hand the context back (a
 * phone app returning from the background), which calls `onGraphicsRestored` and the game carries on.
 */
let inMatch = () => false;
const report = failureReporter(() => inMatch());
let watching = false;

export function reportBootFailure(error: unknown, extra?: Extra) {
  const failure = asFailure(error);
  report('boot', failure.message, undefined, failure, extra);
}

export function watchEarlyErrors() {
  if (watching) return;
  watching = true;
  // Opaque errors get a budget of their own (one a page) so they cannot use up the 5 that real failures share.
  let opaqueSent = false;
  const reportOpaque = () => {
    if (opaqueSent) return;
    opaqueSent = true;
    const context = opaqueContext();
    track('client_error', { kind: 'error', message: 'Script error.', source: 'opaque', in_match: inMatch(), ...context });
    captureException([{ type: 'Error', value: 'Script error.', mechanism: { handled: false, synthetic: false, type: 'onerror' } }],
      { kind: 'error', in_match: inMatch(), opaque: true, $exception_level: 'warning', ...context });
  };
  // Script errors only: a failed image or font load is an `error` event on its element, which does not reach here.
  const onError = (e: Event) => {
    const ev = e as ErrorEvent;
    if (!ev.message) return;
    // A cross-origin or injected script (no file, no line): the browser hides everything. All our code is
    // same-origin, so this is an extension, a content blocker or the host app; send the page's state instead.
    if (isOpaque(ev)) { reportOpaque(); return; }
    const failure = asFailure(ev.error ?? { message: ev.message });
    // Some browsers give no stack (or no error object): the event's own location is the one frame.
    if (!failure.stack && ev.filename) failure.stack = `    at ${ev.filename}:${ev.lineno}:${ev.colno}`;
    report('error', failure.message, errorSource(ev.filename, ev.lineno, ev.colno), failure);
  };
  const onRejection = (e: Event) => {
    const reason = (e as PromiseRejectionEvent).reason as unknown;
    const failure = asFailure(reason, 'UnhandledRejection');
    report('rejection', failure.message, undefined, failure);
  };
  addEventListener('error', onError);
  addEventListener('unhandledrejection', onRejection);
  const early = (window as Window & { __earlyErrors?: { drain(): Event[] } }).__earlyErrors;
  for (const event of early?.drain() ?? []) {
    if (event.type === 'error') onError(event); else onRejection(event);
  }
  delete (window as Window & { __earlyErrors?: unknown }).__earlyErrors;
}

/** At most this many `webgl_restored` reports from one page (an older iPhone lost the context 9 times on one page). */
export const MAX_RESTORED_REPORTS = 10;

/**
 * When and how the page lost its graphics context, to tell the causes apart: a phone app sent to the
 * background loses it while hidden (`visible_s` near 0: it had only just come back), a phone short of
 * memory loses it in plain view (`visible_s` large), at load (`uptime_s` small) or mid-match.
 * `now` and `visible` are the page's clock and visibility (passed in for tests).
 */
export function graphicsLossClock(now: () => number, visible: () => boolean) {
  let shownAt = visible() ? 0 : undefined;
  let lostAt: number | undefined;
  let losses = 0;
  /** Seconds since the page last came into view (absent while hidden). */
  const shown = () => (!visible() ? { visible: false } : shownAt === undefined ? { visible: true } : { visible: true, visible_s: Math.round((now() - shownAt) / 100) / 10 });
  return {
    /** The page was hidden or shown (`visibilitychange`). */
    visibility() { shownAt = visible() ? now() : undefined; },
    /** The context was lost: the properties for `webgl_lost`. */
    lost() {
      lostAt = now(); losses++;
      return { uptime_s: Math.round(now() / 1000), ...shown() };
    },
    /** It came back: the properties for `webgl_restored` (`lost_ms`: how long it was gone). */
    restored() {
      const lost_ms = lostAt === undefined ? -1 : Math.round(now() - lostAt);
      lostAt = undefined;
      return { lost_ms, ...shown(), losses };
    },
  };
}

/**
 * `graphics`: what the game draws with at that moment (preset, resolution, map), added to both reports.
 * `webgl_restored` waits two frames to say how long the first one after the restore took (`frame_ms`: three.js
 * uploads every texture and compiles every shader again; the player sees the last picture until then).
 */
export function watchClientErrors(canvas: HTMLCanvasElement, isInMatch: () => boolean, onGraphicsLost: () => void, onGraphicsRestored: () => void = () => undefined, graphics: () => Extra = () => ({})) {
  inMatch = isInMatch;
  watchEarlyErrors();
  const clock = graphicsLossClock(() => performance.now(), () => document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', () => clock.visibility());
  let restoredReports = 0;
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
    report('webgl_lost', 'WebGL context lost', undefined, undefined, { ...clock.lost(), standalone, ...graphics() });
    onGraphicsLost();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    const props = clock.restored(), start = performance.now(), match = inMatch();
    onGraphicsRestored();
    if (++restoredReports > MAX_RESTORED_REPORTS) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      track('client_error', { kind: 'webgl_restored', message: 'WebGL context restored', in_match: match, ...props, frame_ms: Math.round(performance.now() - start), ...graphics() });
    }));
  });
}
