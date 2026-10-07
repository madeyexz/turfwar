/**
 * BeGone's arsenal, from nplay's Weapons.json and Attachments.json (archived 2015): the exact
 * damage, fire rate, magazines, reload/equip times, accuracy, recoil, zoom FOV, movement speed and
 * prices. One documented mapping (see `derive`) turns BeGone's accuracy/recoil/zoom stats into this
 * engine's spread cones, view kick and ADS field of view, so client feel, bots and server
 * validation all read the same numbers.
 */
import type { Vec3 } from './math';

export type WeaponId = 'knife' | 'mp5' | 'm4a1' | 'm1014' | 'm110' | 'm249' | 'm9a1' | 'mp7';
/** Inventory slot: 0 primary, 1 secondary, 2 melee. The M67 grenade is a separate tactical item. */
export type Slot = 0 | 1 | 2;
export type WeaponClass = 'melee' | 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'lmg';
export type HitZone = 'head' | 'body' | 'legs';

/** BeGone's raw per-weapon attributes. */
interface Base {
  id: WeaponId; name: string; model: string; slot: Slot; class: WeaponClass; price: number; auto: boolean;
  /** Shots per second. */
  rate: number;
  damage: { head: number; body: number; limb: number };
  /** 0–100; higher is tighter. */
  accuracy: { hip: number; zoom: number };
  recoil: { hip: number; zoom: number };
  magazine: number; reserve: number; restock: number; reload: number;
  /** Seconds to bring the weapon up / put it away. */
  equip: number; unequip: number;
  /** BeGone camera FOV while zoomed (base 70 = no zoom). */
  zoomFov: number;
  /** Movement speed in percent of the base run speed. */
  move: number;
  pellets?: number;
  /** Melee reach in metres (knife only). */
  reach?: number;
  /** Preferred fighting distance for bots (ours). */
  botRange: number;
  /** Muzzle velocity (m/s): what tracers show (hits are instant, hitscan). */
  velocity: number;
}

const BASE: Record<WeaponId, Base> = {
  knife: { id: 'knife', name: 'Knife', model: 'Gun_Knife', slot: 2, class: 'melee', price: 0, auto: true, rate: 2, damage: { head: 33, body: 33, limb: 33 }, accuracy: { hip: 100, zoom: 100 }, recoil: { hip: 0, zoom: 0 }, magazine: 0, reserve: 0, restock: 0, reload: 0, equip: 0.3, unequip: 0.3, zoomFov: 70, move: 110, reach: 2.2, botRange: 1.5, velocity: 0 },
  mp5: { id: 'mp5', name: 'MP5', model: 'Gun_MP5', slot: 0, class: 'smg', price: 0, auto: true, rate: 12, damage: { head: 30, body: 18, limb: 12 }, accuracy: { hip: 91, zoom: 94 }, recoil: { hip: 3, zoom: 1.5 }, magazine: 32, reserve: 96, restock: 16, reload: 3.1, equip: 0.6, unequip: 0.4, zoomFov: 20, move: 105, botRange: 14, velocity: 400 },
  m4a1: { id: 'm4a1', name: 'M4A1', model: 'Gun_M4A1', slot: 0, class: 'rifle', price: 3400, auto: true, rate: 9, damage: { head: 33, body: 21, limb: 15 }, accuracy: { hip: 92, zoom: 95 }, recoil: { hip: 2.5, zoom: 1.2 }, magazine: 30, reserve: 90, restock: 15, reload: 3.1, equip: 0.7, unequip: 0.5, zoomFov: 20, move: 100, botRange: 22, velocity: 910 },
  m1014: { id: 'm1014', name: 'M1014', model: 'Gun_M1014', slot: 0, class: 'shotgun', price: 2800, auto: false, rate: 1.5, damage: { head: 24, body: 10, limb: 8 }, accuracy: { hip: 30, zoom: 40 }, recoil: { hip: 35, zoom: 25 }, magazine: 6, reserve: 18, restock: 3, reload: 2.5, equip: 0.7, unequip: 0.5, zoomFov: 20, move: 102, pellets: 14, botRange: 7, velocity: 400 },
  m110: { id: 'm110', name: 'M110', model: 'Gun_M110', slot: 0, class: 'sniper', price: 4000, auto: false, rate: 1.6, damage: { head: 90, body: 40, limb: 30 }, accuracy: { hip: 90, zoom: 98 }, recoil: { hip: 6, zoom: 2 }, magazine: 6, reserve: 18, restock: 3, reload: 3.1, equip: 0.7, unequip: 0.5, zoomFov: 20, move: 100, botRange: 40, velocity: 790 },
  m249: { id: 'm249', name: 'M249', model: 'Gun_M249', slot: 0, class: 'lmg', price: 3800, auto: true, rate: 9, damage: { head: 43, body: 33, limb: 21 }, accuracy: { hip: 86, zoom: 91 }, recoil: { hip: 4, zoom: 2 }, magazine: 86, reserve: 86, restock: 43, reload: 4, equip: 1.2, unequip: 1, zoomFov: 20, move: 90, botRange: 20, velocity: 915 },
  m9a1: { id: 'm9a1', name: 'M9A1', model: 'Gun_M9A1', slot: 1, class: 'pistol', price: 0, auto: false, rate: 13, damage: { head: 29, body: 22, limb: 15 }, accuracy: { hip: 93, zoom: 96 }, recoil: { hip: 3.5, zoom: 1.7 }, magazine: 12, reserve: 36, restock: 6, reload: 3.1, equip: 0.5, unequip: 0.4, zoomFov: 20, move: 107, botRange: 14, velocity: 375 },
  mp7: { id: 'mp7', name: 'MP7', model: 'Gun_MP7', slot: 1, class: 'smg', price: 1800, auto: true, rate: 13, damage: { head: 18, body: 12, limb: 8 }, accuracy: { hip: 93, zoom: 96 }, recoil: { hip: 2.4, zoom: 1.3 }, magazine: 20, reserve: 60, restock: 10, reload: 2.4, equip: 0.5, unequip: 0.4, zoomFov: 20, move: 102, botRange: 12, velocity: 735 },
};

export const WEAPON_IDS = Object.keys(BASE) as WeaponId[];
/** What every soldier carries at the start of a match: MP5, M9A1 and the knife. */
export const DEFAULT_WEAPONS: [WeaponId, WeaponId] = ['mp5', 'm9a1'];

// ---- Attachments ---------------------------------------------------------------------------

/** Where an attachment mounts: one item per slot, so gadgets in different slots stack on one gun. */
export type AttachmentCategory = 'optic' | 'muzzle' | 'laser' | 'light' | 'counter' | 'magazine' | 'stock' | 'ammo';
/** Store grouping (BeGone's four attachment categories). */
export type AttachmentGroup = 'optic' | 'tactical' | 'mod' | 'ammo';
export const ATTACHMENT_SLOTS: AttachmentCategory[] = ['optic', 'muzzle', 'laser', 'light', 'counter', 'magazine', 'stock', 'ammo'];
export const groupOf = (c: AttachmentCategory): AttachmentGroup =>
  c === 'optic' || c === 'ammo' ? c : c === 'magazine' || c === 'stock' ? 'mod' : 'tactical';
export type AttachmentId =
  | 'irons' | 'reflex' | 'holo' | 'acog' | 'x4' | 'x6'
  | 'ammoCounter' | 'laser' | 'flashlight' | 'suppressor'
  | 'extendedClip' | 'recoilPad'
  | 'explosiveAmmo' | 'incendiaryAmmo';

/** Additive stat changes; `per` overrides by weapon id or class (BeGone's CustomAttributes). */
interface Delta {
  zoomFov?: number; zoomAccuracy?: number; accuracy?: number; recoil?: number; zoomRecoil?: number; move?: number;
  magazine?: number; head?: number; body?: number; limb?: number;
}
export interface AttachmentDef {
  id: AttachmentId; name: string; category: AttachmentCategory; price: number; delta: Delta;
  per?: Partial<Record<WeaponId | WeaponClass, Delta & { price?: number }>>;
  /** Weapons that accept it (default: every firearm). */
  only?: WeaponId[]; not?: WeaponId[];
}

export const ATTACHMENTS: Record<AttachmentId, AttachmentDef> = {
  irons: { id: 'irons', name: 'Iron Sight', category: 'optic', price: 0, delta: { zoomAccuracy: 1 } },
  reflex: { id: 'reflex', name: 'Reflex Sight', category: 'optic', price: 800, delta: { zoomFov: -2, zoomAccuracy: 1.5, move: -1 }, per: { sniper: { zoomAccuracy: 1.4 } } },
  holo: { id: 'holo', name: 'Holographic Sight', category: 'optic', price: 1000, delta: { zoomFov: -4, zoomAccuracy: 2, move: -1 }, per: { sniper: { zoomAccuracy: 1.6 } } },
  acog: { id: 'acog', name: 'ACOG Scope', category: 'optic', price: 1100, delta: { zoomFov: -8, zoomAccuracy: 2.5, move: -1 }, per: { sniper: { zoomAccuracy: 1.8 }, mp5: { zoomRecoil: -0.3 } }, not: ['m9a1'] },
  x4: { id: 'x4', name: 'Zoom x4 Scope', category: 'optic', price: 600, delta: { zoomFov: -10, zoomAccuracy: 3, move: -1 }, only: ['m9a1'] },
  x6: { id: 'x6', name: 'Zoom x6 Scope', category: 'optic', price: 1200, delta: { zoomFov: -12, zoomAccuracy: 2, move: -2 }, only: ['m110'] },
  ammoCounter: { id: 'ammoCounter', name: 'Ammo Counter', category: 'counter', price: 200, delta: {} },
  laser: { id: 'laser', name: 'Laser Sight', category: 'laser', price: 800, delta: { accuracy: 1.5 } },
  flashlight: { id: 'flashlight', name: 'Flashlight', category: 'light', price: 600, delta: { recoil: 2, zoomRecoil: 1 } },
  suppressor: {
    id: 'suppressor', name: 'Suppressor', category: 'muzzle', price: 1100, delta: { recoil: -1, zoomRecoil: -0.5, head: -4, body: -4, limb: -4 },
    per: { mp7: { price: 1000, recoil: -0.5, zoomRecoil: -0.25, head: -2, body: -2, limb: -2 }, m9a1: { price: 600, recoil: -0.5, zoomRecoil: -0.25, head: -3, body: -3, limb: -3 } },
  },
  extendedClip: { id: 'extendedClip', name: 'Extended Clip', category: 'magazine', price: 900, delta: { magazine: 5, recoil: 0.5, move: -3 }, per: { sniper: { magazine: 1 }, shotgun: { magazine: 2 }, lmg: { magazine: 12 } } },
  recoilPad: { id: 'recoilPad', name: 'Recoil Pad', category: 'stock', price: 1200, delta: { recoil: -1, zoomRecoil: -0.5, move: -2 }, per: { shotgun: { recoil: -10, zoomRecoil: -5 } } },
  explosiveAmmo: {
    id: 'explosiveAmmo', name: 'Explosive Ammo', category: 'ammo', price: 1600, delta: { head: 10, body: 3, limb: 3, magazine: -5, recoil: 1, zoomRecoil: 0.5 },
    per: { sniper: { magazine: -2, head: 15, body: 5, limb: 5 }, shotgun: { magazine: -2, head: 5, body: 2, limb: 2 }, mp5: { magazine: -10 }, m4a1: { magazine: -10 }, lmg: { magazine: -25 } },
  },
  incendiaryAmmo: {
    id: 'incendiaryAmmo', name: 'Incendiary Ammo', category: 'ammo', price: 1400, delta: { head: 3, body: 5, limb: 3, magazine: -5, recoil: 1, zoomRecoil: 0.5 },
    per: { sniper: { magazine: -2, head: 5, body: 7, limb: 5 }, shotgun: { magazine: -2, head: 2, body: 3, limb: 2 }, mp5: { magazine: -10 }, m4a1: { magazine: -10 }, lmg: { magazine: -25 } },
  },
};
export const ATTACHMENT_IDS = Object.keys(ATTACHMENTS) as AttachmentId[];

/** One attachment per slot on a weapon (optics default to iron sights). */
export type Attachments = Partial<Record<AttachmentCategory, AttachmentId>>;

/** Re-slot a saved attachment set (older saves grouped several gadgets under one key). */
export function normalizeAttachments(a: Record<string, string | undefined> = {}): Attachments {
  const out: Attachments = {};
  for (const id of Object.values(a)) if (id && id in ATTACHMENTS) out[ATTACHMENTS[id as AttachmentId].category] = id as AttachmentId;
  return out;
}
const attachKey = (a: Attachments) => ATTACHMENT_SLOTS.map(c => a[c] ?? '').join('|');

export function fitsWeapon(a: AttachmentDef, w: WeaponId) {
  if (w === 'knife') return false;
  if (a.only) return a.only.includes(w);
  return !a.not?.includes(w);
}
export function attachmentPrice(a: AttachmentDef, w: WeaponId) {
  return a.per?.[w]?.price ?? a.per?.[BASE[w].class]?.price ?? a.price;
}

// ---- Effective weapon ------------------------------------------------------------------------

export interface WeaponDef {
  id: WeaponId; name: string; short: string; model: string; slot: Slot; class: WeaponClass; price: number; auto: boolean;
  /** Seconds between shots. */
  interval: number;
  magazine: number; reserve: number; restock: number; reload: number; equipTime: number; unequipTime: number;
  damage: { head: number; body: number; limb: number };
  pellets: number;
  /** Hitscan reach (melee: the knife's reach). */
  range: number;
  /** Movement speed multiplier (1 = base run speed). */
  speed: number;
  /** Camera FOV ratio while aiming (1 = no zoom): our ADS FOV = settings FOV × zoom. */
  zoom: number;
  /** Cone half-angles in degrees. */
  spread: { hip: number; ads: number; moving: number; air: number; bloomPerShot: number; bloomMax: number; recovery: number };
  /** View kick per shot (degrees) and how quickly the camera settles. */
  recoil: { pitch: number; adsPitch: number; yaw: number; pattern: number[]; recover: number; viewPunch: number };
  adsTime: number;
  botRange: number;
  /** Muzzle velocity (m/s, real-world figure); tracers fly at a scaled-down speed so they read on screen. Hits stay hitscan. */
  velocity: number;
  /** Attachments fitted (for visuals and the HUD). */
  attachments: Attachments;
  /** Suppressed: no tracer or muzzle flash for others. */
  suppressed: boolean;
}

/**
 * Aiming magnification. BeGone's zoom-FOV numbers read as a 3.5× zoom even on iron sights, which hides
 * most of the screen; here iron sights barely zoom, red dot and holo a little more, and the scopes
 * keep their marked power (seen through the lens; the view around it zooms only slightly).
 */
const MAGNIFICATION: Record<string, number> = { reflex: 1.45, holo: 1.6, acog: 4, x4: 4, x6: 6 };
const IRONS: Partial<Record<WeaponClass, number>> = { pistol: 1.15, sniper: 1.5 };
export const magnification = (c: WeaponClass, optic?: AttachmentId) =>
  !optic || optic === 'irons' ? IRONS[c] ?? 1.3 : MAGNIFICATION[optic] ?? 1.3;

/** The documented mapping from BeGone's stats to this engine's feel (see SPEC). */
function derive(b: Base, d: Required<Delta>, attachments: Attachments): WeaponDef {
  const acc = Math.min(100, b.accuracy.hip + d.accuracy), zacc = Math.min(100, b.accuracy.zoom + d.zoomAccuracy);
  const kick = Math.max(0, b.recoil.hip + d.recoil), zkick = Math.max(0, b.recoil.zoom + d.zoomRecoil);
  const melee = b.class === 'melee';
  return {
    id: b.id, name: b.name, short: b.name, model: b.model, slot: b.slot, class: b.class, price: b.price, auto: b.auto,
    interval: 1 / b.rate,
    magazine: melee ? 0 : Math.max(1, b.magazine + d.magazine), reserve: b.reserve, restock: b.restock, reload: b.reload,
    equipTime: b.equip, unequipTime: b.unequip,
    damage: { head: Math.max(1, b.damage.head + d.head), body: Math.max(1, b.damage.body + d.body), limb: Math.max(1, b.damage.limb + d.limb) },
    pellets: b.pellets ?? 1,
    range: b.reach ?? (b.class === 'shotgun' ? 60 : b.class === 'sniper' ? 300 : 200),
    speed: Math.max(0.5, (b.move + d.move) / 100),
    zoom: melee ? 1 : 1 / magnification(b.class, attachments.optic),
    spread: {
      // Shotguns: BeGone's low accuracy numbers made a 25° pellet cone; ~3° (2° aimed) keeps them deadly up close.
      hip: (100 - acc) * (b.class === 'shotgun' ? 0.045 : 0.35), ads: (100 - zacc) * (b.class === 'shotgun' ? 0.035 : 0.25),
      moving: melee ? 0 : 1.2, air: melee ? 0 : 3,
      bloomPerShot: b.auto ? kick * 0.08 : kick * 0.15, bloomMax: kick * 0.8, recovery: 7,
    },
    recoil: { pitch: kick * 0.45, adsPitch: zkick * 0.45, yaw: kick * 0.2, pattern: [0.3, -0.35, 0.25, -0.2, 0.4, -0.15], recover: 8, viewPunch: Math.min(4, kick * 0.35) },
    adsTime: melee ? 0.1 : b.class === 'lmg' ? 0.28 : b.class === 'sniper' ? 0.24 : b.class === 'pistol' ? 0.14 : 0.18,
    botRange: b.botRange, velocity: b.velocity,
    attachments, suppressed: attachments.muzzle === 'suppressor',
  };
}

const cache = new Map<string, WeaponDef>();
const ZERO: Required<Delta> = { zoomFov: 0, zoomAccuracy: 0, accuracy: 0, recoil: 0, zoomRecoil: 0, move: 0, magazine: 0, head: 0, body: 0, limb: 0 };

/** One-handed weapons (pistols and SMGs): what a scooter rider can fire while steering with the other hand. */
export const oneHanded = (w: Pick<WeaponDef, 'class'>) => w.class === 'pistol' || w.class === 'smg';

/** Firing from a moving scooter: extra spread (degrees, added to the cone) and heavier one-handed recoil. */
export const RIDER_AIM = { spread: 1.6, recoil: 1.3 };

/** Stats of `id` with its fitted attachments (cached). Iron sights count when no optic is fitted. */
export function weaponStats(id: WeaponId, attachments: Attachments = {}): WeaponDef {
  const key = `${id}|${attachKey(attachments)}`;
  let w = cache.get(key);
  if (w) return w;
  const b = BASE[id];
  const d = { ...ZERO };
  const fitted = { ...attachments };
  if (b.class !== 'melee') fitted.optic ??= 'irons';
  for (const aid of Object.values(fitted)) {
    if (!aid) continue;
    const a = ATTACHMENTS[aid];
    if (!fitsWeapon(a, id)) continue;
    // A per-weapon or per-class entry replaces the matching general values.
    const over = { ...a.per?.[b.class], ...a.per?.[id] };
    for (const k of Object.keys(ZERO) as (keyof Delta)[]) d[k] += (over[k] ?? a.delta[k] ?? 0);
  }
  w = derive(b, d, attachments);
  cache.set(key, w);
  return w;
}

/** Plain stats without attachments (buy menu, bots, defaults). */
export const WEAPONS: Record<WeaponId, WeaponDef> = Object.fromEntries(WEAPON_IDS.map(id => [id, weaponStats(id)])) as Record<WeaponId, WeaponDef>;

// ---- Grenade, health, stamina, economy -------------------------------------------------------

/** M67 frag ([WJ]): 70 body damage, 22 m blast radius, 2.1 s fuse, $1000, one carried, not restocked. */
export const GRENADE = { price: 1000, damage: 70, radius: 22, fuse: 2.1, throwSpeed: 28 * 0.75, throwDelay: 1.5, max: 1 };
/** High Explosive mod for the M67: +45 damage, −6 m radius. */
export const HIGH_EXPLOSIVE = { price: 1500, damage: 45, radius: -6 };
/**
 * M18 smoke grenade (not in BeGone; added 2026-10-07): $300, one carried, thrown like the M67. It
 * pops `fuse` s after the throw into a cloud that hides what is in it or behind it for `duration` s:
 * a sphere of `radius` m centred `height` m above where it landed. It blocks sight (bots' too), not bullets.
 */
export const SMOKE = { price: 300, max: 1, fuse: 1.6, duration: 15, radius: 4.5, height: 1.6 };

/** 100 HP, no armor, no regeneration within a round; below `critical` the screen desaturates. */
export const HEALTH = { max: 100, critical: 25 };

/** Stamina ([W:Stamina]): sprinting and jumping spend it; at or below `tired` you cannot sprint. */
export const STAMINA = { max: 100, sprint: 18, sprintStart: 5, jump: 20, regen: 18, regenCrouched: 24, tired: 30 };

/** Fall damage: landing faster than `safe` m/s costs `perMs` health per extra m/s (half of BeGone's 9: falls were too punishing). */
export const FALL = { safe: 11, perMs: 4.5 };

export function zoneDamage(w: WeaponDef, zone: HitZone) {
  return zone === 'head' ? w.damage.head : zone === 'legs' ? w.damage.limb : w.damage.body;
}

/** Pellet cone half-angle (degrees): fixed per stance so client and server derive the same pattern. */
export const pelletCone = (w: WeaponDef, ads: boolean) => ads ? w.spread.ads : w.spread.hip;

/**
 * Fixed pellet pattern around `dir`: one center pellet, an inner ring and an outer ring at the cone
 * edge. Deterministic (no randomness) so the server can re-trace exactly what the client fired.
 */
export function pelletDirs(dir: Vec3, coneDeg: number, count: number): Vec3[] {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const f = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  // Right = f × up (falls back to world X when aiming straight up or down); up = right × f.
  let rx = -f.z, rz = f.x;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-4) { rx = 1; rz = 0; } else { rx /= rl; rz /= rl; }
  const ux = -rz * f.y, uy = rz * f.x - rx * f.z, uz = rx * f.y;
  const out: Vec3[] = [f];
  const inner = Math.floor((count - 1) / 3), outer = count - 1 - inner;
  const ring = (n: number, radius: number, phase: number) => {
    const t = Math.tan(coneDeg * radius * Math.PI / 180);
    for (let i = 0; i < n; i++) {
      const a = phase + i / n * Math.PI * 2, x = Math.cos(a) * t, y = Math.sin(a) * t;
      const d = { x: f.x + rx * x + ux * y, y: f.y + uy * y, z: f.z + rz * x + uz * y };
      const l = Math.hypot(d.x, d.y, d.z);
      out.push({ x: d.x / l, y: d.y / l, z: d.z / l });
    }
  };
  ring(inner, 0.45, Math.PI / 2);
  ring(outer, 1, Math.PI / 2 + Math.PI / outer);
  return out;
}
