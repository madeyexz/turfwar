// Development-only helpers for the soldier/viewmodel previews: parse and cycle weapons and attachments.
import { ATTACHMENTS, ATTACHMENT_IDS, WEAPON_IDS, fitsWeapon, type AttachmentCategory, type AttachmentId, type Attachments, type WeaponId } from '../shared/weapons';

/** `?att=acog,laser,extendedClip` → attachments (unknown or unfitting ids are ignored). */
export function parseAttachments(weapon: WeaponId, text: string | null): Attachments {
  const out: Attachments = {};
  for (const id of (text ?? '').split(',').filter(Boolean) as AttachmentId[]) {
    const a = ATTACHMENTS[id];
    if (a && fitsWeapon(a, weapon)) out[a.category] = id;
  }
  return out;
}

/** Next fitting attachment in `category` (cycling through "none"). */
export function cycle(weapon: WeaponId, att: Attachments, category: AttachmentCategory): Attachments {
  const options: (AttachmentId | undefined)[] = [undefined, ...ATTACHMENT_IDS.filter(id => ATTACHMENTS[id].category === category && fitsWeapon(ATTACHMENTS[id], weapon))];
  const next = options[(options.indexOf(att[category]) + 1) % options.length];
  const out = { ...att };
  if (next) out[category] = next; else delete out[category];
  return out;
}

/** Keys: 1–8 weapon, O optic, T tactical, M mod, A ammo, X clear. Returns the new state, or undefined for other keys. */
export function gearKey(e: KeyboardEvent, weapon: WeaponId, att: Attachments): { weapon: WeaponId; att: Attachments } | undefined {
  const n = Number(e.key);
  if (n >= 1 && n <= WEAPON_IDS.length) return { weapon: WEAPON_IDS[n - 1], att: {} };
  const category = ({ o: 'optic', t: 'tactical', m: 'mod', a: 'ammo' } as Record<string, AttachmentCategory>)[e.key.toLowerCase()];
  if (category) return { weapon, att: cycle(weapon, att, category) };
  if (e.key.toLowerCase() === 'x') return { weapon, att: {} };
  return undefined;
}

export const describe = (weapon: WeaponId, att: Attachments) => `${weapon}  ${Object.values(att).join(' + ') || 'no attachments'}`;
export const KEYS = '1-8 weapon · O optic · T tactical · M mod · A ammo · X clear';
