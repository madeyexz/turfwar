import { terrainHeight } from '../collision';
import type { Decor, MapDef } from './types';

/**
 * Prop audit for a map's dressing (map tests and dev tooling): the classes of visual bug a player
 * notices standing in the street, found from the map data alone.
 *
 * - floating: a drawn piece (a shape, a sign, a fitting) touching nothing that stands on the ground,
 *   a wall or another piece that does: an AC unit or a blade sign off its wall, a neon bar under a
 *   bridge, a lantern with no cord.
 * - buriedSigns: a sign whose face is inside, or pressed against, something solid (a booth's board
 *   facing into its own van).
 * - clashing: two props (boxes a soldier can walk up to) cutting into each other, the smaller one
 *   partly inside the larger (a scooter row through a container, a booth's awning over a van).
 * - scooters: parked scooter models (their handlebars, top and delivery boxes) cutting into each
 *   other or into anything solid other than their own row's collider.
 * - dark: big faces of a prop tinted so dark (for its surface) that they read as an untextured black
 *   slab at dusk, the more so in a gallery's shade.
 *
 * Coordinates are the map's; only pieces inside the playable bounds (plus `margin`) are checked.
 */
export interface Box { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
export interface Finding { what: string; box: Box }

const fmt = (b: Box) => [b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ].map(v => +v.toFixed(2)).join(',');
const touches = (a: Box, b: Box, eps: number) =>
  a.minX <= b.maxX + eps && a.maxX >= b.minX - eps && a.minY <= b.maxY + eps && a.maxY >= b.minY - eps && a.minZ <= b.maxZ + eps && a.maxZ >= b.minZ - eps;
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY)) * Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));
const volume = (b: Box) => (b.maxX - b.minX) * (b.maxY - b.minY) * (b.maxZ - b.minZ);
const inside = (b: Box, bounds: MapDef['bounds'], margin: number) =>
  b.maxX > bounds.minX - margin && b.minX < bounds.maxX + margin && b.maxZ > bounds.minZ - margin && b.minZ < bounds.maxZ + margin;

/** The box a sign's panel fills (a thin slab; a blade stands out from its wall, the others lie along it). */
export function signBox(d: Extract<Decor, { kind: 'sign' }>): Box {
  const hw = d.w / 2, hh = d.h / 2, t = 0.04;
  // A board faces its normal (sin rotY, -cos rotY): it spans its width across that normal; a blade along it.
  const nx = Math.abs(Math.sin(d.rotY)), nz = Math.abs(Math.cos(d.rotY));
  const [ex, ez] = d.style === 'blade' ? [nx * hw + nz * t, nz * hw + nx * t] : [nz * hw + nx * t, nx * hw + nz * t];
  return { minX: d.x - ex, maxX: d.x + ex, minY: d.y - hh, maxY: d.y + hh, minZ: d.z - ez, maxZ: d.z + ez };
}

/** The box a drawn piece fills, or undefined for things with no extent of their own (markings, instances, lights…). */
export function decorBox(d: Decor, def: MapDef): Box | undefined {
  switch (d.kind) {
    case 'block': return def.solids[d.solid];
    case 'shape': return { minX: d.min[0], minY: d.min[1], minZ: d.min[2], maxX: d.max[0], maxY: d.max[1], maxZ: d.max[2] };
    case 'detail': return { minX: d.x - d.w / 2, maxX: d.x + d.w / 2, minY: d.y, maxY: d.y + d.h, minZ: d.z - d.d / 2, maxZ: d.z + d.d / 2 };
    case 'cylinder': {
      const r = d.radius;
      if (d.axis === 'y') return { minX: d.x - r, maxX: d.x + r, minY: d.y, maxY: d.y + d.height, minZ: d.z - r, maxZ: d.z + r };
      const h = d.height / 2;
      return d.axis === 'x' ? { minX: d.x - h, maxX: d.x + h, minY: d.y, maxY: d.y + 2 * r, minZ: d.z - r, maxZ: d.z + r }
        : { minX: d.x - r, maxX: d.x + r, minY: d.y, maxY: d.y + 2 * r, minZ: d.z - h, maxZ: d.z + h };
    }
    case 'ball': return { minX: d.x - d.radius, maxX: d.x + d.radius, minY: d.y - d.radius, maxY: d.y + d.radius, minZ: d.z - d.radius, maxZ: d.z + d.radius };
    case 'sign': return signBox(d);
    case 'ramp': { const r = def.ramps[d.ramp]; return { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, minY: Math.min(r.y0, r.y1, r.base ?? r.y0), maxY: Math.max(r.y0, r.y1) }; }
    default: return undefined;
  }
}

/** Grid of boxes for neighbour queries. */
class Grid {
  private cells = new Map<number, number[]>();
  constructor(readonly boxes: Box[], private cell = 4) {
    boxes.forEach((b, i) => this.each(b, k => { const l = this.cells.get(k); if (l) l.push(i); else this.cells.set(k, [i]); }));
  }
  private each(b: Box, f: (k: number) => void) {
    for (let x = Math.floor(b.minX / this.cell); x <= Math.floor(b.maxX / this.cell); x++)
      for (let z = Math.floor(b.minZ / this.cell); z <= Math.floor(b.maxZ / this.cell); z++) f((x + 4096) * 8192 + z + 4096);
  }
  near(b: Box, eps: number, visit: (i: number) => void) {
    const seen = new Set<number>(), g = { ...b, minX: b.minX - eps, minZ: b.minZ - eps, maxX: b.maxX + eps, maxZ: b.maxZ + eps };
    this.each(g, k => { for (const i of this.cells.get(k) ?? []) if (!seen.has(i)) { seen.add(i); visit(i); } });
  }
}

/** Drawn pieces inside the bounds that nothing holds up: neither the ground nor anything that stands on it. */
export function floating(def: MapDef, opts: { eps?: number; margin?: number } = {}): Finding[] {
  const eps = opts.eps ?? 0.06, margin = opts.margin ?? 0;
  const items: { what: string; box: Box; decor: boolean }[] = [];
  def.solids.forEach((s, i) => items.push({ what: `solid ${i}`, box: s, decor: false }));
  def.ramps.forEach((r, i) => items.push({ what: `ramp ${i}`, box: { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, minY: Math.min(r.y0, r.y1, r.base ?? r.y0), maxY: Math.max(r.y0, r.y1) }, decor: false }));
  for (const d of def.decor) {
    if (d.kind === 'block' || d.kind === 'ramp') continue;
    const box = decorBox(d, def);
    if (box) items.push({ what: describe(d), box, decor: true });
  }
  const grid = new Grid(items.map(i => i.box));
  const held = new Uint8Array(items.length), queue: number[] = [];
  items.forEach((it, i) => {
    const ground = terrainHeight(def.terrain, (it.box.minX + it.box.maxX) / 2, (it.box.minZ + it.box.maxZ) / 2);
    if (it.box.minY <= ground + eps) { held[i] = 1; queue.push(i); }
  });
  while (queue.length) {
    const i = queue.pop()!;
    grid.near(items[i].box, eps, j => { if (!held[j] && touches(items[i].box, items[j].box, eps)) { held[j] = 1; queue.push(j); } });
  }
  return items.filter((it, i) => it.decor && !held[i] && inside(it.box, def.bounds, margin)).map(it => ({ what: it.what, box: it.box }));
}

/** Signs inside something solid, or with something solid right in front of their face. */
export function buriedSigns(def: MapDef, opts: { margin?: number } = {}): Finding[] {
  const out: Finding[] = [], solids = new Grid(def.solids);
  for (const d of def.decor) {
    if (d.kind !== 'sign' || d.style === 'blade') continue;
    const box = signBox(d);
    if (!inside(box, def.bounds, opts.margin ?? 0)) continue;
    // Points across the face, 12 cm in front of it.
    const nx = Math.sin(d.rotY), nz = -Math.cos(d.rotY), rx = -Math.cos(d.rotY), rz = -Math.sin(d.rotY);
    let hits = 0, n = 0;
    for (const u of [-0.35, 0, 0.35]) for (const v of [-0.3, 0, 0.3]) {
      const px = d.x + nx * 0.12 + rx * u * d.w, py = d.y + v * d.h, pz = d.z + nz * 0.12 + rz * u * d.w;
      n++;
      let hit = false;
      solids.near({ minX: px, maxX: px, minY: py, maxY: py, minZ: pz, maxZ: pz }, 0, i => {
        const s = def.solids[i];
        if (!hit && px > s.minX && px < s.maxX && py > s.minY && py < s.maxY && pz > s.minZ && pz < s.maxZ) hit = true;
      });
      if (hit) hits++;
    }
    if (hits * 2 > n) out.push({ what: `sign ${d.style} ${d.text}`, box });
  }
  return out;
}

/**
 * Props cutting into each other: pairs of solid boxes, each small enough to be street furniture
 * (under `maxVolume` m³), where the smaller is partly (not wholly, not just touching) inside the
 * larger. Pieces of one composite prop that are built nested (a booth's body on its counter) only
 * touch, so they do not count.
 */
export function clashing(def: MapDef, opts: { maxVolume?: number; minDepth?: number; margin?: number; ignore?: (a: Box, b: Box) => boolean } = {}): Finding[] {
  const maxVolume = opts.maxVolume ?? 60, minDepth = opts.minDepth ?? 0.08, out: Finding[] = [];
  const drawn = new Set<number>();
  for (const d of def.decor) if (d.kind === 'block') drawn.add(d.solid);
  const grid = new Grid(def.solids);
  def.solids.forEach((a, i) => {
    if (!drawn.has(i) || volume(a) > maxVolume || !inside(a, def.bounds, opts.margin ?? 0)) return;
    grid.near(a, 0, j => {
      if (j <= i || !drawn.has(j)) return;
      const b = def.solids[j];
      if (volume(b) > maxVolume) return;
      const dx = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX), dy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY), dz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
      if (dx < minDepth || dy < minDepth || dz < minDepth) return;
      const f = overlap(a, b) / Math.min(volume(a), volume(b));
      if (f > 0.97) return;
      if (opts.ignore?.(a, b)) return;
      out.push({ what: `solid ${i} × solid ${j} (${(f * 100).toFixed(0)}% of the smaller): ${fmt(b)}`, box: a });
    });
  });
  return out;
}

/** The parked scooters' model, from its centre along its heading: handlebar 0.72 wide, delivery box out to 1.02 behind, front wheel 0.7 ahead. */
const SCOOTER = { half: 0.36, back: 1.02, front: 0.7, top: 1.36 };

/** Parked scooter models cutting into each other, or into a solid other than the low collider under their own row. */
export function scooters(def: MapDef, opts: { margin?: number } = {}): Finding[] {
  const list: { x: number; y: number; z: number; h: number; box: Box }[] = [];
  for (const d of def.decor) if (d.kind === 'instances' && d.model === 'scooter') for (let i = 0; i < d.data.length; i += 8) {
    const [x, y, z, h] = d.data.slice(i, i + 4);
    // Heading 0 points along +z; heading h turns it to (-sin h, cos h).
    const fx = -Math.sin(h), fz = Math.cos(h), ex = Math.abs(fz) * SCOOTER.half + Math.abs(fx) * (SCOOTER.back + SCOOTER.front) / 2;
    const ez = Math.abs(fx) * SCOOTER.half + Math.abs(fz) * (SCOOTER.back + SCOOTER.front) / 2, mid = (SCOOTER.front - SCOOTER.back) / 2;
    const cx = x + fx * mid, cz = z + fz * mid;
    list.push({ x, y, z, h, box: { minX: cx - ex, maxX: cx + ex, minY: y, maxY: y + SCOOTER.top, minZ: cz - ez, maxZ: cz + ez } });
  }
  const out: Finding[] = [];
  // Scooter against scooter: exact, in the first one's frame (two oriented rectangles; sample the second's outline).
  const cornersOf = (s: (typeof list)[number]) => {
    const fx = -Math.sin(s.h), fz = Math.cos(s.h), rx = fz, rz = -fx, pts: [number, number][] = [];
    for (const a of [-SCOOTER.back, -0.5, 0, 0.5, SCOOTER.front]) for (const b of [-SCOOTER.half, 0, SCOOTER.half]) pts.push([s.x + fx * a + rx * b, s.z + fz * a + rz * b]);
    return pts;
  };
  const contains = (s: (typeof list)[number], px: number, pz: number, shrink: number) => {
    const fx = -Math.sin(s.h), fz = Math.cos(s.h), dx = px - s.x, dz = pz - s.z, a = dx * fx + dz * fz, b = dx * fz - dz * fx;
    return a > -SCOOTER.back + shrink && a < SCOOTER.front - shrink && Math.abs(b) < SCOOTER.half - shrink;
  };
  const grid = new Grid(list.map(s => s.box));
  list.forEach((s, i) => {
    if (!inside(s.box, def.bounds, opts.margin ?? 0)) return;
    grid.near(s.box, 0, j => {
      if (j <= i) return;
      if (cornersOf(list[j]).some(([px, pz]) => contains(s, px, pz, 0.02)) || cornersOf(s).some(([px, pz]) => contains(list[j], px, pz, 0.02)))
        out.push({ what: `scooter at ${s.x.toFixed(2)},${s.z.toFixed(2)} × scooter at ${list[j].x.toFixed(2)},${list[j].z.toFixed(2)}`, box: s.box });
    });
  });
  // Scooter against anything solid above its row's collider (1.05 m): a container, a van, a post.
  const solids = new Grid(def.solids);
  for (const s of list) {
    if (!inside(s.box, def.bounds, opts.margin ?? 0)) continue;
    let hit: string | undefined;
    for (const [px, pz] of cornersOf(s)) for (const py of [0.5, 1.0, 1.3]) solids.near({ minX: px, maxX: px, minY: py, maxY: py, minZ: pz, maxZ: pz }, 0, k => {
      const o = def.solids[k];
      // The row's own collider (knee-high, under the scooters) is not a clash.
      if (hit || Math.abs(o.maxY - (s.y + 1.05)) < 0.01 && o.minY <= s.y + 0.01) return;
      if (px > o.minX + 0.02 && px < o.maxX - 0.02 && pz > o.minZ + 0.02 && pz < o.maxZ - 0.02 && py > o.minY && py < o.maxY) hit = `solid ${k}: ${fmt(o)}`;
    });
    if (hit) out.push({ what: `scooter at ${s.x.toFixed(2)},${s.z.toFixed(2)} into ${hit}`, box: s.box });
  }
  return out;
}

/** Relative luminance of a 0xRRGGBB tint (0 black, 1 white). */
export const luminance = (hex: number) => {
  const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

/**
 * Prop faces a soldier sees head-on (standing on the ground, under 6 m) of at least `area` m² tinted
 * darker than `threshold` (luminance): they read as untextured black slabs at dusk, more so in a
 * gallery's shade. Styles with a texture that reads by itself (wood grain, glass, neon, lit panels, asphalt) are left out.
 */
export function dark(def: MapDef, opts: { threshold?: number; area?: number; margin?: number } = {}): Finding[] {
  const threshold = opts.threshold ?? 0.08, minArea = opts.area ?? 2.5, out: Finding[] = [];
  // The renderer's surface textures darken some tints further (src/render/level.ts LOOKS): rusty paint about by half.
  const factor: Record<string, number> = { steel: 0.5, brick: 0.8, concrete: 0.85 };
  const skip = new Set(['wood', 'glass', 'window', 'neon', 'light', 'asphalt', 'invisible', 'hedge', 'curtain', 'facade', 'mosaic', 'carpet', 'roof', 'tile', 'paving', 'cobble', 'slab']);
  for (const d of def.decor) {
    if ((d.kind !== 'block' && d.kind !== 'shape') || d.color === undefined || skip.has(d.style)) continue;
    const b = decorBox(d, def)!;
    if (b.minY > 3 || !inside(b, def.bounds, opts.margin ?? 0)) continue;
    // (Thin trims and ribs are lines, not faces.)
    if (Math.min(b.maxX - b.minX, b.maxZ - b.minZ, b.maxY - b.minY) < 0.1) continue;
    const h = Math.min(b.maxY, 6) - Math.max(b.minY, 0), face = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * h;
    if (face >= minArea && luminance(d.color) * (factor[d.style] ?? 1) < threshold) out.push({ what: `${d.kind} ${d.style} #${d.color.toString(16).padStart(6, '0')} ${face.toFixed(1)} m²`, box: b });
  }
  return out;
}

function describe(d: Decor) {
  switch (d.kind) {
    case 'shape': return `shape ${d.style}${d.color !== undefined ? ` #${d.color.toString(16)}` : ''}`;
    case 'sign': return `sign ${d.style} ${d.text}`;
    case 'cylinder': return `cylinder ${d.style}`;
    case 'ball': return `ball ${d.style}`;
    case 'detail': return `detail ${d.style}`;
    default: return d.kind;
  }
}

export const formatFinding = (f: Finding) => `${f.what} @ ${fmt(f.box)}`;
