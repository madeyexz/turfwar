import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WEAPONS, type Attachments, type WeaponDef, type WeaponId } from '../../shared/weapons';
import { settings, type OpticDetail, type ReticleColor } from '../game/settings';
import { lensMaterial, windowMaterial, type Sight } from './sights';

/**
 * Gun fitting for BeGone's arsenal: every weapon's finish, hand and muzzle points, and the visible
 * attachments (optic, suppressor, laser, flashlight, ammo counter, extended clip, recoil pad, ammo
 * band), shared by the first-person view and third-person soldiers.
 *
 * Optics are modelled in gun space (barrel along -X, up +Y, origin at the grip) from smooth lathe
 * profiles, chamfered housings, clamps, screws and knurled turrets on a picatinny rail, then merged
 * into one mesh per material: anodised body (vertex-coloured, so steel, rail and accent rings need no
 * extra draw call), rubber, coated glass and glowing fibre/tritium. In first person the see-through
 * window (the tube red dot's round objective, the holo's rectangular window) and the ocular lens (ACOG, scopes) are separate meshes with the sight-picture
 * materials of sights.ts. Iron sights are modelled too (front post and rear aperture, three-dot pistol
 * sights). The fitted optic's axis is the sight line the view model centres when aiming.
 */
export type OpticId = 'irons' | 'reflex' | 'holo' | 'acog' | 'x4' | 'x6';
/** What the HUD draws at screen centre while aiming. */
export type Reticle = 'dot' | 'holo' | 'chevron' | 'none';
/** Eyepiece overlay drawn while fully aimed: a sniper scope, a prism, or none (look through the 3D sight). */
export type Overlay = 'sniper' | 'prism' | undefined;

const opticOf = (w: WeaponDef | WeaponId): OpticId => typeof w === 'string' ? 'irons' : (w.attachments.optic as OpticId | undefined) ?? 'irons';
const RETICLE: Record<OpticId, Reticle> = { irons: 'none', reflex: 'dot', holo: 'holo', acog: 'none', x4: 'none', x6: 'none' };
/** Reticle of the fitted optic (pass the WeaponDef so attachments count; a bare id means iron sights). */
export const reticleFor = (w: WeaponDef | WeaponId): Reticle => (typeof w !== 'string' && w.class === 'melee') ? 'none' : RETICLE[opticOf(w)];
/** Magnified optics are viewed through a full-screen eyepiece instead of the 3D model: x6 is a sniper scope, ACOG and x4 prisms. */
export const overlayFor = (w: WeaponDef): Overlay => {
  const o = opticOf(w);
  return o === 'x6' ? 'sniper' : o === 'acog' || o === 'x4' ? 'prism' : undefined;
};

// ---- Per-gun fitting (model space: barrel -X, up +Y, origin at the grip; tools/import-guns.ts) ----
type V = [number, number, number];
export interface GunFit {
  /** Shooting-hand grip, support hand, muzzle, magazine (reload hand target). */
  grip: V; fore: V; muzzle: V; mag: V;
  /** Spare magazine shown in the support hand while reloading (weapons.glb). */
  magModel?: string;
  /** Height of the iron-sight line; centre x of a rail optic. */
  irons: number; optic: number;
  /** Suppressor scale (1 = rifle) and the side rail (laser/flashlight); z > 0 is the gun's left side. */
  bore: number; rail: V;
  /** Magazine floor for the extended clip: point, tilt (rad), width along x and thickness; 'tube' extends a shotgun's tube. */
  clip: { at: V; tilt: number; w: number; d: number; tube?: boolean };
  /** Butt end for the recoil pad (x, y, height). */
  butt?: V;
  kind: 'long' | 'pistol' | 'knife';
}
export const GUN_FIT: Record<WeaponId, GunFit> = {
  knife: { grip: [0.005, 0, 0], fore: [0.04, -0.06, 0.04], muzzle: [-0.28, 0, 0], mag: [0, 0, 0], irons: 0, optic: 0, bore: 0, rail: [0, 0, 0], clip: { at: [0, 0, 0], tilt: 0, w: 0, d: 0 }, kind: 'knife' },
  mp5: { grip: [0.005, 0, 0], fore: [-0.27, -0.045, 0], muzzle: [-0.39, 0.086, 0], mag: [-0.15, -0.06, 0], magModel: 'Gun_SMG_Ammo', irons: 0.151, optic: -0.1, bore: 0.85, rail: [-0.31, 0.09, 0.03], clip: { at: [-0.142, -0.139, 0], tilt: 0, w: 0.05, d: 0.028 }, butt: [0.35, 0.06, 0.1], kind: 'long' },
  mp7: { grip: [0.005, 0, 0], fore: [-0.17, 0.035, 0], muzzle: [-0.33, 0.085, 0], mag: [-0.1, -0.07, 0], magModel: 'Gun_SMG_Ammo', irons: 0.142, optic: -0.08, bore: 0.8, rail: [-0.24, 0.1, 0.032], clip: { at: [-0.125, -0.128, 0], tilt: 0, w: 0.045, d: 0.024 }, butt: [0.27, 0.04, 0.1], kind: 'long' },
  m4a1: { grip: [0.005, 0, 0], fore: [-0.33, 0.035, 0], muzzle: [-0.71, 0.13, 0], mag: [-0.2, -0.05, 0], magModel: 'Gun_SMG_Ammo', irons: 0.19, optic: -0.14, bore: 1, rail: [-0.37, 0.13, 0.03], clip: { at: [-0.18, -0.135, 0], tilt: -0.3, w: 0.05, d: 0.026 }, butt: [0.31, 0.07, 0.16], kind: 'long' },
  m110: { grip: [0.005, 0, 0], fore: [-0.4, -0.04, 0], muzzle: [-0.935, 0.05, 0], mag: [-0.266, -0.01, 0], magModel: 'Gun_SMG_Ammo', irons: 0.095, optic: -0.155, bore: 0.95, rail: [-0.44, 0.022, 0.024], clip: { at: [-0.266, -0.026, 0], tilt: 0, w: 0.078, d: 0.022 }, butt: [0.312, -0.045, 0.17], kind: 'long' },
  m249: { grip: [0.005, 0, 0], fore: [-0.42, 0.12, 0], muzzle: [-1.02, 0.18, 0], mag: [-0.24, -0.08, 0], irons: 0.279, optic: 0, bore: 1.25, rail: [-0.56, 0.17, 0.04], clip: { at: [-0.23, -0.125, 0.045], tilt: 0, w: 0.14, d: 0.1 }, butt: [0.372, 0.1, 0.16], kind: 'long' },
  m1014: { grip: [0.025, -0.02, 0], fore: [-0.45, 0.0, 0], muzzle: [-0.79, 0.052, 0], mag: [-0.4, 0.0, 0], irons: 0.082, optic: -0.15, bore: 1.15, rail: [-0.55, 0.03, 0.026], clip: { at: [-0.71, 0.0, 0], tilt: 0, w: 0.05, d: 0.03, tube: true }, butt: [0.29, -0.05, 0.1], kind: 'long' },
  m9a1: { grip: [0.005, 0, 0], fore: [0.02, -0.05, 0.03], muzzle: [-0.295, 0.135, 0], mag: [0.025, -0.074, 0], irons: 0.174, optic: -0.05, bore: 0.62, rail: [-0.205, 0.064, 0], clip: { at: [0.02, -0.082, 0], tilt: 0.28, w: 0.042, d: 0.026 }, kind: 'pistol' },
};
export const vec = (v: V, out = new THREE.Vector3()) => out.set(v[0], v[1], v[2]);

// ---- Finishes -------------------------------------------------------------------------------
/** Colours by material role: body (main metal/polymer), dark (furniture), accent (light parts), wood, edge (knife edge). */
interface Finish { body: number; dark: number; accent: number; wood?: number; edge?: number; metal?: number }
const FINISHES: Record<WeaponId, Finish> = {
  knife: { body: 0x2c3027, dark: 0x16171a, accent: 0x34373b, edge: 0xc9ced3, metal: 0.7 },  // coated blade, olive grip
  mp5: { body: 0x2a2d31, dark: 0x141518, accent: 0x50555c },                               // HK black
  mp7: { body: 0x474d3e, dark: 0x1a1c18, accent: 0x6a705e },                               // ranger-green polymer
  m4a1: { body: 0x26282b, dark: 0x3a3d41, accent: 0x6b7077 },                              // matte black
  m110: { body: 0x3a3833, dark: 0x2a2b2c, accent: 0x85775a },                              // flat-dark-earth stock, black steel
  m249: { body: 0x3c4236, dark: 0x1c1e1a, accent: 0x5d6352 },                              // parkerized olive
  m1014: { body: 0x1e2023, dark: 0x2c2e31, accent: 0x8d939a, metal: 0.55 },                // black, bright bolt
  m9a1: { body: 0x2a2c30, dark: 0x141516, accent: 0x303236, wood: 0x1f2022, metal: 0.6 },  // black slide and grips
};
const ROLE: Record<string, keyof Finish> = {
  Main: 'body', Metal: 'body', Grey: 'body', Green: 'body',
  MainDark: 'dark', Black: 'dark', Black2: 'dark', DarkMetal: 'dark',
  MainLight: 'accent', LightMetal: 'accent', LightMetal2: 'edge',
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
      const color = role === 'wood' ? finish.wood ?? finish.dark : role === 'edge' ? finish.edge ?? finish.accent : role ? finish[role] as number : undefined;
      if (color === undefined || !src.isMeshStandardMaterial) { cache.set(m, m); return m; }
      const next = src.clone();
      next.color.setHex(color);
      if (role === 'wood') { next.metalness = 0.05; next.roughness = 0.75; }
      else if (role === 'edge') { next.metalness = 0.9; next.roughness = 0.25; }
      else { next.metalness = role === 'body' ? finish.metal ?? 0.45 : 0.3; next.roughness = role === 'body' ? 0.5 : 0.65; }
      cache.set(m, next);
      return next;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

/** Sniper scope body, fitted around a lens axis: extent along the barrel and radii. */
interface ScopeFit { front: number; rear: number; axis: number; mount: number; rBell: number; rTube: number; rEye: number; bellLen: number; eyeLen: number }

// ---- Optic modelling kit --------------------------------------------------------------------
const MATERIALS = {
  // Hard-anodised aluminium; rail, steel screws and accents differ by vertex colour.
  body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.62, side: THREE.DoubleSide }),
  // Rubber eyecups, lens caps and buttons.
  rubber: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide }),
  // Multi-coated objective glass: dark, glossy, with the green/violet sheen of anti-reflective coatings.
  glass: new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.82, depthWrite: false, envMapIntensity: 2.4,
    iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [160, 420], clearcoat: 1, clearcoatRoughness: 0.03,
  }),
  // Emissive fibre optics and tritium above the bloom threshold, so they glow even at the hip.
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(3, 3, 3) }),
};
/** Window (red dot/holo glass) and lens (magnified ocular) get their own meshes in first person (sights.ts materials). */
type Bucket = keyof typeof MATERIALS | 'window' | 'lens';

const C = {
  anodised: 0x1c1f23, rail: 0x15171a, rubber: 0x0d0d0e, steel: 0x6d737a, screw: 0x8f969d, socket: 0x050506, inner: 0x060708,
  coatBlue: 0x3a5f8a, coatAmber: 0x9a6a2a, coatGreen: 0x2f6f52, coatViolet: 0x4a3a6a,
  bezel: 0x3a3e44, white: 0xe6e4dc, tritium: 0x0a7a26, red: 0xff2a1a, amber: 0xffa21e,
};
/** Accent ring/cap colour by optic. */
const ACCENT: Record<OpticId, number> = { irons: 0x888888, reflex: 0xb3332a, holo: 0xd9772a, acog: 0xc9932f, x4: 0x3f74b8, x6: 0x2f9a8c };
/** Fibre-optic colour follows the illuminated reticle setting. */
const FIBRE: Record<ReticleColor, number> = { red: 0xff2a1a, green: 0x3aff2a, amber: 0xffa21e, white: 0xfff4e6 };

type Paint = number | ((p: THREE.Vector3) => number);
type XYZ = [number, number, number];

class Kit {
  private parts: Record<Bucket, THREE.BufferGeometry[]> = { body: [], rubber: [], glass: [], glow: [], window: [], lens: [] };
  /** Height added to every part (an optic on a riser). */
  lift = 0;
  constructor(readonly detail: OpticDetail) {}
  /** Segment count for round parts at this detail level. */
  seg(n: number) { return this.detail === 'high' ? n : Math.max(8, Math.round(n / 2)); }

  add(bucket: Bucket, geometry: THREE.BufferGeometry, paint: Paint, x = 0, y = 0, z = 0) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const p = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      c.setHex(typeof paint === 'number' ? paint : paint(p));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.translate(x, y + this.lift, z);
    this.parts[bucket].push(g);
  }
  at(x: number, y: number, z = 0) { return new THREE.Vector3(x, y + this.lift, z); }

  /** One mesh per material; third-person views fold the window and lens into the coated glass. */
  build(name: string, firstPerson: boolean) {
    const group = new THREE.Group();
    group.name = name;
    const buckets: [string, THREE.BufferGeometry[], THREE.Material][] = [
      ['body', this.parts.body, MATERIALS.body], ['rubber', this.parts.rubber, MATERIALS.rubber],
      ['glass', firstPerson ? this.parts.glass : [...this.parts.glass, ...this.parts.window, ...this.parts.lens], MATERIALS.glass],
      ['glow', this.parts.glow, MATERIALS.glow],
    ];
    if (firstPerson) buckets.push(['window', this.parts.window, MATERIALS.glass], ['lens', this.parts.lens, MATERIALS.glass]);
    for (const [bucket, parts, material] of buckets) {
      if (!parts.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(parts)!, material);
      mesh.name = bucket;
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

/** Box (x length, y height, z width) with rounded vertical edges and bevelled (chamfered) faces, centred. */
function roundedBox(w: number, h: number, d: number, r = Math.min(w, h, d) * 0.22, segments = 5) {
  // Ticks and slivers: a plain box (a bevel on a sub-millimetre outline degenerates).
  if (Math.min(w, h, d) < 0.0016) return new THREE.BoxGeometry(w, h, d);
  const b = Math.min(0.0012, d * 0.1, h * 0.2, w * 0.2);
  const g = new THREE.ExtrudeGeometry(roundedRect(w - 2 * b, h - 2 * b, Math.max(0.0002, Math.min(r, (Math.min(w, h) - 2 * b) / 2) - b * 0.5)), {
    depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: segments,
  });
  return g.translate(0, 0, -(d - 2 * b) / 2);
}

/** Side profile (x along the barrel, y up) extruded across the gun (z), centred on z. */
function slab(points: [number, number][], thickness: number) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y));
  const b = Math.min(0.0005, thickness * 0.2);
  return new THREE.ExtrudeGeometry(s, { depth: thickness - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1 }).translate(0, 0, -(thickness - 2 * b) / 2);
}

/** Smooth body of revolution around the barrel axis: profile [radius, distance forward from the rear]. */
const lathe = (profile: [number, number][], segments = 32) =>
  new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), segments).rotateZ(Math.PI / 2);
/** Flat ring facing the rear, `t` thick: an aperture or lens retaining ring. */
const washer = (ri: number, ro: number, t: number, segments = 32) =>
  lathe([[ri, 0], [ro - 0.0003, 0], [ro, 0.0003], [ro, t - 0.0003], [ro - 0.0003, t], [ri, t], [ri, 0]], segments);

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

/** Flat rounded-rectangle pane facing the rear (+X). */
const pane = (w: number, h: number, r: number) => new THREE.ShapeGeometry(roundedRect(w, h, r), 10).rotateY(Math.PI / 2);
const disc = (r: number, segments = 32) => new THREE.CircleGeometry(r, segments).rotateY(Math.PI / 2); // faces +X (rear)
const cyl = (r: number, h: number, axis: 'x' | 'y' | 'z' = 'y', segments = 16) => {
  const g = new THREE.CylinderGeometry(r, r, h, segments);
  return axis === 'z' ? g.rotateX(Math.PI / 2) : axis === 'x' ? g.rotateZ(Math.PI / 2) : g;
};
/** Offset `d` along an axis (sign picks the side). */
const offset = (x: number, y: number, z: number, axis: 'x' | 'y' | 'z', d: number): XYZ =>
  axis === 'x' ? [x + d, y, z] : axis === 'y' ? [x, y + d, z] : [x, y, z + d];

/** Socket-head screw seated on a surface at (x, y, z), its head facing `sign` along the axis. */
function screw(kit: Kit, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', sign = 1, r = 0.0016) {
  const s = kit.seg(16);
  kit.add('body', cyl(r, 0.001, axis, s), C.screw, ...offset(x, y, z, axis, sign * 0.0005));
  kit.add('body', cyl(r * 0.8, 0.0005, axis, s), C.screw, ...offset(x, y, z, axis, sign * 0.00115));
  kit.add('body', cyl(r * 0.4, 0.0004, axis, 6), C.socket, ...offset(x, y, z, axis, sign * 0.0014));
}

/** Hex nut with its bolt end (cross-bolt clamps). */
function nut(kit: Kit, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', sign = 1, r = 0.0034) {
  kit.add('body', cyl(r, 0.0032, axis, 6), C.steel, ...offset(x, y, z, axis, sign * 0.0016));
  kit.add('body', cyl(r * 0.55, 0.0012, axis, kit.seg(12)), C.screw, ...offset(x, y, z, axis, sign * 0.0036));
}

/** Picatinny rail from x0 to x1 with its base at y; returns the rail top. */
function rail(kit: Kit, x0: number, x1: number, y: number) {
  const len = x1 - x0, mid = (x0 + x1) / 2;
  kit.add('body', roundedBox(len, 0.0036, 0.019, 0.0008), C.rail, mid, y + 0.0018);
  const n = Math.max(2, Math.floor(len / 0.01));
  for (let i = 0; i < n; i++) kit.add('body', roundedBox(0.0052, 0.0032, 0.0214, 0.0006), C.rail, x0 + (i + 0.5) * (len / n), y + 0.0036 + 0.0016);
  return y + 0.0068;
}

/** Clamp jaws gripping a rail's sides, with cross bolts and nuts on the gun's left (+z, facing the camera). */
function railClamp(kit: Kit, x0: number, x1: number, top: number, bolts: number[]) {
  const len = x1 - x0, mid = (x0 + x1) / 2;
  for (const sz of [-1, 1]) kit.add('body', roundedBox(len, 0.0072, 0.0036, 0.001), C.anodised, mid, top - 0.0036, sz * 0.0122);
  for (const x of bolts) { nut(kit, x, top - 0.0038, 0.014, 'z', 1, 0.0031); kit.add('body', cyl(0.0015, 0.0018, 'z', kit.seg(10)), C.screw, x, top - 0.0038, -0.0148); }
}

/** Scope ring: split band round the tube with four cap screws, base block down to `floor`, cross-bolt nut. */
function scopeRing(kit: Kit, x: number, axis: number, r: number, floor: number) {
  const s = kit.seg(48);
  const band = lathe([[r, 0], [r + 0.0035, 0.0012], [r + 0.0045, 0.0035], [r + 0.0045, 0.0115], [r + 0.0035, 0.0138], [r, 0.015]], s);
  kit.add('body', band, C.anodised, x + 0.0075, axis);
  const baseH = axis - r - floor + 0.004;
  kit.add('body', roundedBox(0.016, baseH, 0.022, 0.003), C.anodised, x, floor + baseH / 2);
  for (const sz of [-1, 1]) kit.add('body', roundedBox(0.0162, 0.0042, 0.0028, 0.0008), C.anodised, x, axis, sz * (r + 0.0054));
  kit.add('body', roundedBox(0.0163, 0.0004, 2 * (r + 0.007), 0.0001), C.socket, x, axis);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) screw(kit, x + sx * 0.0039, axis + 0.0021, sz * (r + 0.0054), 'y', 1, 0.0014);
  nut(kit, x, floor + 0.004, 0.011, 'z', 1, 0.0036);
  for (const sz of [-1, 1]) kit.add('body', roundedBox(0.016, 0.0072, 0.0036, 0.001), C.anodised, x, floor - 0.0036, sz * 0.0122);
}

/** Turret on a collar: knurled (target) or capped, with a zero ring and index ticks; axis 'y' (elevation) or 'z' (windage, `sign` picks the side). */
function turret(kit: Kit, x: number, y: number, z: number, r: number, axis: 'y' | 'z', accent: number, sign = 1, capped = false) {
  const s = kit.seg(40), at = (d: number) => offset(x, y, z, axis, sign * d);
  kit.add('body', cyl(r * 1.18, 0.0036, axis, s), C.anodised, ...at(0.0018));
  kit.add('body', cyl(r * 1.06, 0.0012, axis, s), accent, ...at(0.0042));
  if (capped) {
    kit.add('body', knurl(r, 0.0062, kit.detail === 'high' ? 26 : 13, axis), C.anodised, ...at(0.0079));
    kit.add('body', cyl(r * 0.93, 0.0012, axis, s), C.anodised, ...at(0.0116));
  } else {
    kit.add('body', knurl(r, 0.0105, kit.detail === 'high' ? 32 : 16, axis), C.anodised, ...at(0.0101));
    kit.add('body', cyl(r * 0.94, 0.0014, axis, s), C.steel, ...at(0.016));
    kit.add('body', cyl(r * 0.45, 0.0008, axis, s), C.anodised, ...at(0.0171));
    kit.add('body', roundedBox(r * 0.8, axis === 'y' ? 0.0006 : 0.0011, axis === 'y' ? 0.0011 : 0.0006, 0.0002), accent, ...offset(x - r * 0.42, y, z, axis, sign * 0.0175));
  }
  // Index ticks round the collar.
  const n = kit.detail === 'high' ? 16 : 8, R = r * 1.18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, big = i % 4 === 0;
    const tick = axis === 'y' ? roundedBox(0.0005, big ? 0.0024 : 0.0016, 0.0005, 0.0001) : roundedBox(0.0005, 0.0005, big ? 0.0024 : 0.0016, 0.0001);
    const cx = x + Math.cos(a) * R, off = Math.sin(a) * R;
    if (axis === 'y') kit.add('body', tick, i ? C.white : accent, cx, y + sign * 0.0024, z + off);
    else kit.add('body', tick, i ? C.white : accent, cx, y + off, z + sign * 0.0024);
  }
}

/** Rubber flip cap swung open (dir 1: up, -1: down) at the front (side -1) or rear (side 1) opening of a tube of radius r. */
function flipCap(kit: Kit, x: number, axis: number, r: number, side: -1 | 1, dir: -1 | 1) {
  const cup = lathe([[0, 0], [r + 0.0022, 0], [r + 0.0026, 0.0006], [r + 0.0026, 0.0045], [r + 0.0012, 0.0045], [r + 0.0012, 0.0016], [0, 0.0016]], kit.seg(40));
  kit.add('rubber', cup, C.rubber, x + (side < 0 ? -0.001 : 0.0055), axis + dir * (2 * r + 0.0058), 0);
  kit.add('rubber', roundedBox(0.0055, 0.008, 0.008, 0.0018), C.rubber, x + side * 0.0005, axis + dir * (r + 0.0035));
}

// ---- Iron sights (model space) ---------------------------------------------------------------
interface IronFit {
  /** Rear and front sight positions (x, base height) and the sight line through them. */
  rear: [number, number]; front: [number, number]; line: number;
  rearKind: 'aperture' | 'ghost' | 'notch'; frontKind: 'post' | 'hood' | 'bead' | 'blade';
}
const IRONS: Partial<Record<WeaponId, IronFit>> = {
  m4a1: { rear: [-0.035, 0.187], front: [-0.5, 0.188], line: 0.21, rearKind: 'aperture', frontKind: 'post' },
  m110: { rear: [-0.1, 0.0642], front: [-0.6, 0.056], line: 0.095, rearKind: 'aperture', frontKind: 'post' },
  m249: { rear: [-0.02, 0.27], front: [-0.725, 0.28], line: 0.304, rearKind: 'aperture', frontKind: 'post' },
  mp5: { rear: [0.012, 0.143], front: [-0.312, 0.143], line: 0.157, rearKind: 'aperture', frontKind: 'hood' },
  mp7: { rear: [0.02, 0.134], front: [-0.262, 0.134], line: 0.153, rearKind: 'aperture', frontKind: 'hood' },
  m1014: { rear: [-0.045, 0.085], front: [-0.675, 0.068], line: 0.102, rearKind: 'ghost', frontKind: 'bead' },
  m9a1: { rear: [0.03, 0.159], front: [-0.252, 0.158], line: 0.172, rearKind: 'notch', frontKind: 'blade' },
};

/**
 * Flip-up rear aperture (rifles) or ghost ring (shotgun), low profile: slim clamp base, thin leaf and
 * aperture ring, thin protective wings, windage knob. Returns the rear sighting surface.
 */
function rearAperture(kit: Kit, x: number, y: number, line: number, ghost: boolean) {
  const s = kit.seg(40), ro = ghost ? 0.0066 : 0.0042, ri = ghost ? 0.0048 : 0.0022, t = ghost ? 0.0026 : 0.0018;
  const deck = y + 0.0042;
  kit.add('body', roundedBox(0.022, 0.0042, 0.016, 0.0015), C.anodised, x, y + 0.0021);
  screw(kit, x - 0.007, deck, 0, 'y', 1, 0.0012);
  kit.add('body', knurl(0.0034, 0.0032, 12, 'z'), C.anodised, x + 0.004, y + 0.0026, 0.0096);
  kit.add('body', cyl(0.0015, 0.0012, 'z', kit.seg(12)), C.screw, x + 0.004, y + 0.0026, 0.0118);
  const h = line - ro - deck + 0.001;
  kit.add('body', roundedBox(t, h, 0.0075, 0.0008), C.anodised, x, deck + h / 2);
  kit.add('body', washer(ri, ro, t, s), C.anodised, x + t / 2, line);
  const wingTop = line + ro * 0.2, wh = wingTop - deck;
  for (const sz of [-1, 1]) kit.add('body', roundedBox(0.011, wh, 0.0012, 0.0005), C.anodised, x, deck + wh / 2, sz * (ro + 0.0026));
  return x + t / 2;
}

/** Front sight: a thin square post between slim protective ears, a hooded post, a fibre bead or a pistol blade with a tritium dot. */
function frontSight(kit: Kit, x: number, y: number, line: number, kind: IronFit['frontKind']) {
  const s = kit.seg(32);
  if (kind === 'post') {
    const earTop = line + 0.002, eh = earTop - y;
    for (const sz of [-1, 1]) kit.add('body', roundedBox(0.008, eh, 0.0016, 0.0007), C.anodised, x, y + eh / 2, sz * 0.0072);
    kit.add('body', roundedBox(0.01, 0.0042, 0.016, 0.0012), C.anodised, x, y + 0.0021);
    kit.add('body', cyl(0.0034, 0.0022, 'y', s), C.steel, x, y + 0.0053);
    const ph = line - (y + 0.0064);
    kit.add('body', roundedBox(0.0024, ph, 0.0022, 0.0003, 2), C.anodised, x, y + 0.0064 + ph / 2);
  } else if (kind === 'hood') {
    const ro = 0.0078, ri = 0.0068, len = 0.008;
    kit.add('body', washer(ri, ro, len, s), C.anodised, x + len / 2, line);
    const bh = line - ri - y;
    kit.add('body', roundedBox(0.01, bh, 0.0075, 0.0018), C.anodised, x, y + bh / 2);
    kit.add('body', roundedBox(0.0022, ri + 0.0006, 0.0022, 0.0003, 2), C.anodised, x, line - ri / 2 - 0.0003);
  } else if (kind === 'bead') {
    const bh = line - 0.0016 - y;
    kit.add('body', slab([[-0.008, 0], [0.008, 0], [0.005, bh], [-0.005, bh]], 0.003), C.anodised, x, y);
    kit.add('body', roundedBox(0.01, 0.001, 0.0042, 0.0003), C.anodised, x, y + bh - 0.0005);
    kit.add('glow', cyl(0.0015, 0.009, 'x', kit.seg(14)), C.red, x, line);
  } else {
    const bh = line - y;
    kit.add('body', slab([[-0.004, 0], [0.004, 0], [0.004, bh], [-0.0022, bh], [-0.004, bh * 0.7]], 0.0028), C.anodised, x, y);
    kit.add('body', disc(0.0012, s), C.white, x + 0.0041, line - 0.0022, 0);
    kit.add('glow', disc(0.0007, s), C.tritium, x + 0.00415, line - 0.0022, 0);
  }
}

/** Pistol rear sight: low dovetailed block with a square notch and two tritium dots (three-dot with the front). */
function rearNotch(kit: Kit, x: number, y: number, line: number) {
  const s = kit.seg(32), notch = 0.0042, depth = 0.0038, half = 0.0092, bh = line - depth - y;
  kit.add('body', slab([[-0.004, 0], [0.004, 0], [0.004, bh], [-0.004, bh]], 2 * half), C.anodised, x, y);
  const w = half - notch / 2;
  for (const sz of [-1, 1]) {
    kit.add('body', slab([[-0.004, 0], [0.004, 0], [0.004, depth], [-0.0022, depth], [-0.004, depth * 0.6]], w), C.anodised, x, line - depth, sz * (notch / 2 + w / 2));
    kit.add('body', disc(0.0012, s), C.white, x + 0.0041, line - 0.0021, sz * (notch / 2 + 0.0024));
    kit.add('glow', disc(0.0007, s), C.tritium, x + 0.00415, line - 0.0021, sz * (notch / 2 + 0.0024));
  }
  screw(kit, x, y + bh, 0.0, 'y', 1, 0.001);
  return x + 0.004;
}

// ---- Optic builders (kit space: mount surface at y = 0, centred on the optic's x) ----------------
interface Built { length: number; window: number; rear: number; sight: Sight }

/** Points (z, y) round a rounded rectangle, `k` + 1 per corner arc: the same count at any size, so two loops stitch into a band. */
function loop(hz: number, hy: number, r: number, k: number, dy = 0): [number, number][] {
  const out: [number, number][] = [];
  for (const [sz, sy, a0] of [[1, 1, 0], [-1, 1, 0.5], [-1, -1, 1], [1, -1, 1.5]]) for (let i = 0; i <= k; i++) {
    const a = (a0 + (i / k) * 0.5) * Math.PI;
    out.push([sz * (hz - r) + r * Math.cos(a), sy * (hy - r) + r * Math.sin(a) + dy]);
  }
  return out;
}
/** Smooth band between two loops at x = xa and x = xb. */
function band(a: [number, number][], xa: number, b: [number, number][], xb: number) {
  const n = a.length, pos: number[] = [], index: number[] = [];
  for (const [z, y] of a) pos.push(xa, y, z);
  for (const [z, y] of b) pos.push(xb, y, z);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; index.push(i, n + i, n + j, i, n + j, j); }
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * Rubber lens cap for the end of a tube of radius r at x (side -1: the objective, 1: the ocular),
 * hinged on its rim at angle `hinge` round the axis (π/2 the top, -π/2 the bottom) and swung open by
 * `swing` radians, with the band that holds it on the tube and the strap out to the hinge; `depth` is its skirt.
 */
function lensCap(kit: Kit, x: number, axis: number, r: number, side: -1 | 1, hinge: number, swing: number, depth = 0.0052) {
  const s = kit.seg(40), rc = r + 0.0011, t = 0.0015;
  // Closed, its face sits on the tube end and the skirt reaches back over the tube (the lathe runs toward -x).
  const cup = lathe([[0, -0.0004], [rc * 0.6, -0.0002], [rc + 0.0004, 0], [rc + 0.0009, 0.0006], [rc + 0.0009, depth], [rc + 0.0001, depth], [rc + 0.0001, t], [0, t]], s);
  if (side < 0) cup.rotateY(Math.PI);
  const ch = Math.cos(hinge), sh = Math.sin(hinge), h = rc + 0.0009;
  cup.translate(0, -sh * h, -ch * h)
    .applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, ch, -sh), -side * swing))
    .translate(0, sh * h, ch * h);
  kit.add('rubber', cup, C.rubber, x, axis);
  const bx = x - side * 0.0075;
  kit.add('rubber', lathe([[r + 0.0001, 0], [r + 0.0009, 0.0004], [r + 0.0009, 0.0036], [r + 0.0001, 0.004]], s), C.rubber, bx + 0.002, axis);
  kit.add('rubber', roundedBox(0.0075, 0.0016, 0.0068, 0.0006), C.rubber, x - side * 0.0035, axis + sh * (r + 0.0011), ch * (r + 0.0011));
}

/**
 * Tube red dot (Aimpoint T-2 / Comp M4 style): a short cylinder with a round ocular ring and a hooded
 * objective bell, flip-up rubber lens caps (front up, rear down), a knurled brightness knob on the
 * camera side and capped adjustment turrets, on a tall cantilever mount (rifles) or a low saddle on
 * the slide (pistols). From the eye it is a round tube: the thick ocular ring and a thin band of the
 * dark bore (it flares toward the objective, so it never becomes a tunnel) ring a round field.
 */
function tubeDot(kit: Kit, rifle: boolean, relief: number): Built {
  const s = kit.seg(48), k = rifle ? 1 : 0.72;
  const R = 0.0152 * k, Ro = 0.0166 * k, Rf = 0.0182 * k, ri = 0.0114 * k, L = rifle ? 0.05 : 0.036;
  const rear = L / 2, front = rear - L, rf = Math.min(Rf - 0.0014 * k, ri * (relief + L) / relief * 0.9);
  let axis: number;
  if (rifle) {
    // Cantilever: a clamp base on the rail and an arm leaning forward to a ring round the tube's front half.
    const x0 = -0.004, x1 = 0.03, top = rail(kit, x0 - 0.002, x1 + 0.002, 0);
    railClamp(kit, x0, x1, top, [x0 + 0.008, x1 - 0.008]);
    kit.add('body', roundedBox(x1 - x0, 0.005, 0.02, 0.0015), C.anodised, (x0 + x1) / 2, top + 0.0025);
    axis = top + 0.036;
    const bt = top + 0.005, ring = 0.014, xr = front + 0.0035 + ring / 2, arm = axis - ri - 0.0006 - bt;
    kit.add('body', slab([[x1, 0], [x0, 0], [xr - ring / 2, arm], [xr + ring / 2 + 0.004, arm], [x1, arm * 0.35]], 0.014), C.anodised, 0, bt);
    // Lightening pockets on both faces of the arm.
    for (const sz of [-1, 1]) kit.add('body', slab([[x1 - 0.008, 0.003], [x0 + 0.001, 0.003], [xr - 0.001, arm - 0.0045], [xr + ring / 2 + 0.002, arm - 0.0045], [x1 - 0.008, arm * 0.3]], 0.0008), C.socket, 0, bt, sz * 0.0068);
    // Split ring with two cap screws a side.
    kit.add('body', lathe([[R, 0], [R + 0.003, 0.001], [R + 0.004, 0.003], [R + 0.004, ring - 0.003], [R + 0.003, ring - 0.001], [R, ring]], s), C.anodised, xr + ring / 2, axis);
    for (const sz of [-1, 1]) kit.add('body', roundedBox(ring + 0.0002, 0.0042, 0.003, 0.0008), C.anodised, xr, axis, sz * (R + 0.0054));
    for (const sz of [-1, 1]) kit.add('body', roundedBox(ring + 0.0003, 0.0004, 0.0062, 0.0001), C.socket, xr, axis, sz * (R + 0.0039));
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) screw(kit, xr + sx * 0.0036, axis + 0.0021, sz * (R + 0.0054), 'y', 1, 0.0013);
  } else {
    // Low saddle on the slide, under the bore.
    const base = 0.0032;
    axis = base + R + 0.0012;
    kit.add('body', roundedBox(L * 0.78, base, 0.017, 0.002), C.anodised, rear - L * 0.48, base / 2);
    const sh = axis - ri - 0.0006 - base;
    kit.add('body', roundedBox(L * 0.6, sh, 0.015, 0.0015), C.anodised, rear - L * 0.48, base + sh / 2);
    screw(kit, rear - L * 0.15, base, 0.006, 'y', 1, 0.001);
  }
  // Body: ocular ring with a dark grip band, slim tube, an objective bell with a thin accent ring.
  const bell = L * 0.58, Rg = Ro + 0.0003;
  const body = lathe([[ri, 0], [Ro - 0.0008, 0], [Ro, 0.0008], [Ro, 0.0024], [Rg, 0.0028], [Rg, 0.0082 * k], [Ro, 0.0086 * k], [R, 0.0106 * k],
    [R, bell], [Rf, bell + 0.007 * k], [Rf, L - 0.0008], [Rf - 0.0008, L], [rf, L]], s);
  kit.add('body', body, p => {
    const h = -p.x, r = Math.hypot(p.y, p.z);
    if (r > Ro + 0.0001 && h > 0.0026) return C.rail;
    return h > bell + 0.0068 * k && h < bell + 0.0095 * k && r > Rf - 0.0002 ? ACCENT.reflex : C.anodised;
  }, rear, axis);
  kit.add('body', lathe([[ri, 0], [rf, L]], s), C.inner, rear, axis);
  // Brightness knob facing the camera, capped elevation and windage turrets.
  const kx = rear - L * 0.4;
  kit.add('body', cyl(R * 0.66, 0.0042, 'z', s), C.anodised, kx, axis, R - 0.0004 + 0.0021);
  kit.add('body', knurl(R * 0.6, 0.0062 * k + 0.0016, kit.detail === 'high' ? 24 : 12, 'z'), C.anodised, kx, axis, R + 0.0038 + (0.0062 * k + 0.0016) / 2);
  kit.add('body', cyl(R * 0.5, 0.0008, 'z', s), C.steel, kx, axis, R + 0.0058 + 0.0062 * k);
  kit.add('body', roundedBox(0.0006, R * 0.5, 0.0006, 0.0001), C.white, kx, axis + R * 0.25, R + 0.0062 + 0.0062 * k);
  turret(kit, kx, axis + R - 0.0008, 0, 0.0052 * k + 0.0008, 'y', C.steel, 1, true);
  turret(kit, kx, axis, -(R - 0.0008), 0.0052 * k + 0.0008, 'z', C.steel, -1, true);
  lensCap(kit, front, axis, Rf, -1, Math.PI / 2, 2.7);
  // The rear cap (a shallow one) hangs back from the ocular's lower rim, edge-on to the eye: a thin band over the mount below the ring.
  if (rifle) lensCap(kit, rear, axis, Rg, 1, -Math.PI / 2, Math.PI / 2 - Math.atan2(Rg, relief), 0.0026);
  // The coated objective: the window the dot is projected on.
  const wx = front + 0.0035;
  kit.add('window', disc(rf, s), C.coatAmber, wx, axis);
  return { length: rifle ? 0.06 : L, window: axis, rear, sight: { kind: 'dot', center: kit.at(wx, axis), radius: rf } };
}

/**
 * Holographic sight (EOTech 552 / EXPS style): a big "TV screen" hood with thick walls and rounded
 * corners round a wide rectangular window, on a body that runs from a transverse battery tube at the
 * front to a control panel with rubber buttons behind and below the window, on a quick-detach base.
 * The hood's outer walls are nearly straight and its bore opens toward the front, so from the eye the
 * inner walls show only as a thin band inside the thick rear bezel.
 */
function holoSight(kit: Kit, relief: number): Built {
  const s = kit.seg(32), k = kit.seg(8), top = rail(kit, -0.036, 0.032, 0);
  const baseH = 0.0055, bw = 0.02;
  kit.add('body', roundedBox(0.066, baseH, bw, 0.0018), C.anodised, -0.002, top + baseH / 2);
  railClamp(kit, -0.032, 0.028, top, [-0.026, -0.008]);
  // Quick-detach lever along the left of the base.
  kit.add('body', slab([[-0.014, -0.0018], [0.014, -0.0015], [0.0155, 0.0], [0.014, 0.0017], [-0.014, 0.002], [-0.0155, 0.0]], 0.0026), C.anodised, 0.004, top + 0.0024, 0.0152);
  kit.add('body', cyl(0.0026, 0.0022, 'z', s), C.anodised, -0.009, top + 0.0024, 0.0165);
  for (const x of [-0.03, 0.026]) screw(kit, x, top + baseH * 0.5, bw / 2, 'z', 1, 0.0011);
  const hz = 0.0184, hy = 0.0136, r = 0.0058, wall = 0.0034, L = 0.02, rear = 0.013, front = rear - L;
  const fo = 1 + 0.4 * L / relief, fi = Math.min(1 + L / relief - 0.02, ((hz + wall) * fo - 0.0012) / hz);
  // The body is tall enough that the battery tube in front stays below the window's lower edge as seen from the eye.
  const deck = top + baseH, bodyTop = deck + 0.0135, win = bodyTop + wall + hy;
  // Hood: thick rear bezel, straight-ish outer walls, a dark bore.
  const outRear = loop(hz + wall, hy + wall, r + wall, k), outFront = loop((hz + wall) * fo, (hy + wall) * fo, (r + wall) * fo, k);
  const inRear = loop(hz, hy, r, k), inFront = loop(hz * fi, hy * fi, r * fi, k);
  kit.add('body', mergeGeometries([band(outRear, 0, outFront, -L), band(outRear, 0, inRear, 0), band(outFront, -L, inFront, -L)])!, C.anodised, rear, win);
  kit.add('body', band(inRear, 0, inFront, -L), C.inner, rear, win);
  // A raised, lighter bezel face round the window, so the hood's thick edge reads as a frame against dark scenes.
  kit.add('body', band(loop(hz + wall - 0.0007, hy + wall - 0.0007, r + wall - 0.0007, k), 0, loop(hz + 0.0007, hy + 0.0007, r + 0.0007, k), 0), C.bezel, rear + 0.0003, win);
  // Body under the hood: battery tube in front, sloped control panel behind the window.
  const bx0 = front - 0.016, bx1 = rear + 0.013, bh = bodyTop - deck;
  kit.add('body', slab([[bx0, 0], [bx1, 0], [bx1, bh * 0.78], [bx1 - 0.005, bh + 0.0004], [bx0 + 0.004, bh + 0.0004], [bx0, bh * 0.55]], 0.03), C.anodised, 0, deck);
  for (const sz of [-1, 1]) kit.add('body', roundedBox(bx1 - bx0 - 0.014, bh * 0.45, 0.0006, 0.001), C.rail, (bx0 + bx1) / 2 + 0.002, deck + bh * 0.5, sz * 0.0151);
  // Rubber buttons on the rear panel: brightness up/down and night vision.
  for (const [z, w] of [[-0.0092, 0.0074], [0, 0.0074], [0.0092, 0.0058]] as const) {
    kit.add('rubber', roundedBox(0.003, bh * 0.52, w, 0.0012), C.rubber, bx1 + 0.0009, deck + bh * 0.4, z);
  }
  kit.add('body', roundedBox(0.0004, 0.0004, 0.0022, 0.0001), C.white, bx1 + 0.0026, deck + bh * 0.48, -0.0092);
  kit.add('body', roundedBox(0.0004, 0.0004, 0.0022, 0.0001), C.white, bx1 + 0.0026, deck + bh * 0.48, 0);
  // Transverse battery tube with a knurled cap facing the camera.
  const bx = front - 0.0085, by = deck + 0.0048, bl = 0.034;
  kit.add('body', cyl(0.0052, bl, 'z', s), C.anodised, bx, by);
  kit.add('body', knurl(0.006, 0.0046, kit.detail === 'high' ? 18 : 9, 'z'), C.anodised, bx, by, bl / 2 + 0.0023);
  kit.add('body', cyl(0.0046, 0.0008, 'z', s), C.steel, bx, by, bl / 2 + 0.005);
  kit.add('body', cyl(0.0056, 0.002, 'z', s), C.anodised, bx, by, -bl / 2 - 0.001);
  kit.add('window', pane(2 * hz, 2 * hy, r), C.coatBlue, rear - 0.0015, win);
  return { length: 0.068, window: win, rear: rear + 0.0006, sight: { kind: 'holo', center: kit.at(rear - 0.0015, win), radius: hz, half: [hz, hy] } };
}

/** Prism sight (ACOG style): mount with thumb nuts, forged body with a top fibre-optic channel, objective bell with sunshade, rubber eyepiece. */
function prismSight(kit: Kit, fibre: number): Built {
  const s = kit.seg(64), top = rail(kit, -0.05, 0.05, 0);
  // Riser mount: the eyepiece clears the receiver's rear sight base.
  kit.add('body', roundedBox(0.076, 0.009, 0.028, 0.003), C.anodised, 0, top + 0.0045);
  kit.add('body', roundedBox(0.06, 0.012, 0.022, 0.003), C.anodised, 0, top + 0.014);
  for (const sz of [-1, 1]) kit.add('body', roundedBox(0.04, 0.006, 0.0006, 0.002), C.rail, 0, top + 0.014, sz * 0.0111);
  for (const x of [-0.02, 0.02]) {
    kit.add('body', knurl(0.0058, 0.0065, 16, 'z'), C.anodised, x, top + 0.0035, 0.0175);
    kit.add('body', cyl(0.0045, 0.0012, 'z', s), C.steel, x, top + 0.0035, 0.0214);
    kit.add('body', cyl(0.002, 0.002, 'z', kit.seg(12)), C.screw, x, top + 0.0035, -0.0148);
  }
  const base = top + 0.02, rb = 0.0205, rt = 0.0142, re = 0.0138, L = 0.125, rear = 0.06;
  const axis = base + rb + 0.0004;
  // Forged body around the tube: a squared roof over the prism.
  kit.add('body', slab([[-0.019, -0.012], [0.021, -0.012], [0.021, 0.013], [0.017, 0.018], [-0.015, 0.018], [-0.019, 0.014]], 0.024), C.anodised, rear - 0.038, axis);
  kit.add('body', roundedBox(0.05, 0.008, 0.022, 0.002), C.anodised, rear - 0.04, base + 0.004);
  const body = lathe([[0, 0.0075], [re * 0.84, 0.0075], [re * 0.95, 0.0095], [re, 0.012], [re, 0.02], [rt, 0.024], [rt, 0.06], [rt + 0.0012, 0.0615], [rt + 0.0012, 0.065], [rt, 0.0665],
    [rt + 0.0005, 0.072], [rb * 0.93, 0.086], [rb, 0.095], [rb, 0.111], [rb + 0.0011, 0.112], [rb + 0.0011, L - 0.0012], [rb + 0.0004, L], [rb * 0.9, L], [rb * 0.88, L - 0.0012], [rb * 0.88, L - 0.009], [0, L - 0.009]], s);
  kit.add('body', body, p => { const h = -p.x; return Math.hypot(p.y, p.z) < rb * 0.885 && h > L - 0.012 ? C.inner : h > 0.111 && h < L - 0.001 && Math.hypot(p.y, p.z) > rb + 0.0005 ? C.rail : C.anodised; }, rear, axis);
  kit.add('rubber', lathe([[re * 0.82, 0], [re + 0.0004, 0], [re + 0.0009, 0.0015], [re + 0.0009, 0.0085], [re + 0.0002, 0.0105], [re * 0.86, 0.0105]], s), C.rubber, rear + 0.0015, axis);
  // Fibre optic in a channel on the roof.
  const roof = axis + 0.018;
  for (const sz of [-1, 1]) kit.add('body', roundedBox(0.03, 0.0032, 0.0018, 0.0006), C.anodised, rear - 0.037, roof + 0.0016, sz * 0.0029);
  kit.add('glow', cyl(0.0017, 0.03, 'x', kit.seg(14)), fibre, rear - 0.037, roof + 0.0016);
  for (const x of [rear - 0.0215, rear - 0.0525]) kit.add('body', roundedBox(0.0025, 0.004, 0.0076, 0.0008), C.anodised, x, roof + 0.0018);
  turret(kit, rear - 0.067, axis + rt - 0.0008, 0, 0.0066, 'y', C.steel, 1, true);
  turret(kit, rear - 0.067, axis, -(rt - 0.0008), 0.0066, 'z', C.steel, -1, true);
  kit.add('glass', disc(rb * 0.88, s).rotateY(Math.PI), C.coatGreen, rear - L + 0.0095, axis);
  const lensR = re * 0.8;
  kit.add('lens', disc(lensR, s), C.coatViolet, rear - 0.0068, axis);
  return { length: 0.1, window: axis, rear: rear + 0.0015, sight: { kind: 'acog', center: kit.at(rear - 0.0068, axis), radius: lensR } };
}

/** Rifle/pistol scope fitted around a lens axis: bell, tube, saddle with three turrets, power ring, rubber eyecup, flip cap, two rings on a rail. */
function sniperScope(kit: Kit, f: ScopeFit, accent: number, kind: 'x4' | 'x6'): Built {
  const L = f.rear - f.front, { rBell: rb, rTube: rt, rEye: re, eyeLen: el, bellLen: bl } = f, s = kit.seg(64);
  const saddle = el + Math.min(0.06, (L - el - bl) * 0.35), sr = rt * 1.2;
  kit.add('rubber', lathe([[re * 0.84, 0.0008], [re * 0.9, 0], [re, 0], [re + 0.0006, 0.002], [re + 0.0006, el * 0.38], [re, el * 0.42], [re * 0.95, el * 0.42]], s), C.rubber, f.rear, f.axis);
  const profile: [number, number][] = [
    [0, 0.006], [re * 0.8, 0.006], [re * 0.9, 0.003], [re * 0.95, el * 0.42],
    [re * 1.03, el * 0.42], [re * 1.03, el * 0.48], [re * 0.97, el * 0.48], [re * 0.97, el * 0.82], [re * 0.9, el], // ocular, power ring
    [rt, el + 0.016], [rt, saddle - 0.024], [sr, saddle - 0.017], [sr, saddle + 0.017], [rt, saddle + 0.024], // saddle
    [rt, L - bl - 0.03], [rb * 0.93, L - bl], [rb, L - 0.022], // objective bell
    [rb * 1.035, L - 0.022], [rb * 1.035, L - 0.004], [rb * 0.92, L], [rb * 0.88, L], [rb * 0.88, L - 0.007], [0, L - 0.007],
  ];
  const tint = (p: THREE.Vector3) => {
    const h = -p.x, r = Math.hypot(p.y, p.z);
    if (h > L - 0.008 && r < rb * 0.89) return C.inner;
    if ((h > el * 0.42 && h < el * 0.48) || (h > L - 0.0095 && h < L - 0.0045)) return accent;
    return C.anodised;
  };
  kit.add('body', lathe(profile, s), tint, f.rear, f.axis);
  // Power ring: knurled grip and a throw lever facing the camera.
  kit.add('body', knurl(re * 0.985, el * 0.26, kit.detail === 'high' ? 36 : 18, 'x'), C.anodised, f.rear - el * 0.65, f.axis);
  kit.add('body', roundedBox(el * 0.16, 0.004, 0.006, 0.0015), C.anodised, f.rear - el * 0.65, f.axis + 0.003, re * 0.97 + 0.0025);
  const tx = f.rear - saddle;
  turret(kit, tx, f.axis + sr - 0.002, 0, rt * 0.62 + 0.004, 'y', accent);
  turret(kit, tx, f.axis, sr - 0.002, rt * 0.62 + 0.004, 'z', accent);
  turret(kit, tx, f.axis, -(sr - 0.002), rt * 0.5 + 0.003, 'z', accent, -1);
  for (const sx of [-1, 1]) screw(kit, tx + sx * 0.012, f.axis + sr * 0.92, 0, 'y', 1, 0.0013);
  const ringRear = f.rear - el - 0.022, ringFront = f.front + bl + 0.02;
  const top = rail(kit, ringFront - 0.022, ringRear + 0.022, f.mount);
  for (const x of [ringRear, ringFront]) scopeRing(kit, x, f.axis, rt, top);
  flipCap(kit, f.front, f.axis, rb * 1.035, -1, 1);
  kit.add('glass', disc(rb * 0.88, s).rotateY(Math.PI), C.coatBlue, f.front + 0.0075, f.axis);
  const lensR = re * 0.8;
  kit.add('lens', disc(lensR, s), C.coatGreen, f.rear - 0.0054, f.axis);
  return { length: L, window: f.axis, rear: f.rear, sight: { kind, center: kit.at(f.rear - 0.0054, f.axis), radius: lensR } };
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
  return Number.isFinite(top) ? top : 0.1;
}

/**
 * How far in front of the eye each sight sits when aimed (m, eye to its rear sighting surface). The
 * view model sets the weapon by it. As in modern shooters, the eye sits just behind a holo or red dot:
 * the holo's wide rectangular window, framed by its thick hood, spans about half the screen height; the
 * tube red dot sits a little further out, a round field inside its dark ocular ring; scopes fill the
 * view like an eyepiece. Iron sights sit further out: a small, thin rear aperture with the front post
 * inside it and only a little of the receiver below; pistols are held at arm's length.
 */
const RELIEF: Record<OpticId, { long: number; pistol: number }> = {
  irons: { long: 0.24, pistol: 0.4 }, reflex: { long: 0.08, pistol: 0.24 }, holo: { long: 0.05, pistol: 0.22 },
  acog: { long: 0.03, pistol: 0.03 }, x4: { long: 0.034, pistol: 0.034 }, x6: { long: 0.034, pistol: 0.034 },
};

interface OpticModel { group: THREE.Group; sightLine: number; eyeX?: number; relief?: number; sight?: Sight }

/** One optic per (weapon, optic, view, detail), modelled once and cloned (shared geometry) onto every view. */
const optics = new Map<string, OpticModel>();
function opticModel(weapons: Map<string, THREE.Object3D>, id: WeaponId, optic: OpticId, view: 'first' | 'third') {
  const first = view === 'first', detail: OpticDetail = first ? settings.opticDetail : 'low';
  const key = `${id}|${optic}|${view}|${detail}|${first ? settings.reticleColor : ''}`;
  let o = optics.get(key);
  if (o) return o;
  const fit = GUN_FIT[id], model = weapons.get(WEAPONS[id].model)!, kit = new Kit(detail);
  const relief = RELIEF[optic][fit.kind === 'pistol' ? 'pistol' : 'long'];
  if (optic === 'irons') {
    const iron = IRONS[id];
    // Third-person soldiers keep the model's own sights (no extra draw calls across a 100-soldier match).
    if (!iron || !first) o = { group: new THREE.Group(), sightLine: iron?.line ?? fit.irons };
    else {
      const eyeX = iron.rearKind === 'notch' ? rearNotch(kit, iron.rear[0], iron.rear[1], iron.line) : rearAperture(kit, iron.rear[0], iron.rear[1], iron.line, iron.rearKind === 'ghost');
      frontSight(kit, iron.front[0], iron.front[1], iron.line, iron.frontKind);
      o = { group: kit.build('Optic_irons', true), sightLine: iron.line, eyeX, relief };
    }
  } else if (optic === 'x4' || optic === 'x6') {
    // x6: a long rifle scope on two rings; x4: a slim long-eye-relief pistol scope over the slide.
    const pistol = optic === 'x4', L = pistol ? 0.17 : 0.34, at = fit.optic - (pistol ? 0.04 : 0), rt = pistol ? 0.0105 : 0.0155;
    const top = topAt(model, at - L * 0.3, at + L * 0.3);
    const f: ScopeFit = { front: at - L / 2, rear: at + L / 2, mount: top - 0.0015, axis: top + (pistol ? 0.02 : 0.028) + rt, rTube: rt, rBell: pistol ? 0.018 : 0.029, rEye: pistol ? 0.015 : 0.022, bellLen: pistol ? 0.04 : 0.075, eyeLen: pistol ? 0.05 : 0.085 };
    const built = sniperScope(kit, f, ACCENT[optic], optic);
    o = { group: kit.build(`Optic_${optic}`, first), sightLine: f.axis, eyeX: built.rear, relief, sight: built.sight };
  } else {
    let built: Built;
    if (optic === 'reflex') built = tubeDot(kit, fit.kind !== 'pistol', relief);
    else if (optic === 'holo') built = holoSight(kit, relief);
    else built = prismSight(kit, FIBRE[first ? settings.reticleColor : 'amber']);
    const top = topAt(model, fit.optic - built.length / 2, fit.optic + built.length / 2);
    const group = kit.build(`Optic_${optic}`, first);
    group.position.set(fit.optic, top - 0.0015, 0);
    o = { group, sightLine: top - 0.0015 + built.window, eyeX: fit.optic + built.rear, relief, sight: built.sight };
  }
  optics.set(key, o);
  return o;
}

// ---- Tactical and mod attachments ---------------------------------------------------------
const std = (color: number, roughness = 0.6, metalness = 0.4) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const M = {
  housing: std(0x1b1d20, 0.5, 0.55), rubber: std(0x0c0c0d, 0.9, 0), polymer: std(0x202225, 0.7, 0.2),
  laserLens: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.25, 0.15) }),
  torchLens: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3, 2.6) }),
  counter: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.6, 0.9) }),
  explosiveAmmo: new THREE.MeshStandardMaterial({ color: 0xc8401e, emissive: 0x6a1a08, roughness: 0.5 }),
  incendiaryAmmo: new THREE.MeshStandardMaterial({ color: 0xf08a1a, emissive: 0x7a3a06, roughness: 0.5 }),
};

/** Canvas alpha ramp: opaque at the emitter (v = 0), fading to nothing at the far end. */
let ramp: THREE.Texture | undefined;
function fadeRamp() {
  if (ramp) return ramp;
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const g = c.getContext('2d')!, grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.55, 'rgba(255,255,255,0.25)'); grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 128);
  return ramp = new THREE.CanvasTexture(c);
}
/** Soft round glow sprite (flashlight lens seen from the front: it can blind). */
let glowTex: THREE.Texture | undefined;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.2, 'rgba(255,246,220,0.7)'); grad.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return glowTex = new THREE.CanvasTexture(c);
}
const beamMats = new Map<string, THREE.Material>();
const beamMat = (color: number, opacity: number) => {
  const key = `${color}|${opacity}`;
  let m = beamMats.get(key);
  if (!m) beamMats.set(key, m = new THREE.MeshBasicMaterial({ color, alphaMap: fadeRamp(), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  return m;
};
/** Open cylinder or cone from the origin along -X, its UV v running emitter → far end. */
const along = (geo: THREE.BufferGeometry, len: number) => geo.translate(0, len / 2, 0).rotateZ(Math.PI / 2);

const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m;
};

function laserModule(view: 'first' | 'third') {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.046, 0.019, 0.018), M.housing));
  g.add(mesh(new THREE.BoxGeometry(0.012, 0.006, 0.02), M.polymer, 0.008, 0.009, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.004, 12).rotateZ(Math.PI / 2), M.laserLens, -0.024, 0, 0));
  const beam = new THREE.Object3D();
  beam.position.x = -0.026;
  const len = view === 'first' ? 7 : 22;
  beam.add(new THREE.Mesh(along(new THREE.CylinderGeometry(0.0011, 0.0011, len, 5, 1, true), len), beamMat(0xff2a18, view === 'first' ? 0.9 : 0.55)));
  beam.children[0].renderOrder = 5;
  g.add(beam);
  return { group: g, emitter: beam };
}

function torchModule(view: 'first' | 'third') {
  const g = new THREE.Group();
  const body = new THREE.LatheGeometry([[0, 0], [0.0105, 0], [0.0105, 0.05], [0.0145, 0.062], [0.0145, 0.078], [0.012, 0.078]].map(([r, h]) => new THREE.Vector2(r, h)), 18).rotateZ(Math.PI / 2).translate(0.039, 0, 0);
  g.add(mesh(body, M.housing));
  g.add(mesh(new THREE.BoxGeometry(0.03, 0.012, 0.016), M.polymer, 0.005, 0.012, 0));
  const knurlRing = new THREE.CylinderGeometry(0.0112, 0.0112, 0.012, 12).rotateZ(Math.PI / 2);
  g.add(mesh(knurlRing, M.rubber, 0.03, 0, 0));
  const lens = mesh(new THREE.CircleGeometry(0.0125, 20).rotateY(-Math.PI / 2), M.torchLens, -0.0385, 0, 0);
  lens.castShadow = false;
  g.add(lens);
  const emitter = new THREE.Object3D();
  emitter.position.x = -0.04;
  g.add(emitter);
  if (view === 'third') {
    // A faint light cone and a lens flare: both read from across the map at night and in shade.
    const cone = new THREE.Mesh(along(new THREE.CylinderGeometry(0.7, 0.02, 5, 16, 1, true), 5), beamMat(0xfff1d8, 0.06));
    cone.renderOrder = 5;
    emitter.add(cone);
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff3dc, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    flare.scale.setScalar(0.32);
    emitter.add(flare);
  }
  return { group: g, emitter };
}

export interface Fitted {
  /** Everything fitted, in gun model space (add it to the gun model's clone). */
  group: THREE.Group;
  /** Model-space height of the line through the fitted optic (or iron sights). */
  sightLine: number;
  /** Model-space muzzle (moves forward with a suppressor). */
  muzzle: THREE.Vector3;
  /** Laser and flashlight emitters (their -X is the beam direction). */
  laser?: THREE.Object3D; torch?: THREE.Object3D;
  /** First person: model-space x of the rear sighting surface and how far ahead of the eye it sits when aimed. */
  eyeX?: number; relief?: number;
  /** First person: the magnified optic's ocular lens (picture-in-picture) and its sight geometry. */
  lens?: THREE.Mesh; sight?: Sight;
}

/** Fit `att` to a clone of weapon `id`: optic, suppressor, laser, flashlight, ammo counter, extended clip, recoil pad, ammo band. */
export function fitAttachments(weapons: Map<string, THREE.Object3D>, id: WeaponId, att: Attachments = {}, view: 'first' | 'third' = 'third'): Fitted {
  const fit = GUN_FIT[id], group = new THREE.Group();
  group.name = 'Attachments';
  const muzzle = vec(fit.muzzle);
  if (fit.kind === 'knife') return { group, sightLine: 0, muzzle };
  const optic = opticModel(weapons, id, (att.optic as OpticId | undefined) ?? 'irons', view);
  let lens: THREE.Mesh | undefined;
  if (optic.group.children.length) {
    const fitted = optic.group.clone();
    group.add(fitted);
    // First person: per-view sight-picture materials (clones share geometry, not these).
    const pane = fitted.getObjectByName('window') as THREE.Mesh | undefined;
    if (pane && optic.sight) windowMaterial(pane, optic.sight);
    lens = fitted.getObjectByName('lens') as THREE.Mesh | undefined;
    if (lens && optic.sight) lensMaterial(lens, optic.sight);
  }
  if (att.muzzle === 'suppressor') {
    const can = weapons.get('Acc_Suppressor')!.clone();
    can.scale.set(fit.bore, fit.bore * 1.55, fit.bore * 1.55);
    can.position.copy(muzzle).x += 0.012;
    group.add(can);
    muzzle.x -= 0.22 * fit.bore - 0.01;
  }
  let laser: THREE.Object3D | undefined, torch: THREE.Object3D | undefined;
  const [x, y, z] = fit.rail;
  if (att.laser === 'laser') {
    // Long guns: on the left side rail (facing the camera in first person); pistols: under the dust cover.
    const m = laserModule(view);
    m.group.position.set(x, z ? y : y - 0.012, z ? z + 0.011 : 0);
    group.add(m.group); laser = m.emitter;
  }
  if (att.light === 'flashlight') {
    // With a laser fitted the light takes the right rail (pistols: further forward under the frame).
    const m = torchModule(view), both = !!laser;
    m.group.position.set(x + (both && !z ? 0.034 : 0), z ? y : y - 0.016, z ? (both ? -(z + 0.014) : z + 0.014) : 0);
    group.add(m.group); torch = m.emitter;
  }
  if (att.counter === 'ammoCounter') {
    const side = fit.kind === 'pistol' ? 0.017 : 0.027, at = new THREE.Vector3(fit.mag[0] + 0.07, fit.irons - (fit.kind === 'pistol' ? 0.06 : 0.075), side);
    group.add(mesh(new THREE.BoxGeometry(0.034, 0.02, 0.008), M.housing, at.x, at.y, at.z));
    group.add(mesh(new THREE.PlaneGeometry(0.026, 0.012), M.counter, at.x, at.y, at.z + 0.0042));
  }
  const c = fit.clip;
  if (att.magazine === 'extendedClip') {
    if (c.tube) group.add(mesh(new THREE.CylinderGeometry(0.0135, 0.0135, c.w, 12).rotateZ(Math.PI / 2), M.housing, c.at[0] - c.w / 2, c.at[1], c.at[2]));
    else {
      const ext = new THREE.Group();
      const h = id === 'm249' ? 0.05 : 0.042;
      ext.add(mesh(new THREE.BoxGeometry(c.w * 0.94, h, c.d * 0.94), id === 'm249' ? std(0x535a40, 0.9, 0) : M.polymer, 0, -h / 2, 0));
      ext.add(mesh(new THREE.BoxGeometry(c.w * 1.08, 0.008, c.d * 1.1), M.rubber, 0, -h, 0));
      ext.position.set(c.at[0], c.at[1] + 0.004, c.at[2]); ext.rotation.z = c.tilt;
      group.add(ext);
    }
  }
  if (att.stock === 'recoilPad' && fit.butt) group.add(mesh(new THREE.BoxGeometry(0.022, fit.butt[2], 0.05), M.rubber, fit.butt[0] + 0.009, fit.butt[1], 0));
  if (att.ammo === 'explosiveAmmo' || att.ammo === 'incendiaryAmmo') {
    // A coloured band on the magazine (the shotgun's on its tube) marks the special rounds.
    const band = mesh(new THREE.BoxGeometry(c.tube ? 0.012 : c.w * 1.04, c.tube ? 0.03 : 0.01, c.d * 1.06 + (c.tube ? 0.004 : 0)), M[att.ammo]);
    band.position.set(c.at[0] + (c.tube ? 0.03 : 0), c.at[1] + (c.tube ? 0 : 0.02), c.at[2]); band.rotation.z = c.tilt;
    group.add(band);
  }
  return { group, sightLine: optic.sightLine, muzzle, laser, torch, eyeX: optic.eyeX, relief: optic.relief, lens, sight: optic.sight };
}

/** Give every gun its finish and the accessories a dark anodised one (called once on the asset registry). */
export function applyOptics(weapons: Map<string, THREE.Object3D>) {
  for (const [id, finish] of Object.entries(FINISHES) as [WeaponId, Finish][]) {
    const model = weapons.get(WEAPONS[id].model);
    if (model) refinish(model, finish);
  }
  for (const name of ['Acc_Suppressor', 'Acc_Grip']) {
    const model = weapons.get(name);
    if (model) refinish(model, { body: 0x1d1f22, dark: 0x141517, accent: 0x34373b, metal: 0.55 });
  }
}

