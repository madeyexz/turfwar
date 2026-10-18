import { DICTIONARIES } from '../ui/i18n';
import { serverHost, serverRegionKey } from '../net/ping';
import { MAINCLOUD, US_EAST, sameServer } from '../net/servers';

/**
 * The servers /admin can show. Each SpacetimeDB database has its own `admin` table (and the same
 * module, so the same admin key works on all of them), so logging in is per server, and so is the
 * browser's admin identity. The default is the build's own server (production: the Taipei server);
 * the two Maincloud databases are listed after it: US East (the earlier production database, still a production
 * server: new players far from Taipei start there), and the development one behind `dev` previews.
 */
export interface AdminServer {
  /** Stable id, remembered as the chosen server: 'build' (this build's server), 'legacy' or 'dev'. (A remembered 'sg' from when Singapore was listed falls back to the first.) */
  id: string;
  name: string;
  uri: string;
  database: string;
}

export { MAINCLOUD };
export const MAINCLOUD_SERVERS: readonly AdminServer[] = [
  // The game's "US East" choice (src/net/servers.ts): new players far from Taipei start here. The id stays 'legacy' (remembered choices).
  { id: 'legacy', name: 'US East production', uri: US_EAST.uri, database: US_EAST.database },
  { id: 'dev', name: 'Maincloud dev', uri: MAINCLOUD, database: 'lawbreaker-dev' },
];

/** Where the choice is remembered (localStorage). */
export const SERVER_KEY = 'lawbreaker.admin.server';

/** "Taipei", "US East", "Local", or the host name (in English: the admin page is English). */
export function regionName(uri: string) {
  const key = serverRegionKey(uri);
  return key ? DICTIONARIES.en[key] : serverHost(uri);
}

/**
 * The switcher's entries: the build's server first (unless the build has none), then the
 * Maincloud databases. A build that points at one of those (a `dev` preview) lists it once, first, under its own name.
 */
export function adminServers(build: { uri?: string; database?: string }): AdminServer[] {
  const others = [...MAINCLOUD_SERVERS];
  if (!build.uri || !build.database) return others;
  const mine = { uri: build.uri, database: build.database };
  const known = others.find(s => sameServer(s, mine));
  const region = regionName(mine.uri);
  const first: AdminServer = known ?? { id: 'build', name: region === 'Taipei' ? `${region} production` : 'This build', ...mine };
  return [first, ...others.filter(s => s !== known)];
}

/** The storage calls used (localStorage, or a stand-in in tests); either may throw when storage is blocked. */
export interface KeyValue { getItem(key: string): string | null; setItem(key: string, value: string): void }

/**
 * What the switcher offers: one server, or several added together. 'all' (All production) adds the
 * Taipei server and US East, the two servers players are sent to; it is listed first, so it is the
 * default, whenever the build is Taipei's. Then every server on its own.
 */
export interface AdminSource { id: string; name: string; servers: AdminServer[] }

export function adminSources(list: readonly AdminServer[]): AdminSource[] {
  const one = list.map(s => ({ id: s.id, name: s.name, servers: [s] }));
  const taipei = list.find(s => s.id === 'build' && regionName(s.uri) === 'Taipei');
  const us = list.find(s => s.id === 'legacy');
  return taipei && us ? [{ id: 'all', name: 'All production', servers: [taipei, us] }, ...one] : one;
}

/** The remembered entry if it is still listed, else the first (the default). */
export function chosenServer<T extends { id: string }>(list: readonly T[], storage: KeyValue | undefined): T {
  let id: string | null = null;
  try { id = storage?.getItem(SERVER_KEY) ?? null; } catch { /* storage blocked: the default */ }
  return list.find(s => s.id === id) ?? list[0];
}

export function rememberServer(server: { id: string }, storage: KeyValue | undefined) {
  try { storage?.setItem(SERVER_KEY, server.id); } catch { /* storage blocked: not remembered */ }
}
