import { CollisionWorld, terrainHeight, type Heightfield, type Ladder, type Ramp, type Solid } from '../../shared/collision';
import type { MapDef } from '../../shared/maps/types';

/**
 * Baked light: what the sun and sky cannot give a street at run time. For a grid of points over the
 * map it holds how much of the sky each point sees (lanes, arcades and rooms are darker than open
 * squares), the sunlight that walls and paving throw back into the shade, and the glow of the map's
 * own lamps, neon and signs. The renderer reads it per pixel (baked.ts); it costs one texture read.
 *
 * It is worked out from the collision solids, off the main thread (bake.worker.ts), in a few seconds
 * after the level stands. This file has no renderer or browser code, so the worker and tests share it.
 */

/** Maps that get baked light. */
export const BAKED = new Set(['taipei']);

/** Grid spacing across and in height (m), and the height the grid stops at (above it the sky is open). */
const CELL = 2.5, LAYER = 2, TOP = 14;
/** How far a point looks for what hides the sky (m), and how far a lamp's light reaches. */
const REACH = 30, GLOW = 9;
/** Share of the sunlight a street surface throws back. */
const ALBEDO = 0.5;
/** The most light a point stores (the bytes hold the square root of light / LIGHT_MAX). */
export const LIGHT_MAX = 8;

/** A lamp: place, linear colour and strength (light at 1 m). */
export interface Emitter { x: number; y: number; z: number; r: number; g: number; b: number; power: number }

export interface BakeInput {
  solids: Solid[]; ramps: Ramp[]; terrain: Heightfield; bounds: MapDef['bounds']; ladders: Ladder[];
  /** Direction to the sun and its light (linear colour × intensity). */
  sun: { x: number; y: number; z: number }; sunLight: [number, number, number];
  emitters: Emitter[];
}

export interface BakeResult {
  /** RGBA bytes, x fastest, then y, then z: rgb the stored light, a the share of sky seen. */
  data: Uint8Array;
  size: [number, number, number];
  /** World place of the first point's cell corner, and the grid's extent (m). */
  min: [number, number, number]; extent: [number, number, number];
  rays: number; ms: number;
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex: number): [number, number, number] => [linear((hex >> 16 & 255) / 255), linear((hex >> 8 & 255) / 255), linear((hex & 255) / 255)];

/** The map's lamps: ceiling light panels, neon strips and lanterns, and its lit signs. */
export function emittersOf(map: MapDef): Emitter[] {
  const out: Emitter[] = [];
  const push = (x: number, y: number, z: number, c: [number, number, number], power: number) => out.push({ x, y, z, r: c[0], g: c[1], b: c[2], power });
  for (const d of map.decor) {
    if (d.kind === 'shape' && (d.style === 'light' || d.style === 'neon')) {
      // A panel or strip: one lamp per 2.5 m along it, a little below or beside the surface it is fixed to.
      const size = [d.max[0] - d.min[0], d.max[1] - d.min[1], d.max[2] - d.min[2]], long = size[0] > size[2] ? 0 : 2;
      const colour = d.style === 'light' ? rgb(0xfff0d8) : rgb(d.color ?? 0xffffff);
      const n = Math.max(1, Math.round(size[long] / 2.5)), area = Math.max(size[0], 0.3) * Math.max(size[2], 0.3);
      const power = d.style === 'light' ? Math.min(7, area * 0.7) : Math.min(8, 1 + size[long] * 1.5);
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n, p = [(d.min[0] + d.max[0]) / 2, d.style === 'light' ? d.min[1] - 0.3 : (d.min[1] + d.max[1]) / 2, (d.min[2] + d.max[2]) / 2];
        p[long] = d.min[long] + size[long] * k;
        push(p[0], p[1], p[2], colour, power / n * (d.style === 'light' ? n : 1));
      }
    } else if (d.kind === 'ball' && d.style === 'neon') {
      push(d.x, d.y, d.z, rgb(d.color ?? 0xffb060), 4);
    } else if (d.kind === 'sign') {
      const bg = rgb(parseInt(d.bg.slice(1), 16)), fg = rgb(parseInt(d.fg.slice(1), 16));
      const colour: [number, number, number] = [bg[0] * 0.7 + fg[0] * 0.3, bg[1] * 0.7 + fg[1] * 0.3, bg[2] * 0.7 + fg[2] * 0.3];
      // In front of its face (a blade sign hangs clear of the wall and shows both ways).
      const out1 = d.style === 'blade' ? 0 : 0.5;
      push(d.x + Math.sin(d.rotY) * out1, d.y, d.z - Math.cos(d.rotY) * out1, colour, Math.min(24, 2.5 * d.w * d.h));
    }
  }
  return out;
}

export function bakeInput(map: MapDef, sunLight: [number, number, number]): BakeInput {
  return { solids: map.solids, ramps: map.ramps, terrain: map.terrain, bounds: map.bounds, ladders: map.ladders ?? [], sun: map.sun, sunLight, emitters: emittersOf(map) };
}

/** Directions spread evenly over the upper hemisphere (y from just over the horizon to straight up). */
function hemisphere(n: number) {
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const y = (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * 2.39996323;
    out.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r });
  }
  return out;
}

export function bakeLight(input: BakeInput): BakeResult {
  const t0 = performance.now();
  const world = new CollisionWorld(input.solids, input.ramps, input.terrain, input.bounds, input.ladders);
  const walls = input.solids.filter(s => s.team === undefined);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const s of walls) { x0 = Math.min(x0, s.minX); z0 = Math.min(z0, s.minZ); x1 = Math.max(x1, s.maxX); z1 = Math.max(z1, s.maxZ); }
  if (!walls.length) { x0 = input.bounds.minX; x1 = input.bounds.maxX; z0 = input.bounds.minZ; z1 = input.bounds.maxZ; }
  const nx = Math.max(2, Math.ceil((x1 - x0) / CELL)), nz = Math.max(2, Math.ceil((z1 - z0) / CELL)), ny = Math.ceil(TOP / LAYER), n = nx * ny * nz;
  const at = (ix: number, iy: number, iz: number) => ix + iy * nx + iz * nx * ny;
  const px = (ix: number) => x0 + (ix + 0.5) * CELL, py = (iy: number) => (iy + 0.5) * LAYER, pz = (iz: number) => z0 + (iz + 0.5) * CELL;

  // Points inside a wall or under the ground hold no light of their own.
  const open = new Uint8Array(n).fill(1);
  for (const s of walls) {
    for (let iz = Math.max(0, Math.ceil((s.minZ - z0) / CELL - 0.5)); iz < nz && pz(iz) < s.maxZ; iz++)
      for (let iy = Math.max(0, Math.ceil(s.minY / LAYER - 0.5)); iy < ny && py(iy) < s.maxY; iy++)
        for (let ix = Math.max(0, Math.ceil((s.minX - x0) / CELL - 0.5)); ix < nx && px(ix) < s.maxX; ix++) open[at(ix, iy, iz)] = 0;
  }
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const ground = terrainHeight(input.terrain, px(ix), pz(iz));
    for (let iy = 0; iy < ny && py(iy) < ground; iy++) open[at(ix, iy, iz)] = 0;
  }

  const sky = new Float32Array(n), light = new Float32Array(n * 3);
  const up = hemisphere(16), down = hemisphere(4).map(d => ({ x: d.x, y: -d.y, z: d.z }));
  const sunLen = Math.hypot(input.sun.x, input.sun.y, input.sun.z), sun = { x: input.sun.x / sunLen, y: input.sun.y / sunLen, z: input.sun.z / sunLen };
  let rays = 0;
  const p = { x: 0, y: 0, z: 0 }, q = { x: 0, y: 0, z: 0 };
  /** Sunlight a surface in direction `d` throws back at the point: its own sunlit share, 0 in shade. */
  const thrown = (d: { x: number; y: number; z: number }) => {
    rays++;
    const hit = world.raycast(p, d, REACH);
    if (!hit) return -1;
    const facing = hit.normal.x * sun.x + hit.normal.y * sun.y + hit.normal.z * sun.z;
    if (facing <= 0.05) return 0;
    q.x = hit.point.x + hit.normal.x * 0.06; q.y = hit.point.y + hit.normal.y * 0.06; q.z = hit.point.z + hit.normal.z * 0.06;
    rays++;
    return world.raycast(q, sun, 80) ? 0 : facing;
  };
  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const i = at(ix, iy, iz);
    if (!open[i]) continue;
    p.x = px(ix); p.y = py(iy); p.z = pz(iz);
    let seen = 0, bounce = 0;
    for (const d of up) { const b = thrown(d); if (b < 0) seen++; else bounce += b; }
    for (const d of down) bounce += Math.max(0, thrown(d));
    sky[i] = seen / up.length;
    const back = bounce / (up.length + down.length) * ALBEDO;
    light[i * 3] = input.sunLight[0] * back; light[i * 3 + 1] = input.sunLight[1] * back; light[i * 3 + 2] = input.sunLight[2] * back;
  }

  // Lamps: each lights the open points it can see, falling off with the square of the distance and to nothing at GLOW.
  const dir = { x: 0, y: 0, z: 0 };
  for (const e of input.emitters) {
    const ix0 = Math.max(0, Math.floor((e.x - GLOW - x0) / CELL)), ix1 = Math.min(nx - 1, Math.floor((e.x + GLOW - x0) / CELL));
    const iz0 = Math.max(0, Math.floor((e.z - GLOW - z0) / CELL)), iz1 = Math.min(nz - 1, Math.floor((e.z + GLOW - z0) / CELL));
    const iy0 = Math.max(0, Math.floor((e.y - GLOW) / LAYER)), iy1 = Math.min(ny - 1, Math.floor((e.y + GLOW) / LAYER));
    for (let iz = iz0; iz <= iz1; iz++) for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = at(ix, iy, iz);
      if (!open[i]) continue;
      p.x = px(ix); p.y = py(iy); p.z = pz(iz);
      dir.x = e.x - p.x; dir.y = e.y - p.y; dir.z = e.z - p.z;
      const d = Math.hypot(dir.x, dir.y, dir.z);
      if (d >= GLOW) continue;
      if (d > 0.5) {
        dir.x /= d; dir.y /= d; dir.z /= d;
        rays++;
        if (world.raycast(p, dir, d - 0.4)) continue;
      }
      const fade = 1 - (d / GLOW) ** 2, amount = e.power * fade * fade / (d * d + 1);
      light[i * 3] += e.r * amount; light[i * 3 + 1] += e.g * amount; light[i * 3 + 2] += e.b * amount;
    }
  }

  // Points in walls take the mean of their open neighbours, so the light read next to a wall is the street's, not the wall's.
  const filled = open.slice(), steps = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let pass = 0; pass < 3; pass++) {
    const next: number[] = [];
    for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
      const i = at(ix, iy, iz);
      if (filled[i]) continue;
      let count = 0, s = 0, r = 0, g = 0, b = 0;
      for (const [dx, dy, dz] of steps) {
        const jx = ix + dx, jy = iy + dy, jz = iz + dz;
        if (jx < 0 || jy < 0 || jz < 0 || jx >= nx || jy >= ny || jz >= nz) continue;
        const j = at(jx, jy, jz);
        if (!filled[j]) continue;
        count++; s += sky[j]; r += light[j * 3]; g += light[j * 3 + 1]; b += light[j * 3 + 2];
      }
      if (!count) continue;
      sky[i] = s / count; light[i * 3] = r / count; light[i * 3 + 1] = g / count; light[i * 3 + 2] = b / count;
      next.push(i);
    }
    for (const i of next) filled[i] = 1;
  }

  const data = new Uint8Array(n * 4);
  const byte = (v: number) => Math.round(Math.sqrt(Math.min(1, Math.max(0, v / LIGHT_MAX))) * 255);
  for (let i = 0; i < n; i++) {
    data[i * 4] = byte(light[i * 3]); data[i * 4 + 1] = byte(light[i * 3 + 1]); data[i * 4 + 2] = byte(light[i * 3 + 2]);
    data[i * 4 + 3] = Math.round((filled[i] ? sky[i] : 1) * 255);
  }
  return { data, size: [nx, ny, nz], min: [x0, 0, z0], extent: [nx * CELL, ny * LAYER, nz * CELL], rays, ms: Math.round(performance.now() - t0) };
}
