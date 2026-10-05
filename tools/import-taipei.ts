/**
 * Extracts the Ximending (西門町) quarter of 臺北狂飆 / TAIPEI RUSH (https://taipei-gta.vercel.app,
 * used with its author's permission) into shared/maps/taipei-data.ts, the data the Taipei map is
 * built from (shared/maps/taipei.ts).
 *
 * The source game ships no level files: its city is generated at load time by code in its built
 * bundles. This tool runs that code itself, with every rendering, audio and browser dependency
 * replaced by inert stubs, and records what it lays out around the player's start: the street plan
 * (roads, sidewalks, blocks), the hand-built Ximending district (its building volumes and collision
 * boxes, shop signs, blade signs, billboards and the gateway), the generic city lots beside it
 * (footprints, arcades and heights), the median hedges, the Civic Blvd expressway, the Red House
 * and the shop/convenience-store markers. Everything is recorded in the source's own coordinates.
 *
 *   bun tools/import-taipei.ts --download   # fetch the current build's chunks into TGTA_SRC, then extract
 *   bun tools/import-taipei.ts              # extract from chunks already in TGTA_SRC (default /tmp/tgta)
 *
 * The chunks' hashed names change with each deploy; any build with the same structure works, but
 * the internal names this tool exports (see loadSource) are the minifier's and may need updating
 * for a new build. Scratch modules go to tools/.taipei-work, which is not committed.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.env.TGTA_SRC ?? '/tmp/tgta';
export const WORK = join(import.meta.dir, '.taipei-work');
const OUT = join(import.meta.dir, '../shared/maps/taipei-data.ts');

/** Source-world rectangle the map covers (x east, z south, metres), plus the backdrop margin around it. */
export const AREA = { x0: -882, x1: -681, z0: -306, z1: -60 };
const MARGIN = 45;

/** A Proxy that absorbs any use (three.js objects, canvases, GPU helpers) the extraction never needs. */
export const sink: any = (): any => new Proxy(function () {}, {
  get: (_t, k) => k === Symbol.toPrimitive ? () => 0 : k === Symbol.iterator ? undefined : k === 'prototype' ? {} : sink(),
  apply: () => sink(), construct: () => sink(), set: () => true,
});

/** Load the source chunks as modules: engine and runtime for real, everything else stubbed. */
export async function loadSource() {
  mkdirSync(WORK, { recursive: true });
  const files = readdirSync(SRC);
  const chunk = (prefix: string) => {
    const f = files.find(n => n.startsWith(prefix + '-') && n.endsWith('.js'));
    if (!f) throw new Error(`missing ${prefix}-*.js in ${SRC}`);
    return f;
  };
  const real: Record<string, string> = { [chunk('rolldown-runtime')]: 'runtime.js', [chunk('engine')]: 'engine.js' };
  const deps = new Map<string, Set<string>>();
  const sources: Record<string, string> = {};
  const load = (file: string, out: string, extra = '') => {
    let code = readFileSync(join(SRC, file), 'utf8').replace(/^const __vite__mapDeps=[^\n]*\n/, '');
    sources[out] = code;
    code = code.replace(/import\{([^}]*)\}from"\.\/([^"]+)"/g, (_m, names: string, dep: string) => {
      if (real[dep]) return `import{${names}}from"./${real[dep]}"`;
      const set = deps.get(dep) ?? new Set<string>(); deps.set(dep, set);
      for (const n of names.split(',')) set.add(n.trim().split(/\s+as\s+/)[0]);
      return `import{${names}}from"./stub-${dep}"`;
    });
    code = code.replace(/import\("[^"]+"\)/g, 'Promise.resolve({})');
    writeFileSync(join(WORK, out), code + extra);
  };
  writeFileSync(join(WORK, 'runtime.js'), readFileSync(join(SRC, chunk('rolldown-runtime'))));
  load(chunk('engine'), 'engine.js');
  // Internal (unexported) bindings the extraction needs; the names are the minifier's for this build.
  load(chunk('world'), 'world.js', ';export{Eg as __Lots,pg as __Specs,N_ as __Lot,Sy as __redHouse,Ls as __expressways,ro as __Streets,Oc as __streetGround,Rc as __hedges};');
  load(chunk('content'), 'content.js', ';export{wh as __Ximen,Hh as __buildXimen,bh as __ximenBlocks,xh as __ximenSpots,Zm as __blades,$m as __boards,M_ as __ximenPack};');
  for (const [dep, names] of deps) {
    const lines = ['const P=()=>new Proxy(function(){},{get:(t,k)=>k===Symbol.toPrimitive?()=>0:k===Symbol.iterator?undefined:k==="prototype"?{}:P(),apply:()=>P(),construct:()=>P(),set:()=>true});'];
    let i = 0;
    for (const n of names) lines.push(`const s${i}=P();export{s${i++} as ${n}};`);
    writeFileSync(join(WORK, 'stub-' + dep), lines.join('\n'));
  }
  const g = globalThis as any;
  g.window ??= g;
  g.document ??= { createElement: () => ({ getContext: () => null, style: {} }), addEventListener() {}, querySelector: () => null };
  g.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  g.addEventListener ??= () => {};
  const engine = await import(join(WORK, 'engine.js'));
  const world = await import(join(WORK, 'world.js'));
  const content = await import(join(WORK, 'content.js'));
  return { engine, world, content, Plan: engine.v, sources };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const hex = (c: number) => '0x' + (c >>> 0).toString(16).padStart(6, '0');
const inside = (x0: number, z0: number, x1: number, z1: number, m = MARGIN) =>
  x1 > AREA.x0 - m && x0 < AREA.x1 + m && z1 > AREA.z0 - m && z0 < AREA.z1 + m;

/** A wall frame of the source's district builder: origin, tangent, outward normal and length. */
interface Frame { px: number; pz: number; tx: number; tz: number; nx: number; nz: number; L: number; facing: number }
const along = (f: Frame, t: number, out = 0) => [f.px + f.tx * t + f.nx * out, f.pz + f.tz * t + f.nz * out];

async function main() {
  const { engine, world, content, Plan, sources } = await loadSource();
  const plan = new Plan();

  // ---- Street plan ------------------------------------------------------------------------
  const roads = plan.roads.filter((r: any) => { const [x0, x1, z0, z1] = plan.roadRect(r, r.halfTotal); return inside(x0, z0, x1, z1); })
    .map((r: any) => [r.id, r.name.zh, r.name.en, r.axis, r.at, Math.max(r.from, -1e4), Math.min(r.to, 1e4), r.kind, r2(r.halfWidth), r2(r.halfTotal), r.median, r.lanesPerDir, !!r.pedestrian, r.elevated ?? '', !!r.treeMedian]);
  const landmarks = plan.landmarks.filter((l: any) => inside(l.x - l.w / 2, l.z - l.d / 2, l.x + l.w / 2, l.z + l.d / 2))
    .map((l: any) => [l.id, l.name.zh, l.name.en, l.x, l.z, l.w, l.d, l.kind]);
  const pois = plan.pois.filter((p: any) => inside(p.x, p.z, p.x, p.z, 0))
    .map((p: any) => [p.kind, p.brand, r2(p.x), r2(p.z), r2(p.facing), p.width]);
  const start = plan.spawns.start;
  // Shop brands of the plan's chains (tea shops, convenience stores): name → colours.
  const brands = Object.fromEntries([...engine.P, ...engine.w].map((b: any) => [b.zh, b.colors]));

  // ---- The hand-built Ximending district --------------------------------------------------
  const solids: (string | number)[][] = [], shells: (string | number)[][] = [], signs: (string | number)[][] = [];
  const statics = new Proxy({}, {
    get: (_t, k) => (...a: any[]) => {
      if (k === 'addBox') solids.push([...a.slice(0, 6).map(r2), a[6]]);
      else if (k === 'addFloorRect') solids.push([...a.slice(0, 4).map(r2), 0, r2(a[4]), a[5]]);
    },
  });
  const atlas = { get: () => ({ u0: 0, v0: 0, u1: 1, v1: 1, nu: 0, w: 1, h: 1 }), texture: sink() };
  const res = content.__ximenPack.residencyBounds;
  const xi = new content.__Ximen(atlas, statics, false, plan.pois.filter((p: any) => p.x > res.minX && p.x < res.maxX && p.z > res.minZ && p.z < res.maxZ));
  const blades: [string, string, string, string?][] = content.__blades, boards: [string, string, string, string, string?][] = content.__boards;
  const boardText = (key: string) => {
    const m = /^hb(\d+)$/.exec(key);
    if (m) { const [name, sub, bg, fg] = boards[+m[1]]; return { name, sub, bg, fg }; }
    return { name: key, sub: '', bg: '', fg: '' };
  };
  // Record the shells (building volumes and their paint) and signs as the district lays them out.
  const shell = xi.shell.bind(xi);
  xi.shell = (rect: any, h: number, color: number, material: string, faces: number, opts: any = {}) => {
    shells.push([r2(rect.x0), r2(rect.z0), r2(rect.x1), r2(rect.z1), r2(h), hex(color), material]);
    return shell(rect, h, color, material, faces, opts);
  };
  const board = xi.board.bind(xi);
  xi.board = (f: Frame, a: number, b: number, y0: number, y1: number, key: string, ...rest: any[]) => {
    const t = boardText(key), [x, z] = along(f, (a + b) / 2, 0.05);
    if (/^hb\d+$/.test(key) && b - a > 0.8) signs.push(['board', r2(x), r2(z), r2(y0), r2(y1), r2(f.facing), r2(b - a), t.name, t.sub, t.bg, t.fg]);
    return board(f, a, b, y0, y1, key, ...rest);
  };
  const blade = xi.blade.bind(xi);
  xi.blade = (f: Frame, t: number, y: number, index: number, opts: any = {}) => {
    const w = opts.w ?? 1.15, out = opts.out ?? 0.35, [x, z] = along(f, t, out + w / 2), [text, fg, bg] = blades[index];
    signs.push(['blade', r2(x), r2(z), r2(y), r2(y + w * 4), r2(f.facing), r2(w), text, '', bg, fg]);
    return blade(f, t, y, index, opts);
  };
  const billboard = xi.billboard.bind(xi);
  xi.billboard = (x: number, z: number, facing: number, y: number, w: number, h: number, key: string) => {
    signs.push(['billboard', r2(x), r2(z), r2(y + 2.2), r2(y + 2.2 + h), r2(facing), r2(w), key, '', '', '']);
    return billboard(x, z, facing, y, w, h, key);
  };
  const screen = xi.screen.bind(xi);
  xi.screen = (f: Frame, a: number, b: number, y0: number, y1: number, key: string, ...rest: any[]) => {
    const [x, z] = along(f, (a + b) / 2, 0.1);
    signs.push(['screen', r2(x), r2(z), r2(y0), r2(y1), r2(f.facing), r2(b - a), key, '', '', '']);
    return screen(f, a, b, y0, y1, key, ...rest);
  };
  const marquee = xi.marquee.bind(xi);
  xi.marquee = (f: Frame, a: number, b: number, y: number, depth: number, color?: number) => {
    const [x, z] = along(f, (a + b) / 2, depth / 2);
    signs.push(['marquee', r2(x), r2(z), r2(y), r2(y + 0.8), r2(f.facing), r2(b - a), 'marquee', String(r2(depth)), color === undefined ? '' : hex(color), '']);
    return marquee(f, a, b, y, depth, color);
  };
  await content.__buildXimen(xi, async () => {});
  const shops = [...xi.storefronts.values()].map((s: any) => [r2(s.x), r2(s.z), r2(s.facing), r2(s.width), s.name ?? '', s.category ?? s.kind ?? '']);
  const spots = Object.fromEntries(Object.entries(content.__ximenSpots).map(([k, v]: [string, any]) => [k, [r2(v.x), r2(v.z)]]));
  const blocks = Object.fromEntries(Object.entries(content.__ximenBlocks).map(([k, v]: [string, any]) => [k, [r2(v.x0), r2(v.z0), r2(v.x1), r2(v.z1)]]));

  // ---- Billboard artwork text (canvas drawings in the content chunk) ----------------------
  const code = sources['content.js'];
  const billEnd = code.indexOf('.forEach((e,t)=>f(`bill`+t,640,200,e))');
  const billStart = code.lastIndexOf('=[(e,t,n,i)=>', billEnd);
  const billboards = billStart > 0 && billEnd > 0
    ? code.slice(billStart + 2, billEnd).split(/\}\s*,\s*\(e,t,n,i\)=>\{/).map(part => {
      const texts = [...part.matchAll(/U\(r,`([^`]+)`/g)].map(m => m[1]);
      const colours = [...part.matchAll(/`(#[0-9a-fA-F]{3,6})`/g)].map(m => m[1]);
      return [texts.join(' / '), colours[0] ?? '#202020', colours[1] ?? '#ffffff'];
    })
    : [];

  // ---- Generic city lots next to the district (what the source builds outside its blocks) ----
  const lots = new world.__Lots(plan, ['police', 'hospital'].map(k => plan.spawns[k]).map((n: any) => ({ x0: n.x - 10, x1: n.x + 10, z0: n.z - 10, z1: n.z + 10 })));
  const claims = content.__ximenPack.claims.filter((c: any) => c.scope === 'buildings');
  const kept = lots.lots.filter((l: any) => !claims.some((c: any) => l.x1 > c.minX && l.x0 < c.maxX && l.z1 > c.minZ && l.z0 < c.maxZ));
  lots.lots.length = 0; lots.lots.push(...kept);
  lots.limitSites(plan.landmarks);
  // The source's own building pass makes each lot's colliders: its volumes (collide) and the
  // columns of its street arcade (騎樓), if it has one (arcade, drawing into a stub).
  let lotBoxes: number[][] = [];
  const specs = new world.__Specs({ box: (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tag: string) => lotBoxes.push([x0, z0, x1, z1, y0, y1, tag === 'pillar' ? 1 : 0]) });
  const palette = content.__ximenPack.facadePalette as number[];
  specs.paletteAt = (x: number, z: number) => (x > -900 && x < -560 && z > -330 && z < 70 ? palette : null);
  const lotRows = kept.filter((l: any) => inside(l.x0, l.z0, l.x1, l.z1)).map((l: any) => {
    const s = specs.makeSpec(l);
    lotBoxes = [];
    specs.arcade(s, { body: sink() });
    specs.collide(s);
    return [l.type, l.floors, ...[l.x0, l.z0, l.x1, l.z1].map(r2), r2(s.gH), r2(s.top), hex(s.tint), l.arcade.map(r2).join(' '), lotBoxes.map(b => [...b.slice(0, 6).map(r2), b[6]].join(' ')).join(';')];
  });

  // ---- Civic Blvd expressway (市民大道高架): deck, parapets and piers over the median ----------
  const civic = plan.roads.find((r: any) => r.id === 'civic'), ex = world.__expressways.civic;
  const deckTop = (x: number) => {
    const t = Math.max(0, (x - civic.from) / ex.ramp);
    return t >= 1 ? ex.top : ex.edgeTop + (ex.top - ex.edgeTop) * t * t * (3 - 2 * t);
  };
  // Deck segments: 12 m steps along its ramp, else up to 40 m (as the source cuts them).
  const cuts: number[] = [];
  for (let x = civic.from + 12; x < civic.from + ex.ramp; x += 12) cuts.push(x);
  const seg: number[][] = [];
  const x0 = AREA.x0 - MARGIN, x1 = AREA.x1 + MARGIN;
  let prev = civic.from;
  for (const c of [...cuts, civic.to]) {
    for (let a = prev; a < c - 1e-6; a += 40) { const b = Math.min(c, a + 40); if (b > x0 && a < x1) seg.push([r2(a), r2(b), r2(deckTop(a)), r2(deckTop(b))]); }
    prev = c;
  }
  // Piers every 32 m, nudged off the intersections (an approximation of the source's own clearance test).
  const nodes = plan.nodes.filter((n: any) => n.kind !== 'end' && n.roads.includes(civic));
  const blocked = (x: number) => x < civic.from + 6 || x > civic.to - 6 || nodes.some((n: any) => Math.abs(x - n.x) < n.halfX + 3.5 + 2.2);
  const piers: number[] = [];
  for (let t = civic.from + 14; t < civic.to - 6; t += 32) {
    let o = t;
    if (blocked(o)) { const k = [1, 2, 3, 4, 5, 6].find(n => !blocked(t + n * 3)); if (k === undefined) continue; o = t + k * 3; }
    if (o > x0 && o < x1) piers.push(r2(o));
  }
  // ---- Street ground: the hedges the source plants on its medians (its own collision boxes) ----
  world.__streetGround(plan, new world.__Streets(plan));
  const hedges = (world.__hedges as number[][]).filter(([hx0, hz0, hx1, hz1]) => inside(hx0, hz0, hx1, hz1)).map(h => h.map(r2));

  const expressway = { z: civic.at, deckHalf: ex.deckHalf, deckDepth: 1.7, wall: ex.wall, segments: seg, piers, pierTop: piers.map(x => r2(deckTop(x) - 1.7)) };

  // ---- Red House (西門紅樓): its colliders, placed the way the landmark system places them ----
  const rh = { ...plan.landmarks.find((l: any) => l.id === 'redhouse'), facing: Math.PI / 2 };
  const rhCols: any[] = [];
  world.__redHouse(sink(), sink(), sink(), rh, 0, world.__Lot.forLot(rh, 0, rhCols));
  const redHouse = rhCols.map(c => c.kind === 'circle'
    ? ['circle', r2(c.x), r2(c.z), r2(c.r), r2(c.y0), r2(c.y1), c.tag]
    : [c.kind, r2(c.cx), r2(c.cz), r2(c.hx), r2(c.hz), r2(c.h), r2(c.y0), r2(c.y1), c.tag]);

  const json = (v: unknown) => JSON.stringify(v);
  const rows = (name: string, doc: string, type: string, list: unknown[]) =>
    `/** ${doc} */\nexport const ${name}: ${type}[] = [\n${list.map(r => '  ' + json(r)).join(',\n')},\n];\n`;
  const out = `// Generated by tools/import-taipei.ts from 臺北狂飆 / TAIPEI RUSH (https://taipei-gta.vercel.app),
// used with its author's permission. Do not edit by hand: re-run the tool instead.
// Source-world coordinates: metres, +x east, +z south, ground at y = 0.

/** Rectangle of the source world the map covers. */
export const AREA = ${json(AREA)};
/** Where the source game starts the player (on Zhongxiao W. Rd outside Ximen station). */
export const START = ${json({ x: r2(start.x), z: r2(start.z), heading: r2(start.heading) })};

type Road = [id: string, zh: string, en: string, axis: 'x' | 'z', at: number, from: number, to: number, kind: string, halfWidth: number, halfTotal: number, median: number, lanesPerDir: number, pedestrian: boolean, elevated: string, treeMedian: boolean];
${rows('ROADS', 'Streets: axis-aligned carriageways (halfWidth) with sidewalks out to halfTotal.', 'Road', roads)}
type Landmark = [id: string, zh: string, en: string, x: number, z: number, w: number, d: number, kind: string];
${rows('LANDMARKS', 'Named sites of the source plan around the area.', 'Landmark', landmarks)}
/** The nine Ximending blocks (A–C north to south, 1–3 west to east): x0, z0, x1, z1. */
export const XIMEN_BLOCKS: Record<string, [number, number, number, number]> = ${json(blocks)};
/** Named spots of the district (gateway, performance stage, cinema, arcade, …): x, z. */
export const XIMEN_SPOTS: Record<string, [number, number]> = ${json(spots)};
type Box = [x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tag: string];
${rows('XIMEN_SOLIDS', 'The district\'s collision boxes (tag: building, wall, pillar, prop, pole, floor).', 'Box', solids)}
type Shell = [x0: number, z0: number, x1: number, z1: number, height: number, color: number, material: string];
${rows('XIMEN_SHELLS', 'Building volumes as the district paints them (facade colour and material).', 'Shell', shells).replace(/"(0x[0-9a-f]+)"/g, '$1')}
type Sign = [kind: string, x: number, z: number, y0: number, y1: number, facing: number, width: number, text: string, sub: string, bg: string, fg: string];
${rows('XIMEN_SIGNS', 'Signs: shop boards, vertical blade signs, rooftop billboards, LED screens and cinema marquees (facing: 0 north, π/2 east).', 'Sign', signs)}
type Shop = [x: number, z: number, facing: number, width: number, name: string, category: string];
${rows('XIMEN_SHOPS', 'Storefronts the district opened (shop name and trade).', 'Shop', shops)}
type Billboard = [text: string, bg: string, fg: string];
${rows('BILLBOARDS', 'Rooftop billboard artwork bill0…bill3: its text, background and text colour.', 'Billboard', billboards)}
type Lot = [type: string, floors: number, x0: number, z0: number, x1: number, z1: number, groundFloor: number, top: number, tint: number, arcade: string, volumes: string];
${rows('LOTS', 'Generic city buildings beside the district: footprint, ground-floor height, roof, tint, arcade depth per side (N E S W) and colliders ("x0 z0 x1 z1 y0 y1 column;…", column 1 for arcade columns).', 'Lot', lotRows).replace(/"(0x[0-9a-f]+)"/g, '$1')}
${rows('HEDGES', 'Median hedges: x0, z0, x1, z1, top (bottom at the ground).', 'number[]', hedges)}
/** The elevated expressway over Civic Blvd: deck [x0, x1, top0, top1] segments, parapet height and pier x positions. */
export const EXPRESSWAY = ${json(expressway)};
type Collider = (string | number)[];
${rows('RED_HOUSE', 'Red House colliders: ["circle", x, z, r, y0, y1, tag] or ["obb", cx, cz, hx, hz, heading, y0, y1, tag].', 'Collider', redHouse)}
/** Brand colours of the chains (primary, secondary, accent). */
export const BRANDS: Record<string, string[]> = ${json(brands)};
type Poi = [kind: string, brand: string, x: number, z: number, facing: number, width: number];
${rows('POIS', 'Convenience stores, tea shops, breakfast shops, claw machines and lottery stands of the plan.', 'Poi', pois)}`;
  writeFileSync(OUT, out);
  console.log(`wrote ${OUT}: ${roads.length} roads, ${solids.length} district boxes, ${shells.length} shells, ${signs.length} signs, ${shops.length} shops, ${lotRows.length} lots, ${redHouse.length} Red House colliders, ${pois.length} POIs, ${billboards.length} billboards`);
}

/** Fetch index.html and the chunks it lists that the extraction runs (engine, world, content, runtime) into SRC. */
async function download() {
  const base = 'https://taipei-gta.vercel.app/';
  mkdirSync(SRC, { recursive: true });
  const index = await (await fetch(base)).text();
  writeFileSync(join(SRC, 'index.html'), index);
  const wanted = /^assets\/(engine|world|content|rolldown-runtime)-[\w-]+\.js$/;
  for (const path of new Set(index.match(/assets\/[\w.-]+\.js/g) ?? [])) {
    if (!wanted.test(path)) continue;
    const res = await fetch(base + path);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    writeFileSync(join(SRC, path.slice('assets/'.length)), Buffer.from(await res.arrayBuffer()));
    console.log('fetched', path);
  }
}

if (import.meta.main) {
  if (process.argv.includes('--download')) await download();
  await main();
}
