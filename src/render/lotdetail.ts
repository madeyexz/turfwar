import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../../shared/math';

/**
 * Facade depth and rooftops for a city's generic buildings (a dressing set's `lots`): over each
 * building's window grid, a floor ledge every storey, balconies and the iron window cages (鐵窗)
 * of Taipei walk-ups on the street faces, AC units under the windows, and on the roof the stair
 * house, water tanks on their stands, AC condensers, an antenna and, on some, a tin rooftop
 * addition (頂加) — the same rooftop furniture the source game's district builder puts up. All
 * visual (nobody reaches these roofs), seeded per building so every client agrees.
 */
export interface LotRow { x0: number; z0: number; x1: number; z1: number; ground: number; top: number; tint: number; floors: number; street: [boolean, boolean, boolean, boolean] }

const FLOOR_H = 3.2, BAY = 3.1;

export function lotDetail(lots: LotRow[], ox: number, oz: number) {
  const solid: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [];
  const add = (list: THREE.BufferGeometry[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
    g.translate((x0 + x1) / 2 - ox, (y0 + y1) / 2, (z0 + z1) / 2 - oz); g.deleteAttribute('uv');
    const c = new THREE.Color(hex), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    list.push(g);
  };
  const cyl = (x: number, y0: number, z: number, r: number, y1: number, hex: number) => {
    const g = new THREE.CylinderGeometry(r, r, y1 - y0, 10).toNonIndexed();
    g.translate(x - ox, (y0 + y1) / 2, z - oz); g.deleteAttribute('uv');
    const c = new THREE.Color(hex), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    solid.push(g);
  };
  for (const lot of lots) {
    const { x0, z0, x1, z1, ground, top, tint } = lot;
    const r = rng(Math.round(x0 * 31 + z0 * 17) >>> 0);
    const ledge = new THREE.Color(tint).multiplyScalar(0.82).getHex();
    const floors = Math.max(0, Math.floor((top - ground - 0.6) / FLOOR_H));
    // Each side: 0 north (z0), 1 east (x1), 2 south (z1), 3 west (x0); along runs a..b, outward normal.
    const sides = [
      { a: x0, b: x1, at: z0, n: -1, alongX: true }, { a: z0, b: z1, at: x1, n: 1, alongX: false },
      { a: x0, b: x1, at: z1, n: 1, alongX: true }, { a: z0, b: z1, at: x0, n: -1, alongX: false },
    ];
    const box = (list: THREE.BufferGeometry[], side: typeof sides[number], u0: number, u1: number, y0: number, y1: number, out0: number, out1: number, hex: number) => {
      const o0 = side.at + side.n * out0, o1 = side.at + side.n * out1;
      if (side.alongX) add(list, u0, y0, Math.min(o0, o1), u1, y1, Math.max(o0, o1), hex);
      else add(list, Math.min(o0, o1), y0, u0, Math.max(o0, o1), y1, u1, hex);
    };
    sides.forEach((side, k) => {
      const len = side.b - side.a, street = lot.street[k];
      // Floor ledges round every storey above the shopfront.
      for (let f = 1; f <= floors; f++) {
        const y = ground + (f - 1) * FLOOR_H;
        if (y > top - 1) break;
        box(solid, side, side.a - 0.12, side.b + 0.12, y - 0.12, y + 0.06, 0, 0.12, ledge);
      }
      if (!street || len < 3) return;
      // Bays on street faces: balcony slabs with railings, or iron cages over the windows; AC units.
      const bays = Math.max(1, Math.floor(len / BAY)), w = len / bays;
      for (let f = 1; f < floors; f++) {
        const y = ground + (f - 1) * FLOOR_H;
        if (y + FLOOR_H > top - 0.6) break;
        for (let i = 0; i < bays; i++) {
          const u0 = side.a + i * w + 0.25, u1 = side.a + (i + 1) * w - 0.25, roll = r();
          if (roll < 0.3) {
            // Balcony: slab, parapet and a few potted plants / laundry.
            box(solid, side, u0, u1, y, y + 0.15, 0, 0.9, ledge);
            box(solid, side, u0, u1, y + 0.15, y + 1.05, 0.82, 0.9, tint);
            if (r() < 0.5) box(dark, side, u0 + 0.3, u0 + 0.7, y + 0.15, y + 0.6, 0.3, 0.7, 0x3a6a32);
          } else if (roll < 0.7) {
            // Iron window cage (鐵窗): a frame standing 0.45 m out, bars front and sides, a tin hood.
            const yb = y + 0.75, yt = y + 2.55;
            box(dark, side, u0, u1, yb, yb + 0.05, 0, 0.45, 0x4a4e52);
            box(dark, side, u0, u1, yt, yt + 0.05, 0, 0.5, 0x4a4e52);
            for (let u = u0; u <= u1 + 1e-3; u += (u1 - u0) / Math.max(2, Math.round((u1 - u0) / 0.35))) box(dark, side, u - 0.012, u + 0.012, yb, yt, 0.43, 0.45, 0x55595e);
            box(dark, side, u0, u0 + 0.03, yb, yt, 0, 0.45, 0x4a4e52); box(dark, side, u1 - 0.03, u1, yb, yt, 0, 0.45, 0x4a4e52);
            box(solid, side, u0 - 0.05, u1 + 0.05, yt + 0.05, yt + 0.1, 0, 0.62, r() < 0.5 ? 0x7a9aa8 : 0xa8a49c);
          }
          if (r() < 0.35) {
            const u = u0 + (u1 - u0) * (0.2 + r() * 0.5);
            box(solid, side, u, u + 0.8, y + 0.35, y + 0.95, 0, 0.32, 0xe8e8e2);
            box(dark, side, u + 0.15, u + 0.65, y + 0.45, y + 0.85, 0.32, 0.33, 0x5a5e62);
          }
        }
      }
    });
    // ---- Rooftop (as the source's district roofs) ----
    const W = x1 - x0, D = z1 - z0, m = 1.1;
    if (W < 4 || D < 4) continue;
    // Parapet.
    for (const k of [0, 1, 2, 3]) box(solid, sides[k], sides[k].a, sides[k].b, top, top + 0.9, -0.2, 0, tint);
    // Stair house in a corner.
    const sw = Math.min(3.2, W * 0.3), sd = Math.min(3.4, D * 0.3);
    const sx = r() < 0.5 ? x0 + m : x1 - m - sw, sz = r() < 0.5 ? z0 + m : z1 - m - sd;
    add(solid, sx, top, sz, sx + sw, top + 2.8, sz + sd, new THREE.Color(tint).multiplyScalar(0.92).getHex());
    add(solid, sx - 0.15, top + 2.8, sz - 0.15, sx + sw + 0.15, top + 3, sz + sd + 0.15, 0xa8a49c);
    // Water tanks on steel stands (blue fibreglass or steel), one or two.
    for (let t = 0; t < (W * D > 260 ? 2 : 1); t++) {
      const tx = x0 + m + 1 + r() * (W - 2 * m - 2), tz = z0 + m + 1 + r() * (D - 2 * m - 2);
      if (Math.abs(tx - sx - sw / 2) < sw && Math.abs(tz - sz - sd / 2) < sd) continue;
      for (const [dx, dz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) add(dark, tx + dx - 0.05, top, tz + dz - 0.05, tx + dx + 0.05, top + 1, tz + dz + 0.05, 0x5a5e62);
      add(dark, tx - 0.7, top + 0.95, tz - 0.7, tx + 0.7, top + 1.02, tz + 0.7, 0x5a5e62);
      const blue = r() < 0.35;
      cyl(tx, top + 1.02, tz, 0.72, top + 2.5, blue ? 0x3a6ab8 : 0xc8c8c8);
    }
    // A row of AC condensers along one edge.
    const n = 2 + Math.floor(r() * 3), az = r() < 0.5 ? z0 + 0.6 : z1 - 1.2, ax = x0 + m + r() * Math.max(0.1, W - 2 * m - n * 1.1);
    for (let i = 0; i < n; i++) { const x = ax + i * 1.1; if (x > x1 - m) break; add(solid, x, top, az, x + 0.9, top + 0.65, az + 0.55, 0xe8e8e2); }
    // Antenna.
    if (r() < 0.6) { const x = x0 + m + r() * (W - 2 * m), z = z0 + m + r() * (D - 2 * m); add(dark, x - 0.025, top, z - 0.025, x + 0.025, top + 3.2, z + 0.025, 0x8a8e92); add(dark, x - 0.5, top + 2.6, z - 0.012, x + 0.5, top + 2.62, z + 0.012, 0x8a8e92); }
    // Tin rooftop addition on some walk-ups.
    if (lot.floors <= 6 && W > 8 && D > 8 && r() < 0.5) {
      const tw = W * (0.45 + r() * 0.2), td = D * (0.4 + r() * 0.2), tx = r() < 0.5 ? x0 + 0.3 : x1 - 0.3 - tw, tz = r() < 0.5 ? z0 + 0.3 : z1 - 0.3 - td;
      const tin = [0xa8c0d0, 0xd8d8d0, 0xb8a888, 0x8aa8b8][Math.floor(r() * 4)];
      add(solid, tx, top, tz, tx + tw, top + 2.6, tz + td, tin);
      add(solid, tx - 0.3, top + 2.6, tz - 0.3, tx + tw + 0.3, top + 2.8, tz + td + 0.3, new THREE.Color(tin).multiplyScalar(0.85).getHex());
    }
  }
  const group = new THREE.Group();
  group.name = 'dressing:lots';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 });
  if (solid.length) { const m = new THREE.Mesh(mergeGeometries(solid, false)!, mat); m.castShadow = m.receiveShadow = true; m.name = 'lots:detail'; group.add(m); }
  if (dark.length) { const m = new THREE.Mesh(mergeGeometries(dark, false)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 })); m.castShadow = true; m.name = 'lots:metal'; group.add(m); }
  return group;
}
