/**
 * What the service worker does with a request (pure, so it is tested without a worker):
 *
 * - `page`: the game's page (`/`, `/index.html`, any lobby URL with flags): network first, so a new
 *   release shows up on the next load; the cached copy only when offline.
 * - `shell`: a file of this build (hashed scripts and styles, the manifest, icons): cache first.
 * - `static`: the game's assets (models, textures, sounds, fonts, the map pictures), asked for with their content
 *   version (`?v=`, src/assetUrl.ts): cache first, filled as they are used, each kept until that file changes.
 * - `bypass`: everything else goes straight to the network and is never stored: other origins
 *   (SpacetimeDB's websocket and ping, PostHog), `/admin`, the dev server's `/stdb` proxy, Vercel's
 *   own routes, the trailer videos in `/media`, and non-GET requests.
 */
export type Route = 'page' | 'shell' | 'static' | 'bypass';

const NEVER = /^\/(admin|stdb|_vercel|api|ingest|dev)(\/|$)/;
/** The trailers in /media: large, fetched in ranges by the video player, never stored. */
const VIDEO = /^\/media\/.+\.(mp4|webm|mov)$/i;
/** The map picker's screenshots live in /media/maps and are cached like the other assets. */
const STATIC = /^\/(assets|fonts|icons|media\/maps)\//;

export function routeOf(req: { url: string; method: string; mode?: string }, origin: string, shell: ReadonlySet<string>): Route {
  if (req.method !== 'GET') return 'bypass';
  let url: URL;
  try { url = new URL(req.url); } catch { return 'bypass'; }
  if (url.origin !== origin || (url.protocol !== 'https:' && url.protocol !== 'http:')) return 'bypass';
  const path = url.pathname;
  if (NEVER.test(path) || VIDEO.test(path) || path === '/sw.js') return 'bypass';
  if (req.mode === 'navigate') return path === '/' || path === '/index.html' ? 'page' : 'bypass';
  if (shell.has(path)) return path === '/index.html' ? 'page' : 'shell';
  return STATIC.test(path) ? 'static' : 'bypass';
}

/** Cache names: the shell is versioned with the build; the static assets share one cache, versioned file by file. */
export const cacheNames = (shellVersion: string) => ({ shell: `turfwar-shell-${shellVersion}`, static: 'turfwar-static-files' });

/**
 * The stored static assets this build no longer asks for (`urls` are full URLs; `current` is the build's
 * `/path?v=version` list): an old version of a changed file, or one stored without a version.
 */
export function staleAssets(urls: readonly string[], current: ReadonlySet<string>) {
  return urls.filter(u => { try { const url = new URL(u); return !current.has(url.pathname + url.search); } catch { return true; } });
}

/** Caches this worker owns that belong to another version (deleted when it activates). */
export const staleCaches = (names: readonly string[], keep: readonly string[]) => names.filter(n => n.startsWith('turfwar-') && !keep.includes(n));
