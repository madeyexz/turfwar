/**
 * What the service worker does with a request (pure, so it is tested without a worker):
 *
 * - `page`: the game's page (`/`, `/index.html`, any lobby URL with flags): network first, so a new
 *   release shows up on the next load; the cached copy only when offline.
 * - `shell`: a file of this build (hashed scripts and styles, the manifest, icons): cache first.
 * - `static`: the game's unhashed assets (models, textures, sounds, fonts): cache first, filled as
 *   they are used, kept until those files change.
 * - `bypass`: everything else goes straight to the network and is never stored: other origins
 *   (SpacetimeDB's websocket and ping, PostHog), `/admin`, the dev server's `/stdb` proxy, Vercel's
 *   own routes, and non-GET requests.
 */
export type Route = 'page' | 'shell' | 'static' | 'bypass';

const NEVER = /^\/(admin|stdb|_vercel|api|ingest|dev|media)(\/|$)/;
const STATIC = /^\/(assets|fonts|icons)\//;

export function routeOf(req: { url: string; method: string; mode?: string }, origin: string, shell: ReadonlySet<string>): Route {
  if (req.method !== 'GET') return 'bypass';
  let url: URL;
  try { url = new URL(req.url); } catch { return 'bypass'; }
  if (url.origin !== origin || (url.protocol !== 'https:' && url.protocol !== 'http:')) return 'bypass';
  const path = url.pathname;
  if (NEVER.test(path) || path === '/sw.js') return 'bypass';
  if (req.mode === 'navigate') return path === '/' || path === '/index.html' ? 'page' : 'bypass';
  if (shell.has(path)) return path === '/index.html' ? 'page' : 'shell';
  return STATIC.test(path) ? 'static' : 'bypass';
}

/** Cache names: the shell is versioned with the build, the static assets with their own contents. */
export const cacheNames = (shellVersion: string, staticVersion: string) => ({ shell: `turfwar-shell-${shellVersion}`, static: `turfwar-static-${staticVersion}` });

/** Caches this worker owns that belong to another version (deleted when it activates). */
export const staleCaches = (names: readonly string[], keep: readonly string[]) => names.filter(n => n.startsWith('turfwar-') && !keep.includes(n));
