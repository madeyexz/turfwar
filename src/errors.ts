import { track, type ClientErrorKind } from './analytics';

/** At most this many failures are reported from one page load (a broken frame loop would repeat forever). */
export const MAX_CLIENT_ERRORS = 5;

/**
 * A reporter that passes each failure on once (same kind and message: once) and stops after `max`,
 * trimming the message and its source. Returns whether it reported.
 */
export function errorReporter(send: (kind: ClientErrorKind, message: string, source?: string) => void, max = MAX_CLIENT_ERRORS) {
  const seen = new Set<string>();
  return (kind: ClientErrorKind, message: string, source?: string) => {
    const text = (message || 'unknown').slice(0, 200);
    const key = `${kind}|${text}`;
    if (seen.size >= max || seen.has(key)) return false;
    seen.add(key);
    send(kind, text, source?.slice(0, 120));
    return true;
  };
}

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

/**
 * The page's own failures go to PostHog as `client_error`, so a crash a player reports leaves a trace:
 * uncaught errors, promises nobody caught, and the browser taking the graphics (WebGL) context away
 * (a black screen), which calls `onGraphicsLost`; browsers usually hand the context back (a phone app
 * returning from the background), which calls `onGraphicsRestored` and the game carries on.
 */
export function watchClientErrors(canvas: HTMLCanvasElement, inMatch: () => boolean, onGraphicsLost: () => void, onGraphicsRestored: () => void = () => undefined) {
  const report = errorReporter((kind, message, source) => track('client_error', { kind, message, ...(source ? { source } : {}), in_match: inMatch() }));
  // Opaque errors get a budget of their own (one a page) so they cannot use up the 5 that real failures share.
  let opaqueSent = false;
  const reportOpaque = () => {
    if (opaqueSent) return;
    opaqueSent = true;
    track('client_error', { kind: 'error', message: 'Script error.', source: 'opaque', in_match: inMatch(), ...opaqueContext() });
  };
  // Script errors only: a failed image or font load is an `error` event on its element, which does not reach here.
  addEventListener('error', e => {
    const ev = e as ErrorEvent;
    if (!ev.message) return;
    // A cross-origin or injected script (no file, no line): the browser hides everything. All our code is
    // same-origin, so this is an extension, a content blocker or the host app; send the page's state instead.
    if (isOpaque(ev)) { reportOpaque(); return; }
    report('error', ev.message, errorSource(ev.filename, ev.lineno, ev.colno));
  });
  addEventListener('unhandledrejection', e => {
    const reason = (e as PromiseRejectionEvent).reason as { message?: string } | undefined;
    report('rejection', String(reason?.message ?? reason ?? 'unknown'));
  });
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    report('webgl_lost', 'WebGL context lost');
    onGraphicsLost();
  });
  canvas.addEventListener('webglcontextrestored', () => { track('client_error', { kind: 'webgl_restored', message: 'WebGL context restored', in_match: inMatch() }); onGraphicsRestored(); });
}
