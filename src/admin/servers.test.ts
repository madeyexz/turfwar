import { describe, expect, it } from 'vitest';
import { MAINCLOUD, SERVER_KEY, adminServers, chosenServer, regionName, rememberServer, type KeyValue } from './servers';

const SINGAPORE = { uri: 'wss://play.turfwar.ianhsiao.me', database: 'turfwar' };

function memory(initial: Record<string, string> = {}): KeyValue & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}
const blocked: KeyValue = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };

describe('admin servers', () => {
  it('lists the build server first, then Maincloud legacy and dev', () => {
    const list = adminServers(SINGAPORE);
    expect(list.map(s => [s.id, s.name, s.database])).toEqual([
      ['build', 'Singapore production', 'turfwar'],
      ['legacy', 'Maincloud (legacy)', '3d-game-c4lhd'],
      ['dev', 'Maincloud dev', 'lawbreaker-dev'],
    ]);
    expect(list[1].uri).toBe(MAINCLOUD);
    expect(list.map(s => regionName(s.uri))).toEqual(['Singapore', 'US East', 'US East']);
  });

  it('names the InstaCloud host Singapore too, and other builds plainly', () => {
    expect(adminServers({ uri: 'wss://prod-main-stdb-2b7636-205bvw6d002.compute.instacloud-edge.com', database: 'turfwar' })[0].name).toBe('Singapore production');
    expect(adminServers({ uri: 'ws://127.0.0.1:3261', database: 'turfwar' })[0]).toMatchObject({ id: 'build', name: 'This build' });
  });

  it('lists a dev preview build once, under its Maincloud name', () => {
    const list = adminServers({ uri: 'wss://maincloud.spacetimedb.com/', database: 'lawbreaker-dev' });
    expect(list.map(s => s.id)).toEqual(['dev', 'legacy']);
  });

  it('works without build variables', () => {
    expect(adminServers({}).map(s => s.id)).toEqual(['legacy', 'dev']);
  });

  it('remembers the chosen server, defaulting to the first', () => {
    const list = adminServers(SINGAPORE);
    const storage = memory();
    expect(chosenServer(list, storage).id).toBe('build');
    rememberServer(list[1], storage);
    expect(storage.data[SERVER_KEY]).toBe('legacy');
    expect(chosenServer(list, storage).id).toBe('legacy');
    // A remembered server that is no longer listed falls back to the default.
    expect(chosenServer(list, memory({ [SERVER_KEY]: 'gone' })).id).toBe('build');
  });

  it('survives blocked or missing storage', () => {
    const list = adminServers(SINGAPORE);
    expect(() => rememberServer(list[2], blocked)).not.toThrow();
    expect(chosenServer(list, blocked).id).toBe('build');
    expect(chosenServer(list, undefined).id).toBe('build');
  });
});
