/**
 * The street dressing, prop models and skyline of 臺北狂飆 / TAIPEI RUSH around Ximending, for
 * tools/import-taipei.ts (see its header). Like the rest of that tool, nothing here is invented:
 * the source's own street generator runs with recording stand-ins for its renderer, and what it
 * lays out is written down.
 *
 *   street   The source's street-furniture pass (trees, lamps, signals, bus stops, YouBike docks,
 *            bollards, hydrants, postboxes, planters, scooter rows, traffic signs and road works),
 *            its guide signs and traffic signals, the Ximen MRT exit and the car bays of the side
 *            streets: primitives (boxes, lit boxes, cylinders, sign plates, ground marks), model
 *            instances, and the colliders the source gives them.
 *   models   The source's prop meshes (scooter, YouBike, camphor and banyan trees, potted plants,
 *            signal heads), built by its own code with three.js and written as plain vertex data.
 *   skyline  The city beyond the backdrop: the source's generic buildings out to 1.3 km, its
 *            landmarks (Taipei 101 among them), the hills and the major roads.
 */
import { loadSource, sink } from './import-taipei';

type Src = Awaited<ReturnType<typeof loadSource>>;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Model instances: x, y, z, heading, scale, roll, colour, extra (per model: accessory seed, bloom RGBA, signal phase). */
export const MODEL_STRIDE = 8;
const rgba = (c: number[]) => ((Math.round(Math.max(0, Math.min(1, c[3] ?? 0)) * 255) << 24) | hexOf(c)) >>> 0;
const hexOf = (rgb: number[]) => {
  const m = Math.max(1, ...rgb.slice(0, 3));
  return rgb.slice(0, 3).reduce((c, v, i) => c | (Math.round(Math.max(0, Math.min(1, v / m)) * 255) << (16 - i * 8)), 0);
};

export interface StreetOut {
  boxes: number[]; glows: number[]; cyls: number[];
  plates: (number | string)[][];
  marks: number[];
  models: Record<string, number[]>;
  solids: (number | string)[][];
  exit: Record<string, number | string>;
  carBays: number[][];
  scooterRuns: number[][];
}

/**
 * Run the source's street dressing over its whole plan and keep what falls inside `keep` (the map
 * area plus its backdrop); colliders are kept only inside `solid` (the playable area).
 */
export function extractStreet(src: Src, keep: { x0: number; z0: number; x1: number; z1: number }, solid: { x0: number; z0: number; x1: number; z1: number }): StreetOut {
  const { world, content, actors, Plan } = src;
  const plan = new Plan();
  const W = world.__kerb as number;
  const inKeep = (x: number, z: number) => x > keep.x0 && x < keep.x1 && z > keep.z0 && z < keep.z1;
  const out: StreetOut = { boxes: [], glows: [], cyls: [], plates: [], marks: [], models: {}, solids: [], exit: {}, carBays: [], scooterRuns: [] };
  const model = (name: string, ...v: number[]) => (out.models[name] ??= []).push(...v.map(r3));

  // Boxes as the source's renderer places them: bottom centre (x, y, z), size, turned by heading
  // (three.js rotation.y = -heading), optionally leaned (rotation.x = lean).
  const box = (list: number[], x: number, y: number, z: number, w: number, h: number, d: number, heading: number, color: number) => {
    if (inKeep(x, z)) list.push(...[x, y, z, w, h, d].map(r3), r3(heading), color >>> 0);
  };
  const cyl = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, color: number) => {
    if (inKeep((x0 + x1) / 2, (z0 + z1) / 2)) out.cyls.push(...[x0, y0, z0, x1, y1, z1, r].map(r3), color >>> 0);
  };
  const artKey = (a: any) => (a && typeof a === 'object' && 'key' in a ? String(a.key) : 'blank');
  const atlas: any = new Proxy({
    sign: new Proxy({}, { get: (_t, k) => ({ key: String(k) }) }),
    ads: [0, 1, 2, 3, 4, 5].map(i => ({ key: `ad${i}` })),
    addStreet: (r: any) => ({ key: `street:${r.zh}|${r.sec ?? ''}|${r.en ?? ''}` }),
    full: false, dynOf: new Map(), dynInst: [],
  }, { get: (t: any, k) => (k in t ? t[k] : typeof k === 'string' ? (...a: any[]) => ({ key: `${k}:${a.filter(v => typeof v !== 'object').join('|')}` }) : undefined) });

  // The source's prop renderer (its class Kl), recording instead of drawing.
  const props: any = {
    atlas, ds: 1, maxView: 2000, brk: null, lampCount: 0,
    boxO: (x: number, y: number, z: number, w: number, h: number, d: number, heading: number, color: number) => box(out.boxes, x, y, z, w, h, d, heading, color),
    ledBar: (x: number, y: number, z: number, w: number, h: number, d: number, heading: number, rgb: number[]) => box(out.glows, x, y, z, w, h, d, heading, hexOf(rgb)),
    cylV: (x: number, y0: number, z: number, y1: number, r: number, color: number) => cyl(x, y0, z, x, y1, z, r, color),
    cyl: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, color: number) => cyl(x0, y0, z0, x1, y1, z1, r, color),
    // Lamp heads exactly as Kl.lamp builds them: a lit globe under a cap, or an LED housing lit underneath.
    lamp: (x: number, y: number, z: number, heading: number, rgb: number[], kind: string, _d: number, scale = 1) => {
      const l = scale, glow = hexOf(rgb);
      if (kind === 'globe') {
        box(out.glows, x, y + 0.06 * l, z, 0.34 * l, 0.42 * l, 0.34 * l, heading + Math.PI / 4, glow);
        box(out.boxes, x, y + 0.48 * l, z, 0.3 * l, 0.08 * l, 0.3 * l, heading + Math.PI / 4, 0x2d2f31);
        return;
      }
      const u = Math.sin(heading), v = -Math.cos(heading);
      box(out.boxes, x + u * 0.38 * l, y - 0.04 * l, z + v * 0.38 * l, 0.34 * l, 0.12 * l, 0.78 * l, heading, 0x8d9296);
      box(out.glows, x + u * 0.38 * l, y - 0.04 * l - 0.012, z + v * 0.38 * l, 0.28 * l, 0.012, 0.66 * l, heading, glow);
      box(out.boxes, x + u * 0.34 * l, y + 0.08 * l, z + v * 0.34 * l, 0.3 * l, 0.05 * l, 0.6 * l, heading, 0x7b7f85);
    },
    pool: () => {},
    plate: (x: number, y: number, z: number, w: number, h: number, heading: number, art: any) => {
      if (inKeep(x, z)) out.plates.push([r3(x), r3(y), r3(z), r3(w), r3(h), r3(heading), artKey(art)]);
    },
    // Rain trees are the camphor mesh in bloom; banyans have their own.
    tree: (kind: string, x: number, y: number, z: number, s: number, rot: number, tint: number[], bloom: number[]) => {
      if (inKeep(x, z)) model(kind === 'banyan' ? 'tree:banyan' : 'tree:camphor', x, y, z, rot, s, 0, hexOf(tint.map(v => v / 1.1)), rgba(bloom));
    },
    plant: (kind: string, x: number, y: number, z: number, s: number, rot: number, tint: number[], bloom = [1, 1, 1, 0]) => {
      if (inKeep(x, z)) model(`plant:${kind}`, x, y, z, rot, s, 0, hexOf(tint.map(v => v / 1.1)), rgba(bloom));
    },
    scooter: (x: number, y: number, z: number, heading: number, color: number, lean: number, seed?: number) => {
      if (inKeep(x, z)) model('scooter', x, y, z, heading, 1, lean, color >>> 0, seed ?? 0.5);
      return 0;
    },
    bike: (x: number, y: number, z: number, heading: number) => { if (inKeep(x, z)) model('bike', x, y, z, heading, 1.1, 0.05, 0xffffff, 0); return 0; },
  };
  // Ground paint: tree pits, manhole covers, bay lines (the source's street marking painter).
  const ground: any = {
    quad: (x: number, y: number, z: number, dx: number, dz: number, ha: number, hb: number, key: string, color: number) => {
      if (!inKeep(x, z) || key === 'digits') return;
      const kind = key === 'treePit' ? 1 : key.startsWith('cover') ? 2 : 0;
      out.marks.push(r3(x), r3(y), r3(z), r3(dx), r3(dz), r3(ha), r3(hb), kind, color >>> 0);
    },
    line: (x0: number, z0: number, x1: number, z1: number, w: number, color: number, _a: number, y = 0.012) => {
      const x = (x0 + x1) / 2, z = (z0 + z1) / 2, len = Math.hypot(x1 - x0, z1 - z0);
      if (!inKeep(x, z) || len < 0.01) return;
      out.marks.push(r3(x), r3(y), r3(z), r3((x1 - x0) / len), r3((z1 - z0) / len), r3(len / 2), r3(w / 2), 0, color >>> 0);
    },
  };
  // Colliders, in the source's three shapes, as axis-aligned boxes in the playable area.
  const inSolid = (x: number, z: number) => x > solid.x0 - 1 && x < solid.x1 + 1 && z > solid.z0 - 1 && z < solid.z1 + 1;
  const solidBox = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tag: string) => {
    if (inSolid((x0 + x1) / 2, (z0 + z1) / 2)) out.solids.push([r2(x0), r2(z0), r2(x1), r2(z1), r2(y0), r2(y1), tag]);
  };
  // Only the dressing's own colliders: the expressway's (the structures pass) are the map's already.
  let recording = false;
  const statics: any = {
    addBox: (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tag: string) => {
      if (!recording) return;
      solidBox(x0, z0, x1, z1, y0, y1, tag);
      // Narrow medians get a low wall (its reflectors are boxes of their own); draw the wall too.
      if (tag === 'wall' && y1 - y0 < 1 && inKeep((x0 + x1) / 2, (z0 + z1) / 2)) out.boxes.push(...[(x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0].map(r3), 0, 0xc4c2bc);
    },
    addCircle: (x: number, z: number, r: number, y0: number, y1: number, tag: string) => recording && solidBox(x - r, z - r, x + r, z + r, y0, y1, tag),
    addOBB: (x: number, z: number, hx: number, hz: number, heading: number, y0: number, y1: number, tag: string) => {
      if (!recording) return;
      const c = Math.abs(Math.cos(heading)), s = Math.abs(Math.sin(heading)), ex = c * hx + s * hz, ez = s * hx + c * hz;
      solidBox(x - ex, z - ez, x + ex, z + ez, y0, y1, tag);
    },
    addFloor: () => {},
  };

  const pack = content.__ximenPack;
  const ctx: any = {
    plan, statics, params: new URLSearchParams(''),
    quality: { propDensity: 1, level: 'high', shadows: true, drawDistance: 900, antialias: true, mobile: false },
    districts: { packs: [pack], claimed: (x0: number, z0: number, x1: number, z1: number, scope: string) => pack.claims.some((c: any) => (c.scope === 'all' || c.scope === scope) && x1 > c.minX && x0 < c.maxX && z1 > c.minZ && z0 < c.maxZ) },
    yieldFrame: async () => {},
  };
  // The source's order (its streets init): slot claims, structures, guide signs, furniture, signals.
  const streets = new world.__Streets(plan);
  world.__claimSlots(ctx, plan, streets);
  const structures = world.__structures(ctx, plan, streets, props);
  const guide = world.__guideSigns(ctx, plan, streets, props);
  recording = true;
  const season = { season: 'none', barbecue: false, offerings: false, lanterns: false };
  const furniture = world.__streetProps(ctx, plan, streets, props, ground, season, world.__occupied(world.__propClaims(ctx)));
  const signals = new world.__Signals(ctx, sink());
  // Signal heads: the source's head mesh (models.signal), green for one road axis and red for the other.
  signals.addHead = (kind: number, _node: number, axis: string, _phase: number, x: number, y: number, z: number, heading: number) => {
    if (inKeep(x, z)) model(kind === 2 ? 'signal:ped' : 'signal', x, y, z, heading, 1, 0, 0xffffff, axis === 'x' ? 1 : 0);
  };
  signals.build(plan, streets, props);
  structures.emitDeckSigns?.();
  guide?.();

  // Scooters park in rows; each run of scooters closer than 1.1 m becomes one collider.
  const sc = out.models.scooter ?? [];
  const rows: { x: number; z: number; along: 'x' | 'z' }[][] = [];
  const pts = [];
  for (let i = 0; i < sc.length; i += MODEL_STRIDE) pts.push({ x: sc[i], z: sc[i + 2], h: sc[i + 3] });
  // A scooter faces across its row: heading 0/π means it points along z, so the row runs along x.
  const byLine = new Map<string, { x: number; z: number; along: 'x' | 'z' }[]>();
  for (const p of pts) {
    const along = Math.abs(Math.sin(p.h)) < 0.5 ? 'x' : 'z';
    const key = `${along}:${Math.round((along === 'x' ? p.z : p.x) * 2) / 2}`;
    (byLine.get(key) ?? byLine.set(key, []).get(key)!).push({ x: p.x, z: p.z, along });
  }
  for (const line of byLine.values()) {
    line.sort((a, b) => (a.along === 'x' ? a.x - b.x : a.z - b.z));
    let run: typeof line = [];
    for (const p of line) {
      const last = run[run.length - 1];
      if (last && (p.along === 'x' ? p.x - last.x : p.z - last.z) > 1.1) { rows.push(run); run = []; }
      run.push(p);
    }
    if (run.length) rows.push(run);
  }
  for (const run of rows) {
    const xs = run.map(p => p.x), zs = run.map(p => p.z), along = run[0].along;
    const [x0, x1] = along === 'x' ? [Math.min(...xs) - 0.3, Math.max(...xs) + 0.3] : [Math.min(...xs) - 0.85, Math.max(...xs) + 0.85];
    const [z0, z1] = along === 'z' ? [Math.min(...zs) - 0.3, Math.max(...zs) + 0.3] : [Math.min(...zs) - 0.85, Math.max(...zs) + 0.85];
    if (inSolid((x0 + x1) / 2, (z0 + z1) / 2)) out.scooterRuns.push([r2(x0), r2(z0), r2(x1), r2(z1)]);
  }

  // Car bays of the side streets (the source parks its traffic there): x, z, heading.
  out.carBays = furniture.carBays.filter((c: any) => inKeep(c.x, c.z)).map((c: any) => [r2(c.x), r2(c.z), r3(c.heading)]);

  // Ximen station's exit 6, placed by the source's own search (its transit layer).
  const station = plan.mrtStations.find((s: any) => s.id === 'ximen');
  const e = actors.__placeExit(plan, station, [], '6');
  const dims = actors.__exitDims;
  out.exit = { exit: e.exit, x: r2(e.ox), z: r2(e.oz), heading: r3(e.heading), cx: r2(e.cx), cz: r2(e.cz), hw: r2(e.hw), hl: r2(e.hl), width: dims.width, front: dims.front, pit: dims.pit, back: dims.back };
  if (!W) throw new Error('kerb height missing');
  return out;
}

/** The source's prop meshes, as plain vertex arrays (non-indexed triangles). */
export function extractModels(src: Src) {
  const { world } = src;
  const pack = (g: any, keep?: (i: number) => boolean) => {
    const a = g.attributes, n = a.position.count, idx: number[] = [];
    for (let i = 0; i < n; i += 3) if (!keep || keep(i)) idx.push(i, i + 1, i + 2);
    const take = (name: string, size: number, round = r3) => a[name] ? idx.flatMap(i => Array.from({ length: size }, (_, k) => round(a[name].array[i * a[name].itemSize + k]))) : undefined;
    return { position: take('position', 3), normal: take('normal', 3), uv: take('uv', 2), color: take('color', 3), tag: take('aTag', 3, Math.round), top: take('aTop', 1) };
  };
  const banyan = world.__banyanGeo(), signal = world.__signalGeo();
  const part = (p: number) => (i: number) => Math.round(banyan.attributes.aPart.array[i]) === p;
  // The head mesh holds both heads (tag x: 1 vehicle, 2 pedestrian); tag z numbers its lamps.
  const head = (k: number) => (i: number) => Math.round(signal.attributes.aTag.array[i * 3]) === k;
  return {
    scooter: pack(world.__scooterGeo()),
    bike: pack(world.__bikeGeo()),
    'tree:camphor': pack(world.__treeGeo('camphor')),
    'tree:banyan': pack(banyan, part(2)),
    'plant:moneyTree': pack(banyan, part(3)),
    'plant:bush': pack(banyan, part(4)),
    'plant:clump': pack(banyan, part(5)),
    signal: pack(signal, head(1)),
    'signal:ped': pack(signal, head(2)),
  };
}

/** The source city past the backdrop: buildings, landmarks, hills and roads. */
export function extractSkyline(src: Src, area: { x0: number; z0: number; x1: number; z1: number }, margin: number, radius: number) {
  const { world, content, Plan } = src;
  const plan = new Plan();
  const cx = (area.x0 + area.x1) / 2, cz = (area.z0 + area.z1) / 2;
  const lots = new world.__Lots(plan, ['police', 'hospital'].map(k => plan.spawns[k]).map((n: any) => ({ x0: n.x - 10, x1: n.x + 10, z0: n.z - 10, z1: n.z + 10 })));
  lots.limitSites(plan.landmarks);
  const specs = new world.__Specs({ box: () => {} });
  const palette = content.__ximenPack.facadePalette as number[];
  specs.paletteAt = (x: number, z: number) => (x > -900 && x < -560 && z > -330 && z < 70 ? palette : null);
  const near = (l: any) => l.x1 > area.x0 - margin && l.x0 < area.x1 + margin && l.z1 > area.z0 - margin && l.z0 < area.z1 + margin;
  const buildings: number[] = [];
  for (const l of lots.lots) {
    if (near(l) || Math.hypot((l.x0 + l.x1) / 2 - cx, (l.z0 + l.z1) / 2 - cz) > radius) continue;
    const s = specs.makeSpec(l);
    buildings.push(r2(l.x0), r2(l.z0), r2(l.x1), r2(l.z1), r2(s.top), s.tint >>> 0);
  }
  const landmarks = plan.landmarks.map((l: any) => [l.id, l.name.zh, l.name.en, l.x, l.z, l.w, l.d, l.kind]);
  const hills = plan.hills.map((h: any) => [h.x, h.z, h.height, h.radius, h.name?.zh ?? '', h.name?.en ?? '']);
  // Ground heights on a 50 m grid (water drops to -3 m, under the -0.8 m water level).
  const G = 50, gx0 = -3000, gz0 = -3200, n = 121;
  const heights: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = gx0 + i * G, z = gz0 + j * G, s = plan.surfaceAt(x, z);
    heights.push(s === 'water' ? -3 : Math.round(plan.hillHeight(x, z) * 10) / 10);
  }
  const roads = plan.roads.filter((r: any) => !r.pedestrian).map((r: any) => [r.axis, r.at, Math.max(r.from, -1e4), Math.min(r.to, 1e4), r2(r.halfWidth), r2(r.halfTotal), r.elevated ?? '']);
  return { buildings, landmarks, hills, ground: { x0: gx0, z0: gz0, spacing: G, n, heights }, roads, waterLevel: plan.waterLevel };
}

/**
 * The hand-built Ximending district as the source draws it: its builder's own meshes (G the
 * buildings, D the facade details such as AC units and window bars, I the interiors of the cinema
 * and arcade, L the light pools) and the canvas atlas they map, painted by the source's own code.
 * Needs a CJK font for the atlas text (TGTA_FONT, default macOS's STHeiti).
 */
export async function extractDistrict(src: Src, atlasScale = 1) {
  const { content, Plan } = src;
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');
  const font = process.env.TGTA_FONT ?? '/System/Library/Fonts/STHeiti Medium.ttc';
  for (const alias of ['PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', 'Heiti TC', 'Noto Sans CJK TC', 'system-ui', 'sans-serif']) GlobalFonts.registerFromPath(font, alias);
  const g = globalThis as any;
  const doc = g.document;
  g.document = { ...doc, createElement: (tag: string) => (tag === 'canvas' ? createCanvas(1, 1) : doc.createElement(tag)) };
  g.location ??= { search: '' };
  const plan = new Plan();
  const atlas = await content.__atlas(atlasScale, async () => {});
  const statics = new Proxy({}, { get: () => () => {} });
  const res = content.__ximenPack.residencyBounds;
  const xi = new content.__Ximen(atlas, statics, false, plan.pois.filter((p: any) => p.x > res.minX && p.x < res.maxX && p.z > res.minZ && p.z < res.maxZ));
  await content.__buildXimen(xi, async () => {});
  g.document = doc;
  // Visible categories only: proxies (0) and shadow casters (1) are the source's own helpers.
  const meshes: Record<string, { pos: Float32Array; nrm: Float32Array; uv: Float32Array; col: Float32Array; fx: Float32Array; idx: Uint32Array }> = {};
  for (const name of ['G', 'D', 'I', 'L']) {
    const b = xi[name];
    b.fillCat();
    const tris: number[] = [];
    for (let t = 0; t < b.ic / 3; t++) if (b.tcat[t] >= 2) tris.push(b.idx[t * 3], b.idx[t * 3 + 1], b.idx[t * 3 + 2]);
    // Compact the vertices the kept triangles use.
    const remap = new Int32Array(b.vc).fill(-1), order: number[] = [];
    for (const v of tris) if (remap[v] < 0) { remap[v] = order.length; order.push(v); }
    const n = order.length;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 4), fx = new Float32Array(n * 4);
    order.forEach((v, i) => {
      for (let k = 0; k < 3; k++) { pos[i * 3 + k] = b.pos[v * 3 + k]; nrm[i * 3 + k] = b.nrm[v * 4 + k] / 127; }
      uv[i * 2] = b.uv[v * 2]; uv[i * 2 + 1] = b.uv[v * 2 + 1];
      for (let k = 0; k < 4; k++) { col[i * 4 + k] = b.col[v * 4 + k] / 255; fx[i * 4 + k] = b.fx[v * 4 + k]; }
    });
    meshes[name] = { pos, nrm, uv, col, fx, idx: Uint32Array.from(tris, v => remap[v]) };
  }
  const canvas = atlas.texture.image;
  return { meshes, atlas: await canvas.encode('webp', 82) as Buffer, atlasSize: [canvas.width, canvas.height], fxModes: content.__fx as Record<string, number> };
}
