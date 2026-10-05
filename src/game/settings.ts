import type { WeaponDef } from '../../shared/weapons';

/** Player settings shared by every match (set on the deploy screen, saved per browser). */
export const settings = { fov: 78, sensitivity: 1 };

/** Aim-down-sights field of view: the weapon's zoom (optic included), always narrower than the base FOV. */
export const adsFov = (w: WeaponDef) => Math.min(settings.fov * w.zoom, settings.fov * 0.85);

/** Binoculars (Z): BeGone's 10× zoom. */
export const BINOCULAR_ZOOM = 10;
