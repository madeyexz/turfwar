import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ALLEY, ALLEY_BLOCKS, ALLEY_COVER, type AlleyBlock } from '../../shared/maps/alley';
import { rng } from '../../shared/math';
import { assetUrl } from '../assetUrl';
import { mergeStatic, staticMeshes } from './batch';
import { textureBudget } from './textures';

/**
 * The Back Alley's whole picture (the 'alley' dressing set): photoscanned CC0 Poly Haven models
 * (public/assets/alley, packed by tools/fetch-scans.ts) assembled into lanes of buildings, with a wet
 * ground and the lanes' own lamps. The collision is shared/maps/alley.ts: the buildings stand on its
 * blocks (ALLEY_BLOCKS) and the cover props exactly on its boxes (ALLEY_COVER).
 *
 * The two facade kits are catalogues: every piece lies beside the others in the file. A piece is taken
 * by name, moved to its own corner and set on a 3 m grid (buildFacade): x along the wall, y up, z out of it.
 * The walls are not drawn one by one by hand: a seeded lot fills each (cellsOf), so the map is the same every time.
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
// 'r' is a plain wall without its foot: a roller shutter stands there (buildAlley), down to the ground.
const FACTORY: Record<string, Cell> = {
  w: () => ['wall_standard_standard_01', null, 1],
  r: () => ['wall_standard_standard_01', null, 1],
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
  r: () => ['wall_standard_standard_01', null, 1],
  dl: () => ['wall_door_centered_large_01', 'door_centered_large_01', 1],
  ds: () => ['wall_door_centered_small_01', 'door_centered_small_01', 1],
  L: k => [`wall_window_centered_large_0${k}`, `window_centered_large_0${k}`, 1],
  S: k => [`wall_window_centered_small_0${k}`, `window_centered_small_0${k}`, 1],
  D: k => [`wall_window_centered_double_0${k}`, `window_centered_double_0${k}`, 1],
};

type KitName = AlleyBlock['kit'];
interface FacadeKit {
  model: Model; cells: Record<string, Cell>;
  /** Trim along the whole wall: a cornice over the ground, first and second floors, and the crown on top. */
  cornices: string[]; crown: string;
  /** The foot of a plain ground-floor wall: [piece, y]. */
  base: [string, number][];
  /** The pier that wraps a building's corner (it stands at a wall's left end): x of the catalogue's, and its pieces. */
  corner: number;
  pier: { wall: string; foot: [string, number][]; cornices: string[]; crown: string };
  /** What a slot holds where the wall is not set by hand, and how often: on the ground and above it. */
  ground: [string, number][]; upper: [string, number][];
  /** How many of its windows are lit. */
  lit: number;
  aircon: string;
}
const KITS: Record<KitName, FacadeKit> = {
  // Brick workshops, with garage doors on the lanes.
  factory: {
    model: 'modular_factory_facade', cells: FACTORY,
    cornices: ['cornice03_standard_standard_01', 'cornice02_standard_standard_01', 'cornice01_standard_standard_01'], crown: 'crown_standard_standard_01',
    base: [['base_standard_standard_01', 0]],
    corner: -29,
    pier: { wall: 'wall_pier_corner_01', foot: [['dado_pier_corner_01', 0]], cornices: ['cornice02_pier_corner_01', 'cornice02_pier_corner_01', 'cornice01_pier_corner_01'], crown: 'crown_pier_corner_01' },
    ground: [['w', 42], ['r', 10], ['dr', 12], ['dl', 8], ['G2', 18], ['G3', 10]],
    upper: [['L', 25], ['M', 30], ['S', 10], ['D', 15], ['w', 20]],
    lit: 0.12, aircon: 'exterior_aircon_unit_rusted',
  },
  // Plastered walk-ups, seen from behind.
  apartments: {
    model: 'modular_urban_apartments_facade', cells: APARTMENTS,
    cornices: ['cornice_standard_standard_01', 'cornice_standard_standard_01', 'cornice_standard_standard_01'], crown: 'crown_standard_standard_01',
    base: [['base_standard_01', 0], ['dado_standard_standard_01', 0.75]],
    corner: -20,
    pier: { wall: 'wall_pier_corner_01', foot: [['dado_pier_corner_01', 0.75]], cornices: ['cornice_pier_corner_01', 'cornice_pier_corner_01', 'cornice_pier_corner_01'], crown: 'crown_pier_corner_01' },
    ground: [['w', 56], ['r', 12], ['ds', 22], ['dl', 10]],
    upper: [['S', 25], ['L', 30], ['D', 20], ['w', 25]],
    lit: 0.14, aircon: 'exterior_aircon_unit',
  },
};

interface Facade {
  id: string; kit: KitName;
  /** Where its left end stands and which way it runs: the wall faces local +z. */
  x: number; z: number; rot: number;
  slots: number; floors: number;
  /** Its ground floor, where that is set by hand: a row of cells ('-' continues a wide one). */
  ground?: string;
  /** A building's own wall: a pier wraps its left end, the corner it shares with the wall before it. */
  corner?: boolean;
}

const { halfX, halfZ } = ALLEY;
const row = (s: string) => s.trim().split(/\s+/);

/** The ground floors set by hand, by building and side. */
const GROUND: Record<string, Partial<Record<'north' | 'east' | 'south' | 'west', string>>> = {
  // The workshop's garages and back door on the yard.
  workshop: { south: 'w G2 - w w dr w G2 -' },
  // Each row of lock-ups opens on the yard; a side door lets on the base.
  'garages-west': { east: 'G3 - -', west: 'w dr w' },
  'garages-east': { west: 'G3 - -', east: 'w dr w' },
};

/** Every wall of the map: the outer walls, as a street of different buildings, then the four sides of each block. */
function facades(): Facade[] {
  const out: Facade[] = [];
  const run = (side: string, x: number, z: number, rot: number, parts: [KitName, number][]) => {
    let at = 0;
    parts.forEach(([kit, slots], i) => {
      out.push({ id: `outer:${side}:${i}`, kit, x: x + Math.cos(rot) * at, z: z - Math.sin(rot) * at, rot, slots, floors: ALLEY.height / M });
      at += slots * M;
    });
  };
  // Where two outer walls meet in a corner they are of one building.
  run('north', -halfX, -halfZ, 0, [['factory', 9], ['apartments', 8], ['factory', 7]]);
  run('east', halfX, -halfZ, -Math.PI / 2, [['factory', 7], ['apartments', 8]]);
  run('south', halfX, halfZ, Math.PI, [['apartments', 9], ['factory', 8], ['apartments', 7]]);
  run('west', -halfX, halfZ, Math.PI / 2, [['apartments', 7], ['factory', 8]]);
  for (const b of ALLEY_BLOCKS) {
    const w = (b.x1 - b.x0) / M, d = (b.z1 - b.z0) / M, own = GROUND[b.id] ?? {}, wall = { kit: b.kit, floors: b.floors, corner: true };
    out.push(
      { ...wall, id: `${b.id}:south`, x: b.x0, z: b.z1, rot: 0, slots: w, ground: own.south },
      { ...wall, id: `${b.id}:east`, x: b.x1, z: b.z1, rot: Math.PI / 2, slots: d, ground: own.east },
      { ...wall, id: `${b.id}:north`, x: b.x1, z: b.z0, rot: Math.PI, slots: w, ground: own.north },
      { ...wall, id: `${b.id}:west`, x: b.x0, z: b.z0, rot: -Math.PI / 2, slots: d, ground: own.west },
    );
  }
  return out;
}

/** One of `from` ([value, weight]), by weight. */
function pick<T>(random: () => number, from: [T, number][]) {
  let r = random() * from.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of from) if ((r -= w) < 0) return v;
  return from[0][0];
}

/** A facade's cells, floor by floor from the ground: drawn by lot where they are not set by hand. A '*' after a window lights it. */
function cellsOf(f: Facade, random: () => number): string[][] {
  const K = KITS[f.kit], floors: string[][] = [];
  if (f.ground) floors.push(row(f.ground));
  else {
    const g: string[] = [];
    while (g.length < f.slots) {
      // The ends stay plain: a corner pier or a downpipe stands there.
      const i = g.length, token = i === 0 || i === f.slots - 1 ? 'w' : pick(random, K.ground);
      const wide = K.cells[token](0)[2];
      if (i + wide > f.slots - 1) { g.push('w'); continue; }
      g.push(token);
      for (let k = 1; k < wide; k++) g.push('-');
    }
    floors.push(g);
  }
  for (let k = 1; k < f.floors; k++) floors.push(Array.from({ length: f.slots }, () => {
    const token = pick(random, K.upper);
    return token !== 'w' && random() < K.lit ? `${token}*` : token;
  }));
  return floors;
}

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

const darkness = new THREE.MeshBasicMaterial({ color: 0x040507 });
darkness.name = 'alley_dark';

// The map is drawn in strips across x: what stands in one strip is one draw for each of its materials,
// and a strip out of sight (or out of a lamp's reach, in its shadow pass) is not drawn at all.
const STRIPS = 4;
const strip = (x: number) => Math.min(STRIPS - 1, Math.max(0, Math.floor((x + halfX) / (halfX * 2 / STRIPS))));

/** A facade as built: its cells, and the way to put more things on it. */
interface Wall {
  f: Facade; cells: string[][]; length: number; height: number;
  /** The group (in the wall's own coordinates: x along it from its left end, y up, z out) that holds what stands at x. */
  at: (x: number) => THREE.Group;
  /** A point of the wall in the map's coordinates. */
  point: (x: number, y: number, z: number) => THREE.Vector3;
}

function buildFacade(kit: Kit, f: Facade, random: () => number, strips: THREE.Group[], common: THREE.Group): Wall {
  const K = KITS[f.kit], scene = kit[K.model];
  const cos = Math.cos(f.rot), sin = Math.sin(f.rot);
  const point = (x: number, y: number, z: number) => new THREE.Vector3(f.x + x * cos + z * sin, y, f.z - x * sin + z * cos);
  const groups = new Map<number, THREE.Group>();
  const at = (x: number) => {
    const s = strip(point(x, 0, 0).x);
    let g = groups.get(s);
    if (!g) { g = new THREE.Group(); g.position.set(f.x, 0, f.z); g.rotation.y = f.rot; strips[s].add(g); groups.set(s, g); }
    return g;
  };
  /** A piece with (ax, ay) of the catalogue put on (x, y) of the wall. */
  let placed: THREE.Object3D | undefined;
  const put = (name: string, x: number, y: number, ax?: number, ay?: number) => {
    const g = take(scene, n => n === name);
    if (!g.children.length) { console.warn('alley: no piece', K.model, name); return undefined; }
    const b = bounds(g);
    g.position.set(x - (ax ?? Math.round(b.min.x)), y - (ay ?? b.min.y), 0);
    at(x + 0.01).add(g);
    placed = g;
    return b;
  };
  const cells = cellsOf(f, random), length = f.slots * M, height = f.floors * M;
  cells.forEach((floor, k) => floor.forEach((token, i) => {
    if (token === '-') return;
    const lit = token.endsWith('*'), cell = K.cells[lit ? token.slice(0, -1) : token];
    const [wall, fill] = cell(k);
    const b = put(wall, i * M, k * M);
    if (!b) return;
    const ax = Math.round(b.min.x), ay = Math.round(b.min.y);
    if (fill && put(fill, i * M, k * M, ax, ay) && lit) lightUp(placed!);
    if (k === 0 && token === 'w') for (const [piece, y] of K.base) put(piece, i * M, y);
  }));
  for (let i = 0; i < f.slots; i++) {
    for (let k = 1; k < f.floors; k++) put(K.cornices[k - 1], i * M, k * M);
    put(K.crown, i * M, height);
  }
  if (f.corner) {
    for (let k = 0; k < f.floors; k++) put(K.pier.wall, 0, k * M, K.corner);
    for (const [piece, y] of K.pier.foot) put(piece, 0, y, K.corner);
    for (let k = 1; k < f.floors; k++) put(K.pier.cornices[k - 1], 0, k * M, K.corner);
    put(K.pier.crown, 0, height, K.corner);
  }
  // Darkness behind the openings: the walls are one sheet thick.
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(length, height), darkness);
  dark.position.copy(point(length / 2, height / 2, -0.62)); dark.rotation.y = f.rot;
  common.add(dark);
  return { f, cells, length, height, at, point };
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

/** The Low preset: the scans' pictures at half their size, a quarter of the memory (1 GB as they come). */
async function halve(scenes: THREE.Object3D[]) {
  const sources = new Set<THREE.Source>();
  for (const scene of scenes) scene.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m) for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap, m.emissiveMap]) if (t) sources.add(t.source);
  });
  await Promise.all([...sources].map(async source => {
    const image = source.data as ImageBitmap | HTMLImageElement;
    if (!image || image.width < 512 || typeof createImageBitmap === 'undefined') return;
    source.data = await createImageBitmap(image, { resizeWidth: image.width >> 1, resizeHeight: image.height >> 1, resizeQuality: 'medium' });
    (image as ImageBitmap).close?.();
    source.needsUpdate = true;
  }));
}

async function loadKit(): Promise<Kit> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const scenes = await Promise.all(MODELS.map(id => loader.loadAsync(assetUrl(`assets/alley/${id}.glb`)).then(g => g.scene)));
  const kit = {} as Kit, { anisotropy, low } = textureBudget();
  if (low) await halve(scenes);
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
  const strips = Array.from({ length: STRIPS }, () => new THREE.Group()), common = new THREE.Group();
  const lights = new THREE.Group(), glare = new THREE.Group();
  yard.add(...strips, common, lights, glare);

  yard.add(ground(low, glare));
  const walls = facades().map((f, i) => buildFacade(kit, f, rng(977 * (i + 1)), strips, common));
  const wallOf = (id: string) => walls.find(w => w.f.id === id)!;

  // A roof on each building, for whoever looks down on one.
  const roofing = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 1 });
  roofing.name = 'alley_roof';
  for (const b of ALLEY_BLOCKS) {
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(b.x1 - b.x0, b.z1 - b.z0).rotateX(-Math.PI / 2), roofing);
    roof.position.set((b.x0 + b.x1) / 2, b.floors * M, (b.z0 + b.z1) / 2);
    roof.castShadow = true;
    common.add(roof);
  }

  // ---- On the ground ----
  const stand = (model: Model, spec: string, x: number, z: number, rot = 0, o: Partial<PropOptions> = {}) => { const p = prop(kit, model, spec, { x, z, rot, ...o }); strips[strip(x)].add(p); return p; };
  // The cover, on its collision boxes.
  for (const c of ALLEY_COVER) stand(c.model as Model, c.node, c.x, c.z, c.rot);
  for (const [x, z, rot] of [[-2.4, 2.6, 0.3], [9.5, -1.2, 1.2], [-12, -19.4, 0.7], [12.5, 19.6, 2.1], [3.1, -12.2, 0.2], [-30.5, 9, 1.6], [30, -10, 0.5]]) stand('water_manhole_cover', '*', x, z, rot);

  // ---- On the walls (wall coordinates: x along it from its left end, y up, z out) ----
  const on = (wall: Wall, model: Model, spec: string, x: number, y: number, z = 0, o: Partial<PropOptions> = {}) => {
    const p = prop(kit, model, spec, { x, y, z, anchor: 'back', ...o });
    wall.at(x).add(p);
    return p;
  };
  const pipe = (wall: Wall, x: number) => {
    for (let y = 0.4; y < wall.height - 0.5; y += 1) on(wall, 'modular_metal_gutter', 'modular_metal_gutter_section', x, y, 0.1);
    on(wall, 'modular_metal_gutter', 'modular_metal_gutter_outlet', x, 0, 0.05);
  };
  /** Things left against a wall: boxes, or a stack of tyres. */
  const litter = (wall: Wall, x: number, random: () => number) => {
    if (random() < 0.55) {
      for (let i = 0, n = 1 + Math.floor(random() * 3); i < n; i++) {
        const p = wall.point(x - 0.6 + i * 0.62 + random() * 0.1, 0, 0.42 + random() * 0.2);
        stand('cardboard_box_01', '*', p.x, p.z, random() * 3, { scale: 1.2 + random() * 0.5 });
      }
    } else {
      const p = wall.point(x, 0, 0.5);
      for (let i = 0, n = 2 + Math.floor(random() * 3); i < n; i++) stand('old_tyre', '*', p.x, p.z, random() * 3, { rx: Math.PI / 2, y: i * 0.16 });
    }
  };
  const doors: { wall: Wall; x: number }[] = [];
  walls.forEach((wall, n) => {
    const random = rng(31 * (n + 1) + 7), K = KITS[wall.f.kit], slots = wall.f.slots;
    wall.cells.forEach((floor, k) => floor.forEach((token, i) => {
      const x = (i + 0.5) * M;
      // Air conditioners under some of the windows.
      if (k > 0) { if (token !== 'w' && random() < 0.09) on(wall, 'exterior_aircon_unit', K.aircon, x, k * M + 0.55, 0.02); return; }
      if (token.startsWith('d')) { doors.push({ wall, x }); return; }
      if (token === 'r') { on(wall, 'rollershutter_door', random() < 0.4 ? 'rollershutter_door_graffiti' : 'rollershutter_door', x, 0); return; }
      if (token !== 'w' || i === 0 || i === slots - 1) return;
      // Against a blank ground-floor wall: litter, a meter box, or nothing.
      const r = random();
      if (r < 0.25) litter(wall, x, random);
      else if (r < 0.33) on(wall, 'utility_box_01', 'utility_box_01_box', x, 0);
    }));
    // Downpipes: where one outer building ends and the next begins, and one on a long side of a block.
    if (!wall.f.corner) pipe(wall, 0.25);
    else if (slots >= 7 && wall.cells[0][4] !== '-') pipe(wall, 4 * M);
  });

  // The fire escape on the walk-up: decks at the first and second floors, stairs between and up.
  {
    const fe = new THREE.Group(), src = kit.modular_fire_escape, wall = wallOf('walkup:north');
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
    fe.position.set(7.5, 0, 0.8);
    wall.at(7.5).add(fe);
  }

  // A power pole at each end of the yard, cables across the yard between them and the walls, and more across the lanes.
  stand('modular_electricity_poles', 'preset_01_*', -16.6, -6.8, Math.PI / 2); stand('modular_electricity_poles', 'preset_02_*', 16.6, 6.8, -Math.PI / 2);
  const wire = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.5, metalness: 0.1 });
  wire.name = 'alley_wire';
  const A = new THREE.Vector3(-16.6, 5.5, -6.8), B = new THREE.Vector3(16.6, 5.5, 6.8), v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (const [a, b, sag] of [
    [A, B, 0.9], [A.clone().setY(5.0), v(-8, 7.4, 7.4), 0.5], [A.clone().setY(4.6), v(6, 8.2, 7.4), 0.7],
    [B.clone().setY(5.1), v(8, 7.6, -7.4), 0.55], [B.clone().setY(4.7), v(-9, 8.6, -7.4), 0.8], [v(-12, 8.6, -7.4), v(-10, 8.2, 7.4), 0.6],
    [v(-20, 8.4, -22.4), v(-18.5, 7.8, -16.6), 0.35], [v(12, 8.8, -22.4), v(14, 8.1, -16.6), 0.4],
    [v(20, 8.4, 22.4), v(18.5, 7.8, 16.6), 0.35], [v(-12, 8.8, 22.4), v(-14, 8.1, 16.6), 0.4],
    [v(0.1, 7.6, -12.5), v(5.9, 7.0, -11), 0.3], [v(-0.1, 7.0, 12.5), v(-5.9, 7.6, 11), 0.3],
  ] as [THREE.Vector3, THREE.Vector3, number][]) common.add(cable(a, b, sag, wire));

  // ---- Light ----
  const warm = 0xffa24a, cool = 0xd6e4ff;
  // Sodium street lamps: [x, z, the way it faces, x of the ground it lights]. The two in the yard cast its shadows.
  const lamps: [number, number, number, number, boolean][] = [
    [-13.4, -7.05, 0, -10.7, true], [13.4, 7.05, Math.PI, 10.7, true],
    [-9, -22.05, 0, -9, false], [19.5, -22.05, 0, 18, false], [9, 22.05, Math.PI, 9, false], [-19.5, 22.05, Math.PI, -18, false],
    [-35.55, 0, Math.PI / 2, -31, false], [35.55, 0, -Math.PI / 2, 31, false],
  ];
  for (const [x, z, rot, tx, shadow] of lamps) {
    stand('street_lamp_01', '*', x, z, rot);
    const fx = Math.sin(rot), fz = Math.cos(rot);
    const head = new THREE.Vector3(x + fx * 0.25, 3.55, z + fz * 0.25);
    const spot = new THREE.SpotLight(warm, 260, 22, 1.15, 0.7, 1.8);
    spot.position.copy(head);
    spot.target.position.set(tx, 0, z + fz * 5.3);
    if (shadow && !low) { spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.camera.near = 0.3; spot.shadow.camera.far = 22; spot.shadow.bias = -0.0006; spot.shadow.normalBias = 0.03; }
    const h = halo(warm, 2.6, 1.6); h.position.copy(head);
    const s = lightShaft(warm, 0.5, 3.5, 2.6); s.position.copy(head);
    lights.add(spot, spot.target); glare.add(h, s);
    if (shadow) { const fill = new THREE.PointLight(warm, 10, 9, 2); fill.position.copy(head); lights.add(fill); }
  }
  // Security lights over the doors. Every lamp is a cost in every lit surface, so only some of them
  // burn (the others are dead fixtures): none within 12 m of another, the most a preset allows.
  {
    const random = rng(4242), burning: THREE.Vector3[] = [], most = low ? 4 : 8;
    const order = doors.map(d => ({ d, key: random() })).sort((a, b) => a.key - b.key).map(o => o.d);
    for (const { wall, x } of order) {
      on(wall, 'security_light', 'security_light*', x, 2.95, 0.0);
      const at = wall.point(x, 2.9, 0.3), to = wall.point(x, 0, 2.2);
      if (burning.length >= most || burning.some(p => p.distanceTo(at) < 12)) continue;
      burning.push(at);
      const [color, power] = burning.length % 3 === 0 ? [0xffd2a0, 55] : [cool, 70];
      const spot = new THREE.SpotLight(color, power, 11, 0.95, 0.85, 1.9);
      spot.position.copy(at); spot.target.position.copy(to);
      const h = halo(color, 1.3, 1.3); h.position.copy(at);
      const s = lightShaft(color, 0.3, 3.0, 2.2); s.position.copy(at);
      lights.add(spot, spot.target); glare.add(h, s);
    }
  }
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

  // One draw per material for everything that stands still, in each strip.
  for (const g of [...strips, common]) mergeStatic(g, staticMeshes(g), { name: 'alley' });
  return yard;
}
