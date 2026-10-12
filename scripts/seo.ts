/**
 * Search data for SEO work (docs/SEO.md, "Search data"): Google Search Console and Bing Webmaster Tools, read
 * through their APIs, plus IndexNow pings. Free APIs; credentials are Amp project secrets, never printed:
 *
 *   GSC_SERVICE_ACCOUNT_JSON   a Google service account's JSON key, a Full user on the Search Console property
 *   BING_WEBMASTER_API_KEY     Bing Webmaster Tools → Settings → API access
 *
 *   bun run seo:report [--days 28] [--json]   queries, pages, sitemaps and index status of every sitemap URL
 *   bun run seo:ping [url ...]                submit the sitemap (Google, Bing) and ping IndexNow (all sitemap URLs
 *                                             when none are given); only after a release, when `main` serves them
 *
 * The Google property is the Domain property `sc-domain:ianhsiao.me`, which also holds the owner's other
 * subdomains, so every Search Console query is filtered to pages on this site. Search Console data lags 2–3 days.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://turfwar.ianhsiao.me';
const GSC_PROPERTY = 'sc-domain:ianhsiao.me';
const SITEMAP = `${SITE}/sitemap.xml`;
/** IndexNow ownership key; public by design, served as `public/<key>.txt`. */
const INDEXNOW_KEY = '5336c00ece15a45eca31bed2d1d241fc';
const BING_API = 'https://ssl.bing.com/webmaster/api.svc/json';

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);

/** The URLs `public/sitemap.xml` lists (the pages we want indexed). */
const sitemapUrls = () => [...readFileSync(join(import.meta.dirname, '../public/sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

const day = (offset: number) => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);

// ── Google ────────────────────────────────────────────────────────────────────────────────────────────────

let googleToken: string | undefined;
/** An OAuth access token for the service account (a signed JWT exchanged at Google's token endpoint). */
async function google() {
  if (googleToken) return googleToken;
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GSC_SERVICE_ACCOUNT_JSON is not set (an Amp project secret; restart the orb after adding it)');
  const key = JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
  const aud = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/webmasters', aud, iat: now, exp: now + 3600 })}`;
  const jwt = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')}`;
  const res = await fetch(aud, { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
  const body = await res.json() as { access_token?: string; error_description?: string };
  if (!body.access_token) throw new Error(`Google token: ${res.status} ${body.error_description ?? ''}`);
  return (googleToken = body.access_token);
}

async function gsc<T>(method: 'GET' | 'POST' | 'PUT', url: string, body?: object): Promise<T> {
  let res: Response, text: string;
  // Google answers an occasional 500/503 (URL Inspection especially); retry those twice with a pause.
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, { method, headers: { authorization: `Bearer ${await google()}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    text = await res.text();
    if (res.status < 500 || attempt === 2) break;
    await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
  }
  if (!res.ok) throw new Error(`Search Console ${method} ${url.replace(/\?.*/, '')}: ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}
const property = encodeURIComponent(GSC_PROPERTY);
const WEBMASTERS = `https://www.googleapis.com/webmasters/v3/sites/${property}`;

interface Row { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }
/** Search performance on this site's pages (the Domain property also holds other subdomains). */
const searchAnalytics = (days: number, dimensions: string[], rowLimit = 50) =>
  gsc<{ rows?: Row[] }>('POST', `${WEBMASTERS}/searchAnalytics/query`, {
    startDate: day(days + 1), endDate: day(2), dimensions, rowLimit,
    dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'includingRegex', expression: '^https://turfwar\\.ianhsiao\\.me/' }] }],
  }).then(r => r.rows ?? []);

interface Sitemap { path: string; lastSubmitted?: string; lastDownloaded?: string; isPending?: boolean; errors?: string; warnings?: string; contents?: { type: string; submitted: string; indexed?: string }[] }
const sitemaps = () => gsc<{ sitemap?: Sitemap[] }>('GET', `${WEBMASTERS}/sitemaps`).then(r => (r.sitemap ?? []).filter(s => s.path.startsWith(SITE)));

interface Inspection { verdict?: string; coverageState?: string; indexingState?: string; lastCrawlTime?: string; googleCanonical?: string; userCanonical?: string; robotsTxtState?: string; pageFetchState?: string }
const inspect = (url: string) => gsc<{ inspectionResult?: { indexStatusResult?: Inspection } }>('POST', 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { inspectionUrl: url, siteUrl: GSC_PROPERTY })
  .then(r => r.inspectionResult?.indexStatusResult ?? {});

// ── Bing ──────────────────────────────────────────────────────────────────────────────────────────────────

async function bing<T>(method: string, query: Record<string, string> = {}, body?: object): Promise<T> {
  const apikey = process.env.BING_WEBMASTER_API_KEY;
  if (!apikey) throw new Error('BING_WEBMASTER_API_KEY is not set (an Amp project secret; restart the orb after adding it)');
  const res = await fetch(`${BING_API}/${method}?${new URLSearchParams({ ...query, apikey })}`, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json; charset=utf-8' }, body: body && JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bing ${method}: ${res.status} ${text.slice(0, 300)}`);
  return (JSON.parse(text) as { d: T }).d;
}
/** Bing returns dates as `/Date(1700000000000)/`; a never-set one is year 1601 (a negative number). */
const bingDate = (s: string) => { const ms = Number(/-?\d+/.exec(s)?.[0] ?? 0); return ms > 0 ? new Date(ms).toISOString().slice(0, 10) : '–'; };
interface BingFeed { Url: string; Status: string; Submitted: string; LastCrawled: string; UrlCount: number }
interface BingStat { Query: string; Clicks: number; Impressions: number; AvgClickPosition: number; AvgImpressionPosition: number; Date: string }

// ── Commands ──────────────────────────────────────────────────────────────────────────────────────────────

/** Runs one section, so a missing secret or a failing API skips that section instead of the report. */
async function section<T>(name: string, run: () => Promise<T>): Promise<T | { error: string }> {
  try { return await run(); } catch (e) { return { error: `${name}: ${(e as Error).message}` }; }
}
const failed = (v: unknown): v is { error: string } => !!v && typeof v === 'object' && 'error' in v;

async function report() {
  const days = Number(option('days', '28'));
  if (!Number.isInteger(days) || days < 1 || days > 480) { console.error('--days must be a whole number from 1 to 480 (Search Console keeps 16 months)'); process.exit(2); }
  const urls = sitemapUrls();
  const data = {
    site: SITE, property: GSC_PROPERTY, from: day(days + 1), to: day(2),
    google: {
      totals: await section('Google totals', () => searchAnalytics(days, [], 1)),
      queries: await section('Google queries', () => searchAnalytics(days, ['query'])),
      pages: await section('Google pages', () => searchAnalytics(days, ['page'])),
      countries: await section('Google countries', () => searchAnalytics(days, ['country'], 10)),
      devices: await section('Google devices', () => searchAnalytics(days, ['device'], 5)),
      sitemaps: await section('Google sitemaps', sitemaps),
      // One URL at a time, each with its own error, so one failure does not hide the others.
      index: await section('Google URL inspection', async () => {
        const out: Record<string, Inspection | { error: string }> = {};
        for (const u of urls) out[u] = await section(u.replace(SITE, '') || '/', () => inspect(u));
        return out;
      }),
    },
    bing: {
      queries: await section('Bing queries', () => bing<BingStat[]>('GetQueryStats', { siteUrl: `${SITE}/` })),
      pages: await section('Bing pages', () => bing<BingStat[]>('GetPageStats', { siteUrl: `${SITE}/` })),
      sitemaps: await section('Bing sitemaps', () => bing<BingFeed[]>('GetFeeds', { siteUrl: `${SITE}/` })),
    },
  };
  if (flag('json')) { console.log(JSON.stringify(data, null, 2)); return; }

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const table = (head: string[], rows: (string | number)[][]) => rows.length
    ? [`| ${head.join(' | ')} |`, `|${head.map(() => ' --- ').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n')
    : '_(no rows yet)_';
  const rows = (v: Row[] | { error: string }, label: (k: string) => string = k => k) => failed(v) ? `**${v.error}**`
    : table(['', 'clicks', 'impressions', 'CTR', 'position'], v.map(r => [label(r.keys?.[0] ?? 'all'), r.clicks, r.impressions, pct(r.ctr), r.position.toFixed(1)]));
  const g = data.google, b = data.bing;
  const out = [
    `# Search report: ${SITE}`, `Google ${data.from} → ${data.to} (${days} days; Search Console lags 2–3 days). Bing: its own recent window.`,
    '## Google: totals', rows(g.totals, () => 'all pages'),
    '## Google: queries', rows(g.queries),
    '## Google: pages', rows(g.pages, k => k.replace(SITE, '') || '/'),
    '## Google: countries', rows(g.countries),
    '## Google: devices', rows(g.devices),
    '## Google: sitemaps', failed(g.sitemaps) ? `**${g.sitemaps.error}**` : table(['sitemap', 'submitted', 'downloaded', 'pending', 'errors', 'warnings', 'URLs submitted / indexed'],
      g.sitemaps.map(s => [s.path, s.lastSubmitted?.slice(0, 10) ?? '–', s.lastDownloaded?.slice(0, 10) ?? '–', String(!!s.isPending), s.errors ?? '0', s.warnings ?? '0', (s.contents ?? []).map(c => `${c.submitted} / ${c.indexed ?? '?'}`).join(', ')])),
    '## Google: index status of sitemap URLs', failed(g.index) ? `**${g.index.error}**` : table(['URL', 'verdict', 'coverage', 'last crawl', 'Google canonical'],
      Object.entries(g.index).map(([u, i]) => failed(i) ? [u.replace(SITE, '') || '/', `**${i.error.slice(0, 80)}**`, '–', '–', '–'] : [u.replace(SITE, '') || '/', i.verdict ?? '–', i.coverageState ?? '–', i.lastCrawlTime?.slice(0, 10) ?? 'never', i.googleCanonical === u ? 'same' : i.googleCanonical ?? '–'])),
    '## Bing: queries', failed(b.queries) ? `**${b.queries.error}**` : table(['query', 'date', 'clicks', 'impressions', 'avg position'],
      b.queries.slice(0, 50).map(q => [q.Query, bingDate(q.Date), q.Clicks, q.Impressions, q.AvgImpressionPosition])),
    '## Bing: pages', failed(b.pages) ? `**${b.pages.error}**` : table(['page', 'date', 'clicks', 'impressions', 'avg position'],
      b.pages.slice(0, 50).map(q => [q.Query.replace(SITE, '') || '/', bingDate(q.Date), q.Clicks, q.Impressions, q.AvgImpressionPosition])),
    '## Bing: sitemaps', failed(b.sitemaps) ? `**${b.sitemaps.error}**` : table(['sitemap', 'status', 'submitted', 'last crawled', 'URLs'],
      b.sitemaps.map(f => [f.Url, f.Status, bingDate(f.Submitted), bingDate(f.LastCrawled), f.UrlCount])),
  ];
  console.log(out.join('\n\n'));
}

async function ping() {
  const urls = args.slice(1).filter(a => !a.startsWith('--'));
  const list = urls.length ? urls.map(u => new URL(u, SITE).href) : sitemapUrls();
  const results = [
    await section('Google sitemap', async () => { await gsc('PUT', `${WEBMASTERS}/sitemaps/${encodeURIComponent(SITEMAP)}`); return `Google: submitted ${SITEMAP}`; }),
    await section('Bing sitemap', async () => { await bing('SubmitFeed', {}, { siteUrl: `${SITE}/`, feedUrl: SITEMAP }); return `Bing: submitted ${SITEMAP}`; }),
    await section('IndexNow', async () => {
      const res = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: new URL(SITE).host, key: INDEXNOW_KEY, keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`, urlList: list }),
      });
      // 200 = accepted, 202 = accepted while the key is being checked; 403 = the key file is not live yet.
      if (res.status !== 200 && res.status !== 202) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      return `IndexNow: ${res.status}, ${list.length} URL(s): ${list.join(' ')}`;
    }),
  ];
  for (const r of results) console.log(failed(r) ? `FAILED ${r.error}` : r);
  if (results.some(failed)) process.exitCode = 1;
}

if (command === 'report') await report();
else if (command === 'ping') await ping();
else { console.error('usage: bun scripts/seo.ts report [--days 28] [--json] | ping [url ...]'); process.exit(2); }
