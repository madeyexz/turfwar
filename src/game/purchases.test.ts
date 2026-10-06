import { describe, expect, it } from 'vitest';
import { GRENADE, WEAPONS } from '../../shared/weapons';
import { purchaseOf, type Owned } from './purchases';

const base: Owned = { owned: ['mp5', 'm9a1'], grenades: 0, grenadeHE: false, attachments: {} };

describe('store purchases for analytics', () => {
  it('counts a gun once the host owns it for us, at its price', () => {
    expect(purchaseOf({ kind: 'item', item: 'm4a1' }, base, base, false)).toBeUndefined();
    expect(purchaseOf({ kind: 'item', item: 'm4a1' }, base, { ...base, owned: [...base.owned, 'm4a1'] }, false)).toEqual({ item: 'm4a1', price: WEAPONS.m4a1.price });
    expect(purchaseOf({ kind: 'item', item: 'm4a1' }, base, { ...base, owned: [...base.owned, 'm4a1'] }, true)).toEqual({ item: 'm4a1', price: 0 });
  });

  it('does not count re-equipping an owned gun', () => {
    expect(purchaseOf({ kind: 'item', item: 'mp5' }, base, base, false)).toBeUndefined();
  });

  it('counts grenades and attachments', () => {
    expect(purchaseOf({ kind: 'item', item: 'grenade' }, base, { ...base, grenades: 1 }, false)).toEqual({ item: 'grenade', price: GRENADE.price });
    expect(purchaseOf({ kind: 'attach', weapon: 'mp5', attachment: 'reflex' }, base, { ...base, attachments: { mp5: { optic: 'reflex' } } }, false)).toEqual({ item: 'mp5:reflex', price: 800 });
    expect(purchaseOf({ kind: 'attach', weapon: 'mp5', attachment: 'irons' }, base, base, false)).toBeUndefined();
  });
});
