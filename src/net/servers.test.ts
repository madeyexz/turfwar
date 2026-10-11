import { afterEach, describe, expect, it } from 'vitest';
import { setLang, t } from '../ui/i18n';
import { serverIdentityKey } from './ping';
import { MAINCLOUD, SERVER_KEY, US_EAST, buildServer, chooseServer, gameServers, rememberServer, type KeyValue } from './servers';

const TAIPEI = { uri: 'wss://tw.turfwar.ianhsiao.me', database: 'turfwar' };
const page = (search = '', host = 'turfwar.ianhsiao.me', protocol = 'https:') => ({ search, host, protocol });

function memory(initial: Record<string, string> = {}): KeyValue & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}
const blocked: KeyValue = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };

afterEach(() => setLang('en', false));

describe('the server list', () => {
  it('offers the production build Taipei (the default), then US East, and no Singapore', () => {
    const list = gameServers(TAIPEI);
    expect(list.map(s => [s.id, t(s.label), s.uri, s.database])).toEqual([
      ['tw', 'Taipei', TAIPEI.uri, 'turfwar'],
      ['us', 'US East', MAINCLOUD, '3d-game-c4lhd'],
    ]);
    expect(list.map(s => s.region && t(s.region))).toEqual(['Taipei', 'US East']);
    setLang('zh-TW', false);
    expect(list.map(s => t(s.label))).toEqual(['台北', '美東']);
    expect(list.some(s => (s.id as string) === 'sg')).toBe(false);
  });

  it('keeps Taipei on the identity Singapore had (same key), and the old key for US East', () => {
    const [tw, us] = gameServers(TAIPEI);
    expect(serverIdentityKey(tw.uri)).toBe('instacloud-singapore');
    // connectOnline saves the token under `lawbreaker.token:<identity key>:<database>`; US East was production as exactly this.
    expect(`lawbreaker.token:${serverIdentityKey(us.uri)}:${us.database}`).toBe('lawbreaker.token:wss://maincloud.spacetimedb.com:3d-game-c4lhd');
  });

  it('shows a build pointed at any other server (?stdb=) as its Dev server, not as a named choice', () => {
    const list = gameServers({ uri: 'wss://other.example', database: 'turfwar' });
    expect(list.map(s => [s.id, t(s.label)])).toEqual([['tw', 'Dev server'], ['us', 'US East']]);
  });

  it("puts a dev build's own server first, as the Dev server, and keeps US East (no Singapore)", () => {
    const list = gameServers({ uri: 'wss://maincloud.spacetimedb.com', database: 'lawbreaker-dev' });
    expect(list.map(s => [s.id, t(s.label), s.database])).toEqual([['tw', 'Dev server', 'lawbreaker-dev'], ['us', 'US East', '3d-game-c4lhd']]);
    expect(t(list[0].region!)).toBe('US East');
    const local = gameServers({ uri: 'ws://localhost:5217/stdb/', database: 'lawbreaker' });
    expect(local.map(s => s.id)).toEqual(['tw', 'us']);
    expect([t(local[0].label), t(local[0].region!)]).toEqual(['Dev server', 'Local']);
  });

  it('offers nothing without a build server, and only US East to a build that is on it', () => {
    expect(gameServers({})).toEqual([]);
    expect(gameServers({ uri: TAIPEI.uri })).toEqual([]);
    const list = gameServers({ uri: 'wss://maincloud.spacetimedb.com/', database: US_EAST.database });
    expect(list.map(s => [s.id, s.uri])).toEqual([['us', 'wss://maincloud.spacetimedb.com/']]);
  });

  it("reads the build's server from the build variables, ?stdb= / ?db= and same-origin", () => {
    const env = { VITE_SPACETIMEDB_URI: TAIPEI.uri, VITE_SPACETIMEDB_DATABASE: 'turfwar' };
    expect(buildServer(env, page())).toEqual(TAIPEI);
    expect(buildServer(env, page('?stdb=ws://127.0.0.1:3000&db=lawbreaker'))).toEqual({ uri: 'ws://127.0.0.1:3000', database: 'lawbreaker' });
    expect(buildServer({ VITE_SPACETIMEDB_URI: 'same-origin', VITE_SPACETIMEDB_DATABASE: 'lawbreaker' }, page('', 'localhost:5217', 'http:')))
      .toEqual({ uri: 'ws://localhost:5217/stdb/', database: 'lawbreaker' });
    expect(buildServer({}, page())).toEqual({ uri: undefined, database: undefined });
  });
});

describe('choosing a server', () => {
  const list = gameServers(TAIPEI);

  it('defaults to Taipei and remembers a choice', () => {
    const storage = memory();
    expect(chooseServer(list, '', storage)?.id).toBe('tw');
    rememberServer('us', storage);
    expect(storage.data[SERVER_KEY]).toBe('us');
    expect(chooseServer(list, '', storage)?.id).toBe('us');
    rememberServer('tw', storage);
    expect(chooseServer(list, '', storage)?.id).toBe('tw');
  });

  it('takes ?server=tw|us over the saved choice, without saving it', () => {
    const storage = memory({ [SERVER_KEY]: 'us' });
    expect(chooseServer(list, '?server=tw', storage)?.id).toBe('tw');
    expect(chooseServer(list, '?lang=zh-TW&server=TW', storage)?.id).toBe('tw');
    expect(storage.data[SERVER_KEY]).toBe('us');
    expect(chooseServer(list, '?server=us', memory({ [SERVER_KEY]: 'tw' }))?.id).toBe('us');
  });

  it('Singapore is gone: ?server=sg is ignored, and a saved sg falls back to Taipei and is rewritten', () => {
    // ?server=sg changes nothing: the saved choice (or the default) stays in force, and nothing is saved.
    const kept = memory({ [SERVER_KEY]: 'us' });
    expect(chooseServer(list, '?server=sg', kept)?.id).toBe('us');
    expect(kept.data[SERVER_KEY]).toBe('us');
    expect(chooseServer(list, '?server=sg', memory())?.id).toBe('tw');
    // A choice saved when Singapore was offered: silently Taipei, and the stored value is rewritten once.
    const old = memory({ [SERVER_KEY]: 'sg' });
    expect(chooseServer(list, '', old)?.id).toBe('tw');
    expect(old.data[SERVER_KEY]).toBe('tw');
    expect(chooseServer(list, '', old)?.id).toBe('tw');
    // A dev build rewrites it to its own server too; a visit with ?server=us uses US East but still cleans the old value.
    const dev = memory({ [SERVER_KEY]: 'sg' });
    expect(chooseServer(gameServers({ uri: MAINCLOUD, database: 'lawbreaker-dev' }), '', dev)?.database).toBe('lawbreaker-dev');
    expect(dev.data[SERVER_KEY]).toBe('tw');
    const visit = memory({ [SERVER_KEY]: 'sg' });
    expect(chooseServer(list, '?server=us', visit)?.id).toBe('us');
    expect(visit.data[SERVER_KEY]).toBe('tw');
    // Blocked storage: no error, the default.
    expect(chooseServer(list, '', blocked)?.id).toBe('tw');
  });

  it('falls back to Taipei when the saved or asked id is unknown', () => {
    expect(chooseServer(list, '', memory({ [SERVER_KEY]: 'eu' }))?.id).toBe('tw');
    expect(chooseServer(list, '?server=eu', memory())?.id).toBe('tw');
    // An unknown ?server= still leaves the saved choice in force.
    expect(chooseServer(list, '?server=eu', memory({ [SERVER_KEY]: 'us' }))?.id).toBe('us');
    // A dev build's list: the build's own server is the fallback.
    expect(chooseServer(gameServers({ uri: MAINCLOUD, database: 'lawbreaker-dev' }), '', memory({ [SERVER_KEY]: 'gone' }))?.database).toBe('lawbreaker-dev');
  });

  it('survives blocked or missing storage', () => {
    expect(() => rememberServer('us', blocked)).not.toThrow();
    expect(chooseServer(list, '', blocked)?.id).toBe('tw');
    expect(chooseServer(list, '', undefined)?.id).toBe('tw');
    expect(chooseServer(list, '?server=us', blocked)?.id).toBe('us');
  });

  it('chooses nothing when the build offers no server', () => {
    expect(chooseServer([], '?server=us', memory({ [SERVER_KEY]: 'us' }))).toBeUndefined();
  });
});
