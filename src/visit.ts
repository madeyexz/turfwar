/**
 * What we know about this visit, sent as analytics super properties so the funnel can tell channels
 * and returning players apart (src/analytics.ts calls `visitProps` once PostHog has loaded):
 * - `visit_n`: how many visits this browser has made (a reload within the same tab session is one visit);
 * - `has_prior_storage`: localStorage already held something when the page loaded, so a first visit
 *   carrying `true` was a return whose analytics ID may have been lost (in-app browsers do that), and
 *   `storage_ok`: storage can be written at all;
 * - `first_utm_*`, `first_referrer`, `first_touch_at`, `first_gclid` / `first_fbclid`: the first visit that
 *   carried UTM tags, an ad click id or a referrer, kept in this browser; `visit_…`: this visit's own.
 *   The click ids (`gclid`, `fbclid`) are only noted as present (`true`), never kept or sent;
 * - `in_app`: the app whose built-in browser this is (Threads, Instagram…), if any.
 * Referrers are reduced to a host name; nothing else leaves the browser.
 *
 * This module snapshots the page URL, the referrer and whether storage was populated when it is first
 * imported, so main.ts imports it before anything else can write to localStorage.
 */
import { inAppBrowserName, readEnv } from './game/device';

type Props = Record<string, string | number | boolean>;
/** The slice of `Storage` we use (a Map-backed fake in tests). */
export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; readonly length: number }

const VISITS = 'lawbreaker.visits';
const TOUCH = 'lawbreaker.firstTouch';
const SESSION = 'lawbreaker.visitSession';
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
type Utm = Partial<Record<typeof UTM_KEYS[number], string>>;
interface Touch extends Utm { ref?: string; gclid?: true; fbclid?: true; at: string }

/** Where the visit came from: the page's own URL tags and the referrer's host. */
export interface Landing { search: string; referrer: string; host: string }

const clean = (v: string) => v.replace(/[^\p{L}\p{N}._~:/@+-]+/gu, '-').slice(0, 64);

/** The UTM tags in a query string (trimmed, lower-cased, at most 64 characters each). */
export function parseUtm(search: string): Utm {
  const params = new URLSearchParams(search), out: Utm = {};
  for (const k of UTM_KEYS) {
    const v = params.get(k)?.trim().toLowerCase();
    if (v) out[k] = clean(v);
  }
  return out;
}

/** Whether the ad click ids Google (`gclid`) and Facebook/Meta (`fbclid`) append are present; their values are never read. */
export function clickIds(search: string): { gclid?: true; fbclid?: true } {
  const params = new URLSearchParams(search);
  return { ...(params.has('gclid') ? { gclid: true as const } : {}), ...(params.has('fbclid') ? { fbclid: true as const } : {}) };
}

/**
 * posthog-js copies the ad click ids it finds in the URL (`fbclid`, `gclid`…, also as `$initial_…` and the
 * `$fbc` / `$fbp` cookies' values) into the events; they identify a click, not a channel, so they are dropped
 * before sending and only their presence is kept (`clickIds`). Returns `props` without them.
 */
const CLICK_IDS = ['gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'gad_source', 'fbclid', 'msclkid', 'twclid', 'li_fat_id', 'igshid', 'ttclid', 'rdt_cid', 'epik', 'qclid', 'sccid', 'irclid', '$fbc', '$fbp'];
const CLICK_ID_PARAM = new RegExp(`([?&])(?:${CLICK_IDS.filter(id => !id.startsWith('$')).join('|')})=[^&#]*(&?)`, 'gi');
/** `url` without the click ids in its query string (`?a=1&fbclid=x&b=2` → `?a=1&b=2`). */
export function stripClickIdParams(url: string): string {
  return url.replace(CLICK_ID_PARAM, (_m, lead: string, tail: string) => (tail ? lead : '')).replace(/[?&]$/, '');
}
export function dropClickIds<T extends Record<string, unknown> | undefined>(props: T): T {
  if (!props) return props;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (CLICK_IDS.some(id => k === id || k === `$initial_${id}` || k === `$initial__${id}`)) continue;
    // The page's own URL and referrer (`$current_url`, `$referrer`, `$initial_…`) carry them in the query string.
    out[k] = typeof v === 'string' && v.includes('=') ? stripClickIdParams(v) : v;
  }
  return out as T;
}

/** The referrer's host name (no "www."), or undefined when there is none, it is unreadable or it is this site itself. */
export function referrerHost(referrer: string, ownHost: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase();
    return host && host !== ownHost.replace(/^www\./, '').toLowerCase() ? clean(host) : undefined;
  } catch { return undefined; }
}

const readJson = <T,>(s: Store, k: string): T | undefined => { try { const v = s.getItem(k); return v ? JSON.parse(v) as T : undefined; } catch { return undefined; } };
const writeOk = (s: Store, k: string, v: string) => { try { s.setItem(k, v); return true; } catch { return false; } };

/** Whether `s` can be written and read back. */
function works(s: Store | undefined) {
  if (!s) return false;
  try { s.setItem('lawbreaker.probe', '1'); const ok = s.getItem('lawbreaker.probe') === '1'; s.removeItem('lawbreaker.probe'); return ok; } catch { return false; }
}

/** localStorage held anything when the page loaded. */
export function hadStorage(s: Store | undefined) { try { return !!s && s.length > 0; } catch { return false; } }

interface Inputs { local?: Store; session?: Store; landing: Landing; prior: boolean; inApp?: string; now?: Date }

/** The visit's super properties; counts the visit and keeps the first touch on the way (see the file comment). */
export function visitProps({ local, session, landing, prior, inApp, now = new Date() }: Inputs): Props {
  const props: Props = {};
  const storageOk = works(local);
  const tags = { ...parseUtm(landing.search), ...clickIds(landing.search) }, ref = referrerHost(landing.referrer, landing.host);
  const here: Touch | undefined = Object.keys(tags).length || ref ? { ...tags, ...(ref ? { ref } : {}), at: now.toISOString().slice(0, 10) } : undefined;

  // One visit per tab session: a reload keeps the number (and what the first load saw of the storage).
  let n = 1, hadPrior = prior;
  const same = session && readJson<{ n: number; prior: boolean }>(session, SESSION);
  if (same && typeof same.n === 'number') ({ n, prior: hadPrior } = same);
  else {
    const stored = storageOk && local ? Number(local.getItem(VISITS)) : 0;
    n = (Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0) + 1;
    if (storageOk && local) writeOk(local, VISITS, String(n));
    if (session) writeOk(session, SESSION, JSON.stringify({ n, prior }));
  }
  Object.assign(props, { visit_n: n, has_prior_storage: hadPrior, storage_ok: storageOk });
  if (inApp) props.in_app = inApp;

  // The first visit that tells us anything about the channel is kept; a direct first visit does not use the slot up.
  let first = storageOk && local ? readJson<Touch>(local, TOUCH) : undefined;
  if (!first && here) { first = here; if (local && storageOk) writeOk(local, TOUCH, JSON.stringify(first)); }
  const add = (prefix: string, t: Touch | undefined) => {
    if (!t) return;
    for (const k of UTM_KEYS) if (t[k]) props[`${prefix}${k}`] = t[k]!;
    if (t.ref) props[`${prefix}referrer`] = t.ref;
    if (t.gclid) props[`${prefix}gclid`] = true;
    if (t.fbclid) props[`${prefix}fbclid`] = true;
  };
  add('first_', first);
  if (first?.at) props.first_touch_at = first.at;
  add('visit_', here);
  return props;
}

const store = (kind: 'localStorage' | 'sessionStorage'): Store | undefined => { try { return typeof window === 'undefined' ? undefined : window[kind]; } catch { return undefined; } };

// Snapshot at first import (see the file comment).
const landing: Landing = typeof location === 'undefined' ? { search: '', referrer: '', host: '' } : { search: location.search, referrer: typeof document === 'undefined' ? '' : document.referrer, host: location.hostname };
const prior = hadStorage(store('localStorage'));

/** This browser's visit properties (counts the visit, so call it once per page, when analytics starts). */
export function currentVisitProps(): Props {
  return visitProps({ local: store('localStorage'), session: store('sessionStorage'), landing, prior, inApp: inAppBrowserName(readEnv()) });
}
