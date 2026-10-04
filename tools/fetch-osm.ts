/**
 * Downloads real building footprints, heights and streets from OpenStreetMap and bakes them
 * into a compact block-out the shared simulation can load (shared/maps/data/<site>.ts).
 *
 *   bun tools/fetch-osm.ts times-square [--preview out.png]
 *
 * Footprints are rasterized on a 1 m grid in a frame rotated so the street grid runs along the
 * axes, then merged into as few boxes as possible, so the result is plain collision boxes.
 * Map data © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0):
 * https://www.openstreetmap.org/copyright. The baked files are derived databases under ODbL.
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Site {
  /** Centre of the playable area. */
  lat: number; lon: number;
  /** Compass bearing of the street grid's "north" axis; the baked frame aligns it with -Z. */
  bearing: number;
  /** Half extents of the baked area in metres (playable area plus skyline margin). */
  halfX: number; halfZ: number;
  title: string;
}

const SITES: Record<string, Site> = {
  // Manhattan's avenues run 29° east of true north; turn them onto the X axis, uptown at -X.
  'times-square': { lat: 40.75797, lon: -73.98554, bearing: -61, halfX: 170, halfZ: 130, title: 'Times Square, Manhattan, New York City' },
};

const LEVEL = 3.4, DEFAULT_HEIGHT = 14, MAX_HEIGHT = 180;
const ROAD_KINDS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian', 'service']);

const args = process.argv.slice(2);
const id = args[0];
const site = SITES[id];
if (!site) throw new Error(`usage: bun tools/fetch-osm.ts <${Object.keys(SITES).join('|')}> [--preview file.png]`);
const previewPath = args.includes('--preview') ? args[args.indexOf('--preview') + 1] : undefined;

// ---- Download -----------------------------------------------------------------------------
const mPerLat = 111_320, mPerLon = 111_320 * Math.cos(site.lat * Math.PI / 180);
const radius = Math.hypot(site.halfX, site.halfZ) + 10;
const bbox = [site.lon - radius / mPerLon, site.lat - radius / mPerLat, site.lon + radius / mPerLon, site.lat + radius / mPerLat].map(v => v.toFixed(6)).join(',');
console.log('fetching', bbox);
const response = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`, { headers: { 'User-Agent': 'lawbreaker-map-tool/1.0' } });
if (!response.ok) throw new Error(`OSM API ${response.status}: ${await response.text()}`);
type Tags = Record<string, string>;
type Element =
  | { type: 'node'; id: number; lat: number; lon: number; tags?: Tags }
  | { type: 'way'; id: number; nodes: number[]; tags?: Tags }
  | { type: 'relation'; id: number; members: { type: string; ref: number; role: string }[]; tags?: Tags };
const { elements } = await response.json() as { elements: Element[] };

// ---- Projection: +X east, +Z south, rotated so the grid's north runs along -Z ---------------------
const a = -site.bearing * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
const nodes = new Map<number, [number, number]>();
for (const e of elements) if (e.type === 'node') {
  const x = (e.lon - site.lon) * mPerLon, z = -(e.lat - site.lat) * mPerLat;
  nodes.set(e.id, [x * ca - z * sa, x * sa + z * ca]);
}
const ways = new Map<number, Extract<Element, { type: 'way' }>>();
for (const e of elements) if (e.type === 'way') ways.set(e.id, e);
const ring = (refs: number[]) => refs.map(r => nodes.get(r)).filter((p): p is [number, number] => !!p);

/** Joins relation member ways end to end into closed rings. */
function stitch(refs: number[][]): number[][] {
  const open = refs.map(r => [...r]), rings: number[][] = [];
  while (open.length) {
    const cur = open.shift()!;
    let grew = true;
    while (cur[0] !== cur[cur.length - 1] && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const w = open[i];
        if (w[0] === cur[cur.length - 1]) cur.push(...w.slice(1));
        else if (w[w.length - 1] === cur[cur.length - 1]) cur.push(...w.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1); grew = true; break;
      }
    }
    if (cur[0] === cur[cur.length - 1]) rings.push(cur);
  }
  return rings;
}

function heightOf(t: Tags, fallback = DEFAULT_HEIGHT) {
  const h = parseFloat(t.height ?? '');
  if (h > 0) return h;
  const levels = parseFloat(t['building:levels'] ?? '');
  return levels > 0 ? levels * LEVEL + 1 : fallback;
}

interface Shape { rings: [number, number][][]; bottom: number; top: number; building: number }
interface BuildingInfo { name?: string; colour?: string; material?: string; kind: string }
const buildings: BuildingInfo[] = [], outlines: Shape[] = [], parts: Shape[] = [];
const info = (t: Tags): BuildingInfo => ({ name: t.name, colour: t['building:colour'], material: t['building:material'], kind: t.building ?? t['building:part'] ?? 'yes' });

for (const e of elements) {
  const t = e.tags;
  if (!t || e.type === 'node') continue;
  const isPart = !!t['building:part'] && t['building:part'] !== 'no';
  if (!isPart && !t.building) continue;
  let rings: [number, number][][];
  if (e.type === 'way') {
    if (e.nodes[0] !== e.nodes[e.nodes.length - 1]) continue;
    rings = [ring(e.nodes)];
  } else {
    if (t.type !== 'multipolygon') continue;
    const member = (role: string) => e.members.filter(m => m.type === 'way' && m.role === role).map(m => ways.get(m.ref)?.nodes).filter((n): n is number[] => !!n);
    rings = [...stitch(member('outer')), ...stitch(member('inner'))].map(ring);
  }
  if (!rings.length || rings[0].length < 4) continue;
  const top = Math.min(MAX_HEIGHT, heightOf(t));
  const bottom = Math.min(top - 1, parseFloat(t.min_height ?? '0') || 0);
  if (isPart) parts.push({ rings, bottom, top, building: -1 });
  else { buildings.push(info(t)); outlines.push({ rings, bottom: 0, top, building: buildings.length - 1 }); }
}

// ---- Rasterize on a 1 m grid ------------------------------------------------------------------
const W = site.halfX * 2, D = site.halfZ * 2;
const owner = new Int32Array(W * D).fill(-1), bottoms = new Float32Array(W * D), tops = new Float32Array(W * D);
const partTop = new Float32Array(W * D), partBottom = new Float32Array(W * D).fill(Infinity), partOwner = new Int32Array(W * D).fill(-1);

/** Calls fill(index) for every grid cell whose centre lies inside the shape (even-odd rule). */
function rasterize(s: Shape, fill: (i: number) => void) {
  const edges = s.rings.flatMap(r => r.slice(1).map((p, k) => [r[k], p] as const));
  let minZ = Infinity, maxZ = -Infinity;
  for (const r of s.rings) for (const [, z] of r) { minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  for (let j = Math.max(0, Math.floor(minZ + site.halfZ)); j < Math.min(D, Math.ceil(maxZ + site.halfZ)); j++) {
    const z = j - site.halfZ + 0.5, xs: number[] = [];
    for (const [[x0, z0], [x1, z1]] of edges) if ((z0 <= z) !== (z1 <= z)) xs.push(x0 + (z - z0) / (z1 - z0) * (x1 - x0));
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.round(xs[k] + site.halfX)), i1 = Math.min(W, Math.round(xs[k + 1] + site.halfX));
      for (let i = i0; i < i1; i++) fill(j * W + i);
    }
  }
}

// Larger outlines first, so a small building drawn inside a big one (a courtyard kiosk) wins.
const area = (s: Shape) => Math.abs(s.rings[0].reduce((acc, [x, z], k, r) => acc + x * r[(k + 1) % r.length][1] - r[(k + 1) % r.length][0] * z, 0)) / 2;
outlines.sort((p, q) => area(q) - area(p));
for (const s of outlines) rasterize(s, i => { owner[i] = s.building; tops[i] = s.top; bottoms[i] = 0; });
// Building parts carve setbacks and arcades out of their outline (or stand alone).
for (const s of parts) rasterize(s, i => {
  partTop[i] = Math.max(partTop[i], s.top); partBottom[i] = Math.min(partBottom[i], s.bottom);
  if (owner[i] < 0 && partOwner[i] < 0) {
    if (s.building < 0) { buildings.push({ kind: 'part' }); s.building = buildings.length - 1; }
    partOwner[i] = s.building;
  }
});
for (let i = 0; i < W * D; i++) {
  if (!partTop[i]) continue;
  if (owner[i] < 0) owner[i] = partOwner[i];
  tops[i] = partTop[i];
  // Only open a ground-floor arcade where every part over the cell floats well above the street.
  bottoms[i] = partBottom[i] >= 3 ? partBottom[i] : 0;
}

// ---- Merge cells into boxes ---------------------------------------------------------------------
const q = (h: number) => Math.round(h * 2);
const key = (i: number) => owner[i] < 0 ? -1 : owner[i] * 1e6 + q(tops[i]) * 1000 + q(bottoms[i]);
const keys = new Float64Array(W * D);
for (let i = 0; i < W * D; i++) keys[i] = key(i);
const boxes: number[] = [];
for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
  const k = keys[j * W + i];
  if (k < 0) continue;
  let w = 1;
  while (i + w < W && keys[j * W + i + w] === k) w++;
  let d = 1;
  grow: while (j + d < D) {
    for (let m = 0; m < w; m++) if (keys[(j + d) * W + i + m] !== k) break grow;
    d++;
  }
  for (let jj = j; jj < j + d; jj++) keys.fill(-1, jj * W + i, jj * W + i + w);
  const c = j * W + i;
  boxes.push(i - site.halfX, j - site.halfZ, w, d, q(bottoms[c]), q(tops[c]), owner[c]);
}

// ---- Streets ------------------------------------------------------------------------------------
const roads: { name: string; kind: string; lanes: number; pts: number[] }[] = [];
for (const w of ways.values()) {
  const t = w.tags;
  if (!t?.highway || !ROAD_KINDS.has(t.highway) || t.area === 'yes') continue;
  const pts = ring(w.nodes).flatMap(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
  if (pts.length >= 4) roads.push({ name: t.name ?? '', kind: t.highway, lanes: parseInt(t.lanes ?? '0') || 0, pts });
}

// Drop buildings no box refers to and renumber.
const used = [...new Set(boxes.filter((_, k) => k % 7 === 6))].sort((p, q2) => p - q2);
const remap = new Map(used.map((b, k) => [b, k]));
for (let k = 6; k < boxes.length; k += 7) boxes[k] = remap.get(boxes[k])!;
const kept = used.map(b => Object.fromEntries(Object.entries(buildings[b]).filter(([, v]) => v !== undefined)));

const out = join(import.meta.dir, '../shared/maps/data');
mkdirSync(out, { recursive: true });
const name = id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
writeFileSync(join(out, `${id}.ts`), `// Generated by tools/fetch-osm.ts from OpenStreetMap on ${new Date().toISOString().slice(0, 10)}. Do not edit.
// ${site.title}. Map data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
import type { CityData } from '../city';

export const ${name}: CityData = {
  title: ${JSON.stringify(site.title)},
  halfX: ${site.halfX}, halfZ: ${site.halfZ}, bearing: ${site.bearing},
  buildings: ${JSON.stringify(kept)},
  // [minX, minZ, width, depth, bottom × 2, top × 2, building] per box, metres on a 1 m grid.
  boxes: [${boxes.join(',')}],
  roads: ${JSON.stringify(roads)},
};
`);
console.log(`${id}: ${kept.length} buildings, ${boxes.length / 7} boxes, ${roads.length} roads`);

if (previewPath) {
  const px = Buffer.alloc(W * D * 3, 40);
  for (let i = 0; i < W * D; i++) if (owner[i] >= 0) {
    const v = Math.min(255, 70 + tops[i] * 1.5);
    px[i * 3] = v; px[i * 3 + 1] = bottoms[i] > 0 ? 60 : v; px[i * 3 + 2] = v * (0.6 + (owner[i] % 5) * 0.1);
  }
  for (const r of roads) for (let k = 0; k + 3 < r.pts.length; k += 2) {
    const steps = Math.ceil(Math.hypot(r.pts[k + 2] - r.pts[k], r.pts[k + 3] - r.pts[k + 1]));
    for (let s = 0; s <= steps; s++) {
      const t = s / Math.max(1, steps);
      const i = Math.floor(r.pts[k] + (r.pts[k + 2] - r.pts[k]) * t + site.halfX), j = Math.floor(r.pts[k + 1] + (r.pts[k + 3] - r.pts[k + 1]) * t + site.halfZ);
      if (i >= 0 && j >= 0 && i < W && j < D) px.set([255, 200, 40], (j * W + i) * 3);
    }
  }
  // 10 m grid lines for laying out the playable area.
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) if ((i - site.halfX) % 10 === 0 || (j - site.halfZ) % 10 === 0) {
    const o = (j * W + i) * 3, major = (i - site.halfX) % 50 === 0 || (j - site.halfZ) % 50 === 0;
    px[o] = Math.min(255, px[o] + (major ? 90 : 30));
  }
  await sharp(px, { raw: { width: W, height: D, channels: 3 } }).resize(W * 3, D * 3, { kernel: 'nearest' }).png().toFile(previewPath);
}
