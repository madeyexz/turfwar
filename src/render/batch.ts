import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Static batching: meshes that never move and share a material become one mesh (one draw in the
 * main pass, one in the shadow pass). Each part's transform is baked into its vertices, so the
 * result looks the same as the parts did. Only for scenery: anything that moves, animates its own
 * material, toggles visibility or is looked up by object stays a separate mesh.
 */

const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'lightMap', 'bumpMap', 'displacementMap', 'envMap', 'specularMap'] as const;
const VALUES = [
  'opacity', 'transparent', 'alphaTest', 'side', 'vertexColors', 'flatShading', 'depthWrite', 'depthTest', 'blending', 'toneMapped',
  'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'fog', 'wireframe', 'roughness', 'metalness', 'emissiveIntensity',
  'envMapIntensity', 'aoMapIntensity', 'bumpScale', 'reflectivity', 'shininess', 'premultipliedAlpha', 'alphaToCoverage', 'colorWrite',
] as const;

/**
 * Identity of how a material renders: two materials with the same key draw identically and can
 * share one merged mesh. Materials with their own shader hooks are only equal to themselves.
 */
export function materialKey(m: THREE.Material): string {
  const own = (k: string) => Object.prototype.hasOwnProperty.call(m, k);
  if (own('onBeforeCompile') || own('customProgramCacheKey') || !/^Mesh(Standard|Basic|Lambert|Phong)Material$/.test(m.type)) return m.uuid;
  const r = m as unknown as Record<string, unknown>;
  const parts: unknown[] = [m.type];
  for (const k of VALUES) parts.push(r[k]);
  for (const k of ['color', 'emissive', 'specular'] as const) { const c = r[k] as THREE.Color | undefined; parts.push(c ? c.toArray().join(',') : ''); }
  const ns = r.normalScale as THREE.Vector2 | undefined; parts.push(ns ? `${ns.x},${ns.y}` : '');
  for (const k of MAPS) { const t = r[k] as THREE.Texture | null | undefined; parts.push(t ? t.uuid : ''); }
  return parts.join('|');
}

/** One float copy of an attribute (de-interleaved, de-quantized), so transforms and merges are exact. */
function floatAttribute(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  if (!(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && a.array instanceof Float32Array) return new THREE.BufferAttribute(a.array.slice(0, a.count * a.itemSize), a.itemSize);
  const out = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
  return new THREE.BufferAttribute(out, a.itemSize);
}

/** A part's geometry in `space` coordinates: float attributes, transform baked in, winding kept for mirrored parts. */
function baked(mesh: THREE.Mesh, toSpace: THREE.Matrix4, indexed: boolean) {
  const src = mesh.geometry;
  let g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) g.setAttribute(name, floatAttribute(a as THREE.BufferAttribute));
  if (src.index) g.setIndex(src.index.clone());
  if (src.index && !indexed) g = g.toNonIndexed();
  const m = new THREE.Matrix4().multiplyMatrices(toSpace, mesh.matrixWorld);
  g.applyMatrix4(m);
  if (m.determinant() < 0) {
    // A mirroring transform turns faces inside out: swap two corners of every triangle.
    if (g.index) { const ix = g.index; for (let i = 0; i < ix.count; i += 3) { const b = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, b); } }
    else for (const a of Object.values(g.attributes) as THREE.BufferAttribute[]) {
      const s = a.itemSize, arr = a.array as Float32Array, t = new Float32Array(s);
      for (let i = 0; i < a.count; i += 3) { t.set(arr.subarray((i + 1) * s, (i + 2) * s)); arr.copyWithin((i + 1) * s, (i + 2) * s, (i + 3) * s); arr.set(t, (i + 2) * s); }
    }
  }
  return g;
}

/** Give every geometry the same attributes (missing colours white, others zero) so they merge. */
function unify(list: THREE.BufferGeometry[]) {
  const sizes = new Map<string, number>();
  for (const g of list) for (const [name, a] of Object.entries(g.attributes)) sizes.set(name, Math.max(sizes.get(name) ?? 0, a.itemSize));
  for (const g of list) {
    if (!g.getAttribute('normal') && sizes.has('normal')) g.computeVertexNormals();
    const n = g.getAttribute('position').count;
    for (const [name, size] of sizes) {
      const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (a && a.itemSize === size) continue;
      const out = new Float32Array(n * size);
      if (name === 'color') out.fill(1);
      if (a) for (let i = 0; i < n; i++) for (let k = 0; k < a.itemSize; k++) out[i * size + k] = a.getComponent(i, k);
      g.setAttribute(name, new THREE.BufferAttribute(out, size));
    }
  }
}

/**
 * The renderer's shadow-caster limits (renderer.ts limitShadowCasters): on low quality, casters
 * smaller than this radius (m) cast nothing, nor do the meshes whose names start like LEAN_CASTERS.
 * A merge keeps both apart: small parts merge only with small parts and record their own size in
 * `userData.casterRadius`, and a merged mesh keeps the leading name of its parts.
 */
export const SMALL_CASTER = 1.2;
export const LEAN_CASTERS = /^(level:hedge|lots:|street:props)/;

const sphere = new THREE.Sphere();
/** World radius of a mesh as a shadow caster: its own `userData.casterRadius` (set for merged or baked parts) or its bounds. */
export function casterRadius(mesh: THREE.Mesh) {
  const own = mesh.userData.casterRadius as number | undefined;
  if (own !== undefined) return own;
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  return sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld).radius;
}

export interface MergeOptions {
  /** Prefix of the merged meshes' names (kept off names the renderer matches, see LEAN_CASTERS). */
  name?: string;
}

/**
 * Merge `meshes` (plain static meshes under `parent`, any depth) by material, shadow flags and
 * render order into new meshes added to `parent`; the parts are removed. Groups of one are left
 * as they are. Returns the meshes that now draw them.
 */
export function mergeStatic(parent: THREE.Object3D, meshes: THREE.Mesh[], opts: MergeOptions = {}): THREE.Mesh[] {
  parent.updateMatrixWorld(true);
  const toSpace = parent.matrixWorld.clone().invert();
  const canonical = new Map<string, THREE.Material>();
  const buckets = new Map<string, { material: THREE.Material; parts: THREE.Mesh[]; radius: number }>();
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material) || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || Object.keys(mesh.geometry.morphAttributes).length) continue;
    const mk = materialKey(mesh.material);
    let material = canonical.get(mk);
    if (!material) canonical.set(mk, material = mesh.material);
    const radius = casterRadius(mesh), lean = LEAN_CASTERS.exec(mesh.name)?.[1] ?? '';
    const shadow = mesh.castShadow ? `${radius < SMALL_CASTER ? 'small' : 'big'}${lean}` : '';
    const key = `${mk}#${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}#${mesh.renderOrder}#${mesh.layers.mask}#${shadow}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = { material, parts: [], radius: 0 });
    b.parts.push(mesh);
    b.radius = Math.max(b.radius, radius);
  }
  const out: THREE.Mesh[] = [];
  for (const { material, parts, radius } of buckets.values()) {
    if (parts.length < 2) { out.push(parts[0]); continue; }
    const indexed = parts.every(p => p.geometry.index);
    const list = parts.map(p => baked(p, toSpace, indexed));
    unify(list);
    const geometry = mergeGeometries(list, false);
    if (!geometry) { out.push(...parts); continue; }
    geometry.computeBoundingSphere(); geometry.computeBoundingBox();
    const first = parts[0];
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder; mesh.layers.mask = first.layers.mask;
    // The renderer drops small and lean casters on low quality: say how big the parts were, and keep a lean name.
    mesh.name = LEAN_CASTERS.test(first.name) ? first.name : `${opts.name ?? 'merged'}:${first.name || material.name || material.type}`;
    if (mesh.castShadow) mesh.userData.casterRadius = radius;
    mesh.matrixAutoUpdate = false;
    for (const p of parts) {
      let up = p.parent;
      p.removeFromParent();
      // Groups the merge emptied (a model's node tree) go too.
      while (up && up !== parent && up.children.length === 0 && (up.type === 'Group' || up.type === 'Object3D')) { const next = up.parent; up.removeFromParent(); up = next; }
    }
    parent.add(mesh);
    out.push(mesh);
  }
  return out;
}

/** The plain meshes under `root` that `mergeStatic` can take (visible, no instancing or skinning), skipping `exclude` subtrees. */
export function staticMeshes(root: THREE.Object3D, exclude: Set<THREE.Object3D> = new Set()): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    if (exclude.has(o) || !o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) out.push(m);
    for (const c of o.children) walk(c);
  };
  for (const c of root.children) walk(c);
  return out;
}


/** Size (m) of the boxes shadow proxies are cut into: across and in height, so each is culled tightly by the shadow camera. */
export const SHADOW_CELL = 16, SHADOW_LAYER = 12;

let multiDraw: boolean | undefined;
/**
 * Whether this browser draws many ranges in one call (WEBGL_multi_draw: Chrome, Android, Edge; not
 * Firefox). Without it a batched mesh issues one draw per range, so shadow proxies would cost more
 * draws than they save. Asked once of a throwaway context.
 */
export function multiDrawSupported() {
  if (multiDraw !== undefined) return multiDraw;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    multiDraw = !!gl?.getExtension('WEBGL_multi_draw');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { multiDraw = false; }
  return multiDraw;
}

/** Positions (triangle soup) as an indexed geometry: equal corners shared, so boxes keep 8 corners, not 36. */
function welded(flat: Float32Array) {
  const n = flat.length / 3, bits = new Uint32Array(flat.buffer, flat.byteOffset, flat.length);
  let size = 1;
  while (size < n * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1), out = new Float32Array(flat.length), outBits = new Uint32Array(out.buffer);
  const index = new Uint32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const x = bits[i * 3], y = bits[i * 3 + 1], z = bits[i * 3 + 2];
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (size - 1);
    for (;;) {
      const e = table[h];
      if (e < 0) { table[h] = count; outBits[count * 3] = x; outBits[count * 3 + 1] = y; outBits[count * 3 + 2] = z; index[i] = count++; break; }
      if (outBits[e * 3] === x && outBits[e * 3 + 1] === y && outBits[e * 3 + 2] === z) { index[i] = e; break; }
      h = (h + 1) & (size - 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out.slice(0, count * 3), 3));
  g.setIndex(new THREE.BufferAttribute(count > 65535 ? index : new Uint16Array(index), 1));
  return g;
}

/** Whether a mesh's shadow is just its triangles' depth (no alpha cut-outs, own depth material or instancing), so a proxy can cast it. */
function plainCaster(mesh: THREE.Mesh) {
  const m = mesh.material as THREE.Material & { alphaMap?: THREE.Texture | null };
  return mesh.castShadow && !Array.isArray(mesh.material) && !m.transparent && !(m.alphaTest > 0) && !m.alphaMap && !mesh.customDepthMaterial
    && !(mesh as THREE.InstancedMesh).isInstancedMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh && !Object.keys(mesh.geometry.morphAttributes).length;
}

/** A float buffer that grows by doubling. */
class Soup {
  data = new Float32Array(1024);
  length = 0;
  reserve(n: number) {
    if (this.length + n <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Float32Array(size); next.set(this.data.subarray(0, this.length)); this.data = next;
  }
}

const BACK = 1, FRONT = 2;

/**
 * Shadow proxies: the shadow pass draws the big static casters from position-only copies cut into
 * boxes (SHADOW_CELL across, SHADOW_LAYER high), so the shadow camera (a few tens of metres round
 * the player) culls the boxes it does not see, where the map-wide merged meshes were drawn whole.
 * The boxes are instances of one BatchedMesh (two: one-sided and two-sided parts; each part's shadow
 * side is written into its winding), culled one by one and drawn in a single multi-draw. No camera
 * draws them: their material is invisible except during the shadow pass, switched by a sentinel the
 * shadow pass meets first. The meshes themselves stop casting. Small and lean casters (see
 * SMALL_CASTER, LEAN_CASTERS) are left to the renderer. Without WEBGL_multi_draw nothing changes.
 */
export function shadowProxies(parent: THREE.Object3D, meshes: THREE.Mesh[], name: string): THREE.BatchedMesh[] {
  if (!multiDrawSupported()) return [];
  parent.updateMatrixWorld(true);
  const toSpace = parent.matrixWorld.clone().invert(), m = new THREE.Matrix4();
  const cells = new Map<number, Soup & { double?: boolean }>();
  const taken: THREE.Mesh[] = [];
  let world = new Float32Array(0);
  for (const mesh of meshes) {
    if (!plainCaster(mesh) || casterRadius(mesh) < SMALL_CASTER || LEAN_CASTERS.test(mesh.name)) continue;
    const material = mesh.material as THREE.Material, g = mesh.geometry, pos = g.getAttribute('position'), index = g.getIndex();
    m.multiplyMatrices(toSpace, mesh.matrixWorld);
    // The faces the depth pass draws (three draws the back faces of front-sided materials), as written by this transform.
    const drawn = material.shadowSide ?? (material.side === THREE.FrontSide ? THREE.BackSide : material.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide);
    const mirror = m.determinant() < 0;
    const faces = drawn === THREE.DoubleSide ? BACK | FRONT : (drawn === THREE.BackSide) !== mirror ? BACK : FRONT;
    // Transformed corners, once.
    if (world.length < pos.count * 3) world = new Float32Array(pos.count * 3);
    const e = m.elements, plain = !(pos as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && !pos.normalized && pos.itemSize === 3 ? pos.array : null;
    for (let i = 0; i < pos.count; i++) {
      const x = plain ? plain[i * 3] : pos.getX(i), y = plain ? plain[i * 3 + 1] : pos.getY(i), z = plain ? plain[i * 3 + 2] : pos.getZ(i);
      world[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      world[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      world[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    const tris = (index ? index.count : pos.count) / 3, double = faces === (BACK | FRONT), ix = index?.array;
    for (let t = 0; t < tris; t++) {
      const a = (ix ? ix[t * 3] : t * 3) * 3, b = (ix ? ix[t * 3 + 1] : t * 3 + 1) * 3, c = (ix ? ix[t * 3 + 2] : t * 3 + 2) * 3;
      const cx = Math.floor((world[a] + world[b] + world[c]) / 3 / SHADOW_CELL) + 512;
      const cy = Math.floor((world[a + 1] + world[b + 1] + world[c + 1]) / 3 / SHADOW_LAYER) + 512;
      const cz = Math.floor((world[a + 2] + world[b + 2] + world[c + 2]) / 3 / SHADOW_CELL) + 512;
      const key = ((cx * 1024 + cy) * 1024 + cz) * 2 + (double ? 1 : 0);
      let soup = cells.get(key);
      if (!soup) cells.set(key, soup = Object.assign(new Soup(), { double }));
      soup.reserve(9);
      const d = soup.data;
      const o = soup.length;
      // One-sided proxies draw back faces: a part whose depth pass drew front faces is written reversed.
      const p = faces === FRONT ? c : b, q = faces === FRONT ? b : c;
      d[o] = world[a]; d[o + 1] = world[a + 1]; d[o + 2] = world[a + 2];
      d[o + 3] = world[p]; d[o + 4] = world[p + 1]; d[o + 5] = world[p + 2];
      d[o + 6] = world[q]; d[o + 7] = world[q + 1]; d[o + 8] = world[q + 2];
      soup.length = o + 9;
    }
    taken.push(mesh);
  }
  if (!cells.size) return [];
  // Two-sided parts (both faces in the depth pass) get proxies of their own, so the rest keep three's back-face shadows.
  const oneSided = new THREE.MeshBasicMaterial({ side: THREE.FrontSide, colorWrite: false, depthWrite: false });
  const twoSided = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false });
  oneSided.shadowSide = THREE.BackSide; twoSided.shadowSide = THREE.DoubleSide;
  oneSided.visible = twoSided.visible = false;
  // The sentinel: first in the shadow pass, it shows the proxies; the camera pass (which runs after the
  // shadow pass has drawn and before its list is drawn) hides them again. It draws nothing itself.
  const sentinelGeometry = new THREE.BufferGeometry();
  sentinelGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  sentinelGeometry.setDrawRange(0, -1);
  // Big bounds: the renderer must not take it for a small caster and stop it casting.
  sentinelGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const sentinel = new THREE.Mesh(sentinelGeometry, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  sentinel.name = `${name}:shadow-switch`;
  sentinel.castShadow = true; sentinel.frustumCulled = false; sentinel.matrixAutoUpdate = false;
  sentinel.onBeforeShadow = () => { oneSided.visible = twoSided.visible = true; };
  sentinel.onBeforeRender = () => { oneSided.visible = twoSided.visible = false; };
  const group = new THREE.Group();
  group.name = `${name}:shadow`;
  group.add(sentinel);
  // One batched mesh per side: each cell is an instance the shadow pass culls on its own, and with
  // WEBGL_multi_draw all the cells it keeps go in one draw (without it, one draw per kept cell).
  const out: THREE.BatchedMesh[] = [];
  for (const double of [false, true]) {
    const parts = [...cells.values()].filter(c => !!c.double === double).map(c => welded(c.data.subarray(0, c.length)));
    if (!parts.length) continue;
    const vertices = parts.reduce((n, g) => n + g.getAttribute('position').count, 0), indices = parts.reduce((n, g) => n + g.getIndex()!.count, 0);
    const batch = new THREE.BatchedMesh(parts.length, vertices, indices, double ? twoSided : oneSided);
    for (const g of parts) batch.addInstance(batch.addGeometry(g));
    batch.sortObjects = false;
    batch.name = `${name}:shadow`;
    batch.castShadow = true; batch.receiveShadow = false; batch.matrixAutoUpdate = false;
    group.add(batch);
    out.push(batch);
  }
  parent.add(group);
  for (const mesh of taken) { mesh.castShadow = false; mesh.userData.shadowWanted = false; }
  return out;
}
