/**
 * What a client failure looks like to PostHog's error tracking (the `$exception` event), built and cleaned
 * here, without PostHog: pure functions, so what leaves the browser is tested.
 *
 * - `scrub` takes the personal and the identifying out of any text we send: query strings and hashes of URLs
 *   (a room code, UTM tags, click ids can ride in them), `key=value` pairs of those names, and long hex
 *   strings (identity hashes, tokens).
 * - `parseStack` reads a browser's `error.stack` (V8 and Firefox/Safari formats) into frames.
 * - `chunkIdsByFile` reads `window._posthogChunkIds`, which the build's sourcemap upload writes into every
 *   script (the PostHog CLI's `sourcemap inject`): each entry maps the stack of that script's own first line
 *   to its chunk id, which is how PostHog finds the source map for a minified frame.
 */

/** One stack frame as PostHog's `$exception_list` wants it. */
export interface ExceptionFrame {
  filename?: string;
  /** Always present: PostHog rejects a frame without it, so anonymous frames get `?`. */
  function: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
  platform: 'web:javascript';
  /** The build's chunk id for that script (set when the source maps were uploaded for this build). */
  chunk_id?: string;
}

export interface ExceptionEntry {
  type: string;
  value: string;
  mechanism: { handled: boolean; synthetic: boolean; type: string };
  stacktrace?: { type: 'raw'; frames: ExceptionFrame[] };
}

const MAX_VALUE = 300;
const MAX_FRAMES = 50;
const PRIVATE_KEYS = /\b(room|ref|utm_[a-z]+|gclid|fbclid|twclid|msclkid|ttclid|igshid|token|callsign|password|authorization)\s*[=:]\s*(?:\[x\]|[^&\s"')\]]*)/gi;

/** Text with its URLs' query strings and hashes, private `key=value` pairs and long hex strings removed. */
export function scrub(text: string): string {
  return text
    .replace(/(\bhttps?:\/\/)[^/\s@]+@/gi, '$1')
    .replace(/(\bhttps?:\/\/[^\s"'<>)\]]+?)[?#][^\s"'<>)\]]*/gi, '$1')
    .replace(PRIVATE_KEYS, '$1=[x]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:phx_|phc_)[\w-]+/g, '[key]')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[id]');
}

/** A script's URL without query or hash. */
export const cleanUrl = (url: string) => scrub(url).split(/[?#]/)[0];

const V8 = /^\s*at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?\s*$/;
const GECKO = /^(.*?)@(.*?):(\d+):(\d+)\s*$/;
/** PostHog's (and posthog-js's) name for a frame without a function name. */
export const UNKNOWN_FUNCTION = '?';

function frameName(fn: string | undefined): string {
  const name = fn && fn !== 'new' ? scrub(fn.replace(/^async /, '').replace(/^new /, '')).trim().slice(0, 80) : '';
  return name || UNKNOWN_FUNCTION;
}

/** Frames of a browser's `error.stack` (newest first), without query strings or hashes in the files. */
export function parseStack(stack: string | undefined, appOrigin = ''): ExceptionFrame[] {
  const frames: ExceptionFrame[] = [];
  for (const line of (stack ?? '').split('\n')) {
    const m = V8.exec(line) ?? GECKO.exec(line);
    if (!m) continue;
    const [, fn, file, l, c] = m;
    if (!file || file === '<anonymous>' || file.startsWith('native') ) continue;
    const filename = cleanUrl(file);
    frames.push({
      function: frameName(fn),
      filename, lineno: Number(l), colno: Number(c),
      in_app: !appOrigin || filename.startsWith(appOrigin + '/') || filename.startsWith('/'),
      platform: 'web:javascript',
    });
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

/** `window._posthogChunkIds` (stack string → chunk id) as script file (query and hash removed) → chunk id. */
export function chunkIdsByFile(ids: Record<string, string> | undefined, appOrigin = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [stack, id] of Object.entries(ids ?? {})) {
    const first = parseStack(stack, appOrigin)[0];
    if (first?.filename) out.set(first.filename, id);
  }
  return out;
}

/** What went wrong, as the browser gave it: an `Error` (with its stack) or anything thrown, or a bare message. */
export interface Failure { name?: string; message: string; stack?: string }

/** The `$exception_list` of one failure: its type and message cleaned, its frames tagged with their chunk ids. */
export function exceptionList(f: Failure, mechanism: string, chunks: Map<string, string>, appOrigin = ''): ExceptionEntry[] {
  const frames = parseStack(f.stack, appOrigin).map(fr => {
    const id = fr.filename ? chunks.get(fr.filename) : undefined;
    return id ? { ...fr, chunk_id: id } : fr;
  });
  return [{
    type: scrub(f.name || 'Error').slice(0, 60),
    value: scrub(f.message || 'unknown').slice(0, MAX_VALUE),
    mechanism: { handled: false, synthetic: false, type: mechanism },
    // PostHog expects the throwing frame last, unlike printed browser stacks.
    ...(frames.length ? { stacktrace: { type: 'raw' as const, frames: frames.reverse() } } : {}),
  }];
}

/** Anything caught (an `Error`, a string, an object with a message) as a `Failure`. */
export function asFailure(value: unknown, fallbackName = 'Error'): Failure {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (value && typeof value === 'object') {
    const v = value as { name?: unknown; message?: unknown; stack?: unknown };
    if (typeof v.message === 'string') return { name: typeof v.name === 'string' ? v.name : fallbackName, message: v.message, stack: typeof v.stack === 'string' ? v.stack : undefined };
  }
  return { name: fallbackName, message: String(value ?? 'unknown') };
}
