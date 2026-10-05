import type { VehicleKind } from '../vehicles';
import type { MapBuilder } from './builder';

/**
 * Drivable vehicles of the Xinyi map, in the source's coordinates (+x east, +z south): cars on
 * Xinyi Rd and Heping Rd by each base, scooters parked on the sidewalks (on the Xinyi Plaza Malls
 * frontage, on Songzhi Rd and by the 101 west plaza), and a helicopter on a painted pad in Xinyi
 * Rd's eastbound lanes past Songren Rd. Kept apart from xinyi.ts so map edits merge cleanly.
 */
const E = -Math.PI / 2, W = Math.PI / 2, N = 0, S = Math.PI;
export const XINYI_VEHICLES: [kind: VehicleKind, x: number, z: number, yaw: number][] = [
  // SWAT: Xinyi Rd's westbound lanes in front of the malls, scooters on the frontage.
  ['car', 705, 111.5, W], ['car', 790, 111.5, W],
  ['scooter', 784, 99, N], ['scooter', 785.2, 99, N], ['scooter', 786.4, 99, N],
  // Militia: Heping Rd either side of Songzhi Rd, scooters on Songzhi Rd's west sidewalk.
  ['car', 712, 284.5, E], ['car', 772, 284.5, E],
  ['scooter', 735.2, 342, N], ['scooter', 735.2, 343.4, N], ['scooter', 735.2, 344.8, N],
  // Between the bases: Songren Rd, and scooters on the Keelung Rd sidewalk by the west plaza.
  ['car', 834.5, 205, S],
  ['scooter', 657, 232, S], ['scooter', 657, 233.4, S],
  ['heli', 872, 128, N],
];

/** Park the vehicles, and paint the helicopter's pad (an H in a square) under it. */
export function parkXinyiVehicles(b: MapBuilder, X: (x: number) => number, Z: (z: number) => number, floorAt: (x: number, z: number) => number) {
  for (const [kind, x, z, yaw] of XINYI_VEHICLES) {
    b.vehicle(kind, X(x), floorAt(x, z), Z(z), yaw);
    if (kind !== 'heli') continue;
    const y = floorAt(x, z) + 0.014, cx = X(x), cz = Z(z), PAINT = 0xf2efe6;
    const mark = (dx: number, dz: number, w: number, d: number) => b.raw({ kind: 'marking', ...b.at(cx + dx, cz + dz), y, w, d, color: PAINT });
    for (const s of [-1, 1]) { mark(s * 4.2, 0, 0.3, 8.7); mark(0, s * 4.2, 8.7, 0.3); mark(s * 1.3, 0, 0.45, 3.6); }
    mark(0, 0, 2.6, 0.45);
  }
}
