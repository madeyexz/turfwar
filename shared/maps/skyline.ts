import { MapBuilder, type Side } from './builder';
import type { BlockStyle, MapDef } from './types';

/**
 * Skyline Rooftops: an 8v8 fight across the roofs of a frozen city, a hundred metres above the
 * streets. Seven roofs per half (24–36 m) are joined by steel bridges, stair flights over the gaps
 * and an enclosed sky-bridge corridor; there are no streets to fall back to, so a slip over the
 * parapet is fatal. Team 0 deploys on the west roof, team 1 on the east.
 *
 *   A Helipad     — north-west roof (33 m), wide open, a crashed gunship for cover
 *   B Central     — the central tower roof (36 m), the highest point
 *   C Helipad     — A rotated 180° onto the south-east roof
 *
 * Roof grid (west half; the east half is its 180° rotation), x columns × z rows:
 *
 *            x −68..−46     x −40..−16      x −10..10
 *   z −50..−22   Water tower 27  A Helipad 33   Office 30
 *   z −14..14    Spawn 30        Penthouse 30   B Central 36 (shared)
 *   z  22..50    Billboard 24    Tank roof 26   (Office, mirrored)
 *
 * Coordinates: +X east, +Z south, metres.
 */

const HALF = 70;
/** The streets far below: anything under y = -40 dies, so the drop is always fatal. */
const STREET = -80;

interface Roof { x0: number; x1: number; z0: number; z1: number; y: number; style: BlockStyle }
const roof = (x0: number, x1: number, z0: number, z1: number, y: number, style: BlockStyle): Roof => ({ x0, x1, z0, z1, y, style });

/** West-half roofs (placed through the mirror). */
const R = {
  spawn: roof(-68, -46, -14, 14, 30, 'wall'),
  tower: roof(-68, -46, -50, -22, 27, 'concrete'),
  board: roof(-68, -46, 22, 50, 24, 'wallDark'),
  helipad: roof(-40, -16, -50, -22, 33, 'wall'),
  penthouse: roof(-40, -16, -14, 14, 30, 'wallDark'),
  tanks: roof(-40, -16, 22, 50, 26, 'concrete'),
  office: roof(-10, 10, -50, -22, 30, 'wall'),
};
/** The central tower (self-symmetric, placed outside the mirror). */
const B = roof(-10, 10, -14, 14, 36, 'wallDark');

/** Width of every bridge and stair flight over a gap (wide enough for two nav columns). */
const SPAN = 5;

export function skylineRooftops(): MapDef {
  const b = new MapBuilder({
    id: 'skyline', name: 'Skyline Rooftops', region: 'BOREAL ARCOLOGY / UPPER CITY',
    description: 'Frozen rooftops: bridges, a sky-bridge corridor and a penthouse. The streets are a hundred metres down.',
    theme: 'desert', halfX: HALF, halfZ: HALF, seed: 23, roll: 0, ridge: 0,
    sabotage: { sites: ['B'], attackerSpawn: 1 },
    sun: { x: 0.42, y: 0.55, z: -0.5 },
    ground: () => STREET,
  });
  b.buildTerrain(4);

  b.mirrored(() => {
    // ---- Buildings and parapets (openings where bridges and stairs land) ----
    building(b, R.spawn, { n: [[-51, SPAN]], s: [[-51, SPAN]], e: [[-6, SPAN], [8, 6]] }, { courtyard: true });
    building(b, R.tower, { s: [[-51, SPAN]], e: [[-36, SPAN]] });
    building(b, R.board, { n: [[-51, SPAN]], e: [[30, SPAN]] });
    building(b, R.helipad, { s: [[-24, SPAN]], w: [[-36, SPAN]], e: [[-30, SPAN]] });
    building(b, R.penthouse, { w: [[-6, SPAN], [8, 6]], n: [[-24, SPAN]], s: [[-34, SPAN]], e: [[6, SPAN]] });
    building(b, R.tanks, { n: [[-34, SPAN]], w: [[30, SPAN]], e: [[30, SPAN], [44, 4]] });
    building(b, R.office, { w: [[-30, SPAN]], e: [[-30, SPAN], [-44, 4]], s: [[-4, SPAN]] });

    // ---- Connections ----
    bridge(b, -46, -40, -6, 30);                                   // spawn → penthouse
    skyBridge(b, -46, -40, 8, 30);                                 // enclosed corridor, spawn → penthouse
    flight(b, -51, -18, SPAN, 8, 27, 30, 1);                       // spawn ↓ water tower
    flight(b, -51, 18, SPAN, 8, 24, 30, 3);                        // spawn ↓ billboard roof
    flight(b, -56, -36, 12, SPAN, 27, 33, 0);                      // water tower: stairs up to the helipad bridge
    b.box(-48, 27, -36, 4, 6, SPAN, 'concrete');                   // landing
    bridge(b, -46, -40, -36, 33);                                  // → helipad (A)
    flight(b, -24, -18, SPAN, 8, 30, 33, 3);                       // penthouse ↑ helipad
    flight(b, -25, 6, 10, SPAN, 30, 36, 0);                        // penthouse roof: stairs to the central bridge
    b.box(-18, 30, 6, 4, 6, SPAN, 'concrete');                     // landing
    bridge(b, -16, -10, 6, 36);                                    // → central tower (B)
    flight(b, -13, -30, 6, SPAN, 30, 33, 2);                       // helipad ↓ office
    flight(b, -4, -18, SPAN, 8, 30, 36, 1);                        // office ↑ central tower
    flight(b, -34, 18, SPAN, 8, 26, 30, 3);                        // tank roof ↑ penthouse
    flight(b, -43, 30, 6, SPAN, 24, 26, 0);                        // billboard roof ↑ tank roof
    flight(b, -13, 30, 6, SPAN, 26, 30, 0);                        // tank roof ↑ south office
    // A risky drop: from the south office roof onto the tank roof's balcony, 2.5 m out and 4 m down.
    b.box(-14.25, 25.6, 44, 3.5, 0.4, 4, 'floor');

    // ---- Spawn roof: walled courtyard behind the one-way team shield ----
    const s = R.spawn;
    b.box(-56, s.y, 0, 0.3, 7, 28, 'shield', 'energy', b.team(0));
    for (const x of [-66, -62, -58]) for (const z of [-10, -5, 0, 5, 10]) b.spawn(0, x, s.y, z, -Math.PI / 2);
    b.raw({ kind: 'spawnPad', team: b.team(0), ...b.at(-62, 0), y: s.y, rotY: b.rotation(-Math.PI / 2) });
    b.light(-63, s.y + 6, 0, b.mirroredSide ? 0xff5a4a : 0x58b6ff, 8, 24);
    b.box(-49, s.y, 1, 2.2, 1.5, 2.6, 'wallDark');                // AC units by the exits
    b.box(-53.5, s.y, -8, 2.2, 1.5, 2.2, 'wallDark');
    b.solidProp('Prop_Crate_Large', -48.5, s.y, 12, 0.2, 1.9, 1.3, 1.9);

    // ---- Water tower roof ----
    const t = R.tower;
    waterTank(b, -62, -28, t.y);
    b.box(-63, t.y, -45, 4, 0.9, 3, 'glass');                     // skylights
    b.box(-56, t.y, -45, 4, 0.9, 3, 'glass');
    b.box(-56, t.y, -26, 2.4, 1.5, 2.4, 'wallDark');
    b.mast(-65, t.y, -47, 16);
    b.light(-65, t.y + 16.5, -47, 0xff4a3a, 4, 18);

    // ---- Billboard roof ----
    const bb = R.board;
    for (const z of [27, 45]) b.box(-65, bb.y, z, 0.5, 5, 0.5, 'pillar');
    b.box(-65, bb.y + 5, 36, 0.6, 7, 20, 'wall');                 // the board itself
    b.box(-55, bb.y, 40, 3, 1.6, 2.4, 'wallDark');
    b.box(-59, bb.y, 28, 2.4, 1.6, 2.4, 'wallDark');
    b.solidProp('Prop_Crate_Tarp_Large', -52, bb.y, 46, 0.4, 2.2, 1.6, 2.2);

    // ---- A: helipad roof, a crashed gunship across the pad ----
    const h = R.helipad;
    b.box(-28, h.y, -36, 12, 0.12, 12, 'floor');                  // pad markings
    b.box(-33, h.y, -44, 7, 2.6, 3, 'container');                 // gunship fuselage
    b.box(-37.5, h.y, -44, 2, 1.6, 1.6, 'container');             // tail boom
    b.box(-22, h.y, -27, 4.4, 1.2, 0.9, 'concrete');
    b.box(-36, h.y, -27, 0.9, 1.2, 4.4, 'concrete');
    b.box(-20, h.y, -45, 2.4, 1.6, 2.4, 'wallDark');
    b.solidProp('Prop_Crate', -25, h.y, -47, 0.3, 1.2, 1.0, 1.2);
    b.light(-28, h.y + 4, -48, 0xfff1d0, 5, 16);

    // ---- Penthouse roof: an enterable top-floor suite ----
    const p = R.penthouse;
    b.bunker(-31, -4, 12, 10, {
      y: p.y, h: 3.6,
      doors: [['n', 0, 2.6], ['s', -3, 2.6], ['w', 0, 2.4], ['e', 2, 2.4]],
      windows: [['n', -4, 2], ['n', 4, 2], ['s', 3, 2.4], ['w', -3, 1.6], ['e', -2.5, 1.6]],
    });
    b.solidProp('Prop_Crate_Large', -33, p.y, -6, 0.2, 1.9, 1.3, 1.9);   // furniture inside
    b.box(-28, p.y, -2, 3.2, 0.9, 1.4, 'wallDark');
    b.light(-31, p.y + 3, -4, 0xffd9a0, 5, 10);
    b.box(-19, p.y, -11, 2.4, 1.5, 2.4, 'wallDark');
    b.box(-21, p.y, 11, 2.4, 1.5, 2.2, 'wallDark');

    // ---- Tank roof ----
    const k = R.tanks;
    waterTank(b, -24, 42, k.y);
    b.box(-32, k.y, 40, 4, 0.9, 3, 'glass');
    b.box(-36, k.y, 47, 3, 1.6, 2.4, 'wallDark');
    b.box(-21, k.y, 26, 4.4, 1.2, 0.9, 'concrete');
    b.solidProp('Prop_Barrel2_Closed', -38, k.y, 25, 0, 0.9, 1.2, 0.9);

    // ---- North office roof: a glass-walled office floor ----
    const o = R.office;
    b.bunker(0, -38, 14, 10, {
      y: o.y, h: 3.6, style: 'wallDark',
      doors: [['w', 0, 2.6], ['e', 0, 2.6], ['s', -3, 2.6], ['n', 3, 2.4]],
      windows: [['n', -3, 2.4], ['s', 3.5, 2.4], ['w', 3, 1.6], ['e', -3, 1.6]],
    });
    b.box(-2, o.y, -40, 2.8, 0.9, 1.4, 'wall');                   // desks
    b.box(2.5, o.y, -36, 2.8, 0.9, 1.4, 'wall');
    b.light(0, o.y + 3, -38, 0xcfe6ff, 5, 10);
    b.box(7.5, o.y, -25.5, 2.4, 1.5, 2.4, 'wallDark');

    // ---- The skyline beyond the play area ----
    const towers: [number, number, number, number, number][] = [
      [-94, -58, 16, 16, 62], [-98, -8, 14, 22, 92], [-92, 44, 18, 14, 50], [-56, -94, 22, 14, 80],
      [-12, -98, 16, 16, 108], [32, -94, 16, 16, 58], [-100, 92, 22, 22, 44], [-84, -96, 14, 14, 30],
    ];
    for (const [x, z, w, d, top] of towers) b.box(x, STREET - 2, z, w, top - STREET + 2, d, top > 70 ? 'wall' : 'wallDark');
    b.light(-12, 110, -98, 0xff4a3a, 6, 30);

    // ---- Ammo crates ----
    b.ammoCrate(-50, bb.y, 32);
  });

  // ---- B: the central tower, highest roof ----
  building(b, B, { n: [[-4, SPAN]], s: [[4, SPAN]], w: [[6, SPAN]], e: [[-6, SPAN]] });
  b.box(0, B.y, 0, 2.6, 2.4, 2.6, 'pillar');
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.box(sx * 7.5, B.y, sz * 11.6, 3.6, 1.15, 0.6, 'wallDark');  // corner cover
    b.box(sx * 8.9, B.y, sz * 10.5, 0.6, 1.15, 3.6, 'wallDark');
  }
  b.light(0, B.y + 1.8, -12.5, 0x7ff6ff, 5, 12);
  b.light(0, B.y + 1.8, 12.5, 0x7ff6ff, 5, 12);

  b.point('A', 'North Helipad', -28, R.helipad.y, -36, 8);
  b.point('B', 'Central Tower', 0, B.y, 0, 8);
  b.point('C', 'South Helipad', 28, R.helipad.y, 36, 8);

  return b.build();
}

type Openings = Partial<Record<Side, [number, number][]>>;

/** A tower from the street to roof height, with a 1.1 m parapet broken where routes land. */
function building(b: MapBuilder, r: Roof, open: Openings, opts: { courtyard?: boolean } = {}) {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, w = r.x1 - r.x0, d = r.z1 - r.z0;
  b.box(cx, STREET - 2, cz, w, r.y - 0.25 - STREET + 2, d, r.style);  // body stops under the roof slab
  b.box(cx, r.y - 0.25, cz, w, 0.25, d, 'floor');               // roof membrane
  const t = 0.4, h = 1.1;
  const run = (side: Side, from: number, to: number, fixed: number, height = h) => {
    const gaps = (open[side] ?? []).map(([c, gw]) => [c - gw / 2, c + gw / 2]).sort((a, c) => a[0] - c[0]);
    let cursor = from;
    const seg = (a: number, c: number) => {
      if (c - a < 0.05) return;
      if (side === 'n' || side === 's') b.box((a + c) / 2, r.y, fixed, c - a, height, t, 'concrete');
      else b.box(fixed, r.y, (a + c) / 2, t, height, c - a, 'concrete');
    };
    for (const [a, c] of gaps) { seg(cursor, a); cursor = Math.max(cursor, c); }
    seg(cursor, to);
  };
  // n/s walls span the full width; w/e walls fit between them.
  run('n', r.x0, r.x1, r.z0 + t / 2);
  run('s', r.x0, r.x1, r.z1 - t / 2);
  run('w', r.z0 + t, r.z1 - t, r.x0 + t / 2, opts.courtyard ? 3 : h);
  run('e', r.z0 + t, r.z1 - t, r.x1 - t / 2);
  if (opts.courtyard) {
    // Taller walls around the spawn courtyard (west of the shield at x = -56).
    b.box((r.x0 - 56) / 2, r.y + h, r.z0 + t / 2, -56 - r.x0, 3 - h, t, 'concrete');
    b.box((r.x0 - 56) / 2, r.y + h, r.z1 - t / 2, -56 - r.x0, 3 - h, t, 'concrete');
  }
}

/** Flat steel bridge across the street gap between x0 and x1, centred on z, with side rails. */
function bridge(b: MapBuilder, x0: number, x1: number, z: number, y: number) {
  const len = x1 - x0, cx = (x0 + x1) / 2;
  b.box(cx, y - 0.4, z, len, 0.4, SPAN, 'floor');
  b.box(cx, y, z - SPAN / 2 + 0.1, len, 1.1, 0.2, 'trim');
  b.box(cx, y, z + SPAN / 2 - 0.1, len, 1.1, 0.2, 'trim');
  b.box(cx, y - 1.2, z, len, 0.8, 0.6, 'trim');                // girder underneath
}

/** Enclosed sky-bridge: floor, glazed walls and a roof between two buildings. */
function skyBridge(b: MapBuilder, x0: number, x1: number, z: number, y: number) {
  const len = x1 - x0, cx = (x0 + x1) / 2, inner = 5.2;
  b.box(cx, y - 0.4, z, len, 0.4, inner + 0.8, 'floor');
  for (const side of [-1, 1]) {
    const wz = z + side * (inner / 2 + 0.2);
    b.box(cx, y, wz, len, 1.0, 0.4, 'wallDark');
    b.box(cx, y + 1.0, wz, len, 1.6, 0.25, 'glass');
    b.box(cx, y + 2.6, wz, len, 0.6, 0.4, 'wallDark');
  }
  b.box(cx, y + 3.2, z, len, 0.3, inner + 0.8, 'floor');
  b.light(cx, y + 2.7, z, 0xbfe2ff, 4, 8);
}

/**
 * Stair flight between two heights, rising toward `dir` (0 +X, 1 +Z, 2 -X, 3 -Z), with side plates
 * so nobody strafes off it.
 */
function flight(b: MapBuilder, x: number, z: number, w: number, d: number, y0: number, y1: number, dir: 0 | 1 | 2 | 3) {
  b.ramp(x, z, w, d, y0, y1, dir, 'stairs');
  // Stepped side rails that follow the slope: each segment spans its part of the flight.
  const alongX = dir === 0 || dir === 2, len = alongX ? w : d, n = Math.max(2, Math.ceil(len / 2));
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    // Height runs y0 → y1 toward `dir`; segment i covers [t0, t1] of the run from the low end.
    const lo = y0 + (y1 - y0) * t0 - 0.4, hi = y0 + (y1 - y0) * t1 + 1.1;
    const toward = dir === 0 || dir === 1 ? 1 : -1;
    const c = toward * (-len / 2 + len * (t0 + t1) / 2);
    for (const s of [-1, 1]) {
      if (alongX) b.box(x + c, lo, z + s * (d / 2 - 0.1), len / n, hi - lo, 0.2, 'trim');
      else b.box(x + s * (w / 2 - 0.1), lo, z + c, 0.2, hi - lo, len / n, 'trim');
    }
  }
}

/** Rooftop water tank on four legs. */
function waterTank(b: MapBuilder, x: number, z: number, y: number) {
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) b.box(x + sx * 1.6, y, z + sz * 1.6, 0.35, 2.4, 0.35, 'pillar');
  b.box(x, y + 2.4, z, 4.2, 3.6, 4.2, 'container');
}
