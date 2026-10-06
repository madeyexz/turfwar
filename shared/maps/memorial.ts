import { MapBuilder } from './builder';
import { C, Kit, cover, type R } from './memorial-kit';
import { backdrop, chamber, facades, roof } from './memorial-decor';
import { gardens, plazas } from './memorial-grounds';
import { galleries } from './memorial-rooms';
import type { MapDef } from './types';

/** The map's Chinese name (中正紀念堂, National Chiang Kai-shek Memorial Hall), for the zh-TW map list. */
export const MEMORIAL_NAME_ZH = '中正紀念堂';

/**
 * Memorial Hall (中正紀念堂), Taipei: a compact arena (1v1 and 6v6) in and around the white marble
 * hall, stylised to the game's low-poly look. The hall stands on a square base of three tiers: a
 * terrace on top of each (4.5, 9 and 13.5 m) with marble balustrades; the memorial chamber sits on
 * the top one under the blue glazed octagonal roof. The broad 89-step grand staircase climbs the
 * west face in three flights (30, 30 and 29 steps) with a landing at each terrace; a narrower rear
 * staircase climbs the east face, and side stairs hug the north and south faces from tier to tier.
 *
 * Inside the base, the ground floor (G) holds the museum: the entrance hall under the grand
 * staircase, exhibition rooms with glass and wood display cases, a lecture hall, a library, the
 * gift shop and the east lobby, round the double-height Gallery Hall; the upper gallery floor (M)
 * rings the Gallery Hall's void with balconies, and two switchback stairwells (with lifts beside
 * them) climb from it into the chamber, either side of the seated bronze statue.
 *
 * Teams and objectives:
 *   SWAT (team 0) deploys on the east forecourt at the foot of the rear staircase, by the east lobby;
 *   Militia (team 1, Sabotage attackers) on the slice of Liberty Square west of the grand staircase;
 *   A — the Gallery Hall (展覽廳) on the ground floor, under the balconies of the upper gallery;
 *   B — the memorial chamber (紀念大廳) on the top terrace, in front of the statue;
 *   C–E are landmarks bots roam to: the grand staircase's upper landing, the north garden and the gift shop.
 * Lanes: the grand staircase and the terraces outside (vertical, open), the museum floors inside
 * (close, with stairwells up to the chamber), and the gardens with the side stairs on each flank.
 * The National Theater, the National Concert Hall and the Liberty Square gate stand to the west
 * as backdrop only (memorial-decor.ts).
 *
 * Coordinates: +x east, +z south, metres; the nav grid's 2.5 m lattice runs through x and z = 0,
 * and doors and stairs are centred on it so bots find their way through every one.
 */
export const LEVEL = { G: 0, M: 4.5, U: 9, H: 13.5 } as const;
/** Bounds (asymmetric in x: the west plaza is deeper than the east forecourt). */
export const BOUNDS = { minX: -71, maxX: 59, minZ: -48.5, maxZ: 48.5 };

/** Tier footprints: the base (T1, top 4.5), the second tier (T2, top 9), the platform (T3, top 13.5) and the hall. */
export const T1: R = [-41.75, -34.25, 36.75, 34.25];
export const T2: R = [-31.75, -26.75, 29.25, 26.75];
export const T3: R = [-20.25, -20.25, 20.25, 20.25];
export const HALL: R = [-14.5, -14.5, 14.5, 14.5];
/** Inside of the hall's walls: the memorial chamber. */
export const CHAMBER: R = [-13, -13, 13, 13];

/** The grand staircase: three flights of 30, 30 and 29 steps (89 in all), 12.5 m wide. */
export const GRAND = {
  z0: -6.25, z1: 6.25,
  flights: [[-49.75, -41.75, 0, 4.5, 30], [-39.25, -31.75, 4.5, 9, 30], [-28.25, -20.25, 9, 13.5, 29]] as [number, number, number, number, number][],
};
/** The rear (east) staircase: three flights straight up from the forecourt to the platform. */
export const REAR = {
  z0: -3.75, z1: 3.75,
  flights: [[36.75, 44.75, 0, 4.5], [29.25, 36.75, 4.5, 9], [20.25, 29.25, 9, 13.5]] as [number, number, number, number][],
};

/** The Gallery Hall's double-height void (ground floor to the second tier's slab). */
export const VOID: R = [-11.25, -6.25, 1.25, 6.25];

/** Spawn slots: [team, x, z, yaw]. SWAT faces west, Militia east. */
export const SPAWNS: [0 | 1, number, number, number][] = [
  ...[49.5, 52.5, 55.5].flatMap(x => [-5.25, -1.75, 1.75, 5.25].map(z => [0, x, z, Math.PI / 2] as [0, number, number, number])),
  ...[-66.5, -63.5, -60.5].flatMap(x => [-5.25, -1.75, 1.75, 5.25].map(z => [1, x, z, -Math.PI / 2] as [1, number, number, number])),
];

/** Map points: [id, name, x, y, z, radius]. */
export const POINTS = [
  ['A', 'Gallery Hall 展覽廳', 1.25, LEVEL.G, 0, 5.5],
  ['B', 'Memorial Chamber 紀念大廳', 5, LEVEL.H, 0, 6],
  ['C', 'Grand Staircase 大階梯', -30, LEVEL.U, 0, 5],
  ['D', 'North Garden 北花園', 12.5, LEVEL.G, -40, 5],
  ['E', 'Gift Shop 禮品店', 22.5, LEVEL.G, 23.75, 5],
] as const;

/** Ammo crates (the bases get theirs from the loader): [x, y, z]. */
export const AMMO: [number, number, number][] = [
  [-38, LEVEL.G, -2.5], [-14, LEVEL.G, -10.75], [34.75, LEVEL.G, -21.25], [-38.5, LEVEL.M, 30.5],
  [-17.5, LEVEL.U, 24], [32.5, LEVEL.M, -32.5], [-5, LEVEL.M, -16.5], [-10, LEVEL.H, 10.75],
];

const { G, M, U, H } = LEVEL;
/** Ground-floor and upper-gallery ceilings (the slab above each is 0.5 m thick). */
const G_TOP = M - 0.5, M_TOP = U - 0.5;
/** The hall's walls rise to the cornice under the roof. */
export const WALL_TOP = 31;

export function memorialHall(): MapDef {
  const b = new MapBuilder({
    id: 'memorial', name: 'Memorial Hall', region: 'ZHONGZHENG 中正區 / TAIPEI',
    description: 'National Chiang Kai-shek Memorial Hall (中正紀念堂): the 89-step grand staircase, terraces round the white hall, the statue chamber under the blue octagonal roof and the museum galleries below.',
    theme: 'memorial', halfX: 71, halfZ: 49, seed: 1980, roll: 0, ridge: 0,
    sabotage: { sites: ['A', 'B'], attackerSpawn: 1 },
    // Golden hour: a low sun from the west, down Liberty Square and onto the hall's front.
    sun: { x: -0.74, y: 0.42, z: 0.26 },
    ground: () => 0,
  });
  b.buildTerrain(4);
  const k = new Kit(b);

  const t1Holes: R[] = [];   // cut from the base's slab (the upper gallery's floor and the first terrace)
  const shaftHoles: R[] = []; // cut through the second tier's slab and the platform (stairwells to the chamber)

  stairs(k, t1Holes, shaftHoles);
  tiers(k, t1Holes, shaftHoles);
  groundWalls(k);
  upperWalls(k);
  hallWalls(k);

  galleries(k);
  chamber(k);
  roof(k);
  facades(k);
  plazas(k);
  gardens(k);
  backdrop(k);

  for (const [team, x, z, yaw] of SPAWNS) b.spawn(team, x, G, z, yaw);
  for (const [id, name, x, y, z, r] of POINTS) b.point(id, name, x, y, z, r);
  for (const [x, y, z] of AMMO) b.ammoCrate(x, y, z);

  const def = b.build();
  def.bounds = { ...BOUNDS };
  return def;
}

/** Every flight: the grand staircase, the rear staircase, the side stairs, the stairwells and the museum's stairs. */
function stairs(k: Kit, t1Holes: R[], shaftHoles: R[]) {
  // ---- Grand staircase (west): 30 + 30 + 29 = 89 steps, a landing at each terrace ----
  const { z0, z1 } = GRAND;
  for (const [x0, x1, y0, y1, steps] of GRAND.flights) {
    k.flight([x0, z0, x1, z1], y0, y1, 0, { steps, base: y0, color: C.step });
    for (const side of [[z0 - 0.4, z0], [z1, z1 + 0.4]]) k.cheek([x0, side[0], x1, side[1]], y0, y0, y1, 0, 4);
  }
  // A marble strip down the middle of each flight, between two lanes of steps (drawn only).
  for (const [x0, x1, y0, y1] of GRAND.flights) {
    for (let i = 0; i < 6; i++) {
      const a = x0 + (x1 - x0) * i / 6, c = x0 + (x1 - x0) * (i + 1) / 6, top = y0 + (y1 - y0) * (i + 1) / 6;
      k.shape([a, -0.6, c, 0.6], y0, top + 0.05, 'painted', C.marbleShade);
    }
  }

  // ---- Rear staircase (east): straight up, the cheeks stopping short of each terrace so it opens onto them ----
  for (const [x0, x1, y0, y1] of REAR.flights) {
    k.flight([x0, REAR.z0, x1, REAR.z1], y0, y1, 2, { base: y0, color: C.step });
    const open = y0 > 0 ? 2 : 0;
    for (const side of [[REAR.z0 - 0.4, REAR.z0], [REAR.z1, REAR.z1 + 0.4]]) {
      k.cheek([x0, side[0], x1 - open, side[1]], y0, y0 + (y1 - y0) * open / (x1 - x0), y1, 2, 3);
    }
  }

  // ---- Side stairs, north and south: plaza → first terrace → second terrace → platform ----
  for (const s of [-1, 1]) {
    const Z = (a: number, c: number): [number, number] => s < 0 ? [a, c] : [-c, -a];
    const rect = (x0: number, za: number, x1: number, zc: number): R => { const [p, q] = Z(za, zc); return [x0, p, x1, q]; };
    // S1: hugging the base's face, up to the first terrace.
    k.flight(rect(-15, -37.5, -7, -34.25), G, M, 0, { base: G });
    k.box(rect(-7, -37.5, -4, -34.25), G, M, 'paving', C.marble);
    k.cheek(rect(-15, -37.9, -7, -37.5), G, G, M, 0, 4);
    k.balustrade(rect(-7, -37.9, -4, -37.5), M);
    k.balustrade(rect(-4.4, -37.5, -4, -34.25), M);
    // S2: on the first terrace, hugging the second tier's face.
    k.flight(rect(5, -30, 13, -26.75), M, U, 2, { base: M });
    k.box(rect(2, -30, 5, -26.75), M, U, 'paving', C.marble);
    k.cheek(rect(5, -30.4, 11, -30), M, M + 4.5 * 2 / 8, U, 2, 3);
    k.balustrade(rect(2, -30.4, 5, -30), U);
    k.balustrade(rect(2, -30, 2.4, -26.75), U);
    // S3: on the second terrace, hugging the platform's face.
    k.flight(rect(-12.5, -23.5, -4.5, -20.25), U, H, 0, { base: U });
    k.box(rect(-4.5, -23.5, -1.5, -20.25), U, H, 'paving', C.marble);
    k.cheek(rect(-10.5, -23.9, -4.5, -23.5), U, U + 4.5 * 2 / 8, H, 0, 3);
    k.balustrade(rect(-4.5, -23.9, -1.5, -23.5), H);
    k.balustrade(rect(-1.9, -22.7, -1.5, -20.25), H);
    k.box(rect(-2.3, -23.5, -1.5, -22.7), H, H + 2.6, 'painted', C.marble);
    k.shape(rect(-2.4, -23.6, -1.4, -22.6), H + 2.6, H + 2.75, 'painted', C.blueDeep);
    k.shape(rect(-2.2, -23.4, -1.6, -22.8), H + 1.9, H + 2.5, 'neon', 0xffe2b0);

    // ---- Stairwell to the chamber (inside the hall's footprint): two flights round a landing ----
    // Flight a: upper gallery (4.5) east to the landing (9); flight b: back west into the chamber (13.5).
    k.flight(rect(2.5, -13, 10.5, -10.25), M, U, 0, { base: M, style: 'tile', color: C.chamberFloor });
    k.box(rect(10.5, -13.6, 13, -7), M, U, 'painted', C.cream);
    k.flight(rect(2.5, -9.75, 10.5, -7), U, H, 2, { base: M, style: 'tile', color: C.chamberFloor });
    k.box(rect(2.5, -10.25, 10.5, -9.75), M, H + 1, 'painted', C.cream);
    k.box(rect(2.5, -13.6, 10.5, -13), M, M_TOP, 'painted', C.cream);
    shaftHoles.push(rect(2.5, -13.6, 13, -7));
    // Rails round the shaft in the chamber (flight b arrives on its west side, z -9.75..-7).
    k.balustrade(rect(2.1, -13, 2.5, -10.25), H);
    k.balustrade(rect(2.1, -7, 13, -6.6), H);

    // ---- Museum stairs from the ground floor to the upper gallery (west wings) ----
    k.flight(rect(-24, -25.5, -16, -22), G, M, 2, { base: G, style: 'tile', color: C.redGranite });
    k.box(rect(-24, -25.9, -16, -25.5), G, M + 1, 'painted', C.cream);
    k.box(rect(-24, -22, -16, -21.6), G, M + 1, 'painted', C.cream);
    k.balustrade(rect(-16, -25.9, -15.6, -21.6), M);
    t1Holes.push(rect(-24, -25.5, -16, -22));
  }

  // ---- East lobby's stair to the upper gallery: one broad flight up the lobby's middle ----
  k.flight([12, -1.75, 20, 1.75], G, M, 2, { base: G, style: 'tile', color: C.redGranite });
  k.box([12, -2.15, 20, -1.75], G, M_TOP, 'painted', C.cream);
  k.box([12, 1.75, 20, 2.15], G, M_TOP, 'painted', C.cream);
  k.balustrade([20, -2.15, 20.4, 2.15], M);
  t1Holes.push([12, -1.75, 20, 1.75]);

  // The Gallery Hall's void, ringed by the upper gallery's balconies.
  t1Holes.push(VOID);
  const [vx0, vz0, vx1, vz1] = VOID, ring: R = [vx0 - 0.4, vz0 - 0.4, vx1 + 0.4, vz1 + 0.4];
  for (const side of ['n', 's', 'e', 'w'] as const) k.edge(ring, side, M);
}

/** The three tiers' slabs, the platform's fill and the terrace balustrades. */
function tiers(k: Kit, t1Holes: R[], shaftHoles: R[]) {
  // Base slab: the upper gallery's floor inside the second tier, the first terrace outside it.
  k.slab(T1, t1Holes, G_TOP, M, 'paving', C.granite);
  // Second tier's slab and the platform's fill, with the stairwells cut through both.
  k.slab(T2, shaftHoles, M_TOP, U, 'paving', C.granite);
  k.slab(T3, shaftHoles, U, H, 'paving', 0xf0ede6);
  // Floors and ceilings inside (drawn): red granite downstairs, pale marble in the chamber.
  k.shape([-40.75, -33.25, 35.75, 33.25], G - 0.04, G + 0.03, 'tile', C.redGranite);
  for (const r of cover([-30.75, -25.75, 28.25, 25.75], t1Holes)) k.shape(r, M, M + 0.03, 'tile', C.redGranite);
  for (const r of cover([-40.75, -33.25, 35.75, 33.25], t1Holes)) k.shape(r, G_TOP - 0.04, G_TOP - 0.01, 'painted', C.cream);
  for (const r of cover([-30.75, -25.75, 28.25, 25.75], shaftHoles)) k.shape(r, M_TOP - 0.04, M_TOP - 0.01, 'painted', C.cream);
  for (const r of cover(CHAMBER, shaftHoles)) k.shape(r, H, H + 0.03, 'tile', C.chamberFloor);

  // Terrace balustrades, open where the stairs arrive.
  const sides = (area: R, y: number, n: [number, number], w: [number, number], e: [number, number]) => {
    k.edge(area, 'n', y, [n]); k.edge(area, 's', y, [n]);
    k.edge(area, 'w', y, [w]); k.edge(area, 'e', y, [e]);
  };
  sides(T1, M, [-7, -4.4], [GRAND.z0 - 0.4, GRAND.z1 + 0.4], [REAR.z0 - 0.4, REAR.z1 + 0.4]);
  sides(T2, U, [2.4, 5], [GRAND.z0 - 0.4, GRAND.z1 + 0.4], [REAR.z0 - 0.4, REAR.z1 + 0.4]);
  sides(T3, H, [-4.5, -1.9], [GRAND.z0 - 0.4, GRAND.z1 + 0.4], [REAR.z0 - 0.4, REAR.z1 + 0.4]);

  // Planters on the terraces' outer halves (the side stairs block their inner halves), so no
  // terrace is one long open walk.
  for (const s of [-1, 1]) {
    const r = (x0: number, za: number, x1: number, zc: number): R => s < 0 ? [x0, za, x1, zc] : [x0, -zc, x1, -za];
    k.planter(r(-25, -33.85, -22, -30.2), M);
    k.planter(r(23.75, -33.85, 26.75, -30.2), M);
    k.planter(r(-24, -26.35, -21, -23.6), U);
    k.planter(r(10, -26.35, 13, -23.6), U);
    // Either side of the grand staircase's landings and the rear staircase's top flights.
    k.planter(r(-41.35, -10.5, -38.75, -8), M);
    k.planter(r(-31.35, -10.5, -28.75, -8), U);
    k.planter(r(26.25, -10.5, 28.85, -8), U);
    k.planter(r(33.6, -10.5, 36.35, -8), M);
    k.planter(r(-12, -29.9, -9, -27.15), M);
    k.planter(r(-3, -33.85, 0, -30.6), M);
  }
}

/** Ground floor (G): the base's outer walls and the museum's partitions. Doors are centred on the nav lattice. */
function groundWalls(k: Kit) {
  const door = (at: number, width = 3, top = 3.2) => ({ at, width, top: G + top });
  const OUT = 'paving', IN = 'painted';
  // Outer walls (1 m): west doors either side of the grand staircase, east doors either side of the rear one.
  k.wall('z', -41.25, T1[1], T1[3], G, G_TOP, [door(-25), door(-10), door(10), door(25)], OUT, C.marble, 1);
  k.wall('z', 36.25, T1[1], T1[3], G, G_TOP, [door(-27.5), { at: -6.25, width: 3.5, top: G + 3.4 }, { at: 6.25, width: 3.5, top: G + 3.4 }, door(27.5)], OUT, C.marble, 1);
  for (const z of [-33.75, 33.75]) k.wall('x', z, -40.75, 35.75, G, G_TOP, [door(-32.5), door(-17.5), door(22.5)], OUT, C.marble, 1);
  // Partitions (0.8 m).
  k.wall('z', -26.25, -33.25, 33.25, G, G_TOP, [door(-30), door(-5), door(5), door(30)], IN, C.cream);
  for (const z of [-13.75, 13.75]) k.wall('x', z, -40.75, -26.65, G, G_TOP, [door(-32.5)], IN, C.cream);
  for (const z of [-8.75, 8.75]) k.wall('x', z, -25.85, 35.75, G, G_TOP, [door(-17.5), door(-2.5), door(22.5)], IN, C.cream);
  k.wall('z', -11.25, -33.25, -9.15, G, G_TOP, [door(-27.5), door(-15)], IN, C.cream);
  k.wall('z', -11.25, 9.15, 33.25, G, G_TOP, [door(15), door(27.5)], IN, C.cream);
  k.wall('z', 6.25, -33.25, 33.25, G, G_TOP, [door(-20), door(-5), door(5), door(20)], IN, C.cream);
}

/** Upper gallery (M): the second tier's outer walls and the gallery partitions. */
function upperWalls(k: Kit) {
  const door = (at: number, width = 3, top = 3.2) => ({ at, width, top: M + top });
  k.wall('z', -31.25, T2[1], T2[3], M, M_TOP, [door(-15), door(15)], 'paving', C.marble, 1);
  k.wall('z', 28.75, T2[1], T2[3], M, M_TOP, [door(-12.5), door(12.5)], 'paving', C.marble, 1);
  for (const z of [-26.25, 26.25]) k.wall('x', z, -30.75, 28.25, M, M_TOP, [door(-17.5), door(17.5)], 'paving', C.marble, 1);
  // West gallery (behind the grand staircase's upper flights) and east gallery (behind the rear stair).
  k.wall('z', -21.25, -25.75, 25.75, M, M_TOP, [{ at: -23.75, width: 4.4, top: M_TOP }, door(-17.5), door(-5), door(5), door(17.5), { at: 23.75, width: 4.4, top: M_TOP }], 'painted', C.cream);
  for (const z of [-8.75, 8.75]) k.wall('x', z, -30.75, -21.65, M, M_TOP, [door(-26.25)], 'painted', C.cream);
  k.wall('z', 21.25, -25.75, 25.75, M, M_TOP, [door(-20), door(-12.5), door(12.5), door(20)], 'painted', C.cream);
  // The balcony hall round the Gallery Hall's void, walled off from the north and south galleries
  // (the stairwells to the chamber open off those galleries, east of these walls).
  for (const z of [-10, 10]) k.wall('x', z, -20.85, 2.1, M, M_TOP, [door(-15)], 'painted', C.cream);
  for (const z of [-8.75, 8.75]) k.wall('x', z, 21.65, 28.25, M, M_TOP, [door(25)], 'painted', C.cream);
}

/** The hall's walls on the platform: the tall bronze doors west, side doors north and south, rear doors east. */
function hallWalls(k: Kit) {
  const t = 1.5;
  k.wall('z', -13.75, HALL[1], HALL[3], H, WALL_TOP, [{ at: 0, width: 6, top: H + 10 }], 'painted', C.marble, t);
  k.wall('z', 13.75, HALL[1], HALL[3], H, WALL_TOP, [{ at: -5, width: 3, top: H + 4 }, { at: 5, width: 3, top: H + 4 }], 'painted', C.marble, t);
  for (const z of [-13.75, 13.75]) k.wall('x', z, -13, 13, H, WALL_TOP, [{ at: -7.5, width: 3, top: H + 6 }], 'painted', C.marble, t);
  // Ceiling over the chamber (the coffers and the emblem are drawn under it, memorial-decor.ts).
  k.box([-13, -13, 13, 13], 29, 29.6, 'painted', C.cream);
}
