import { MapBuilder } from './builder';
import { backdrop, dressing } from './ximending-decor';
import { Ximen, type R } from './ximending-kit';
import { arcade, cinema, galleries, hotel, nightMarket, redHouse, stationPlaza, yard } from './ximending-landmarks';
import { streets } from './ximending-blocks';
import { lanes } from './ximending-streets';
import { BOUNDS, PAD, ROOF } from './ximending-plan';
import type { Decor, MapDef } from './types';

/** The map's Chinese name, for the zh-TW map list. */
export const XIMENDING_NAME_ZH = '西門町';

/**
 * Ximending (西門町), Taipei: close-quarters fighting (1v1 and 6v6, Elimination and Sabotage) in a
 * stylised pedestrian district under neon: three east–west lanes crossed by three north–south
 * streets, a cinema with a marquee balcony, a game arcade with a helicopter pad on its roof, a
 * covered night market, the Red House (西門紅樓) and its brick square, ringed by a road for cars.
 * The layout is this project's own, drawn in the spirit of the real district and laid out on the
 * bots' 2.5 m lattice; it is a composite, not a survey, and not taken from any other game.
 *
 * Teams and objectives:
 *   SWAT (team 0) deploys at the west end, in the plaza by the MRT exit; Militia (team 1, Sabotage
 *   attackers) at the east end, in a construction yard;
 *   A: Cinema Street (電影街), the cinema's front on lane N, under its balcony;
 *   B: the Red House square (西門紅樓), on lane S;
 *   C–E are landmarks bots roam to: the night market, Hanzhong St's crossing and the arcade.
 * The roofs of the arcade (with the helicopter's pad) and the hotel across lane M are joined by a
 * skybridge and reached by ladders. The ring road carries the cars; scooters wait at both bases.
 *
 * Coordinates: +x east, +z south, metres; ground at y = 0.
 */
export { BOUNDS };

/** Spawn slots: [team, x, z, yaw]. SWAT faces east, Militia west. */
export const SPAWNS: [0 | 1, number, number, number][] = [
  ...[-60, -56.5, -53].flatMap(x => [-5.25, -1.75, 1.75, 5.25].map(z => [0, x, z, -Math.PI / 2] as [0, number, number, number])),
  ...[53, 56.5, 60].flatMap(x => [-5.25, -1.75, 1.75, 5.25].map(z => [1, x, z, Math.PI / 2] as [1, number, number, number])),
];

/** Map points: [id, name, x, y, z, radius]. */
export const POINTS = [
  ['A', 'Cinema Street 電影街', -15, 0, -32.5, 7],
  ['B', 'Red House 西門紅樓', -8.5, 0, 31, 7],
  ['C', 'Night Market 西門夜市', -22.5, 0, 0, 5],
  ['D', 'Hanzhong St 漢中街', 0, 0, 0, 5],
  ['E', 'Game Arcade 電玩城', 24, 0, -16, 6],
] as const;

/** Ammo crates in the lanes (the bases get theirs from the loader): [x, y, z]. */
export const AMMO: [number, number, number][] = [
  [-44.5, 0, -32.5], [21, 0, -32.5], [-35, 0, 0], [26, 0, 0], [-35, 0, 32.5], [22, 0, 32.5],
];

const E = -Math.PI / 2, W = Math.PI / 2, N = 0, S = Math.PI;
/**
 * Drivable vehicles: [kind, x, y, z, yaw]. The ring road is two lanes wide on each side, with
 * traffic keeping right (clockwise: east on the north side, south on the east, west on the south,
 * north on the west): the inner lane of each side is the lap (x ±74.5, z ±57), the outer lane holds
 * the parked cars. Scooters wait at both bases and in the streets, and the helicopter on the
 * arcade's roof.
 */
export const VEHICLES: [kind: 'car' | 'scooter' | 'heli', x: number, y: number, z: number, yaw: number][] = [
  ['car', -74.5, 0, 14, N], ['car', -74.5, 0, 22, N],
  ['car', 74.5, 0, -14, S], ['car', 78.5, 0, 16, N],
  ['car', -30, 0, -63, W], ['car', 30, 0, 63, E],
  // Two on the ring's outer lanes (long runs), three at each base's edge, two in the streets.
  ['scooter', 12, 0, -63, W], ['scooter', -12, 0, 63, E],
  ['scooter', -51.8, 0, 13.4, W], ['scooter', -51.8, 0, 12.2, W], ['scooter', -51.8, 0, 11, W],
  ['scooter', 51.8, 0, -13.4, E], ['scooter', 51.8, 0, -12.2, E], ['scooter', 51.8, 0, -11, E],
  ['scooter', -42.5, 0, -20, S], ['scooter', 42.5, 0, 20, N],
  ['heli', (PAD[0] + PAD[2]) / 2, ROOF, (PAD[1] + PAD[3]) / 2, N],
];

export function ximending(): MapDef {
  const b = new MapBuilder({
    id: 'taipei', name: 'Taipei', region: 'XIMENDING 西門町 / TAIPEI',
    description: 'Ximending after dark: neon lanes, a cinema with a marquee balcony, a game arcade with a helipad, the night market and the Red House square, ringed by a road for cars.',
    theme: 'taipei', halfX: 81, halfZ: 66, seed: 101, roll: 0, ridge: 0,
    sabotage: { sites: ['A', 'B'], attackerSpawn: 1 },
    // Low evening sun from the west, down the lanes toward the arcade.
    sun: { x: -0.78, y: 0.4, z: 0.2 },
    ground: () => 0,
  });
  b.buildTerrain(4);
  const t = new Ximen(b);

  streets(t);
  cinema(t);
  arcade(t);
  hotel(t);
  redHouse(t);
  nightMarket(t);
  stationPlaza(t);
  yard(t);
  lanes(t);
  screens(t);
  dressing(t);
  // Last of the street furniture: the galleries' posts step round whatever already stands under them.
  galleries(t);
  backdrop(t);

  for (const [team, x, z, yaw] of SPAWNS) b.spawn(team, x, 0, z, yaw);
  for (const [id, name, x, y, z, r] of POINTS) b.point(id, name, x, y, z, r);
  for (const [x, y, z] of AMMO) b.ammoCrate(x, y, z);
  for (const [kind, x, y, z, yaw] of VEHICLES) b.vehicle(kind, x, y, z, yaw);
  // The city past the map: its skyline, with Taipei 101 on the horizon (client dressing).
  b.raw({ kind: 'dressing', set: 'ximending', x: 0, z: 0 });

  return outsideAsScenery(b.build());
}

/** The screens across each base's mouth: two walls of police or site barriers, one after the other, so no lane sees in. */
function screens(t: Ximen) {
  const wall = (r: R, text: [string, string], color: number) => {
    t.box(r, 0, 2.4, 'painted', 0xe8ecf0);
    // The stripe stands a hair proud of the wall (a box in the same faces would flicker).
    t.shape([r[0] - 0.02, r[1] - 0.02, r[2] + 0.02, r[3] + 0.02], 0.7, 1.4, 'painted', color);
    const [x0, z0, x1, z1] = r, mid = (z0 + z1) / 2;
    for (const [px, rot] of [[x0 - 0.04, -Math.PI / 2], [x1 + 0.04, Math.PI / 2]] as const) t.sign('board', px, 1.9, mid, rot, 3.6, 0.7, text[0], '#1a3a7a', '#ffffff', text[1]);
    t.shape([x0 - 0.03, z0, x1 + 0.03, z1], 2.4, 2.5, 'steel', 0xb8bcc0);
  };
  wall([-51.5, -15, -50, 1.5], ['警戒線 請勿進入', 'POLICE LINE'], 0x1a3a7a);
  wall([-46.5, -1.5, -45, 15], ['警戒線 請勿進入', 'POLICE LINE'], 0x1a3a7a);
  wall([50, -1.5, 51.5, 15], ['施工中 請繞行', 'SITE · KEEP OUT'], 0xc8641a);
  wall([45, -15, 46.5, 1.5], ['施工中 請繞行', 'SITE · KEEP OUT'], 0xc8641a);
}

/**
 * Past the bounds the city is only scenery: its collision boxes go (drawn ones become shapes),
 * which keeps the solid count and the navigation build to the playable area.
 */
function outsideAsScenery(def: MapDef): MapDef {
  const { minX, maxX, minZ, maxZ } = def.bounds, m = 2;
  const out = (s: MapDef['solids'][number]) => s.maxX < minX - m || s.minX > maxX + m || s.maxZ < minZ - m || s.minZ > maxZ + m;
  const index = new Int32Array(def.solids.length).fill(-1);
  const solids: MapDef['solids'] = [];
  def.solids.forEach((s, i) => { if (!out(s)) { index[i] = solids.length; solids.push(s); } });
  const decor: Decor[] = def.decor.map(d => {
    if (d.kind !== 'block') return d;
    const s = def.solids[d.solid];
    if (index[d.solid] >= 0) return { ...d, solid: index[d.solid] };
    return { kind: 'shape', min: [s.minX, s.minY, s.minZ], max: [s.maxX, s.maxY, s.maxZ], style: d.style, ...(d.color === undefined ? {} : { color: d.color }) };
  });
  // Ramps, ladders and the rest keep their indices: the backdrop has none.
  return { ...def, solids, decor, bounds: { ...BOUNDS } };
}
