import { describe, expect, it } from 'vitest';
import { cleanHello, HELLO_LANG_MAX, HELLO_TZ_MAX } from './hello';

describe('hello input', () => {
  it('keeps real zones and language tags', () => {
    expect(cleanHello('Asia/Taipei', 'zh-TW')).toEqual({ tz: 'Asia/Taipei', lang: 'zh-TW' });
    expect(cleanHello('America/Argentina/Buenos_Aires', 'zh-Hant-TW')).toEqual({ tz: 'America/Argentina/Buenos_Aires', lang: 'zh-Hant-TW' });
    expect(cleanHello('Etc/GMT+8', 'en')).toEqual({ tz: 'Etc/GMT+8', lang: 'en' });
  });

  it('caps lengths (tz 64, lang 16)', () => {
    const { tz, lang } = cleanHello('A'.repeat(500), 'b'.repeat(500));
    expect(tz).toHaveLength(HELLO_TZ_MAX);
    expect(lang).toHaveLength(HELLO_LANG_MAX);
    expect(HELLO_TZ_MAX).toBe(64);
    expect(HELLO_LANG_MAX).toBe(16);
  });

  it('strips markup, whitespace and control characters', () => {
    expect(cleanHello('  Asia/Taipei\n', ' en-US\u0000')).toEqual({ tz: 'Asia/Taipei', lang: 'en-US' });
    expect(cleanHello('<script>alert(1)</script>', "'; DROP TABLE x;--")).toEqual({ tz: 'scriptalert1/script', lang: 'DROPTABLEx--' });
  });

  it('turns anything that is not a string into empty text', () => {
    expect(cleanHello(undefined, null)).toEqual({ tz: '', lang: '' });
    expect(cleanHello(42, { lang: 'en' })).toEqual({ tz: '', lang: '' });
  });
});
