import type { WeaponDef } from '../../shared/weapons';

/** How magnified optics (ACOG, x4, x6) are seen while aiming: through the 3D lens (picture-in-picture) or a full-screen eyepiece. */
export type ScopeMode = 'pip' | 'overlay';
/** Colour of illuminated reticles (red dot, holographic sight, ACOG chevron, scope centre dot). */
export type ReticleColor = 'red' | 'green' | 'amber' | 'white';
/** Red dot / holographic reticle: 'stock' is each sight's own (dot for the red dot, circle-dot for the holo). */
export type ReticleStyle = 'stock' | 'dot' | 'circle' | 'chevron' | 'cross';
/** Optic modelling and scope render-target resolution. */
export type OpticDetail = 'high' | 'low';

export const SCOPE_MODES: ScopeMode[] = ['pip', 'overlay'];
export const RETICLE_COLORS: ReticleColor[] = ['red', 'green', 'amber', 'white'];
export const RETICLE_STYLES: ReticleStyle[] = ['stock', 'dot', 'circle', 'chevron', 'cross'];
export const OPTIC_DETAILS: OpticDetail[] = ['high', 'low'];

/** Saved under `lawbreaker.<key>` (the deploy screen writes them; storage may be disabled). */
const saved = <T extends string>(key: string, options: readonly T[], fallback: T): T => {
  try { const v = localStorage.getItem(`lawbreaker.${key}`) as T | null; return v && options.includes(v) ? v : fallback; } catch { return fallback; }
};

/** Player settings shared by every match (set on the deploy screen, saved per browser). */
export const settings = {
  fov: 78, sensitivity: 1,
  scopeMode: saved<ScopeMode>('scopeMode', SCOPE_MODES, 'pip'),
  reticleColor: saved<ReticleColor>('reticleColor', RETICLE_COLORS, 'red'),
  reticleStyle: saved<ReticleStyle>('reticleStyle', RETICLE_STYLES, 'stock'),
  opticDetail: saved<OpticDetail>('opticDetail', OPTIC_DETAILS, 'high'),
};

const DEG = Math.PI / 180;
/** Optics seen through a magnifying lens (picture-in-picture or full-screen eyepiece). */
export const isMagnified = (w: WeaponDef) => { const o = w.attachments.optic; return o === 'acog' || o === 'x4' || o === 'x6'; };

/** Field of view at a magnification of the base field of view. */
const fovAt = (magnification: number) => 2 * Math.atan(Math.tan(settings.fov * DEG / 2) / magnification) / DEG;
/** The weapon's full zoom (optic included), as a field of view: what the optic itself shows. */
export const opticFov = (w: WeaponDef) => fovAt(1 / w.zoom);

/**
 * Aim-down-sights field of view of the world camera, always narrower than the base FOV. Iron sights,
 * red dots and holo sights zoom the whole view; a picture-in-picture scope keeps the view around the
 * lens at a mild zoom (the square root of the optic's magnification) and magnifies only through it.
 */
export const adsFov = (w: WeaponDef) => {
  // Through the lens: the view around the scope zooms only slightly, so it stays easy to track targets.
  return settings.scopeMode === 'pip' && isMagnified(w) ? fovAt(1.2) : opticFov(w);
};

/** Binoculars (Z): BeGone's 10× zoom. */
export const BINOCULAR_ZOOM = 10;
