import type { Heightfield, Ramp, Solid } from '../collision';
import type { Laws } from '../laws';
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
  | 'pillar'
  | 'shield'      // team spawn shield (energy)
  | 'glass'
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
  | { kind: 'scatter'; model: string; count: number; seed: number; minR: number; maxR: number; scale: [number, number] };

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
}
