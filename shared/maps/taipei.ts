import { MapBuilder } from './builder';
import {
  AREA, BRANDS, EXPRESSWAY, HEDGES, LOTS, POIS, RED_HOUSE, ROADS, XIMEN_SHOPS, XIMEN_SOLIDS,
} from './taipei-data';
import { AMMO, LANES, PLAY, POINTS, SPAWNS, compact, laneClears } from './taipei-compact';
import { Kit, taipeiCover } from './taipei-cover';
import { heights } from './taipei-heights';
import { EMEI, streetCover } from './taipei-streets';
import { mrtExit, parkedCars, streetFurniture, type Keep, type Shift } from './taipei-decor';
import { SHOPS, interiors, replaced } from './taipei-interiors';
import { OPENED, PASSAGES, openings } from './taipei-passages';
import { TAIPEI_VEHICLES, parkTaipeiVehicles } from './taipei-vehicles';
import type { BlockStyle, Decor, MapDef, SignStyle } from './types';

/**
 * Taipei: Ximending (西門町), from the user's game 臺北狂飆 / TAIPEI RUSH (taipei-gta.vercel.app,
 * used with its author's permission). The street plan, every building volume and collision box,
 * the Ximen gateway, the cinema and arcade, the Red House, the Civic Blvd expressway and the shop
 * signs all come from shared/maps/taipei-data.ts, which tools/import-taipei.ts extracts from that
 * game's built code.
 *
 * The playable area is the dense core of the source's: the nine Ximending blocks between Huanhe Rd
 * (環河南路) and Zhonghua Rd (中華路), Civic Blvd (市民大道) and Zhongxiao W. Rd (忠孝西路), with one
 * carriageway of each boulevard kept as a ring road round them (taipei-compact.ts). The rest of the
 * source (the far carriageways, the Red House, the city) is the backdrop. Our game lays an overlay
 * on it:
 *   SWAT (team 0) deploys behind a police cordon on Civic Blvd's sidewalk, under the expressway;
 *   Militia (team 1, Sabotage attackers) behind a barricade at the south end of Xining S. Rd;
 *   A — Cinema Street (電影街): Wuchang St in front of the walk-in cinema lobby;
 *   B — the Tomas Bear game arcade (湯瑪熊歡樂城), whose ground floor opens onto Hanzhong St;
 *   C–E are landmarks bots roam to: the night market, the Ximen gateway and the Emei St stage.
 * Plus ammo crates and the drivable vehicles on the ring road.
 *
 * The look of the district, its street furniture and the skyline (with Taipei 101) come from the
 * source too, as a dressing set the renderer loads on demand (taipei-decor.ts places it and its
 * colliders); taipei-interiors.ts adds enterable shops, passages through the blocks and roof
 * access, taipei-cover.ts the street cover. Approximations: median floors follow the junction gaps
 * by rule, and the source's traffic and pedestrians are not carried over.
 *
 * Coordinates: the source's (+x east, +z south, metres), shifted so the playable area is centred on 0.
 */
const OX = (PLAY.x0 + PLAY.x1) / 2, OZ = (PLAY.z0 + PLAY.z1) / 2;
const HALF_X = (PLAY.x1 - PLAY.x0) / 2, HALF_Z = (PLAY.z1 - PLAY.z0) / 2;
/** Source sidewalks and pedestrian streets stand 15 cm above the asphalt. */
const KERB = 0.15;
/** Medians are 20 cm floors; the source plants hedges on some. */
const MEDIAN = 0.2;
/** How far past the source's area the city is built as a backdrop. */
const BACKDROP = 45;

type B = MapBuilder;
const X = (x: number) => x - OX, Z = (z: number) => z - OZ;

interface Rect { x0: number; z0: number; x1: number; z1: number }
const carriageway = (r: (typeof ROADS)[number]): Rect => {
  const [, , , axis, at, from, to, , hw] = r;
  return axis === 'x' ? { x0: from, x1: to, z0: at - hw, z1: at + hw } : { x0: at - hw, x1: at + hw, z0: from, z1: to };
};

/** Floor height at a source point: asphalt on a traffic carriageway, its median, else kerb height. */
function floorAt(x: number, z: number) {
  for (const r of ROADS) {
    if (r[12]) continue;
    const c = carriageway(r), off = Math.abs((r[3] === 'x' ? z : x) - r[4]);
    if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return off > r[10] / 2 ? 0 : MEDIAN;
  }
  return KERB;
}

/** Box from source-world corners, bottom y0 to top y1. */
function boxAt(b: B, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, style: BlockStyle, color?: number) {
  const i = b.box(X((x0 + x1) / 2), y0, Z((z0 + z1) / 2), x1 - x0, y1 - y0, z1 - z0, style);
  return color === undefined ? i : b.paint(i, color);
}

/**
 * Sidewalks: everything inside the built area that is not a carriageway of a traffic road is
 * paved at kerb height (sidewalks, the pedestrian streets, arcades and courtyards), split into as
 * few rectangles as the road grid allows.
 */
function paving(b: B) {
  const area: Rect = { x0: -882.2, x1: AREA.x1 + BACKDROP, z0: AREA.z0 - BACKDROP, z1: AREA.z1 + BACKDROP };
  const roads = ROADS.filter(r => !r[12]).map(carriageway);
  const xs = [...new Set([area.x0, area.x1, ...roads.flatMap(r => [r.x0, r.x1])])].filter(v => v >= area.x0 && v <= area.x1).sort((a, c) => a - c);
  const zs = [...new Set([area.z0, area.z1, ...roads.flatMap(r => [r.z0, r.z1])])].filter(v => v >= area.z0 && v <= area.z1).sort((a, c) => a - c);
  const paved = (i: number, j: number) => {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    return !roads.some(r => cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1);
  };
  const done = new Set<string>();
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
    if (done.has(`${i},${j}`) || !paved(i, j)) continue;
    // Grow east, then south while the whole row stays paved.
    let i1 = i;
    while (i1 + 1 < xs.length - 1 && paved(i1 + 1, j) && !done.has(`${i1 + 1},${j}`)) i1++;
    let j1 = j;
    while (j1 + 1 < zs.length - 1) {
      let ok = true;
      for (let k = i; k <= i1; k++) if (!paved(k, j1 + 1) || done.has(`${k},${j1 + 1}`)) ok = false;
      if (!ok) break;
      j1++;
    }
    for (let jj = j; jj <= j1; jj++) for (let ii = i; ii <= i1; ii++) done.add(`${ii},${jj}`);
    boxAt(b, xs[i], zs[j], xs[i1 + 1], zs[j1 + 1], -0.35, KERB, 'paving', 0xd8d6d0);
  }
}

/** Asphalt over every traffic carriageway (visual: the ground under it is the road). */
function asphalt(b: B) {
  for (const r of ROADS) {
    if (r[12]) continue;
    const c = carriageway(r);
    const x0 = Math.max(c.x0, AREA.x0 - BACKDROP), x1 = Math.min(c.x1, AREA.x1 + BACKDROP), z0 = Math.max(c.z0, AREA.z0 - BACKDROP), z1 = Math.min(c.z1, AREA.z1 + BACKDROP);
    if (x1 <= x0 || z1 <= z0) continue;
    // Cross roads lie a few millimetres apart so their overlaps never flicker.
    const top = r[3] === 'x' ? 0.004 : 0.008;
    b.shape(X((x0 + x1) / 2), top - 0.02, Z((z0 + z1) / 2), x1 - x0, 0.02, z1 - z0, 'asphalt');
  }
}

/**
 * The pedestrian streets' paving as the source lays it: warm clay tiles kerb to kerb with a red
 * stripe down the middle (visual, on the paving's top; crossings with the traffic roads excluded).
 */
function pedestrianPaving(b: B) {
  const traffic = ROADS.filter(r => !r[12]).map(carriageway);
  for (const r of ROADS) {
    if (!r[12]) continue;
    const [, , , axis, at, from, to, , hw] = r;
    // Runs between the traffic roads it crosses.
    const cuts = traffic.filter(c => axis === 'x' ? at > c.z0 && at < c.z1 : at > c.x0 && at < c.x1).map(c => axis === 'x' ? [c.x0, c.x1] : [c.z0, c.z1]).sort((p, q) => p[0] - q[0]);
    let a = from;
    const runs: [number, number][] = [];
    for (const [c0, c1] of cuts) { if (c0 > a) runs.push([a, Math.min(c0, to)]); a = Math.max(a, c1); }
    if (a < to) runs.push([a, to]);
    for (const [s0, s1] of runs) {
      if (s1 - s0 < 1) continue;
      const strip = (o0: number, o1: number, y: number, color: number) => {
        const [x0, z0, x1, z1] = axis === 'x' ? [s0, at + o0, s1, at + o1] : [at + o0, s0, at + o1, s1];
        b.shape(X((x0 + x1) / 2), KERB, Z((z0 + z1) / 2), x1 - x0, y, z1 - z0, 'paving', color);
      };
      strip(-hw, hw, 0.004, 0xd8b2a0);
      strip(-0.8, 0.8, 0.007, 0xa85a44);
    }
  }
}

/** Raised medians of the divided roads, broken where cross streets pass through, and the road paint. */
function streets(b: B) {
  const traffic = ROADS.filter(r => !r[12]);
  const lo = (r: (typeof ROADS)[number]) => r[3] === 'x' ? Math.max(r[5], AREA.x0 - BACKDROP) : Math.max(r[5], AREA.z0 - BACKDROP);
  const hi = (r: (typeof ROADS)[number]) => r[3] === 'x' ? Math.min(r[6], AREA.x1 + BACKDROP) : Math.min(r[6], AREA.z1 + BACKDROP);
  const WHITE = 0xe4e2da, YELLOW = 0xd8a830;
  const mark = (x0: number, z0: number, x1: number, z1: number, color: number) =>
    b.raw({ kind: 'marking', x: X((x0 + x1) / 2), y: 0.012, z: Z((z0 + z1) / 2), w: Math.abs(x1 - x0), d: Math.abs(z1 - z0), color });
  for (const r of traffic) {
    const [, , , axis, at, , , , hw, , median, lanes] = r;
    const a0 = lo(r), a1 = hi(r);
    // Cross roads along this one: [from, to] spans of their carriageways.
    const crossings = ROADS.filter(c => c[3] !== axis && c[4] > a0 - 30 && c[4] < a1 + 30 && at >= c[5] - 0.5 && at <= c[6] + 0.5)
      .map(c => ({ at: c[4], half: c[8], traffic: !c[12] })).sort((p, q) => p.at - q.at);
    const gaps = crossings.map(c => [c.at - c.half - (c.traffic ? 3.5 : 0), c.at + c.half + (c.traffic ? 3.5 : 0)]);
    // Runs between the crossings.
    const runs: [number, number][] = [];
    let cursor = a0;
    for (const [g0, g1] of gaps) { if (g0 > cursor) runs.push([cursor, Math.min(g0, a1)]); cursor = Math.max(cursor, g1); }
    if (cursor < a1) runs.push([cursor, a1]);
    const along = (s0: number, s1: number, o0: number, o1: number, color: number) =>
      axis === 'x' ? mark(s0, at + o0, s1, at + o1, color) : mark(at + o0, s0, at + o1, s1, color);
    for (const [s0, s1] of runs) {
      if (s1 - s0 < 1) continue;
      if (median > 0) {
        const m = median / 2;
        if (axis === 'x') boxAt(b, s0, at - m, s1, at + m, -0.35, MEDIAN, 'slab', 0xa8a49c);
        else boxAt(b, at - m, s0, at + m, s1, -0.35, MEDIAN, 'slab', 0xa8a49c);
      } else along(s0, s1, -0.08, 0.08, YELLOW);
      // Lane lines: dashed white between the lanes of each direction, solid white along the kerbs.
      for (const side of [-1, 1]) {
        const inner = median / 2, lane = (hw - inner) / lanes;
        for (let k = 1; k < lanes; k++) {
          const o = side * (inner + k * lane);
          for (let s = s0 + 1; s + 3 < s1; s += 9) along(s, s + 3, o - 0.07, o + 0.07, WHITE);
        }
        const edge = side * (hw - 0.35);
        along(s0, s1, edge - 0.07, edge + 0.07, WHITE);
      }
    }
    // Zebra crossings over this road, just outside every junction with another traffic road.
    for (const c of crossings) {
      if (!c.traffic) continue;
      for (const side of [-1, 1]) {
        const s = c.at + side * (c.half + 2.2);
        if (s < a0 || s > a1) continue;
        for (let o = -hw + 0.6; o < hw - 0.6; o += 1.1) {
          if (median > 0 && Math.abs(o + 0.3) < median / 2) continue;
          along(s - 1.6, s + 1.6, o, o + 0.6, WHITE);
        }
      }
    }
  }
}

/** The expressway over Civic Blvd: deck segments, parapets and piers in the median. */
function expressway(b: B) {
  const e = EXPRESSWAY, z0 = e.z - e.deckHalf, z1 = e.z + e.deckHalf;
  for (const [x0, x1, t0, t1] of e.segments) {
    const top = (t0 + t1) / 2;
    boxAt(b, x0, z0, x1, z1, top - e.deckDepth, top, 'concrete', 0xb4b4ae);
    for (const z of [z0, z1 - 0.35]) boxAt(b, x0, z, x1, z + 0.35, top - 0.45, top + 1 + e.wall, 'concrete', 0xc4c4be);
  }
  e.piers.forEach((x, i) => boxAt(b, x - 1.1, e.z - 1.25, x + 1.1, e.z + 1.25, 0, e.pierTop[i], 'concrete', 0xb8b8b2));
}

/**
 * The Ximending district's own collision boxes. The district is drawn by the source's own meshes
 * (the 'taipei' dressing set: facades, signs, shopfronts, the cinema and arcade interiors), so its
 * boxes only collide, each with the surface it stands for.
 */
/** Every enterable building: the shops with roof access and the passages through the blocks. */
const ALL_SHOPS = [...SHOPS, ...PASSAGES];

function ximending(b: B) {
  for (const box of XIMEN_SOLIDS) {
    const [x0, z0, x1, z1, y0, y1, tag] = box;
    // Buildings with enterable ground floors are built by taipei-interiors.ts and taipei-passages.ts.
    if (tag === 'building' && replaced(ALL_SHOPS, box)) continue;
    if (OPENED.some(o => o.every((v, i) => v === box[i]))) continue;
    const surface = tag === 'pole' ? 'metal' : tag === 'prop' ? (y1 - y0 > 2 ? 'metal' : 'concrete') : 'concrete';
    b.box(X((x0 + x1) / 2), tag === 'floor' ? 0 : y0, Z((z0 + z1) / 2), x1 - x0, y1 - (tag === 'floor' ? 0 : y0), z1 - z0, 'invisible', surface);
  }
}

/** Generic city buildings: their volumes and arcade (騎樓) columns. */
function lots(b: B) {
  for (const [, , , , , , , , tint, , volumes] of LOTS) {
    for (const v of volumes.split(';')) {
      const [x0, z0, x1, z1, y0, y1, column] = v.split(' ').map(Number);
      boxAt(b, x0, z0, x1, z1, y0, y1, column ? 'concrete' : 'facade', column ? tint : tint);
    }
  }
}

/** The Red House (西門紅樓): octagon, cross wing, gate piers, plaza tables, trees and poles. */
function redHouse(b: B) {
  const RED = 0xffffff;
  for (const c of RED_HOUSE) {
    if (c[0] === 'circle') {
      const [, x, z, r, , y1, tag] = c as [string, number, number, number, number, number, string];
      if (tag === 'landmark') {
        // The octagon as the source builds it: a brick storey with arched windows, a stone band, a
        // second brick storey, the cornice, a hipped octagonal roof, the lantern storey and its cap.
        // Collision is the source's: its circle up to the roof.
        b.cylinder(X(x), 0, Z(z), r * 0.9, y1, 'invisible', 'y');
        const oct = (radius: number, y0: number, ya: number, style: BlockStyle, color: number, top = radius) =>
          b.raw({ kind: 'cylinder', x: X(x), y: y0, z: Z(z), radius, height: ya - y0, axis: 'y', style, color, sides: 8, top });
        const STONE = 0xf0e8dc, TILE = 0x7a8478;
        oct(9.5, 0, 5.4, 'brick', RED); oct(9.9, 5.2, 6.1, 'plaster', STONE);
        oct(9.3, 6, 10.6, 'brick', RED); oct(10, 10.5, 11.5, 'plaster', STONE);
        oct(10.4, 11.5, 13.7, 'slab', TILE, 4.2);
        oct(4.2, 13.7, 16.4, 'brick', RED); oct(4.6, 16.4, 17.1, 'plaster', STONE);
        oct(4.8, 17.1, 20.5, 'slab', TILE, 0.2);
        oct(0.12, 20.5, y1, 'steel', 0x3a3a3c);
      } else if (tag === 'tree') b.tree(X(x), Z(z), (y1 + 0.2) / 3.2, 1);
      else if (tag === 'wall') b.cylinder(X(x), 0, Z(z), r, y1, 'wood', 'y', 0x6b4a2a);
      else b.cylinder(X(x), 0, Z(z), Math.max(r, 0.08), y1, 'steel', 'y', 0x3a3a3c);
    } else {
      // Oriented boxes at a quarter turn: half-extents swap onto the world axes.
      const [, cx, cz, hx, hz, h, , y1] = c as [string, number, number, number, number, number, number, number];
      const quarter = Math.abs(Math.sin(h)) > 0.5, ex = quarter ? hz : hx, ez = quarter ? hx : hz;
      boxAt(b, cx - ex, cz - ez, cx + ex, cz + ez, 0, y1, 'brick', RED);
    }
  }
}

function sign(b: B, style: SignStyle, x: number, y0: number, y1: number, z: number, facing: number, w: number, text: string, bg: string, fg: string, sub = '') {
  const d: Decor = { kind: 'sign', style, x: X(x), y: (y0 + y1) / 2, z: Z(z), rotY: facing, w, h: y1 - y0, text, bg, fg, ...(sub ? { sub } : {}) };
  b.raw(d);
}

/** Shop signboards of the plan's chain stores outside the district (whose own storefronts are in its meshes). */
function signage(b: B) {
  for (const [kind, brand, x, z, f, w] of POIS) {
    if (kind === 'claw' || XIMEN_SHOPS.some(s => Math.hypot(s[0] - x, s[1] - z) < 3)) continue;
    if (x < AREA.x0 - BACKDROP || x > AREA.x1 + BACKDROP) continue;
    const colors = BRANDS[brand] ?? ['#c8141a', '#ffffff'];
    sign(b, 'board', x + Math.sin(f) * 0.6, 3.2, 4.1, z - Math.cos(f) * 0.6, f, Math.min(w, 9) - 0.4, brand, colors[0], colors[1] ?? '#ffffff');
  }
}

/** The Red House's name board on its gate (the Ximen gateway's arch sign is in the district meshes). */
function gateway(b: B) {
  sign(b, 'board', -725.7, 6.1, 7.1, -90, Math.PI / 2, 8, '西門紅樓', '#5a1a14', '#ffd890', 'THE RED HOUSE');
}

export function taipei(): MapDef {
  const b = new MapBuilder({
    id: 'taipei', name: 'Taipei', region: 'XIMENDING 西門町 / TAIPEI',
    description: 'Ximending from 臺北狂飆: neon pedestrian streets, Cinema Street, the arcade and the night market, ringed by a road under the Civic Blvd expressway.',
    theme: 'taipei', halfX: HALF_X, halfZ: HALF_Z, seed: 101, roll: 0, ridge: 0,
    sabotage: { sites: ['A', 'B'], attackerSpawn: 1 },
    // Low evening sun from the west, down Wuchang and Emei streets.
    sun: { x: -0.78, y: 0.4, z: 0.2 },
    ground: () => 0,
  });
  b.buildTerrain(4);

  paving(b);
  asphalt(b);
  streets(b);
  pedestrianPaving(b);
  expressway(b);
  for (const [x0, z0, x1, z1, top] of HEDGES) boxAt(b, x0, z0, x1, z1, MEDIAN, top, 'hedge');
  ximending(b);
  lots(b);
  redHouse(b);
  signage(b);
  gateway(b);

  // ---- Overlay: bases, sites, landmarks and ammo (taipei-compact.ts) ------------------------
  for (const [team, x, z, yaw] of SPAWNS) b.spawn(team, X(x), floorAt(x, z), Z(z), yaw);
  for (const [id, [x, z, r, name]] of Object.entries(POINTS)) b.point(id as keyof typeof POINTS, name, X(x), floorAt(x, z), Z(z), r);
  for (const [x, z] of AMMO) b.ammoCrate(X(x), floorAt(x, z), Z(z));

  // ---- Drivable vehicles (shared/maps/taipei-vehicles.ts) ----------------------------------
  parkTaipeiVehicles(b, X, Z, floorAt);

  // ---- Dressing (taipei-decor.ts), kept clear of the spawns, crates and vehicle spots -------
  const shift: Shift = { X, Z, ox: OX, oz: OZ };
  const vehicleRoom = { car: 3.4, scooter: 1.6, heli: 9 } as Record<string, number>;
  const keep: Keep = [
    ...b.spawns.map(p => [p.x, p.z, 1.4] as [number, number, number]),
    ...b.pickups.map(p => [p.x, p.z, 1.6] as [number, number, number]),
    ...TAIPEI_VEHICLES.map(([kind, x, z]) => [X(x), Z(z), vehicleRoom[kind] ?? 3.4] as [number, number, number]),
  ];
  const cuts = [...interiors(b, shift, ALL_SHOPS), ...openings(b, shift)];
  // Nothing of the street dressing (look or collider) stands on the ring road, where a vehicle
  // parks, nor round the spawns and crates; the cover keeps off the lanes too.
  const lanes = [...LANES, ...EMEI];
  const kit = new Kit(b, shift, keep, lanes);
  taipeiCover(kit);
  compact(kit);
  heights(kit);
  streetCover(kit);
  const clear = [...keep.flatMap(([x, z, r]) => [x - r, 0.05, z - r, x + r, 3, z + r]), ...laneClears(lanes, X, Z), ...kit.clear];
  streetFurniture(b, shift, keep, cuts, clear);
  parkedCars(b, shift, keep, lanes);
  mrtExit(b, shift, KERB);

  return outsideAsScenery(b.build());
}

/**
 * Past the bounds the source's city is only scenery: its collision boxes go (drawn ones become
 * shapes), which keeps the solid count and the navigation build to the playable area.
 */
function outsideAsScenery(def: MapDef): MapDef {
  const { minX, maxX, minZ, maxZ } = def.bounds, m = 2;
  const out = (s: MapDef['solids'][number]) => s.maxX < minX - m || s.minX > maxX + m || s.maxZ < minZ - m || s.minZ > maxZ + m;
  const index = new Int32Array(def.solids.length).fill(-1);
  const solids: MapDef['solids'] = [];
  def.solids.forEach((s, i) => { if (!out(s)) { index[i] = solids.length; solids.push(s); } });
  const decor: Decor[] = def.decor.map(d => {
    if (d.kind !== 'block') return d;
    const s = def.solids[d.solid];
    if (index[d.solid] >= 0) return { ...d, solid: index[d.solid] };
    return { kind: 'shape', min: [s.minX, s.minY, s.minZ], max: [s.maxX, s.maxY, s.maxZ], style: d.style, ...(d.color === undefined ? {} : { color: d.color }) };
  });
  return { ...def, solids, decor };
}
