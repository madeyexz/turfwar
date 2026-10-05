import * as THREE from 'three';
import { WEAPONS, type WeaponId } from '../../shared/weapons';

/**
 * Sights and finishes for every weapon, applied once to the shared models in the asset registry
 * so the first-person view, third-person soldiers and map pickups all show the same gun.
 *
 * - Each optic is seated on the receiver by ray-casting the model's top surface under its
 *   footprint; the window centre becomes the gun's sight line (`userData.sightLine`), which the
 *   view model aligns with the camera when aiming down sights.
 * - Each gun gets its own colour scheme by material role, so the near-black imported models
 *   are recognisable at a glance.
 */
export type SightKind = 'dot' | 'holo' | 'tube' | 'acog' | 'builtin' | 'scope';
/** What the HUD draws at screen centre while aiming. */
export type Reticle = 'dot' | 'holo' | 'chevron' | 'none';

interface SightDef {
  kind: SightKind;
  /** Optic centre along the barrel (model x; the barrel points to -X, origin near the grip). */
  at?: number;
}

const SIGHTS: Record<WeaponId, SightDef> = {
  carbine: { kind: 'builtin' },
  graviton: { kind: 'builtin' },
  lancer: { kind: 'scope' },
  swift: { kind: 'scope' },
  longbow: { kind: 'scope' },
  sidearm: { kind: 'dot', at: -0.05 },
  magnum: { kind: 'dot', at: -0.07 },
  stinger: { kind: 'dot', at: -0.08 },
  hornet: { kind: 'dot', at: -0.07 },
  warden: { kind: 'dot', at: -0.07 },
  wasp: { kind: 'holo', at: -0.08 },
  viper: { kind: 'holo', at: -0.1 },
  scatter: { kind: 'holo', at: -0.12 },
  reaper: { kind: 'holo', at: -0.16 },
  thunder: { kind: 'holo', at: -0.16 },
  brawler: { kind: 'tube', at: -0.1 },
  kestrel: { kind: 'acog', at: -0.2 },
  marksman: { kind: 'acog', at: -0.1 },
  hammer: { kind: 'tube', at: -0.16 },
};

const RETICLE: Record<SightKind, Reticle> = { dot: 'dot', builtin: 'dot', tube: 'dot', holo: 'holo', acog: 'chevron', scope: 'none' };
export const reticleFor = (id: WeaponId): Reticle => RETICLE[SIGHTS[id].kind];

// ---- Finishes -------------------------------------------------------------------------------
/** Colours by material role: body (main metal/polymer), dark (furniture), accent (light parts), wood. */
interface Finish { body: number; dark: number; accent: number; wood?: number; metal?: number }
const FINISHES: Partial<Record<WeaponId, Finish>> = {
  hornet: { body: 0x3c4148, dark: 0xa58a5f, accent: 0x8f969e },            // gunmetal slide over a tan frame
  warden: { body: 0x2a2c30, dark: 0x6a4a2c, accent: 0xb4bac2, metal: 0.8 }, // nickel slide, black frame, wood grips
  wasp: { body: 0x56653b, dark: 0x22261c, accent: 0x8d9b6a },             // olive drab
  viper: { body: 0x485868, dark: 0x1d2329, accent: 0xe07a2c },            // urban blue-grey, orange detail
  reaper: { body: 0x2f343c, dark: 0x16181c, accent: 0x5c636c, wood: 0x8a5228 }, // blued steel, walnut
  thunder: { body: 0x1f2124, dark: 0xa38a5c, accent: 0x55595f },          // matte black, tan furniture
  brawler: { body: 0xb09a72, dark: 0x2a2a28, accent: 0x7d6b4d },          // flat dark earth
  kestrel: { body: 0xd5dadd, dark: 0x262a2e, accent: 0x5fb8d8 },          // arctic white, cyan detail
  marksman: { body: 0x4c5a3d, dark: 0x9c8660, accent: 0x2b2f26 },         // ranger green, tan stock
  swift: { body: 0xc4c9cc, dark: 0x5a6066, accent: 0x2e3236 },            // snow camo greys
  longbow: { body: 0x5a6a3c, dark: 0x8f7a52, accent: 0x2a2c26 },          // woodland green, desert tan
  hammer: { body: 0x3f444b, dark: 0x1b1d20, accent: 0xc8402e },           // gunmetal, red stripe
};
const ROLE: Record<string, keyof Finish> = {
  Main: 'body', Metal: 'body', Grey: 'body', Green: 'body',
  MainDark: 'dark', Black: 'dark', DarkMetal: 'dark',
  MainLight: 'accent', LightMetal: 'accent',
  Wood: 'wood', DarkWood: 'wood',
};

function refinish(model: THREE.Object3D, finish: Finish) {
  const cache = new Map<THREE.Material, THREE.Material>();
  model.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material) => {
      let out = cache.get(m);
      if (out) return out;
      const role = ROLE[m.name];
      const src = m as THREE.MeshStandardMaterial;
      const color = role === 'wood' ? finish.wood ?? finish.dark : role ? finish[role] as number : undefined;
      if (color === undefined || !src.isMeshStandardMaterial) { cache.set(m, m); return m; }
      const next = src.clone();
      next.color.setHex(color);
      if (role === 'wood') { next.metalness = 0.05; next.roughness = 0.75; }
      else { next.metalness = role === 'body' ? finish.metal ?? 0.45 : 0.3; next.roughness = role === 'body' ? 0.5 : 0.65; }
      cache.set(m, next);
      return next;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

// ---- Optics ---------------------------------------------------------------------------------
const opticMat = {
  body: new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.55, metalness: 0.5, flatShading: true }),
  glass: new THREE.MeshStandardMaterial({ color: 0x7fd8ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.22, depthWrite: false }),
  dot: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3a2a).multiplyScalar(2.5) }),
  amber: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb02e).multiplyScalar(2.2) }),
};
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const part = (g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z = 0) => {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = m !== opticMat.glass;
  g.add(mesh);
};

/** Optic built in gun model space (barrel -X) with its base at y = 0; returns the window centre height. */
function buildOptic(kind: SightKind): { group: THREE.Group; length: number; window: number } {
  const g = new THREE.Group();
  g.name = `Optic_${kind}`;
  if (kind === 'dot') {
    // Mini red dot: a low open hood (side walls and a top bar) over an angled window, for pistols.
    part(g, box(0.05, 0.012, 0.03), opticMat.body, 0, 0.006);
    part(g, box(0.042, 0.024, 0.004), opticMat.body, -0.002, 0.024, 0.013);
    part(g, box(0.042, 0.024, 0.004), opticMat.body, -0.002, 0.024, -0.013);
    part(g, box(0.034, 0.004, 0.03), opticMat.body, -0.004, 0.036, 0);
    part(g, box(0.002, 0.022, 0.022), opticMat.glass, -0.018, 0.023);
    part(g, box(0.004, 0.004, 0.004), opticMat.dot, 0.016, 0.014);
    return { group: g, length: 0.05, window: 0.023 };
  }
  if (kind === 'holo') {
    // Holographic sight: rectangular hood over a glowing window, on a base with the battery box.
    part(g, box(0.085, 0.014, 0.036), opticMat.body, 0, 0.007);
    part(g, box(0.006, 0.042, 0.004), opticMat.body, -0.025, 0.035, 0.017);
    part(g, box(0.006, 0.042, 0.004), opticMat.body, -0.025, 0.035, -0.017);
    part(g, box(0.006, 0.004, 0.038), opticMat.body, -0.025, 0.056, 0);
    part(g, box(0.006, 0.042, 0.004), opticMat.body, 0.02, 0.035, 0.017);
    part(g, box(0.006, 0.042, 0.004), opticMat.body, 0.02, 0.035, -0.017);
    part(g, box(0.006, 0.004, 0.038), opticMat.body, 0.02, 0.056, 0);
    part(g, box(0.05, 0.004, 0.004), opticMat.body, -0.002, 0.056, 0.017);
    part(g, box(0.05, 0.004, 0.004), opticMat.body, -0.002, 0.056, -0.017);
    part(g, box(0.002, 0.038, 0.03), opticMat.glass, -0.025, 0.035);
    part(g, box(0.03, 0.012, 0.028), opticMat.body, 0.036, 0.02);
    return { group: g, length: 0.09, window: 0.035 };
  }
  if (kind === 'tube' || kind === 'acog') {
    // Tube optic on a riser: a red dot (tube) or a longer prism sight with an amber tip (acog).
    const long = kind === 'acog';
    const len = long ? 0.13 : 0.1, r = long ? 0.021 : 0.019;
    part(g, box(len * 0.55, 0.012, 0.03), opticMat.body, 0, 0.006);
    part(g, box(0.02, 0.016, 0.022), opticMat.body, 0, 0.018);
    const tube = new THREE.CylinderGeometry(r, r * (long ? 1.15 : 1), len, 12, 1, true).rotateZ(Math.PI / 2);
    part(g, tube, opticMat.body, 0, 0.026 + r);
    const ring = new THREE.TorusGeometry(r, 0.004, 6, 16).rotateY(Math.PI / 2);
    part(g, ring, opticMat.body, -len / 2, 0.026 + r);
    part(g, ring, opticMat.body, len / 2, 0.026 + r);
    part(g, new THREE.CircleGeometry(r, 16).rotateY(-Math.PI / 2), opticMat.glass, -len / 2 + 0.002, 0.026 + r);
    if (long) part(g, box(0.006, 0.006, 0.006), opticMat.amber, -len / 2 + 0.02, 0.026 + 2 * r + 0.003);
    return { group: g, length: len, window: 0.026 + r };
  }
  return { group: g, length: 0, window: 0 };
}

/** Highest point of the model's meshes under the footprint [x0, x1] along the barrel (model space). */
function topAt(model: THREE.Object3D, x0: number, x1: number) {
  model.updateMatrixWorld(true);
  const inverse = model.matrixWorld.clone().invert();
  const meshes: THREE.Mesh[] = [];
  model.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  // Some imported meshes have inverted faces on top: test both sides, then restore the materials.
  const sides = meshes.map(m => (Array.isArray(m.material) ? m.material : [m.material]).map(mat => [mat, mat.side] as const)).flat();
  for (const [mat] of sides) mat.side = THREE.DoubleSide;
  const ray = new THREE.Raycaster();
  let top = -Infinity;
  for (let i = 0; i <= 6; i++) for (const z of [-0.008, 0, 0.008]) {
    const x = x0 + (x1 - x0) * i / 6;
    const origin = new THREE.Vector3(x, 2, z).applyMatrix4(model.matrixWorld);
    ray.set(origin, new THREE.Vector3(0, -1, 0).transformDirection(model.matrixWorld));
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) top = Math.max(top, hit.point.applyMatrix4(inverse).y);
  }
  for (const [mat, side] of sides) mat.side = side;
  return top;
}

/** Refinish every gun and mount its optic; sets `userData.sightLine` (model-space height) where an optic was added. */
export function applyOptics(weapons: Map<string, THREE.Object3D>) {
  for (const [id, def] of Object.entries(SIGHTS) as [WeaponId, SightDef][]) {
    const model = weapons.get(WEAPONS[id].model);
    if (!model) continue;
    const finish = FINISHES[id];
    if (finish) refinish(model, finish);
    if (def.at === undefined) continue;
    const optic = buildOptic(def.kind);
    const top = topAt(model, def.at - optic.length / 2, def.at + optic.length / 2);
    if (!Number.isFinite(top)) continue;
    optic.group.position.set(def.at, top - 0.002, 0);
    model.add(optic.group);
    model.userData.sightLine = top - 0.002 + optic.window;
  }
}
