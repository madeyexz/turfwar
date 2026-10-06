import { describe, expect, it } from 'vitest';
import { cacheNames, routeOf, staleCaches } from './policy';

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

  it('versions caches by build and by asset contents, and cleans up only its own old ones', () => {
    const now = cacheNames('abc1234-0f0f', '9e9e');
    expect(now).toEqual({ shell: 'turfwar-shell-abc1234-0f0f', static: 'turfwar-static-9e9e' });
    const names = ['turfwar-shell-old', now.shell, now.static, 'turfwar-static-old', 'someone-elses-cache'];
    expect(staleCaches(names, [now.shell, now.static])).toEqual(['turfwar-shell-old', 'turfwar-static-old']);
  });
});
