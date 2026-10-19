import { describe, expect, it } from 'vitest';
import { cacheNames, immutableShellFile, routeOf, staleAssets, staleCaches } from './policy';

const ORIGIN = 'https://turfwar.ianhsiao.me';
const SHELL = new Set(['/index.html', '/assets/main-abc123.js', '/assets/main-def456.css', '/manifest.webmanifest', '/icons/icon-192.png']);
const get = (path: string, mode = 'no-cors', method = 'GET') => routeOf({ url: path.startsWith('http') ? path : ORIGIN + path, method, mode }, ORIGIN, SHELL);

describe('service worker routes', () => {
  it('fetches the page network first, whatever lobby flags it carries', () => {
    expect(get('/', 'navigate')).toBe('page');
    expect(get('/?mode=lab&autostart=1', 'navigate')).toBe('page');
    expect(get('/index.html', 'navigate')).toBe('page');
    expect(get('/index.html')).toBe('page');
  });

  it('serves this build’s files and the static assets from the cache', () => {
    expect(get('/assets/main-abc123.js')).toBe('shell');
    expect(get('/manifest.webmanifest')).toBe('shell');
    expect(get('/assets/soldier.glb')).toBe('static');
    expect(get('/assets/tex/brick_nor.webp')).toBe('static');
    expect(get('/assets/sfx/m4a1.mp3')).toBe('static');
    expect(get('/fonts/noto-sans-tc.woff2')).toBe('static');
    // The map picker's screenshots sit beside the trailers in /media but are cached like any asset.
    expect(get('/media/maps/taipei.webp')).toBe('static');
    expect(get('/media/maps/taipei101.webp', 'cors')).toBe('static');
  });

  it('caches the asset CDN’s files, the precached fonts in the shell, and nothing of other origins', () => {
    const CDN = 'https://cdn.turfwar.ianhsiao.me';
    const shell = new Set([...SHELL, `${CDN}/433a7007e474/fonts/rajdhani-600.woff2`]);
    const route = (url: string, mode = 'cors', cdn = CDN) => routeOf({ url, method: 'GET', mode }, ORIGIN, shell, cdn);
    expect(route(`${CDN}/6712b3b764a3/assets/props.glb`)).toBe('static');
    expect(route(`${CDN}/0c1d2e3f4a5b/media/maps/taipei.webp`, 'no-cors')).toBe('static');
    expect(route(`${CDN}/433a7007e474/fonts/rajdhani-600.woff2`)).toBe('shell');
    expect(route(`${CDN}/6712b3b764a3/assets/props.glb`, 'navigate')).toBe('bypass');
    expect(route(`${CDN}/6712b3b764a3/assets/props.glb`, 'cors', '')).toBe('bypass');
    expect(route('https://us-assets.i.posthog.com/static/array.js')).toBe('bypass');
    expect(route(`${ORIGIN}/assets/main-abc123.js`)).toBe('shell');
  });

  it('never touches SpacetimeDB, the ping, PostHog, analytics, /admin or the dev pages', () => {
    expect(get('wss://maincloud.spacetimedb.com/v1/database/3d-game-c4lhd/subscribe')).toBe('bypass');
    expect(get('https://maincloud.spacetimedb.com/v1/ping')).toBe('bypass');
    expect(get('https://us.i.posthog.com/e/?ip=1')).toBe('bypass');
    expect(get('https://us-assets.i.posthog.com/static/array.js')).toBe('bypass');
    expect(get('/stdb/v1/ping')).toBe('bypass');
    expect(get('/stdb/v1/database/lawbreaker/subscribe')).toBe('bypass');
    expect(get('/_vercel/insights/view', 'cors', 'POST')).toBe('bypass');
    expect(get('/_vercel/insights/script.js')).toBe('bypass');
    expect(get('/admin', 'navigate')).toBe('bypass');
    expect(get('/admin/')).toBe('bypass');
    expect(get('/media/turfwar-trailer-30s.mp4')).toBe('bypass');
    expect(get('/media/turfwar-trailer-30s.zh-TW.mp4')).toBe('bypass');
    expect(get('/media/maps/clip.mp4')).toBe('bypass');
    expect(get('/admin/index.html')).toBe('bypass');
    expect(get('/dev/level.html', 'navigate')).toBe('bypass');
    expect(get('/sw.js')).toBe('bypass');
  });

  it('leaves non-GET requests and unknown paths alone', () => {
    expect(get('/assets/main-abc123.js', 'no-cors', 'POST')).toBe('bypass');
    expect(get('/robots.txt')).toBe('bypass');
    expect(get('/privacy', 'navigate')).toBe('bypass');
    expect(routeOf({ url: 'not a url', method: 'GET' }, ORIGIN, SHELL)).toBe('bypass');
  });

  it('versions the shell by build, keeps one asset cache, and cleans up only its own old ones', () => {
    const now = cacheNames('abc1234-0f0f');
    expect(now).toEqual({ shell: 'turfwar-shell-abc1234-0f0f', static: 'turfwar-static-files' });
    const names = ['turfwar-shell-old', now.shell, now.static, 'turfwar-static-9e9e', 'someone-elses-cache'];
    expect(staleCaches(names, [now.shell, now.static])).toEqual(['turfwar-shell-old', 'turfwar-static-9e9e']);
  });

  it('drops a stored asset only when its file changed (or it was stored without a version)', () => {
    const current = new Set(['/assets/props.glb?v=new111', '/assets/tex/brick_diff.webp?v=same22']);
    const stored = [`${ORIGIN}/assets/props.glb?v=old000`, `${ORIGIN}/assets/tex/brick_diff.webp?v=same22`, `${ORIGIN}/assets/soldier.glb`];
    expect(staleAssets(stored, current)).toEqual([`${ORIGIN}/assets/props.glb?v=old000`, `${ORIGIN}/assets/soldier.glb`]);
  });

  it('keeps the asset CDN’s current files and drops the site’s copies of files that moved there', () => {
    const CDN = 'https://cdn.turfwar.ianhsiao.me';
    const current = new Set([`${CDN}/new111/assets/props.glb`, '/assets/tex/brick_diff.webp?v=same22']);
    const stored = [`${CDN}/new111/assets/props.glb`, `${CDN}/old000/assets/props.glb`, `${ORIGIN}/assets/props.glb?v=new111`, `${ORIGIN}/assets/tex/brick_diff.webp?v=same22`];
    expect(staleAssets(stored, current)).toEqual([`${CDN}/old000/assets/props.glb`, `${ORIGIN}/assets/props.glb?v=new111`]);
  });
});

describe('service worker install', () => {
  it('takes hashed and versioned files from the HTTP cache and asks afresh for the rest', () => {
    expect(immutableShellFile('/assets/main-C6AxeiP3.js')).toBe(true);
    expect(immutableShellFile('/assets/servers-DPjwh_-v.js')).toBe(true);
    expect(immutableShellFile('/assets/module.slim.no-external-yhhi0i1e.js')).toBe(true);
    expect(immutableShellFile('/assets/main-BrmoMTkT.css')).toBe(true);
    expect(immutableShellFile('/fonts/rajdhani-600.woff2?v=433a7007e474')).toBe(true);
    expect(immutableShellFile('/index.html')).toBe(false);
    expect(immutableShellFile('/privacy/index.html')).toBe(false);
    expect(immutableShellFile('/manifest.webmanifest')).toBe(false);
    expect(immutableShellFile('/icons/icon-192.png')).toBe(false);
    expect(immutableShellFile('/sw.js')).toBe(false);
    expect(immutableShellFile('https://cdn.turfwar.ianhsiao.me/433a7007e474/fonts/rajdhani-600.woff2', 'https://cdn.turfwar.ianhsiao.me')).toBe(true);
    expect(immutableShellFile('https://cdn.turfwar.ianhsiao.me/433a7007e474/fonts/rajdhani-600.woff2')).toBe(false);
  });
});
