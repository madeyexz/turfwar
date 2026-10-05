import type { Heightfield, Ramp, Solid } from '../collision';
import type { Laws } from '../laws';
import type { Vec3 } from '../math';
import type { WeaponId } from '../weapons';

export type ThemeId = 'desert' | 'snow' | 'forest';

/** Visual treatment of a solid. Collision is identical regardless of style. */
export type BlockStyle =
  | 'wall'        // base walls: panelled armor plates
  | 'wallDark'
  | 'concrete'    // foundations, jersey barriers
  | 'trim'        // thin metal edges
  | 'floor'       // catwalk / roof slabs
  | 'container'   // cargo containers
  | 'rock'
  | 'sandstone'   // plastered desert town masonry
  | 'pillar'
  | 'shield'      // team spawn shield (energy)
  | 'glass'
  | 'invisible';

/** Three points on the smaller maps; Conquest-style battlefields use up to five. */
export type PointId = 'A' | 'B' | 'C' | 'D' | 'E';

export interface CapturePointDef { id: PointId; name: string; x: number; y: number; z: number; radius: number }
/** A spawn slot. With `point`, it is a forward spawn: open only while its team holds that point. */
/**
 * Item lying on the battlefield: walk over ammo/armor to take it; press E on a weapon to swap it in.
 * It comes back `respawn` seconds after being taken.
 */
export interface PickupDef { x: number; y: number; z: number; item: WeaponId | 'ammo' | 'armor'; respawn: number }
export interface SpawnDef { team: 0 | 1; x: number; y: number; z: number; yaw: number; point?: PointId }

export type Decor =
  | { kind: 'block'; solid: number; style: BlockStyle; color?: number }
  | { kind: 'ramp'; ramp: number; style: 'stairs' | 'ramp' }
  | { kind: 'prop'; model: string; x: number; y: number; z: number; rotY: number; scale?: number }
  | { kind: 'light'; x: number; y: number; z: number; color: number; intensity: number; distance: number }
  | { kind: 'rail'; x0: number; z0: number; x1: number; z1: number; y: number }
  | { kind: 'decal'; model: string; x: number; y: number; z: number; rotY: number; scale?: number }
  | { kind: 'reactor'; x: number; y: number; z: number }
  | { kind: 'spawnPad'; team: 0 | 1; x: number; y: number; z: number; rotY: number }
  | { kind: 'banner'; team: 0 | 1; x: number; y: number; z: number; rotY: number }
  | { kind: 'tree'; x: number; y: number; z: number; scale: number; variant: number }
  | { kind: 'crystal'; x: number; y: number; z: number; scale: number; rotY: number }
  | { kind: 'mast'; x: number; y: number; z: number; height: number };

export interface MapDef {
  id: string;
  name: string;
  region: string;
  description: string;
  theme: ThemeId;
  /** Playable bounds. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  terrain: Heightfield;
  solids: Solid[];
  ramps: Ramp[];
  points: CapturePointDef[];
  spawns: SpawnDef[];
  /** Center of the anomaly gravity field (the reactor). */
  anomaly: Vec3;
  decor: Decor[];
  laws: Laws;
  /** Sun direction and environment tint used by the renderer. */
  sun: Vec3;
  /** Weapon, ammo and armor pickups (mirrored like everything else on symmetric maps). */
  pickups?: PickupDef[];
  /** The point with the reactor and its orbiting sentinels (defaults to B). */
  reactor?: PointId;
  /** Soldiers per team this battlefield is built for (bots fill the gap); defaults to the mode's size. */
  teamSize?: number;
}
