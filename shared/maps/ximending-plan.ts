/**
 * Ximending's plan (ximending.ts): bounds, the bands of the plan and the places and heights its
 * files share. +x east, +z south, metres; ground at y = 0. Everything here is this project's own
 * layout, a stylised Ximending (西門町) in the spirit of the real district's pedestrian lanes, not a
 * survey and not taken from any other game.
 *
 * The plan is a block of three east–west lanes (north, middle, south) crossed by three north–south
 * streets (west, Hanzhong, east), ringed by a road for cars. SWAT deploys at the west end, in the
 * plaza by the MRT exit; Militia at the east end, in a construction yard. The bots' 2.5 m lattice
 * runs through x and z = 0, so lanes and gates are centred on multiples of 2.5.
 */
import type { R } from './memorial-kit';

export const BOUNDS = { minX: -81, maxX: 81, minZ: -66, maxZ: 66 };

/** Bands of the plan north to south (z): the boulevard, its sidewalk, row N, lane N, row NM, lane M, row MS, lane S, row S. */
export const Z = {
  nBlvd: [-66, -54], nWalk: [-54, -50], rowN: [-50, -37.5], laneN: [-37.5, -27.5], rowNM: [-27.5, -5], laneM: [-5, 5],
  rowMS: [5, 27.5], laneS: [27.5, 37.5], rowS: [37.5, 50], sWalk: [50, 54], sBlvd: [54, 66],
} as const;
/** Bands of the plan west to east (x): the road, its sidewalk, the west column, west street, mid-west, Hanzhong, mid-east, east street, east column. */
export const X = {
  wRoad: [-81, -72], wWalk: [-72, -68], colW: [-68, -47.5], stW: [-47.5, -37.5], colMW: [-37.5, -5], hanzhong: [-5, 5],
  colME: [5, 37.5], stE: [37.5, 47.5], colE: [47.5, 68], eWalk: [68, 72], eRoad: [72, 81],
} as const;

/** The roofs of the arcade (with the helicopter's pad) and of the hotel across lane M, and the height of a plain deck. */
export const ROOF = 13.8;
/** The cinema's balcony deck over site A. */
export const BALCONY = 3.5;
/** The arcade building, the hotel across lane M from it and the helicopter's pad on the arcade's roof. */
export const ARCADE_HALL: R = [5, -27.5, 37.5, -5], HOTEL: R = [19, 5, 37.5, 27.5], PAD: R = [24.5, -24.5, 33.5, -15.5];
/** The cinema block (lobby at ground level) on lane N. */
export const CINEMA: R = [-26, -50, -5, -37.5];
/** The Red House: the octagon's centre and radius, and the cross-shaped wing. */
export const RED_HOUSE = { x: -8, z: 42, r: 7.5 } as const;
export const CROSS_WING: [R, R] = [[-36, 40, -22, 46], [-31, 34, -25, 50]];
/** SWAT's plaza and Militia's yard. */
export const PLAZA: R = [-68, -15, -47.5, 15], YARD: R = [47.5, -15, 68, 15];
/**
 * Ladders: [x, z, dir] at the foot of each, on a blank stretch of wall (never over a door, never
 * where a chicane or a scooter row stands at its foot): the arcade's west face (from Hanzhong St,
 * between its two doors), its east face (from East St) and the hotel's south face (from lane S).
 */
export const LADDERS: [x: number, z: number, dir: 0 | 1 | 2 | 3][] = [[ARCADE_HALL[0], -16, 0], [ARCADE_HALL[2], -21.2, 2], [24, HOTEL[3], 3]];
/**
 * The galleries' sheet roofs over the lanes' ends and the bases' mouths, underside and top: above
 * the shop signs, and higher than a soldier can jump from anything near them (a container, a
 * planter, a screen), so their tops are never a sniper's perch.
 */
export const GALLERY = [4.45, 4.75] as const;
