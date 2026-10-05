import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WEAPONS, type WeaponId } from '../../shared/weapons';

/**
 * Sights and finishes for every weapon, applied once to the shared models in the asset registry
 * so the first-person view, third-person soldiers and map pickups all show the same gun.
 *
 * Optics are modelled in gun space (barrel along -X, up +Y, origin near the grip) from smooth
 * lathe profiles and bevelled housings on a picatinny rail, then merged into three meshes:
 * anodised body (vertex-coloured, so rubber and accent rings need no extra draw call), coated
 * glass, and the glowing reticle. Each optic's lens axis becomes the gun's sight line
 * (`userData.sightLine`), which the view model centres on screen when aiming.
 */
export type SightKind = 'dot' | 'holo' | 'tube' | 'acog' | 'builtin' | 'scope';
/** What the HUD draws at screen centre while aiming. */
export type Reticle = 'dot' | 'holo' | 'chevron' | 'none';

/** Sniper scope fitted around the model's own (low-poly) scope: lens axis, extent and radii. */
interface ScopeFit { front: number; rear: number; axis: number; mount: number; rBell: number; rTube: number; rEye: number; bellLen: number; eyeLen: number }
interface SightDef {
  kind: SightKind;
  /** Optic centre along the barrel (model x; the barrel points to -X). */
  at?: number;
  scope?: ScopeFit;
}

const SIGHTS: Record<WeaponId, SightDef> = {
  carbine: { kind: 'builtin' },
  graviton: { kind: 'builtin' },
  // Fits measured from each model's scope (top and underside rays): the new body encloses the old.
  lancer: { kind: 'scope', scope: { front: -0.385, rear: -0.055, axis: 0.176, mount: 0.135, rBell: 0.045, rTube: 0.039, rEye: 0.03, bellLen: 0.07, eyeLen: 0.1 } },
  swift: { kind: 'scope', scope: { front: -0.512, rear: 0.012, axis: 0.117, mount: 0.069, rBell: 0.039, rTube: 0.019, rEye: 0.031, bellLen: 0.135, eyeLen: 0.11 } },
  longbow: { kind: 'scope', scope: { front: -0.512, rear: -0.008, axis: 0.16, mount: 0.117, rBell: 0.037, rTube: 0.019, rEye: 0.031, bellLen: 0.15, eyeLen: 0.1 } },
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
  hammer: { kind: 'acog', at: -0.16 },
};

// Magnified optics are viewed through a full-screen eyepiece overlay instead of the 3D model.
const RETICLE: Record<SightKind, Reticle> = { dot: 'dot', builtin: 'dot', tube: 'dot', holo: 'holo', acog: 'none', scope: 'none' };
export const reticleFor = (id: WeaponId): Reticle => RETICLE[SIGHTS[id].kind];
/** Eyepiece overlay drawn while fully aimed: a sniper scope, a 2× prism, or none (look through the 3D sight). */
export type Overlay = 'sniper' | 'prism' | undefined;
export const overlayFor = (id: WeaponId): Overlay => SIGHTS[id].kind === 'scope' ? 'sniper' : SIGHTS[id].kind === 'acog' ? 'prism' : undefined;

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

// ---- Optic modelling kit --------------------------------------------------------------------
const MATERIALS = {
  // Hard-anodised aluminium; rubber, rail and accents differ by vertex colour.
  body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.6, side: THREE.DoubleSide }),
  // Coated lens: mostly see-through, but reflective enough to read as glass in the environment light.
  glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.03, metalness: 0.9, transparent: true, opacity: 0.34, depthWrite: false, envMapIntensity: 1.6 }),
  // Emissive reticles above the bloom threshold, so they glow even at the hip.
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(3, 3, 3) }),
};
type Bucket = keyof typeof MATERIALS;

const C = {
  anodised: 0x1c1f23, rail: 0x15171a, rubber: 0x0a0a0b, steel: 0x6d737a, screw: 0x9aa1a8,
  coatBlue: 0x4f8fc4, coatAmber: 0xc89a46, coatGreen: 0x5fae86,
  red: 0xff2a1a, amber: 0xffa21e,
};
/** Accent ring/cap colour by optic family. */
const ACCENT: Record<SightKind, number> = { dot: 0xb3332a, holo: 0xd9772a, tube: 0x3f74b8, acog: 0xc9932f, scope: 0x2f9a8c, builtin: 0x888888 };

type Paint = number | ((p: THREE.Vector3) => number);

class Kit {
  private parts: Record<Bucket, THREE.BufferGeometry[]> = { body: [], glass: [], glow: [] };

  add(bucket: Bucket, geometry: THREE.BufferGeometry, paint: Paint, x = 0, y = 0, z = 0, flat = false) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (flat) g.computeVertexNormals();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const p = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      c.setHex(typeof paint === 'number' ? paint : paint(p));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.translate(x, y, z);
    this.parts[bucket].push(g);

  }

  build(name: string) {
    const group = new THREE.Group();
    group.name = name;
    for (const bucket of Object.keys(this.parts) as Bucket[]) {
      if (!this.parts[bucket].length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(this.parts[bucket])!, MATERIALS[bucket]);
      mesh.castShadow = bucket === 'body';
      mesh.renderOrder = bucket === 'glass' ? 2 : bucket === 'glow' ? 3 : 0;
      group.add(mesh);
    }
    return group;
  }
}

const roundedRect = (w: number, h: number, r: number, cx = 0, cy = 0) => {
  const s = new THREE.Shape(), x = cx - w / 2, y = cy - h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
};

/** Box (x length, y height, z width) with rounded vertical edges and bevelled faces, centred. */
function roundedBox(w: number, h: number, d: number, r = Math.min(w, h, d) * 0.22) {
  const b = Math.min(0.0012, d * 0.1);
  const g = new THREE.ExtrudeGeometry(roundedRect(w - 2 * b, h - 2 * b, Math.max(0.0004, r - b)), {
    depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 5,
  });
  return g.translate(0, 0, -(d - 2 * b) / 2);
}

/** Front-view frame (width along z, height along y, optional window hole) extruded along the barrel. */
function hood(w: number, h: number, r: number, hole: [number, number, number], length: number) {
  const shape = roundedRect(w, h, r);
  shape.holes.push(roundedRect(hole[0], hole[1], hole[2]));
  const b = 0.0007;
  const g = new THREE.ExtrudeGeometry(shape, { depth: length - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.8, bevelSegments: 2, curveSegments: 6 });
  return g.translate(0, 0, -(length - 2 * b) / 2).rotateY(Math.PI / 2);
}

/** Smooth body of revolution around the barrel axis: profile [radius, distance forward from the rear]. */
const lathe = (profile: [number, number][], segments = 32) =>
  new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), segments).rotateZ(Math.PI / 2);

/** Cylinder along an axis with knurled (alternately inset) sides. */
function knurl(r: number, h: number, teeth = 18, axis: 'y' | 'z' | 'x' = 'y') {
  const g = new THREE.CylinderGeometry(r, r, h, teeth * 2, 1).toNonIndexed();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), d = Math.hypot(x, z);
    if (d < r * 0.6) continue;
    const step = Math.round((Math.atan2(z, x) / (Math.PI * 2)) * teeth * 2);
    const k = ((step % 2) + 2) % 2 ? 0.9 : 1;
    pos.setXYZ(i, x * k, pos.getY(i), z * k);
  }
  g.computeVertexNormals();
  return axis === 'z' ? g.rotateX(Math.PI / 2) : axis === 'x' ? g.rotateZ(Math.PI / 2) : g;
}

/** Flat rounded-rectangle lens pane facing the rear (+X). */
const pane = (w: number, h: number, r: number) => new THREE.ShapeGeometry(roundedRect(w, h, r), 8).rotateY(Math.PI / 2);
const disc = (r: number, segments = 32) => new THREE.CircleGeometry(r, segments).rotateY(Math.PI / 2); // faces +X (rear)
const cyl = (r: number, h: number, axis: 'x' | 'y' | 'z' = 'y', segments = 16) => {
  const g = new THREE.CylinderGeometry(r, r, h, segments);
  return axis === 'z' ? g.rotateX(Math.PI / 2) : axis === 'x' ? g.rotateZ(Math.PI / 2) : g;
};

/** Picatinny rail from x0 to x1 with its base at y; returns the rail top. */
function rail(kit: Kit, x0: number, x1: number, y: number) {
  const len = x1 - x0, mid = (x0 + x1) / 2;
  kit.add('body', roundedBox(len, 0.0036, 0.019, 0.0008), C.rail, mid, y + 0.0018);
  const n = Math.max(2, Math.floor(len / 0.01));
  for (let i = 0; i < n; i++) kit.add('body', roundedBox(0.0052, 0.0032, 0.0214, 0.0006), C.rail, x0 + (i + 0.5) * (len / n), y + 0.0036 + 0.0016);
  return y + 0.0068;
}

/** Scope ring: band around the tube, base block down to `floor`, side ears and four screws. */
function scopeRing(kit: Kit, x: number, axis: number, r: number, floor: number) {
  const band = lathe([[r, 0], [r + 0.004, 0.0015], [r + 0.0045, 0.0045], [r + 0.0045, 0.0105], [r + 0.004, 0.0135], [r, 0.015]]);
  kit.add('body', band, C.anodised, x + 0.0075, axis);
  const baseH = axis - r - floor + 0.004;
  kit.add('body', roundedBox(0.016, baseH, 0.022, 0.003), C.anodised, x, floor + baseH / 2);
  kit.add('body', knurl(0.0042, 0.006, 10, 'z'), C.steel, x, floor + 0.004, 0.014);
  const earW = 2 * (r + 0.0095);
  kit.add('body', roundedBox(0.014, 0.005, earW, 0.002), C.anodised, x, axis - 0.0025);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    kit.add('body', cyl(0.0021, 0.0026, 'y', 12), C.screw, x + sx * 0.0038, axis + 0.0013, sz * (r + 0.0055));
  }
}

/** Turret: knurled cap on a collar, with an accent index line; axis 'y' (elevation) or 'z' (windage). */
function turret(kit: Kit, x: number, y: number, z: number, r: number, axis: 'y' | 'z', accent: number, sign = 1) {
  const d = (v: number) => sign * v;
  if (axis === 'y') {
    kit.add('body', cyl(r * 1.15, 0.004, 'y', 24), C.anodised, x, y + 0.002);
    kit.add('body', knurl(r, 0.011, 20), C.anodised, x, y + 0.0095);
    kit.add('body', cyl(r * 0.92, 0.0015, 'y', 24), C.steel, x, y + 0.0158);
    kit.add('body', roundedBox(r * 0.9, 0.0008, 0.0012, 0.0002), accent, x - r * 0.45, y + 0.0167);
  } else {
    kit.add('body', cyl(r * 1.15, 0.004, 'z', 24), C.anodised, x, y, z + d(0.002));
    kit.add('body', knurl(r, 0.011, 20, 'z'), C.anodised, x, y, z + d(0.0095));
    kit.add('body', cyl(r * 0.92, 0.0015, 'z', 24), C.steel, x, y, z + d(0.0158));
    kit.add('body', roundedBox(r * 0.9, 0.0012, 0.0008, 0.0002), accent, x - r * 0.45, y, z + d(0.0167));
  }
}

// ---- Optic builders (gun model space, mount surface at y = 0 unless noted) ---------------------

/** Pistol mini red dot: bevelled plate, low rear housing, thin front frame round a coated window, glowing dot. */
function miniDot(kit: Kit) {
  const accent = ACCENT.dot, plate = 0.0045;
  kit.add('body', roundedBox(0.05, plate, 0.026, 0.004), C.anodised, 0, plate / 2);
  kit.add('body', roundedBox(0.03, 0.0075, 0.026, 0.0025), C.anodised, 0.009, plate + 0.00375);
  const win = plate + 0.011;
  kit.add('body', hood(0.026, 0.022, 0.0055, [0.0186, 0.0142, 0.0035], 0.011), C.anodised, -0.0155, win);
  for (const z of [-0.0133, 0.0133]) kit.add('body', cyl(0.0022, 0.0014, 'z', 16), accent, 0.012, plate + 0.0045, z);
  kit.add('body', knurl(0.0024, 0.0016, 8, 'y'), C.steel, 0.004, plate + 0.0083);
  kit.add('body', roundedBox(0.004, 0.0026, 0.004, 0.0008), C.rubber, -0.006, plate + 0.0088);
  kit.add('glass', pane(0.0184, 0.014, 0.0034), C.coatAmber, -0.0155, win);
  kit.add('glow', disc(0.0011), C.red, -0.015, win);
  return { length: 0.05, window: win };
}

/** Holographic sight: rail clamp base, tunnel hood with two coated windows, buttons, battery cap, ring-and-dot reticle. */
function holoSight(kit: Kit) {
  const accent = ACCENT.holo;
  const top = rail(kit, -0.045, 0.045, 0);
  kit.add('body', roundedBox(0.086, 0.012, 0.03, 0.004), C.anodised, 0, top + 0.006);
  kit.add('body', knurl(0.0042, 0.006, 10, 'z'), C.steel, 0.02, top + 0.005, 0.017);
  const base = top + 0.012, win = base + 0.016;
  kit.add('body', hood(0.036, 0.032, 0.0055, [0.0286, 0.0236, 0.0035], 0.056), C.anodised, -0.014, win);
  kit.add('body', roundedBox(0.03, 0.0035, 0.036, 0.0015), C.anodised, -0.014, base + 0.032 + 0.0012);
  for (const z of [-0.0065, 0.0065]) kit.add('body', cyl(0.0034, 0.0028, 'y', 18), accent, 0.03, base + 0.0014, z);
  kit.add('body', knurl(0.0068, 0.009, 14, 'z'), C.anodised, -0.03, base - 0.004, 0.0195);
  kit.add('glass', pane(0.0284, 0.0234, 0.0034).rotateY(Math.PI), C.coatBlue, -0.041, win);
  kit.add('glass', pane(0.0284, 0.0234, 0.0034), C.coatAmber, 0.0125, win);
  kit.add('glow', new THREE.TorusGeometry(0.0046, 0.00032, 6, 48).rotateY(Math.PI / 2), C.red, 0.0118, win);
  kit.add('glow', disc(0.00065), C.red, 0.0118, win);
  return { length: 0.09, window: win };
}

/** Tube red dot: rail, riser mount with ring and screws, lathe body with hood, turrets, lenses and dot. */
function tubeDot(kit: Kit) {
  const accent = ACCENT.tube, r = 0.0165, len = 0.072;
  const top = rail(kit, -0.04, 0.04, 0);
  const axis = top + 0.009 + 0.006 + r;
  kit.add('body', roundedBox(0.042, 0.009, 0.026, 0.003), C.anodised, 0, top + 0.0045);
  kit.add('body', knurl(0.0042, 0.006, 10, 'z'), C.steel, 0.01, top + 0.0045, 0.015);
  scopeRing(kit, 0, axis, r, top + 0.009);
  const rear = len / 2;
  // Open at both ends (double-sided), so aiming looks down the tube to the dot.
  const body = lathe([[0.0122, 0.003], [0.0138, 0.0], [r, 0], [r, 0.006], [r - 0.0012, 0.008], [r - 0.0012, 0.05], [r + 0.0012, 0.054], [r + 0.002, 0.064], [r + 0.002, len], [r - 0.0008, len], [r - 0.0008, len - 0.003]]);
  kit.add('body', body, p => (-p.x > 0.054 && -p.x < 0.058 ? accent : C.anodised), rear, axis);
  turret(kit, -0.004, axis + r - 0.0015, 0, 0.0062, 'y', accent);
  turret(kit, -0.004, axis, r - 0.0015, 0.0062, 'z', accent);
  kit.add('glass', disc(0.0124), C.coatAmber, rear - 0.0032, axis);
  kit.add('glass', disc(r - 0.001).rotateY(Math.PI), C.coatBlue, rear - len + 0.0032, axis);
  kit.add('glow', disc(0.0009), C.red, rear - 0.0036, axis);
  return { length: 0.08, window: axis };
}

/** Prism sight (2×): rail clamp with thumb screws, bevelled prism housing, objective bell, rubber eyepiece, fibre and chevron. */
function prismSight(kit: Kit) {
  const accent = ACCENT.acog;
  const top = rail(kit, -0.06, 0.06, 0);
  kit.add('body', roundedBox(0.062, 0.008, 0.028, 0.003), C.anodised, 0, top + 0.004);
  for (const x of [-0.016, 0.016]) kit.add('body', knurl(0.0048, 0.007, 12, 'z'), C.steel, x, top + 0.004, 0.017);
  const base = top + 0.008;
  const profile = new THREE.Shape();
  profile.moveTo(0.03, 0); profile.lineTo(0.03, 0.025); profile.quadraticCurveTo(0.03, 0.03, 0.022, 0.032);
  profile.lineTo(-0.02, 0.032); profile.quadraticCurveTo(-0.03, 0.031, -0.035, 0.025); profile.lineTo(-0.035, 0); profile.lineTo(0.03, 0);
  const b = 0.0016;
  const housing = new THREE.ExtrudeGeometry(profile, { depth: 0.03 - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 8 }).translate(0, 0, -(0.03 - 2 * b) / 2);
  kit.add('body', housing, C.anodised, 0, base);
  const axis = base + 0.017;
  const objective = lathe([[0, 0.034], [0.0172, 0.034], [0.0172, 0.0365], [0.0202, 0.0365], [0.0202, 0.024], [0.019, 0.02], [0.0158, 0.008], [0.0158, 0], [0.012, 0]]);
  kit.add('body', objective, p => (-p.x > 0.0205 && -p.x < 0.024 ? accent : C.anodised), -0.035, axis);
  const eyepiece = lathe([[0, 0.004], [0.0118, 0.004], [0.0134, 0], [0.0148, 0], [0.0148, 0.012], [0.0138, 0.0135], [0.0138, 0.022], [0.012, 0.022]]);
  kit.add('body', eyepiece, p => (-p.x < 0.012 ? C.rubber : C.anodised), 0.052, axis);
  kit.add('body', roundedBox(0.044, 0.0035, 0.0062, 0.0012), C.anodised, -0.003, base + 0.0335);
  kit.add('glow', cyl(0.0016, 0.04, 'x', 10), C.amber, -0.003, base + 0.0352);
  turret(kit, 0.004, base + 0.032, 0, 0.0055, 'y', accent);
  turret(kit, 0.004, axis, 0.015, 0.0055, 'z', accent);
  kit.add('glass', disc(0.0118), C.coatGreen, 0.0478, axis);
  kit.add('glass', disc(0.017).rotateY(Math.PI), C.coatBlue, -0.0688, axis);
  const chevron = new THREE.Shape();
  chevron.moveTo(0, 0.0016); chevron.lineTo(0.0014, -0.0008); chevron.lineTo(0.0008, -0.0008); chevron.lineTo(0, 0.0006); chevron.lineTo(-0.0008, -0.0008); chevron.lineTo(-0.0014, -0.0008); chevron.lineTo(0, 0.0016);
  kit.add('glow', new THREE.ShapeGeometry(chevron).rotateY(Math.PI / 2), C.amber, 0.0474, axis - 0.0004);
  return { length: 0.12, window: axis };
}

/** Sniper scope fitted around the model's own: bell, tube, saddle with three turrets, rubber eyecup, two rings on a rail. */
function sniperScope(kit: Kit, f: ScopeFit) {
  const accent = ACCENT.scope;
  const L = f.rear - f.front, { rBell: rb, rTube: rt, rEye: re, eyeLen: el, bellLen: bl } = f;
  const saddle = el + Math.min(0.06, (L - el - bl) * 0.35), sr = rt * 1.2;
  const profile: [number, number][] = [
    [0, 0.006], [re * 0.8, 0.006], [re * 0.86, 0], [re, 0], [re, el * 0.42], // rubber eyecup
    [re * 1.03, el * 0.42], [re * 1.03, el * 0.48], [re * 0.97, el * 0.48], [re * 0.97, el * 0.82], [re * 0.9, el], // ocular, power ring
    [rt, el + 0.016], [rt, saddle - 0.024], [sr, saddle - 0.017], [sr, saddle + 0.017], [rt, saddle + 0.024], // saddle
    [rt, L - bl - 0.03], [rb * 0.93, L - bl], [rb, L - 0.022], // objective bell (full width over the old one)
    [rb * 1.035, L - 0.022], [rb * 1.035, L - 0.004], [rb * 0.88, L], [rb * 0.88, L - 0.005], [0, L - 0.005],
  ];
  const tint = (p: THREE.Vector3) => {
    const h = -p.x;
    if (h < el * 0.42) return C.rubber;
    if ((h > el * 0.42 && h < el * 0.48) || (h > L - 0.022 && h < L - 0.004)) return accent;
    return C.anodised;
  };
  kit.add('body', lathe(profile, 40), tint, f.rear, f.axis);
  const tx = f.rear - saddle;
  turret(kit, tx, f.axis + sr - 0.002, 0, rt * 0.62 + 0.004, 'y', accent);
  turret(kit, tx, f.axis, sr - 0.002, rt * 0.62 + 0.004, 'z', accent);
  turret(kit, tx, f.axis, -(sr - 0.002), rt * 0.5 + 0.003, 'z', accent, -1);
  const ringRear = f.rear - el - 0.022, ringFront = f.front + bl + 0.02;
  const top = rail(kit, ringFront - 0.022, ringRear + 0.022, f.mount);
  for (const x of [ringRear, ringFront]) scopeRing(kit, x, f.axis, rt, top);
  kit.add('glass', disc(re * 0.8), C.coatGreen, f.rear - 0.0058, f.axis);
  kit.add('glass', disc(rb * 0.88).rotateY(Math.PI), C.coatBlue, f.front + 0.0052, f.axis);
  kit.add('glow', disc(0.0007), C.red, f.rear - 0.0062, f.axis);
}

/** Highest point of the model's meshes under the footprint [x0, x1] along the barrel (model space). */
export function topAt(model: THREE.Object3D, x0: number, x1: number) {
  model.updateMatrixWorld(true);
  const inverse = model.matrixWorld.clone().invert();
  const meshes: THREE.Mesh[] = [];
  model.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const ray = new THREE.Raycaster();
  let top = -Infinity;
  for (let i = 0; i <= 6; i++) for (const z of [-0.008, 0, 0.008]) {
    const x = x0 + (x1 - x0) * i / 6;
    const origin = new THREE.Vector3(x, 2, z).applyMatrix4(model.matrixWorld);
    ray.set(origin, new THREE.Vector3(0, -1, 0).transformDirection(model.matrixWorld));
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) top = Math.max(top, hit.point.applyMatrix4(inverse).y);
  }
  return top;
}

const BUILDERS = { dot: miniDot, holo: holoSight, tube: tubeDot, acog: prismSight } as const;

/** Refinish every gun and mount its optic; sets `userData.sightLine` (model-space height) where one was added. */
export function applyOptics(weapons: Map<string, THREE.Object3D>) {
  for (const [id, def] of Object.entries(SIGHTS) as [WeaponId, SightDef][]) {
    const model = weapons.get(WEAPONS[id].model);
    if (!model) continue;
    const finish = FINISHES[id];
    if (finish) refinish(model, finish);
    const kit = new Kit();
    if (def.scope) {
      sniperScope(kit, def.scope);
      model.add(kit.build(`Optic_${id}`));
      model.userData.sightLine = def.scope.axis;
      continue;
    }
    if (def.at === undefined || def.kind === 'builtin' || def.kind === 'scope') continue;
    const optic = BUILDERS[def.kind](kit);
    const top = topAt(model, def.at - optic.length / 2, def.at + optic.length / 2);
    if (!Number.isFinite(top)) continue;
    const group = kit.build(`Optic_${id}`);
    group.position.set(def.at, top - 0.0015, 0);
    model.add(group);
    model.userData.sightLine = top - 0.0015 + optic.window;
  }
}
