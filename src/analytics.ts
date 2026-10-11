import type { Mode } from '../shared/match/state';
import type { VehicleKind } from '../shared/vehicles';
import type { NetFields } from '../shared/netstats';
import type { DeviceKind } from '../shared/devicekind';
import type { ServerId } from './net/servers';
import { currentVisitProps, dropClickIds } from './visit';

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
export type PlayKind = 'online' | 'start' | 'room' | 'solo' | 'practice' | 'private' | 'code';
export type Reason = 'menu' | 'disconnect' | 'close';
/**
 * How a match ended for us, finer than `reason`: the in-game menu's Leave button, the end screen's
 * menu button, the leave key (M, after its confirmation), removed by the server (idle), the
 * connection lost (and not recovered), the connection lost and the same room rejoined at once (`rejoined`: the next `match_joined` has `rejoin`), or the tab closing.
 */
export type Exit = 'menu_button' | 'end_screen' | 'leave_key' | 'removed' | 'lost' | 'rejoined' | 'close';
/** The page's own failures: an uncaught error, a promise nobody caught, the graphics (WebGL) context lost. */
export type ClientErrorKind = 'error' | 'rejection' | 'webgl_lost' | 'webgl_restored';

/**
 * How long the lobby took to reach a server (`seconds`; `queued`: a play button was waiting). `failures`: pings and connects that failed first.
 * `reconnect`: connected before on this page (a dropped connection, not a first load). The split of the wait: `ping_ms` and `ping_ok` (the first ping),
 * `connect_ms` (the connection that went live, from dialling) and `import_ms` (the part of it spent loading the SDK chunk).
 */
export interface ConnectTiming { seconds: number; queued: boolean; failures: number; reconnect: boolean; ping_ms?: number; ping_ok?: boolean; connect_ms?: number; import_ms?: number }

/** Every event and its properties (kept small and typed). */
export interface Events {
  lobby_view: Record<string, never>;
  /** `server_choice`: the server an online play goes to (Settings → Server); offline plays leave it out. */
  play_clicked: { kind: PlayKind; size: string; mode: Mode | ''; map: string; server_choice?: ServerId };
  /** `device`: our own phone/tablet/desktop (src/game/device.ts), which, unlike PostHog's `$device_type`, counts an iPad posing as a Mac as a tablet. */
  /** `rejoin`: back in the same room after the connection dropped (main.ts rejoinAfterDrop). */
  /** `private`: the room has a 4-letter code (a private room, hosted or joined by code); `hosted`: we opened it with 約朋友單挑 (pair with the other persons' `room` to count rooms that found an opponent). */
  /** How it is played (phones): `touch` controls, the screen `upright` at the start (a touch match then plays turned sideways), the `in_app` browser's app, touch `aim_assist` on. */
  match_joined: { online: boolean; room?: string; map: string; mode: Mode; size: string; team: 'swat' | 'militia'; server_choice?: ServerId; device: DeviceKind; rejoin?: boolean; touch?: boolean; upright?: boolean; in_app?: string; aim_assist?: boolean; private?: boolean; hosted?: boolean };
  /** Online, also the match's connection quality (shared/netstats.ts): ping percentiles over the newest ≤600 samples, totals for the rest. */
  /** `sideways`: the page was turned at some point (an upright phone); `knife_kills` (the 藍白拖) and `bobas_drunk` (珍奶) over the stay. */
  match_left: { seconds: number; kills: number; deaths: number; rounds_played: number; reason: Reason; exit?: Exit; sideways?: boolean; knife_kills?: number; bobas_drunk?: number } & Partial<Omit<NetFields, 'seconds'>>;
  round_ended: { won: boolean; mode: Mode; map: string };
  vehicle_entered: { kind: VehicleKind };
  store_purchase: { item: string; price: number };
  language_changed: { to: string };
  error_shown: { where: string; message: string };
  /** The page's own failures (src/errors.ts: at most 5 a page, each message once); `source`: file:line:column, or `opaque` for a "Script error." the browser gave no details of (then with `uptime_s`, `standalone`, `visible`). */
  client_error: { kind: ClientErrorKind; message: string; source?: string; in_match: boolean; uptime_s?: number; standalone?: boolean; visible?: boolean };
  /**
   * The lobby's connection to a server took over 6 s, or needed a retry after a failed ping or connect. (Until 2026-10-12 this was `server_woke`, which
   * also fired for Singapore waking from sleep; Singapore is no longer a choice and the event is gone.)
   */
  connect_slow: ConnectTiming;
  /** Every 5 minutes of a long online match: connection quality over those minutes (`seconds` in a room). */
  net_sample: NetFields;
  /** The callsign question a new player gets before the first game (src/ui/callsign.ts); `play_clicked` follows only if they answer, so asked minus play_clicked is who left at it. */
  callsign_asked: Record<string, never>;
  /** The share card (src/ui/sharepanel.ts). `ref`: this browser's random share code (src/game/challenge.ts); `room`: the link names a live 1v1 room. */
  share_card_opened: { ref: string; solo: boolean; result: 'win' | 'loss' | 'draw'; room: boolean };
  /** `method`: `native` = the card with its link through the share sheet, `link` = only the text and link through it, `copy` = the clipboard (also the fallback of the other two), `download` = the picture saved. */
  share_card_shared: { ref: string; method: 'native' | 'link' | 'download' | 'copy'; room: boolean };
  /** 約朋友單挑 pressed on the end screen (`ref`: this browser's share code; `solo`/`result`: the match it was pressed after; `via`: it opened a private 1v1 `room`, or, with no online play available, shared a `link` the challenger's bot double answers). */
  duel_clicked: { ref: string; solo: boolean; result: 'win' | 'loss' | 'draw'; via: 'room' | 'link' };
  /** A 單挑我 link opened (`ref`: the sharer's code, `has_room`: it names their room). */
  challenge_link_opened: { ref: string; has_room: boolean };
  /** The challenge began: in the sharer's room, or against their bot double (`fallback`) and why. */
  challenge_started: { ref: string; via: 'room' | 'fallback'; reason?: 'no_room' | 'gone' | 'offline' };
  challenge_completed: { ref: string; via: 'room' | 'fallback'; won: boolean };
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
 * properties every event carries (the app version is added here): the language, the SpacetimeDB
 * database and its host (`server_host`, e.g. play.turfwar.ianhsiao.me) and the player's choice of
 * server (`server_choice`: tw or us), so events can be told apart by server. The lobby updates the
 * three with `setSuper` when the player chooses another server.
 */
export function startAnalytics(base: { lang: string; online_db: string; server_host: string; server_choice: string }) {
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
      // posthog-js would send the ad click ids it finds in the URL (fbclid, gclid…); only their presence is kept (src/visit.ts).
      before_send: event => {
        if (!event) return event;
        event.properties = dropClickIds(event.properties);
        event.$set = dropClickIds(event.$set);
        event.$set_once = dropClickIds(event.$set_once);
        // Dev test events are printed as sent (our properties, PostHog's own `$…` ones left out).
        if (guard.test) {
          const own = Object.fromEntries(Object.entries(event.properties ?? {}).filter(([k]) => !k.startsWith('$') || k === '$current_url' || k === '$set'));
          console.debug('[analytics]', JSON.stringify({ event: event.event, distinct_id: event.properties?.distinct_id, properties: own, $set: event.$set, $set_once: event.$set_once }));
        }
        return event;
      },
      ...(guard.test ? { bootstrap: { distinctID: devTestId() } } : {}),
      loaded: ph => {
        ph.register({
          lang: base.lang, app_version: version, online_db: base.online_db, server_host: base.server_host, server_choice: base.server_choice,
          screen: screenBucket(screen.width, screen.height), ...(guard.test ? { test: true } : {}),
          // Not even counted (or kept in storage) when the player has opted out (Do Not Track).
          ...(ph.has_opted_out_capturing() ? {} : currentVisitProps()),
        });
      },
    });
    client = posthog;
    state = 'on';
    for (const fn of queue.splice(0)) { try { fn(posthog); } catch { /* keep going */ } }
  }, () => { state = 'off'; queue.length = 0; });
}

// ---- Match sessions: match_joined → round_ended… → match_left (once) ----------------------

let match: { start: number; rounds: number; sideways: boolean; knifeKills: number; bobas: number } | undefined;

export function matchJoined(props: Events['match_joined']) {
  match = { start: performance.now(), rounds: 0, sideways: false, knifeKills: 0, bobas: 0 };
  track('match_joined', props, { setOnce: { first_map: props.map } });
}

export function roundEnded(props: Events['round_ended']) {
  if (match) match.rounds++;
  track('round_ended', props);
}

/** The match is over for us (menu, a dropped connection, or the tab closing); sent once. `net`: online connection quality; `exit`: exactly how. */
export function matchLeft(reason: Reason, score: { kills: number; deaths: number }, net?: Omit<NetFields, 'seconds'>, exit?: Exit) {
  if (!match) return;
  const seconds = Math.round((performance.now() - match.start) / 1000);
  const { rounds, sideways, knifeKills, bobas } = match;
  match = undefined;
  track('match_left', { seconds, kills: score.kills, deaths: score.deaths, rounds_played: rounds, reason, ...(exit ? { exit } : {}), sideways, knife_kills: knifeKills, bobas_drunk: bobas, ...net }, { beacon: reason === 'close' });
}

/** Counted into this stay's match_left: a knife (藍白拖) kill, a 珍奶 drunk, the page turned sideways. */
export function matchNote(what: 'knife_kill' | 'boba' | 'sideways') {
  if (!match) return;
  if (what === 'knife_kill') match.knifeKills++;
  else if (what === 'boba') match.bobas++;
  else match.sideways = true;
}
