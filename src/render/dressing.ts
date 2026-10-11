import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Decor } from '../../shared/maps/types';
import { rng } from '../../shared/math';
import { mergeStatic } from './batch';
import { buildSkyline, type SkylineData } from './skyline';
import { builtModels, type ModelData } from './props';

/**
 * Dressing sets (a skyline past the map) and model instances (parked cars and taxis, scooters,
 * trees, potted plants). A set is generated here on demand, so neither the server nor the other
 * maps carry it:
 *   skyline     the city, landmarks, hills and water past the map (./cityscape.ts, ./skyline.ts);
 *   models      instanced meshes per model: cars and taxis are built below, the rest in ./props.ts.
 */
type Models = Record<string, ModelData>;
interface DressingSet { skyline?: SkylineData }

const SETS: Record<string, () => Promise<DressingSet>> = {
  ximending: async () => ({ skyline: (await import('./cityscape')).ximendingSkyline() }),
  xinyi: async () => ({ skyline: (await import('./cityscape')).xinyiSkyline() }),
  // The city round Taipei 101, seen from 88F (the map sets it far below).
  taipei101: async () => ({ skyline: (await import('./cityscape')).highriseSkyline() }),
};

type Dressing = Extract<Decor, { kind: 'dressing' }>;
type Instances = Extract<Decor, { kind: 'instances' }>;
const STRIDE = 8;

/**
 * Build every dressing set and model instance of a map into `group` (asynchronously: sets load on
 * demand). Resolves to the time the static batching took (ms).
 */
export async function addDressing(group: THREE.Group, decor: Decor[]): Promise<number> {
  const sets = decor.filter((d): d is Dressing => d.kind === 'dressing');
  const instances = decor.filter((d): d is Instances => d.kind === 'instances');
  if (!sets.length && !instances.length) return 0;
  const models = builtModels();
  const before = new Set(group.children);
  for (const d of sets) {
    const set = await SETS[d.set]?.();
    if (!set) { console.warn('unknown dressing set', d.set); continue; }
    if (set.skyline) { const sky = buildSkyline(set.skyline, d.x, d.z); sky.position.y = d.y ?? 0; group.add(sky); }
  }
  const byModel = new Map<string, number[]>();
  for (const d of instances) byModel.set(d.model, [...(byModel.get(d.model) ?? []), ...d.data]);
  for (const [model, data] of byModel) for (const m of instanced(model, data, 0, 0, models)) group.add(m);
  const t0 = performance.now();
  batch(group, group.children.filter(c => !before.has(c)));
  return performance.now() - t0;
}

/** Instanced models up to this many triangles in all are baked into plain geometry and batched. */
const BAKE_TRIANGLES = 12000;

/**
 * Static batching of the dressing: small instanced models (cars, the smaller
 * plants) become plain geometry, then everything sharing a material, shadow flags and render
 * order draws as one mesh. The big instanced sets (scooters, trees) stay instanced, where
 * one draw costs no extra memory.
 */
function batch(group: THREE.Group, added: THREE.Object3D[]) {
  const meshes: THREE.Mesh[] = [];
  for (const child of added) if (child.name !== 'dressing:skyline') child.traverseVisible(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const parts = meshes.map(mesh => {
    const inst = mesh as THREE.InstancedMesh;
    if (!inst.isInstancedMesh) return mesh;
    const g = inst.geometry, tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    if (tris * inst.count > BAKE_TRIANGLES) return null;
    const baked = bakeInstances(inst);
    inst.parent!.add(baked); inst.removeFromParent();
    return baked;
  }).filter((m): m is THREE.Mesh => m !== null);
  mergeStatic(group, parts, { name: 'dressing' });
}

/** An instanced mesh as one plain mesh: each copy's matrix, colour and per-instance attributes written into its vertices. */
function bakeInstances(inst: THREE.InstancedMesh) {
  const src = inst.geometry.index ? inst.geometry.toNonIndexed() : inst.geometry;
  const copies: THREE.BufferGeometry[] = [], m = new THREE.Matrix4(), c = new THREE.Color();
  const perInstance = Object.entries(src.attributes).filter(([, a]) => (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) as [string, THREE.InstancedBufferAttribute][];
  for (let i = 0; i < inst.count; i++) {
    const g = new THREE.BufferGeometry(), n = src.getAttribute('position').count;
    for (const [name, a] of Object.entries(src.attributes)) if (!(a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) g.setAttribute(name, (a as THREE.BufferAttribute).clone());
    inst.getMatrixAt(i, m);
    g.applyMatrix4(m);
    if (inst.instanceColor) {
      inst.getColorAt(i, c);
      let col = g.getAttribute('color') as THREE.BufferAttribute | undefined;
      if (!col) { col = new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3); g.setAttribute('color', col); }
      for (let v = 0; v < n; v++) col.setXYZ(v, col.getX(v) * c.r, col.getY(v) * c.g, col.getZ(v) * c.b);
    }
    for (const [name, a] of perInstance) {
      const out = new Float32Array(n * a.itemSize);
      for (let v = 0; v < n; v++) for (let k = 0; k < a.itemSize; k++) out[v * a.itemSize + k] = a.getComponent(i, k);
      g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
    }
    copies.push(g);
  }
  const mesh = new THREE.Mesh(mergeGeometries(copies, false)!, inst.material);
  mesh.castShadow = inst.castShadow; mesh.receiveShadow = inst.receiveShadow; mesh.renderOrder = inst.renderOrder;
  mesh.name = inst.name;
  // As a shadow caster it is still as small as one copy (the renderer drops small casters on low).
  if (!src.boundingSphere) src.computeBoundingSphere();
  let scale = 0;
  for (let i = 0; i < inst.count; i++) { inst.getMatrixAt(i, m); scale = Math.max(scale, m.getMaxScaleOnAxis()); }
  mesh.userData.casterRadius = src.boundingSphere!.radius * scale;
  return mesh;
}

// ---- Primitives ----------------------------------------------------------------------------

function colored(g: THREE.BufferGeometry, hex: number, k = 1) {
  const c = new THREE.Color(hex).multiplyScalar(k), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

let propMaterial: THREE.MeshStandardMaterial | undefined;
const propMat = () => (propMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 }));
// ---- Models --------------------------------------------------------------------------------

/** A model's geometry, optionally keeping only the triangles whose first vertex passes `keep`. */
function modelGeometry(d: ModelData, keep?: (vertex: number) => boolean) {
  const g = new THREE.BufferGeometry(), n = d.position.length / 3, idx: number[] = [];
  for (let i = 0; i < n; i += 3) if (!keep || keep(i)) idx.push(i, i + 1, i + 2);
  const take = (a: number[] | undefined, size: number) => a && new THREE.Float32BufferAttribute(idx.flatMap(i => a.slice(i * size, i * size + size)), size);
  g.setAttribute('position', take(d.position, 3)!);
  if (d.normal) g.setAttribute('normal', take(d.normal, 3)!); else g.computeVertexNormals();
  if (d.uv) g.setAttribute('uv', take(d.uv, 2)!);
  if (d.color) g.setAttribute('color', take(d.color, 3)!);
  if (d.top) g.setAttribute('aTop', take(d.top, 1)!);
  return g;
}

/** Instance transform: rows are x, y, z, heading (rotation.y = -heading), scale, roll about z. */
function place(mesh: THREE.InstancedMesh, i: number, row: number[], ox: number, oz: number, sy = 1) {
  const [x, y, z, heading, scale, roll] = row;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x - ox, y, z - oz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -heading, roll, 'YXZ')), new THREE.Vector3(scale, scale * sy, scale));
  mesh.setMatrixAt(i, m);
}

function rows(data: number[]) { const r: number[][] = []; for (let i = 0; i < data.length; i += STRIDE) r.push(data.slice(i, i + STRIDE)); return r; }

function instancedMesh(geometry: THREE.BufferGeometry, material: THREE.Material, list: number[][], ox: number, oz: number, opts: { color?: (row: number[]) => number; shadow?: boolean; sy?: (row: number[]) => number; name: string }) {
  const mesh = new THREE.InstancedMesh(geometry, material, list.length);
  const c = new THREE.Color();
  list.forEach((row, i) => {
    place(mesh, i, row, ox, oz, opts.sy?.(row) ?? 1);
    if (opts.color) mesh.setColorAt(i, c.setHex(opts.color(row)));
  });
  mesh.castShadow = opts.shadow ?? true; mesh.receiveShadow = true; mesh.name = opts.name;
  mesh.computeBoundingSphere();
  return mesh;
}

function instanced(model: string, data: number[], ox: number, oz: number, models: Models): THREE.Object3D[] {
  const list = rows(data);
  if (!list.length) return [];
  if (model === 'car' || model === 'taxi') return [instancedMesh(carGeometry(model === 'taxi'), propMat(), list, ox, oz, { color: r => r[6], name: `model:${model}` })];
  const d = models[model];
  if (!d) return [];
  if (model === 'scooter') return scooters(d, list, ox, oz);
  if (model.startsWith('tree') || model.startsWith('plant')) {
    // Each tree's height varies a little by its position.
    const sy = (r: number[]) => model.startsWith('tree') ? 0.92 + ((((r[0] * 7.13 + r[2] * 3.7) % 1) + 1) % 1) * 0.16 : 1;
    const mesh = instancedMesh(modelGeometry(d), foliageMat(), list, ox + 0, oz, { color: r => r[6], sy, name: `model:${model}` });
    const bloom = new Float32Array(list.length * 4);
    list.forEach((r, i) => { const v = r[7] >>> 0; bloom.set([((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, (v >>> 24) / 255], i * 4); });
    mesh.geometry.setAttribute('aBloom', new THREE.InstancedBufferAttribute(bloom, 4));
    return [mesh];
  }
  return [instancedMesh(modelGeometry(d), propMat(), list, ox, oz, { color: r => r[6], name: `model:${model}` })];
}

/**
 * Parked scooters: the paint tints the body; a seeded roll (a hash of the instance's seed) gives about a
 * third a top box and some a delivery box.
 */
function scooters(d: ModelData, list: number[][], ox: number, oz: number) {
  const tag = (v: number) => d.tag ? d.tag[v * 3] : 0;
  const roll = (r: number[]) => { const v = Math.sin(r[7] * 91.7 + 1.3) * 43758.5453123; return v - Math.floor(v); };
  const out: THREE.Object3D[] = [instancedMesh(modelGeometry(d, v => tag(v) === 0), propMat(), list, ox, oz, { color: r => r[6], name: 'model:scooter' })];
  const top = list.filter(r => roll(r) < 0.3), box = list.filter(r => roll(r) >= 0.3 && roll(r) < 0.45);
  if (top.length) out.push(instancedMesh(modelGeometry(d, v => tag(v) === 1), propMat(), top, ox, oz, { name: 'model:scooter-topbox' }));
  if (box.length) out.push(instancedMesh(modelGeometry(d, v => tag(v) === 2), propMat(), box, ox, oz, { color: r => (roll(r) >= 0.4 ? 0x07150a : 0xffffff), name: 'model:scooter-box' }));
  return out;
}

let foliage: THREE.MeshStandardMaterial | undefined;
/**
 * Leaf cards over a leaf texture drawn here, tinted per tree, with a blossom colour optionally laid
 * over the crown tops.
 */
function foliageMat() {
  if (foliage) return foliage;
  foliage = new THREE.MeshStandardMaterial({ vertexColors: true, map: leafTexture(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85 });
  foliage.onBeforeCompile = s => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTop;\nattribute vec4 aBloom;\nvarying vec4 vBloom;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvBloom = vec4(aBloom.rgb, aBloom.a * aTop);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vBloom;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vBloom.rgb * 0.75, clamp(vBloom.a, 0.0, 0.85));');
  };
  foliage.customProgramCacheKey = () => 'dressing-foliage';
  return foliage;
}

/** The leaf atlas: a white corner for trunks and branches, and a disc of leaves with transparent gaps. */
function leafTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d')!, r = rng(7855);
  c.clearRect(0, 0, 256, 256);
  c.fillStyle = '#fff'; c.fillRect(0, 0, 32, 32);
  for (let layer = 0; layer < 3; layer++) {
    const count = layer === 0 ? 170 : layer === 1 ? 260 : 150, reach = layer === 0 ? 70 : layer === 1 ? 98 : 108;
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * reach, x = 134 + Math.cos(a) * d, y = 134 + Math.sin(a) * d * 0.92;
      if (x < 40 && y < 40) continue;
      const len = 11 + r() * 8, wid = len * (0.38 + r() * 0.12);
      const light = (1 - (y - 20) / 256) * 0.5 + (1 - (x - 20) / 256) * 0.25;
      const k = (layer === 0 ? 0.55 : layer === 1 ? 0.8 : 1) * (0.75 + light * 0.5) * (0.85 + r() * 0.27), jitter = r() * 20 - 10;
      c.save(); c.translate(x, y); c.rotate(r() * Math.PI * 2);
      c.fillStyle = `rgb(${Math.round((112 + jitter) * k)},${Math.round((166 + jitter * 0.5) * k)},${Math.round((70 - jitter * 0.3) * k)})`;
      c.beginPath(); c.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = `rgba(255,255,230,${0.12 + light * 0.1})`; c.lineWidth = 1;
      c.beginPath(); c.moveTo(-len * 0.4, 0); c.lineTo(len * 0.4, 0); c.stroke();
      c.restore();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// ---- Cars ----------------------------------------------------------------------------------

const carCache = new Map<boolean, THREE.BufferGeometry>();
/**
 * A parked sedan facing +z (local), 1.8 × 1.45 × 4.5 m: white body panels take the instance
 * colour; glass, tyres, bumpers and lights keep theirs. Taxis add the roof sign.
 */
function carGeometry(taxi: boolean) {
  const cached = carCache.get(taxi);
  if (cached) return cached;
  const parts: THREE.BufferGeometry[] = [];
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, bevel = 0) => {
    const g = (bevel ? new THREE.BoxGeometry(w, h, d, 1, 1, 1) : new THREE.BoxGeometry(w, h, d)).toNonIndexed();
    g.translate(x, y + h / 2, z); g.deleteAttribute('uv');
    parts.push(colored(g, color));
  };
  const body = 0xffffff, glass = 0x1d2630, dark = 0x1a1a1c, trim = 0x9a9a9a;
  add(1.78, 0.62, 4.45, 0, 0.28, 0, body);                   // lower body
  add(1.8, 0.16, 4.5, 0, 0.26, 0, dark);                     // bumper line
  add(1.58, 0.5, 2.25, 0, 0.9, -0.2, glass);                 // glasshouse
  add(1.5, 0.08, 2.05, 0, 1.4, -0.25, body);                 // roof
  add(0.08, 0.46, 0.08, 0.76, 0.9, 0.85, body); add(0.08, 0.46, 0.08, -0.76, 0.9, 0.85, body);    // A-pillars
  add(0.08, 0.46, 0.08, 0.76, 0.9, -1.25, body); add(0.08, 0.46, 0.08, -0.76, 0.9, -1.25, body);  // C-pillars
  for (const [x, z] of [[0.8, 1.38], [-0.8, 1.38], [0.8, -1.4], [-0.8, -1.4]]) {
    const w = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12).rotateZ(Math.PI / 2).translate(x, 0.33, z).toNonIndexed();
    w.deleteAttribute('uv'); parts.push(colored(w, dark));
    const hub = new THREE.CylinderGeometry(0.18, 0.18, 0.25, 8).rotateZ(Math.PI / 2).translate(x, 0.33, z).toNonIndexed();
    hub.deleteAttribute('uv'); parts.push(colored(hub, trim));
  }
  add(0.36, 0.12, 0.04, 0.6, 0.66, 2.23, 0xfff4d8); add(0.36, 0.12, 0.04, -0.6, 0.66, 2.23, 0xfff4d8);   // headlights
  add(0.4, 0.12, 0.04, 0.6, 0.68, -2.24, 0xb01010); add(0.4, 0.12, 0.04, -0.6, 0.68, -2.24, 0xb01010);  // tail lights
  add(0.5, 0.12, 0.03, 0, 0.42, 2.25, 0xf2f2f2); add(0.5, 0.12, 0.03, 0, 0.42, -2.26, 0xf2f2f2);        // plates
  if (taxi) {
    add(0.62, 0.2, 0.28, 0, 1.48, -0.2, 0xffffff);
    add(0.64, 0.06, 0.3, 0, 1.68, -0.2, 0x1c1c1c);
    add(1.79, 0.08, 4.46, 0, 0.62, 0, 0x202020);            // the checker line of Taipei taxis, simplified
  }
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  carCache.set(taxi, g);
  return g;
}
