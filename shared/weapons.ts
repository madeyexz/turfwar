/** Weapon tuning shared by client feel, bots and server-side damage validation. */
export type WeaponId = 'carbine' | 'lancer' | 'sidearm' | 'magnum';
export type LoadoutId = 'assault' | 'recon';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  short: string;
  model: string;
  auto: boolean;
  /** Seconds between shots. */
  interval: number;
  magazine: number;
  reload: number;
  damage: number;
  headMultiplier: number;
  legMultiplier: number;
  /** Full damage until near, linear to `minDamage` fraction at far. */
  falloff: { near: number; far: number; minDamage: number };
  range: number;
  /** Cone half-angles in degrees. */
  spread: { hip: number; ads: number; moving: number; air: number; bloomPerShot: number; bloomMax: number; recovery: number };
  /** View kick per shot (degrees) and how quickly the camera settles. */
  recoil: { pitch: number; yaw: number; pattern: number[]; recover: number; viewPunch: number };
  adsFov: number;
  adsTime: number;
  equipTime: number;
  movePenalty: number;
  pellets: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  carbine: {
    id: 'carbine', name: 'VX-7 Pulse Carbine', short: 'VX-7', model: 'Gun_Rifle', auto: true,
    interval: 60 / 690, magazine: 30, reload: 1.85, damage: 21, headMultiplier: 1.75, legMultiplier: 0.85,
    falloff: { near: 24, far: 70, minDamage: 0.62 }, range: 260,
    spread: { hip: 2.4, ads: 0.18, moving: 1.6, air: 3.5, bloomPerShot: 0.32, bloomMax: 2.6, recovery: 9 },
    recoil: { pitch: 0.62, yaw: 0.22, pattern: [0.1, 0.25, 0.15, -0.2, -0.35, -0.1, 0.3, 0.4, 0.1, -0.3], recover: 9, viewPunch: 0.9 },
    adsFov: 52, adsTime: 0.16, equipTime: 0.42, movePenalty: 1, pellets: 1,
  },
  lancer: {
    id: 'lancer', name: 'L-90 Lancer Rail Rifle', short: 'L-90', model: 'Gun_Sniper', auto: false,
    interval: 0.95, magazine: 5, reload: 2.6, damage: 92, headMultiplier: 2.0, legMultiplier: 0.75,
    falloff: { near: 60, far: 160, minDamage: 0.8 }, range: 400,
    spread: { hip: 4.5, ads: 0.02, moving: 3, air: 6, bloomPerShot: 0, bloomMax: 0, recovery: 6 },
    recoil: { pitch: 3.4, yaw: 0.6, pattern: [0.3, -0.4, 0.2], recover: 5, viewPunch: 3.2 },
    adsFov: 18, adsTime: 0.3, equipTime: 0.6, movePenalty: 0.88, pellets: 1,
  },
  sidearm: {
    id: 'sidearm', name: 'P-12 Sidearm', short: 'P-12', model: 'Gun_Pistol', auto: false,
    interval: 0.15, magazine: 14, reload: 1.35, damage: 26, headMultiplier: 1.7, legMultiplier: 0.85,
    falloff: { near: 16, far: 45, minDamage: 0.55 }, range: 160,
    spread: { hip: 1.6, ads: 0.3, moving: 1.0, air: 3, bloomPerShot: 0.5, bloomMax: 2, recovery: 10 },
    recoil: { pitch: 1.3, yaw: 0.35, pattern: [0.2, -0.3, 0.1, 0.35], recover: 12, viewPunch: 1.4 },
    adsFov: 62, adsTime: 0.12, equipTime: 0.28, movePenalty: 1.05, pellets: 1,
  },
  magnum: {
    id: 'magnum', name: 'R-6 Magnum', short: 'R-6', model: 'Gun_Revolver', auto: false,
    interval: 0.42, magazine: 6, reload: 2.0, damage: 52, headMultiplier: 1.8, legMultiplier: 0.8,
    falloff: { near: 18, far: 50, minDamage: 0.6 }, range: 180,
    spread: { hip: 1.8, ads: 0.2, moving: 1.2, air: 3, bloomPerShot: 0.9, bloomMax: 2.2, recovery: 7 },
    recoil: { pitch: 3.2, yaw: 0.6, pattern: [0.4, -0.3, 0.25], recover: 8, viewPunch: 2.6 },
    adsFov: 58, adsTime: 0.14, equipTime: 0.32, movePenalty: 1.05, pellets: 1,
  },
};

export const LOADOUTS: Record<LoadoutId, { name: string; role: string; weapons: [WeaponId, WeaponId] }> = {
  assault: { name: 'Assault', role: 'Pulse carbine and sidearm. Wins mid-range fights.', weapons: ['carbine', 'sidearm'] },
  recon: { name: 'Recon', role: 'Rail rifle and magnum. Holds lanes and ridges.', weapons: ['lancer', 'magnum'] },
};

export const GRENADE = { fuse: 2.2, radius: 6.5, damage: 110, throwSpeed: 19, perLife: 2 };
export const HEALTH = { max: 100, shield: 50, shieldDelay: 3.2, shieldRate: 30, healthDelay: 6, healthRate: 12 };

export function damageAt(w: WeaponDef, distance: number) {
  const { near, far, minDamage } = w.falloff;
  if (distance <= near) return w.damage;
  if (distance >= far) return w.damage * minDamage;
  return w.damage * (1 - (1 - minDamage) * (distance - near) / (far - near));
}

export function zoneMultiplier(w: WeaponDef, zone: HitZone) {
  return zone === 'head' ? w.headMultiplier : zone === 'legs' ? w.legMultiplier : 1;
}

export type HitZone = 'head' | 'body' | 'legs';
