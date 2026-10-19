/**
 * What the service worker does with a request (pure, so it is tested without a worker):
 *
 * - `page`: the game's page (`/`, `/index.html`, any lobby URL with flags): network first, so a new
 *   release shows up on the next load; the cached copy only when offline.
 * - `shell`: a file of this build (hashed scripts and styles, the manifest, icons): cache first.
 * - `static`: the game's assets (models, textures, sounds, fonts, the map pictures), asked for with their content
 *   version (`?v=`, or from the asset CDN, `assetOrigin`, with the version in the path; src/assetUrl.ts):
 *   cache first, filled as they are used, each kept until that file changes.
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

export function routeOf(req: { url: string; method: string; mode?: string }, origin: string, shell: ReadonlySet<string>, assetOrigin = ''): Route {
  if (req.method !== 'GET') return 'bypass';
  let url: URL;
  try { url = new URL(req.url); } catch { return 'bypass'; }
  // The CDN holds only versioned assets; the shell lists the fonts it precaches by their full URL.
  if (assetOrigin && url.origin === assetOrigin) return req.mode === 'navigate' ? 'bypass' : shell.has(url.origin + url.pathname) ? 'shell' : 'static';
  if (url.origin !== origin || (url.protocol !== 'https:' && url.protocol !== 'http:')) return 'bypass';
  const path = url.pathname;
  if (NEVER.test(path) || VIDEO.test(path) || path === '/sw.js') return 'bypass';
  if (req.mode === 'navigate') return path === '/' || path === '/index.html' ? 'page' : 'bypass';
  if (shell.has(path)) return path === '/index.html' ? 'page' : 'shell';
  return STATIC.test(path) ? 'static' : 'bypass';
}

/**
 * Whether a precached shell file can come from the browser's HTTP cache: this build's hashed scripts
 * and styles and the versioned fonts never change under their URL, and the page has usually just
 * loaded them, so the worker's install does not download them a second time. The rest (the page,
 * the manifest, the icons) is asked for afresh (`cache: 'reload'`).
 */
export const immutableShellFile = (path: string, assetOrigin = '') => /^\/assets\/[^/?]+-[\w-]{8}\.(js|css)$/.test(path) || /\?v=\w+$/.test(path)
  || (!!assetOrigin && path.startsWith(`${assetOrigin}/`));

/** Cache names: the shell is versioned with the build; the static assets share one cache, versioned file by file. */
export const cacheNames = (shellVersion: string) => ({ shell: `turfwar-shell-${shellVersion}`, static: 'turfwar-static-files' });

/**
 * The stored static assets this build no longer asks for (`urls` are full URLs; `current` is the build's
 * list, `/path?v=version` or a full asset CDN URL): an old version of a changed file, one stored without
 * a version, or one from the site that this build takes from the CDN (or back).
 */
export function staleAssets(urls: readonly string[], current: ReadonlySet<string>) {
  return urls.filter(u => { try { const url = new URL(u); return !current.has(url.pathname + url.search) && !current.has(url.href); } catch { return true; } });
}

/** Caches this worker owns that belong to another version (deleted when it activates). */
export const staleCaches = (names: readonly string[], keep: readonly string[]) => names.filter(n => n.startsWith('turfwar-') && !keep.includes(n));
