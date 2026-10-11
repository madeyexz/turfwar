import { rng } from '../math';
import { chicane } from './ximending-streets';
import { GLASS, Xinyi, type R } from './xinyi-kit';
import { B1, BOUNDS, DUG, FILL, IN, MILITIA_COURT, PLAZA, ROAD, SWAT_COURT, VILLAGE } from './xinyi-plan';
import { cover } from './memorial-kit';

/**
 * Xinyi's streets and blocks (xinyi.ts): the roads and their paint, the department-store row and
 * the towers round the map, the boulevards' cover and the two bases' forecourts.
 */

const ASPHALT = 0x44464b;

/** Roads, sidewalks and paving. Terrain under the city is flat; the shapes carry the colour. */
export function ground(t: Xinyi) {
  const { minX, maxX, minZ, maxZ } = BOUNDS;
  const road = (r: R) => t.floor(r, ASPHALT, 'asphalt', -0.03, 0.004);
  // The tower block's own paving (sunken floors aside: the mall's floors are built with it).
  const pave: R = [minX, minZ, 116, maxZ];
  const roads: R[] = [
    [minX, ROAD.xinyi[0], 116, ROAD.xinyi[1]], [minX, ROAD.heping[0], 116, ROAD.heping[1]],
    [ROAD.keelung[0], minZ, ROAD.keelung[1], maxZ], [ROAD.songren[0], minZ, ROAD.songren[1], maxZ],
  ];
  for (const r of cover(pave, [...roads, ...DUG, IN])) t.floor(r, 0xcfcac2, 'paving');
  for (const r of roads) road(r);
  // Lane paint: a dashed line between each road's lanes, kerb lines, crossings.
  const mark = (x: number, z: number, w: number, d: number, color: number) => t.raw({ kind: 'marking', x, y: 0.02, z, w, d, color });
  for (let x = minX + 2; x < 114; x += 6) {
    for (const z of [-93, -83, 75, 85]) mark(x + 1.5, z, 3, 0.15, 0xf0f0e8);
    mark(x + 1.5, -88, 3, 0.2, 0xd8a830); mark(x + 1.5, 80, 3, 0.2, 0xd8a830);
  }
  for (let z = minZ + 2; z < maxZ; z += 6) { for (const x of [-127, 101, 111]) mark(x, z + 1.5, 0.15, 3, 0xf0f0e8); }
  for (const x of [-100, -60, -10, 40, 90]) for (let i = 0; i < 10; i++) { mark(x, -97 + i * 1.9 + 0.5, 3.4, 0.9, 0xf0f0e8); mark(x, 71 + i * 1.9 + 0.5, 3.4, 0.9, 0xf0f0e8); }
  // The medians: planted strips down the middle of both boulevards.
  for (const z of [-88, 80]) t.shape([minX, z - 0.6, 116, z + 0.6], 0, 0.3, 'slab', 0x9a9894);
}

/** Median trees and bus stops along both boulevards (the trunks and shelters are cover). */
export function boulevards(t: Xinyi) {
  const data: number[] = [];
  const tree = (x: number, z: number, s = 1) => {
    data.push(x, 0, z, (x * 5 + z) % 6.28, s, 0, 0xffffff, 0);
    t.box([x - 0.4, z - 0.4, x + 0.4, z + 0.4], 0, 3.6, 'invisible');
  };
  for (let x = -126; x < 92; x += 11) { tree(x, -88, 0.95); tree(x + 5, 80, 0.95); }
  // Rows of street trees on the sidewalks next to the buildings.
  for (let x = -126; x < 110; x += 14) { tree(x, -75.5, 0.85); tree(x + 7, 92.5, 0.85); }
  t.raw({ kind: 'instances', model: 'tree:camphor', data });
  // Bus stops: a glass shelter, lit timetable and a bench, on the sidewalks.
  for (const x of [-66, 44]) t.shelter(x, -77.4, 5, true, 1);
  for (const x of [-48, 70]) t.shelter(x, 90.4, 5, true, -1);
}

/** Cover on the boulevards and the sidewalks beside them: buses and vans on the lanes in staggered places, kiosks, planters. */
export function streetCover(t: Xinyi) {
  const vanColors = [0xf0f0ec, 0xe8d8a8, 0xb8d0e0, 0xd8b8b0];
  let i = 0;
  // Buses broken down in the lanes (12 m, covering one half of the carriageway), alternating sides.
  const buses: [number, number, number][] = [
    [-110, -97.4, 0xc83a2a], [-70, -86.2, 0x2a6ab8], [-28, -97.4, 0xe8b830], [20, -86.2, 0xc83a2a], [62, -97.4, 0x2a6ab8],
    [-104, 71.4, 0x2a6ab8], [-64, 82.6, 0xc83a2a], [-20, 71.4, 0xe8b830], [26, 82.6, 0x2a6ab8], [76, 71.4, 0xc83a2a],
  ];
  for (const [x, z, color] of buses) t.bus([x, z, x + 12, z + 2.6], color, ['307', '218', '234', '651', '綠1'][i++ % 5]);
  // Booths and planters on the sidewalks, every ~30 m.
  for (let x = -120; x < 110; x += 30) {
    t.booth([x, -76.5, x + 3.2, -74.3], 's', ['報攤', '咖啡', '彩券', '冰'][i % 4], ['NEWS', 'COFFEE', 'LOTTERY', 'ICE'][i % 4], [0x2a6a4a, 0x5a3a28, 0xc8641a, 0x1a7a3a][i % 4]);
    t.booth([x + 15, 91.5, x + 18.2, 93.7], 'n', ['便利商店', '茶飲', '報攤', '烤香腸'][i % 4], ['CONVENIENCE', 'TEA', 'NEWS', 'SAUSAGE'][i % 4], [0x2a6ab8, 0x1a7a3a, 0x2a6a4a, 0xc8141e][i % 4]);
    i++;
  }
  // The Keelung and Songren Rd crossings: concrete barriers as lane dividers.
  for (let z = -60; z < 60; z += 40) { t.jersey([-122.5, z, -121.9, z + 6]); t.jersey([105.7, z + 10, 106.3, z + 16]); }
  void vanColors; void chicane;
}

/** The department-store row on the north side, the towers along the west and south and the lots round the map. */
export function blocks(t: Xinyi) {
  const random = rng(31);
  const tint = () => GLASS[Math.floor(random() * GLASS.length)];
  // North row: stores and towers, with alleys between them every few blocks.
  const north: [number, number, number][] = [[-134, -98, 44], [-90, -54, 62], [-46, -10, 38], [-2, 34, 70], [42, 78, 50], [86, 114, 34]];
  north.forEach(([x0, x1, h], k) => t.office([x0, -146, x1, -114], h, tint(), 10 + k, 's'));
  // West side beyond Keelung Rd: towers facing east.
  const west: [number, number, number][] = [[-110, -70, 56], [-62, -26, 46], [-18, 18, 64], [26, 66, 42], [74, 112, 58]];
  void west;
  // The southern band beyond Heping Rd (west of the village): offices facing north.
  const south: [number, number, number][] = [[-134, -98, 38], [-90, -54, 54], [-46, -10, 44], [-2, 0, 0]];
  south.forEach(([x0, x1, h], k) => { if (h) t.office([x0, 108, x1, 140], h, tint(), 30 + k, 'n'); });
  // West of Keelung Rd (outside the bounds): a long wall of towers, drawn only.
  for (let z = -140; z < 140; z += 32) t.office([-176, z, -144, z + 28], 40 + Math.floor(random() * 30), tint(), 50 + z, 'e');
  // South and north beyond the first rows.
  for (let x = -176; x < 130; x += 34) { t.office([x, 150, x + 28, 186], 40 + Math.floor(random() * 30), tint(), 70 + x, 'n'); t.office([x, -190, x + 28, -156], 44 + Math.floor(random() * 30), tint(), 90 + x, 's'); }
  void VILLAGE; void PLAZA; void B1; void FILL;
}

/** SWAT's forecourt on the north sidewalk and Militia's on the south: cordons of vans, barriers and kiosks with two gates each, staggered. */
export function forecourts(t: Xinyi) {
  const [sx0, sz0, sx1, sz1] = SWAT_COURT, [mx0, mz0, mx1, mz1] = MILITIA_COURT;
  // SWAT: a police cordon along the road edge (z -98.6) with gates at x -18 and 18, panels inside in front of each.
  const cordon = (x0: number, x1: number, z: number, color: number, text: [string, string]) => {
    t.box([x0, z - 0.4, x1, z + 0.4], 0, 2.4, 'painted', 0xe8ecf0);
    t.box([x0, z - 0.4, x1, z + 0.4], 0.7, 1.4, 'painted', color);
    t.shape([x0, z - 0.43, x1, z + 0.43], 2.4, 2.5, 'steel', 0xb8bcc0);
    for (const s of [-1, 1]) t.sign('board', (x0 + x1) / 2, 1.9, z + s * 0.45, s < 0 ? 0 : Math.PI, Math.min(4, x1 - x0 - 0.6), 0.7, text[0], '#1a3a7a', '#ffffff', text[1]);
  };
  cordon(sx0, -22, sz1 - 0.6, 0x1a3a7a, ['警戒線 請勿進入', 'POLICE LINE']);
  cordon(-14, 14, sz1 - 0.6, 0x1a3a7a, ['警戒線 請勿進入', 'POLICE LINE']);
  cordon(22, sx1, sz1 - 0.6, 0x1a3a7a, ['警戒線 請勿進入', 'POLICE LINE']);
  // Inside, a staggered baffle behind each gate so the road never sees across the base.
  t.hoarding([-28, sz1 - 3.9, -7, sz1 - 3.5], 's', undefined, 0x1a3a7a);
  t.hoarding([7, sz1 - 3.9, 28, sz1 - 3.5], 's', undefined, 0x1a3a7a);
  // Closed ends (a hoarding each), so the sidewalk's long views stop at the base.
  t.hoarding([sx0 - 0.6, sz0, sx0, sz1 - 0.2], 'e', ['安全第一', 'SAFETY FIRST'], 0x1a3a7a);
  t.hoarding([sx1, sz0, sx1 + 0.6, sz1 - 0.2], 'w', undefined, 0x1a3a7a);
  t.sign('billboard', 0, 4.4, sz0 + 0.4, 0, 12, 3, '信義', '#0a2a5a', '#ffffff', 'XINYI');
  // Militia: barricades of site hoarding and containers with gates at x 28 and 52.
  const fence = (x0: number, x1: number, z: number) => {
    t.hoarding([x0, z - 0.3, x1, z + 0.3], 'n', undefined, 0xc8641a);
  };
  fence(mx0, 24, mz0 + 0.6); fence(32, 48, mz0 + 0.6); fence(56, mx1, mz0 + 0.6);
  t.hoarding([16, mz0 + 4, 40.5, mz0 + 4.4], 'n', undefined, 0xc8641a);
  t.hoarding([43, mz0 + 4, 66, mz0 + 4.4], 'n', undefined, 0xc8641a);
  t.container([14, mz1 - 2.8, 20, mz1 - 0.4], 0x8a2a2a); t.container([62, mz1 - 2.8, 68, mz1 - 0.4], 0x2f5fa8);
  t.hoarding([mx0 - 0.6, mz0 + 0.6, mx0, mz1], 'e', ['施工中 請繞行', 'SITE · KEEP OUT'], 0xc8641a);
  t.hoarding([mx1, mz0 + 0.6, mx1 + 0.6, mz1], 'w', undefined, 0xc8641a);
  t.sign('billboard', 40, 4.4, mz1 - 0.4, Math.PI, 12, 3, '工地', '#4a1a0a', '#ffd24a', 'SITE');
}
