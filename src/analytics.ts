import type { Mode } from '../shared/match/state';
import type { VehicleKind } from '../shared/vehicles';

/**
 * Product analytics (PostHog, US cloud): how many players, from where (PostHog derives the country
 * from the IP on its side; we never collect IPs), and what they do. Players stay anonymous: PostHog's
 * own distinct id, never `identify()`. posthog-js (its slim build, no external scripts) loads lazily
 * once the lobby is up, and events tracked before that wait in a short queue.
 *
 * Silent no-op without `VITE_POSTHOG_KEY`, in the dev server unless `?analytics` is in the URL, under
 * the automation flags (`?bench`, `?trailer`, `?capture`, `?fixeddt`) and in headless browsers
 * (`navigator.webdriver`). Dev-server events carry `test: true` and a `dev-test-` distinct id.
 */
export type PlayKind = 'online' | 'room' | 'solo' | 'practice' | 'private' | 'code';
export type Reason = 'menu' | 'disconnect' | 'close';

/** Every event and its properties (kept small and typed). */
export interface Events {
  lobby_view: Record<string, never>;
  play_clicked: { kind: PlayKind; size: string; mode: Mode | ''; map: string };
  match_joined: { online: boolean; room?: string; map: string; mode: Mode; size: string; team: 'swat' | 'militia' };
  match_left: { seconds: number; kills: number; deaths: number; rounds_played: number; reason: Reason };
  round_ended: { won: boolean; mode: Mode; map: string };
  vehicle_entered: { kind: VehicleKind };
  store_purchase: { item: string; price: number };
  language_changed: { to: string };
  error_shown: { where: string; message: string };
}
type EventName = keyof Events;
type Props = Record<string, string | number | boolean>;
interface Options { set?: Props; setOnce?: Props; beacon?: boolean }

/** Automation flags that never send events. */
const AUTOMATION = ['bench', 'trailer', 'capture', 'fixeddt'];

/** Whether this page may send analytics, and whether its events are test events. */
export function analyticsGuard(o: { key?: string; dev: boolean; search: string; webdriver: boolean }): { enabled: boolean; test: boolean; reason: string } {
  const params = new URLSearchParams(o.search);
  const off = (reason: string) => ({ enabled: false, test: false, reason });
  if (!o.key) return off('no key');
  if (o.webdriver) return off('webdriver');
  const flag = AUTOMATION.find(f => params.has(f));
  if (flag) return off(`?${flag}`);
  if (o.dev && !params.has('analytics')) return off('dev server');
  return { enabled: true, test: o.dev, reason: o.dev ? 'dev server with ?analytics (test events)' : 'production' };
}

/** The screen in coarse buckets (nearest 100 CSS pixels), e.g. "1500x1000". */
export const screenBucket = (w: number, h: number) => `${Math.round(w / 100) * 100}x${Math.round(h / 100) * 100}`;

declare const __APP_VERSION__: string;
const env = import.meta.env as Record<string, string | undefined>;
const guard = analyticsGuard({
  key: env.VITE_POSTHOG_KEY,
  dev: !!import.meta.env.DEV,
  search: typeof location === 'undefined' ? '' : location.search,
  webdriver: typeof navigator !== 'undefined' && !!navigator.webdriver,
});

type PostHog = typeof import('posthog-js/dist/module.slim.no-external').default;
let client: PostHog | undefined;
let state: 'waiting' | 'loading' | 'on' | 'off' = guard.enabled ? 'waiting' : 'off';
const queue: ((ph: PostHog) => void)[] = [];
const QUEUE_MAX = 50;

function run(fn: (ph: PostHog) => void) {
  if (state === 'off') return;
  if (client) { try { fn(client); } catch { /* analytics never breaks the game */ } return; }
  if (queue.length < QUEUE_MAX) queue.push(fn);
}

/** Track an event (queued until posthog-js has loaded; dropped when analytics is off). */
export function track<E extends EventName>(event: E, props: Events[E], options: Options = {}) {
  run(ph => ph.capture(event, props as unknown as Props, {
    ...(options.set ? { $set: options.set } : {}),
    ...(options.setOnce ? { $set_once: options.setOnce } : {}),
    // The page is going away: send now, by beacon, rather than with the next batch.
    ...(options.beacon ? { transport: 'sendBeacon' as const, send_instantly: true } : {}),
  }));
}

/** Set person properties (`$set`, and `$set_once` for first-touch values). */
export function setPerson(set: Props, setOnce?: Props) { run(ph => ph.setPersonProperties(set, setOnce)); }

/** Update super properties sent with every event (e.g. `lang` after a language switch). */
export function setSuper(props: Props) { run(ph => ph.register(props)); }

/** The dev server's test distinct id ("dev-test-…"), kept per browser so one tester is one person. */
function devTestId() {
  const key = 'lawbreaker.analytics.devTestId';
  let id = '';
  try { id = localStorage.getItem(key) ?? ''; } catch { /* storage disabled */ }
  if (!id.startsWith('dev-test-')) {
    id = `dev-test-${Math.random().toString(36).slice(2, 10)}`;
    try { localStorage.setItem(key, id); } catch { /* storage disabled */ }
  }
  return id;
}

/**
 * Load posthog-js and start sending; call once the lobby has rendered. `base` are the super
 * properties every event carries (the app version is added here).
 */
export function startAnalytics(base: { lang: string; online_db: string }) {
  if (state !== 'waiting') return;
  state = 'loading';
  const version = typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__;
  void import('posthog-js/dist/module.slim.no-external').then(({ default: posthog }) => {
    posthog.init(env.VITE_POSTHOG_KEY!, {
      api_host: env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
      // Our own events plus page views and leaves; nothing captured from the DOM, no recordings.
      autocapture: false, capture_pageview: true, capture_pageleave: true, disable_session_recording: true,
      capture_dead_clicks: false, capture_heatmaps: false, capture_exceptions: false, capture_performance: false,
      disable_surveys: true, disable_product_tours: true, disable_conversations: true, disable_web_experiments: true,
      // No flags and no remote config: everything is set here, and no extra scripts or requests.
      advanced_disable_flags: true, disable_external_dependency_loading: true,
      persistence: 'localStorage+cookie', person_profiles: 'always', respect_dnt: true,
      ...(guard.test ? {
        bootstrap: { distinctID: devTestId() },
        // Dev test events are printed as sent (our properties, PostHog's own `$…` ones left out).
        before_send: event => {
          if (event) {
            const own = Object.fromEntries(Object.entries(event.properties ?? {}).filter(([k]) => !k.startsWith('$') || k === '$current_url' || k === '$set'));
            console.debug('[analytics]', JSON.stringify({ event: event.event, distinct_id: event.properties?.distinct_id, properties: own, $set: event.$set, $set_once: event.$set_once }));
          }
          return event;
        },
      } : {}),
      loaded: ph => {
        ph.register({
          lang: base.lang, app_version: version, online_db: base.online_db,
          screen: screenBucket(screen.width, screen.height), ...(guard.test ? { test: true } : {}),
        });
      },
    });
    client = posthog;
    state = 'on';
    for (const fn of queue.splice(0)) { try { fn(posthog); } catch { /* keep going */ } }
  }, () => { state = 'off'; queue.length = 0; });
}

// ---- Match sessions: match_joined → round_ended… → match_left (once) ----------------------

let match: { start: number; rounds: number } | undefined;

export function matchJoined(props: Events['match_joined']) {
  match = { start: performance.now(), rounds: 0 };
  track('match_joined', props, { setOnce: { first_map: props.map } });
}

export function roundEnded(props: Events['round_ended']) {
  if (match) match.rounds++;
  track('round_ended', props);
}

/** The match is over for us (menu, a dropped connection, or the tab closing); sent once. */
export function matchLeft(reason: Reason, score: { kills: number; deaths: number }) {
  if (!match) return;
  const seconds = Math.round((performance.now() - match.start) / 1000);
  const rounds = match.rounds;
  match = undefined;
  track('match_left', { seconds, kills: score.kills, deaths: score.deaths, rounds_played: rounds, reason }, { beacon: reason === 'close' });
}
