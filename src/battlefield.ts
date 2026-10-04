export type Point = { x: number; y: number; z: number };
export interface Structure { x: number; z: number; w: number; d: number; h: number; role: 'tower' | 'bunker' | 'wall' | 'cover' }
export interface BattleMap { name: string; region: string; description: string; ground: number; rock: number; sky: number; fog: number; accent: number; seed: number; structures: Structure[] }
const structure = (x: number, z: number, w: number, d: number, h: number, role: Structure['role']): Structure => ({ x, z, w, d, h, role });
export const maps: BattleMap[] = [
  { name: 'Cinder Basin', region: 'ASHLANDS / FORWARD OPERATING BASE', description: 'Sandstone canyons. Fortified approaches.', ground: 0x9b8263, rock: 0x78634e, sky: 0x6c8590, fog: 0xb2a38d, accent: 0x67d8df, seed: 7, structures: [
    structure(-21, 3, 11, 13, 10, 'tower'), structure(21, 3, 11, 13, 10, 'tower'),
    structure(-29, -24, 18, 16, 7, 'bunker'), structure(29, -24, 18, 16, 7, 'bunker'),
    structure(0, -39, 22, 12, 13, 'tower'), structure(-15, -38, 8, 3, 4, 'wall'), structure(15, -38, 8, 3, 4, 'wall'),
    structure(-9, 27, 5, 2, 1.4, 'cover'), structure(9, 32, 5, 2, 1.4, 'cover'), structure(-34, 24, 9, 8, 5, 'bunker'),
    structure(34, 25, 7, 3, 2, 'cover'), structure(-42, -4, 3, 22, 4, 'wall'), structure(42, -4, 3, 22, 4, 'wall'),
  ] },
  { name: 'Frostline Reach', region: 'NORTHERN FRONT / RELAY STATION', description: 'Frozen ridges. A split-level relay complex.', ground: 0xb9c9cd, rock: 0x596b7b, sky: 0x698da7, fog: 0xafc8d8, accent: 0xa79aef, seed: 19, structures: [
    structure(-27, -4, 14, 10, 9, 'tower'), structure(23, -12, 13, 15, 12, 'tower'),
    structure(-12, -36, 22, 12, 6, 'bunker'), structure(35, 27, 10, 9, 6, 'bunker'),
    structure(-30, 28, 15, 8, 5, 'bunker'), structure(-9, 24, 4, 3, 1.5, 'cover'), structure(10, 18, 4, 3, 1.5, 'cover'),
    structure(-43, -24, 3, 20, 4, 'wall'), structure(12, -36, 14, 3, 4, 'wall'),
  ] },
  { name: 'Verdant Divide', region: 'EQUATORIAL FRONT / UPLINK ARRAY', description: 'Alien forest. Scattered bunkers and rock cover.', ground: 0x738261, rock: 0x526557, sky: 0x648e91, fog: 0x91aba0, accent: 0x71e0b5, seed: 31, structures: [
    structure(-22, -15, 12, 12, 11, 'tower'), structure(25, 8, 12, 12, 8, 'tower'),
    structure(9, -33, 16, 11, 7, 'bunker'), structure(-32, 24, 13, 8, 5, 'bunker'),
    structure(36, -24, 10, 9, 5, 'bunker'), structure(-10, 19, 4, 3, 1.3, 'cover'), structure(10, 30, 5, 2, 1.3, 'cover'),
    structure(-37, -9, 3, 15, 4, 'wall'), structure(22, -37, 13, 3, 4, 'wall'),
  ] },
];
export const MAP_EDGE = 78;
export const TERRAIN_SIZE = 240;
export const TERRAIN_SEGMENTS = 100;
const spacing = TERRAIN_SIZE / TERRAIN_SEGMENTS;

function sample(x: number, z: number, map: BattleMap) {
  const radius = Math.hypot(x, z);
  const blend = Math.min(1, Math.max(0, (radius - 18) / 35));
  const waves = Math.sin(x * .06 + map.seed) * Math.cos(z * .055) * 3 + Math.sin(z * .11 + x * .035) * 1.4;
  let h = -3.25 + waves * blend;
  // Flatten building foundations; render, movement and Rapier share this terrain.
  for (const b of map.structures) {
    const distance = Math.max(Math.abs(x - b.x) - b.w / 2, Math.abs(z - b.z) - b.d / 2);
    if (distance < 4) h = h * Math.max(0, distance / 4) + -3.25 * (1 - Math.max(0, distance / 4));
  }
  return h;
}

export function groundHeight(x: number, z: number, map: BattleMap): number {
  const gx = (x + TERRAIN_SIZE / 2) / spacing, gz = (z + TERRAIN_SIZE / 2) / spacing;
  const ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz;
  const px = ix * spacing - TERRAIN_SIZE / 2, pz = iz * spacing - TERRAIN_SIZE / 2;
  const a = sample(px, pz, map), b = sample(px + spacing, pz, map);
  const c = sample(px, pz + spacing, map), d = sample(px + spacing, pz + spacing, map);
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

export function terrainData(map: BattleMap) {
  const vertices = new Float32Array((TERRAIN_SEGMENTS + 1) ** 2 * 3);
  const indices: number[] = [];
  const n = TERRAIN_SEGMENTS + 1;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const px = x * spacing - TERRAIN_SIZE / 2, pz = z * spacing - TERRAIN_SIZE / 2;
    vertices.set([px, sample(px, pz, map), pz], (z * n + x) * 3);
    if (x < n - 1 && z < n - 1) { const a = z * n + x; indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
  }
  return { vertices, indices: new Uint32Array(indices) };
}

export function segmentBox(from: Point, to: Point, b: Structure, padding = 0): boolean {
  let near = 0, far = 1;
  const lo = [b.x - b.w / 2 - padding, -3.25 - padding, b.z - b.d / 2 - padding];
  const hi = [b.x + b.w / 2 + padding, -3.25 + b.h + padding, b.z + b.d / 2 + padding];
  const start = [from.x, from.y, from.z], end = [to.x, to.y, to.z];
  for (let axis = 0; axis < 3; axis++) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-8) { if (start[axis] < lo[axis] || start[axis] > hi[axis]) return false; }
    else {
      const a = (lo[axis] - start[axis]) / delta, c = (hi[axis] - start[axis]) / delta;
      near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c));
      if (near > far) return false;
    }
  }
  return true;
}
