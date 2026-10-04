import type { MapBuilder } from './builder';
import type { Decor } from './types';

/** Real-world block-out baked from OpenStreetMap by tools/fetch-osm.ts. */
export interface CityData {
  title: string;
  halfX: number; halfZ: number;
  /** Compass bearing of the baked frame's -Z axis. */
  bearing: number;
  buildings: { name?: string; colour?: string; material?: string; kind: string }[];
  /** Flat [minX, minZ, width, depth, bottom × 2, top × 2, building] records. */
  boxes: number[];
  roads: { name: string; kind: string; lanes: number; pts: number[] }[];
}

export interface CityBox { minX: number; maxX: number; minZ: number; maxZ: number; bottom: number; top: number; building: number }
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

export function cityBoxes(data: CityData): CityBox[] {
  const out: CityBox[] = [];
  for (let k = 0; k < data.boxes.length; k += 7) {
    const [x, z, w, d, bottom, top, building] = data.boxes.slice(k, k + 7);
    out.push({ minX: x, maxX: x + w, minZ: z, maxZ: z + d, bottom: bottom / 2, top: top / 2, building });
  }
  return out;
}

/**
 * Opens a walkway through the buildings: inside the rectangle every box is cut back to start at
 * `ceiling`, so the block above survives as the walkway's roof.
 */
export function carve(boxes: CityBox[], r: Rect, ceiling: number): CityBox[] {
  const out: CityBox[] = [];
  for (const b of boxes) {
    if (b.maxX <= r.minX || b.minX >= r.maxX || b.maxZ <= r.minZ || b.minZ >= r.maxZ || b.bottom >= ceiling) { out.push(b); continue; }
    const ix0 = Math.max(b.minX, r.minX), ix1 = Math.min(b.maxX, r.maxX), iz0 = Math.max(b.minZ, r.minZ), iz1 = Math.min(b.maxZ, r.maxZ);
    // Up to four untouched remainders around the cut, then the raised middle.
    if (b.minX < ix0) out.push({ ...b, maxX: ix0 });
    if (b.maxX > ix1) out.push({ ...b, minX: ix1 });
    if (b.minZ < iz0) out.push({ ...b, minX: ix0, maxX: ix1, maxZ: iz0 });
    if (b.maxZ > iz1) out.push({ ...b, minX: ix0, maxX: ix1, minZ: iz1 });
    if (b.top > ceiling + 0.5) out.push({ ...b, minX: ix0, maxX: ix1, minZ: iz0, maxZ: iz1, bottom: ceiling });
  }
  return out;
}

const NAMED: Record<string, number> = {
  white: 0xe8e4dc, grey: 0x9a9a98, gray: 0x9a9a98, black: 0x3a3c40, brown: 0x80604a, red: 0xa65a42, blue: 0x6f8fb0,
  beige: 0xd8c8a8, yellow: 0xd8c070, tan: 0xc8a882, silver: 0xb8bcc0, green: 0x6f8a70,
};
const MASONRY = [0xd9cdb8, 0xa65a42, 0x8a6a52, 0xb9b2a6, 0xc7b79a, 0x7f7a74, 0xe2d8c4, 0x9c5a46];
const GLASS = [0x7d9cb8, 0x5f7f94, 0x8fb2c4, 0x4f6474, 0x9aa8b4];

/** Building colour from its OSM tags, or a stable pick from a Midtown palette. */
function colourOf(data: CityData, building: number, glass: boolean) {
  const c = data.buildings[building]?.colour?.toLowerCase();
  if (c?.startsWith('#') && c.length === 7) return parseInt(c.slice(1), 16);
  if (c && NAMED[c] !== undefined) return NAMED[c];
  const palette = glass ? GLASS : MASONRY;
  return palette[(building * 7 + 3) % palette.length];
}

/** Adds every baked building as solid, rendered city blocks. */
export function placeCity(b: MapBuilder, data: CityData, boxes: CityBox[]) {
  for (const box of boxes) {
    const info = data.buildings[box.building];
    const glass = info?.material === 'glass' || box.top > 110;
    b.box((box.minX + box.maxX) / 2, box.bottom, (box.minZ + box.maxZ) / 2, box.maxX - box.minX, box.top - box.bottom, box.maxZ - box.minZ, glass ? 'facadeGlass' : 'facade');
    (b.decor[b.decor.length - 1] as Extract<Decor, { kind: 'block' }>).color = colourOf(data, box.building, glass);
  }
}

const VEHICLES = {
  taxi: { l: 4.8, w: 1.9, h: 1.5 },
  car: { l: 4.6, w: 1.9, h: 1.45 },
  van: { l: 5.4, w: 2.1, h: 2.3 },
  bus: { l: 11.5, w: 2.6, h: 3.1 },
};
export type VehicleModel = keyof typeof VEHICLES;

/**
 * Vehicle cover: an axis-aligned collision box (lengthwise along X unless `alongZ`), drawn as a
 * procedural car with a small visual skew so rows of wrecks do not look parked by a robot.
 */
export function vehicle(b: MapBuilder, model: VehicleModel, x: number, z: number, alongZ = false, skew = 0, seed = 0) {
  const v = VEHICLES[model];
  b.box(x, 0, z, alongZ ? v.w : v.l, v.h, alongZ ? v.l : v.w, 'invisible', 'metal');
  b.raw({ kind: 'vehicle', model, ...b.at(x, z), y: 0, rotY: b.rotation((alongZ ? Math.PI / 2 : 0) + skew), seed });
}
