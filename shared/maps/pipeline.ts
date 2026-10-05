import { MapBuilder, fbm } from './builder';
import type { BlockStyle, MapDef } from './types';

/**
 * Pipeline: an original homage to BeGone's fourth and largest map (geometry and art are our
 * own). A raised pipeline on a concrete retaining wall runs straight across the north half and
 * splits the forest behind it from the open ground in front; a hole in the wall drops attackers
 * down behind the pipe's piers. Militia (team 1) deploys in the yard top-left by the big
 * Militia building, whose roof forms an L with its annex. SWAT (team 0) deploys in the little
 * valley bottom-left, under the SWAT ridge with its yellow huts, yellow stairs and a house built
 * over the tunnel that cuts through the ridge. In the middle stand the three connected buildings
 * with their shared roof, orange skips beside them, the middle building with a cover wall on its
 * roof, and east of them the Ammo area by the pipe stack, then the ditch and the open field.
 * Sabotage sites: A at Ammo, B in the SWAT valley. BeGone's ladders are stairs here.
 *
 * Coordinates: +X east, +Z south, metres. The layout follows BeGone's overhead at about 0.12 m
 * per pixel (centred on pixel 470, 470). Everything is placed directly: the map is asymmetric.
 * Bots walk slopes up to about 1:4 and squeeze through gaps of 3 m, so the banks bots must
 * climb are long and gentle, sharper level changes sit behind retaining walls with stairs, the
 * lanes between buildings are kept wide, and stairs end just past a nav sample (x on multiples of
 * 2.5, z on 0.5 + 2.5k) so bots step off them onto roofs.
 */
const HALF_X = 56, HALF_Z = 43;
const PLATEAU = 2.4, RIDGE = 3, VALLEY = -1.5;
/** Retaining walls around the forest plateau (2 m thick, between even terrain samples), the hole, the pipe. */
const WALL_Z0 = -16, WALL_Z1 = -14, WEST_X0 = -8, WEST_X1 = -6, HOLE_X0 = 23.5, HOLE_X1 = 26.5;
const PIPE_Z = -13.3, PIPE_R = 0.7, PIPE_Y = 3.4;
/** The tunnel cut through the ridge (floor between the two 2 m retaining walls). */
const CUT_X0 = -12, CUT_X1 = -2;
const HOUSE_Z0 = 9, HOUSE_Z1 = 15, HOUSE_FLOOR = 3, HOUSE_ROOF = 6.5;
const ROOF_TOP = 3.9;

// Painted steel reads dark outdoors, so its tints are bright.
const PLASTER_WHITE = 0xf1efe8, PLASTER_GREY = 0xc9c6bd, ROOF_BLUE = 0x6b8fb8, SKIP_ORANGE = 0xff8a3c, SCRAP = 0x8a7a66;
const HUT_YELLOW = 0xe8c860, PIPE_GREEN = 0xa9b9aa, DRUM_BLUE = 0x6c9ad0, DRUM_RED = 0xc85a40, WEATHERED = 0x9c8466;

const sm = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
const lin = (t: number) => Math.max(0, Math.min(1, t));

/** Gentle mounds on the field and the forest floor. [x, z, radius, height] */
const BUMPS: [number, number, number, number][] = [
  [22, 30, 8, 0.9], [40, 24, 7, 0.7], [48, 35, 9, 1], [12, 36, 7, 0.6], [34, -31, 8, 0.7], [16, -36, 7, 0.5], [46, -24, 6, 0.4],
];

/** Hand-authored ground. Hard steps fall between terrain samples (even metres) inside 2 m walls, so no slope shows. */
function ground(x: number, z: number) {
  let h = 0;
  // The forest plateau behind the pipe wall and the yard wall.
  if (x >= WEST_X0 + 1 && z <= WALL_Z0 + 1) h = PLATEAU;
  // SWAT ridge: shrubby north face, flat top from z 8, dropping inside its retaining wall (z 16–18).
  if (z < 17) {
    const west = z > 12.5 ? 1 : sm((x + 38) / 4);
    h = Math.max(h, RIDGE * sm((z - 3) / 5) * west * (1 - sm(x / 8)));
  } else {
    // The valley: its west bank climbs into the forest, its east bank runs long and gentle up to the field.
    const west = sm((-28 - x) / 6), east = lin((x + 3) / 10);
    h = VALLEY + (RIDGE - VALLEY) * west - VALLEY * east + Math.max(0, -34 - x) * 0.12;
  }
  // The tunnel cut through the ridge, sloping down to the valley floor.
  if (x >= CUT_X0 && x <= CUT_X1 && z >= 2 && z <= 18) h = z <= 5 ? 0 : VALLEY * (z - 5) / 13;
  // The ditch: a shallow creek wandering east across the field.
  if (x > 8) h -= 0.7 * sm((x - 8) / 4) * (1 - sm(Math.abs(z - creekZ(x)) / 4.5));
  for (const [bx, bz, r, bh] of BUMPS) { const d = Math.hypot(x - bx, z - bz) / r; if (d < 1) h += bh * (1 - sm(d)); }
  // Forested hills beyond the bounds.
  const e = Math.max(Math.abs(x) - HALF_X, Math.abs(z) - HALF_Z);
  if (e > 0) h += Math.min(14, e * 0.45) + Math.max(0, fbm(x * 0.05, z * 0.05, 9)) * Math.min(1, e / 6) * 6;
  return h;
}
const creekZ = (x: number) => 13.8 + Math.sin(x * 0.13) * 1.5;

type B = MapBuilder;

/** Lowest ground under a footprint, so nothing floats on a slope. */
function floorUnder(b: B, x: number, z: number, w: number, d: number) {
  return Math.min(b.ground(x, z), b.ground(x - w / 2, z - d / 2), b.ground(x + w / 2, z - d / 2), b.ground(x - w / 2, z + d / 2), b.ground(x + w / 2, z + d / 2));
}

/** Open-top skip: scrap piled 1 m deep inside thin painted walls (you can drop in and climb out). */
function skip(b: B, x: number, z: number, w: number, d: number) {
  const y = floorUnder(b, x, z, w, d) - 0.05, t = 0.15;
  b.paint(b.box(x, y, z, w - 2 * t, 1.05, d - 2 * t, 'steel'), SCRAP);
  b.paint(b.box(x, y, z - d / 2 + t / 2, w, 2.4, t, 'steel'), SKIP_ORANGE);
  b.paint(b.box(x, y, z + d / 2 - t / 2, w, 2.4, t, 'steel'), SKIP_ORANGE);
  b.paint(b.box(x - w / 2 + t / 2, y, z, t, 2.4, d - 2 * t, 'steel'), SKIP_ORANGE);
  b.paint(b.box(x + w / 2 - t / 2, y, z, t, 2.4, d - 2 * t, 'steel'), SKIP_ORANGE);
}

/** Solid single-storey block with a roof deck at height h. */
function block(b: B, x: number, z: number, w: number, d: number, h: number, style: BlockStyle, color: number, roofColor?: number) {
  const y = floorUnder(b, x, z, w, d) - 0.1;
  b.paint(b.box(x, y, z, w, h - y, d, style), color);
  const roof = b.box(x, h, z, w + 0.3, 0.3, d + 0.3, 'roof');
  if (roofColor !== undefined) b.paint(roof, roofColor);
}

function rock(b: B, x: number, z: number, w: number, h: number, d: number) {
  b.box(x, floorUnder(b, x, z, w, d) - 0.25, z, w, h + 0.25, d, 'rock');
}

function hedge(b: B, x: number, z: number, w: number, h: number, d: number) {
  const y = floorUnder(b, x, z, w, d) - 0.15;
  b.box(x, y, z, w, h + (b.ground(x, z) - y), d, 'hedge');
}

/** Oil drum standing on the ground. */
function drum(b: B, x: number, z: number, color = DRUM_BLUE) {
  b.cylinder(x, b.ground(x, z) - 0.02, z, 0.32, 0.95, 'steel', 'y', color);
}

/** Wooden fence along x (or z) standing on the ground. */
function fence(b: B, x: number, z: number, w: number, d: number) {
  b.paint(b.box(x, floorUnder(b, x, z, w, d) - 0.1, z, w, 1.4, d, 'wood'), WEATHERED);
}

function trees(b: B, list: readonly (readonly [number, number, number, number])[]) {
  for (const [x, z, s, v] of list) b.tree(x, z, s, v);
}

export function pipeline(): MapDef {
  const b = new MapBuilder({
    id: 'pipeline', name: 'Pipeline', region: 'NORTHERN FOREST / PUMPING STATION',
    description: 'The largest map: a pipeline wall, a tunnel under the SWAT ridge, long sightlines.',
    theme: 'meadow', halfX: HALF_X, halfZ: HALF_Z, seed: 17, roll: 0, ridge: 0,
    sabotage: { sites: ['A', 'B'], attackerSpawn: 1 },
    sun: { x: -0.42, y: 0.7, z: 0.45 },
    ground,
  });
  b.buildTerrain(2);

  // ---- The Pipe: retaining walls round the forest plateau, the hole, piers, the pipeline -----
  const wallH = PLATEAU + 1.2;                                        // a 0.9 m parapet on the forest side
  for (const [x0, x1] of [[WEST_X0, HOLE_X0], [HOLE_X1, HALF_X + 4]]) b.box((x0 + x1) / 2, -0.3, (WALL_Z0 + WALL_Z1) / 2, x1 - x0, wallH, WALL_Z1 - WALL_Z0, 'slab');
  for (const [z0, z1] of [[-HALF_Z - 4, -25.75], [-23.25, WALL_Z0]]) b.box((WEST_X0 + WEST_X1) / 2, -0.3, (z0 + z1) / 2, WEST_X1 - WEST_X0, wallH, z1 - z0, 'slab');
  // Steps through the hole down behind the piers, and up from the yard through the side wall.
  b.stairs((HOLE_X0 + HOLE_X1) / 2, -13, HOLE_X1 - HOLE_X0, 6, 0, PLATEAU, 3);
  b.stairs(-10, -24.5, 8, 2.5, 0, PLATEAU, 0);
  // Smooth painted pipe (the diamond-plate steel look is kept for drums and skips).
  b.cylinder(32.75, PIPE_Y, PIPE_Z, PIPE_R, 74.5, 'slab', 'x', PIPE_GREEN);
  for (let x = 3; x < 70; x += 8.4) b.cylinder(x, PIPE_Y - 0.12, PIPE_Z, PIPE_R + 0.12, 0.35, 'slab', 'x', 0x8e9c90);   // flanges
  for (const x of [-3, 5, 13, 21, 29, 37, 45, 53]) b.box(x, -0.2, PIPE_Z, 1, PIPE_Y + 0.2, 1, 'slab');
  b.box(-5, -0.2, -13.3, 2, PIPE_Y + 0.2, 2.4, 'slab');                     // valve chamber at the west end
  // The pier with the barrels, and the one far back among the trees.
  drum(b, 28.1, -12.1); drum(b, 28.9, -11.6, DRUM_RED); drum(b, 29.9, -12.2);
  trees(b, [[44, -10.5, 0.9, 0], [47.6, -9.6, 1.1, 2], [43.2, -8, 0.8, 1]]);

  // ---- Militia base: the yard, the Militia building and its annex, the barn ----------------
  for (const x of [-37, -33.5, -30, -26.5]) for (const z of [-31, -27.5, -24]) b.spawn(1, x, 0, z, -2.56);
  // The Militia building: a long brick shed under a pitched iron roof, open through big doors.
  const shed = b.bunker(-46.5, -6.4, 17, 37.2, {
    y: 0, h: 6, style: 'brick', roof: false,
    doors: [['e', 0.9, 4], ['e', 12.4, 4], ['n', 0, 4], ['s', 1, 4]],
    windows: [['w', -12, 3], ['w', 0, 3], ['w', 12, 3], ['e', 6.6, 2.4]],
  });
  b.ramp(-51, -6.4, 9, 38, shed.h, 7.4, 0, 'roof');
  b.ramp(-42, -6.4, 9, 38, shed.h, 7.4, 2, 'roof');
  for (const z of [-24.9, 12.1]) b.box(-46.5, shed.h, z, 8.4, 0.7, 0.3, 'brick');   // gable ends
  b.box(-51, 0, -15, 2.5, 2.6, 6.2, 'container');
  b.box(-42.5, 0, 2.5, 6.2, 2.6, 2.5, 'container');
  b.crate(-52.6, 0, 4, 1.5); b.crate(-52.6, 0, 5.5, 1.5); b.crate(-52.6, 1.5, 4.8, 1.5);
  b.crate(-41.6, 0, -18, 1.4); b.crate(-50.6, 0, -1.5, 1.5, 1.5, 3);
  b.light(-46.5, 5.4, -14, 0xffd9a0, 5, 14); b.light(-46.5, 5.4, 2, 0xffd9a0, 5, 14);
  // Annex: its flat roof and the shed roof make the L; stairs climb its north face from the yard.
  block(b, -30.7, -15.9, 14.6, 10.2, 5, 'brick', 0xd8c8bc);
  b.stairs(-27.25, -21.9, 6.5, 1.8, 0, 5.3, 2);
  // The covered loading dock on its south side.
  b.paint(b.box(-30.6, 0, -8.7, 12, 1.1, 4.2, 'wood'), WEATHERED);
  b.stairs(-23.6, -8.7, 2, 4.2, 0, 1.1, 2);
  for (const x of [-36.3, -30.6, -24.9]) b.paint(b.box(x, 1.1, -6.9, 0.25, 2.5, 0.25, 'wood'), WEATHERED);
  b.box(-30.6, 3.6, -8.6, 12.4, 0.15, 4.6, 'roof');
  b.crate(-33.5, 1.1, -9.2, 1.3); b.crate(-27.8, 1.1, -8.4, 1.2);
  // The barn at the back of the yard.
  block(b, -20, -38, 8, 8, 4.5, 'brick', 0xcdb9ab);
  b.crate(-25.5, 'ground', -40, 1.5); b.crate(-25.6, 'ground', -38.4, 1.4);
  drum(b, -15, -33.3); drum(b, -14.2, -32.6, DRUM_RED);
  trees(b, [[-48, -33, 1.2, 0], [-41.5, -39, 1.1, 2], [-53, -29, 1.3, 1], [-33, -40, 1, 0]]);

  // ---- The middle building: walkable roof with a cover wall at its front, stairs up its side --
  const mid = b.bunker(-12, -16, 8, 6, {
    y: 0, h: ROOF_TOP - 0.3, style: 'plaster', roof: false,
    doors: [['w', -1, 2]], windows: [['n', -2, 1.6], ['n', 2, 1.6], ['s', 1.5, 1.6]],
  });
  b.paint(b.box(-12, mid.h, -16, 8.3, 0.3, 6.3, 'slab'), PLASTER_GREY);
  b.paint(b.box(-12, ROOF_TOP, -18.9, 5, 1.1, 0.3, 'plaster'), PLASTER_WHITE);
  b.stairs(-10.5, -12.15, 5, 1.6, 0, ROOF_TOP, 2);
  // An orange skip against its north face, to drop into from the roof.
  skip(b, -12, -20.6, 6.2, 2.6);
  hedge(b, -18.4, -14, 1.8, 1.5, 3.2);

  // ---- The three connected buildings and their shared Roof -------------------------------
  block(b, -18.6, -4.7, 8.4, 7.4, ROOF_TOP - 0.3, 'plaster', PLASTER_GREY);
  const blue = b.bunker(-8.75, -4.7, 7.5, 7.4, {
    y: 0, h: ROOF_TOP - 0.3, style: 'plaster', roof: false,
    doors: [['n', -1.25, 2.4], ['s', -1.25, 2.4]], windows: [['e', -1.6, 1.4], ['w', 1.6, 1.4]],
  });
  b.paint(b.box(-8.75, blue.h, -4.7, 7.8, 0.3, 7.7, 'roof'), ROOF_BLUE);
  block(b, 1.9, -4.7, 8.2, 7.4, ROOF_TOP - 0.3, 'plaster', PLASTER_WHITE);
  // Plank walkways across the gaps; the narrow enclosure between the first two is a dead end.
  b.paint(b.box(-13.45, ROOF_TOP - 0.15, -5, 1.6, 0.15, 2, 'wood'), WEATHERED);
  b.paint(b.box(-3.6, ROOF_TOP - 0.15, -7.3, 2.5, 0.15, 1.6, 'wood'), WEATHERED);
  b.paint(b.box(-13.45, 0, -8.25, 1.9, 2.4, 0.3, 'wood'), WEATHERED);
  b.tree(-3.7, -4.2, 0.75, 1);
  // Stairs up both sides of the row (BeGone's ladders).
  b.stairs(-19.9, -9.25, 5.8, 1.6, 0, ROOF_TOP, 0);
  b.stairs(6.9, -4.75, 1.6, 6.5, 0, ROOF_TOP, 1);
  skip(b, 11.3, -7.4, 6.2, 2.6);
  b.point('D', 'Roof', -8.75, ROOF_TOP, -4.7, 6);
  // The yard between the Militia building and the buildings.
  b.crate(-27, 'ground', -2.5, 1.5); b.crate(-25.5, 'ground', -2.3, 1.5); b.crate(-26.3, 1.5, -2.4, 1.5);
  skip(b, -33, -0.4, 6.2, 2.6);
  drum(b, -27.6, 1.4); drum(b, -27, 2.1, DRUM_RED);

  // ---- SWAT ridge: retaining wall, tunnel, the house over it, huts, stairs, rocks ---------
  for (const [x0, x1] of [[-30, -21], [-19, CUT_X0 - 2], [CUT_X1 + 2, 4]]) {
    const n = Math.ceil((x1 - x0) / 3), w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) b.box(x0 + (i + 0.5) * w, VALLEY - 0.3, 17, w, RIDGE - VALLEY + 0.9 + (((i * 7 + x0) % 3) + 3) % 3 * 0.25, 2, 'rock');
  }
  // The yellow stairs from the valley up the ridge.
  b.stairs(-20, 19, 2, 6, VALLEY, RIDGE, 3);
  // Tunnel walls (lower under the house), its pillars, and the rocks inside its south mouth.
  for (const x of [CUT_X0 - 1, CUT_X1 + 1]) {
    b.box(x, VALLEY - 0.1, (2 + HOUSE_Z0) / 2, 2, RIDGE + 0.8 - VALLEY + 0.1, HOUSE_Z0 - 2, 'slab');
    b.box(x, VALLEY - 0.1, (HOUSE_Z0 + HOUSE_Z1) / 2, 2, HOUSE_FLOOR - 0.4 - VALLEY + 0.1, HOUSE_Z1 - HOUSE_Z0, 'slab');
    b.box(x, VALLEY - 0.1, (HOUSE_Z1 + 18) / 2, 2, RIDGE + 0.8 - VALLEY + 0.1, 18 - HOUSE_Z1, 'slab');
  }
  for (const x of [-9.5, -4.5]) for (const z of [10.6, 13.4]) b.box(x, b.ground(x, z) - 0.1, z, 0.8, HOUSE_FLOOR - 0.3 - b.ground(x, z) + 0.1, 0.8, 'slab');
  rock(b, -11, 16.4, 1.6, 1.2, 2); rock(b, -10.9, 14.8, 1.2, 0.8, 1.2);
  b.light(-7, HOUSE_FLOOR - 0.7, 10.6, 0xffc27a, 5, 10); b.light(-7, HOUSE_FLOOR - 0.7, 13.4, 0xffc27a, 5, 10);
  b.point('C', 'Tunnel', -7, b.ground(-7, 12), 12, 5);
  // The house over the tunnel: walkable roof (stairs inside up to a hatch), balcony over the valley side.
  const hz = (HOUSE_Z0 + HOUSE_Z1) / 2;
  b.box(-7, HOUSE_FLOOR - 0.4, hz, 14, 0.4, HOUSE_Z1 - HOUSE_Z0, 'slab');
  const house = b.bunker(-7, hz, 14, HOUSE_Z1 - HOUSE_Z0, {
    y: HOUSE_FLOOR, h: HOUSE_ROOF - HOUSE_FLOOR - 0.3, style: 'plaster', roof: false,
    doors: [['w', 0.5, 2], ['e', 0.5, 2], ['s', 0, 2]], windows: [['n', -4.5, 1.8], ['n', 4.5, 1.8], ['s', -4, 1.6], ['s', 4, 1.6]],
  });
  const hatch = HOUSE_Z0 + 2.2;
  for (const [x0, x1, z0, z1] of [[-14, -10.5, HOUSE_Z0, HOUSE_Z1], [-10.5, -5.8, hatch, HOUSE_Z1], [-5.8, 0, HOUSE_Z0, HOUSE_Z1]]) {
    b.paint(b.box((x0 + x1) / 2, house.y + house.h, (z0 + z1) / 2, x1 - x0, 0.3, z1 - z0, 'slab'), PLASTER_GREY);
  }
  b.paint(b.box(-7, HOUSE_ROOF, HOUSE_Z1 - 0.15, 14, 0.9, 0.3, 'plaster'), PLASTER_WHITE);   // roof parapet facing the valley
  b.stairs(-8.8, HOUSE_Z0 + 1.35, 6, 1.6, HOUSE_FLOOR, HOUSE_ROOF, 0);
  b.box(-7, HOUSE_FLOOR - 0.3, HOUSE_Z1 + 0.8, 6, 0.3, 1.6, 'wood');                         // balcony
  b.rail(-10, HOUSE_Z1 + 1.55, -4, HOUSE_Z1 + 1.55, HOUSE_FLOOR);
  b.light(-7, HOUSE_FLOOR + 2.4, HOUSE_Z1 + 0.3, 0xfff1d0, 4, 10);
  // Little yellow huts, trees, and rocks at the ridge's west end against the Militia building.
  for (const [x, z] of [[-24.5, 11], [-29.5, 14], [-17.6, 10.4]]) block(b, x, z, 2.6, 2.6, RIDGE + 2.4, 'plaster', HUT_YELLOW, 0x8a5a3a);
  trees(b, [[-33, 9.5, 1, 0], [-26, 8.4, 0.9, 2], [-22.5, 14.8, 1.1, 0], [-15.6, 15.4, 0.8, 1], [-31, 16, 1, 2], [2.6, 11, 0.9, 1]]);
  rock(b, -35.2, 10.5, 2.8, 1.8, 3.2); rock(b, -33.4, 13.6, 2.2, 1.4, 2); rock(b, -33.5, 17.2, 3.2, 2.4, 3.2); rock(b, -30.6, 18.8, 2.6, 1.5, 2.2);
  // Shrubs on the ridge's north face (BeGone opened a way up through them).
  hedge(b, -30, 5.6, 4, 1.3, 1.4); hedge(b, -22, 5, 3.4, 1.2, 1.4); hedge(b, -16, 5.8, 2.6, 1.3, 1.2); hedge(b, 3, 6.2, 2.4, 1.2, 1.4);

  // ---- SWAT base: the little valley, bomb B, the fence to the field ------------------------
  for (let i = 0; i < 6; i++) for (const z of [35, 38.5]) b.spawn(0, -24 + i * 3.6, VALLEY, z, 0);
  b.point('B', 'SWAT Base', -13.8, VALLEY, 27, 7);
  b.crate(-8.5, VALLEY, 24.5, 1.5); b.crate(-8.5, VALLEY + 1.5, 24.5, 1.5); b.crate(-7, VALLEY, 25, 1.4);
  b.crate(-19.5, VALLEY, 30, 1.5, 1.5, 3);
  b.paint(b.box(-24.5, VALLEY, 25, 1, 1.1, 4, 'wood'), WEATHERED);
  fence(b, -1, 21, 0.2, 6); fence(b, -1, 31.5, 0.2, 5);
  trees(b, [[-27, 41.5, 1.1, 0], [3, 41, 1, 2], [-31, 24, 1, 1], [-30.5, 32, 1.2, 0]]);

  // ---- Ammo: bomb A, the pipe stack, the lean-to with the sole fixed ammo crate --------------
  b.point('A', 'Ammo', 25.2, b.ground(25.2, 5.4), 5.4, 7);
  for (const [x, y] of [[20.6, 0], [21.85, 0], [21.22, 1.08]]) b.cylinder(x, b.ground(21, -0.5) + y - 0.05, -0.5, 0.62, 7, 'steel', 'z', PIPE_GREEN);
  {
    const y = floorUnder(b, 31.5, 1.5, 5, 7) - 0.1;
    b.paint(b.box(34, y, 1.5, 0.3, 3 - y, 7, 'wood'), WEATHERED);
    b.paint(b.box(31.5, y, -2, 5, 2.2 - y, 0.3, 'wood'), WEATHERED);
    b.paint(b.box(31.5, y, 5, 5, 1.2 - y, 0.3, 'wood'), WEATHERED);
    b.ramp(31.4, 1.5, 5.6, 7.6, 2.3, 3.1, 0, 'roof');
    b.ammoCrate(32.6, b.ground(32.6, 1), 1);
  }
  b.crate(18, 'ground', 7.5, 1.5); drum(b, 27.8, 8.6); drum(b, 28.5, 9.2, DRUM_RED);
  fence(b, 11, 8, 0.2, 7);                                                // the fence by the big tree
  trees(b, [[13.6, 1.5, 1.2, 1], [16.4, -6, 0.9, 0]]);

  // ---- The field beyond the ditch -----------------------------------------------------------
  rock(b, 20, 24, 5, 1.2, 0.8); rock(b, 36, 28, 0.9, 1.3, 5); rock(b, 46, 19.5, 3, 1.6, 2.4); rock(b, 8, 30, 2.4, 1.2, 2);
  b.paint(b.box(28, floorUnder(b, 28, 35, 6, 0.6) - 0.1, 35, 6, 1.5, 0.6, 'brick'), 0xc8b0a0);   // ruined walls
  b.paint(b.box(42, floorUnder(b, 42, 40.5, 0.6, 5) - 0.1, 40.5, 0.6, 1.8, 5, 'brick'), 0xc8b0a0);
  trees(b, [[10, 24, 1, 0], [18, 32.5, 1.2, 2], [31, 21.5, 0.9, 1], [40, 34, 1.1, 0], [51, 21, 1, 2], [53, 40, 1.3, 0], [26, 40.5, 1, 1], [6, 38.5, 1.1, 2], [48, 29, 0.9, 1]]);

  // ---- The forest behind the pipe (north plateau) --------------------------------------------
  trees(b, [
    [2, -21, 1.1, 0], [8, -25, 1.2, 2], [14, -19.5, 1, 1], [19.5, -27, 1.3, 0], [28, -21, 1, 2], [33.5, -25.5, 1.2, 0],
    [39, -19.5, 1, 1], [44.5, -27, 1.3, 2], [50, -21, 1.1, 0], [54, -31, 1.2, 1], [4, -33, 1.2, 2], [11, -38, 1.3, 0],
    [17, -31.5, 1, 1], [24.5, -36.5, 1.2, 0], [30, -31, 1.1, 2], [37.5, -38.5, 1.3, 0], [42, -32.5, 1, 1], [48.5, -39, 1.2, 2],
    [53, -38, 1, 0], [36, -29, 0.9, 1], [23, -24, 0.8, 2], [-2, -30, 1, 0], [-3, -39, 1.2, 2],
  ]);
  rock(b, 26, -30, 2.4, 1.4, 2); rock(b, 46, -34, 3, 1.8, 2.4); rock(b, 9, -29, 2, 1.1, 1.8);
  // Woods down the west hill south of the Militia building.
  trees(b, [[-40, 19, 1.1, 0], [-46, 23, 1.3, 2], [-52, 17, 1.2, 1], [-38, 29, 1, 0], [-45, 35, 1.2, 2], [-52, 31, 1.3, 0], [-36, 39, 1.1, 1], [-49, 40.5, 1.2, 2]]);

  b.point('E', 'Militia Building', -46.5, 0, -6, 7);
  return b.build();
}
