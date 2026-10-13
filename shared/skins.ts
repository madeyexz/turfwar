/**
 * Cosmetic skins: how a soldier looks, never how it plays. Each player picks them in the lobby (saved
 * per browser, src/game/skins.ts); online the server keeps the choice on the soldier (the `set_skin`
 * reducer, applied by the tick) and every client draws it. Bots wear one picked from their id.
 *
 * - `knife`: what the knife slot looks like. The weapon id, stats and rules (strike, throw, pick-up)
 *   are the knife's whatever the skin: 藍白拖 (the default), 掃把 (a broom) or the classic knife.
 * - `look`: which street character a Militia soldier is ('auto' rotates them as before). SWAT keep
 *   their one operator so the sides stay easy to tell apart.
 */

export const KNIFE_SKINS = ['slipper', 'broom', 'knife'] as const;
export type KnifeSkin = (typeof KNIFE_SKINS)[number];

/** The Militia's street characters (node names in public/assets/soldiers.glb), in rotation order. */
export const MILITIA_LOOKS = ['farmer', 'punk', 'worker', 'adventurer', 'casual', 'hoodie'] as const;
export type MilitiaLook = (typeof MILITIA_LOOKS)[number];
export type Look = 'auto' | MilitiaLook;
export const LOOKS: readonly Look[] = ['auto', ...MILITIA_LOOKS];

export interface Skin { knife: KnifeSkin; look: Look }

export const DEFAULT_SKIN: Skin = { knife: 'slipper', look: 'auto' };

/** A skin from untrusted input (a reducer argument, stored JSON, localStorage): unknown parts fall back to the defaults. */
export function cleanSkin(raw: unknown): Skin {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    knife: KNIFE_SKINS.includes(r.knife as KnifeSkin) ? r.knife as KnifeSkin : DEFAULT_SKIN.knife,
    look: LOOKS.includes(r.look as Look) ? r.look as Look : DEFAULT_SKIN.look,
  };
}

export const isDefaultSkin = (s: Skin) => s.knife === DEFAULT_SKIN.knife && s.look === DEFAULT_SKIN.look;

/** A bot's skin, fixed by its id: mostly slippers, some brooms, a few knives. */
export function botSkin(id: number): Skin {
  const roll = (Math.imul(id, 2654435761) >>> 0) % 10;
  return { knife: roll < 5 ? 'slipper' : roll < 8 ? 'broom' : 'knife', look: 'auto' };
}

/** What a soldier wears: its chosen skin, a bot's from its id, otherwise the defaults. */
export const skinOf = (s: { id: number; bot: boolean; skin?: Skin }): Skin => s.skin ?? (s.bot ? botSkin(s.id) : DEFAULT_SKIN);
