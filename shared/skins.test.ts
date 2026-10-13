import { describe, expect, it } from 'vitest';
import { botSkin, cleanSkin, DEFAULT_SKIN, KNIFE_SKINS, skinOf } from './skins';
import { addSoldier, createContext, createMatch, setSkin } from './match/sim';
import { ELIMINATION } from './match/state';
import { rng } from './math';

describe('skins', () => {
  it('clean untrusted input to known parts', () => {
    expect(cleanSkin({ knife: 'broom', look: 'hoodie' })).toEqual({ knife: 'broom', look: 'hoodie' });
    expect(cleanSkin({ knife: 'rpg', look: 'Swat' })).toEqual(DEFAULT_SKIN);
    expect(cleanSkin(undefined)).toEqual(DEFAULT_SKIN);
    expect(cleanSkin('broom')).toEqual(DEFAULT_SKIN);
    expect(cleanSkin({ knife: 'knife', extra: 'x'.repeat(10000) })).toEqual({ knife: 'knife', look: 'auto' });
  });

  it('give bots a fixed mix of knife skins', () => {
    expect(botSkin(7)).toEqual(botSkin(7));
    const seen = new Set(Array.from({ length: 60 }, (_, i) => botSkin(i + 1).knife));
    expect([...seen].sort()).toEqual([...KNIFE_SKINS].sort());
    expect(skinOf({ id: 3, bot: false })).toEqual(DEFAULT_SKIN);
    expect(skinOf({ id: 3, bot: true })).toEqual(botSkin(3));
    expect(skinOf({ id: 3, bot: true, skin: { knife: 'knife', look: 'punk' } })).toEqual({ knife: 'knife', look: 'punk' });
  });

  it('are worn through the shared rules: cleaned, cosmetic only, defaults stored as nothing', () => {
    const ctx = createContext('crane', rng(1), () => undefined);
    const state = createMatch('crane', ELIMINATION);
    const s = addSoldier(state, ctx, { name: 'me', bot: false });
    const before = JSON.stringify({ ...s, skin: undefined });
    expect(setSkin(state, s.id, { knife: 'broom', look: 'punk' })).toBe(true);
    expect(s.skin).toEqual({ knife: 'broom', look: 'punk' });
    expect(JSON.stringify({ ...s, skin: undefined })).toBe(before);
    setSkin(state, s.id, { knife: 'slipper', look: 'auto' });
    expect('skin' in s).toBe(false);
    setSkin(state, s.id, { knife: '<script>', look: 42 });
    expect('skin' in s).toBe(false);
    expect(setSkin(state, 999, { knife: 'broom' })).toBe(false);
  });
});
