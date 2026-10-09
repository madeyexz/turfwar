import { describe, expect, it } from 'vitest';
import { classicRequested, memeSkinsOn } from './memeskins';
import { MEME_NAMES, withMemeNames } from '../ui/i18n';

describe('National Day reskins', () => {
  it('are on by default and off with ?classic=1', () => {
    expect(memeSkinsOn(undefined)).toBe(true);             // no page (tests, workers)
    expect(memeSkinsOn('')).toBe(true);
    expect(memeSkinsOn('?lang=zh&touch=1')).toBe(true);
    expect(memeSkinsOn('?classic=1')).toBe(false);
    expect(memeSkinsOn('?mode=offline&classic=true&map=taipei')).toBe(false);
    expect(memeSkinsOn('?classic=0')).toBe(true);
    expect(memeSkinsOn('?notclassic=1')).toBe(true);
    expect(memeSkinsOn('', false)).toBe(false);            // the one-line switch
    expect(classicRequested('?a=1&classic=yes')).toBe(true);
  });

  it('rename the knife and the M18 everywhere they are named', () => {
    const on = withMemeNames(true), off = withMemeNames(false);
    expect(on['zh-TW']['cause.knife']).toBe('藍白拖');      // kill feed
    expect(on['zh-TW']['store.knife']).toBe('藍白拖');      // store
    expect(on['zh-TW']['item.smoke']).toBe('珍奶煙霧彈');
    expect(on.en['cause.knife']).toBe('Slipper');
    expect(on.en['item.smoke']).toBe('Boba Smoke');
    expect(off['zh-TW']['cause.knife']).toBe('刀');
    expect(off.en['item.smoke']).toBe('M18');
    expect(off.en['act.knife']).toBe('Knife');
    // Only names change, in both languages alike.
    expect(Object.keys(MEME_NAMES.en).sort()).toEqual(Object.keys(MEME_NAMES['zh-TW']).sort());
    for (const k of Object.keys(on.en)) if (!(k in MEME_NAMES.en)) expect(on.en[k as keyof typeof on.en]).toBe(off.en[k as keyof typeof off.en]);
  });
});
