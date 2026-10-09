import { MapBuilder } from './builder';
import { streets } from './sanchong-blocks';
import { backdrop, dressing } from './sanchong-decor';
import { bases, bridge, factory, levee, market, temple } from './sanchong-landmarks';
import { Town } from './sanchong-kit';
import { BOUNDS, DECK } from './sanchong-plan';
import type { MapDef } from './types';

/** The map's Chinese name, for the zh-TW map list. */
export const SANCHONG_NAME_ZH = '三重';

/**
 * Sanchong (三重區, New Taipei): close-quarters city fighting (1v1 and 6v6) in the old blocks across
 * the Tamsui River from Taipei: four- and five-storey walk-ups (公寓) with iron window cages and tin
 * shacks on their roofs, arcades (騎樓) along the main street, a covered market, small ironworks
 * and print shops, and lanes three to five metres wide with dog-leg corners. Stylised to the game's
 * low-poly look; the places are composites, not a survey.
 *
 * Three lanes run east–west between the bases, with connectors between them:
 *   north   the main street (重新路-like) under its arcades, ending at the temple square (廟口)
 *           in front of the temple, with the under-bridge lane (橋下) behind it, and above that
 *           the Taipei Bridge approach (台北橋引道): a raised deck with the scooter ramp (機車瀑布)
 *           at its west end and a stair at its east end, high and exposed;
 *   middle  the covered market (市場): two aisles of stalls round a centre row, blocked in turn
 *           so a run through it weaves from aisle to aisle;
 *   south   the back alleys (巷弄): three-to-four-metre lanes that zigzag between old houses, with
 *           a little earth-god shrine (土地公廟) in a pocket square.
 * The river levee (淡水河堤防) is the east edge, with the levee road (環河北路) along its foot.
 *
 * Teams and objectives:
 *   SWAT (team 0) deploys on the levee road (east), Militia (team 1, Sabotage attackers) in the
 *   night-market car park (west), by a temple-fair neon truck (電子花車);
 *   A: the temple square (廟口): the temple, its incense burner, the opera stage and the gold furnace;
 *   B: the ironworks yard (鐵工廠) behind the market, between the workshop and the print shop;
 *   C–E are landmarks bots roam to: the bridge deck, the market's crossing and the shrine pocket.
 *
 * Coordinates: +x east, +z south, metres; ground at y = 0. The bots' 2.5 m lattice runs through
 * x and z = 0, so lanes, doors and gates are centred on multiples of 2.5.
 */
export { BOUNDS, DECK, LEVEE_X, Z } from './sanchong-plan';

/** Spawn slots: [team, x, z, yaw]. SWAT faces west, Militia east. */
export const SPAWNS: [0 | 1, number, number, number][] = [
  ...[63, 66, 69].flatMap(x => [-5.25, -1.75, 1.75, 5.25].map(z => [0, x, z, Math.PI / 2] as [0, number, number, number])),
  ...[-73, -70, -67].flatMap(x => [-5.25, -1.75, 1.75, 5.25].map(z => [1, x, z, -Math.PI / 2] as [1, number, number, number])),
];

/** Map points: [id, name, x, y, z, radius]. */
export const POINTS = [
  ['A', 'Temple Square 廟口', 7.5, 0, -42.5, 6],
  ['B', 'Ironworks Yard 鐵工廠', 7.5, 0, 17.5, 6],
  ['C', 'Taipei Bridge 台北橋', 12.5, DECK, -60, 5],
  ['D', 'Market 市場', 0, 0, 0, 4],
  ['E', 'Shrine Alley 土地公廟', 0, 0, 45, 4],
] as const;

/** Ammo crates, one in each lane near the middle (the bases get theirs from the loader): [x, y, z]. */
export const AMMO: [number, number, number][] = [
  [-22.5, 0, -40], [2.5, 0, -3.75], [-2.5, 0, 45],
];

/** Drivable scooters at both bases (Sanchong rides scooters): [x, z, yaw]. */
export const SCOOTERS: [number, number, number][] = [
  [-73.75, 9.75, 0], [-72.5, 9.75, 0],
  [68.75, -9.75, Math.PI], [67.5, -9.75, Math.PI],
];

export function sanchong(): MapDef {
  const b = new MapBuilder({
    id: 'sanchong', name: 'Sanchong', region: 'SANCHONG 三重區 / NEW TAIPEI',
    description: 'Old Sanchong across the Tamsui River: walk-ups with iron window cages, arcades on the main street, a temple square, a covered market, an ironworks yard and back alleys, under the Taipei Bridge ramp.',
    theme: 'sanchong', halfX: 76, halfZ: 66, seed: 2412, roll: 0, ridge: 0,
    sabotage: { sites: ['A', 'B'], attackerSpawn: 1 },
    // Late afternoon: the sun low in the west-south-west, down the lanes toward the river.
    sun: { x: -0.72, y: 0.46, z: 0.36 },
    ground: () => 0,
  });
  b.buildTerrain(4);
  const t = new Town(b);

  bridge(t);
  temple(t);
  market(t);
  factory(t);
  streets(t);
  levee(t);
  bases(t);
  dressing(t);
  backdrop(t);

  for (const [team, x, z, yaw] of SPAWNS) b.spawn(team, x, 0, z, yaw);
  for (const [id, name, x, y, z, r] of POINTS) b.point(id, name, x, y, z, r);
  for (const [x, y, z] of AMMO) b.ammoCrate(x, y, z);
  for (const [x, z, yaw] of SCOOTERS) b.vehicle('scooter', x, 0, z, yaw);

  const def = b.build();
  def.bounds = { ...BOUNDS };
  return def;
}
