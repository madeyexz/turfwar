import type { VehicleKind } from '../vehicles';
import type { MapBuilder } from './builder';

/**
 * Drivable vehicles of the Taipei map, in the source's coordinates (+x east, +z south): taxis and
 * cars on the traffic roads, rows of scooters parked on the sidewalks by both bases and in the
 * pedestrian streets (Taipei's own way of getting around), and a helicopter on a painted pad on
 * Zhonghua Rd, about as far from either base. Kept apart from taipei.ts so map edits merge cleanly.
 */
const E = -Math.PI / 2, W = Math.PI / 2, N = 0, S = Math.PI;
export const TAIPEI_VEHICLES: [kind: VehicleKind, x: number, z: number, yaw: number][] = [
  // SWAT: Civic Blvd's south carriageway under the expressway, scooters on the sidewalk.
  ['car', -815, -289, W], ['car', -840, -289, W],
  ['scooter', -800, -281, N], ['scooter', -801.2, -281, N], ['scooter', -802.4, -281, N],
  // Militia: Zhongxiao W. Rd, scooters on the sidewalk outside Ximen station.
  ['car', -830, -152, E], ['car', -740, -168, W],
  ['scooter', -760, -144, N], ['scooter', -758.8, -144, N], ['scooter', -757.6, -144, N],
  // Between the bases: Huanhe Rd, Zhonghua Rd, and scooters in Xining S. Rd and Hanzhong St.
  ['car', -866, -215, N], ['car', -692, -120, S],
  ['scooter', -813, -230, E], ['scooter', -814.2, -232, E], ['scooter', -755, -232, S],
  ['heli', -692.5, -227, N],
];

/** Park the vehicles, and paint the helicopter's pad (an H in a square) under it. */
export function parkTaipeiVehicles(b: MapBuilder, X: (x: number) => number, Z: (z: number) => number, floorAt: (x: number, z: number) => number) {
  for (const [kind, x, z, yaw] of TAIPEI_VEHICLES) {
    b.vehicle(kind, X(x), floorAt(x, z), Z(z), yaw);
    if (kind !== 'heli') continue;
    const y = floorAt(x, z) + 0.014, cx = X(x), cz = Z(z), PAINT = 0xf2efe6;
    const mark = (dx: number, dz: number, w: number, d: number) => b.raw({ kind: 'marking', ...b.at(cx + dx, cz + dz), y, w, d, color: PAINT });
    for (const s of [-1, 1]) { mark(s * 4.2, 0, 0.3, 8.7); mark(0, s * 4.2, 8.7, 0.3); mark(s * 1.3, 0, 0.45, 3.6); }
    mark(0, 0, 2.6, 0.45);
  }
}
