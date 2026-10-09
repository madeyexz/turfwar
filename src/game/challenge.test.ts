import { describe, expect, it } from 'vitest';
import { challengeMap, challengeUrl, cleanName, parseChallenge, shareRef } from './challenge';
import { bragLine, MatchTally, nationalDay, type MatchSummary } from './matchstats';

describe('單挑我 links', () => {
  it('round-trips a challenge with a room', () => {
    const url = challengeUrl('https://turfwar.ianhsiao.me', { name: 'Raven', room: 'ABCD', map: 'taipei', beat: 23, ref: 'k3x9q2ab' });
    expect(url).toBe('https://turfwar.ianhsiao.me/?c=1&room=ABCD&ch=Raven&map=taipei&beat=23&ref=k3x9q2ab');
    expect(parseChallenge(new URL(url).search)).toEqual({ name: 'Raven', room: 'ABCD', map: 'taipei', beat: 23, ref: 'k3x9q2ab' });
  });

  it('keeps Chinese callsigns and encodes them', () => {
    const url = challengeUrl('https://x.test', { name: '阿明 小隊' });
    expect(parseChallenge(new URL(url).search)).toEqual({ name: '阿明 小隊' });
  });

  it('is not a challenge without ?c or without a usable name', () => {
    expect(parseChallenge('?room=ABCD&autostart=1')).toBeUndefined();
    expect(parseChallenge('?c=1')).toBeUndefined();
    expect(parseChallenge('?c=1&ch=%3C%3E%22')).toBeUndefined();
  });

  it('drops anything doubtful and cleans the rest', () => {
    const c = parseChallenge('?c=1&ch=%3Cscript%3Ealert(1)%3C%2Fscript%3E&room=ab!&map=../etc&beat=-4&ref=NOPE!');
    expect(c).toEqual({ name: 'scriptalert1scri' });
    expect(parseChallenge('?c=1&ch=Ace&beat=12.5&room=wxyz&ref=ABCDEFGH')).toEqual({ name: 'Ace', room: 'WXYZ', ref: 'abcdefgh' });
    expect(parseChallenge('?c=1&ch=Ace&beat=5000')?.beat).toBeUndefined();
    expect(cleanName('  a   b  ')).toBe('a b');
    expect(cleanName('x'.repeat(40))).toHaveLength(16);
  });

  it('plays on the challenge map only where a 1v1 fits', () => {
    expect(challengeMap('taipei', ['taipei', 'ochre'])).toBe('taipei');
    expect(challengeMap('meridian', ['taipei', 'ochre'])).toBe('taipei');
    expect(challengeMap(undefined, ['ochre'])).toBe('ochre');
  });

  it('makes a share code once and keeps it', () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v); } };
    const first = shareRef(storage, () => 0.5);
    expect(first).toMatch(/^[a-z0-9]{8}$/);
    expect(shareRef(storage, () => 0.1)).toBe(first);
    expect(shareRef(undefined, () => 0.99)).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe('share card stats', () => {
  it('tallies my kills, deaths, headshots, knife kills and best round', () => {
    const t = new MatchTally();
    t.kill({ killer: 1, victim: 2, weapon: 'm4a1', head: true }, 1);
    t.kill({ killer: 1, victim: 3, weapon: 'knife', head: false }, 1);
    t.kill({ killer: 4, victim: 1, weapon: 'mp5', head: false }, 1);
    t.round();
    t.kill({ killer: 1, victim: 5, weapon: 'm4a1', head: false }, 1);
    t.kill({ killer: 6, victim: 7, weapon: 'm4a1', head: true }, 1); // not mine
    t.kill({ killer: 1, victim: 1, weapon: 'm67', head: false }, 1);  // my own grenade
    expect({ k: t.kills, d: t.deaths, hs: t.headshots, knife: t.knifeKills, best: t.bestRound }).toEqual({ k: 3, d: 2, hs: 1, knife: 1, best: 2 });
  });

  const base: MatchSummary = { name: 'Raven', mapId: 'taipei', mode: 'elimination', teamSize: 6, solo: false, result: 'loss', score: [3, 6], kills: 0, deaths: 5, headshots: 0, knifeKills: 0, bestRound: 0 };
  const normalDay = new Date('2026-11-20T12:00:00Z');

  it('brags about the best thing, best first', () => {
    expect(bragLine({ ...base, rival: { name: 'Ace', beaten: true }, knifeKills: 3 }, normalDay)).toEqual({ key: 'beat', name: 'Ace' });
    expect(bragLine({ ...base, knifeKills: 3, bestRound: 4 }, normalDay)).toEqual({ key: 'slipperMulti', n: 3 });
    expect(bragLine({ ...base, kills: 12, bestRound: 3 }, normalDay)).toEqual({ key: 'round', n: 3 });
    expect(bragLine({ ...base, kills: 23 }, normalDay)).toEqual({ key: 'kills', n: 23 });
    expect(bragLine({ ...base, kills: 23 }, new Date('2026-10-10T13:00:00Z'))).toEqual({ key: 'holiday', n: 23 });
    expect(bragLine({ ...base, kills: 4, knifeKills: 1 }, normalDay)).toEqual({ key: 'slipper' });
    expect(bragLine({ ...base, kills: 6, headshots: 5 }, normalDay)).toEqual({ key: 'heads', n: 5 });
    expect(bragLine({ ...base, kills: 2, rival: { name: 'Ace', beaten: false } }, normalDay)).toEqual({ key: 'lostTo', name: 'Ace' });
    expect(bragLine({ ...base, kills: 4 }, normalDay)).toEqual({ key: 'kills', n: 4 });
    expect(bragLine({ ...base, result: 'win', kills: 1 }, normalDay)).toEqual({ key: 'win' });
    expect(bragLine({ ...base, kills: 1 }, normalDay)).toEqual({ key: 'someKills', n: 1 });
    expect(bragLine(base, normalDay)).toEqual({ key: 'wrecked' });
  });

  it('knows the National Day long weekend in Taipei time', () => {
    expect(nationalDay(new Date('2026-10-08T17:00:00Z'))).toBe(true);  // 10/9 01:00 in Taipei
    expect(nationalDay(new Date('2026-10-08T15:00:00Z'))).toBe(false); // 10/8 23:00 in Taipei
    expect(nationalDay(new Date('2026-10-12T15:59:00Z'))).toBe(true);
    expect(nationalDay(new Date('2026-10-12T16:00:00Z'))).toBe(false);
  });
});
