import type { Soldier } from '../../shared/match/state';
import type { BuyItem } from '../../shared/match/economy';
import { ATTACHMENTS, GRENADE, HIGH_EXPLOSIVE, WEAPONS, attachmentPrice, type AttachmentId, type WeaponId } from '../../shared/weapons';

/**
 * Store purchases for analytics, counted only once the host has applied them (the store's buttons
 * only ask; the server may refuse). A request snapshots what we owned; a later state that shows the
 * item newly owned is the purchase.
 */
export type BuyRequest = { kind: 'item'; item: BuyItem } | { kind: 'attach'; weapon: WeaponId; attachment: AttachmentId };

/** What a request needs to compare against: copied, because Solo mutates its soldiers in place. */
export interface Owned { owned: WeaponId[]; grenades: number; grenadeHE: boolean; attachments: Partial<Record<WeaponId, Record<string, string | undefined>>> }
export const ownedOf = (s: Soldier): Owned => ({
  owned: [...s.owned], grenades: s.grenades, grenadeHE: s.grenadeHE,
  attachments: Object.fromEntries(Object.entries(s.attachments).map(([w, a]) => [w, { ...a }])),
});

/** The purchase `req` made, comparing before and after; undefined while it has not (yet) happened. Re-equipping an owned gun is free and not a purchase. */
export function purchaseOf(req: BuyRequest, before: Owned, after: Owned, free: boolean): { item: string; price: number } | undefined {
  const priced = (item: string, price: number) => ({ item, price: free ? 0 : price });
  if (req.kind === 'attach') {
    const a = ATTACHMENTS[req.attachment];
    if (!a || a.id === 'irons') return undefined;
    const was = before.attachments[req.weapon]?.[a.category], now = after.attachments[req.weapon]?.[a.category];
    return was !== req.attachment && now === req.attachment ? priced(`${req.weapon}:${req.attachment}`, attachmentPrice(a, req.weapon)) : undefined;
  }
  if (req.item === 'grenade') return after.grenades > before.grenades ? priced('grenade', GRENADE.price) : undefined;
  if (req.item === 'highExplosive') return !before.grenadeHE && after.grenadeHE ? priced('highExplosive', HIGH_EXPLOSIVE.price) : undefined;
  const w = WEAPONS[req.item];
  return w && !before.owned.includes(req.item) && after.owned.includes(req.item) ? priced(req.item, w.price) : undefined;
}
