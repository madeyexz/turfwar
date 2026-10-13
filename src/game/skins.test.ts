import { describe, expect, it } from 'vitest';
import { classicRequested, knifeIcon, loadSkin } from './skins';
import { KNIFE_NAMES, withKnifeNames } from '../ui/i18n';
import { KNIFE_SKINS } from '../../shared/skins';

describe('this player\'s skin', () => {
  it('loads the saved choice, falls back to the defaults, and ?classic=1 shows the knife', () => {
    expect(loadSkin(null)).toEqual({ knife: 'slipper', look: 'auto' });
    expect(loadSkin('{"knife":"broom","look":"punk"}')).toEqual({ knife: 'broom', look: 'punk' });
    expect(loadSkin('{"knife":"chainsaw","look":"swat"}')).toEqual({ knife: 'slipper', look: 'auto' });
    expect(loadSkin('not json')).toEqual({ knife: 'slipper', look: 'auto' });
    expect(loadSkin('{"knife":"broom","look":"punk"}', '?classic=1')).toEqual({ knife: 'knife', look: 'punk' });
    expect(classicRequested('?mode=offline&classic=true&map=taipei')).toBe(true);
    expect(classicRequested('?classic=0')).toBe(false);
    expect(classicRequested('?notclassic=1')).toBe(false);
  });

  it('names the knife after the skin everywhere it is named; nothing else changes', () => {
    const slipper = withKnifeNames('slipper'), broom = withKnifeNames('broom'), knife = withKnifeNames('knife');
    expect(slipper['zh-TW']['cause.knife']).toBe('藍白拖');
    expect(broom['zh-TW']['cause.knife']).toBe('掃把');
    expect(broom['zh-TW']['store.knife']).toBe('掃把');
    expect(broom.en['act.knife']).toBe('Broom');
    expect(knife['zh-TW']['cause.knife']).toBe('刀');
    expect(knife.en['act.knife']).toBe('Knife');
    expect(broom.en['item.smoke']).toBe('M18');
    for (const skin of KNIFE_SKINS) {
      // Both languages rename the same keys, and only those.
      expect(Object.keys(KNIFE_NAMES[skin].en).sort()).toEqual(Object.keys(KNIFE_NAMES[skin]['zh-TW']).sort());
      const on = withKnifeNames(skin);
      for (const k of Object.keys(on.en)) if (!(k in KNIFE_NAMES[skin].en)) expect(on.en[k as keyof typeof on.en]).toBe(knife.en[k as keyof typeof knife.en]);
    }
  });

  it('marks slipper and broom kills in the kill feed, not knife kills', () => {
    expect(knifeIcon('slipper')).toContain('class="slipper"');
    expect(knifeIcon('broom')).toContain('broom');
    expect(knifeIcon('knife')).toBe('');
  });
});
