import { describe, expect, it } from 'vitest';
import { withUtm } from './utm';

describe('withUtm', () => {
  it('appends the tags after the existing parameters, which keep their values and order', () => {
    expect(withUtm('https://turfwar.ianhsiao.me/?c=1&room=ABCD&ch=Raven&map=taipei&beat=23&ref=k3x9q2ab', { source: 'share', medium: 'end_screen', campaign: 'challenge' }))
      .toBe('https://turfwar.ianhsiao.me/?c=1&room=ABCD&ch=Raven&map=taipei&beat=23&ref=k3x9q2ab&utm_source=share&utm_medium=end_screen&utm_campaign=challenge');
  });

  it('adds a path to a bare origin, and leaves out what is empty', () => {
    expect(withUtm('https://turfwar.ianhsiao.me', { source: 'threads', medium: 'bio', campaign: ' ', content: undefined })).toBe('https://turfwar.ianhsiao.me/?utm_source=threads&utm_medium=bio');
  });

  it('keeps tags the link already has unless told to overwrite', () => {
    const url = 'https://turfwar.ianhsiao.me/?utm_source=line&room=ABCD';
    expect(withUtm(url, { source: 'share', medium: 'dm' })).toBe('https://turfwar.ianhsiao.me/?utm_source=line&room=ABCD&utm_medium=dm');
    expect(withUtm(url, { source: 'share', medium: 'dm' }, true)).toBe('https://turfwar.ianhsiao.me/?utm_source=share&room=ABCD&utm_medium=dm');
  });

  it('keeps the fragment and encodes values', () => {
    expect(withUtm('https://turfwar.ianhsiao.me/#lobby', { source: 'ptt', campaign: 'a b&c' })).toBe('https://turfwar.ianhsiao.me/?utm_source=ptt&utm_campaign=a+b%26c#lobby');
  });

  it('works on relative links', () => {
    expect(withUtm('/?room=ABCD', { source: 'share' })).toBe('/?room=ABCD&utm_source=share');
    expect(withUtm('?room=ABCD', { source: 'share' })).toBe('/?room=ABCD&utm_source=share');
  });
});
