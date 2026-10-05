import type { Heightfield, Ramp, Solid } from '../collision';
import type { Vec3 } from '../math';

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
/** Ammo crate: press E to restock half a magazine (the first use each round costs $300). */
export interface PickupDef { x: number; y: number; z: number; item: 'ammo'; respawn: number }
/** A spawn slot in a team's base. */
export interface SpawnDef { team: 0 | 1; x: number; y: number; z: number; yaw: number }

export type Decor =
  | { kind: 'block'; solid: number; style: BlockStyle; color?: number }
  | { kind: 'ramp'; ramp: number; style: 'stairs' | 'ramp' }
  | { kind: 'prop'; model: string; x: number; y: number; z: number; rotY: number; scale?: number }
  | { kind: 'light'; x: number; y: number; z: number; color: number; intensity: number; distance: number }
  | { kind: 'rail'; x0: number; z0: number; x1: number; z1: number; y: number }
  | { kind: 'decal'; model: string; x: number; y: number; z: number; rotY: number; scale?: number }
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
  decor: Decor[];
  /** Sun direction and environment tint used by the renderer. */
  sun: Vec3;
  /** Ammo crates (mirrored like everything else on symmetric maps). */
  pickups?: PickupDef[];
  /** Sabotage: bomb sites (named map points) and which base the attacking Militia deploys from. */
  sabotage?: { sites: PointId[]; attackerSpawn: 0 | 1 };
  /** Big enough for 24v24 (bases padded to 24 slots); only big maps host 24v24. */
  big?: boolean;
}
