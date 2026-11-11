import * as THREE from 'three';
import type { Solid } from '../../shared/collision';
import type { Decor } from '../../shared/maps/types';

/**
 * What the bomb brings down at each Sabotage site, by map: a box [minX, minY, minZ, maxX, maxY, maxZ]
 * per site (in the order of `sabotage.sites`). The map's blocks, details, cylinders and signs whose
 * centre is in the box are drawn apart from the rest of the level, so they can fall.
 *
 * The collapse is a picture only: collision, sight lines and the server do not change. That holds
 * because the bomb's blast ends the round, and the next round starts with the buildings standing.
 */
export const COLLAPSE: Record<string, [number, number, number, number, number, number][]> = {
  taipei: [
    [-24.1, 0.2, -38.6, -6.9, 7, -33],    // A: the cinema's lobby wall on lane N and its marquee deck (the stairs and the storeys above stay)
    [-16.6, 0.2, 33.4, -0.6, 22, 49.6],   // B: the Red House's octagon
  ],
};

/** Centre of the decor a collapse can take; null for the kinds that always stand (ramps, props, lamps, markings). */
export function decorCentre(d: Decor, solids: Solid[]): [number, number, number] | null {
  switch (d.kind) {
    case 'block': { const s = solids[d.solid]; return [(s.minX + s.maxX) / 2, (s.minY + s.maxY) / 2, (s.minZ + s.maxZ) / 2]; }
    case 'detail': return [d.x, d.y + d.h / 2, d.z];
    case 'shape': return [(d.min[0] + d.max[0]) / 2, (d.min[1] + d.max[1]) / 2, (d.min[2] + d.max[2]) / 2];
    case 'cylinder': return [d.x, d.y + (d.axis === 'y' ? d.height / 2 : d.radius), d.z];
    case 'sign': return [d.x, d.y, d.z];
    default: return null;
  }
}

/** Longest edge (m) of a fragment's triangles and the size (m) of the cells that group triangles into fragments. */
const EDGE = 1.5, CELL = 1.7;
const GRAVITY = 11;

interface Chunk {
  pivot: THREE.Vector3; offset: THREE.Vector3; velocity: THREE.Vector3;
  axis: THREE.Vector3; angle: number; spin: number;
  delay: number; rest: number; landed: boolean;
}

/** Split every triangle whose longest edge is over EDGE at that edge's middle (all attributes go with it). */
function subdivide(g: THREE.BufferGeometry) {
  const names = Object.keys(g.attributes), sizes = names.map(n => g.getAttribute(n).itemSize);
  const stride = sizes.reduce((a, b) => a + b, 0), at = names.indexOf('position');
  const offset = sizes.slice(0, at).reduce((a, b) => a + b, 0);
  const count = g.getAttribute('position').count;
  const corner = (i: number) => {
    const v = new Float32Array(stride);
    let k = 0;
    names.forEach((n, j) => { const a = g.getAttribute(n); for (let c = 0; c < sizes[j]; c++) v[k++] = a.getComponent(i, c); });
    return v;
  };
  const len2 = (a: Float32Array, b: Float32Array) => (a[offset] - b[offset]) ** 2 + (a[offset + 1] - b[offset + 1]) ** 2 + (a[offset + 2] - b[offset + 2]) ** 2;
  const out: Float32Array[] = [], stack: Float32Array[][] = [];
  for (let i = 0; i + 2 < count; i += 3) stack.push([corner(i), corner(i + 1), corner(i + 2)]);
  while (stack.length) {
    const [a, b, c] = stack.pop()!;
    const ab = len2(a, b), bc = len2(b, c), ca = len2(c, a), longest = Math.max(ab, bc, ca);
    if (longest <= EDGE * EDGE || out.length > 60000) { out.push(a, b, c); continue; }
    // Rotate so the longest edge is p-q, then split it: (p, m, r) and (m, q, r) keep the winding.
    const [p, q, r] = longest === ab ? [a, b, c] : longest === bc ? [b, c, a] : [c, a, b];
    const m = new Float32Array(stride);
    for (let k = 0; k < stride; k++) m[k] = (p[k] + q[k]) / 2;
    stack.push([p, m, r], [m, q, r]);
  }
  return { names, sizes, stride, offset, corners: out };
}

/**
 * The pieces of a building that fall: its meshes cut into triangles of about a metre, grouped by
 * place into fragments that each fall, turn and come to rest as one. Every triangle is drawn on both
 * faces (a second copy, turned over) so a turning shard never shows a hole, with the level's own
 * materials: nothing new to compile at the moment of the blast.
 */
export class Collapse {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  private parts: { position: THREE.BufferAttribute; normal: THREE.BufferAttribute | null; basePos: Float32Array; baseNor: Float32Array | null; chunk: Uint16Array }[] = [];
  /** Seconds since the blast; negative while the building stands. */
  private time = -1;
  private moving = false;

  constructor(meshes: THREE.Mesh[]) {
    const ids = new Map<string, number>(), sums: { p: THREE.Vector3; n: number }[] = [];
    for (const mesh of meshes) {
      const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const { names, sizes, offset, corners } = subdivide(src);
      const tris = corners.length / 3, n = tris * 6;
      const arrays = names.map((_, j) => new Float32Array(n * sizes[j]));
      const chunk = new Uint16Array(n);
      const normalAt = names.indexOf('normal');
      for (let t = 0; t < tris; t++) {
        const a = corners[t * 3], b = corners[t * 3 + 1], c = corners[t * 3 + 2];
        const cx = (a[offset] + b[offset] + c[offset]) / 3, cy = (a[offset + 1] + b[offset + 1] + c[offset + 1]) / 3, cz = (a[offset + 2] + b[offset + 2] + c[offset + 2]) / 3;
        // Cells shifted layer by layer, like courses of brick, so the breaks do not run in straight lines.
        const iy = Math.floor(cy / CELL), shift = (iy & 1) * CELL / 2;
        const key = `${Math.floor((cx + shift) / CELL)},${iy},${Math.floor((cz + shift) / CELL)}`;
        let id = ids.get(key);
        if (id === undefined) { id = sums.length; ids.set(key, id); sums.push({ p: new THREE.Vector3(), n: 0 }); }
        sums[id].p.add(new THREE.Vector3(cx, cy, cz)); sums[id].n++;
        // The triangle, then the same one turned over with its normal reversed.
        [a, b, c, a, c, b].forEach((v, k) => {
          const i = t * 6 + k;
          let from = 0;
          names.forEach((_, j) => {
            const flip = k >= 3 && j === normalAt ? -1 : 1;
            for (let q = 0; q < sizes[j]; q++) arrays[j][i * sizes[j] + q] = v[from + q] * flip;
            from += sizes[j];
          });
          chunk[i] = id!;
        });
      }
      const g = new THREE.BufferGeometry();
      names.forEach((name, j) => g.setAttribute(name, new THREE.BufferAttribute(arrays[j], sizes[j])));
      const position = g.getAttribute('position') as THREE.BufferAttribute, normal = (g.getAttribute('normal') as THREE.BufferAttribute | undefined) ?? null;
      position.setUsage(THREE.DynamicDrawUsage); normal?.setUsage(THREE.DynamicDrawUsage);
      const fallen = new THREE.Mesh(g, mesh.material);
      fallen.name = mesh.name; fallen.castShadow = mesh.castShadow; fallen.receiveShadow = mesh.receiveShadow;
      // The pieces leave the building's bounds as they fall.
      fallen.frustumCulled = false;
      this.group.add(fallen);
      this.parts.push({ position, normal, basePos: (position.array as Float32Array).slice(), baseNor: normal ? (normal.array as Float32Array).slice() : null, chunk });
    }
    for (const s of sums) {
      this.chunks.push({ pivot: s.p.divideScalar(s.n), offset: new THREE.Vector3(), velocity: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), angle: 0, spin: 0, delay: 0, rest: 0, landed: false });
    }
    this.group.visible = false;
  }

  /** The blast at `origin`: pieces near the bomb are thrown out, the rest lose their support from the bottom up and fall to `ground`. */
  start(origin: THREE.Vector3, ground: number) {
    const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
    let top = ground;
    for (const c of this.chunks) top = Math.max(top, c.pivot.y);
    const pile = Math.min(3.4, Math.max(0.9, (top - ground) * 0.2));
    for (const c of this.chunks) {
      const away = c.pivot.clone().sub(origin), dist = away.length(), push = 13 / (1 + dist * 0.35);
      away.y = 0; away.normalize();
      c.offset.set(0, 0, 0); c.angle = 0; c.landed = false;
      c.velocity.copy(away).multiplyScalar(push + rand(0, 1.5)).add(new THREE.Vector3(rand(-1, 1), push * rand(0.2, 0.7), rand(-1, 1)));
      c.axis.randomDirection(); c.spin = rand(0.6, 2.2) + push * 0.35;
      c.delay = dist / 45 + (c.pivot.y - ground) * 0.03 + rand(0, 0.18);
      // Where it comes to rest: on the heap, higher the later it lands.
      c.rest = ground + 0.08 + Math.random() ** 1.5 * pile;
    }
    this.time = 0; this.moving = true;
    this.group.visible = true;
    this.write();
  }

  /** The building stands again. */
  reset() { this.time = -1; this.moving = false; this.group.visible = false; }

  get fallen() { return this.time >= 0; }

  update(dt: number) {
    if (!this.moving) return;
    this.time += dt;
    let moving = false;
    for (const c of this.chunks) {
      if (c.landed) continue;
      moving = true;
      if (this.time < c.delay) continue;
      c.velocity.y -= GRAVITY * dt;
      c.offset.addScaledVector(c.velocity, dt);
      c.angle += c.spin * dt;
      if (c.pivot.y + c.offset.y <= c.rest) {
        c.offset.y = c.rest - c.pivot.y; c.landed = true;
      }
    }
    this.write();
    this.moving = moving;
  }

  /** Every vertex to its fragment's place and turn. */
  private write() {
    const q = new THREE.Quaternion(), m = new THREE.Matrix4(), mats = new Float32Array(this.chunks.length * 12);
    this.chunks.forEach((c, i) => {
      m.makeRotationFromQuaternion(q.setFromAxisAngle(c.axis, c.angle));
      const e = m.elements, p = c.pivot, o = c.offset;
      // Rotation, then the translation that turns it about the pivot and adds the fall.
      mats.set([e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10],
        p.x + o.x - (e[0] * p.x + e[4] * p.y + e[8] * p.z), p.y + o.y - (e[1] * p.x + e[5] * p.y + e[9] * p.z), p.z + o.z - (e[2] * p.x + e[6] * p.y + e[10] * p.z)], i * 12);
    });
    for (const part of this.parts) {
      const pos = part.position.array as Float32Array, base = part.basePos, nor = part.normal?.array as Float32Array | undefined, baseNor = part.baseNor;
      for (let i = 0, n = part.chunk.length; i < n; i++) {
        const k = part.chunk[i] * 12, x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
        pos[i * 3] = mats[k] * x + mats[k + 3] * y + mats[k + 6] * z + mats[k + 9];
        pos[i * 3 + 1] = mats[k + 1] * x + mats[k + 4] * y + mats[k + 7] * z + mats[k + 10];
        pos[i * 3 + 2] = mats[k + 2] * x + mats[k + 5] * y + mats[k + 8] * z + mats[k + 11];
        if (nor && baseNor) {
          const nx = baseNor[i * 3], ny = baseNor[i * 3 + 1], nz = baseNor[i * 3 + 2];
          nor[i * 3] = mats[k] * nx + mats[k + 3] * ny + mats[k + 6] * nz;
          nor[i * 3 + 1] = mats[k + 1] * nx + mats[k + 4] * ny + mats[k + 7] * nz;
          nor[i * 3 + 2] = mats[k + 2] * nx + mats[k + 5] * ny + mats[k + 8] * nz;
        }
      }
      part.position.needsUpdate = true;
      if (part.normal) part.normal.needsUpdate = true;
    }
  }

  dispose() { for (const m of this.group.children) (m as THREE.Mesh).geometry.dispose(); }
}
