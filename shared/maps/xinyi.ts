import { MapBuilder } from './builder';
import { Xinyi } from './xinyi-kit';
import { blocks, boulevards, forecourts, ground, streetCover } from './xinyi-city';
import { helipad, hillside, skywalk, tower, village, westPlaza } from './xinyi-landmarks';
import { fill, mall, sunkenGarden } from './xinyi-mall';
import { B1, BOUNDS, FILL, SKY, floorAt, hillAt } from './xinyi-plan';
import type { MapDef } from './types';

/** The map's Chinese name, for the zh-TW map list. */
export const XINYI_NAME_ZH = '台北101・信義';

/**
 * Taipei 101 · Xinyi (台北101・信義): a big map (24v24) in a stylised Xinyi business district,
 * laid out by this project in the spirit of the real one (not a survey, and not taken from any
 * other game): a department-store row and Xinyi Rd on the north, Heping Rd and an old village on
 * the south, Keelung Rd on the west and Songren Rd on the east, and between them Taipei 101, its
 * west plaza, the podium mall (opened as the centre of the fight) and a sunken garden. About
 * 272 × 292 m; the tower is scenery (only its base collides).
 *   SWAT (team 0) deploys in a forecourt on the north sidewalk, behind a police cordon; Militia
 *   (team 1, Sabotage attackers) in one on the south, behind site hoarding;
 *   A: the mall's atrium, a food court sunk to B1 under a gallery and a bridge, with stairs on
 *      all three floors and a B1 passage out to the sunken garden;
 *   B: the west plaza by the tower's foot, round the sculpture and an MRT exit;
 *   C–E are landmarks bots roam to: the skywalk over Xinyi Rd, the sunken garden and the village.
 * Elephant Mountain's foot (象山) rises along the east edge. Cars wait on both boulevards, scooters
 * at the bases, and the helicopter on a pad at Xinyi Rd's east end.
 *
 * Coordinates: +x east, +z south, metres; the street is y = 0.
 */
export { BOUNDS };

/** Spawn slots: [team, x, z, yaw]. SWAT faces south, Militia north; the loader pads each base to 24. */
export const SPAWNS: [0 | 1, number, number, number][] = [
  ...[-12.5, -7.5, -2.5, 2.5, 7.5, 12.5].flatMap(x => [-108, -104.5].map(z => [0, x, z, Math.PI] as [0, number, number, number])),
  ...[27.5, 32.5, 47.5, 52.5, 57.5, 42.5].flatMap(x => [96.5, 99.5].map(z => [1, x, z, 0] as [1, number, number, number])),
];

/** Map points: [id, name, x, y, z, radius]. */
export const POINTS = [
  ['A', 'Mall Atrium 購物中心中庭', 22, B1, -6, 7],
  ['B', 'West Plaza 101西側廣場', -92, 0, 2, 7],
  ['C', 'Xinyi Skywalk 信義空橋', -94, SKY, -85, 5],
  ['D', 'Sunken Garden 下沉花園', 70, B1, 12, 6],
  ['E', 'Village 眷村', 45, 0, 114, 7],
] as const;

/** Ammo crates: [x, y, z]; the bases get theirs from the loader. */
export const AMMO: [number, number, number][] = [
  [-72, 0, -72], [40, 0, -74], [-104, 0, -30], [-90, 0, 40], [-20, 0, 58], [90, 0, 60], [100, 0, -60], [108, 0, 20],
  [6, 0, -44], [30, 6.65, 44], [76, B1, -22], [16, 0, 116.5], [88, 0, 116.5], [-40, 0, 96], [-110, 0, 90],
];

const E = -Math.PI / 2, W = Math.PI / 2, N = 0, S = Math.PI;
/** Drivable vehicles: [kind, x, z, yaw]. Cars drive on the right: eastbound on the south half of each boulevard. */
export const VEHICLES: [kind: 'car' | 'scooter' | 'heli', x: number, z: number, yaw: number][] = [
  ['car', -50, -93, W], ['car', 50, -93, W],
  ['car', -40, 85, E], ['car', 12, 85, E],
  ['car', 101, -30, S],
  ['car', -126, 20, N],
  ['scooter', -20, -108, W], ['scooter', -20, -106.8, W], ['scooter', -20, -105.6, W],
  ['scooter', 13, 97.8, W], ['scooter', 13, 96.6, W], ['scooter', 13, 95.4, W],
  ['scooter', -108, 8, N], ['scooter', -108, 9.4, N],
  ['heli', 106, -88, N],
];

export function xinyi(): MapDef {
  const b = new MapBuilder({
    id: 'xinyi', name: 'Taipei 101 · Xinyi', region: 'XINYI 信義 / TAIPEI',
    description: 'Xinyi after dark: Taipei 101 over its podium mall with a sunken food court, a glazed skywalk over Xinyi Rd, the west plaza, a sunken garden and an old village under Elephant Mountain.',
    theme: 'xinyi', halfX: BOUNDS.maxX, halfZ: BOUNDS.maxZ, seed: 101, roll: 0, ridge: 0,
    sabotage: { sites: ['A', 'B'], attackerSpawn: 1 },
    big: true,
    // Moonlight from the north-east, over the hills.
    sun: { x: 0.45, y: 0.62, z: -0.4 },
    // The street is flat; Elephant Mountain rises past the east road, eased down toward the terrain grid's edge.
    ground: (x, z) => {
      const h = hillAt(x, z) * (1 - 0.8 * Math.min(1, Math.max(0, (Math.max(Math.abs(x), Math.abs(z)) - 165) / 45)) ** 2);
      return h > 0.06 ? h : 0;
    },
  });
  // The dig under the mall and the garden: one pad, its blend hidden inside the fill's walls.
  b.pad((FILL[0] + FILL[2]) / 2, (FILL[1] + FILL[3]) / 2, FILL[2] - FILL[0] - 6, FILL[3] - FILL[1] - 6, -5.8, 2.6);
  b.buildTerrain(3);
  const t = new Xinyi(b);

  ground(t);
  fill(t);
  blocks(t);
  tower(t);
  mall(t);
  sunkenGarden(t);
  westPlaza(t);
  skywalk(t);
  village(t);
  hillside(t);
  boulevards(t);
  streetCover(t);
  forecourts(t);
  helipad(t, 106, -88);

  for (const [team, x, z, yaw] of SPAWNS) b.spawn(team, x, floorAt(x, z), z, yaw);
  for (const [id, name, x, y, z, r] of POINTS) b.point(id, name, x, y, z, r);
  for (const [x, y, z] of AMMO) b.ammoCrate(x, y, z);
  for (const [kind, x, z, yaw] of VEHICLES) b.vehicle(kind, x, floorAt(x, z), z, yaw);
  // The city past the map: its skyline and the hills (client dressing).
  b.raw({ kind: 'dressing', set: 'xinyi', x: 0, z: 0 });

  return b.build();
}
