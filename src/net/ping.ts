/**
 * Round-trip time from this browser to each game server, for the lobby.
 *
 * A "server" is a SpacetimeDB host (its websocket URI). Every room lives in one database today (the
 * self-hosted server in Singapore in production), so every room shows the same ping; rooms carry
 * their server's URI so a second server gets its own column value without changes here.
 *
 * Measured with SpacetimeDB's own HTTP `GET /v1/ping` on that host: it is answered by the host
 * without touching the database (no reducer, no subscription, nothing queued behind the match
 * tick), SpacetimeDB allows it cross-origin (`Access-Control-Allow-Origin: *`) and a plain GET needs
 * no preflight. The same request tells a sleeping server from a running one (src/net/wake.ts). The browser websocket API cannot send ping frames, and the SDK has no one-off
 * query, so the open websocket offers nothing cheaper that does not load the database.
 *
 * The first sample pays for the TCP + TLS handshake (about 3× the RTT to Maincloud) and is
 * discarded; after it the browser reuses the connection. One sample every 4 s while the lobby is
 * visible; the shown value is the median of the last 5.
 */
import { t, type Key } from '../ui/i18n';

export const PING_INTERVAL_MS = 4000;
export const PING_WINDOW = 5;
/** A ping slower than this is not worth a sample (and the next one is due anyway). */
const PING_TIMEOUT_MS = 3500;
/** After a pause this long the browser has likely dropped the connection: warm up again. */
const COLD_AFTER_MS = 30_000;

/** `/v1/ping` on the host of a SpacetimeDB URI (ws→http, wss→https; a path prefix such as the dev proxy's `/stdb` is kept). */
export function pingUrl(uri: string): string | undefined {
  let url: URL;
  try { url = new URL(uri); } catch { return undefined; }
  const scheme = ({ 'wss:': 'https:', 'ws:': 'http:', 'https:': 'https:', 'http:': 'http:' } as Record<string, string>)[url.protocol];
  if (!scheme) return undefined;
  return `${scheme}//${url.host}${url.pathname.replace(/\/+$/, '')}/v1/ping`;
}

/** Where each known server host is, as the lobby names it. Any other host is shown by its name. */
export const SERVER_REGIONS: Record<string, Key> = {
  'maincloud.spacetimedb.com': 'server.region.usEast',
  // Taipei (the default since 2026-10-07): SpacetimeDB on a GCP machine in Taiwan (asia-east1),
  // under its own name and its IP's sslip.io name.
  'tw.turfwar.ianhsiao.me': 'server.region.taipei',
  '34-81-41-144.sslip.io': 'server.region.taipei',
  // Singapore: SpacetimeDB on InstaCloud compute (ap-southeast).
  'play.turfwar.ianhsiao.me': 'server.region.singapore',
  localhost: 'server.region.local',
  '127.0.0.1': 'server.region.local',
};
/** Host suffixes with a known region: InstaCloud's own compute hostnames (every one of ours is in Singapore). */
export const SERVER_REGION_SUFFIXES: readonly [string, Key][] = [['.compute.instacloud-edge.com', 'server.region.singapore']];
export function serverHost(uri: string) {
  try { return new URL(uri).hostname; } catch { return uri; }
}
/** The region's dictionary key for a server URI, if its host is a known one. */
export function serverRegionKey(uri: string): Key | undefined {
  const host = serverHost(uri).toLowerCase();
  return SERVER_REGIONS[host] ?? SERVER_REGION_SUFFIXES.find(([suffix]) => host.endsWith(suffix))?.[1];
}
/**
 * Hostnames of the Taipei and Singapore servers. Taipei began as a copy of Singapore, signing keys
 * included, so both issue and accept the same tokens: a player keeps one identity on either (with
 * each server's own stats), under any of their names.
 */
const PRODUCTION_HOSTS = (host: string) => host.endsWith('.compute.instacloud-edge.com')
  || SERVER_REGIONS[host] === 'server.region.taipei' || SERVER_REGIONS[host] === 'server.region.singapore';
/**
 * Which server a URI reaches, for keying a player's saved identity: the same server under another
 * hostname issues and accepts the same tokens, so switching hostnames must not mint new players.
 */
export function serverIdentityKey(uri: string) {
  const host = serverHost(uri).toLowerCase();
  // (The key's name dates from the Singapore server; renaming it would lose every saved identity.)
  return PRODUCTION_HOSTS(host) ? 'instacloud-singapore' : uri;
}
/** "Taipei", "Singapore", "US East", "Local", or the host name. */
export function serverRegion(uri: string) {
  const key = serverRegionKey(uri);
  return key ? t(key) : serverHost(uri);
}

/**
 * One `/v1/ping` to a server (its ping URL): true when the host answered 200. A sleeping server's
 * edge answers 502/503/504, holds the request until `signal` aborts it, or fails outright (a 5xx
 * from the edge usually has no CORS header, so the browser reports a network error): all false.
 */
export async function hostAnswers(url: string, signal: AbortSignal, fetcher: Fetch = (u, i) => fetch(u, i)): Promise<boolean> {
  try {
    const res = await fetcher(url, { cache: 'no-store', signal });
    await res.arrayBuffer().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}

/** How often a match in progress requests its game server's `/v1/ping` (see `keepAwake`). */
export const KEEP_AWAKE_MS = 60_000;

/**
 * Keeps a scale-to-zero game server up under a match: every `every` ms while `active()` (we are in a
 * room), one `/v1/ping`. The host sleeps once no request has reached it for a few minutes, and a
 * match's traffic all rides its already-open WebSocket, which does not count: on 2026-10-07 the
 * platform suspended the Singapore server 5 and 13 minutes into play, dropping everyone in it. Only
 * while in a room, so a forgotten tab never holds the server awake. Returns the function that stops it.
 */
export function keepAwake(url: string, active: () => boolean, fetcher: Fetch = (u, i) => fetch(u, i), every = KEEP_AWAKE_MS): () => void {
  const timer = setInterval(() => {
    if (!active()) return;
    void fetcher(url, { cache: 'no-store' }).then(res => res.arrayBuffer()).catch(() => undefined);
  }, every);
  return () => clearInterval(timer);
}

export function median(xs: readonly number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Green under 80 ms, amber under 160 ms, red otherwise. */
export type PingTone = 'good' | 'fair' | 'bad';
export const pingTone = (ms: number): PingTone => ms < 80 ? 'good' : ms < 160 ? 'fair' : 'bad';

/** No pinging under the automation flags (the performance check, trailer and capture runs). */
export const pingAllowed = (search: string) => !['bench', 'trailer', 'capture', 'fixeddt'].some(f => new URLSearchParams(search).has(f));

/** One server's samples: the first after a (re)start is a handshake and is dropped; the value is the median of the last `PING_WINDOW`. */
export class PingSamples {
  private samples: number[] = [];
  private warm = false;
  add(ms: number) {
    if (!this.warm) { this.warm = true; return; }
    this.samples.push(ms);
    if (this.samples.length > PING_WINDOW) this.samples.shift();
  }
  /** The next sample sets up a connection again (it is dropped); the shown value stays meanwhile. */
  cool() { this.warm = false; }
  /** The server did not answer: no value until it does again. */
  fail() { this.samples = []; this.warm = false; }
  get warmedUp() { return this.warm; }
  get value() { const m = median(this.samples); return m === undefined ? undefined : Math.round(m); }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
/** A tracked server: its ping URL, samples, the pending timer and when its last sample started (undefined: due now). */
interface Server { url: string; samples: PingSamples; timer?: ReturnType<typeof setTimeout>; busy: boolean; last?: number }

/**
 * Pings every tracked server while active (the lobby is open) and the page is visible.
 * `onChange` fires when a server's shown value changes.
 */
export class PingMonitor {
  private servers = new Map<string, Server>();
  private active = false;

  constructor(private onChange: () => void, private fetcher: Fetch = (u, i) => fetch(u, i)) {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => this.reschedule());
  }

  /** Measure this server (a SpacetimeDB URI) from now on. */
  track(uri: string | undefined) {
    if (!uri || this.servers.has(uri)) return;
    const url = pingUrl(uri);
    if (!url) return;
    this.servers.set(uri, { url, samples: new PingSamples(), busy: false });
    this.reschedule();
  }
  /** Stop measuring this server (a sample in flight is dropped): another server was chosen, and pings would keep this one awake. */
  untrack(uri: string | undefined) {
    const s = uri ? this.servers.get(uri) : undefined;
    if (!s) return;
    clearTimeout(s.timer);
    this.servers.delete(uri!);
  }
  /** The shown ping of a server in ms, or undefined while measuring (or when it does not answer). */
  get(uri: string | undefined) { return uri ? this.servers.get(uri)?.samples.value : undefined; }

  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.reschedule();
  }

  private running() { return this.active && (typeof document === 'undefined' || document.visibilityState !== 'hidden'); }

  private reschedule() {
    const now = performance.now();
    for (const s of this.servers.values()) {
      clearTimeout(s.timer); s.timer = undefined;
      if (!this.running() || s.busy) continue;
      if (s.last !== undefined && now - s.last > COLD_AFTER_MS) s.samples.cool();
      s.timer = setTimeout(() => void this.sample(s), s.last === undefined ? 0 : Math.max(0, s.last + PING_INTERVAL_MS - now));
    }
  }

  private async sample(s: Server) {
    s.timer = undefined;
    if (!this.running()) return;
    s.busy = true;
    const before = s.samples.value, warming = !s.samples.warmedUp;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), PING_TIMEOUT_MS);
    const t0 = performance.now();
    try {
      const res = await this.fetcher(s.url, { cache: 'no-store', signal: abort.signal });
      await res.arrayBuffer();
      if (!res.ok) throw new Error(String(res.status));
      s.samples.add(performance.now() - t0);
    } catch {
      s.samples.fail();
    } finally {
      clearTimeout(timeout);
      s.busy = false;
    }
    // The handshake sample is dropped: the first real one follows at once rather than 4 s later.
    s.last = warming && s.samples.warmedUp ? undefined : t0;
    if (s.samples.value !== before) this.onChange();
    this.reschedule();
  }
}
