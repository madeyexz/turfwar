import type { Heightfield, Ladder, Ramp, Solid } from '../collision';
import type { Vec3 } from '../math';

/** Dusk (low sun), twilight (blue hour), steppe (dry midday) and meadow light the BeGone maps under Earth skies. */
export type ThemeId = 'desert' | 'snow' | 'forest' | 'dusk' | 'twilight' | 'steppe' | 'meadow';

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
  // Realistic architecture (the BeGone maps):
  | 'brick'       // red brick masonry
  | 'plaster'     // weathered, moss-streaked plaster
  | 'wood'        // plank walls, decks, fences and sheds
  | 'crate'       // framed wooden shipping crate (optionally tinted)
  | 'roof'        // corrugated iron sheeting
  | 'cobble'      // cobblestone paving
  | 'slab'        // plain poured-concrete floors
  | 'hedge'       // clipped hedge
  | 'steel'       // painted, rusting structural steel (gantries, girders, tanks)
  | 'invisible';

/** Stairs and plain ramps are walkways; 'roof' draws a corrugated pitched-roof plane. */
export type RampStyle = 'stairs' | 'ramp' | 'roof';

/** Three points on the smaller maps; Conquest-style battlefields use up to five. */
export type PointId = 'A' | 'B' | 'C' | 'D' | 'E';

export interface CapturePointDef { id: PointId; name: string; x: number; y: number; z: number; radius: number }
/** Ammo crate: press E to restock half a magazine (the first use each round costs $300). */
export interface PickupDef { x: number; y: number; z: number; item: 'ammo'; respawn: number }
/** A spawn slot in a team's base. */
export interface SpawnDef { team: 0 | 1; x: number; y: number; z: number; yaw: number }

export type Decor =
  | { kind: 'block'; solid: number; style: BlockStyle; color?: number }
  /** Cylinder resting on y, upright or lying along x/z (silos, tanks, pipes); collision comes from boxes placed with it. */
  | { kind: 'cylinder'; x: number; y: number; z: number; radius: number; height: number; axis: 'x' | 'y' | 'z'; style: BlockStyle; color?: number }
  /** Sphere centred at y (statues); collision comes from a box placed with it. */
  | { kind: 'ball'; x: number; y: number; z: number; radius: number; style: BlockStyle; color?: number }
  /** Lattice girder along its bottom centreline from (x0, y0, z0) to (x1, y1, z1); collision comes from boxes placed with it. */
  | { kind: 'truss'; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; w: number; h: number; color?: number }
  /** Still water surface (decorative: bullets and soldiers pass through). */
  | { kind: 'water'; x: number; y: number; z: number; w: number; d: number }
  | { kind: 'ramp'; ramp: number; style: RampStyle }
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
  /** Climbable ladders (BeGone's maps use them where the stairs would not fit). */
  ladders?: Ladder[];
  /** Ammo crates (mirrored like everything else on symmetric maps). */
  pickups?: PickupDef[];
  /** Sabotage: bomb sites (named map points) and which base the attacking Militia deploys from. */
  sabotage?: { sites: PointId[]; attackerSpawn: 0 | 1 };
  /** Big enough for 24v24 (bases padded to 24 slots); only big maps host 24v24. */
  big?: boolean;
}
