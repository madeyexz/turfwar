import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The static SEO / GEO surface (docs/SEO.md): canonical URLs, hreflang, Open Graph, JSON-LD, the sitemap,
 * robots.txt and llms.txt. The owner tags shared links with utm_* parameters, so every URL we publish
 * must be the clean one, and structured data must not claim ratings or reviews we do not have.
 */
const ROOT = join(__dirname, '..');
const SITE = 'https://turfwar.ianhsiao.me';
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

/** The public routes: URL path → the HTML file Vite builds for it. */
const PAGES: Record<string, string> = { '/': 'index.html', '/about': 'about/index.html', '/en/about': 'en/about/index.html', '/privacy': 'privacy/index.html' };
const INDEXED = ['/', '/about', '/en/about', '/privacy'];

const attr = (html: string, tag: string, key: string, value: string, want: string) => {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${key}="${value}"[^>]*>`, 'i');
  const m = re.exec(html);
  return m ? new RegExp(`\\b${want}="([^"]*)"`).exec(m[0])?.[1] : undefined;
};
const meta = (html: string, key: 'name' | 'property', value: string) => attr(html, 'meta', key, value, 'content');
const canonical = (html: string) => attr(html, 'link', 'rel', 'canonical', 'href');
const alternates = (html: string) => [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map(m => [m[1], m[2]] as const);
const jsonLd = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(m => (JSON.parse(m[1]) as { '@graph': Record<string, unknown>[] })['@graph']);
const urlsIn = (value: unknown): string[] => typeof value === 'string' ? (/^https?:\/\//.test(value) ? [value] : [])
  : Array.isArray(value) ? value.flatMap(urlsIn)
  // JSON-LD node ids are names with a #fragment, not pages; they only need to stay on this site, without a query.
  : value && typeof value === 'object' ? Object.entries(value).filter(([k]) => k !== '@id').flatMap(([, v]) => urlsIn(v)) : [];
const idsIn = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(idsIn) : value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => k === '@id' ? [String(v)] : idsIn(v)) : [];
const keysIn = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(keysIn) : value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...keysIn(v)]) : [];
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const text = (html: string) => decode(html.replace(/<[^>]+>/g, ''));

/** A JPEG's pixel size, from its first SOF marker. */
function jpegSize(file: string) {
  const b = readFileSync(join(ROOT, 'public', file));
  for (let p = 2; p < b.length;) {
    if (b[p] !== 0xff) { p++; continue; }
    const marker = b[p + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: b.readUInt16BE(p + 5), width: b.readUInt16BE(p + 7) };
    p += 2 + b.readUInt16BE(p + 2);
  }
  throw new Error(`${file}: no SOF marker`);
}

/** A URL on this site as the file Vercel would serve for it, or undefined when nothing is there. */
function served(url: string) {
  const u = new URL(url);
  if (u.origin !== SITE) return undefined;
  if (PAGES[u.pathname]) return PAGES[u.pathname];
  return existsSync(join(ROOT, 'public', u.pathname)) ? `public${u.pathname}` : undefined;
}

describe('canonical URLs stay clean', () => {
  it('every page has an absolute canonical that is the page itself, without a query or fragment', () => {
    for (const [path, file] of Object.entries(PAGES)) {
      const href = canonical(read(file));
      expect(href, file).toBe(path === '/' ? `${SITE}/` : `${SITE}${path}`);
      expect(new URL(href!).search + new URL(href!).hash).toBe('');
    }
  });

  it('og:url, hreflang and JSON-LD urls never carry utm_*, other query strings or fragments', () => {
    for (const file of ['index.html', 'about/index.html', 'en/about/index.html']) {
      const html = read(file);
      const urls = [meta(html, 'property', 'og:url'), meta(html, 'property', 'og:image'), meta(html, 'name', 'twitter:image'), ...alternates(html).map(a => a[1]), ...urlsIn(jsonLd(html))];
      for (const url of urls) {
        expect(url, file).toBeTruthy();
        const u = new URL(url!);
        expect(u.search, `${file}: ${url}`).toBe('');
        expect(u.hash, `${file}: ${url}`).toBe('');
        expect(url).not.toMatch(/utm_/i);
      }
      for (const id of idsIn(jsonLd(html))) expect(id).toMatch(new RegExp(`^${SITE}/[a-z/]*#[a-z]+$`));
      expect(meta(html, 'property', 'og:url')).toBe(canonical(html));
    }
  });
});

describe('the game page', () => {
  const html = read('index.html');

  it('has the title, description, language and a 1200×630 preview in both Open Graph and Twitter tags', () => {
    expect(/<title>([^<]+)<\/title>/.exec(html)![1]).toMatch(/角頭械鬥.*Turf War: Taipei/);
    expect(meta(html, 'name', 'description')).toMatch(/角頭械鬥.*Turf War: Taipei.*免費.*免下載/);
    expect(html).toMatch(/<html lang="zh-TW">/);
    expect(meta(html, 'name', 'twitter:card')).toBe('summary_large_image');
    expect(meta(html, 'property', 'og:image')).toBe(meta(html, 'name', 'twitter:image'));
    expect(meta(html, 'property', 'og:image:width')).toBe('1200');
    expect(meta(html, 'property', 'og:image:height')).toBe('630');
    expect(meta(html, 'property', 'og:image:alt')).toBeTruthy();
    expect(meta(html, 'name', 'twitter:title')).toBeTruthy();
    expect(meta(html, 'name', 'twitter:description')).toBeTruthy();
  });

  it('describes a free multiplayer / single-player browser VideoGame under both names, and a WebSite', () => {
    const graph = jsonLd(html);
    const game = graph.find(n => n['@type'] === 'VideoGame')!;
    expect(game).toBeTruthy();
    expect(game.name).toBe('Turf War: Taipei');
    expect(game.alternateName).toContain('角頭械鬥');
    expect(game.url).toBe(`${SITE}/`);
    expect(game.gamePlatform).toBe('Web browser');
    expect(game.operatingSystem).toBe('Any');
    expect(game.applicationCategory).toBe('GameApplication');
    expect(game.playMode).toEqual(['https://schema.org/MultiPlayer', 'https://schema.org/SinglePlayer']);
    expect(game.inLanguage).toEqual(['zh-TW', 'en']);
    expect(game.offers).toMatchObject({ '@type': 'Offer', price: '0' });
    expect(game.isAccessibleForFree).toBe(true);
    const site = graph.find(n => n['@type'] === 'WebSite')!;
    expect(site.url).toBe(`${SITE}/`);
    expect(site.alternateName).toContain('角頭械鬥');
  });

  it('has crawlable text without scripts, linking to both about pages', () => {
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)![1];
    expect(noscript).toContain('角頭械鬥');
    expect(noscript).toContain('Turf War: Taipei');
    expect(noscript).toContain('href="/about"');
    expect(noscript).toContain('href="/en/about"');
  });

  it('has the lobby link to the about pages', () => {
    const main = read('src/main.ts');
    expect(main).toContain("isZh() ? '/about' : '/en/about'");
  });
});

describe('the about pages', () => {
  const zh = read('about/index.html'), en = read('en/about/index.html');

  it('point at each other with reciprocal hreflang and an x-default', () => {
    for (const html of [zh, en]) {
      expect(alternates(html)).toEqual([['zh-TW', `${SITE}/about`], ['en', `${SITE}/en/about`], ['x-default', `${SITE}/en/about`]]);
    }
    expect(zh).toMatch(/<html lang="zh-TW">/);
    expect(en).toMatch(/<html lang="en">/);
    expect(meta(zh, 'property', 'og:image')).toBe(`${SITE}/og/og-zh-TW.jpg`);
    expect(meta(en, 'property', 'og:image')).toBe(`${SITE}/og/og-en.jpg`);
  });

  it('carry a FAQPage whose questions and answers are the visible FAQ, word for word', () => {
    for (const html of [zh, en]) {
      const faq = jsonLd(html).find(n => n['@type'] === 'FAQPage') as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
      expect(faq.mainEntity.length).toBeGreaterThanOrEqual(8);
      const body = html.slice(Math.max(html.indexOf('<h2>FAQ</h2>'), html.indexOf('<h2>常見問題</h2>')));
      const visible = [...body.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map(m => ({ q: text(m[1]), a: text(m[2]) }));
      expect(visible.length).toBe(faq.mainEntity.length);
      faq.mainEntity.forEach((item, i) => {
        expect(visible[i].q).toBe(item.name);
        expect(visible[i].a).toBe(item.acceptedAnswer.text);
      });
    }
  });

  it('name both games the same way and have one h1', () => {
    for (const html of [zh, en]) {
      expect(html.match(/<h1>/g)).toHaveLength(1);
      expect(text(/<h1>([\s\S]*?)<\/h1>/.exec(html)![1])).toMatch(/角頭械鬥/);
      expect(text(/<h1>([\s\S]*?)<\/h1>/.exec(html)![1])).toMatch(/Turf War: Taipei/);
    }
  });
});

describe('structured data does not invent social proof', () => {
  it('has no ratings, reviews or awards anywhere', () => {
    for (const file of ['index.html', 'about/index.html', 'en/about/index.html']) {
      const keys = keysIn(jsonLd(read(file)));
      for (const bad of ['aggregateRating', 'review', 'reviewRating', 'ratingValue', 'ratingCount', 'reviewCount', 'award', 'interactionStatistic']) expect(keys, `${file}: ${bad}`).not.toContain(bad);
    }
  });
});

describe('sitemap.xml', () => {
  const xml = read('public/sitemap.xml');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

  it('lists the indexed pages, each clean, once, and each backed by a built page', () => {
    expect(locs.sort()).toEqual(INDEXED.map(p => p === '/' ? `${SITE}/` : `${SITE}${p}`).sort());
    for (const loc of locs) {
      const u = new URL(loc);
      expect(u.protocol + '//' + u.host).toBe(SITE);
      expect(u.search + u.hash, loc).toBe('');
      expect(served(loc), loc).toBeTruthy();
      expect(loc).not.toMatch(/utm_/i);
    }
    expect(new Set(locs).size).toBe(locs.length);
  });

  it('gives the about pages their language alternates, matching the pages', () => {
    for (const block of xml.split('<url>').slice(1).filter(b => /\/about<\/loc>/.test(b))) {
      const hrefs = [...block.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map(m => [m[1], m[2]]);
      expect(hrefs).toEqual([['zh-TW', `${SITE}/about`], ['en', `${SITE}/en/about`], ['x-default', `${SITE}/en/about`]]);
    }
  });
});

describe('robots.txt', () => {
  const robots = read('public/robots.txt');
  const groups = robots.split(/\n\s*\n/).map(g => g.split('\n').filter(l => l && !l.startsWith('#')));

  it('names the sitemap and keeps /admin out for every crawler, including each named one', () => {
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    const agents = new Map<string, string[]>();
    for (const g of groups) {
      const ua = g.filter(l => /^User-agent:/i.test(l)).map(l => l.split(':')[1].trim());
      for (const a of ua) agents.set(a, g.filter(l => /^(Allow|Disallow):/i.test(l)));
    }
    for (const bot of ['*', 'Googlebot', 'Bingbot', 'GPTBot', 'OAI-SearchBot', 'PerplexityBot', 'ClaudeBot', 'Google-Extended']) {
      expect(agents.get(bot), bot).toEqual(['Disallow: /admin']);
    }
  });
});

describe('llms.txt and llms-full.txt', () => {
  for (const file of ['public/llms.txt', 'public/llms-full.txt']) {
    it(`${file} names both games, keeps the trademark note, and links only to things that exist`, () => {
      const txt = read(file);
      expect(txt.startsWith('# 角頭械鬥 · Turf War: Taipei')).toBe(true);
      expect(txt).toContain('not licensed for reuse');
      expect(txt).not.toMatch(/utm_/i);
      for (const [, url] of txt.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
        if (url.startsWith(SITE)) expect(served(url), url).toBeTruthy();
      }
    });
  }
});

describe('social preview images', () => {
  it('are 1200×630 JPEGs under 300 KB', () => {
    for (const file of ['og/og-zh-TW.jpg', 'og/og-en.jpg']) {
      expect(jpegSize(file)).toEqual({ width: 1200, height: 630 });
      expect(readFileSync(join(ROOT, 'public', file)).length).toBeLessThan(300_000);
    }
  });
});

describe('vercel.json', () => {
  const config = JSON.parse(read('vercel.json')) as { rewrites: { source: string; destination: string }[]; headers: { source: string; headers: { key: string; value: string }[] }[]; redirects?: unknown[] };

  it('rewrites each extensionless page to its built file', () => {
    for (const path of ['/admin', '/privacy', '/about', '/en/about']) {
      expect(config.rewrites).toContainEqual({ source: path, destination: `${path}/index.html` });
    }
  });

  it('marks /admin noindex and caches the hashed bundles, but no unhashed public/assets file', () => {
    expect(config.headers.find(h => h.source === '/admin(.*)')!.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
    const hashed = config.headers.find(h => h.source.startsWith('/assets/:file('))!;
    expect(hashed.headers[0].value).toContain('immutable');
    const pattern = new RegExp(`^${hashed.source.slice('/assets/:file('.length, -1)}$`);
    for (const f of readdirSync(join(ROOT, 'public/assets'))) expect(pattern.test(f), `public/assets/${f}`).toBe(false);
    for (const built of ['main-Dx0IDQ_H.js', 'main-DDsJZt9Q.css', 'three-ChrOpA91.js']) expect(pattern.test(built), built).toBe(true);
  });
});
