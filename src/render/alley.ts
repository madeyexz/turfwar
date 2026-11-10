import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ALLEY, ALLEY_COVER } from '../../shared/maps/alley';
import { assetUrl } from '../assetUrl';
import { mergeStatic, staticMeshes } from './batch';
import { textureBudget } from './textures';

/**
 * The Back Alley's whole picture (the 'alley' dressing set): photoscanned CC0 Poly Haven models
 * (public/assets/alley, packed by tools/fetch-scans.ts) assembled into a yard, with a wet ground and
 * the yard's own lamps. The collision is shared/maps/alley.ts; the cover props stand exactly on its boxes.
 *
 * The two facade kits are catalogues: every piece lies beside the others in the file. A piece is taken
 * by name, moved to its own corner and set on a 3 m grid (FACADES): x along the wall, y up, z out of it.
 */

const MODELS = [
  'modular_factory_facade', 'modular_urban_apartments_facade', 'modular_fire_escape', 'exterior_aircon_unit', 'metal_trash_can',
  'rollershutter_door', 'modular_electricity_poles', 'street_lamp_01', 'security_light', 'utility_box_01', 'utility_box_02',
  'water_manhole_cover', 'modular_metal_gutter', 'concrete_road_barrier_02', 'covered_car', 'old_tyre', 'barrel_stove',
  'cardboard_box_01', 'modular_airduct_circular_01', 'modular_chainlink_fence',
] as const;
type Model = typeof MODELS[number];
type Kit = Record<Model, THREE.Object3D>;

const M = 3; // the facade module (m)

/** Clones of the nodes of `scene` whose names pass `match`, in the file's own coordinates. */
export function take(scene: THREE.Object3D, match: (name: string) => boolean) {
  const out = new THREE.Group();
  const walk = (o: THREE.Object3D) => {
    if (o !== scene && match(o.name)) {
      const c = o.clone(true);
      o.matrixWorld.decompose(c.position, c.quaternion, c.scale);
      out.add(c);
      return;
    }
    for (const child of o.children) walk(child);
  };
  walk(scene);
  return out;
}

/** 'name' is that node, 'prefix*' every node whose name starts so, '*' the whole model. */
const matcher = (spec: string) => spec === '*' ? () => true : spec.endsWith('*') ? (n: string) => n.startsWith(spec.slice(0, -1)) : (n: string) => n === spec;

const box = new THREE.Box3();
export function bounds(o: THREE.Object3D) { o.updateMatrixWorld(true); return box.setFromObject(o).clone(); }

interface PropOptions {
  x: number; y?: number; z: number; rot?: number; scale?: number;
  /** Turn it about x first (a tyre lying flat). */
  rx?: number;
  /** z of the model put on the placement point: its middle (things that stand free) or its back (things on a wall). */
  anchor?: 'middle' | 'back';
}

/** A model (or some of its nodes) with its middle on (x, z), its foot at y, turned by rot. */
function prop(kit: Kit, model: Model, spec: string, o: PropOptions) {
  const pose = spec === '*' ? kit[model].clone(true) : take(kit[model], matcher(spec));
  if (o.rx) pose.rotation.x = o.rx;
  if (o.scale) pose.scale.setScalar(o.scale);
  const all = bounds(pose);
  // The body of a set (a bin among its lid and handles) is what is centred: the collision box is the body's.
  const body = spec.endsWith('*') && spec !== '*' ? pose.children.find(c => c.name === spec.slice(0, -1)) : undefined;
  const b = body ? bounds(body) : all;
  pose.position.x -= (b.min.x + b.max.x) / 2;
  pose.position.y -= all.min.y;
  pose.position.z -= o.anchor === 'back' ? all.min.z : (b.min.z + b.max.z) / 2;
  const outer = new THREE.Group();
  outer.add(pose);
  outer.position.set(o.x, o.y ?? 0, o.z);
  outer.rotation.y = o.rot ?? 0;
  return outer;
}

// ---- Facades ---------------------------------------------------------------------------------

/**
 * What stands in a slot of a facade: [wall piece, what fills its opening, slots it takes]. `k` is the
 * floor (0 the ground): the kits draw a different window for each of their floors.
 */
type Cell = (k: number) => [wall: string, fill: string | null, slots: number];
const FACTORY: Record<string, Cell> = {
  w: () => ['wall_standard_standard_01', null, 1],
  G2: () => ['wall_door_garage_centered_01', 'door_garage_centered_01', 2],
  G3: () => ['wall_door_garage_double_01', 'door_garage_double_01', 3],
  dl: () => ['wall_door_centered_large_01', 'door_centered_large_01', 1],
  dr: () => ['wall_door_recessed_small_01', 'door_recessed_small_01', 1],
  L: k => [`wall_window_centered_large_0${k}`, `window_centered_large_0${k}`, 1],
  M: k => [`wall_window_centered_medium_0${k}`, `window_centered_medium_0${k}`, 1],
  S: k => [`wall_window_centered_small_0${k}`, `window_centered_small_0${k}`, 1],
  D: k => [`wall_window_centered_double_0${k}`, `window_centered_double_0${k}`, 1],
};
const APARTMENTS: Record<string, Cell> = {
  w: () => ['wall_standard_standard_01', null, 1],
  dl: () => ['wall_door_centered_large_01', 'door_centered_large_01', 1],
  ds: () => ['wall_door_centered_small_01', 'door_centered_small_01', 1],
  L: k => [`wall_window_centered_large_0${k}`, `window_centered_large_0${k}`, 1],
  S: k => [`wall_window_centered_small_0${k}`, `window_centered_small_0${k}`, 1],
  D: k => [`wall_window_centered_double_0${k}`, `window_centered_double_0${k}`, 1],
};

interface Facade {
  model: Model; cells: Record<string, Cell>;
  /** Where its left end stands and which way it runs: the wall faces local +z. */
  x: number; z: number; rot: number;
  /** Floors from the ground up; each a row of cells ('-' continues a wide one). A '*' after a window lights it. */
  floors: string[][];
  /** Trim pieces along the whole wall: [piece, y of its foot]; `base` only under plain ground-floor walls. */
  trims: [string, number][];
  base: [string, number][];
}

const { halfX, halfZ } = ALLEY;
const row = (s: string) => s.trim().split(/\s+/);
const FACADES: Facade[] = [
  // North: the brick workshop, with its garage doors on the yard.
  {
    model: 'modular_factory_facade', cells: FACTORY, x: -halfX, z: -halfZ, rot: 0,
    floors: [
      row('w  G2 -  w  dr w  G3 -  -  dl w  w'),
      row('L  M* w  D  S  L  M  M* L  w  D  S'),
      row('M  L  D* w  M  M  L  w  S  D  L* M'),
      row('L  M  M  D  w  L* M  M  L  S  w  L'),
    ],
    trims: [['cornice03_standard_standard_01', 3], ['cornice02_standard_standard_01', 6], ['cornice01_standard_standard_01', 9], ['crown_standard_standard_01', 12]],
    base: [['base_standard_standard_01', 0]],
  },
  // South: the plastered walk-up, seen from behind.
  {
    model: 'modular_urban_apartments_facade', cells: APARTMENTS, x: halfX, z: halfZ, rot: Math.PI,
    floors: [
      row('w  ds w  w  w  dl w  w  ds w  w  w'),
      row('S  L* w  D  S  L  L  D* w  S  L  w'),
      row('L  w  S* D  L  w  S  L  D  L* w  S'),
      row('S  D  L  w  S* L  D  w  L  S  D  L'),
    ],
    trims: [['cornice_standard_standard_01', 3], ['cornice_standard_standard_01', 6], ['cornice_standard_standard_01', 9], ['crown_standard_standard_01', 12]],
    base: [['base_standard_01', 0], ['dado_standard_standard_01', 0.75]],
  },
  // West end: the workshop turns the corner.
  {
    model: 'modular_factory_facade', cells: FACTORY, x: -halfX, z: halfZ, rot: Math.PI / 2,
    floors: [row('w w w w w'), row('M w L* w M'), row('w S w S w'), row('M w L w M')],
    trims: [['cornice03_standard_standard_01', 3], ['cornice02_standard_standard_01', 6], ['cornice01_standard_standard_01', 9], ['crown_standard_standard_01', 12]],
    base: [['base_standard_standard_01', 0]],
  },
  // East end: the walk-up's gable.
  {
    model: 'modular_urban_apartments_facade', cells: APARTMENTS, x: halfX, z: -halfZ, rot: -Math.PI / 2,
    floors: [row('w w w w w'), row('S w D w S*'), row('w L w S w'), row('S* w D w S')],
    trims: [['cornice_standard_standard_01', 3], ['cornice_standard_standard_01', 6], ['cornice_standard_standard_01', 9], ['crown_standard_standard_01', 12]],
    base: [['base_standard_01', 0], ['dado_standard_standard_01', 0.75]],
  },
];

const litGlass = new Map<THREE.Material, THREE.Material>();
/**
 * A lit room behind a window. The kits' glass is all but opaque, so the glass itself glows: warm,
 * and brighter than white so bloom finds it; the frames and bars in front of it stay dark.
 */
function lightUp(window: THREE.Object3D) {
  window.traverse(o => {
    const mesh = o as THREE.Mesh, m = mesh.material as THREE.MeshStandardMaterial;
    if (!mesh.isMesh || !/_glass$/.test(m.name)) return;
    let lit = litGlass.get(m);
    if (!lit) {
      const g = m.clone();
      g.name = `${m.name}_lit`; g.emissive.set(1, 0.56, 0.24); g.emissiveIntensity = 1.7; g.emissiveMap = null;
      litGlass.set(m, lit = g);
    }
    mesh.material = lit;
  });
}

function buildFacade(kit: Kit, f: Facade) {
  const scene = kit[f.model], group = new THREE.Group();
  group.position.set(f.x, 0, f.z); group.rotation.y = f.rot;
  /** A piece with (ax, ay) of the catalogue put on (x, y) of the wall. */
  let placed: THREE.Object3D | undefined;
  const put = (name: string, x: number, y: number, ax?: number, ay?: number) => {
    const g = take(scene, n => n === name);
    if (!g.children.length) { console.warn('alley: no piece', f.model, name); return undefined; }
    const b = bounds(g);
    g.position.set(x - (ax ?? Math.round(b.min.x)), y - (ay ?? b.min.y), 0);
    group.add(g);
    placed = g;
    return b;
  };
  const slots = f.floors[0].length, length = slots * M, height = f.floors.length * M;
  f.floors.forEach((cells, k) => cells.forEach((token, i) => {
    if (token === '-') return;
    const lit = token.endsWith('*'), cell = f.cells[lit ? token.slice(0, -1) : token];
    const [wall, fill] = cell(k);
    const b = put(wall, i * M, k * M);
    if (!b) return;
    const ax = Math.round(b.min.x), ay = Math.round(b.min.y);
    if (fill && put(fill, i * M, k * M, ax, ay) && lit) lightUp(placed!);
    if (k === 0 && token === 'w') for (const [piece, y] of f.base) put(piece, i * M, y);
  }));
  for (const [piece, y] of f.trims) for (let i = 0; i < slots; i++) put(piece, i * M, y);
  // Darkness behind the openings: the walls are one sheet thick.
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(length, height), new THREE.MeshBasicMaterial({ color: 0x040507 }));
  dark.material.name = 'alley_dark';
  dark.position.set(length / 2, height / 2, -0.62);
  group.add(dark);
  return group;
}

// ---- Ground ----------------------------------------------------------------------------------

/**
 * Wet asphalt: the scanned surface, darkened by water, with puddles where a noise field is low: there
 * the surface is flat and mirror-smooth, so the sky and every lamp stand in it.
 */
function ground(low: boolean, glare: THREE.Object3D) {
  const loader = new THREE.TextureLoader(), anisotropy = textureBudget().anisotropy;
  const load = (kind: string, srgb = false) => {
    const t = loader.load(assetUrl(`assets/alley/ground_${kind}.webp`));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const map = load('diff', true), nor = load('nor'), arm = load('arm');
  const material = new THREE.MeshStandardMaterial({ map, normalMap: nor, roughnessMap: arm, aoMap: arm, metalness: 0, roughness: 1 });
  material.name = 'alley_ground';
  const mirror = low ? undefined : groundMirror(glare);
  material.envMapIntensity = 0.5;
  material.onBeforeCompile = s => {
    if (mirror) { s.uniforms.alleyMirror = { value: mirror.target.texture }; s.uniforms.alleyMirrorMatrix = { value: mirror.matrix }; }
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAlleyPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvAlleyPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vAlleyPos;
${mirror ? 'uniform sampler2D alleyMirror; uniform mat4 alleyMirrorMatrix;' : ''}
float alleyHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float alleyNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(alleyHash(i), alleyHash(i + vec2(1.0, 0.0)), f.x), mix(alleyHash(i + vec2(0.0, 1.0)), alleyHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float alleyPuddle() {
  vec2 p = vAlleyPos.xz;
  float n = alleyNoise(p * 0.32 + 3.7) * 0.6 + alleyNoise(p * 0.9 + 11.0) * 0.28 + alleyNoise(p * 2.7) * 0.12;
  return smoothstep(0.50, 0.40, n);
}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat alleyWet = alleyPuddle();\ndiffuseColor.rgb *= mix(0.28, 0.12, alleyWet);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor * 0.5, 0.025, alleyWet);\n// The lamps themselves shine on a rougher surface: a point light in a perfect mirror is one white-hot pixel, which bloom turns into a block.\nfloat alleySmooth = roughnessFactor; roughnessFactor = max(roughnessFactor, 0.32);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, alleyWet * 0.97));');
    // The mirrored yard takes the place of the sky's reflection, as much as the surface is smooth:
    // sharp in a puddle, a blurred sheen on the damp asphalt between them.
    if (mirror) s.fragmentShader = s.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  vec4 mc = alleyMirrorMatrix * vec4(vAlleyPos, 1.0);
  vec2 muv = mc.xy / mc.w + (normal.xy - nonPerturbedNormal.xy) * 0.05;
  float fresnel = 0.03 + 0.97 * pow(1.0 - saturate(dot(normal, geometryViewDir)), 5.0);
  float gloss = 1.0 - alleySmooth;
  vec3 seen = textureLod(alleyMirror, muv, alleySmooth * 7.0).rgb;
  reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, seen * fresnel, gloss * gloss);
}`);
  };
  material.customProgramCacheKey = () => 'alley-ground';
  const g = new THREE.PlaneGeometry(halfX * 2 + 1.4, halfZ * 2 + 1.4).rotateX(-Math.PI / 2);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (halfX * 2 + 1.4) / 3, uv.getY(i) * (halfZ * 2 + 1.4) / 3);
  const mesh = new THREE.Mesh(g, material);
  mesh.position.y = 0.002;
  mesh.receiveShadow = true;
  mesh.name = 'alley:ground';
  if (mirror) mesh.onBeforeRender = (renderer, scene, camera) => mirror.render(renderer, scene as THREE.Scene, camera, mesh);
  return mesh;
}

/**
 * The yard seen from under the ground (a planar reflection, after three.js's Reflector): one more
 * draw of the scene each frame at half size, which is what puts every lamp, wall and soldier in the water.
 */
function groundMirror(glare: THREE.Object3D) {
  const target = new THREE.WebGLRenderTarget(1024, 576, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const matrix = new THREE.Matrix4(), eye = new THREE.PerspectiveCamera();
  const up = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3(), pos = new THREE.Vector3(), look = new THREE.Vector3(), rot = new THREE.Matrix4();
  const plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4();
  let busy = false;
  const render = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, mesh: THREE.Mesh) => {
    // Not inside itself, and not for a pass that draws the scene with one material (ambient occlusion).
    if (busy || scene.overrideMaterial) return;
    at.setFromMatrixPosition(mesh.matrixWorld);
    pos.setFromMatrixPosition(camera.matrixWorld);
    if (pos.y <= at.y) return;
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(pos);
    eye.position.set(pos.x, 2 * at.y - pos.y, pos.z);
    eye.up.set(0, 1, 0).applyMatrix4(rot).reflect(up);
    eye.lookAt(look.x, 2 * at.y - look.y, look.z);
    eye.far = (camera as THREE.PerspectiveCamera).far;
    eye.updateMatrixWorld();
    eye.projectionMatrix.copy(camera.projectionMatrix);
    matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(eye.projectionMatrix).multiply(eye.matrixWorldInverse);
    // Cut away what is under the ground (an oblique near plane, Lengyel).
    plane.setFromNormalAndCoplanarPoint(up, at).applyMatrix4(eye.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = eye.projectionMatrix.elements;
    q.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1 - 0.003; e[14] = clip.w;
    const was = renderer.getRenderTarget(), shadows = renderer.shadowMap.autoUpdate;
    // The halos and shafts are glare in the eye, not things in the yard: the water shows the lamps themselves.
    busy = true; mesh.visible = false; glare.visible = false; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(target);
    renderer.state.buffers.depth.setMask(true);
    if (!renderer.autoClear) renderer.clear();
    renderer.render(scene, eye);
    renderer.shadowMap.autoUpdate = shadows; mesh.visible = true; glare.visible = true; busy = false;
    renderer.setRenderTarget(was);
  };
  return { target, matrix, render };
}

// ---- Light -----------------------------------------------------------------------------------

let glow: THREE.Texture | undefined;
function glowTexture() {
  if (glow) return glow;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.18, 'rgba(255,255,255,0.55)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.12)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  glow = new THREE.CanvasTexture(c);
  return glow;
}

export function halo(color: number, size: number, strength: number) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(color).multiplyScalar(strength), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  s.scale.setScalar(size);
  return s;
}

let shaft: THREE.ShaderMaterial | undefined;
/** The lit haze under a lamp: a cone that is brightest at the lamp and where it is seen edge-on least. */
function shaftMaterial() {
  return shaft ??= new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { },
    vertexShader: 'attribute vec3 tint; varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vTint;\nvoid main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vH = uv.y; vTint = tint; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vTint;\nvoid main() { float rim = pow(abs(dot(normalize(vN), normalize(vV))), 2.2); float a = rim * pow(vH, 1.7) * 0.5; gl_FragColor = vec4(vTint * a, 1.0); }',
  });
}

export function lightShaft(color: number, strength: number, height: number, radius: number) {
  const g = new THREE.ConeGeometry(radius, height, 32, 1, true).translate(0, -height / 2, 0);
  const c = new THREE.Color(color).multiplyScalar(strength), n = g.getAttribute('position').count, tint = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) tint.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  const m = new THREE.Mesh(g, shaftMaterial());
  m.name = 'alley:shaft'; m.renderOrder = 3;
  return m;
}

/** A sagging cable from a to b. */
function cable(a: THREE.Vector3, b: THREE.Vector3, sag: number, material: THREE.Material) {
  const mid = a.clone().lerp(b, 0.5); mid.y -= sag * 2;
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 24, 0.014, 5), material);
  mesh.castShadow = false;
  return mesh;
}

// ---- The yard --------------------------------------------------------------------------------

async function loadKit(): Promise<Kit> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const scenes = await Promise.all(MODELS.map(id => loader.loadAsync(assetUrl(`assets/alley/${id}.glb`)).then(g => g.scene)));
  const kit = {} as Kit, anisotropy = textureBudget().anisotropy;
  MODELS.forEach((id, i) => {
    const scene = scenes[i];
    scene.updateMatrixWorld(true);
    scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      mesh.castShadow = !m.transparent; mesh.receiveShadow = !m.transparent;
      for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap, m.emissiveMap]) if (t) t.anisotropy = anisotropy;
      // Lamp bulbs burn.
      if (/_bulb$/.test(m.name)) { m.emissive.set(0xffb36a); m.emissiveIntensity = 14; m.emissiveMap = null; }
    });
    kit[id] = scene;
  });
  return kit;
}

export async function buildAlley(): Promise<THREE.Object3D> {
  const kit = await loadKit();
  const low = textureBudget().low;
  const yard = new THREE.Group();
  yard.name = 'dressing:alley';
  const still = new THREE.Group(), lights = new THREE.Group(), glare = new THREE.Group();
  yard.add(still, lights, glare);

  yard.add(ground(low, glare));
  const walls = FACADES.map(f => buildFacade(kit, f));
  still.add(...walls);
  const [north, south, west, east] = walls;

  // The cover, on its collision boxes.
  for (const c of ALLEY_COVER) still.add(prop(kit, c.model as Model, c.node, { x: c.x, z: c.z, rot: c.rot }));

  // ---- On the walls (wall coordinates: x along it from its left end, y up, z out) ----
  const on = (wall: THREE.Object3D, model: Model, spec: string, x: number, y: number, z = 0, o: Partial<PropOptions> = {}) => {
    const p = prop(kit, model, spec, { x, y, z, anchor: 'back', ...o });
    wall.add(p);
    return p;
  };
  // Air conditioners under the windows, the rusted ones on the workshop.
  for (const [x, y] of [[7.5, 3.5], [13.5, 6.6], [22.5, 3.6], [31.5, 6.5], [4.5, 9.6]]) on(north, 'exterior_aircon_unit', 'exterior_aircon_unit_rusted', x, y, 0.02);
  for (const [x, y] of [[7.5, 6.5], [10.5, 3.6], [25.5, 6.6], [28.5, 3.5], [34.5, 6.5], [16.5, 9.6]]) on(south, 'exterior_aircon_unit', 'exterior_aircon_unit', x, y, 0.02);
  on(east, 'exterior_aircon_unit', 'exterior_aircon_unit', 7.5, 3.6, 0.02);
  on(west, 'exterior_aircon_unit', 'exterior_aircon_unit_rusted', 4.5, 6.6, 0.02);
  // Roller shutters on the blank ground-floor walls.
  on(south, 'rollershutter_door', 'rollershutter_door_graffiti', 7.5, 0, 0.0);
  on(south, 'rollershutter_door', 'rollershutter_door', 19.5, 0, 0.0);
  on(south, 'rollershutter_door', 'rollershutter_door', 28.5, 0, 0.0);
  on(west, 'rollershutter_door', 'rollershutter_door_graffiti', 7.5, 0, 0.0);
  on(east, 'rollershutter_door', 'rollershutter_door', 4.5, 0, 0.0);
  on(east, 'rollershutter_door', 'rollershutter_door_graffiti', 10.5, 0, 0.0);
  on(north, 'utility_box_01', 'utility_box_01_box', 10.2, 0, 0.0);
  on(west, 'utility_box_01', 'utility_box_01_box', 13.2, 0, 0.0);
  // Downpipes: in the four corners and between the buildings' bays.
  const pipe = (wall: THREE.Object3D, x: number) => {
    for (let y = 0.4; y < 11.5; y += 1) on(wall, 'modular_metal_gutter', 'modular_metal_gutter_section', x, y, 0.1);
    on(wall, 'modular_metal_gutter', 'modular_metal_gutter_outlet', x, 0, 0.05);
  };
  pipe(north, 0.25); pipe(north, 18); pipe(north, 35.75); pipe(south, 0.25); pipe(south, 12); pipe(south, 24); pipe(south, 35.75); pipe(west, 0.3); pipe(east, 0.3);

  // The fire escape on the walk-up: decks at the first and second floors, stairs between and up.
  {
    const fe = new THREE.Group(), src = kit.modular_fire_escape;
    const part = (name: string, y: number, sy = 1, top = false) => {
      const g = take(src, n => n === `modular_fire_escape_${name}`);
      g.scale.y = sy;
      const b = bounds(g);
      g.position.y += y - (top ? b.max.y : b.min.y);
      fe.add(g);
    };
    for (const [deck, level] of [['platform_bottom', 3], ['platform_middle', 6], ['platform_middle', 9]] as const) {
      part(deck, level, 1, true);
      part(deck === 'platform_bottom' ? 'railing_bottom' : 'railing_middle', level);
    }
    part('stairs', 3, 0.75); part('stairs', 6, 0.75);
    part('ladder_bottom', 3.9, 0.6, true);
    fe.position.set(21, 0, 0.8);
    south.add(fe);
  }

  // ---- On the ground ----
  const stand = (model: Model, spec: string, x: number, z: number, rot = 0, o: Partial<PropOptions> = {}) => { const p = prop(kit, model, spec, { x, z, rot, ...o }); still.add(p); return p; };
  stand('water_manhole_cover', '*', -2.4, 2.6, 0.3); stand('water_manhole_cover', '*', 9.5, -1.2, 1.2);
  // Boxes and tyres by the doors.
  stand('cardboard_box_01', '*', -8.5, -6.9, 0.3, { scale: 1.5 }); stand('cardboard_box_01', '*', -8.45, -6.85, 1.1, { scale: 1.2, y: 0.5 });
  stand('cardboard_box_01', '*', 8.6, 6.9, 2.2, { scale: 1.6 }); stand('cardboard_box_01', '*', 9.3, 6.7, 0.4, { scale: 1.3 });
  stand('cardboard_box_01', '*', 15.2, -6.8, 0.9, { scale: 1.7 }); stand('cardboard_box_01', '*', 15.25, -6.85, 2.0, { scale: 1.3, y: 0.57 });
  for (let i = 0; i < 4; i++) stand('old_tyre', '*', 2.2, -6.9, i * 0.5, { rx: Math.PI / 2, y: i * 0.16 });
  for (let i = 0; i < 2; i++) stand('old_tyre', '*', 3.0, -6.8, i * 0.9, { rx: Math.PI / 2, y: i * 0.16 });
  stand('old_tyre', '*', 3.7, -7.3, Math.PI / 2 + 0.2, { rx: 0.18 });
  stand('old_tyre', '*', -16.9, 6.2, 0.4, { rx: Math.PI / 2 });
  stand('metal_trash_can', 'metal_trash_can*', -17.0, -1.2, 0.3); stand('metal_trash_can', 'metal_trash_can*', 17.0, 1.2, 2.0);
  // A power pole in two corners, cables across the yard between them and the walls.
  stand('modular_electricity_poles', 'preset_01_*', -17.2, -6.8, Math.PI / 2); stand('modular_electricity_poles', 'preset_02_*', 17.2, 6.8, -Math.PI / 2);
  const wire = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.5, metalness: 0.1 });
  wire.name = 'alley_wire';
  const A = new THREE.Vector3(-17.2, 5.5, -6.8), B = new THREE.Vector3(17.2, 5.5, 6.8);
  for (const [a, b, sag] of [
    [A, B, 0.9], [A.clone().setY(5.0), new THREE.Vector3(-4, 7.4, 7.4), 0.5], [A.clone().setY(4.6), new THREE.Vector3(6, 8.2, 7.4), 0.7],
    [B.clone().setY(5.1), new THREE.Vector3(3, 7.6, -7.4), 0.55], [B.clone().setY(4.7), new THREE.Vector3(-9, 8.6, -7.4), 0.8], [new THREE.Vector3(-12, 9.4, -7.4), new THREE.Vector3(-10, 9.1, 7.4), 0.6],
  ] as [THREE.Vector3, THREE.Vector3, number][]) still.add(cable(a, b, sag, wire));

  // ---- Light ----
  const warm = 0xffa24a, cool = 0xd6e4ff;
  // Two sodium street lamps, in opposite corners of the middle: they light the yard and cast its shadows.
  for (const [x, z] of [[-13.4, -7.05], [13.4, 7.05]]) {
    stand('street_lamp_01', '*', x, z, z < 0 ? 0 : Math.PI);
    const head = new THREE.Vector3(x, 3.55, z + (z < 0 ? 0.25 : -0.25));
    const spot = new THREE.SpotLight(warm, 260, 22, 1.15, 0.7, 1.8);
    spot.position.copy(head);
    spot.target.position.set(x * 0.8, 0, z * 0.25);
    if (!low) { spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.camera.near = 0.3; spot.shadow.camera.far = 22; spot.shadow.bias = -0.0006; spot.shadow.normalBias = 0.03; }
    const fill = new THREE.PointLight(warm, 10, 9, 2);
    fill.position.copy(head);
    const h = halo(warm, 2.6, 1.6); h.position.copy(head);
    const s = lightShaft(warm, 0.5, 3.5, 2.6); s.position.copy(head);
    lights.add(spot, spot.target, fill); glare.add(h, s);
  }
  // Security lights over the doors: cold white pools on the wall and the ground under them.
  const security = (wall: THREE.Object3D, x: number, y: number, color = cool, power = 70) => {
    on(wall, 'security_light', 'security_light*', x, y, 0.0);
    const at = wall.localToWorld(new THREE.Vector3(x, y - 0.05, 0.3)), to = wall.localToWorld(new THREE.Vector3(x, 0, 2.2));
    const spot = new THREE.SpotLight(color, power, 11, 0.95, 0.85, 1.9);
    spot.position.copy(at); spot.target.position.copy(to);
    const h = halo(color, 1.3, 1.3); h.position.copy(at);
    const s = lightShaft(color, 0.3, 3.0, 2.2); s.position.copy(at);
    lights.add(spot, spot.target); glare.add(h, s);
  };
  yard.updateMatrixWorld(true);
  security(north, 13.5, 2.95); security(north, 28.5, 2.95); security(south, 16.5, 2.95); security(south, 4.5, 2.95, 0xffd2a0, 55); security(south, 25.5, 2.95, 0xffd2a0, 55);
  // The stove's fire: it flickers, and throws the shadows of everything near it across the yard.
  {
    const fire = new THREE.PointLight(0xff7a2a, 26, 13, 1.9);
    fire.position.set(0, 1.0, 0);
    if (!low) { fire.castShadow = true; fire.shadow.mapSize.set(512, 512); fire.shadow.camera.near = 0.32; fire.shadow.camera.far = 13; fire.shadow.bias = -0.002; fire.shadow.normalBias = 0.03; }
    const core = halo(0xff8a30, 1.5, 2.4); core.position.set(0, 0.95, 0);
    const h = halo(0xff6a20, 3.4, 0.7); h.position.set(0, 1.1, 0);
    core.onBeforeRender = () => {
      const t = performance.now() / 1000, k = 0.82 + 0.1 * Math.sin(t * 11.3) + 0.06 * Math.sin(t * 23.7 + 1.3) + 0.05 * Math.sin(t * 5.1 + 0.4);
      fire.intensity = 26 * k; core.scale.setScalar(1.5 * (0.9 + 0.25 * (k - 0.8)));
      fire.position.x = 0.03 * Math.sin(t * 7.1); fire.position.z = 0.03 * Math.cos(t * 9.3);
    };
    // The flames: something bright in the drum for the eye and for the water.
    const flames = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 7), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 3.2, 0.7), fog: false }));
    flames.position.set(0, 0.8, 0); flames.name = 'alley:flames';
    lights.add(fire, flames); glare.add(core, h);
    // Six more draws of the yard a frame is too much for a flicker: its shadows are drawn once the yard stands.
    fire.shadow.autoUpdate = false;
    let drawn = 0;
    flames.onBeforeRender = () => { if (drawn < 3) { drawn++; fire.shadow.needsUpdate = true; } };
  }

  // One draw per material for everything that stands still.
  mergeStatic(still, staticMeshes(still), { name: 'alley' });
  return yard;
}
