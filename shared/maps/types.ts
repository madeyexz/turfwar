import type { Heightfield, Ramp, Solid } from '../collision';
import type { Laws } from '../laws';
import type { Vec3 } from '../math';

export type ThemeId = 'desert' | 'snow' | 'forest' | 'voxel' | 'city';

/** Block materials of the voxel battlefield; each maps to Kenney Voxel Pack tiles. */
export type VoxelId =
  | 'grass' | 'dirt' | 'stone' | 'cobble' | 'gravel' | 'sand' | 'planks' | 'planksRed' | 'log' | 'leaves'
  | 'stonebrick' | 'brick' | 'glass' | 'coal' | 'gold' | 'diamond' | 'woolBlue' | 'woolRed' | 'snow';

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
  | 'facade'      // city building: windowed walls, tinted per building
  | 'facadeGlass' // glass curtain-wall tower
  | `voxel:${VoxelId}`
  | 'invisible';

export type PointId = 'A' | 'B' | 'C';

export interface CapturePointDef { id: PointId; name: string; x: number; y: number; z: number; radius: number }
export interface SpawnDef { team: 0 | 1; x: number; y: number; z: number; yaw: number }

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
  | { kind: 'mast'; x: number; y: number; z: number; height: number }
  /** Render-only voxel scenery beyond the playable bounds (no collision cost). */
  | { kind: 'voxel'; id: VoxelId; minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
  /** Non-solid water surface. */
  | { kind: 'water'; minX: number; maxX: number; minZ: number; maxZ: number; y: number }
  /** Parked or wrecked vehicle drawn over its collision box (rotY is a small visual skew). */
  | { kind: 'vehicle'; model: 'taxi' | 'car' | 'bus' | 'van'; x: number; y: number; z: number; rotY: number; seed: number }
  /** Glowing advertising screen; normal points along rotY. */
  | { kind: 'billboard'; x: number; y: number; z: number; w: number; h: number; rotY: number; seed: number };

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
  /** Real-world layouts and authored attacker/defender maps are not rotationally symmetric. */
  asymmetric?: boolean;
  /** Credit line shown with the map, for layouts derived from open data. */
  attribution?: string;
}
