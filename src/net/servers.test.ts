import { afterEach, describe, expect, it } from 'vitest';
import { setLang, t } from '../ui/i18n';
import { serverIdentityKey } from './ping';
import { MAINCLOUD, SERVER_KEY, US_EAST, buildServer, chooseServer, gameServers, rememberServer, type KeyValue } from './servers';

const SINGAPORE = { uri: 'wss://play.turfwar.ianhsiao.me', database: 'turfwar' };
const page = (search = '', host = 'turfwar.ianhsiao.me', protocol = 'https:') => ({ search, host, protocol });

function memory(initial: Record<string, string> = {}): KeyValue & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}
const blocked: KeyValue = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };

afterEach(() => setLang('en', false));

describe('the server list', () => {
  it('offers the production build Singapore (the default) and US East', () => {
    const list = gameServers(SINGAPORE);
    expect(list.map(s => [s.id, t(s.label), s.uri, s.database])).toEqual([
      ['sg', 'Singapore', SINGAPORE.uri, 'turfwar'],
      ['us', 'US East', MAINCLOUD, '3d-game-c4lhd'],
    ]);
    expect(list.map(s => s.region && t(s.region))).toEqual(['Singapore', 'US East']);
    setLang('zh-TW', false);
    expect(list.map(s => t(s.label))).toEqual(['新加坡', '美東']);
  });

  it('keeps one saved identity per server: US East keeps the key older players have', () => {
    const [sg, us] = gameServers(SINGAPORE);
    expect(serverIdentityKey(sg.uri)).toBe('instacloud-singapore');
    // connectOnline saves the token under `lawbreaker.token:<identity key>:<database>`; US East was production as exactly this.
    expect(`lawbreaker.token:${serverIdentityKey(us.uri)}:${us.database}`).toBe('lawbreaker.token:wss://maincloud.spacetimedb.com:3d-game-c4lhd');
  });

  it("puts a dev build's own server first, as the Dev server, and keeps US East", () => {
    const list = gameServers({ uri: 'wss://maincloud.spacetimedb.com', database: 'lawbreaker-dev' });
    expect(list.map(s => [s.id, t(s.label), s.database])).toEqual([['sg', 'Dev server', 'lawbreaker-dev'], ['us', 'US East', '3d-game-c4lhd']]);
    expect(t(list[0].region!)).toBe('US East');
    const local = gameServers({ uri: 'ws://localhost:5217/stdb/', database: 'lawbreaker' });
    expect(local.map(s => s.id)).toEqual(['sg', 'us']);
    expect([t(local[0].label), t(local[0].region!)]).toEqual(['Dev server', 'Local']);
  });

  it('offers nothing without a build server, and only US East to a build that is on it', () => {
    expect(gameServers({})).toEqual([]);
    expect(gameServers({ uri: SINGAPORE.uri })).toEqual([]);
    const list = gameServers({ uri: 'wss://maincloud.spacetimedb.com/', database: US_EAST.database });
    expect(list.map(s => [s.id, s.uri])).toEqual([['us', 'wss://maincloud.spacetimedb.com/']]);
  });

  it("reads the build's server from the build variables, ?stdb= / ?db= and same-origin", () => {
    const env = { VITE_SPACETIMEDB_URI: SINGAPORE.uri, VITE_SPACETIMEDB_DATABASE: 'turfwar' };
    expect(buildServer(env, page())).toEqual(SINGAPORE);
    expect(buildServer(env, page('?stdb=ws://127.0.0.1:3000&db=lawbreaker'))).toEqual({ uri: 'ws://127.0.0.1:3000', database: 'lawbreaker' });
    expect(buildServer({ VITE_SPACETIMEDB_URI: 'same-origin', VITE_SPACETIMEDB_DATABASE: 'lawbreaker' }, page('', 'localhost:5217', 'http:')))
      .toEqual({ uri: 'ws://localhost:5217/stdb/', database: 'lawbreaker' });
    expect(buildServer({}, page())).toEqual({ uri: undefined, database: undefined });
  });
});

describe('choosing a server', () => {
  const list = gameServers(SINGAPORE);

  it('defaults to Singapore and remembers a choice', () => {
    const storage = memory();
    expect(chooseServer(list, '', storage)?.id).toBe('sg');
    rememberServer('us', storage);
    expect(storage.data[SERVER_KEY]).toBe('us');
    expect(chooseServer(list, '', storage)?.id).toBe('us');
    rememberServer('sg', storage);
    expect(chooseServer(list, '', storage)?.id).toBe('sg');
  });

  it('takes ?server=sg|us over the saved choice, without saving it', () => {
    const storage = memory({ [SERVER_KEY]: 'sg' });
    expect(chooseServer(list, '?server=us', storage)?.id).toBe('us');
    expect(chooseServer(list, '?lang=zh-TW&server=US', storage)?.id).toBe('us');
    expect(storage.data[SERVER_KEY]).toBe('sg');
    expect(chooseServer(list, '?server=sg', memory({ [SERVER_KEY]: 'us' }))?.id).toBe('sg');
  });

  it('falls back to Singapore when the saved or asked id is unknown', () => {
    expect(chooseServer(list, '', memory({ [SERVER_KEY]: 'eu' }))?.id).toBe('sg');
    expect(chooseServer(list, '?server=eu', memory())?.id).toBe('sg');
    // An unknown ?server= still leaves the saved choice in force.
    expect(chooseServer(list, '?server=eu', memory({ [SERVER_KEY]: 'us' }))?.id).toBe('us');
    // A dev build's list: the build's own server is the fallback.
    expect(chooseServer(gameServers({ uri: MAINCLOUD, database: 'lawbreaker-dev' }), '', memory({ [SERVER_KEY]: 'gone' }))?.database).toBe('lawbreaker-dev');
  });

  it('survives blocked or missing storage', () => {
    expect(() => rememberServer('us', blocked)).not.toThrow();
    expect(chooseServer(list, '', blocked)?.id).toBe('sg');
    expect(chooseServer(list, '', undefined)?.id).toBe('sg');
    expect(chooseServer(list, '?server=us', blocked)?.id).toBe('us');
  });

  it('chooses nothing when the build offers no server', () => {
    expect(chooseServer([], '?server=us', memory({ [SERVER_KEY]: 'us' }))).toBeUndefined();
  });
});
