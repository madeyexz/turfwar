import { MapBuilder } from './builder';
import type { MapDef } from './types';

/**
 * Back Alley (後巷): the service lanes behind a block of workshops and walk-ups, after dark and after
 * rain. Everything seen is a photoscanned CC0 Poly Haven model placed by the renderer
 * (src/render/alley.ts, the 'alley' dressing set), under a photographed sky. The map here is the
 * collision alone: the slab, the outer walls, the buildings (ALLEY_BLOCKS) and the cover (ALLEY_COVER).
 *
 * Coordinates: +X east, +Z south, metres. The ground is 72 × 45 m; every building side is a multiple
 * of 3 m (the facade kits' module).
 *
 *        x -36    -27              0     6               27     36
 *   z -22.5 +------------------------------------------------------+
 *           |                    north lane                (A)     |
 *   z -16.5 |       +-----------------+     +---------------+      |
 *           |       |    workshop     |     |   tenement    |      |
 *   z  -7.5 | west  +-----------------+     +---------------+ east |
 *           | base  +--+                                 +--+ base |
 *           |       |  | garages     yard (C)    garages |  |      |
 *           |       +--+                                 +--+      |
 *   z   7.5 |       +-------------+     +-------------------+      |
 *           |       |    depot    |     |      walk-up      |      |
 *   z  16.5 |       +-------------+     +-------------------+      |
 *           |                    south lane                (B)     |
 *   z  22.5 +------------------------------------------------------+
 *
 * Three lanes run between the bases (the yard and a lane each side of it) and a cross alley joins each
 * side lane to the yard. The plan is rotationally symmetric; Militia (team 1) deploys behind the west
 * garages, SWAT behind the east ones. In Sabotage the sites are the east ends of the side lanes.
 */
export const ALLEY = { halfX: 36, halfZ: 22.5, height: 12, floor: 3 };

/** A building: a rectangle of scanned facades `floors` high, drawn from one of the two facade kits. */
export interface AlleyBlock {
  id: string; kit: 'factory' | 'apartments'; floors: number;
  x0: number; z0: number; x1: number; z1: number;
}

/** The buildings between the lanes. Each has a partner of its own size turned 180°; the partners' kits differ. */
export const ALLEY_BLOCKS: AlleyBlock[] = [
  { id: 'workshop', kit: 'factory', floors: 4, x0: -27, z0: -16.5, x1: 0, z1: -7.5 },
  { id: 'tenement', kit: 'apartments', floors: 3, x0: 6, z0: -16.5, x1: 27, z1: -7.5 },
  { id: 'depot', kit: 'factory', floors: 3, x0: -27, z0: 7.5, x1: -6, z1: 16.5 },
  { id: 'walkup', kit: 'apartments', floors: 4, x0: 0, z0: 7.5, x1: 27, z1: 16.5 },
  // A row of lock-ups screens each base from the yard.
  { id: 'garages-west', kit: 'factory', floors: 1, x0: -27, z0: -4.5, x1: -24, z1: 4.5 },
  { id: 'garages-east', kit: 'factory', floors: 1, x0: 24, z0: -4.5, x1: 27, z1: 4.5 },
];

/** How high a block's collision stands: its floors and the crown on top. */
export const blockHeight = (b: AlleyBlock) => b.floors * ALLEY.floor + 0.3;

/** A scanned prop that is cover: the renderer centres `node` of `model` on (x, z), standing on the slab, turned by rot. */
export interface AlleyCover {
  model: string; node: string; x: number; z: number; rot: number;
  /** Its collision box (world axes): width (x), height, depth (z). */
  w: number; h: number; d: number;
  surface: 'metal' | 'concrete';
}

const Q = Math.PI / 2;
/** A road barrier, along x (rot 0) or along z (rot Q). */
const barrier = (x: number, z: number, rot: number): AlleyCover =>
  ({ model: 'concrete_road_barrier_02', node: 'concrete_road_barrier_02', x, z, rot, w: rot ? 0.46 : 1.58, h: 1.1, d: rot ? 1.58 : 0.46, surface: 'concrete' });
/** A car under a tarpaulin, along z (rot 0) or along x (rot Q). */
const car = (x: number, z: number, rot: number): AlleyCover =>
  ({ model: 'covered_car', node: '*', x, z, rot, w: rot ? 4.4 : 1.8, h: 1.4, d: rot ? 1.8 : 4.4, surface: 'metal' });
/** A rusted bin; rot Q turns its box. */
const bin = (x: number, z: number, rot: number): AlleyCover =>
  ({ model: 'metal_trash_can', node: 'metal_trash_can_rust*', x, z, rot, w: 0.64, h: 0.92, d: 0.64, surface: 'metal' });
/** A meter cabinet with its back to a wall: rot is the way it faces (0 is +z). */
const cabinet = (x: number, z: number, rot: number): AlleyCover =>
  ({ model: 'utility_box_02', node: 'utility_box_02', x, z, rot, w: 0.92, h: 1.12, d: 0.44, surface: 'metal' });

/** The cover of one half (the west of the yard, the north lane and its cross alley); the other half is the same turned 180° (ALLEY_COVER). */
const HALF: AlleyCover[] = [
  // ---- The yard, west of the stove ----
  // Two road barriers screen the lane out of the base from the long sightline down the yard.
  barrier(-11.6, -4.3, Q), barrier(-11.6, -2.7, Q), barrier(-11.2, 3.4, Q),
  // A car parked along the depot's wall, and one outside the workshop.
  car(-9.6, 5.6, Q), car(-19.5, -5.5, Q),
  // Bins by the workshop's back door.
  bin(-7.6, -6.7, 0), bin(-6.8, -6.75, 0),
  // A barrier across the middle, off the centre line, and one where the base's south gap opens on the yard.
  barrier(-3.2, -1.6, 0), barrier(-21.6, 5.9, 0),
  // The meter cabinet on the depot's wall.
  cabinet(-13.4, 7.28, Math.PI),

  // ---- The north lane, west to east ----
  barrier(-21, -18.1, Q),
  car(-15.5, -21.3, Q),
  // A chicane before the cross alley.
  barrier(-4, -21.7, Q), barrier(-4, -20.1, Q),
  bin(-1.2, -16.9, 0), bin(-2.0, -16.95, 0),
  cabinet(9, -22.28, 0),
  barrier(10.5, -20.8, Q),
  // Site A: a car against the tenement, a barrier toward the SWAT base.
  car(15, -17.5, Q), barrier(22, -20.4, 0),

  // ---- The north cross alley ----
  barrier(1.6, -13.4, 0),
  bin(5.6, -10.6, Q), bin(5.6, -11.4, Q),

  // ---- The west base ----
  car(-34.9, -13, 0),
];

/** All the cover, both halves. */
export const ALLEY_COVER: AlleyCover[] = [
  ...HALF,
  ...HALF.map(c => ({ ...c, x: -c.x, z: -c.z, rot: c.rot + Math.PI })),
  // The oil-drum stove burning in the middle of the yard.
  { model: 'barrel_stove', node: 'barrel_stove', x: 0, z: 0, rot: 0.4, w: 0.6, h: 0.86, d: 0.6, surface: 'metal' },
];

export function alley(): MapDef {
  const { halfX, halfZ, height } = ALLEY;
  const b = new MapBuilder({
    id: 'alley', name: 'Back Alley', region: 'TAIPEI / SERVICE LANES',
    description: 'Rain-wet service lanes behind workshops and walk-ups, built from photoscans.',
    theme: 'alley', halfX: halfX + 1, halfZ: halfZ + 1, seed: 11, roll: 0, ridge: 0,
    sabotage: { sites: ['A', 'B'], attackerSpawn: 1 },
    // The moon, low over the workshop's roof.
    sun: { x: 0.35, y: 0.6, z: -0.72 },
    // Buried under the slab.
    ground: () => -1,
  });
  b.buildTerrain(2);

  // The slab and the four outer walls (the renderer draws the scanned ground and facades in their place).
  b.box(0, -1, 0, halfX * 2 + 2, 1, halfZ * 2 + 2, 'invisible', 'concrete');
  b.box(0, 0, -halfZ - 0.5, halfX * 2 + 2, height, 1, 'invisible', 'concrete');
  b.box(0, 0, halfZ + 0.5, halfX * 2 + 2, height, 1, 'invisible', 'concrete');
  b.box(-halfX - 0.5, 0, 0, 1, height, halfZ * 2, 'invisible', 'concrete');
  b.box(halfX + 0.5, 0, 0, 1, height, halfZ * 2, 'invisible', 'concrete');
  for (const k of ALLEY_BLOCKS) b.box((k.x0 + k.x1) / 2, 0, (k.z0 + k.z1) / 2, k.x1 - k.x0, blockHeight(k), k.z1 - k.z0, 'invisible', 'concrete');
  for (const c of ALLEY_COVER) b.box(c.x, 0, c.z, c.w, c.h, c.d, 'invisible', c.surface);

  b.mirrored(() => {
    // Twelve slots behind the garages, out of every lane's sight.
    for (const x of [-34, -31.5, -29]) for (const z of [-3.6, -1.2, 1.2, 3.6]) b.spawn(1, x, 0, z, -Math.PI / 2);
    // Ammunition in the cross alley.
    b.ammoCrate(4.2, 0, -9.2);
  });
  b.point('A', 'North Lane', 16.5, 0, -19.6, 4);
  b.point('B', 'South Lane', 13.5, 0, 19.4, 4);
  b.point('C', 'Stove', 0, 0, 1.6, 4);

  b.decor.push({ kind: 'dressing', set: 'alley', x: 0, z: 0 });
  return b.build();
}
