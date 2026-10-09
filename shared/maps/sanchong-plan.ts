/**
 * Sanchong's plan (sanchong.ts): bounds, the bands of the plan north to south and the places and
 * heights its files share. +x east, +z south, metres; ground at y = 0.
 */
import type { R } from './memorial-kit';

export const BOUNDS = { minX: -76, maxX: 76, minZ: -66, maxZ: 50 };

/** Bands of the plan, north to south (z): the bridge, row N, the main street, row M, the market, row S, the alleys. */
export const Z = {
  deck: [-64, -55], under: [-64, -53], rowN: [-53, -44], main: [-44, -36],
  rowM: [-36, -6.5], market: [-6.5, 6.5], rowS: [6.5, 28], alleys: [28, 47],
} as const;
/** The bridge deck's height and its slab's underside; the deck runs from the ramp's top (DECK_X0) east over the levee. */
export const DECK = 6.5, DECK_SOFFIT = 5.7, DECK_X0 = -24, RAMP_X0 = -50;
/** The east stair up to the deck, rising west. */
export const DECK_STAIR: R = [30, -59, 42, -55];
/** The levee road (環河北路) runs along the flood wall, whose inner face is at x = 71. */
export const LEVEE_X = 71;
/** The arcades' depth (騎樓). */
export const ARCADE = 3.5;
/** The covered market hall's extent along x and its roof. */
export const HALL = { x0: -30, x1: 30, roof: 4.6 } as const;
/** The ironworks yard (site B) inside its walls, the workshop beside it and the workshop's roof. */
export const YARD: R = [0, 7.3, 20, 27.4], WORKSHOP: R = [-8, 6.5, 0, 28], SHED_ROOF = 5;
/** The temple (site A's hall) and its square. */
export const TEMPLE: R = [14, -52, 26, -36], SQUARE: R = [-4, -53, 14, -36];
/** The opera stage (戲台) on the square's west side, facing the temple, and its height. */
export const STAGE: R = [-4, -52.5, 1, -45], STAGE_Y = 1.3;
/** The two-storey house in the alleys whose roof terrace a ladder climbs to. */
export const TERRACE: R = [-8, 32, 4, 38], TERRACE_Y = 6.6;
