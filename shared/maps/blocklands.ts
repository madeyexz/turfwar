import { defaultLaws } from '../laws';
import { cloneData, rng } from '../math';
import { fbm, MapBuilder } from './builder';
import type { MapDef, VoxelId } from './types';

/**
 * Blocklands: a block-game valley built from 1 m voxels (Kenney's CC0 Voxel Pack tiles). A river
 * runs north–south through the middle; B is the stone fort on the ford, with plank bridges up
 * and down stream. A and C are farm villages, and a mine tunnel through the northern hill
 * (southern, for the other team) gives each side a covered flank. Terrain steps in half blocks so
 * soldiers and bots can walk the slopes; full-block cliffs need a jump.
 *
 * Coordinates: +X east, +Z south. Placement happens for the west half and is mirrored 180°.
 */

const HALF_X = 64, HALF_Z = 46;
/** Voxels continue this far past the playable bounds as scenery before the horizon hills. */
const MARGIN = 22;
const TUNNEL = { minX: -34, maxX: -6, minZ: -34, maxZ: -31, floor: 2.5, height: 3.5 };

const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/** Unquantized ground; symmetric under the 180° rotation by construction. */
function rawGround(x: number, z: number) {
  const base = (x: number, z: number) => {
    let h = 2.2 + fbm(x * 0.03, z * 0.03, 41) * 3.2;
    const e = Math.max(Math.abs(x) - 54, Math.abs(z) - 37);
    if (e > 0) h += e * 0.85 + Math.abs(fbm(x * 0.07, z * 0.07, 9)) * e * 0.8;
    return h;
  };
  let h = (base(x, z) + base(-x, -z)) / 2;
  // Features are authored in west-half coordinates; fold east-half samples back onto them.
  const [fx, fz] = x > 0 ? [-x, -z] : [x, z];
  const pad = (px: number, pz: number, w: number, d: number, ph: number, blend: number) => {
    const dx = Math.max(0, Math.abs(fx - px) - w / 2), dz = Math.max(0, Math.abs(fz - pz) - d / 2);
    const t = smooth(Math.hypot(dx, dz) / blend);
    h = ph * (1 - t) + h * t;
  };
  const bump = (px: number, pz: number, r: number, bh: number) => {
    const d = Math.hypot(fx - px, fz - pz) / r;
    if (d < 1) h += bh * (1 - smooth(d));
  };
  bump(-18, -33, 13, 7.5);                        // mine hill
  bump(-44, 26, 9, 3);
  pad(-57, 0, 16, 28, 2, 6);                      // spawn
  pad(-34, -14, 28, 20, 2.5, 7);                  // village A
  pad(-24, 12, 14, 12, 2, 6);                     // south meadow
  // River: a bed at 0 with half-block banks, split around the ford at B.
  const ax = Math.abs(x);
  if (Math.abs(z) > 9) h = Math.min(h, Math.max(0, (ax - 5) * 0.5));
  else pad(0, 0, 14, 18, 1.5, 4);                 // the ford island
  return Math.max(0, h);
}

const quant = (h: number) => Math.round(h * 2) / 2;
const inTunnel = (x: number, z: number) => x > TUNNEL.minX && x < TUNNEL.maxX && z > TUNNEL.minZ && z < TUNNEL.maxZ;

/** Walkable top of the voxel ground at a west-half cell centre; the mine is cut down to its floor. */
function column(x: number, z: number) { return quant(inTunnel(x, z) ? Math.min(rawGround(x, z), TUNNEL.floor) : rawGround(x, z)); }
const gy = (x: number, z: number) => column(x, z);

function blockFor(x: number, z: number, h: number, r: () => number): VoxelId {
  if (Math.abs(x) < 6 && Math.abs(z) > 9 && h < 0.6) return 'gravel';
  if (Math.abs(x) < 10 && h < 2) return 'sand';
  if (h >= 13) return 'snow';
  if (h >= 7.5) { const o = r(); return o < 0.03 ? 'coal' : o < 0.04 ? 'gold' : o < 0.045 ? 'diamond' : 'stone'; }
  return 'grass';
}

export function blocklands(): MapDef {
  const b = new MapBuilder({
    id: 'blocks', name: 'Blocklands', region: 'VOXEL SIMULATION / TRAINING CONSTRUCT 7',
    description: 'Blocky voxel valley: a river ford fort, farm villages and a mine tunnel flank.',
    theme: 'voxel', halfX: HALF_X, halfZ: HALF_Z, seed: 3, roll: 0, ridge: 0,
    laws: cloneData(defaultLaws), sun: { x: -0.4, y: 0.78, z: 0.35 },
    ground: () => -3,
  });
  b.buildTerrain(2);

  b.mirrored(() => {
    voxelGround(b);
    // Mine tunnel roof, lit with torches.
    roofTunnel(b);
    for (let x = TUNNEL.minX + 3; x < TUNNEL.maxX; x += 6) b.light(x, TUNNEL.floor + 2.6, TUNNEL.minZ + 0.6, 0xffb45a, 5, 9);

    // ---- Spawn: cobblestone gatehouse behind the team shield ----
    b.warpgate(-57, 0, { wall: 'voxel:cobble', roof: 'voxel:planks' }, 2);
    for (const z of [-12.6, 12.6]) b.box(-63.6, 2, z, 1.6, 9, 1.6, 'voxel:log');
    b.box(-63.5, 7, 0, 1.2, 3, 4, b.mirroredSide ? 'voxel:woolRed' : 'voxel:woolBlue');

    // ---- A: farm village ----
    const ay = 2.5;
    b.point(b.mirroredSide ? 'C' : 'A', b.mirroredSide ? 'East Village' : 'West Village', -34, ay, -14, 8);
    house(b, -36, -20, 10, 7, ay);
    house(b, -44, -8, 7, 7, ay);
    // Fenced wheat-less field and a well.
    for (const [x, z, w, d] of [[-30, -6, 10, 1], [-25.5, -9.5, 1, 6]]) b.box(x, ay, z, w, 1, d, 'voxel:planks');
    b.box(-30, ay, -14, 3, 1, 3, 'voxel:cobble');
    b.box(-31, ay + 1, -14, 0.5, 2.2, 0.5, 'voxel:log'); b.box(-29, ay + 1, -14, 0.5, 2.2, 0.5, 'voxel:log');
    b.box(-30, ay + 3.2, -14, 3, 0.5, 3, 'voxel:planksRed');
    b.box(-40, ay, -6, 2, 2, 2, 'voxel:planks');
    b.box(-24, ay, -19, 2, 1, 1, 'voxel:log');

    // ---- Riverside: bridges and cover ----
    // Bridge deck level with the banks; the shallow river can also be waded.
    b.box(0, 0.5, -28, 16, 0.5, 4, 'voxel:planks');
    b.box(-3.5, 1, -29.75, 1, 1, 0.5, 'voxel:log'); b.box(3.5, 1, -26.25, 1, 1, 0.5, 'voxel:log');
    b.box(-14, gy(-14, 14), 14, 2, 2, 2, 'voxel:cobble');
    b.box(-18, gy(-18, 20), 20, 3, 1, 1, 'voxel:cobble');
    b.box(-12, gy(-12, -12), -12, 1, 2, 3, 'voxel:stonebrick');

    // ---- Watchtower on the south-west rise ----
    tower(b, -44, 26);

    // ---- Trees ----
    const r = rng(5);
    for (const [x, z] of [[-50, -28], [-26, -40], [-38, 36], [-20, 32], [-52, 16], [-12, 24], [-46, -36], [-30, 20], [-8, -18], [-58, 34], [-58, -34]]) {
      tree(b, x + (r() - 0.5) * 2, z + (r() - 0.5) * 2, 4 + Math.floor(r() * 2));
    }
  });

  // ---- B: the ford fort ----
  const by = 1.5;
  b.mirrored(() => {
    b.box(-6.5, by, -5, 1, 1.5, 6, 'voxel:stonebrick');
    b.box(-4, by, -8.5, 6, 1.5, 1, 'voxel:stonebrick');
    b.box(-6.5, by, -8.5, 1, 4, 1, 'voxel:stonebrick');             // corner turret
    b.light(-6.5, by + 4.4, -8.5, 0xffb45a, 5, 10);
    b.box(-3, by, 3, 2, 1, 1, 'voxel:cobble');
  });
  b.box(0, by, 0, 2.6, 2.4, 2.6, 'voxel:stonebrick');
  b.raw({ kind: 'reactor', x: 0, y: by, z: 0 });
  b.point('B', 'Ford Fort', 0, by, 0, 8.5);
  for (const s of [-1, 1]) b.raw({ kind: 'water', minX: -6, maxX: 6, minZ: s < 0 ? -HALF_Z - MARGIN : 9, maxZ: s < 0 ? -9 : HALF_Z + MARGIN, y: 0.6 });

  return b.build();
}

/** Greedy-merges the west half of the voxel ground into as few columns as possible. */
function voxelGround(b: MapBuilder) {
  const x0 = -HALF_X - MARGIN, z0 = -HALF_Z - MARGIN, w = HALF_X + MARGIN, d = (HALF_Z + MARGIN) * 2;
  const r = rng(77);
  const height = new Float32Array(w * d), kind: VoxelId[] = [];
  const outside = new Uint8Array(w * d);
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const x = x0 + i + 0.5, z = z0 + j + 0.5, k = j * w + i;
    outside[k] = Math.abs(x) > HALF_X + 1 || Math.abs(z) > HALF_Z + 1 ? 1 : 0;
    // Scenery past the bounds steps in whole blocks, which merges into far fewer boxes.
    const h = outside[k] ? Math.round(column(x, z)) : column(x, z);
    height[k] = h; kind[k] = outside[k] ? (h >= 13 ? 'snow' : h >= 7 ? 'stone' : blockFor(x, z, h, r)) : blockFor(x, z, h, r);
  }
  const done = new Uint8Array(w * d);
  const same = (a: number, c: number) => !done[c] && height[a] === height[c] && kind[a] === kind[c] && outside[a] === outside[c];
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const a = j * w + i;
    if (done[a]) continue;
    let rw = 1;
    while (i + rw < w && same(a, a + rw)) rw++;
    let rd = 1;
    grow: while (j + rd < d) {
      for (let k = 0; k < rw; k++) if (!same(a, (j + rd) * w + i + k)) break grow;
      rd++;
    }
    for (let jj = j; jj < j + rd; jj++) done.fill(1, jj * w + i, jj * w + i + rw);
    const h = height[a];
    if (outside[a]) b.scenery(x0 + i + rw / 2, -3, z0 + j + rd / 2, rw, h + 3, rd, kind[a]);
    else b.box(x0 + i + rw / 2, -3, z0 + j + rd / 2, rw, h + 3, rd, `voxel:${kind[a]}`);
  }
}

/** Stone above the tunnel up to the hill surface, merged along the tunnel's length. */
function roofTunnel(b: MapBuilder) {
  const bottom = TUNNEL.floor + TUNNEL.height;
  for (let z = TUNNEL.minZ; z < TUNNEL.maxZ; z++) {
    let start = TUNNEL.minX, top = quant(rawGround(start + 0.5, z + 0.5));
    for (let x = TUNNEL.minX + 1; x <= TUNNEL.maxX; x++) {
      const next = x < TUNNEL.maxX ? quant(rawGround(x + 0.5, z + 0.5)) : -1;
      if (next === top) continue;
      if (top > bottom) b.box((start + x) / 2, bottom, z + 0.5, x - start, top - bottom, 1, 'voxel:stone');
      start = x; top = next;
    }
  }
}

/** Plank cottage with log corners, a doorway on each long side, windows and a red roof. */
function house(b: MapBuilder, x: number, z: number, w: number, d: number, y: number) {
  b.bunker(x, z, w, d, { y, h: 3.5, roof: false, style: 'voxel:planks', doors: [['s', -1.5, 1.6], ['n', 2, 1.6]], windows: [['e', 0, 1.6], ['w', 0, 1.6], ['s', 2.5, 1.4]] });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(x + sx * (w / 2 - 0.5), y, z + sz * (d / 2 - 0.5), 1, 4, 1, 'voxel:log');
  b.box(x, y + 3.5, z, w + 1, 0.5, d + 1, 'voxel:planksRed');
  b.box(x, y + 4, z, w - 1, 0.5, d - 2, 'voxel:planksRed');
  b.box(x, y + 4.5, z, w - 3, 0.5, d - 4, 'voxel:planksRed');
}

/** Cobblestone watchtower with a stair up the side to a battlemented top. */
function tower(b: MapBuilder, x: number, z: number) {
  const g = gy(x, z), top = g + 5;
  b.box(x, g, z, 4, 5, 4, 'voxel:cobble');
  b.ramp(x + 4.5, z, 5, 2, g, top, 2, 'stairs');
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1]]) b.box(x + sx * 1.75, top, z + sz * 1.75, 0.5, 1, 0.5, 'voxel:cobble');
  b.light(x, top + 1.5, z, 0xffb45a, 5, 10);
}

/** Blocky oak: a log trunk crowned with two layers of leaves (all solid, like the real thing). */
function tree(b: MapBuilder, x: number, z: number, trunk: number) {
  const cx = Math.floor(x) + 0.5, cz = Math.floor(z) + 0.5, g = gy(cx, cz);
  b.box(cx, g, cz, 1, trunk, 1, 'voxel:log');
  b.box(cx, g + trunk - 1, cz, 5, 2, 5, 'voxel:leaves');
  b.box(cx, g + trunk + 1, cz, 3, 1, 3, 'voxel:leaves');
}
