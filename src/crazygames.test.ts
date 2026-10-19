import { afterEach, describe, expect, it } from 'vitest';
import { crazyRestore, crazySave, initCrazyGames, linkParams, linkPlace, resetCrazyGamesForTest, type CrazySdk } from './crazygames';
import { challengeUrl, inviteUrl, linkServer, parseChallenge, parseInvite } from './game/challenge';

/** A link we hand out, through CrazyGames' invite parameters and back to what the lobby reads. */
const roundTrip = (url: string) => linkPlace(linkParams(url))!;

describe('CrazyGames invite links', () => {
  it('carry an invite to a private room, with its share code, and no UTM tags', () => {
    const params = linkParams(inviteUrl('https://cdn.example', 'qwer', 'abc12345'));
    expect(params).toEqual({ r: 'QWER', ref: 'abc12345' });
    const place = roundTrip(inviteUrl('https://cdn.example', 'QWER', 'abc12345'));
    expect(parseInvite(place.pathname, place.search)).toEqual({ room: 'QWER', ref: 'abc12345' });
    expect(parseChallenge(place.search, place.pathname)).toBeUndefined();
  });

  it('carry a challenge with its room, map and kills, dropping the UTM tags', () => {
    const url = challengeUrl('https://cdn.example', { name: 'Ah-Bing', room: 'ZXCV', map: 'ximending', beat: 17, ref: 'abc12345' }, { source: 'duel', medium: 'share_card' });
    expect(url).toContain('utm_source=');
    const params = linkParams(url);
    expect(Object.keys(params).some(k => k.startsWith('utm_'))).toBe(false);
    const place = roundTrip(url);
    expect(parseChallenge(place.search, place.pathname)).toEqual({ name: 'Ah-Bing', room: 'ZXCV', map: 'ximending', beat: 17, ref: 'abc12345' });
    expect(parseInvite(place.pathname, place.search)).toBeUndefined();
  });

  it("name a US East room's server, so a friend whose default is Taipei still finds the room (and the reverse)", () => {
    const us = roundTrip(inviteUrl('https://cdn.example', 'QWER', 'abc12345', 'us'));
    expect(parseInvite(us.pathname, us.search)).toEqual({ room: 'QWER', ref: 'abc12345', server: 'us' });
    expect(linkServer(us)).toBe('us');
    // A Taipei room's link stays as short as before, and a room link without `s` means Taipei.
    expect(inviteUrl('https://cdn.example', 'QWER', 'abc12345', 'tw')).toBe('https://cdn.example/r/QWER?ref=abc12345');
    expect(linkServer(roundTrip(inviteUrl('https://cdn.example', 'QWER', 'abc12345')))).toBe('tw');
    const duel = roundTrip(challengeUrl('https://cdn.example', { name: 'Ah-Bing', room: 'ZXCV', ref: 'abc12345', server: 'us' }));
    expect([parseChallenge(duel.search, duel.pathname)?.server, linkServer(duel)]).toEqual(['us', 'us']);
    // CrazyGames' "join friend" parameters for a US East room (main.ts reportRoom).
    expect(linkServer(linkPlace({ r: 'ASDF', s: 'us' })!)).toBe('us');
  });

  it('stand for no place when the parameters are neither', () => {
    expect(linkPlace({ foo: 'bar' })).toBeUndefined();
  });
});

describe('CrazyGames Data module saves', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); } };
  };
  const start = async (data: CrazySdk['data']) => {
    const local = store();
    (globalThis as { localStorage?: unknown }).localStorage = local;
    await initCrazyGames({ init: async () => undefined, environment: 'local', data } as unknown as CrazySdk);
    return local;
  };
  afterEach(() => { resetCrazyGamesForTest(); delete (globalThis as { localStorage?: unknown }).localStorage; });
  const progress = (xp: number) => JSON.stringify({ xp, rounds: 1 });

  it("restore the account's saves on a new device, keep the further progress, and copy what only this browser has", async () => {
    const account = store();
    account.setItem('lawbreaker.skin', 'gold');
    account.setItem('lawbreaker.progress', progress(500));
    const local = await start(account);
    local.setItem('lawbreaker.keys', '{"jump":"Space"}');
    local.setItem('lawbreaker.progress', progress(40));
    crazyRestore();
    expect(local.getItem('lawbreaker.skin')).toBe('gold');
    expect(local.getItem('lawbreaker.progress')).toBe(progress(500));
    expect(account.getItem('lawbreaker.keys')).toBe('{"jump":"Space"}');
    // Further progress on this browser (played before logging in) is not lost to an older account save.
    local.setItem('lawbreaker.progress', progress(900));
    crazyRestore();
    expect(account.getItem('lawbreaker.progress')).toBe(progress(900));
    // Later changes are saved; keys outside the list never are.
    local.setItem('lawbreaker.warmup', '1'); local.setItem('lawbreaker.token:x', 'secret');
    crazySave();
    expect(account.getItem('lawbreaker.warmup')).toBe('1');
    expect(account.getItem('lawbreaker.token:x')).toBeNull();
  });

  it('stay quiet when the module is off for the game', async () => {
    let calls = 0;
    const off = { getItem: () => { calls++; throw { code: 'dataModuleDisabled', message: 'off' }; }, setItem: () => undefined };
    const local = await start(off);
    local.setItem('lawbreaker.progress', progress(10));
    expect(() => { crazyRestore(); crazySave(); crazySave(); }).not.toThrow();
    expect(calls).toBe(1);
    expect(local.getItem('lawbreaker.progress')).toBe(progress(10));
  });
});
