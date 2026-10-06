import { DICTIONARIES } from '../ui/i18n';
import { serverHost, serverRegionKey } from '../net/ping';

/**
 * The servers /admin can show. Each SpacetimeDB database has its own `admin` table (and the same
 * module, so the same admin key works on all of them), so logging in is per server, and so is the
 * browser's admin identity. The default is the build's own server (production: the Singapore server);
 * the two Maincloud databases stay published and are listed after it: the legacy production one,
 * where older players' data remains, and the development one behind `dev` previews.
 */
export interface AdminServer {
  /** Stable id, remembered as the chosen server: 'build' (this build's server), 'legacy' or 'dev'. */
  id: string;
  name: string;
  uri: string;
  database: string;
}

export const MAINCLOUD = 'wss://maincloud.spacetimedb.com';
export const MAINCLOUD_SERVERS: readonly AdminServer[] = [
  { id: 'legacy', name: 'Maincloud (legacy)', uri: MAINCLOUD, database: '3d-game-c4lhd' },
  { id: 'dev', name: 'Maincloud dev', uri: MAINCLOUD, database: 'lawbreaker-dev' },
];

/** Where the choice is remembered (localStorage). */
export const SERVER_KEY = 'lawbreaker.admin.server';

const sameServer = (a: { uri: string; database: string }, b: { uri: string; database: string }) =>
  a.database === b.database && a.uri.replace(/\/+$/, '').toLowerCase() === b.uri.replace(/\/+$/, '').toLowerCase();

/** "Singapore", "US East", "Local", or the host name (in English: the admin page is English). */
export function regionName(uri: string) {
  const key = serverRegionKey(uri);
  return key ? DICTIONARIES.en[key] : serverHost(uri);
}

/**
 * The switcher's entries: the build's server first (unless the build has none), then the Maincloud
 * databases. A build that points at one of those (a `dev` preview) lists it once, first, under its own name.
 */
export function adminServers(build: { uri?: string; database?: string }): AdminServer[] {
  if (!build.uri || !build.database) return [...MAINCLOUD_SERVERS];
  const mine = { uri: build.uri, database: build.database };
  const known = MAINCLOUD_SERVERS.find(s => sameServer(s, mine));
  const first: AdminServer = known ?? { id: 'build', name: regionName(mine.uri) === 'Singapore' ? 'Singapore production' : 'This build', ...mine };
  return [first, ...MAINCLOUD_SERVERS.filter(s => s !== known)];
}

/** The storage calls used (localStorage, or a stand-in in tests); either may throw when storage is blocked. */
export interface KeyValue { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** The remembered server if it is still listed, else the first (the default). */
export function chosenServer(list: readonly AdminServer[], storage: KeyValue | undefined): AdminServer {
  let id: string | null = null;
  try { id = storage?.getItem(SERVER_KEY) ?? null; } catch { /* storage blocked: the default */ }
  return list.find(s => s.id === id) ?? list[0];
}

export function rememberServer(server: AdminServer, storage: KeyValue | undefined) {
  try { storage?.setItem(SERVER_KEY, server.id); } catch { /* storage blocked: not remembered */ }
}
