import { DICTIONARIES } from '../ui/i18n';
import { serverHost, serverRegionKey } from '../net/ping';
import { MAINCLOUD, SINGAPORE, US_EAST, sameServer } from '../net/servers';

/**
 * The servers /admin can show. Each SpacetimeDB database has its own `admin` table (and the same
 * module, so the same admin key works on all of them), so logging in is per server, and so is the
 * browser's admin identity. The default is the build's own server (production: the Taipei server);
 * Singapore (production before Taipei, still a choice in the game) and the two Maincloud databases
 * are listed after it: the legacy production one, where older players' data remains, and the
 * development one behind `dev` previews.
 */
export interface AdminServer {
  /** Stable id, remembered as the chosen server: 'build' (this build's server), 'sg', 'legacy' or 'dev'. */
  id: string;
  name: string;
  uri: string;
  database: string;
}

export { MAINCLOUD };
/** Singapore: the game's "Singapore" choice (src/net/servers.ts). */
export const SINGAPORE_SERVER: AdminServer = { id: 'sg', name: 'Singapore', uri: SINGAPORE.uri, database: SINGAPORE.database };
export const MAINCLOUD_SERVERS: readonly AdminServer[] = [
  // The game's "US East" choice (src/net/servers.ts).
  { id: 'legacy', name: 'Maincloud (legacy)', uri: US_EAST.uri, database: US_EAST.database },
  { id: 'dev', name: 'Maincloud dev', uri: MAINCLOUD, database: 'lawbreaker-dev' },
];

/** Where the choice is remembered (localStorage). */
export const SERVER_KEY = 'lawbreaker.admin.server';

/** "Taipei", "Singapore", "US East", "Local", or the host name (in English: the admin page is English). */
export function regionName(uri: string) {
  const key = serverRegionKey(uri);
  return key ? DICTIONARIES.en[key] : serverHost(uri);
}

/**
 * The switcher's entries: the build's server first (unless the build has none), then Singapore and the
 * Maincloud databases. A build that points at one of those (a `dev` preview) lists it once, first, under its own name.
 */
export function adminServers(build: { uri?: string; database?: string }): AdminServer[] {
  const others = [SINGAPORE_SERVER, ...MAINCLOUD_SERVERS];
  if (!build.uri || !build.database) return others;
  const mine = { uri: build.uri, database: build.database };
  const known = others.find(s => sameServer(s, mine));
  const region = regionName(mine.uri);
  const first: AdminServer = known ?? { id: 'build', name: region === 'Taipei' || region === 'Singapore' ? `${region} production` : 'This build', ...mine };
  return [first, ...others.filter(s => s !== known)];
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
