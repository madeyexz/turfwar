/**
 * Extracts the Xinyi (信義) district around Taipei 101 from 臺北狂飆 / TAIPEI RUSH
 * (https://taipei-gta.vercel.app, used with its author's permission) into
 * shared/maps/xinyi-data.ts, the data the Xinyi map is built from (shared/maps/xinyi.ts).
 *
 * Like tools/import-taipei.ts (whose approach this follows), it runs the source game's own
 * city-building code headless, every rendering, audio and browser dependency replaced by inert
 * stubs (three.js runs for real, for its maths), and records what that code lays out:
 *   - the street plan (roads, landmarks), the basin's hills (Elephant Mountain, Four Beasts);
 *   - Taipei 101 as the source models it: every lofted section of the tower (base, the eight
 *     stacked segments, crown and spire), its ornaments, and the plaza and podium mall around it;
 *   - the Xinyi Plaza Malls (信義新天地) buildings, their bridges and signs;
 *   - the Xinyi district's own colliders: the Xinyi Skywalk (信義空橋) decks, rails, stairs and
 *     piers, the 101 west plaza and Four Four South Village (四四南村);
 *   - the generic city lots around them (footprints, heights, arcade columns).
 * Everything is in the source's own coordinates (metres, +x east, +z south).
 *
 *   bun tools/import-xinyi.ts --download   # fetch the current build's chunks into TGTA_SRC, then extract
 *   bun tools/import-xinyi.ts              # extract from chunks already in TGTA_SRC (default /tmp/tgta)
 *
 * The internal names exported in loadSource are the minifier's for the build this was written
 * against and may need updating for a new one. Scratch modules go to tools/.xinyi-work.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.env.TGTA_SRC ?? '/tmp/tgta';
const WORK = join(import.meta.dir, '.xinyi-work');
const OUT = join(import.meta.dir, '../shared/maps/xinyi-data.ts');

/**
 * Source-world rectangle the map covers: Keelung Rd's skywalk (west) to the foot of Elephant
 * Mountain (east), the Xinyi Plaza Malls frontage (north) to Four Four South Village (south).
 */
const AREA = { x0: 655, x1: 930, z0: 45, z1: 350 };
/** How far past the area the city is recorded as a backdrop. */
const MARGIN = 60;

/** A Proxy that absorbs any use (GPU helpers, canvases, scenes) the extraction never needs. */
const sink: any = (): any => new Proxy(function () {}, {
  get: (_t, k) => k === Symbol.toPrimitive ? () => 0 : k === Symbol.iterator ? undefined : k === 'then' ? undefined : k === 'prototype' ? {} : sink(),
  apply: () => sink(), construct: () => sink(), set: () => true,
});

/** Load the source chunks as modules: runtime, three, engine, world and content for real, the rest stubbed. */
async function loadSource() {
  mkdirSync(WORK, { recursive: true });
  const files = readdirSync(SRC);
  const chunk = (prefix: string) => {
    const f = files.find(n => n.startsWith(prefix + '-') && n.endsWith('.js'));
    if (!f) throw new Error(`missing ${prefix}-*.js in ${SRC}`);
    return f;
  };
  const real: Record<string, string> = {
    [chunk('rolldown-runtime')]: 'runtime.js', [chunk('three')]: 'three.js', [chunk('engine')]: 'engine.js', [chunk('world')]: 'world.js', [chunk('content')]: 'content.js',
  };
  const deps = new Map<string, Set<string>>();
  const load = (file: string, out: string, extra = '') => {
    let code = readFileSync(join(SRC, file), 'utf8').replace(/^const __vite__mapDeps=[^\n]*\n/, '');
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
  load(chunk('three'), 'three.js');
  // Internal (unexported) bindings the extraction needs; the names are the minifier's for this build.
  load(chunk('engine'), 'engine.js', ';export{Qn as __hills,B as __city};');
  load(chunk('world'), 'world.js', ';export{O_ as __Mesh,Hv as __tower101,zv as __zv,Py as __xinyiMalls,By as __trail,iv as __signTable,Eg as __Lots,pg as __Specs,N_ as __Lot};');
  load(chunk('content'), 'content.js', ';export{nI as __skywalk,hI as __plaza101,jI as __village,jL as __xinyiPack};');
  for (const [dep, names] of deps) {
    const lines = ['const P=()=>new Proxy(function(){},{get:(t,k)=>k===Symbol.toPrimitive?()=>0:k===Symbol.iterator?undefined:k==="then"?undefined:k==="prototype"?{}:P(),apply:()=>P(),construct:()=>P(),set:()=>true});'];
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
  return { engine, world, content, Plan: engine.v };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const inside = (x0: number, z0: number, x1: number, z1: number, m = MARGIN) =>
  x1 > AREA.x0 - m && x0 < AREA.x1 + m && z1 > AREA.z0 - m && z0 < AREA.z1 + m;
/** sRGB hex of a source paint (its r, g, b are linear, as three.js stores them). */
const paintHex = (p: { r: number; g: number; b: number }) => {
  const s = (l: number) => Math.round(255 * Math.max(0, Math.min(1, l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)));
  return (s(p.r) << 16) | (s(p.g) << 8) | s(p.b);
};
const hex = (c: number) => '0x' + (c >>> 0).toString(16).padStart(6, '0');

/**
 * Wrap one of the source's mesh builders so it records the solids it draws, in world
 * coordinates: boxes (axis-aligned after the builder's own transforms), lofted polygons,
 * cylinders, spheres, extruded discs and sign quads. The builder still draws, so anything that
 * reads its state back keeps working.
 */
function recorder(mesh: any, signKeys: string[]) {
  const out = { boxes: [] as number[][], lofts: [] as number[][], cylinders: [] as number[][], spheres: [] as number[][], discs: [] as number[][], signs: [] as (string | number)[][] };
  const glow = (p: any) => r2(p.ei ?? 0);
  const w = (x: number, y: number, z: number) => mesh.toWorld(x, y, z);
  const box = mesh.box.bind(mesh), loft = mesh.loft.bind(mesh), cyl = mesh.cylinder.bind(mesh), sph = mesh.sphere.bind(mesh), ext = mesh.extrude.bind(mesh), quv = mesh.quadUV.bind(mesh);
  mesh.box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, ...rest: any[]) => {
    const a = w(x0, y0, z0), b = w(x1, y1, z1);
    // Only level boxes (no pitch or roll) are kept: their world AABB is the box itself.
    const e = mesh.m.elements, level = Math.abs(e[1]) < 1e-6 && Math.abs(e[9]) < 1e-6 && Math.abs(e[5] - 1) < 1e-6;
    if (level) out.boxes.push([...[Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)].map(r3), paintHex(mesh.p), glow(mesh.p)]);
    return box(x0, y0, z0, x1, y1, z1, ...rest);
  };
  mesh.loft = (pa: number[], ya: number, pb: number[], yb: number, ...rest: any[]) => {
    out.lofts.push([r3(ya), r3(yb), pa.map(r3) as any, pb.map(r3) as any, paintHex(mesh.p), glow(mesh.p)]);
    return loft(pa, ya, pb, yb, ...rest);
  };
  mesh.cylinder = (x: number, z: number, ra: number, rb: number, ya: number, yb: number, ...rest: any[]) => {
    const c = w(x, ya, z);
    const paint = rest[2] ?? mesh.p;
    out.cylinders.push([r3(c.x), r3(c.z), r3(ra), r3(rb), r3(c.y), r3(c.y + yb - ya), paintHex(paint), glow(paint)]);
    return cyl(x, z, ra, rb, ya, yb, ...rest);
  };
  mesh.sphere = (x: number, y: number, z: number, r: number, ...rest: any[]) => {
    const c = w(x, y, z), paint = rest[2] ?? mesh.p;
    out.spheres.push([r3(c.x), r3(c.y), r3(c.z), r3(r), paintHex(paint), glow(paint)]);
    return sph(x, y, z, r, ...rest);
  };
  mesh.extrude = (poly: number[], depth: number, paint: any, ...rest: any[]) => {
    // A flat outline extruded along its local z: record its centre, facing and extent.
    let rx = 0, ry = 0;
    for (let i = 0; i < poly.length; i += 2) { rx = Math.max(rx, Math.abs(poly[i])); ry = Math.max(ry, Math.abs(poly[i + 1])); }
    const c = w(0, 0, 0), n = w(0, 0, 1);
    out.discs.push([r3(c.x), r3(c.y), r3(c.z), r3(n.x - c.x), r3(n.y - c.y), r3(n.z - c.z), r3(rx), r3(ry), r3(depth), paintHex(paint ?? mesh.p), glow(paint ?? mesh.p)]);
    return ext(poly, depth, paint, ...rest);
  };
  mesh.quadUV = (a: number[], b: number[], c: number[], d: number[], u0: number, v0: number, u1: number, v1: number, paint: any) => {
    const p = paint ?? mesh.p, key = signKeys[p.layer - 1000];
    if (key) {
      const [A, B, C] = [a, b, c].map(v => w(v[0], v[1], v[2]));
      const ux = B.x - A.x, uz = B.z - A.z, vx = C.x - A.x, vy = C.y - A.y, vz = C.z - A.z;
      // Outward normal (u × v) gives the facing: 0 north (-z), π/2 east (+x).
      const nx = -(uz * vy), nz = ux * vy - 0 * vx;
      const D = w(d[0], d[1], d[2]);
      out.signs.push([key, r2((A.x + C.x) / 2), r2((A.y + C.y) / 2), r2((A.z + C.z) / 2), r2(Math.hypot(ux, uz)), r2(Math.abs(vy)), r3(Math.atan2(nx, -nz)), r2(D.y)]);
    }
    return quv(a, b, c, d, u0, v0, u1, v1, paint);
  };
  return out;
}

async function main() {
  const { engine, world, content, Plan } = await loadSource();
  const plan = new Plan();

  // ---- Street plan, landmarks and hills ------------------------------------------------------
  const roads = plan.roads.filter((r: any) => { const [x0, x1, z0, z1] = plan.roadRect(r, r.halfTotal); return inside(x0, z0, x1, z1); })
    .map((r: any) => [r.id, r.name.zh, r.name.en, r.axis, r.at, Math.max(r.from, -1e4), Math.min(r.to, 1e4), r.kind, r2(r.halfWidth), r2(r.halfTotal), r.median, r.lanesPerDir, !!r.pedestrian, r.elevated ?? '', !!r.treeMedian]);
  const landmarks = plan.landmarks.filter((l: any) => inside(l.x - l.w / 2, l.z - l.d / 2, l.x + l.w / 2, l.z + l.d / 2))
    .map((l: any) => [l.id, l.name.zh, l.name.en, l.x, l.z, l.w, l.d, r3(l.facing ?? 0), l.kind]);
  const hills = (engine.__hills as any[]).map(h => [h.x, h.z, h.height, h.radius, ...(h.fadeZ ?? [])]);
  const city = engine.__city;

  // ---- Sign artwork: text and colours of the landmark signs (the atlas the source paints) ---
  const table = world.__signTable as Record<string, any>;
  const signKeys = Object.keys(table);
  const size = (s?: string) => s === 'full' ? [4, 4] : s === 'half' ? [4, 2] : s === 'quarter' || !s ? [4, 1] : s === 'tall' ? [1, 4] : [2, 1];
  const atlas = {
    sign: (key: string) => {
      const i = signKeys.indexOf(key), [cw, ch] = size(table[key]?.size);
      return { layer: i < 0 ? 0 : 1000 + i, u0: 0, v0: 0, u1: 1, v1: 1, aspect: cw / ch };
    },
    get: () => ({ u0: 0, v0: 0, u1: 1, v1: 1, nu: 0, w: 1, h: 1 }), texture: sink(),
  };

  // ---- Taipei 101: the tower and, through the same call, its plaza and podium mall ----------
  const t101 = plan.landmark('taipei101'), g101 = plan.groundHeight(t101.x, t101.z);
  const icon = new world.__Mesh(65536), main101 = new world.__Mesh(65536);
  const towerRec = recorder(icon, signKeys), plazaRec = recorder(main101, signKeys);
  const towerCols: any[] = [];
  const tower = world.__tower101(icon, main101, new world.__Mesh(8192), atlas, t101, g101, world.__Lot.world(towerCols));

  // ---- Xinyi Plaza Malls (信義新天地): placed the way the landmark system places it ----------
  const mallsL = plan.landmark('xinyi-mall'), gMalls = plan.groundHeight(mallsL.x, mallsL.z);
  const mallsMesh = new world.__Mesh(65536), mallsRec = recorder(mallsMesh, signKeys);
  const mallsCols: any[] = [];
  world.__xinyiMalls(mallsMesh, new world.__Mesh(8192), atlas, mallsL, gMalls, world.__Lot.forLot(mallsL, gMalls, mallsCols));

  // ---- Elephant Mountain trail (its stone stairs, from the trailhead up the hill) -------------
  const trailL = plan.landmark('elephant-trailhead'), gTrail = plan.groundHeight(trailL.x, trailL.z);
  const trailCols: any[] = [];
  world.__trail(new world.__Mesh(65536), new world.__Mesh(65536), atlas, trailL, gTrail, world.__Lot.forLot(trailL, gTrail, trailCols), plan);

  // ---- The Xinyi district's own colliders (skywalk, 101 west plaza, Four Four South Village) --
  const district: any[][] = [];
  let part = '';
  // The skywalk links itself to the malls' bridge deck when it finds that deck (floorAt), as in the game.
  const mallDecks = mallsCols.filter(c => c.kind === 'floor');
  const floorAt = (x: number, z: number, maxY: number) => {
    let best = 0;
    for (const c of mallDecks) {
      const q = Math.abs(Math.sin(c.h)) > 0.5, ex = q ? c.hz : c.hx, ez = q ? c.hx : c.hz;
      if (Math.abs(x - c.cx) <= ex && Math.abs(z - c.cz) <= ez && c.y0 <= maxY) best = Math.max(best, c.y0);
    }
    return best;
  };
  const statics = new Proxy({}, {
    get: (_t, k) => (...a: any[]) => {
      if (k === 'floorAt') return floorAt(a[0], a[1], a[2]);
      district.push([part, k, ...a]);
      return undefined;
    },
  });
  const ctx: any = new Proxy({ statics, plan, quality: { level: 'high', shadows: false, drawDistance: 600, propDensity: 1 }, params: new Map(), yieldFrame: async () => {} }, {
    get: (t: any, k) => (k in t ? t[k] : k === 'then' ? undefined : sink()),
  });
  const pause = async () => {};
  for (const [name, build] of [['skywalk', content.__skywalk], ['plaza101', content.__plaza101], ['village', content.__village]] as const) {
    part = name;
    await build(ctx, atlas, pause);
  }

  // Normalise every collider into boxes, circles, decks and slopes (all axis-aligned here).
  const boxes: (string | number)[][] = [], circles: (string | number)[][] = [], decks: (string | number)[][] = [], slopes: number[][] = [];
  const quarter = (h: number) => { const q = h / (Math.PI / 2); if (Math.abs(q - Math.round(q)) > 1e-3) throw new Error(`rotated collider ${h}`); return Math.round(q) % 2 !== 0; };
  const addObb = (src: string, cx: number, cz: number, hx: number, hz: number, h: number, y0: number, y1: number, tag: string) => {
    const q = quarter(h), ex = q ? hz : hx, ez = q ? hx : hz;
    if (inside(cx - ex, cz - ez, cx + ex, cz + ez)) boxes.push([...[cx - ex, cz - ez, cx + ex, cz + ez, y0, y1].map(r2), tag, src]);
  };
  const addSlope = (cx: number, cz: number, hx: number, hz: number, ya: number, yb: number, h: number) => {
    // A slope rises from ya at its local -z end to yb at +z; heading turns local z onto the world.
    const q = quarter(h), ex = q ? hz : hx, ez = q ? hx : hz;
    if (!inside(cx - ex, cz - ez, cx + ex, cz + ez)) return;
    // Local +z in world: (−sin h, cos h) in the N_/statics convention.
    const dx = -Math.round(Math.sin(h)), dz = Math.round(Math.cos(h));
    const dir = dx > 0 ? 0 : dz > 0 ? 1 : dx < 0 ? 2 : 3;
    // Store with the rise toward dir (0 +x, 1 +z, 2 −x, 3 −z): low end y, high end y.
    slopes.push([...[cx - ex, cz - ez, cx + ex, cz + ez].map(r2), ...(ya <= yb ? [r2(ya), r2(yb), dir] : [r2(yb), r2(ya), (dir + 2) % 4])]);
  };
  const lotCollider = (src: string, c: any) => {
    if (c.kind === 'circle') { if (inside(c.x, c.z, c.x, c.z)) circles.push([r2(c.x), r2(c.z), r2(c.r), r2(c.y0), r2(c.y1), c.tag, src]); }
    else if (c.kind === 'box') { if (inside(c.x0, c.z0, c.x1, c.z1)) boxes.push([...[c.x0, c.z0, c.x1, c.z1, c.y0, c.y1].map(r2), c.tag, src]); }
    else if (c.kind === 'obb') addObb(src, c.cx, c.cz, c.hx, c.hz, c.h, c.y0, c.y1, c.tag);
    else if (c.kind === 'floor') {
      if (c.y0 === c.y1) { const q = quarter(c.h), ex = q ? c.hz : c.hx, ez = q ? c.hx : c.hz; if (inside(c.cx - ex, c.cz - ez, c.cx + ex, c.cz + ez)) decks.push([...[c.cx - ex, c.cz - ez, c.cx + ex, c.cz + ez, c.y0].map(r2), c.tag]); }
      else addSlope(c.cx, c.cz, c.hx, c.hz, c.y0, c.y1, c.h);
    }
  };
  for (const c of towerCols) lotCollider('taipei101', c);
  for (const c of mallsCols) lotCollider('xinyi-mall', c);
  for (const [src, k, ...a] of district) {
    if (k === 'addBox') { if (inside(a[0], a[1], a[2], a[3])) boxes.push([...a.slice(0, 6).map(r2), a[6], src]); }
    else if (k === 'addCircle') { if (inside(a[0], a[1], a[0], a[1])) circles.push([...a.slice(0, 5).map(r2), a[5], src]); }
    else if (k === 'addOBB') addObb(src, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]);
    else if (k === 'addFloorRect') { if (inside(a[0], a[1], a[2], a[3])) decks.push([...a.slice(0, 5).map(r2), a[5]]); }
    else if (k === 'addFloor') addSlope(a[0], a[1], a[2], a[3], a[4], a[5], a[6]);
  }
  // The trail's stairs are free-angled: keep its centreline (x, y, z) inside the area.
  const trail = trailCols.filter(c => c.kind === 'floor' && c.tag === 'stairs' && c.cx < AREA.x1 + MARGIN).map(c => [r2(c.cx), r2((c.y0 + c.y1) / 2), r2(c.cz)]);

  // ---- Generic city lots around the district (as the source builds them) ---------------------
  const lots = new world.__Lots(plan, ['police', 'hospital'].map(k => plan.spawns[k]).map((n: any) => ({ x0: n.x - 10, x1: n.x + 10, z0: n.z - 10, z1: n.z + 10 })));
  const claims = content.__xinyiPack.claims.filter((c: any) => c.scope !== 'props');
  const kept = lots.lots.filter((l: any) => !claims.some((c: any) => l.x1 > c.minX && l.x0 < c.maxX && l.z1 > c.minZ && l.z0 < c.maxZ));
  lots.lots.length = 0; lots.lots.push(...kept);
  lots.limitSites(plan.landmarks);
  let lotBoxes: number[][] = [];
  const specs = new world.__Specs({ box: (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tag: string) => lotBoxes.push([x0, z0, x1, z1, y0, y1, tag === 'pillar' ? 1 : 0]) });
  const palette = content.__xinyiPack.facadePalette as number[];
  specs.paletteAt = () => palette;
  const lotRows = kept.filter((l: any) => inside(l.x0, l.z0, l.x1, l.z1)).map((l: any) => {
    const s = specs.makeSpec(l);
    lotBoxes = [];
    specs.arcade(s, { body: sink() });
    specs.collide(s);
    return [l.type, l.floors, ...[l.x0, l.z0, l.x1, l.z1].map(r2), r2(s.gH), r2(s.top), hex(s.tint), l.arcade.map(r2).join(' '), lotBoxes.map(b => [...b.slice(0, 6).map(r2), b[6]].join(' ')).join(';')];
  });

  // ---- Sign artwork for the signs placed above ---------------------------------------------
  const placed = [...towerRec.signs, ...plazaRec.signs, ...mallsRec.signs];
  const art = Object.fromEntries([...new Set(placed.map(s => s[0] as string))].map(k => [k, [table[k].text ?? '', table[k].sub ?? '', table[k].bg ?? '#202020', table[k].fg ?? '#ffffff', table[k].vertical ? 1 : 0]]));
  // The district's shop list (trade, category, names) its storefronts are named from.
  const shops = (content.__xinyiPack.shopTrades as any[]).map(t => [t.trade, t.category, t.names]);

  // ---- Write --------------------------------------------------------------------------------
  const json = (v: unknown) => JSON.stringify(v);
  const rows = (name: string, doc: string, type: string, list: unknown[]) =>
    `/** ${doc} */\nexport const ${name}: ${type}[] = [\n${list.map(r => '  ' + json(r)).join(',\n')},\n];\n`;
  const lofts = towerRec.lofts.map(([y0, y1, pa, pb, c, g]: any[]) => {
    // Every tower section is a Bv outline: a square of half-size n with its corners stepped in
    // twice by r. Its first vertex is (cx + n, cz + n − 2r).
    const n0 = pa[0] - tower.cx, r0 = (n0 - (pa[1] - tower.cz)) / 2, n1 = pb[0] - tower.cx, rr1 = (n1 - (pb[1] - tower.cz)) / 2;
    return [y0, y1, r3(n0), r3(r0), r3(n1), r3(rr1), c, g];
  });
  const towerData = { cx: tower.cx, cz: tower.cz, ground: r3(g101), baseTop: r3(tower.baseTop), crownTop: r3(tower.crownTop), spireTop: r3(tower.spireTop), ...world.__zv };
  const out = `// Generated by tools/import-xinyi.ts from 臺北狂飆 / TAIPEI RUSH (https://taipei-gta.vercel.app),
// used with its author's permission. Do not edit by hand: re-run the tool instead.
// Source-world coordinates: metres, +x east, +z south, ground at y = 0 (sidewalks 0.15).

/** Rectangle of the source world the map covers, and the backdrop recorded around it. */
export const AREA = ${json(AREA)};
export const MARGIN = ${MARGIN};
/** The city's flat box; the basin's hills rise outside it. */
export const CITY = ${json(city)};
/** Hills of the basin: x, z, height, radius (and an optional z fade). */
export const HILLS: number[][] = ${json(hills)};

type Road = [id: string, zh: string, en: string, axis: 'x' | 'z', at: number, from: number, to: number, kind: string, halfWidth: number, halfTotal: number, median: number, lanesPerDir: number, pedestrian: boolean, elevated: string, treeMedian: boolean];
${rows('ROADS', 'Streets: axis-aligned carriageways (halfWidth) with sidewalks out to halfTotal.', 'Road', roads)}
type Landmark = [id: string, zh: string, en: string, x: number, z: number, w: number, d: number, facing: number, kind: string];
${rows('LANDMARKS', 'Named sites of the source plan around the area.', 'Landmark', landmarks)}
/** Taipei 101: its centre, ground, heights and section constants (zv in the source). */
export const TOWER = ${json(towerData)};
type Loft = [y0: number, y1: number, half0: number, notch0: number, half1: number, notch1: number, color: number, glow: number];
${rows('TOWER_LOFTS', 'Tower sections bottom to top: a notched square (half-size, corner step) lofted from y0 to y1, its paint and emissive strength.', 'Loft', lofts).replace(/,(\d{6,8}),/g, (_m, c) => ',' + hex(+c) + ',')}
type Cyl = [x: number, z: number, r0: number, r1: number, y0: number, y1: number, color: number, glow: number];
${rows('TOWER_CYLINDERS', 'Round parts of the tower and its plaza (spire, rings, canopy posts).', 'Cyl', [...towerRec.cylinders, ...plazaRec.cylinders])}
type Ball = [x: number, y: number, z: number, r: number, color: number, glow: number];
${rows('TOWER_LAMPS', "The tower's beacon lamps.", 'Ball', towerRec.spheres)}
type Disc = [x: number, y: number, z: number, nx: number, ny: number, nz: number, rx: number, ry: number, depth: number, color: number, glow: number];
${rows('TOWER_ORNAMENTS', 'Ruyi (如意) and coin ornaments on the tower faces: centre, facing, half-extents and depth.', 'Disc', towerRec.discs)}
type Paint = [x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, glow: number];
${rows('TOWER_BOXES', 'Box parts of the tower itself (granite piers at its base).', 'Paint', towerRec.boxes)}
${rows('PLAZA_101', 'Boxes the source draws for the 101 plaza and podium mall: paving, stone base, glass, bands and the low wing.', 'Paint', plazaRec.boxes)}
${rows('XINYI_MALLS', 'Boxes the source draws for the Xinyi Plaza Malls: stone bases, glass and window bands, crowns, bridges.', 'Paint', mallsRec.boxes)}
type Placed = [key: string, x: number, y: number, z: number, w: number, h: number, facing: number, top: number];
${rows('SIGNS', 'Landmark signs as placed: centre, width, height and facing (0 north, π/2 east).', 'Placed', placed)}
/** Sign artwork: text, second line, background, text colour, vertical. */
export const SIGN_ART: Record<string, [string, string, string, string, number]> = ${json(art)};
type Trade = [trade: string, category: string, names: string[]];
${rows('SHOPS', 'Shops of the Xinyi district: trade, category and the names its storefronts use.', 'Trade', shops)}
type Box = [x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tag: string, source: string];
${rows('BOXES', 'Box colliders of the district and its landmarks (tag: building, landmark, wall, rail, stairs, skybridge, bridge, bench…).', 'Box', boxes)}
type Circle = [x: number, z: number, r: number, y0: number, y1: number, tag: string, source: string];
${rows('CIRCLES', 'Round colliders: skywalk piers, poles, bollards, trees, planters and fountains.', 'Circle', circles)}
type Deck = [x0: number, z0: number, x1: number, z1: number, y: number, tag: string];
${rows('DECKS', 'Walkable decks (the skywalk and the mall bridges) at height y.', 'Deck', decks)}
type Slope = [x0: number, z0: number, x1: number, z1: number, low: number, high: number, dir: number];
${rows('SLOPES', 'Stair flights: rising from low to high toward dir (0 +x, 1 +z, 2 −x, 3 −z).', 'Slope', slopes)}
${rows('TRAIL', 'Elephant Mountain trail centreline from the trailhead up the hill: x, y, z.', 'number[]', trail)}
type Lot = [type: string, floors: number, x0: number, z0: number, x1: number, z1: number, groundFloor: number, top: number, tint: number, arcade: string, volumes: string];
${rows('LOTS', 'Generic city buildings: footprint, ground-floor height, roof, tint, arcade depth per side (N E S W) and colliders ("x0 z0 x1 z1 y0 y1 column;…").', 'Lot', lotRows).replace(/"(0x[0-9a-f]+)"/g, '$1')}`;
  writeFileSync(OUT, out.replace(/\[(-?[\d.]+(?:,-?[\d.]+){5}),(\d+),([\d.]+)\]/g, (_m, head, c, g) => `[${head},${hex(+c)},${g}]`));
  console.log(`wrote ${OUT}: ${roads.length} roads, ${lofts.length} tower sections, ${towerRec.cylinders.length} tower cylinders, ${towerRec.discs.length} ornaments, ${plazaRec.boxes.length} plaza boxes, ${mallsRec.boxes.length} mall boxes, ${placed.length} signs, ${boxes.length} boxes, ${circles.length} circles, ${decks.length} decks, ${slopes.length} slopes, ${trail.length} trail steps, ${lotRows.length} lots`);
}

/** Fetch index.html and the chunks the extraction runs (three, engine, world, content, runtime) into SRC. */
async function download() {
  const base = 'https://taipei-gta.vercel.app/';
  mkdirSync(SRC, { recursive: true });
  const index = await (await fetch(base)).text();
  writeFileSync(join(SRC, 'index.html'), index);
  const wanted = /^assets\/(three|engine|world|content|rolldown-runtime)-[\w-]+\.js$/;
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
