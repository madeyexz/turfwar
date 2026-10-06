import { C, FACE, KERB, Kit, MOVIES, NZ, bus, cells, crates, hoarding, jersey, kiosk, planter, posterBox, shelter, van, type Rect } from './taipei-cover';
import type { BlockStyle } from './types';

/**
 * The compact Ximending: the playable area shrunk from the source's nine blocks and the four
 * boulevards round them to the blocks alone, with one lane of each boulevard kept as a ring road
 * (a gameplay layer over the source, like taipei-cover.ts and taipei-interiors.ts):
 *   - the bounds close on the medians of Civic Blvd (under the expressway), Zhongxiao W. Rd and
 *     Huanhe Rd and on a lane closure in Zhonghua Rd; the far carriageways, the Red House and the
 *     skyline stay as the backdrop past the fences drawn along them;
 *   - the ring road: one carriageway of each boulevard, kept clear of every prop and parked car,
 *     with room at the corners for a car to sweep round; the vehicles park on it;
 *   - SWAT deploys behind a police cordon on Civic Blvd's sidewalk in front of the block between
 *     Xining S. Rd and Hanzhong St, Militia behind a barricade at the south end of Xining S. Rd;
 *   - the frontages along the ring road (sidewalk cover, bus shelters, kiosks) are rebuilt here
 *     clear of the drive lanes, a booth or poster wall across each sidewalk every 20–40 m.
 * The other layers of the compact map: taipei-passages.ts (ways through the blocks, upper
 * storeys), taipei-heights.ts (decks, bridges, roofs, sign gantries) and taipei-streets.ts (Emei
 * St's cut-through and the street cover that keeps views short).
 *
 * Coordinates are the source's (+x east, +z south, metres), like the other Taipei layers.
 */
export const PLAY = { x0: -869.5, x1: -707, z0: -296, z1: -162.5 };

/** The ring road's drive lanes (no props, no parked cars), source rects. */
export const RING: Rect[] = [
  [PLAY.x0, PLAY.z0, PLAY.x1, -288],     // north: Civic Blvd's south carriageway, under the expressway
  [PLAY.x0, -172.4, PLAY.x1, PLAY.z1],   // south: Zhongxiao W. Rd's north carriageway
  [PLAY.x0, PLAY.z0, -861.5, PLAY.z1],   // west: Huanhe Rd's northbound carriageway and its kerb
  [-715, PLAY.z0, PLAY.x1, PLAY.z1],     // east: Zhonghua Rd's southbound carriageway and its kerb
];
/** The inside of each corner, where a car sweeping round the bend cuts across the sidewalk. */
const CORNERS: Rect[] = [[-861.5, -288, -855, -282], [-721.5, -288, -715, -282], [-861.5, -178.4, -855, -172.4], [-721.5, -178.4, -715, -172.4]];
/** Everything a car needs clear: the lanes and the corners. */
export const LANES: Rect[] = [...RING, ...CORNERS];

/** Spawn slots, source coordinates: [team, x, z, yaw]. */
export const SPAWNS: [0 | 1, number, number, number][] = [
  // SWAT on Civic Blvd's sidewalk behind the cordon, in two squads: the west one by the door toward
  // Xining S. Rd (and site A), the east one by the door toward Hanzhong St (and site B).
  ...[-799, -796, -793].flatMap(x => [[0, x, -283.5, Math.PI / 2], [0, x, -280, Math.PI / 2]] as [0, number, number, number][]),
  ...[-778, -775, -772].flatMap(x => [[0, x, -283.5, -Math.PI / 2], [0, x, -280, -Math.PI / 2]] as [0, number, number, number][]),
  // Militia in Xining S. Rd between the barricades, facing north up the street.
  ...[-199, -195.5, -192, -188.5].flatMap(z => [-816.5, -813, -809.5].map(x => [1, x, z, 0] as [1, number, number, number])),
];

/** The police cordon and the Militia barricade (with their covered ways out), the ring road's edges and frontages. */
export function compact(k: Kit) {
  fences(k);
  cordon(k);
  barricade(k);
  frontages(k);
}

/** Riot-barrier panels (2 m, solid) along a rect: blue and white police panels on feet. */
function panels(k: Kit, r: Rect, y = KERB) {
  const [x0, z0, x1, z1] = r, alongX = x1 - x0 >= z1 - z0, len = alongX ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(len / 2.2)), seg = len / n;
  k.box(x0, z0, x1, z1, y, y + 2.0, 'invisible');
  for (let i = 0; i < n; i++) {
    const a = (alongX ? x0 : z0) + i * seg, c = a + seg - 0.05;
    const part = (o0: number, o1: number, h0: number, h1: number, style: BlockStyle, color: number) =>
      alongX ? k.shape(a + o0, z0, c - o1, z1, y + h0, y + h1, style, color) : k.shape(x0, a + o0, x1, c - o1, y + h0, y + h1, style, color);
    part(0, 0, 0.1, 1.95, 'painted', 0xe8ecf0);
    part(0, 0, 0.75, 1.2, 'painted', 0x1a3a7a);
    part(0, 0, 1.95, 2.0, 'steel', 0xb8bcc0);
  }
  k.claim(r);
}

/** The cordon's police vans in the kerb lane, along x with their -z side on CORDON_Z: -x end and cab toward. */
export const CORDON_Z = -288;
export const POLICE_VANS: [x0: number, front: 1 | -1][] = [[-806.0, -1], [-794.0, 1], [-783.0, -1], [-774.6, 1]];

/**
 * SWAT's cordon on Civic Blvd's south sidewalk, in front of the block between Xining S. Rd and
 * Hanzhong St: police vans and riot panels along the kerb lane shield the slots from the ring
 * road (two gaps lead out to the cars), and the base opens three ways: west along the sidewalk
 * to the construction site's covered walkway down Xining S. Rd, east to the site office on
 * Hanzhong St, and south through the Ximen Mall in the block (taipei-passages.ts).
 */
function cordon(k: Kit) {
  const z0 = CORDON_Z, police: [string, string] = ['警察', 'POLICE'], BLUE = 0x1a3a6a;
  for (const [x, front] of POLICE_VANS) van(k, x, z0, true, front, BLUE, police, 0);
  panels(k, [-800.7, z0 + 0.6, -797.2, z0 + 1.0], 0);
  panels(k, [-788.7, z0 + 0.6, -783.2, z0 + 1.0], 0);
  panels(k, [-769.3, z0 + 0.6, -764.0, z0 + 1.0], 0);
  // Panels across the sidewalk at both ends, a door at the facade: the slots are not seen from
  // the street mouths.
  panels(k, [-805.6, -286.0, -805.2, -280.6]);
  panels(k, [-765.6, -287.4, -765.2, -280.6]);
  k.sign('board', -785.4, 2.6, z0 + 1.05, FACE.s, 4.2, 0.6, '警戒線 請勿進入', '#1a3a7a', '#ffffff', 'POLICE LINE · DO NOT CROSS');
  // A command booth by each door (the west one outside it), so neither door sees through the base to the other.
  kiosk(k, [-810.0, -281.8, -808.2, -278.4], 'e', '指揮所', 'COMMAND POST', 0x1a3a7a);
  kiosk(k, [-770.0, -281.6, -768.2, -278.2], 'w', '指揮所', 'COMMAND POST', 0x1a3a7a);
}

/** The broken-down bus of Militia's barricade, in Xining S. Rd's kerb lane. */
export const BARRICADE_BUS: Rect = [-823.0, -175.3, -811.0, -172.8];

/**
 * Militia's barricade in Xining S. Rd between Emei St and Zhongxiao W. Rd: a broken-down bus on
 * the sidewalk shields the street's mouth from the ring road, and hoarding with a gap closes its
 * north end on Emei St (where the cut-through's lane passes). Ways out: north across Emei St, and
 * west and east through the ground floors of the blocks either side (taipei-passages.ts) to
 * Zhongxiao W. Rd's sidewalk and to Hanzhong St.
 */
function barricade(k: Kit) {
  bus(k, ...BARRICADE_BUS, KERB);
  hoarding(k, [-819.2, -200.95, -816.0, -200.75], 'n', KERB, ['自由西門', 'FREE XIMEN']);
  hoarding(k, [-809.9, -200.95, -806.8, -200.75], 'n', KERB);
  crates(k, -817.3, -179.4, 'x', true);
}

/**
 * The fences along the bounds: the median fences of Civic Blvd, Zhongxiao W. Rd and Huanhe Rd and
 * the lane closure across Zhonghua Rd (drawn only: the bounds stop everyone there).
 */
function fences(k: Kit) {
  const { x0, x1, z0, z1 } = PLAY, GREEN = 0x3a6a4a;
  const median = (r: Rect, y: number, alongX: boolean) => {
    k.shape(...r, y, y + 0.8, 'concrete', 0xb4b2aa);
    const [a0, , a1] = alongX ? [r[0], 0, r[2]] : [r[1], 0, r[3]];
    for (let a = a0; a <= a1; a += 2.5) {
      if (alongX) k.shape(a - 0.04, r[1] + 0.25, a + 0.04, r[3] - 0.25, y + 0.8, y + 1.9, 'steel', GREEN);
      else k.shape(r[0] + 0.25, a - 0.04, r[2] - 0.25, a + 0.04, y + 0.8, y + 1.9, 'steel', GREEN);
    }
    if (alongX) for (const h of [1.3, 1.85]) k.shape(r[0], r[1] + 0.27, r[2], r[3] - 0.27, y + h, y + h + 0.05, 'steel', GREEN);
    else for (const h of [1.3, 1.85]) k.shape(r[0] + 0.27, r[1], r[2] - 0.27, r[3], y + h, y + h + 0.05, 'steel', GREEN);
  };
  median([x0, z0 - 0.6, x1, z0], 0.2, true);
  median([x0, z1, x1, z1 + 0.6], 0.2, true);
  median([x0 - 0.6, z0, x0, z1], 0.2, false);
  // Zhonghua Rd: water-filled barriers across the carriageway and road-closed boards.
  for (let z = z0, i = 0; z < z1; z += 1.6, i++) k.shape(x1, z, x1 + 0.6, Math.min(z + 1.55, z1), 0, 0.95, 'painted', i % 2 ? C.white : C.orange);
  for (let z = z0 + 12; z < z1 - 6; z += 30) {
    k.shape(x1 + 0.2, z - 0.05, x1 + 0.3, z + 0.05, 0.95, 2.3, 'steel', 0x5a6068);
    k.sign('board', x1 - 0.02, 2.0, z, FACE.w, 2.4, 0.6, '道路封閉', '#f2c400', '#1a1a1a', 'ROAD CLOSED');
  }
}

/**
 * Sidewalk cover along the ring road (never on its drive lanes). Every so often a kiosk or a
 * poster wall spans the whole sidewalk, so the sidewalks' views stay short; the lane beside them
 * is the way round.
 */
function frontages(k: Kit) {
  // A booth at the kerb and a poster wall back to the facade, across a sidewalk at x (along Civic
  // Blvd and Zhongxiao W. Rd) or z (along Huanhe Rd and Zhonghua Rd).
  const acrossX = (x: number, kerb: number, facade: number, text: [string, string], color: number) => {
    const out = Math.sign(kerb - facade), mid = facade + out * 2.8;
    kiosk(k, [x - 1.6, Math.min(kerb, mid), x + 1.6, Math.max(kerb, mid)], out > 0 ? 's' : 'n', text[0], text[1], color);
    posterBox(k, [x - 0.2, Math.min(facade, mid), x + 0.2, Math.max(facade, mid)], [MOVIES[(x & 3)], MOVIES[(x + 1) & 3]]);
  };
  const acrossZ = (z: number, x0: number, x1: number, text: [string, string], color: number, face: 'e' | 'w') =>
    kiosk(k, [x0, z - 2, x1, z + 2], face, text[0], text[1], color);
  // Civic Blvd's sidewalk west and east of the cordon.
  acrossX(-846, -287.95, -278.15, ['報攤', 'NEWS'], 0x2a6a4a);
  shelter(k, -830.9, -283.95, -826.4, -282.3, 'n');
  planter(k, cells(14, 15, 10, 10, 0.3));
  kiosk(k, [-748.8, -283.6, -745.2, -281.2], 'n', '報攤', 'NEWS', 0x2a6a4a);
  acrossX(-735, -287.95, -278.15, ['彩券', 'LOTTERY'], 0xc8641a);
  // Zhongxiao W. Rd's sidewalk.
  acrossX(-845, -172.45, -178.35, ['報攤', 'NEWS'], 0x2a6a4a);
  shelter(k, -834.0, -174.1, -829.5, -172.55, 's');
  posterBox(k, [-825.2, -178.35, -824.8, -172.5], [MOVIES[3], MOVIES[1]]);
  posterBox(k, [-805.2, -178.35, -804.8, -172.5], [MOVIES[1], MOVIES[0]]);
  acrossX(-790, -172.45, -178.35, ['檳榔', 'BETEL NUT'], 0x1a1a1a);
  acrossX(-748, -172.45, -178.35, ['冰', 'SHAVED ICE'], 0x1a7a3a);
  shelter(k, -741.8, -174.1, -737.3, -172.55, 's');
  acrossX(-729, -172.45, -178.35, ['報攤', 'NEWS'], 0x2a6a4a);
  // Huanhe Rd's sidewalk (the west flank).
  acrossZ(-266, -861.45, -857.85, ['報攤', 'NEWS'], 0x2a6a4a, 'w');
  acrossZ(-233.3, -861.45, -857.85, ['彩券', 'LOTTERY'], 0xc8641a, 'w');
  crates(k, -858.5, NZ(34), 'z', true);
  acrossZ(-195, -861.45, -857.85, ['檳榔', 'BETEL NUT'], 0x1a1a1a, 'w');
  jersey(k, [-859.5, -187.6, -858.9, -183.0]);
  // Zhonghua Rd's sidewalk (the east flank).
  acrossZ(-265.9, -718.85, -715.05, ['報攤', 'NEWS'], 0x2a6a4a, 'e');
  acrossZ(-242.5, -718.85, -715.05, ['冰', 'SHAVED ICE'], 0x1a7a3a, 'e');
  acrossZ(-197.5, -718.85, -715.05, ['彩券', 'LOTTERY'], 0xc8641a, 'e');
}

/** Map points and ammo crates, source coordinates. */
export const POINTS = {
  A: [-836, -255, 7, 'Cinema Street 電影街'],
  B: [-742.5, -231, 7, 'Arcade 湯瑪熊歡樂城'],
  C: [-786, -253, 7, 'Night Market 西門夜市'],
  D: [-757, -184, 6, 'Ximen Gateway 西門町牌樓'],
  E: [-757, -207, 6, 'Emei St Stage 峨眉街'],
} as const;
export const AMMO: [number, number][] = [[-826, -253], [-757, -238], [-784, -235], [-860, -206], [-716.5, -230], [-736.5, -209.5]];

/** Boxes (map coordinates) where the source's street dressing must not stand: the drive lanes. */
export function laneClears(lanes: Rect[], X: (x: number) => number, Z: (z: number) => number) {
  return lanes.flatMap(([x0, z0, x1, z1]) => [X(x0) - 0.3, 0.02, Z(z0) - 0.3, X(x1) + 0.3, 3.5, Z(z1) + 0.3]);
}
