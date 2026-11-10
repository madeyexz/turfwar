import { MapBuilder } from './builder';
import type { MapDef } from './types';

/**
 * Back Alley (後巷): one service yard between a brick workshop and a plastered walk-up, after dark and
 * after rain. It is a showcase of scanned surfaces: everything seen is a photoscanned CC0 Poly Haven
 * model placed by the renderer (src/render/alley.ts, the 'alley' dressing set), under a photographed
 * sky. The map here is the collision alone: the yard's slab, its four walls and the cover.
 *
 * Coordinates: +X east, +Z south, metres. The yard is 36 × 15 m on a 3 m grid (the facade kits' module).
 * The cover is rotationally symmetric; Militia (team 1) deploys at the west end, SWAT at the east.
 */
export const ALLEY = { halfX: 18, halfZ: 7.5, height: 12 };

/** A scanned prop that is cover: the renderer centres `node` of `model` on (x, z), standing on the slab, turned by rot. */
export interface AlleyCover {
  model: string; node: string; x: number; z: number; rot: number;
  /** Its collision box (world axes): width (x), height, depth (z). */
  w: number; h: number; d: number;
  surface: 'metal' | 'concrete';
}

/** The cover of the west half; the east half is the same turned 180° (ALLEY_COVER). */
const WEST: AlleyCover[] = [
  // Two road barriers screen each base from the long sightline down the yard.
  { model: 'concrete_road_barrier_02', node: 'concrete_road_barrier_02', x: -11.6, z: -4.3, rot: Math.PI / 2, w: 0.46, h: 1.1, d: 1.58, surface: 'concrete' },
  { model: 'concrete_road_barrier_02', node: 'concrete_road_barrier_02', x: -11.6, z: -2.7, rot: Math.PI / 2, w: 0.46, h: 1.1, d: 1.58, surface: 'concrete' },
  { model: 'concrete_road_barrier_02', node: 'concrete_road_barrier_02', x: -11.2, z: 3.4, rot: Math.PI / 2 + 0.0, w: 0.46, h: 1.1, d: 1.58, surface: 'concrete' },
  // A car under a tarpaulin, parked along the south wall.
  { model: 'covered_car', node: '*', x: -5.6, z: 4.6, rot: Math.PI / 2, w: 4.4, h: 1.4, d: 1.8, surface: 'metal' },
  // Bins by the workshop's back door.
  { model: 'metal_trash_can', node: 'metal_trash_can_rust*', x: -7.6, z: -6.7, rot: 0, w: 0.64, h: 0.92, d: 0.56, surface: 'metal' },
  { model: 'metal_trash_can', node: 'metal_trash_can_rust*', x: -6.8, z: -6.75, rot: 0.6, w: 0.64, h: 0.92, d: 0.56, surface: 'metal' },
  // A barrier across the middle lane, off the centre line.
  { model: 'concrete_road_barrier_02', node: 'concrete_road_barrier_02', x: -3.2, z: -1.6, rot: 0, w: 1.58, h: 1.1, d: 0.46, surface: 'concrete' },
  // The meter cabinet on the walk-up's wall.
  { model: 'utility_box_02', node: 'utility_box_02', x: -12.4, z: 7.25, rot: Math.PI, w: 0.92, h: 1.12, d: 0.44, surface: 'metal' },
];

/** All the cover, both halves. */
export const ALLEY_COVER: AlleyCover[] = [
  ...WEST,
  ...WEST.map(c => ({ ...c, x: -c.x, z: -c.z, rot: c.rot + Math.PI })),
  // The oil-drum stove burning in the middle of the yard.
  { model: 'barrel_stove', node: 'barrel_stove', x: 0, z: 0, rot: 0.4, w: 0.6, h: 0.86, d: 0.6, surface: 'metal' },
];

export function alley(): MapDef {
  const { halfX, halfZ, height } = ALLEY;
  const b = new MapBuilder({
    id: 'alley', name: 'Back Alley', region: 'TAIPEI / SERVICE YARD',
    description: 'A rain-wet service yard between a workshop and a walk-up, built from photoscans.',
    theme: 'alley', halfX: halfX + 1, halfZ: halfZ + 1, seed: 11, roll: 0, ridge: 0,
    // The moon, low over the workshop's roof.
    sun: { x: 0.35, y: 0.6, z: -0.72 },
    // Buried under the yard's slab.
    ground: () => -1,
  });
  b.buildTerrain(2);

  // The slab and the four walls (the renderer draws the scanned ground and facades in their place).
  b.box(0, -1, 0, halfX * 2 + 2, 1, halfZ * 2 + 2, 'invisible', 'concrete');
  b.box(0, 0, -halfZ - 0.5, halfX * 2 + 2, height, 1, 'invisible', 'concrete');
  b.box(0, 0, halfZ + 0.5, halfX * 2 + 2, height, 1, 'invisible', 'concrete');
  b.box(-halfX - 0.5, 0, 0, 1, height, halfZ * 2, 'invisible', 'concrete');
  b.box(halfX + 0.5, 0, 0, 1, height, halfZ * 2, 'invisible', 'concrete');
  for (const c of ALLEY_COVER) b.box(c.x, 0, c.z, c.w, c.h, c.d, 'invisible', c.surface);

  for (const z of [-5, -3, -1, 1, 3, 5]) {
    b.spawn(1, -15.8, 0, z, -Math.PI / 2);
    b.spawn(0, 15.8, 0, -z, Math.PI / 2);
  }
  b.point('A', 'Workshop Door', -7, 0, -3.5, 4);
  b.point('B', 'Stove', 0, 0, 1.6, 4);
  b.point('C', 'Walk-up Door', 7, 0, 3.5, 4);

  b.decor.push({ kind: 'dressing', set: 'alley', x: 0, z: 0 });
  return b.build();
}
