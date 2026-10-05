/** Weapon tuning shared by client feel, bots and server-side damage validation. */
import type { Vec3 } from './math';

export type WeaponId = 'carbine' | 'lancer' | 'sidearm' | 'magnum' | 'scatter' | 'stinger' | 'graviton';
export type LoadoutId = 'assault' | 'recon' | 'breacher' | 'grenadier';

/** Buy-menu group. Pistols fill the secondary slot; everything else is a primary. */
export type WeaponCategory = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'heavy';

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
  /** Pellets per shot, fired in a fixed pattern across the hip/ADS cone (see pelletDirs). */
  pellets: number;
  /** Buy-menu price in credits. */
  price: number;
  category: WeaponCategory;
  /** Distance bots try to fight at with this weapon. */
  botRange: number;
  /** Lawful projectile instead of hitscan: it falls under the current gravity law and world time. */
  projectile?: { speed: number; fuse: number; proximity: number; radius: number; damage: number };
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  carbine: {
    id: 'carbine', name: 'VX-7 Pulse Carbine', short: 'VX-7', model: 'Gun_Rifle', auto: true,
    interval: 60 / 690, magazine: 30, reload: 1.85, damage: 21, headMultiplier: 1.75, legMultiplier: 0.85,
    falloff: { near: 24, far: 70, minDamage: 0.62 }, range: 260,
    spread: { hip: 2.4, ads: 0.18, moving: 1.6, air: 3.5, bloomPerShot: 0.32, bloomMax: 2.6, recovery: 9 },
    recoil: { pitch: 0.62, yaw: 0.22, pattern: [0.1, 0.25, 0.15, -0.2, -0.35, -0.1, 0.3, 0.4, 0.1, -0.3], recover: 9, viewPunch: 0.9 },
    adsFov: 52, adsTime: 0.16, equipTime: 0.42, movePenalty: 1, pellets: 1,
    price: 2700, category: 'rifle', botRange: 20,
  },
  lancer: {
    id: 'lancer', name: 'L-90 Lancer Rail Rifle', short: 'L-90', model: 'Gun_Sniper', auto: false,
    interval: 0.95, magazine: 5, reload: 2.6, damage: 92, headMultiplier: 2.0, legMultiplier: 0.75,
    falloff: { near: 60, far: 160, minDamage: 0.8 }, range: 400,
    spread: { hip: 4.5, ads: 0.02, moving: 3, air: 6, bloomPerShot: 0, bloomMax: 0, recovery: 6 },
    recoil: { pitch: 3.4, yaw: 0.6, pattern: [0.3, -0.4, 0.2], recover: 5, viewPunch: 3.2 },
    adsFov: 18, adsTime: 0.3, equipTime: 0.6, movePenalty: 0.88, pellets: 1,
    price: 4200, category: 'sniper', botRange: 45,
  },
  sidearm: {
    id: 'sidearm', name: 'P-12 Sidearm', short: 'P-12', model: 'Gun_Pistol', auto: false,
    interval: 0.15, magazine: 14, reload: 1.35, damage: 26, headMultiplier: 1.7, legMultiplier: 0.85,
    falloff: { near: 16, far: 45, minDamage: 0.55 }, range: 160,
    spread: { hip: 1.6, ads: 0.3, moving: 1.0, air: 3, bloomPerShot: 0.5, bloomMax: 2, recovery: 10 },
    recoil: { pitch: 1.3, yaw: 0.35, pattern: [0.2, -0.3, 0.1, 0.35], recover: 12, viewPunch: 1.4 },
    adsFov: 62, adsTime: 0.12, equipTime: 0.28, movePenalty: 1.05, pellets: 1,
    price: 200, category: 'pistol', botRange: 16,
  },
  magnum: {
    id: 'magnum', name: 'R-6 Magnum', short: 'R-6', model: 'Gun_Revolver', auto: false,
    interval: 0.42, magazine: 6, reload: 2.0, damage: 52, headMultiplier: 1.8, legMultiplier: 0.8,
    falloff: { near: 18, far: 50, minDamage: 0.6 }, range: 180,
    spread: { hip: 1.8, ads: 0.2, moving: 1.2, air: 3, bloomPerShot: 0.9, bloomMax: 2.2, recovery: 7 },
    recoil: { pitch: 3.2, yaw: 0.6, pattern: [0.4, -0.3, 0.25], recover: 8, viewPunch: 2.6 },
    adsFov: 58, adsTime: 0.14, equipTime: 0.32, movePenalty: 1.05, pellets: 1,
    price: 700, category: 'pistol', botRange: 18,
  },
  scatter: {
    id: 'scatter', name: 'S-8 Breacher Scattergun', short: 'S-8', model: 'Gun_Scatter', auto: false,
    interval: 0.82, magazine: 6, reload: 2.4, damage: 14, headMultiplier: 1.5, legMultiplier: 0.8,
    falloff: { near: 7, far: 24, minDamage: 0.25 }, range: 60,
    spread: { hip: 4.6, ads: 3.2, moving: 0, air: 0, bloomPerShot: 0, bloomMax: 0, recovery: 6 },
    recoil: { pitch: 4.2, yaw: 0.8, pattern: [0.3, -0.4], recover: 7, viewPunch: 3.6 },
    adsFov: 64, adsTime: 0.15, equipTime: 0.45, movePenalty: 1.02, pellets: 9,
    price: 1500, category: 'shotgun', botRange: 7,
  },
  stinger: {
    id: 'stinger', name: 'K-9 Stinger Machine Pistol', short: 'K-9', model: 'Gun_Stinger', auto: true,
    interval: 60 / 1050, magazine: 24, reload: 1.5, damage: 13, headMultiplier: 1.6, legMultiplier: 0.85,
    falloff: { near: 10, far: 32, minDamage: 0.5 }, range: 120,
    spread: { hip: 2.6, ads: 0.9, moving: 0.9, air: 2.5, bloomPerShot: 0.18, bloomMax: 2.2, recovery: 11 },
    recoil: { pitch: 0.45, yaw: 0.4, pattern: [0.3, -0.35, 0.2, -0.25, 0.4, -0.1], recover: 12, viewPunch: 0.6 },
    adsFov: 64, adsTime: 0.12, equipTime: 0.26, movePenalty: 1.06, pellets: 1,
    price: 1200, category: 'smg', botRange: 12,
  },
  graviton: {
    id: 'graviton', name: 'G-0 Graviton Launcher', short: 'G-0', model: 'Gun_Graviton', auto: false,
    interval: 0.75, magazine: 4, reload: 2.6, damage: 0, headMultiplier: 1, legMultiplier: 1,
    falloff: { near: 0, far: 1, minDamage: 1 }, range: 120,
    spread: { hip: 0, ads: 0, moving: 0, air: 0, bloomPerShot: 0, bloomMax: 0, recovery: 6 },
    recoil: { pitch: 2.6, yaw: 0.5, pattern: [0.2, -0.3], recover: 6, viewPunch: 2.8 },
    adsFov: 60, adsTime: 0.2, equipTime: 0.5, movePenalty: 0.95, pellets: 1,
    price: 4000, category: 'heavy', botRange: 20,
    projectile: { speed: 34, fuse: 2.6, proximity: 1.1, radius: 4.5, damage: 105 },
  },
};

export const LOADOUTS: Record<LoadoutId, { name: string; role: string; weapons: [WeaponId, WeaponId] }> = {
  assault: { name: 'Assault', role: 'Pulse carbine and sidearm. Wins mid-range fights.', weapons: ['carbine', 'sidearm'] },
  recon: { name: 'Recon', role: 'Rail rifle and magnum. Holds lanes and ridges.', weapons: ['lancer', 'magnum'] },
  breacher: { name: 'Breacher', role: 'Scattergun and machine pistol. Clears rooms and doorways.', weapons: ['scatter', 'stinger'] },
  grenadier: { name: 'Grenadier', role: 'Graviton launcher and sidearm. Its charges fall with the laws.', weapons: ['graviton', 'sidearm'] },
};

/** Slot a weapon occupies: pistols are secondaries (1), everything else primaries (0). */
export const slotOf = (w: WeaponDef): 0 | 1 => w.category === 'pistol' ? 1 : 0;

/** Credits: earned in the field, spent in the buy menu (B) on weapons that last until death. */
export const ECONOMY = {
  start: 800, max: 16000, kill: 300, headshotBonus: 100, capture: 300, droneKill: 150,
  /** Seconds after (re)spawning during which buying works anywhere. */
  buyTime: 15,
  /** Metres from one of your team's spawn slots within which buying always works. */
  buyRadius: 18,
  grenade: 300,
  /** Spare magazines carried for each weapon (reserve ammo) and bought with the gun. */
  spareMags: 3,
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
