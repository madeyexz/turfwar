import { MapBuilder } from './builder';
import type { MapDef } from './types';

/**
 * Courtyard: an original homage to BeGone's fifth and smallest map (geometry and art are our
 * own). A walled, cobbled garden at blue hour: four sunken pools with wooden rims, a flamingo
 * statue standing in each, clipped hedges along their outer sides, and the spiked statue on a
 * fountain in the middle with the ammo crate beside it. SWAT deploys in the north-west corner,
 * Militia in the south-east, each behind a crate in its team colour; stacked crates against the
 * middle of the north and south walls can be climbed in the right order.
 *
 * Coordinates: +X east, +Z south, metres. Everything inside `mirrored()` is repeated rotated
 * 180° for the other team; the original was mirrored too.
 */
const HALF = 20;
/** Inner face of the perimeter wall, the pools' inner and outer edges, and wall height. */
const WALL = 19.2, POOL_IN = 2.8, POOL_OUT = 13.1, WALL_H = 7;
const RIM = 0.7, WATER = -0.1;
const SWAT_BLUE = 0x8cb0dc, MILITIA_GREEN = 0xa8c07a;
const STONE = 0xbdbdb4, BRONZE = 0x7a6450;

/** Pool floor: 0.6 m deep at the rim, 1.1 m by the statue; everywhere else lies under the paving. */
function ground(x: number, z: number) {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax > HALF || az > HALF) return Math.min(4, (Math.max(ax, az) - HALF) * 0.25);
  if (ax < POOL_IN || az < POOL_IN || ax > POOL_OUT || az > POOL_OUT) return -1;
  const c = (POOL_IN + POOL_OUT) / 2, half = (POOL_OUT - POOL_IN) / 2;
  const d = Math.max(Math.abs(ax - c), Math.abs(az - c)) / half;
  return -1.2 + 0.5 * d * d;
}

export function courtyard(): MapDef {
  const b = new MapBuilder({
    id: 'courtyard', name: 'Courtyard', region: 'WALLED GARDEN / BLUE HOUR',
    description: 'The smallest map: four pools, hedges and a statue inside four walls.',
    theme: 'twilight', halfX: HALF, halfZ: HALF, seed: 13, roll: 0, ridge: 0,
    sun: { x: -0.45, y: 0.62, z: 0.55 }, ground,
  });
  b.buildTerrain(1);

  // ---- Centre: the cross of paving, the fountain and its spiked statue, the ammo crate ----
  b.box(0, -1, 0, WALL * 2, 1, POOL_IN * 2, 'cobble');
  b.cylinder(0, 0, 0, 2.4, 0.55, 'plaster', 'y', STONE);
  b.cylinder(0, 0.55, 0, 0.55, 1.7, 'plaster', 'y', STONE);
  b.ball(0, 3.05, 0, 0.8, 'steel', BRONZE);
  for (const axis of ['x', 'z'] as const) b.raw({ kind: 'cylinder', x: 0, y: 2.98, z: 0, radius: 0.07, height: 2.8, axis, style: 'steel', color: BRONZE });
  b.raw({ kind: 'cylinder', x: 0, y: 2.6, z: 0, radius: 0.07, height: 1.85, axis: 'y', style: 'steel', color: BRONZE });
  b.ammoCrate(2.4, 0, -2.4);
  b.point('A', 'Statue', 0, 0, 0, 5);

  b.mirrored(() => {
    // ---- Paving: the north path along the wall, the west path beside the pools, the north arm ----
    b.box(0, -1, -(WALL + POOL_OUT) / 2, WALL * 2, 1, WALL - POOL_OUT, 'cobble');
    for (const z of [-(POOL_IN + POOL_OUT) / 2, (POOL_IN + POOL_OUT) / 2]) b.box(-(WALL + POOL_OUT) / 2, -1, z, WALL - POOL_OUT, 1, POOL_OUT - POOL_IN, 'cobble');
    b.box(0, -1, -(POOL_IN + POOL_OUT) / 2, POOL_IN * 2, 1, POOL_OUT - POOL_IN, 'cobble');

    // ---- Perimeter: the north and west walls with pilasters, doors and lamps ----
    b.box(0, -1, -WALL - 0.4, HALF * 2, WALL_H + 1, 0.8, 'plaster');
    b.box(-WALL - 0.4, -1, 0, 0.8, WALL_H + 1, HALF * 2, 'plaster');
    for (let i = -4; i <= 4; i++) {
      b.paint(b.box(i * 4.8, 0, -WALL + 0.15, 0.6, WALL_H, 0.3, 'plaster'), STONE);
      if (i > -4 && i < 4) b.paint(b.box(-WALL + 0.15, 0, i * 4.8, 0.3, WALL_H, 0.6, 'plaster'), STONE);
    }
    for (const x of [-12, 7.2]) b.paint(b.box(x, 0, -WALL + 0.05, 1.6, 2.6, 0.1, 'wood'), 0x6a4a34);
    b.paint(b.box(-WALL + 0.05, 0, 7.2, 0.1, 2.6, 1.6, 'wood'), 0x6a4a34);
    for (const x of [-14.4, -4.8, 4.8, 14.4]) b.light(x, 3.6, -WALL + 0.45, 0xffc27a, 5, 10);

    // ---- The two pools on this side: wooden rims, water, a flamingo, hedges on the outer edges ----
    for (const east of [false, true]) {
      const cx = (east ? 1 : -1) * (POOL_IN + POOL_OUT) / 2, cz = -(POOL_IN + POOL_OUT) / 2, half = (POOL_OUT - POOL_IN) / 2;
      const span = POOL_OUT - POOL_IN;
      b.box(cx, -1.2, cz - half + 0.175, span, 1.2 + RIM, 0.35, 'wood');
      b.box(cx, -1.2, cz + half - 0.175, span, 1.2 + RIM, 0.35, 'wood');
      b.box(cx - half + 0.175, -1.2, cz, 0.35, 1.2 + RIM, span - 0.7, 'wood');
      b.box(cx + half - 0.175, -1.2, cz, 0.35, 1.2 + RIM, span - 0.7, 'wood');
      b.water(cx, WATER, cz, span - 0.7, span - 0.7);
      flamingo(b, cx, cz, east);
      const outX = cx + (east ? 1 : -1) * (half + 0.55);
      b.box(cx, 0, cz - half - 0.55, 6.4, 2.4, 0.8, 'hedge');
      b.box(outX, 0, cz, 0.8, 2.4, 6.4, 'hedge');
    }

    // ---- SWAT base (north-west corner): twelve slots behind a crate in the team colour ----
    const team = b.mirroredSide ? MILITIA_GREEN : SWAT_BLUE, yaw = -3 * Math.PI / 4;
    b.crate(-13.9, 0, -13.9, 1.6, 1.6, 1.6, team);
    for (const x of [-17.7, -15.3, -12.9, -10.5, -8.1]) b.spawn(0, x, 0, -17.7, yaw);
    for (const z of [-15.3, -12.9, -10.5, -8.1]) b.spawn(0, -17.7, 0, z, yaw);
    for (const [x, z] of [[-15.6, -15.6], [-15.5, -11], [-11, -15.5]]) b.spawn(0, x, 0, z, yaw);

    // ---- Tall boxes against the middle of the north wall: climb the single onto the stack ----
    b.crate(0.4, 0, -18.05, 1.6);
    b.crate(0.4, 1.6, -18.05, 1.6);
    b.crate(-1.3, 0, -18.1, 1.5);
    b.point(b.mirroredSide ? 'C' : 'B', b.mirroredSide ? 'South Corner' : 'North Corner', 16.4, 0, -16.4, 4);
  });
  return b.build();
}

/** Bronze flamingo on a stone plinth in the deep middle of a pool. */
function flamingo(b: MapBuilder, x: number, z: number, turned: boolean) {
  b.paint(b.box(x, -1.2, z, 0.8, 1.25, 0.8, 'plaster'), STONE);
  for (const dx of [-0.08, 0.08]) b.raw({ kind: 'cylinder', ...b.at(x + dx, z), y: 0.05, radius: 0.03, height: 0.95, axis: 'y', style: 'steel', color: BRONZE });
  const along = turned ? 0.25 : -0.25;
  b.paint(b.box(x, 1, z, 0.34, 0.4, 0.7, 'steel'), BRONZE);
  b.raw({ kind: 'cylinder', ...b.at(x, z + along), y: 1.3, radius: 0.045, height: 0.7, axis: 'y', style: 'steel', color: BRONZE });
  b.paint(b.box(x, 1.95, z + along * 1.25, 0.12, 0.14, 0.3, 'steel'), BRONZE);
}
