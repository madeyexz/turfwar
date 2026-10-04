import type { WeaponDef } from '../../shared/weapons';

/** Player settings shared by every match (set on the deploy screen, saved per browser). */
export const settings = { fov: 78, sensitivity: 1 };

/** Aim-down-sights field of view: the weapon's zoom, but always narrower than the chosen base FOV. */
export const adsFov = (w: WeaponDef) => Math.min(w.adsFov, settings.fov * 0.85);
