import { MapBuilder } from './builder';
import {
  AREA, BILLBOARDS, BRANDS, EXPRESSWAY, HEDGES, LOTS, POIS, RED_HOUSE, ROADS, START, XIMEN_SHELLS, XIMEN_SHOPS, XIMEN_SIGNS, XIMEN_SOLIDS,
} from './taipei-data';
import { parkTaipeiVehicles } from './taipei-vehicles';
import type { BlockStyle, Decor, MapDef, SignStyle } from './types';

/**
 * Taipei: Ximending (西門町), taken 1:1 from the user's game 臺北狂飆 / TAIPEI RUSH
 * (taipei-gta.vercel.app, used with its author's permission). The street plan, every building
 * volume and collision box, the Ximen gateway, the cinema and arcade, the Red House, the Civic
 * Blvd expressway and the shop signs all come from shared/maps/taipei-data.ts, which
 * tools/import-taipei.ts extracts from that game's built code; nothing is moved or redesigned.
 *
 * The playable area is the source's own: the nine Ximending blocks between Huanhe Rd (環河南路)
 * and Zhonghua Rd (中華路), from the Civic Blvd (市民大道) median down through Zhongxiao W. Rd
 * (忠孝西路) to the Red House (西門紅樓). Our game only lays an overlay on it:
 *   SWAT (team 0) deploys on Civic Blvd under the expressway (north);
 *   Militia (team 1, Sabotage attackers) deploys on Zhongxiao W. Rd outside Ximen station, where
 *     the source game starts its player;
 *   A — Cinema Street (電影街): Wuchang St in front of the walk-in cinema lobby;
 *   B — the Tomas Bear game arcade (湯瑪熊歡樂城), whose ground floor opens onto Hanzhong St;
 *   C–E are landmarks bots roam to: the Red House, the Ximen gateway and the Emei St stage.
 * Plus ammo crates and the playable bounds.
 *
 * Approximations: the octagonal Red House is a round drum (collision as in the source up to its
 * eaves, its roof stepped), median floors follow the junction gaps by rule, and the source's MRT
 * exits, street furniture, traffic, pedestrians and generic facade signs are not carried over.
 *
 * Coordinates: the source's (+x east, +z south, metres), shifted so the area is centred on 0.
 */
const OX = (AREA.x0 + AREA.x1) / 2, OZ = (AREA.z0 + AREA.z1) / 2;
const HALF_X = (AREA.x1 - AREA.x0) / 2, HALF_Z = (AREA.z1 - AREA.z0) / 2;
/** Source sidewalks and pedestrian streets stand 15 cm above the asphalt. */
const KERB = 0.15;
/** Medians are 20 cm floors; the source plants hedges on some. */
const MEDIAN = 0.2;
/** How far past the bounds the city is built as a backdrop. */
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
    boxAt(b, xs[i], zs[j], xs[i1 + 1], zs[j1 + 1], -0.35, KERB, 'slab', 0xb8b4ac);
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

/** Facade colour of the district building the point (x, z) belongs to. */
function shellColor(x: number, z: number) {
  const s = XIMEN_SHELLS.find(([x0, z0, x1, z1]) => x >= x0 - 0.05 && x <= x1 + 0.05 && z >= z0 - 0.05 && z <= z1 + 0.05);
  return s ? s[5] : 0xc8c4bc;
}

/** The Ximending district's own collision boxes, styled by what they are. */
function ximending(b: B) {
  for (const [x0, z0, x1, z1, y0, y1, tag] of XIMEN_SOLIDS) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, h = y1 - y0;
    switch (tag) {
      case 'building': boxAt(b, x0, z0, x1, z1, y0, y1, 'facade', shellColor(cx, cz)); break;
      case 'wall': boxAt(b, x0, z0, x1, z1, y0, y1, 'plaster', shellColor(cx, cz)); break;
      case 'pillar': boxAt(b, x0, z0, x1, z1, y0, y1, 'concrete', 0x4a4458); break;
      case 'pole': boxAt(b, x0, z0, x1, z1, y0, y1, 'steel', h > 8 ? 0xb8141a : 0x7a7a7c); break;
      case 'floor': boxAt(b, x0, z0, x1, z1, 0, y1, 'slab'); break;
      // Claw machines and game cabinets stand tall; counters, seats and tables are low.
      default: boxAt(b, x0, z0, x1, z1, y0, y1, h > 2 ? 'steel' : 'wood', h > 2 ? 0xd85aa8 : 0x8a6a4a);
    }
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
  const RED = 0xe0907c;
  for (const c of RED_HOUSE) {
    if (c[0] === 'circle') {
      const [, x, z, r, , y1, tag] = c as [string, number, number, number, number, number, string];
      if (tag === 'landmark') {
        // The octagonal hall to its eaves, then the roof and lantern up to the source's 22 m.
        b.cylinder(X(x), 0, Z(z), r, 12, 'brick', 'y', RED);
        b.cylinder(X(x), 12, Z(z), r * 0.8, 2.5, 'roof', 'y', 0x5a4a44);
        b.cylinder(X(x), 14.5, Z(z), r * 0.4, 4.5, 'brick', 'y', RED);
        b.cylinder(X(x), 19, Z(z), r * 0.25, y1 - 19, 'roof', 'y', 0x5a4a44);
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

/** Every sign the district hangs, the shopfronts it opened, and the chain stores of the plan. */
function signage(b: B) {
  for (const [kind, x, z, y0, y1, facing, w, text, sub, bg, fg] of XIMEN_SIGNS) {
    if (kind === 'billboard') {
      const art = BILLBOARDS[Number(text.replace('bill', ''))] ?? ['', '#202020', '#ffffff'];
      const lines = art[0].split(' / ');
      sign(b, 'billboard', x, y0, y1, z, facing, w, lines[0], art[1], contrast(art[1]), lines.slice(1).join(' · '));
    } else if (kind === 'screen') sign(b, 'screen', x, y0, y1, z, facing, w, '', '#101826', '#5ad8ff');
    else if (kind === 'marquee') sign(b, 'marquee', x, y0, y1, z, facing, w, '', fg || '#14161c', '#ffd890');
    else sign(b, kind === 'blade' ? 'blade' : 'board', x, y0, y1, z, facing, w, text, bg || '#202020', fg || '#ffffff', sub);
  }
  // Shopfront signboards over the ground floor: district storefronts first, then the plan's other stores.
  const fronts: [number, number, number, number, string][] = XIMEN_SHOPS.map(([x, z, f, w, name]) => [x, z, f, w, name]);
  for (const [kind, brand, x, z, f, w] of POIS) {
    if (kind === 'claw' || fronts.some(s => Math.hypot(s[0] - x, s[1] - z) < 3)) continue;
    if (x < AREA.x0 - BACKDROP || x > AREA.x1 + BACKDROP) continue;
    fronts.push([x + Math.sin(f) * 0.6, z - Math.cos(f) * 0.6, f, w, brand]);
  }
  for (const [x, z, f, w, name] of fronts) {
    const colors = BRANDS[name] ?? ['#c8141a', '#ffffff'];
    sign(b, 'board', x, 3.2, 4.1, z, f, Math.min(w, 9) - 0.4, name, colors[0], colors[0] === '#ffffff' || colors[0] === '#f7f3e8' ? colors[1] : colors[1] ?? '#ffffff');
  }
}

function contrast(bg: string) {
  const v = parseInt(bg.slice(1), 16), l = ((v >> 16) & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11;
  return l > 150 ? '#1a1a1a' : '#ffffff';
}

/** The Ximen gateway (西門町牌樓) over Hanzhong St at Zhongxiao W. Rd: its arch sign between the posts. */
function gateway(b: B) {
  const [px0, px1] = XIMEN_SOLIDS.filter(s => s[6] === 'pole' && s[5] > 8).map(s => (s[0] + s[2]) / 2).sort((p, q) => p - q);
  const z = -176.6;
  for (const f of [0, Math.PI]) sign(b, 'gate', (px0 + px1) / 2, 6.6, 8.6, z + (f ? 0.12 : -0.12), f, px1 - px0 + 1.2, '西門町', '#c8141e', '#fff4f0', 'XIMENDING · 徒步區 WALKING ZONE');
  sign(b, 'board', -725.7, 6.1, 7.1, -90, Math.PI / 2, 8, '西門紅樓', '#5a1a14', '#ffd890', 'THE RED HOUSE');
}

export function taipei(): MapDef {
  const b = new MapBuilder({
    id: 'taipei', name: 'Taipei', region: 'XIMENDING 西門町 / TAIPEI',
    description: 'Ximending from 臺北狂飆: neon pedestrian streets, Cinema Street, the arcade and the Red House under the Civic Blvd expressway.',
    theme: 'taipei', halfX: HALF_X, halfZ: HALF_Z, seed: 101, roll: 0, ridge: 0,
    sabotage: { sites: ['A', 'B'], attackerSpawn: 1 },
    // Low evening sun from the west, down Wuchang and Emei streets.
    sun: { x: -0.78, y: 0.4, z: 0.2 },
    ground: () => 0,
  });
  b.buildTerrain(4);

  paving(b);
  streets(b);
  expressway(b);
  for (const [x0, z0, x1, z1, top] of HEDGES) boxAt(b, x0, z0, x1, z1, MEDIAN, top, 'hedge');
  ximending(b);
  lots(b);
  redHouse(b);
  signage(b);
  gateway(b);

  // ---- Overlay: bases, sites, landmarks and ammo ------------------------------------------
  // SWAT on Civic Blvd's south carriageway, under the expressway, facing south into Ximending.
  const spawn = (team: 0 | 1, x: number, z: number, yaw: number) => b.spawn(team, X(x), floorAt(x, z), Z(z), yaw);
  for (let i = 0; i < 12; i++) spawn(0, -790 + (i % 6) * 5, -292 + Math.floor(i / 6) * 4.5, Math.PI);
  // Militia on Zhongxiao W. Rd by the Ximen gateway, just west of where the source starts its player, facing north.
  for (let i = 0; i < 12; i++) spawn(1, START.x - 35 + (i % 6) * 5, Math.floor(i / 6) ? START.z : -151.5, 0);
  b.point('A', 'Cinema Street 電影街', X(-839), floorAt(-839, -251.5), Z(-251.5), 7);
  b.point('B', 'Arcade 湯瑪熊歡樂城', X(-746.5), KERB, Z(-224.5), 7);
  b.point('C', 'Red House 西門紅樓', X(-750), KERB, Z(-110), 8);
  b.point('D', 'Ximen Gateway 西門町牌樓', X(-757), KERB, Z(-184), 6);
  b.point('E', 'Emei St Stage 峨眉街', X(-757), KERB, Z(-207), 6);
  for (const [x, z] of [[-826, -253], [-757, -238], [-813, -207], [-770, -110], [-860.5, -206], [-715.5, -230]]) b.ammoCrate(X(x), floorAt(x, z), Z(z));

  // ---- Drivable vehicles (shared/maps/taipei-vehicles.ts) ----------------------------------
  parkTaipeiVehicles(b, X, Z, floorAt);

  return b.build();
}
