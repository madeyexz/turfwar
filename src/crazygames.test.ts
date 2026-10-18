import { describe, expect, it } from 'vitest';
import { linkParams, linkPlace } from './crazygames';
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
