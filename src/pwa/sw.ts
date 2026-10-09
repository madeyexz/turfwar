/**
 * The service worker (built to `/sw.js` by the `pwa` plugin in vite.config.ts, which fills in the
 * build's file list and versions). It makes the second load fast and the game installable:
 * the page network first, this build's files precached, the big assets cached as they load (by
 * their content version, `?v=`); SpacetimeDB, PostHog and `/admin` are never touched (`policy.ts`).
 * A new build replaces the shell's cache and drops only the assets whose files changed.
 */
import { cacheNames, routeOf, staleAssets, staleCaches } from './policy';

// Filled in by the build (see vite.config.ts): JSON of { shell: string[], shellVersion, assets: string[] } (assets as `/path?v=version`).
const BUILD = JSON.parse('__TURFWAR_BUILD__') as { shell: string[]; shellVersion: string; assets: string[] };

interface ExtendableEvent extends Event { waitUntil(p: Promise<unknown>): void }
interface FetchEvent extends ExtendableEvent { request: Request; respondWith(r: Promise<Response> | Response): void }
interface Worker {
  location: Location;
  addEventListener(type: 'install' | 'activate' | 'message', f: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', f: (e: FetchEvent) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
}
const sw = self as unknown as Worker;
const CACHES = cacheNames(BUILD.shellVersion);
const SHELL = new Set(BUILD.shell.map(p => p.split('?')[0]));
const ASSETS = new Set(BUILD.assets);

sw.addEventListener('install', e => {
  // Precache this build's shell; a file that fails to load just loads later.
  e.waitUntil(caches.open(CACHES.shell).then(c => Promise.all(BUILD.shell.map(p => c.add(new Request(p, { cache: 'reload' })).catch(() => undefined))))
    .then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', e => {
  // The assets stay; only the old versions of files this build changed go.
  const assets = caches.open(CACHES.static).then(async c => {
    const keys = await c.keys(), stale = new Set(staleAssets(keys.map(r => r.url), ASSETS));
    await Promise.all(keys.filter(r => stale.has(r.url)).map(r => c.delete(r)));
  });
  e.waitUntil(Promise.all([caches.keys().then(names => Promise.all(staleCaches(names, [CACHES.shell, CACHES.static]).map(n => caches.delete(n)))), assets])
    .then(() => sw.clients.claim()));
});

const storable = (r: Response) => r.ok && r.status === 200 && r.type === 'basic';

/** The page: the network's copy (stored for offline), else the stored one. */
async function page(req: Request) {
  const cache = await caches.open(CACHES.shell);
  try {
    const res = await fetch(req);
    if (storable(res)) void cache.put('/index.html', res.clone());
    return res;
  } catch (error) {
    const hit = await cache.match('/index.html');
    if (hit) return hit;
    throw error;
  }
}

/** Stored copy first; otherwise fetch and store it. */
async function cacheFirst(req: Request, name: string) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (storable(res)) void cache.put(req, res.clone());
  return res;
}

/**
 * The first visit loads the game before this worker controls the page: the page sends the files it
 * loaded (`warm`) so they are stored now, and the next load comes entirely from the cache.
 */
sw.addEventListener('message', e => {
  const data = (e as unknown as MessageEvent).data as { type?: string; urls?: unknown } | undefined;
  if (data?.type !== 'warm' || !Array.isArray(data.urls)) return;
  e.waitUntil(Promise.all(data.urls.filter((u): u is string => typeof u === 'string').slice(0, 400).map(async url => {
    const req = new Request(url);
    const route = routeOf(req, sw.location.origin, SHELL);
    if (route !== 'shell' && route !== 'static') return;
    const cache = await caches.open(route === 'shell' ? CACHES.shell : CACHES.static);
    if (await cache.match(req)) return;
    const res = await fetch(req).catch(() => undefined);
    if (res && storable(res)) await cache.put(req, res);
  })));
});

sw.addEventListener('fetch', e => {
  const route = routeOf(e.request, sw.location.origin, SHELL);
  if (route === 'bypass') return;
  e.respondWith(route === 'page' ? page(e.request) : cacheFirst(e.request, route === 'shell' ? CACHES.shell : CACHES.static));
});
