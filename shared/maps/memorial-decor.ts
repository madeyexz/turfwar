import { C, type Kit, type R } from './memorial-kit';
import type { BlockStyle } from './types';

/**
 * Memorial Hall's set dressing (memorial.ts): the memorial chamber (the seated bronze statue on
 * its plinth, the inscription panels, the coffered ceiling with the sun emblem, the open bronze
 * doors, the honour-guard posts and the rope lines), the blue glazed octagonal roof, the facades,
 * and the backdrop past the bounds: the precinct walls with their covered walkways, Liberty Square
 * with the National Theater, the National Concert Hall and the gate, and the city beyond.
 * Purely visual except where a collision box is placed with a piece (the statue, the plinth, the
 * doors, the rope lines and the lamp urns, which are cover).
 */
const H = 13.5, CEIL = 29, WALL_TOP = 31;

type Cyl = { x: number; y: number; z: number; radius: number; height: number; style?: BlockStyle; color: number; sides?: number; top?: number; axis?: 'x' | 'y' | 'z' };
function cyl(k: Kit, c: Cyl) {
  k.b.raw({ kind: 'cylinder', x: c.x, y: c.y, z: c.z, radius: c.radius, height: c.height, axis: c.axis ?? 'y', style: c.style ?? 'painted', color: c.color, ...(c.sides ? { sides: c.sides } : {}), ...(c.top !== undefined ? { top: c.top } : {}) });
}
function ball(k: Kit, x: number, y: number, z: number, radius: number, color: number) {
  k.b.raw({ kind: 'ball', x, y, z, radius, style: 'painted', color });
}
/** A disc facing down (ceiling ornaments): ellipse rx × ry, its long axis turned to `angle` (radians from +x toward +z). */
function ceilingDisc(k: Kit, x: number, y: number, z: number, rx: number, ry: number, angle: number, color: number, style: BlockStyle = 'painted') {
  // The renderer lays the ellipse's long axis along (sin a, 0, -cos a) for a normal tilted toward a;
  // a tilt of 0.02 rad is invisible.
  const a = angle + Math.PI / 2, e = 0.02;
  k.b.raw({ kind: 'disc', x, y, z, nx: e * Math.cos(a), ny: -Math.sqrt(1 - e * e), nz: e * Math.sin(a), rx, ry, depth: 0.05, style, color });
}

// ---- The memorial chamber ------------------------------------------------------------------------
export function chamber(k: Kit) {
  statue(k);
  inscriptions(k);
  ceiling(k);
  doors(k);
  guards(k);
  // A red carpet from the bronze doors to the rope line.
  k.shape([-13, -1.6, 6, 1.6], H + 0.03, H + 0.05, 'painted', C.red);
  k.shape([-13, -1.75, 6, -1.6], H + 0.03, H + 0.051, 'painted', C.gold);
  k.shape([-13, 1.6, 6, 1.75], H + 0.03, H + 0.051, 'painted', C.gold);
  // Warm cove lights round the top of the walls, and a skirting of dark marble.
  for (const [r, sk] of [[[-12.95, -13, 12.95, -12.85], [-13, -13, 13, -12.9]], [[-12.95, 12.85, 12.95, 13], [-13, 12.9, 13, 13]], [[-13, -12.95, -12.85, 12.95], [-13, -13, -12.9, 13]], [[12.85, -12.95, 13, 12.95], [12.9, -13, 13, 13]]] as [R, R][]) {
    k.shape(r, CEIL - 0.5, CEIL - 0.38, 'neon', 0xffc070);
    k.shape(sk, H, H + 0.35, 'painted', 0x8a8478);
  }
  k.b.light(9, H + 9.5, 0, 0xffd29a, 6, 18);
  k.b.light(-6, CEIL - 1.5, 0, 0xffe0b0, 5, 24);
}

/** The seated bronze statue on its marble plinth, facing the doors (west). A simple, dignified figure. */
function statue(k: Kit) {
  const B = C.bronze, D = C.bronzeDark;
  // Plinth: a step, the marble block and a dark band; collision for both.
  k.box([7.8, -3.6, 8.6, 3.6], H, H + 0.3, 'painted', C.marbleShade);
  k.box([8.5, -3.25, 13, 3.25], H, H + 2, 'painted', C.marble);
  k.shape([8.45, -3.3, 13, 3.3], H + 1.7, H + 2.05, 'painted', 0x8a8478);
  k.shape([8.45, -3.3, 13, 3.3], H + 0.05, H + 0.25, 'painted', 0x8a8478);
  const y = H + 2;
  k.block([8.0, -1.95, 12.4, 1.95], y, y + 6.6, 'metal');
  // Chair: back, arms, seat.
  k.shape([11.6, -1.9, 12.35, 1.9], y, y + 5.1, 'painted', D);
  k.shape([11.55, -1.7, 11.65, 1.7], y + 4.6, y + 5.0, 'painted', C.gold);
  for (const s of [-1, 1]) k.shape([9.3, s < 0 ? -1.95 : 1.5, 11.6, s < 0 ? -1.5 : 1.95], y, y + 2.45, 'painted', D);
  // Robe: seat block, lap, the hem falling to the feet.
  k.shape([9.2, -1.5, 11.6, 1.5], y, y + 1.9, 'painted', B);
  k.shape([8.35, -1.3, 11.3, 1.3], y + 1.55, y + 2.35, 'painted', B);
  k.shape([8.35, -1.25, 9.45, 1.25], y, y + 1.9, 'painted', B);
  for (const s of [-1, 1]) k.shape([7.95, s < 0 ? -1.05 : 0.3, 8.6, s < 0 ? -0.3 : 1.05], y, y + 0.35, 'painted', D);
  // Torso (a long gown), shoulders, neck and head.
  cyl(k, { x: 10.6, y: y + 2.2, z: 0, radius: 1.3, height: 2.5, color: B, sides: 10, top: 1.05 });
  k.shape([9.95, -1.45, 11.25, 1.45], y + 4.35, y + 4.85, 'painted', B);
  cyl(k, { x: 10.55, y: y + 4.8, z: 0, radius: 0.36, height: 0.45, color: B, sides: 10 });
  ball(k, 10.45, y + 5.75, 0, 0.62, B);
  // Arms: upper arms down the sides, forearms along the chair's arms, hands at their ends.
  for (const s of [-1, 1]) {
    k.shape([9.85, s < 0 ? -1.75 : 1.2, 11.05, s < 0 ? -1.2 : 1.75], y + 2.7, y + 4.6, 'painted', B);
    k.shape([8.75, s < 0 ? -1.85 : 1.3, 10.4, s < 0 ? -1.3 : 1.85], y + 2.35, y + 2.85, 'painted', B);
    ball(k, 8.8, y + 2.6, s * 1.55, 0.28, B);
  }
}

/** Inscription panels: the wall behind the statue and the two side walls, gold "characters" in columns (not legible text). */
function inscriptions(k: Kit) {
  // Behind the statue: a dark marble panel with three pairs of large gold characters.
  k.shape([12.89, -3.3, 12.95, 3.3], 22.4, 27.4, 'painted', 0x23262c);
  k.shape([12.95, -3.45, 12.99, 3.45], 22.25, 27.55, 'painted', C.gold);
  for (let i = 0; i < 6; i++) {
    const z = -2.75 + i * 1.1 + (i >= 2 ? 0.25 : 0) + (i >= 4 ? 0.25 : 0) - 0.25;
    k.shape([12.86, z - 0.4, 12.88, z + 0.4], 24.4, 25.2, 'painted', C.gold);
  }
  // Side walls: columns of small characters, read top to bottom, on a warm panel with a gold border.
  for (const s of [-1, 1]) {
    const face = s * 13, out = -s * 0.04, zz = (o: number): [number, number] => [Math.min(face, face + o), Math.max(face, face + o)];
    const [p, q] = zz(out), [p2, q2] = zz(out * 1.5), [p3, q3] = zz(out * 2);
    k.shape([-11, p, 11, q], 20.5, 27.5, 'painted', 0xece4d4);
    k.shape([-11.15, p2, -11, q2], 20.35, 27.65, 'painted', C.gold);
    k.shape([11, p2, 11.15, q2], 20.35, 27.65, 'painted', C.gold);
    k.shape([-11.15, p2, 11.15, q2], 27.5, 27.65, 'painted', C.gold);
    k.shape([-11.15, p2, 11.15, q2], 20.35, 20.5, 'painted', C.gold);
    for (let col = 0; col < 24; col++) {
      const x = -10.3 + col * 0.9;
      const rows = 12 - ((col * 5) % 5);
      for (let r = 0; r < rows; r++) {
        const top = 26.9 - r * 0.52;
        k.shape([x - 0.17, p3, x + 0.17, q3], top - 0.34, top, 'painted', C.gold);
      }
    }
  }
}

/** Coffered ceiling with the sun emblem in a blue roundel at its centre. */
function ceiling(k: Kit) {
  const y = CEIL;
  k.shape([-13, -13, 13, 13], y - 0.06, y, 'painted', 0xf4f0e6);
  // Beams on a 2.6 m grid: the coffers between them, each with a gold rim.
  for (let i = -5; i <= 5; i++) {
    const p = i * 2.6;
    k.shape([p - 0.18, -13, p + 0.18, 13], y - 0.5, y - 0.06, 'painted', 0xe8e0cc);
    k.shape([-13, p - 0.18, 13, p + 0.18], y - 0.52, y - 0.06, 'painted', 0xe8e0cc);
    k.shape([p - 0.2, -13, p - 0.18, 13], y - 0.3, y - 0.06, 'painted', C.gold);
    k.shape([-13, p - 0.2, 13, p - 0.18], y - 0.3, y - 0.06, 'painted', C.gold);
  }
  // Emblem: blue roundel, twelve white rays, a blue ring and the white sun.
  const ey = y - 0.56;
  k.b.raw({ kind: 'disc', x: 0, y: ey, z: 0, nx: 0, ny: -1, nz: 0, rx: 3.6, ry: 3.6, depth: 0.05, style: 'painted', color: C.gold });
  k.b.raw({ kind: 'disc', x: 0, y: ey - 0.03, z: 0, nx: 0, ny: -1, nz: 0, rx: 3.4, ry: 3.4, depth: 0.05, style: 'painted', color: 0x1f4aa0 });
  for (let i = 0; i < 6; i++) ceilingDisc(k, 0, ey - 0.07, 0, 2.7, 0.34, (i / 6) * Math.PI + Math.PI / 12, 0xf8f8f8);
  k.b.raw({ kind: 'disc', x: 0, y: ey - 0.11, z: 0, nx: 0, ny: -1, nz: 0, rx: 1.3, ry: 1.3, depth: 0.05, style: 'painted', color: 0x1f4aa0 });
  k.b.raw({ kind: 'disc', x: 0, y: ey - 0.15, z: 0, nx: 0, ny: -1, nz: 0, rx: 1.1, ry: 1.1, depth: 0.05, style: 'painted', color: 0xf8f8f8 });
}

/** The tall bronze doors, swung open into the chamber (cover either side of the doorway). */
function doors(k: Kit) {
  for (const s of [-1, 1]) {
    const r: R = s < 0 ? [-13, -3.3, -10.1, -3.05] : [-13, 3.05, -10.1, 3.3];
    k.box(r, H, H + 9.9, 'painted', C.bronze);
    // Panels and studs on both faces.
    for (const f of [r[1] - 0.02, r[3]]) {
      for (const [y0, y1] of [[H + 0.6, H + 3.6], [H + 4.2, H + 7.2], [H + 7.8, H + 9.4]]) {
        k.shape([-12.7, f, -10.4, f + 0.02], y0, y1, 'painted', C.bronzeDark);
      }
      for (let yy = H + 1.2; yy < H + 9.4; yy += 1.2) for (let xx = -12.4; xx < -10.4; xx += 0.6) k.shape([xx - 0.06, f - 0.01, xx + 0.06, f + 0.03], yy, yy + 0.12, 'painted', C.gold);
    }
  }
}

/** Honour-guard posts flanking the statue (empty platforms: no figures), and the rope line before the plinth. */
function guards(k: Kit) {
  for (const s of [-1, 1]) {
    k.box([6.3, s * 4.5 - 0.7, 7.7, s * 4.5 + 0.7], H, H + 0.25, 'wood', C.woodDark);
    k.shape([6.25, s * 4.5 - 0.75, 7.75, s * 4.5 + 0.75], H + 0.2, H + 0.27, 'painted', C.gold);
  }
  // Rope line: brass posts and red ropes across the front of the plinth and along its sides (low cover).
  const posts: [number, number][] = [];
  for (let z = -3.25; z <= 3.26; z += 1.625) posts.push([6.25, z]);
  for (const s of [-1, 1]) posts.push([7.0, s * 3.25], [7.75, s * 3.25]);
  for (const [x, z] of posts) {
    cyl(k, { x, y: H, z, radius: 0.07, height: 0.95, color: C.gold });
    ball(k, x, H + 0.98, z, 0.08, C.gold);
    k.b.raw({ kind: 'cylinder', x, y: H, z, radius: 0.18, height: 0.04, axis: 'y', style: 'painted', color: C.gold });
  }
  k.shape([6.2, -3.25, 6.3, 3.25], H + 0.78, H + 0.84, 'painted', C.red);
  for (const s of [-1, 1]) k.shape([6.25, s * 3.25 - 0.05, 7.8, s * 3.25 + 0.05], H + 0.78, H + 0.84, 'painted', C.red);
  k.block([6.15, -3.3, 6.35, 3.3], H, H + 0.95, 'metal');
  for (const s of [-1, 1]) k.block([6.25, s * 3.25 - 0.1, 7.8, s * 3.25 + 0.1], H, H + 0.95, 'metal');
  // Bronze lamp urns (cover) in the hall.
  for (const [x, z] of [[-8.75, -10], [-8.75, 10], [-2.5, -4.5], [-2.5, 4.5]]) {
    k.box([x - 0.6, z - 0.6, x + 0.6, z + 0.6], H, H + 0.5, 'painted', C.marbleShade);
    k.block([x - 0.45, z - 0.45, x + 0.45, z + 0.45], H + 0.5, H + 1.9, 'metal');
    cyl(k, { x, y: H + 0.5, z, radius: 0.45, height: 1.0, color: C.bronze, sides: 8, top: 0.3 });
    cyl(k, { x, y: H + 1.5, z, radius: 0.5, height: 0.4, color: C.bronzeDark, sides: 8, top: 0.55 });
    k.shape([x - 0.32, z - 0.32, x + 0.32, z + 0.32], H + 1.9, H + 2.0, 'neon', 0xffc070);
  }
}

// ---- The roof ------------------------------------------------------------------------------------
/** Octagonal double-eaved roof in blue glazed tile, a gilded finial on top; brackets and cornice under the eaves. */
export function roof(k: Kit) {
  const y0 = WALL_TOP;
  // Cornice and a band of blue-green brackets under the eaves.
  k.shape([-15.3, -15.3, 15.3, 15.3], y0 - 0.9, y0 + 0.2, 'painted', C.marbleShade);
  for (const s of [-1, 1]) for (let i = -7; i <= 7; i++) {
    const p = i * 2;
    k.shape([p - 0.35, s * 15.3 - 0.3, p + 0.35, s * 15.3 + 0.3], y0 - 1.6, y0 - 0.9, 'painted', i % 2 ? 0x2f7a8a : C.blueDeep);
    k.shape([s * 15.3 - 0.3, p - 0.35, s * 15.3 + 0.3, p + 0.35], y0 - 1.6, y0 - 0.9, 'painted', i % 2 ? 0x2f7a8a : C.blueDeep);
  }
  // Lower eave: fascia, then the first roof sloping up to the drum.
  cyl(k, { x: 0, y: y0 + 0.2, z: 0, radius: 22.6, height: 0.5, color: C.blueDeep, sides: 8, top: 22.6 });
  cyl(k, { x: 0, y: y0 + 0.7, z: 0, radius: 22.6, height: 4.3, color: C.blue, sides: 8, top: 15.2 });
  // Drum between the eaves: white with a gold band and dark windows.
  cyl(k, { x: 0, y: y0 + 5, z: 0, radius: 15.2, height: 4.6, color: C.marble, sides: 8 });
  cyl(k, { x: 0, y: y0 + 9.2, z: 0, radius: 15.35, height: 0.4, color: C.gold, sides: 8 });
  const ap = 15.2 * Math.cos(Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, cx = Math.cos(a) * (ap + 0.01), cz = Math.sin(a) * (ap + 0.01);
    if (i % 2 === 0) k.shape(Math.abs(cx) > 1 ? [cx - 0.05, -2.6, cx + 0.05, 2.6] : [-2.6, cz - 0.05, 2.6, cz + 0.05], y0 + 6, y0 + 8.4, 'painted', 0x22334a);
  }
  // Upper eave and the second roof, rising to the finial.
  cyl(k, { x: 0, y: y0 + 9.6, z: 0, radius: 19.4, height: 0.45, color: C.blueDeep, sides: 8, top: 19.4 });
  cyl(k, { x: 0, y: y0 + 10.05, z: 0, radius: 19.4, height: 11.5, color: C.blue, sides: 8, top: 2.2 });
  cyl(k, { x: 0, y: y0 + 21.5, z: 0, radius: 2.3, height: 1.2, color: C.gold, sides: 8, top: 1.4 });
  ball(k, 0, y0 + 23.6, 0, 1.25, C.gold);
  cyl(k, { x: 0, y: y0 + 24.6, z: 0, radius: 0.35, height: 3, color: C.gold, top: 0.06 });
  // Hip ridges stepping up each roof's eight corners, and gilded tips at the eaves.
  const hips = (r0: number, r1: number, ya: number, yb: number, n: number) => {
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) / 8 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let j = 0; j < n; j++) {
        const t = (j + 0.5) / n, r = r0 + (r1 - r0) * t, y = ya + (yb - ya) * t;
        k.shape([ca * r - 0.32, sa * r - 0.32, ca * r + 0.32, sa * r + 0.32], y - 0.1, y + 0.45, 'painted', C.blueDeep);
      }
      ball(k, ca * (r0 + 0.2), ya + 0.35, sa * (r0 + 0.2), 0.35, C.gold);
    }
  };
  hips(22.6 / Math.cos(Math.PI / 8) * 0.98, 15.2 / Math.cos(Math.PI / 8), y0 + 0.9, y0 + 5, 9);
  hips(19.4 / Math.cos(Math.PI / 8) * 0.98, 2.4 / Math.cos(Math.PI / 8), y0 + 10.2, y0 + 21.6, 16);
  // Tile courses: thin darker rings up each roof.
  for (const t of [0.33, 0.66]) {
    const r = 22.6 + (15.2 - 22.6) * t, y = y0 + 0.7 + 4.3 * t;
    cyl(k, { x: 0, y, z: 0, radius: r + 0.08, height: 0.12, color: C.blueDeep, sides: 8, top: r - 0.15 });
  }
  for (const t of [0.2, 0.4, 0.6, 0.8]) {
    const r = 19.4 + (2.2 - 19.4) * t, y = y0 + 10.05 + 11.5 * t;
    cyl(k, { x: 0, y, z: 0, radius: r + 0.1, height: 0.15, color: C.blueDeep, sides: 8, top: r - 0.1 });
  }
}

// ---- Facades -------------------------------------------------------------------------------------
/** Cornices round each tier, dark window panels and bronze door frames on the base, and the hall's facade. */
export function facades(k: Kit) {
  const ring = (r: R, y0: number, y1: number, out: number, color: number) => {
    const [x0, z0, x1, z1] = r;
    k.shape([x0 - out, z0 - out, x1 + out, z0 + 0.3], y0, y1, 'painted', color);
    k.shape([x0 - out, z1 - 0.3, x1 + out, z1 + out], y0, y1, 'painted', color);
    k.shape([x0 - out, z0, x0 + 0.3, z1], y0, y1, 'painted', color);
    k.shape([x1 - 0.3, z0, x1 + out, z1], y0, y1, 'painted', color);
  };
  ring([-41.75, -34.25, 36.75, 34.25], 3.75, 4.5, 0.12, C.marbleShade);
  ring([-41.75, -34.25, 36.75, 34.25], 0, 0.45, 0.08, 0x9a948a);
  ring([-31.75, -26.75, 29.25, 26.75], 8.25, 9, 0.12, C.marbleShade);
  ring([-20.25, -20.25, 20.25, 20.25], 12.75, 13.5, 0.12, C.marbleShade);
  ring([-14.5, -14.5, 14.5, 14.5], 13.5, 14.3, 0.1, C.marbleShade);

  // Base (ground floor): window panels between the doors, bronze frames round the doors.
  const doorsAt: Record<string, number[]> = { w: [-25, -10, 10, 25], e: [-27.5, -6.25, 6.25, 27.5], n: [-32.5, -17.5, 22.5], s: [-32.5, -17.5, 22.5] };
  const faces: [string, number, number, number, number][] = [['w', -41.75, -0.04, -33, 33], ['e', 36.75, 0.04, -33, 33], ['n', -34.25, -0.04, -40, 35], ['s', 34.25, 0.04, -40, 35]];
  for (const [side, face, out, a, c] of faces) {
    const along = side === 'n' || side === 's';
    const rect = (p: number, q: number): R => along ? [p, Math.min(face, face + out), q, Math.max(face, face + out)] : [Math.min(face, face + out), p, Math.max(face, face + out), q];
    for (const d of doorsAt[side]) {
      const w = Math.abs(d) === 6.25 ? 1.75 : 1.5;
      k.shape(rect(d - w - 0.25, d - w), 0, 3.6, 'painted', C.bronze);
      k.shape(rect(d + w, d + w + 0.25), 0, 3.6, 'painted', C.bronze);
      k.shape(rect(d - w - 0.25, d + w + 0.25), 3.35, 3.6, 'painted', C.bronze);
    }
    for (let p = a + 2.5; p < c - 1; p += 5) {
      if (doorsAt[side].some(d => Math.abs(d - p) < 3.2)) continue;
      // Clear of the stairs that climb against this face.
      if (side === 'w' && Math.abs(p) < 7.5) continue;
      if (side === 'e' && Math.abs(p) < 5) continue;
      if ((side === 'n' || side === 's') && p > -16 && p < -3) continue;
      k.shape(rect(p - 0.8, p + 0.8), 1.1, 3.1, 'painted', 0x2c3a4c);
      k.shape(rect(p - 0.95, p + 0.95), 3.1, 3.25, 'painted', C.marbleShade);
    }
  }
  // Second tier: tall narrow windows.
  for (const [face, out] of [[-26.75, -0.04], [26.75, 0.04]]) {
    for (let p = -27.5; p < 27; p += 5) {
      if (Math.abs(Math.abs(p) - 17.5) < 3 || (p > 1 && p < 14)) continue;
      k.shape([p - 0.6, Math.min(face, face + out), p + 0.6, Math.max(face, face + out)], 5.4, 7.9, 'painted', 0x2c3a4c);
    }
  }

  // The hall's west front: a bronze surround round the great doorway and the name plaque over it.
  k.shape([-14.62, -3.6, -14.5, -3], H, H + 10.6, 'painted', C.bronze);
  k.shape([-14.62, 3, -14.5, 3.6], H, H + 10.6, 'painted', C.bronze);
  k.shape([-14.62, -3.6, -14.5, 3.6], H + 10, H + 10.6, 'painted', C.bronze);
  k.shape([-14.66, -3.4, -14.5, 3.4], H + 11.6, H + 13.6, 'painted', C.gold);
  k.b.raw({ kind: 'sign', style: 'board', x: -14.7, y: H + 12.6, z: 0, rotY: -Math.PI / 2, w: 6.4, h: 1.7, text: '中正紀念堂', bg: '#183a86', fg: '#f4d27a' });
  // Pilasters at the hall's corners.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.shape([sx < 0 ? -14.58 : 13.3, sz < 0 ? -14.58 : 13.3, sx < 0 ? -13.3 : 14.58, sz < 0 ? -13.3 : 14.58], H, WALL_TOP - 0.9, 'painted', C.marbleShade);
  }
  for (const s of [-1, 1]) {
    // Side doors (north and south) and rear doors (east): bronze frames.
    const zf: [number, number] = [Math.min(s * 14.5, s * 14.58), Math.max(s * 14.5, s * 14.58)];
    k.shape([-9.25, zf[0], -9, zf[1]], H, H + 6.25, 'painted', C.bronze);
    k.shape([-6, zf[0], -5.75, zf[1]], H, H + 6.25, 'painted', C.bronze);
    k.shape([-9.25, zf[0], -5.75, zf[1]], H + 6, H + 6.25, 'painted', C.bronze);
    k.shape([14.5, s * 5 - 1.75, 14.58, s * 5 - 1.5], H, H + 4.25, 'painted', C.bronze);
    k.shape([14.5, s * 5 + 1.5, 14.58, s * 5 + 1.75], H, H + 4.25, 'painted', C.bronze);
    k.shape([14.5, s * 5 - 1.75, 14.58, s * 5 + 1.75], H + 4, H + 4.25, 'painted', C.bronze);
    // Tall windows high on the side walls (dark, with gold mullions).
    for (const x of [-11, 0, 7]) {
      k.shape([x - 1, Math.min(s * 14.5, s * 14.56), x + 1, Math.max(s * 14.5, s * 14.56)], 21, 28, 'painted', 0x22334a);
      k.shape([x - 0.04, Math.min(s * 14.5, s * 14.6), x + 0.04, Math.max(s * 14.5, s * 14.6)], 21, 28, 'painted', C.gold);
    }
  }
}

// ---- Grounds' backdrop ---------------------------------------------------------------------------
/** Everything past the bounds: precinct walls with covered walkways, Liberty Square and its buildings, the city. */
export function backdrop(k: Kit) {
  precinct(k);
  libertySquare(k);
  for (const s of [-1, 1]) palaceHall(k, -175, s * 92, s);
  gate(k, -330, 0);
  city(k);
}

/** White precinct walls with blue-tiled copings on three sides, and covered walkways along them outside. */
function precinct(k: Kit) {
  const wall = (r: R, alongX: boolean) => {
    k.box(r, 0, 3.4, 'painted', C.marble);
    const [x0, z0, x1, z1] = r;
    k.shape(alongX ? [x0, z0 - 0.35, x1, z1 + 0.35] : [x0 - 0.35, z0, x1 + 0.35, z1], 3.4, 3.65, 'painted', C.blueDeep);
    k.shape(alongX ? [x0, z0 - 0.1, x1, z1 + 0.1] : [x0 - 0.1, z0, x1 + 0.1, z1], 3.65, 3.9, 'painted', C.blue);
    k.shape(alongX ? [x0, z0 - 0.02, x1, z1 + 0.02] : [x0 - 0.02, z0, x1 + 0.02, z1], 0, 0.5, 'painted', 0xb8b2a8);
    // Octagonal lattice windows every 8 m (dark discs).
    const len = alongX ? x1 - x0 : z1 - z0;
    for (let p = 4; p < len - 2; p += 8) {
      const cx = alongX ? x0 + p : (x0 + x1) / 2, cz = alongX ? (z0 + z1) / 2 : z0 + p;
      for (const f of [-1, 1]) {
        const off = f * ((alongX ? z1 - z0 : x1 - x0) / 2 + 0.02);
        k.b.raw({ kind: 'disc', x: alongX ? cx : cx + off, y: 1.9, z: alongX ? cz + off : cz, nx: alongX ? 0 : f, ny: 0, nz: alongX ? f : 0, rx: 0.75, ry: 0.75, depth: 0.04, style: 'painted', color: 0x2f5a4a });
      }
    }
  };
  wall([-71, -49.3, 60, -48.5], true);
  wall([-71, 48.5, 60, 49.3], true);
  wall([59, -48.5, 59.8, 48.5], false);
  // Covered walkways (回廊) outside the north and south walls: white columns under a blue roof.
  for (const s of [-1, 1]) {
    const z0 = s * 49.3, z1 = s * 54.3, zn = Math.min(z0, z1), zf = Math.max(z0, z1);
    for (let x = -69; x < 59; x += 4) k.shape([x - 0.25, s < 0 ? zn + 0.3 : zf - 0.8, x + 0.25, s < 0 ? zn + 0.8 : zf - 0.3], 0, 3.4, 'painted', C.marble);
    k.shape([-71, zn, 60, zf], 3.4, 3.7, 'painted', C.marbleShade);
    k.shape([-71, zn - 0.3, 60, zf + 0.3], 3.7, 4.1, 'painted', C.blueDeep);
    k.shape([-71, zn + 0.6, 60, zf - 0.6], 4.1, 4.6, 'painted', C.blue);
    k.shape([-71, zn + 1.8, 60, zf - 1.8], 4.6, 5.0, 'painted', C.blue);
    k.shape([-71, zn - 4, 60, zf + 4], -0.04, 0.02, 'paving', C.plaza);
  }
  // Trees beyond the walkways.
  for (const s of [-1, 1]) for (let x = -66; x < 60; x += 9) {
    k.b.raw({ kind: 'tree', x: x + (s > 0 ? 4 : 0), y: 0, z: s * (60 + ((x * 7) & 3)), scale: 1.1 + ((x * 13) & 3) * 0.1, variant: (x & 1) ? 0 : 1 });
  }
  for (let z = -45; z < 46; z += 9) k.b.raw({ kind: 'tree', x: 66 + ((z * 5) & 3), y: 0, z, scale: 1.2, variant: (z & 1) ? 1 : 0 });
}

/** Liberty Square past the west bounds: paving, the axis, lamp standards and planters. */
function libertySquare(k: Kit) {
  k.shape([-360, -62, -71, 62], -0.04, 0.02, 'paving', C.plaza);
  k.shape([-360, -2.5, -71, 2.5], -0.03, 0.025, 'paving', 0xa8a094);
  for (let x = -80; x > -320; x -= 16) for (const z of [-14, 14]) {
    cyl(k, { x, y: 0, z, radius: 0.16, height: 5.5, color: 0x2a2a2e });
    k.shape([x - 0.35, z - 0.35, x + 0.35, z + 0.35], 5.5, 6.2, 'neon', 0xffe0a8);
  }
  for (let x = -90; x > -300; x -= 30) for (const z of [-34, 34]) {
    k.shape([x - 6, z - 3, x + 6, z + 3], 0, 0.7, 'painted', C.marbleShade);
    k.shape([x - 5.6, z - 2.6, x + 5.6, z + 2.6], 0.7, 1.4, 'hedge', C.hedge);
  }
  // Trees lining the square's sides.
  for (let x = -85; x > -330; x -= 12) for (const s of [-1, 1]) k.b.raw({ kind: 'tree', x, y: 0, z: s * (62 + ((x * 3) & 3)), scale: 1.15, variant: 1 });
}

/** The National Theater (south) and Concert Hall (north): palace halls on white bases, red columns, golden-yellow roofs. */
function palaceHall(k: Kit, cx: number, cz: number, s: number) {
  const W = 46, D = 30;
  // Stepped white base with a stair facing the square.
  k.shape([cx - W - 8, cz - D - 8, cx + W + 8, cz + D + 8], 0, 2.4, 'painted', C.marble);
  k.shape([cx - W - 4, cz - D - 4, cx + W + 4, cz + D + 4], 2.4, 5, 'painted', C.marble);
  const face = cz - s * (D + 8);
  k.shape([cx - 14, Math.min(face, face - s * 10), cx + 14, Math.max(face, face - s * 10)], 0, 1.2, 'painted', C.step);
  k.shape([cx - W - 4.2, cz - D - 4.2, cx + W + 4.2, cz + D + 4.2], 4.6, 5.05, 'painted', C.red);
  // Body and colonnade.
  k.shape([cx - W + 3, cz - D + 3, cx + W - 3, cz + D - 3], 5, 22, 'painted', 0xf0e4cc);
  for (let x = cx - W + 1; x <= cx + W - 1; x += 4.6) for (const z of [cz - D + 0.5, cz + D - 0.5]) cyl(k, { x, y: 5, z, radius: 0.75, height: 17, color: 0xb02a1e });
  for (let z = cz - D + 5.1; z <= cz + D - 5; z += 4.6) for (const x of [cx - W + 0.5, cx + W - 0.5]) cyl(k, { x, y: 5, z, radius: 0.75, height: 17, color: 0xb02a1e });
  k.shape([cx - W - 0.5, cz - D - 0.5, cx + W + 0.5, cz + D + 0.5], 21, 23, 'painted', 0x2f6a6a);
  // Hip-and-gable roof in golden-yellow glaze, stepped in.
  const roofColor = 0xe0a030, steps = 7;
  for (let i = 0; i < steps; i++) {
    const t = i / steps, ix = (W + 4) * (1 - t * 0.55), iz = (D + 4) * (1 - t * 0.85), y = 23 + i * 1.8;
    k.shape([cx - ix, cz - iz, cx + ix, cz + iz], y, y + 1.85, 'painted', i % 2 ? roofColor : 0xd09028);
  }
  k.shape([cx - (W + 4) * 0.45, cz - 1.2, cx + (W + 4) * 0.45, cz + 1.2], 23 + steps * 1.8, 23 + steps * 1.8 + 1.4, 'painted', 0xb87a20);
  // A lower skirt roof round the eaves.
  k.shape([cx - W - 6, cz - D - 6, cx + W + 6, cz + D + 6], 22.2, 23, 'painted', 0xd09028);
}

/** The Liberty Square gate: five white archways under blue glazed roofs, the middle one tallest. */
function gate(k: Kit, x: number, z: number) {
  const bays = [[-30, 9, 16], [-15, 11, 20], [0, 14, 26], [15, 11, 20], [30, 9, 16]];
  for (const [o, w, h] of bays) {
    const z0 = z + o - w / 2 - 2, z1 = z + o + w / 2 + 2;
    k.shape([x - 6, z0, x + 6, z0 + 2], 0, h, 'painted', C.marble);
    k.shape([x - 6, z1 - 2, x + 6, z1], 0, h, 'painted', C.marble);
    k.shape([x - 6, z0, x + 6, z1], h - 5, h, 'painted', C.marble);
    k.shape([x - 6.2, z0 - 0.2, x + 6.2, z1 + 0.2], h - 5.4, h - 5, 'painted', C.red);
    k.shape([x - 8, z0 - 2, x + 8, z1 + 2], h, h + 1, 'painted', C.blueDeep);
    k.shape([x - 6.5, z0 - 0.5, x + 6.5, z1 + 0.5], h + 1, h + 2.6, 'painted', C.blue);
    k.shape([x - 3.5, z0 + 1.5, x + 3.5, z1 - 1.5], h + 2.6, h + 3.8, 'painted', C.blue);
    k.shape([x - 1.2, z0 + 2.5, x + 1.2, z1 - 2.5], h + 3.8, h + 4.6, 'painted', C.blueDeep);
  }
}

/** Taipei past the precinct: plain towers in a ring (fogged at that range). */
function city(k: Kit) {
  const n = 34;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.07, r = 230 + ((i * 37) % 90);
    // Leave the view down Liberty Square to the gate open.
    if (Math.abs(Math.sin(a)) < 0.3 && Math.cos(a) < 0) continue;
    const x = Math.cos(a) * r + 20, z = Math.sin(a) * r, w = 18 + ((i * 13) % 20), d = 16 + ((i * 7) % 18), h = 28 + ((i * 53) % 70);
    k.shape([x - w / 2, z - d / 2, x + w / 2, z + d / 2], 0, h, 'facade', [0xd8d0c4, 0xc4ccd4, 0xe0d8c8, 0xb8c0c4][i & 3]);
  }
}
