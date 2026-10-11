/**
 * Xinyi's plan (xinyi.ts): bounds, levels and the places its files share. +x east, +z south,
 * metres; the street is y = 0. Everything here is this project's own layout of a stylised Xinyi
 * (信義) business district around Taipei 101, in the spirit of the real one; not a survey, and not
 * taken from any other game. The bots' 2.5 m lattice runs through x and z = 0.
 *
 * North to south: the department-store row, its forecourt (SWAT's base), Xinyi Rd, the plaza
 * strip, the tower block (the west plaza, the tower, the podium mall, the sunken garden), Heping
 * Rd, Militia's forecourt and the old village. Keelung Rd closes the west, Songren Rd the east,
 * with the foot of Elephant Mountain (象山) rising past it.
 */
import type { R } from './memorial-kit';

export const BOUNDS = { minX: -136, maxX: 136, minZ: -146, maxZ: 146 };

/** The food court and garden floor, the mall's gallery floor and the skywalk's deck. */
export const B1 = -4.35, F2 = 6.65, SKY = 8.05;

/** Roads: [from, to] of their carriageways. Xinyi Rd and Heping Rd run east–west, Keelung Rd and Songren Rd north–south. */
export const ROAD = { xinyi: [-98, -78], heping: [70, 90], keelung: [-136, -118], songren: [96, 116] } as const;

/** Taipei 101's centre (its base is 63 m across) and the podium mall east of it. */
export const TOWER_AT = { x: -35, z: -10 } as const;
export const MALL: R = [-3, -50, 51, 50], WALL = 0.6;
export const IN: R = [MALL[0] + WALL, MALL[1] + WALL, MALL[2] - WALL, MALL[3] - WALL];
/** The atrium void (food court at B1, open to the skylight), the B1 passage east under the gallery and the sunken garden it reaches. */
export const PIT: R = [10, -30, 34, 30], PASSAGE: R = [34, -8, 54, 2], GARDEN: R = [54, -32, 86, 24];
/** Everything dug, and the rectangle whose street-level floor is solid fill round the dig. */
export const DUG: R[] = [PIT, PASSAGE, GARDEN], FILL: R = [6, -36, 90, 36];
/** Stairwells cut through the gallery floor: the north-west one climbs north in the west ring, the south-east one climbs south in the east ring. */
export const NW_WELL: R = [2, -30, 8, -17], SE_WELL: R = [40, 17, 46, 30];
/** The mall's roof and the floors above the gallery (closed). */
export const TOP = 28, CEIL = F2 + 5;
/** The west plaza (site B), the skywalk's deck and the village. */
export const PLAZA: R = [-116, -62, -68, 52], SKYWALK: R = [-97, -110, -91, -68], VILLAGE: R = [0, 104, 96, 146];
/** SWAT's and Militia's forecourts. */
export const SWAT_COURT: R = [-30, -110, 30, -98], MILITIA_COURT: R = [10, 90, 70, 102];

/** Rectangles covering `area` minus `holes` come from memorial-kit's cover(). */
export const inside = (r: R, x: number, z: number, m = 0) => x > r[0] - m && x < r[2] + m && z > r[1] - m && z < r[3] + m;

/** The street's floor at a point: the food court and garden below, 0 elsewhere. */
export function floorAt(x: number, z: number) {
  for (const r of DUG) if (inside(r, x, z)) return B1;
  return 0;
}

/** Elephant Mountain: the ground eases up from the east road to a wooded ridge. */
export function hillAt(x: number, z: number) {
  const t = Math.max(0, x - 118);
  const lump = Math.sin(z * 0.045) * 2 + Math.sin(z * 0.11 + x * 0.05) * 1.2;
  return t * 0.34 + (t > 0 ? lump * Math.min(1, t / 20) : 0) + t * t * 0.004;
}
