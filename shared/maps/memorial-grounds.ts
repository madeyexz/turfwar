import { C, type Kit, type R } from './memorial-kit';

/**
 * Memorial Hall's grounds (memorial.ts): the slice of Liberty Square west of the grand staircase
 * (Militia's base) and the east forecourt (SWAT's), each closed off from the gardens by white
 * screen walls with gateways; the paved apron round the base; and the gardens north and south,
 * laid out as rooms of clipped hedge (each hedge wall open at one end, the next at the other) with
 * pines, a pavilion and a lotus pond. Tree crowns are solid: dense foliage stops a bullet and a view.
 * The north and south sides mirror each other, so both flanks play alike.
 */

/** Pine (variant 0) or broad-leaved tree (variant 1) whose trunk and crown are cover. */
export function tree(k: Kit, x: number, z: number, scale = 1, variant = 0) {
  k.b.tree(x, z, scale, variant);
  if (variant === 1) k.block([x - 2 * scale, z - 2 * scale, x + 2 * scale, z + 2 * scale], 4.4 * scale, 6.9 * scale, 'dirt');
  else k.block([x - 1.35 * scale, z - 1.35 * scale, x + 1.35 * scale, z + 1.35 * scale], 3.5 * scale, 8.4 * scale, 'dirt');
}

/** Lamp standard: a dark pole with a lantern (the pole is a thin collider). */
function lamp(k: Kit, x: number, z: number, y = 0, h = 4.6) {
  k.b.raw({ kind: 'cylinder', x, y, z, radius: 0.11, height: h, axis: 'y', style: 'painted', color: 0x2a2c30 });
  k.block([x - 0.15, z - 0.15, x + 0.15, z + 0.15], y, y + h);
  k.shape([x - 0.3, z - 0.3, x + 0.3, z + 0.3], y + h, y + h + 0.6, 'neon', 0xffe2b0);
  k.shape([x - 0.38, z - 0.38, x + 0.38, z + 0.38], y + h + 0.6, y + h + 0.72, 'painted', 0x2a2c30);
}

/** Clipped hedge (solid). */
function hedge(k: Kit, r: R, h = 2.6) { k.box(r, 0, h, 'hedge', C.hedge); }

/** Stone bench (knee-high cover). */
function bench(k: Kit, r: R) { k.box(r, 0, 0.48, 'painted', C.marbleShade); }

/** White screen wall with a blue-tiled coping along x at z (0.8 m thick), with 3 m gateways at `gates`. */
function screen(k: Kit, z: number, x0: number, x1: number, gates: number[]) {
  const h = 4;
  k.wall('x', z, x0, x1, 0, h, gates.map(at => ({ at, width: 3, top: 3.1 })), 'painted', C.marble);
  for (const [a, c] of spans(x0, x1, gates)) {
    k.shape([a, z - 0.6, c, z + 0.6], h, h + 0.22, 'painted', C.blueDeep);
    k.shape([a, z - 0.25, c, z + 0.25], h + 0.22, h + 0.45, 'painted', C.blue);
    k.shape([a, z - 0.42, c, z + 0.42], 0, 0.45, 'painted', 0xb8b2a8);
  }
  for (const g of gates) {
    k.shape([g - 1.8, z - 0.6, g + 1.8, z + 0.6], 3.1, 3.4, 'painted', C.red);
    k.shape([g - 2.1, z - 0.8, g + 2.1, z + 0.8], h + 0.45, h + 0.75, 'painted', C.blueDeep);
    k.shape([g - 1.6, z - 0.45, g + 1.6, z + 0.45], h + 0.75, h + 1.1, 'painted', C.blue);
  }
}
function spans(a: number, c: number, gates: number[]): [number, number][] {
  const out: [number, number][] = [];
  let cursor = a;
  for (const g of [...gates].sort((p, q) => p - q)) { out.push([cursor, g - 1.5]); cursor = g + 1.5; }
  out.push([cursor, c]);
  return out;
}

export function plazas(k: Kit) {
  // Paving: Liberty Square's slice (west), the forecourt (east) and the apron round the base.
  k.shape([-71, -14.6, -45.75, 14.6], -0.04, 0.03, 'paving', C.plaza);
  k.shape([-71, -2.5, -49.75, 2.5], -0.03, 0.035, 'paving', 0xa8a094);
  k.shape([40.75, -14.6, 59, 14.6], -0.04, 0.03, 'paving', C.plaza);
  for (const r of [[-45.75, -38.25, 40.75, -34.25], [-45.75, 34.25, 40.75, 38.25], [-45.75, -34.25, -41.75, 34.25], [36.75, -34.25, 40.75, 34.25]] as R[]) {
    k.shape(r, -0.035, 0.032, 'paving', C.granite);
  }
  // One gateway in each screen wall, at the far end behind the base: no long view runs out
  // through it (whatever lines up with a gateway ends a metre or two past it, at the bounds).
  for (const s of [-1, 1]) {
    screen(k, s * 15, -71, -41.75, [-69]);
    screen(k, s * 15, 36.75, 59, [57.5]);
  }

  // ---- Liberty Square (Militia's base): lamps, sandbags and supplies either side of the slots ----
  for (const s of [-1, 1]) {
    for (const x of [-69, -61, -53]) lamp(k, x, s * 11.25);
    lamp(k, -47.5, s * 8.75);
    const sb: R = s < 0 ? [-58, -11.6, -55.5, -10.4] : [-58, 10.4, -55.5, 11.6];
    k.box(sb, 0, 1.15, 'painted', 0xb8a27a);
    for (let x = sb[0] + 0.05; x < sb[2] - 0.1; x += 0.62) k.shape([x, sb[1] - 0.03, x + 0.56, sb[3] + 0.03], 0.35, 0.42, 'painted', 0x9a865e);
    k.b.crate(-66, 0, s * 9, 1.5, 1.5, 1.5, 0x8a7a5a);
    k.b.crate(-66, 1.5, s * 9, 1.1, 1.1, 1.1, 0x8a7a5a);
    k.b.crate(-63.5, 0, s * 9.4, 1.3, 1.1, 1.3, 0x6a7a4a);
  }
  // Rows of pines inside the screen walls (their crowns close the views over the walls).
  for (const s of [-1, 1]) {
    for (const x of [-64, -58.25, -55, -51.75, -48.5, -45.25, -42.75]) tree(k, x, s * 12.75, 1, 0);
    for (const x of [38.75, 42, 45.25, 48.5, 51.75]) tree(k, x, s * 12.75, 1, 0);
  }
  // A marble lantern pillar in the middle of the base.
  k.box([-63.2, -0.7, -61.8, 0.7], 0, 0.9, 'painted', C.marbleShade);
  k.box([-62.9, -0.4, -62.1, 0.4], 0.9, 3.2, 'painted', C.marble);
  k.shape([-63.05, -0.55, -61.95, 0.55], 3.2, 3.8, 'neon', 0xffe2b0);
  k.shape([-63.3, -0.8, -61.7, 0.8], 3.8, 4.0, 'painted', C.blueDeep);

  // ---- East forecourt (SWAT's base): police vans and the command post ----
  for (const s of [-1, 1]) {
    const z0 = s < 0 ? -11.6 : 9.2, z1 = s < 0 ? -9.2 : 11.6;
    const v0 = 39.5, v1 = 45.5;
    k.box([v0, z0, v1, z1], 0.35, 2.5, 'painted', 0xf0f2f4);
    k.shape([v0, z0 - 0.02, v1, z1 + 0.02], 1.0, 1.4, 'painted', 0x1a3a7a);
    k.shape([v0 - 0.05, z0 + 0.1, v0 + 0.1, z1 - 0.1], 1.5, 2.2, 'glass');
    k.shape([v0 + 1.8, z0 + 0.3, v0 + 3, z1 - 0.3], 2.5, 2.65, 'neon', s < 0 ? 0xff3030 : 0x3060ff);
    k.block([v0, z0, v1, z1], 0, 0.35, 'metal');
    for (const x of [v0 + 1, v1 - 1]) for (const z of [z0 + 0.25, z1 - 0.6]) k.b.raw({ kind: 'cylinder', x, y: 0, z: z + 0.17, radius: 0.36, height: 0.34, axis: 'z', style: 'painted', color: 0x1a1a1a });
    lamp(k, 52.5, s * 8.75);
    // Spirit screens just inside the gateways (照壁): no straight view through a gate.
    for (const [x0, x1] of [[-71, -68.5], [57, 59]]) {
      k.box([x0, s * 12.25 - 0.4, x1, s * 12.25 + 0.4], 0, 2.6, 'painted', C.marble);
      k.shape([x0, s * 12.25 - 0.55, x1, s * 12.25 + 0.55], 2.6, 2.85, 'painted', C.blueDeep);
      k.shape([x0 + 0.4, s * 12.25 - 0.42, x1 - 0.4, s * 12.25 + 0.42], 0.8, 2.1, 'painted', C.red);
    }
  }
  k.box([57.4, -2.4, 58.6, 2.4], 0, 2.6, 'painted', 0x1a3a7a);
  k.shape([57.35, -2.2, 57.4, 2.2], 2.0, 2.5, 'neon', 0xffffff);
}

export function gardens(k: Kit) {
  for (const s of [-1, 1]) {
    // North side as written; the south mirrors it in z.
    const r = (x0: number, za: number, x1: number, zc: number): R => s < 0 ? [x0, za, x1, zc] : [x0, -zc, x1, -za];
    const z = (v: number) => s * -v;

    // ---- North-west garden (between Liberty Square's screen wall and the precinct wall) ----
    for (const [x0, x1, za, zc] of [[-58.5, -51.5, -26.5, -19.5], [-69.5, -63.5, -26.5, -19.5]]) {
      k.box(r(x0, za, x1, zc), 0, 0.5, 'painted', C.marbleShade);
      k.box(r(x0 + 0.4, za + 0.4, x1 - 0.4, zc - 0.4), 0.5, 1.15, 'hedge', C.hedge);
    }
    hedge(k, r(-71, -31.85, -44.75, -30.65), 4.5);
    hedge(k, r(-56.85, -48.5, -55.65, -35), 4);
    for (const [x, zz, v] of [[-67, 46.25, 0], [-61, 41, 1], [-49, 46.25, 0], [-64, 35.5, 0], [-50.5, 35, 1], [-45, 18.5, 0], [-61, 17.75, 0], [-66.5, 25.75, 1], [-69, 38, 0], [-58.5, 34.5, 0], [-44.5, 41, 1], [-52.5, 18, 0], [-68, 18.5, 0], [-47, 27.5, 0], [-60, 28.75, 0]]) tree(k, x, z(zz), v ? 0.85 : 1, v);
    k.shape(r(-71, -36.25, -41.75, -33.75), -0.03, 0.026, 'paving', 0xd8ccb0);

    // ---- North band (along the base): hedge rooms, each wall open near one end, the next near the other ----
    const across = (x: number, z0: number, z1: number, gap: number) => {
      const [a, c] = s < 0 ? [z0, z1] : [-z1, -z0];
      k.wall('z', x, a, c, 0, 4.5, [{ at: s * gap, width: 3.5, top: 4.5 }], 'hedge', C.hedge, 1.2);
    };
    across(-36.25, -48.5, -34.25, 45);
    across(-23.75, -48.5, -34.25, 39.25);
    across(1.25, -48.5, -34.25, 45);
    across(18.75, -48.5, -34.25, 39.25);
    across(40, -48.5, -15.4, 45);
    // Low beds along the apron (knee-high cover).
    for (const [x0, x1] of [[-34.5, -26], [-21.5, -16.5], [21.5, 26], [31.5, 37.5]]) k.box(r(x0, -41.2, x1, -40.4), 0, 0.9, 'hedge', C.hedge);
    for (const [x0, x1, c] of [[-34, -26.5, 0xd04a5a], [31.75, 37, 0xd04a5a]] as [number, number, number][]) k.shape(r(x0, -40.35, x1, -39.55), 0, 0.45, 'painted', c);
    // Pines along the precinct wall, broad trees by the apron.
    for (const x of [-41, -30.5, -19.5, -4, 6.5, 13, 23, 37.5]) tree(k, x, z(46.25), 1.0, 0);
    for (const x of [-29.5, 8.5, 27.5]) tree(k, x, z(38.5), 0.8, 1);
    tree(k, -44.5, z(37), 1, 0);
    // Rockeries (假山): scholar's rocks piled in the middle of two rooms.
    for (const [x0, z0, x1, z1, h] of [[7.25, -43, 10.25, -40.25, 2.7], [-21.5, -45.25, -18.75, -42.75, 2.4], [27, -41.1, 29.25, -39.9, 2.8]]) {
      k.box(r(x0, z0, x1, z1), 0, h, 'rock');
      k.box(r(x0 + 0.5, z0 + 0.6, x1 - 0.9, z1 - 0.4), h, h + 0.9, 'rock');
    }
    // Pavilion: an octagonal kiosk on a platform, eight red columns under a blue roof, a stone table inside.
    const px = -11.25, pz = z(43.25);
    k.box([px - 3.6, pz - 3.6, px + 3.6, pz + 3.6], 0, 0.4, 'painted', C.marbleShade);
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) / 8 * Math.PI * 2, cx = px + Math.cos(a) * 3, cz = pz + Math.sin(a) * 3;
      k.box([cx - 0.25, cz - 0.25, cx + 0.25, cz + 0.25], 0.4, 3.6, 'painted', C.red);
    }
    k.b.raw({ kind: 'cylinder', x: px, y: 3.6, z: pz, radius: 4.6, height: 0.35, axis: 'y', style: 'painted', color: C.blueDeep, sides: 8 });
    k.b.raw({ kind: 'cylinder', x: px, y: 3.95, z: pz, radius: 4.6, height: 2.2, axis: 'y', style: 'painted', color: C.blue, sides: 8, top: 0.4 });
    k.b.raw({ kind: 'ball', x: px, y: 6.4, z: pz, radius: 0.35, style: 'painted', color: C.gold });
    k.b.raw({ kind: 'cylinder', x: px, y: 0.4, z: pz, radius: 0.9, height: 0.75, axis: 'y', style: 'painted', color: C.marble, sides: 8 });
    k.block([px - 0.7, pz - 0.7, px + 0.7, pz + 0.7], 0.4, 1.15);
    // Lotus pond with a fountain.
    const pr = r(24, -46.5, 36, -41.25);
    for (const e of [[pr[0], pr[1], pr[2], pr[1] + 0.4], [pr[0], pr[3] - 0.4, pr[2], pr[3]], [pr[0], pr[1] + 0.4, pr[0] + 0.4, pr[3] - 0.4], [pr[2] - 0.4, pr[1] + 0.4, pr[2], pr[3] - 0.4]] as R[]) {
      k.box(e, 0, 0.5, 'painted', C.marbleShade);
    }
    k.b.water((pr[0] + pr[2]) / 2, 0.3, (pr[1] + pr[3]) / 2, pr[2] - pr[0] - 0.8, pr[3] - pr[1] - 0.8);
    const fx = (pr[0] + pr[2]) / 2, fz = (pr[1] + pr[3]) / 2;
    k.box([fx - 0.9, fz - 0.9, fx + 0.9, fz + 0.9], 0, 0.9, 'painted', C.marble);
    k.b.raw({ kind: 'cylinder', x: fx, y: 0.9, z: fz, radius: 0.35, height: 1.1, axis: 'y', style: 'painted', color: C.marble, sides: 8 });
    k.b.raw({ kind: 'cylinder', x: fx, y: 2.0, z: fz, radius: 1.0, height: 0.25, axis: 'y', style: 'painted', color: C.marble, sides: 8, top: 0.7 });
    for (const [ox, oz] of [[-3.5, -1.2], [-2.2, 1.4], [3.1, 0.9], [4.2, -1.5], [-4.6, 1.8]]) {
      k.b.raw({ kind: 'disc', x: fx + ox, y: 0.32, z: fz + oz, nx: 0, ny: 1, nz: 0, rx: 0.45, ry: 0.45, depth: 0.02, style: 'painted', color: 0x4a7a3a });
    }
    // Gravel paths across the rooms, benches and lamps.
    for (const [x0, x1] of [[-36.25, -23.75], [-23.75, 1.25], [1.25, 18.75], [18.75, 40]]) k.shape(r(x0, -47, x1, -45.25), -0.03, 0.026, 'paving', 0xd8ccb0);
    for (const x of [-31.25, 13.75]) bench(k, r(x - 1.2, -44.6, x + 1.2, -44));
    for (const x of [-42.5, -17.5, 6.25, 31.25]) lamp(k, x, z(38.75));

    // ---- North-east garden (behind the east forecourt's screen wall) ----
    hedge(k, r(44.15, -31.85, 59, -30.65), 4);
    for (const [x, zz, v] of [[45, 46.25, 0], [53, 46.25, 0], [50, 38, 1], [57, 24, 0], [47.5, 22.5, 1], [44, 35, 0], [51, 18.5, 0], [44.5, 18.5, 0], [57.5, 40, 0], [42.5, 41.5, 0], [52.5, 33, 0], [55.5, 17.75, 0], [43, 26, 0]]) tree(k, x, z(zz), v ? 0.85 : 1, v);
    k.box(r(50.5, -27, 56.5, -20), 0, 0.5, 'painted', C.marbleShade);
    k.box(r(50.9, -26.6, 56.1, -20.4), 0.5, 1.15, 'hedge', C.hedge);
    lamp(k, 42.5, z(21.25));
  }
}
