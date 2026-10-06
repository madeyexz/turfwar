import type { VehicleKind } from '../vehicles';
import type { MapBuilder } from './builder';

/**
 * Drivable vehicles of the Taipei map, in the source's coordinates (+x east, +z south): taxis and
 * cars on the ring road (taipei-compact.ts) behind both bases and on its flanks, rows of scooters
 * at both bases and in the pedestrian streets (Taipei's own way of getting around), and a
 * helicopter on a painted pad on the 7-TWELVE roof in the middle of the map (up its stair house),
 * about as far from either base. Kept apart from taipei.ts so map edits merge cleanly.
 */
const E = -Math.PI / 2, W = Math.PI / 2, N = 0, S = Math.PI;
/** Roof the helicopter stands on (the 7-TWELVE / claw shop, taipei-interiors.ts). */
export const HELI_ROOF = 13.9;
export const TAIPEI_VEHICLES: [kind: VehicleKind, x: number, z: number, yaw: number][] = [
  // Cars on the ring road: behind SWAT's cordon on Civic Blvd, behind Militia's barricade on
  // Zhongxiao W. Rd, and on the flanks (Huanhe Rd and Zhonghua Rd).
  ['car', -812, -292, W], ['car', -760, -292, E],
  ['car', -835, -167.5, W], ['car', -790, -167.5, E],
  ['car', -865.5, -232, N], ['car', -711, -236, S],
  // Scooters: on the sidewalk outside Militia's barricade, in the cordon's kerb lane, and in
  // Xining S. Rd and Hanzhong St.
  ['scooter', -809.0, -176.6, E], ['scooter', -809.0, -175.4, E], ['scooter', -806.5, -177.2, E],
  ['scooter', -787.2, -285.8, E], ['scooter', -785.6, -285.8, E], ['scooter', -784.0, -285.8, E],
  ['scooter', -813, -230, N], ['scooter', -757, -262, S],
  // The helicopter on its pad on the 7-TWELVE roof.
  ['heli', -771.5, -222, N],
];

/** Park the vehicles, and paint the helicopter's pad (an H in a square) under it. */
export function parkTaipeiVehicles(b: MapBuilder, X: (x: number) => number, Z: (z: number) => number, floorAt: (x: number, z: number) => number) {
  for (const [kind, x, z, yaw] of TAIPEI_VEHICLES) {
    const floor = kind === 'heli' ? HELI_ROOF : floorAt(x, z);
    b.vehicle(kind, X(x), floor, Z(z), yaw);
    if (kind !== 'heli') continue;
    const y = floor + 0.014, cx = X(x), cz = Z(z), PAINT = 0xf2efe6;
    const mark = (dx: number, dz: number, w: number, d: number) => b.raw({ kind: 'marking', ...b.at(cx + dx, cz + dz), y, w, d, color: PAINT });
    for (const s of [-1, 1]) { mark(s * 4.2, 0, 0.3, 8.7); mark(0, s * 4.2, 8.7, 0.3); mark(s * 1.3, 0, 0.45, 3.6); }
    mark(0, 0, 2.6, 0.45);
  }
}
