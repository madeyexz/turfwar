import type { Key } from '../ui/i18n';
import { serverRegionKey } from './ping';

/**
 * The game servers a player can choose (Settings → Server, or `?server=tw|sg|us` for one visit). Each
 * is a SpacetimeDB database running the same module, so this client plays on any of them:
 *
 * - `tw`, the default: this build's own server (VITE_SPACETIMEDB_URI / _DATABASE, which `?stdb=` and
 *   `?db=` override). In production that is the self-hosted server in Taipei; a `dev` preview's is
 *   the Maincloud development database, a local build's the dev server's proxy ("Dev server").
 * - `sg`: Singapore, production before Taipei (offered by a production build). Taipei began as a copy
 *   of it with the same signing keys, so a player has the same identity on both.
 * - `us`: US East, the Maincloud database that was production before Singapore. It stays published,
 *   and players from that time find their saved identity and career there.
 *
 * Each server keeps its own stats: the saved identity is keyed by server (`serverIdentityKey`; Taipei
 * and Singapore share one) and the career stats live in that server's database. The choice is saved (`lawbreaker.server`); the
 * lobby switches at once, a match in progress stays on its server and the next one uses the choice.
 */
export type ServerId = 'tw' | 'sg' | 'us';

export interface GameServer {
  id: ServerId;
  /** The choice's name: "Taipei", "Singapore", "US East", or "Dev server" for a development build's own server. */
  label: Key;
  uri: string;
  database: string;
  /** Where it runs ("Taipei", "Singapore", "US East", "Local") when its host is a known one. */
  region?: Key;
}

export const MAINCLOUD = 'wss://maincloud.spacetimedb.com';
/** Singapore (InstaCloud), production before Taipei; a production build offers it second. */
export const SINGAPORE = { uri: 'wss://play.turfwar.ianhsiao.me', database: 'turfwar' } as const;
/** US East, spelled as production builds had it: a saved identity there is keyed by this URI. */
export const US_EAST = { uri: MAINCLOUD, database: '3d-game-c4lhd' } as const;

const trimUri = (uri: string) => uri.replace(/\/+$/, '').toLowerCase();
export const sameServer = (a: { uri: string; database: string }, b: { uri: string; database: string }) =>
  a.database === b.database && trimUri(a.uri) === trimUri(b.uri);

type Env = Record<string, string | undefined>;
export interface BuildServer { uri?: string; database?: string }

/**
 * This build's server: the build variables, or `?stdb=` / `?db=` from the URL. "same-origin" routes
 * the websocket through the page's own host at /stdb (the dev server proxies it); the trailing slash
 * matters, as the SDK resolves 'v1/...' against it.
 */
export function buildServer(env: Env, page: { search: string; protocol: string; host: string }): BuildServer {
  const params = new URLSearchParams(page.search);
  let uri = params.get('stdb') ?? env.VITE_SPACETIMEDB_URI;
  const database = params.get('db') ?? env.VITE_SPACETIMEDB_DATABASE;
  if (uri === 'same-origin') uri = `${page.protocol === 'https:' ? 'wss' : 'ws'}://${page.host}/stdb/`;
  return { uri: uri || undefined, database: database || undefined };
}

/**
 * The choices: the build's server first (Taipei in production), then Singapore (production builds
 * only), then US East. A build without a server offers none (online play is off, and local
 * development never lands on production by itself); a build that is itself on US East offers just
 * that, and one on Singapore offers Singapore and US East.
 */
export function gameServers(build: BuildServer): GameServer[] {
  if (!build.uri || !build.database) return [];
  const us: GameServer = { id: 'us', label: 'server.region.usEast', uri: US_EAST.uri, database: US_EAST.database, region: 'server.region.usEast' };
  if (sameServer({ uri: build.uri, database: build.database }, US_EAST)) return [{ ...us, uri: build.uri }];
  const sg: GameServer = { id: 'sg', label: 'server.region.singapore', uri: SINGAPORE.uri, database: SINGAPORE.database, region: 'server.region.singapore' };
  if (sameServer({ uri: build.uri, database: build.database }, SINGAPORE)) return [{ ...sg, uri: build.uri }, us];
  const region = serverRegionKey(build.uri);
  const own: GameServer = { id: 'tw', label: region === 'server.region.taipei' ? region : 'server.choice.dev', uri: build.uri, database: build.database, region };
  return region === 'server.region.taipei' ? [own, sg, us] : [own, us];
}

/** Where the choice is saved (localStorage). */
export const SERVER_KEY = 'lawbreaker.server';
/** The storage calls used (localStorage, or a stand-in in tests); either may throw when storage is blocked. */
export interface KeyValue { getItem(key: string): string | null; setItem(key: string, value: string): void }

/**
 * The server to use: `?server=sg|us` (this visit only, never saved), else the saved choice, else the
 * first (Singapore). An id that is not on the list (an old value, a typo) is skipped.
 */
export function chooseServer(list: readonly GameServer[], search: string, storage: KeyValue | undefined): GameServer | undefined {
  const asked = new URLSearchParams(search).get('server')?.trim().toLowerCase();
  let saved: string | null = null;
  try { saved = storage?.getItem(SERVER_KEY) ?? null; } catch { /* storage blocked: the default */ }
  return list.find(s => s.id === asked) ?? list.find(s => s.id === saved) ?? list[0];
}

export function rememberServer(id: ServerId, storage: KeyValue | undefined) {
  try { storage?.setItem(SERVER_KEY, id); } catch { /* storage blocked: not remembered */ }
}

// ---- The current choice (in the browser) ----

const browser = typeof location !== 'undefined';
const storage = (): KeyValue | undefined => { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } };
let state: { list: GameServer[]; current?: GameServer } | undefined;
const listeners = new Set<(server: GameServer) => void>();

function init() {
  if (!state) {
    const list = browser ? gameServers(buildServer(import.meta.env as Env, location)) : [];
    state = { list, current: chooseServer(list, browser ? location.search : '', storage()) };
  }
  return state;
}

/** Every server this build offers (none when it has no server configured). */
export const gameServerList = (): readonly GameServer[] => init().list;
/** The chosen server, or undefined when online play is off. */
export const currentServer = () => init().current;

/** Choose a server (saved for next time) and tell every screen that follows it. */
export function selectServer(id: ServerId) {
  const s = init(), next = s.list.find(x => x.id === id);
  if (!next) return;
  rememberServer(next.id, storage());
  if (next === s.current) return;
  s.current = next;
  for (const fn of [...listeners]) fn(next);
}

/** Follow the choice; returns the unsubscribe function. */
export function onServer(fn: (server: GameServer) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
