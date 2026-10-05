import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WEAPONS, type Attachments, type WeaponDef, type WeaponId } from '../../shared/weapons';

/**
 * Gun fitting for BeGone's arsenal: every weapon's finish, hand and muzzle points, and the visible
 * attachments (optic, suppressor, laser, flashlight, ammo counter, extended clip, recoil pad, ammo
 * band), shared by the first-person view and third-person soldiers.
 *
 * Optics are modelled in gun space (barrel along -X, up +Y, origin at the grip) from smooth lathe
 * profiles and bevelled housings on a picatinny rail, then merged into three meshes: anodised body
 * (vertex-coloured, so rubber and accent rings need no extra draw call), coated glass and the
 * glowing reticle. The fitted optic's lens axis is the sight line the view model centres when aiming.
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
  m110: { grip: [0.005, 0, 0], fore: [-0.42, 0.11, 0], muzzle: [-0.9, 0.175, 0], mag: [-0.25, -0.06, 0], magModel: 'Gun_SMG_Ammo', irons: 0.25, optic: -0.2, bore: 1.1, rail: [-0.52, 0.165, 0.032], clip: { at: [-0.245, -0.181, 0], tilt: -0.3, w: 0.06, d: 0.034 }, butt: [0.42, 0.1, 0.2], kind: 'long' },
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
  m110: { body: 0x85775a, dark: 0x2b2a26, accent: 0x5f5542 },                              // flat dark earth
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
/** Accent ring/cap colour by optic. */
const ACCENT: Record<OpticId, number> = { irons: 0x888888, reflex: 0xb3332a, holo: 0xd9772a, acog: 0xc9932f, x4: 0x3f74b8, x6: 0x2f9a8c };

type Paint = number | ((p: THREE.Vector3) => number);

class Kit {
  private parts: Record<Bucket, THREE.BufferGeometry[]> = { body: [], glass: [], glow: [] };
  /** Height added to every part (an optic on a riser). */
  lift = 0;

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
    g.translate(x, y + this.lift, z);
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
  const accent = ACCENT.reflex, plate = 0.0045;
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
function sniperScope(kit: Kit, f: ScopeFit, accent: number) {
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
  return Number.isFinite(top) ? top : 0.1;
}

const BUILDERS = { reflex: miniDot, holo: holoSight, acog: prismSight } as const;

/** One optic per (weapon, optic), modelled once and cloned (shared geometry) onto every view. */
const optics = new Map<string, { group: THREE.Group; sightLine: number }>();
function opticModel(weapons: Map<string, THREE.Object3D>, id: WeaponId, optic: OpticId) {
  const key = `${id}|${optic}`;
  let o = optics.get(key);
  if (o) return o;
  const fit = GUN_FIT[id], model = weapons.get(WEAPONS[id].model)!, kit = new Kit();
  if (optic === 'irons') o = { group: new THREE.Group(), sightLine: fit.irons };
  else if (optic === 'x4' || optic === 'x6') {
    // x6: a long rifle scope on two rings; x4: a slim long-eye-relief pistol scope over the slide.
    const pistol = optic === 'x4', L = pistol ? 0.17 : 0.34, at = fit.optic - (pistol ? 0.04 : 0), rt = pistol ? 0.0105 : 0.0155;
    const top = topAt(model, at - L * 0.3, at + L * 0.3);
    const f: ScopeFit = { front: at - L / 2, rear: at + L / 2, mount: top - 0.0015, axis: top + (pistol ? 0.02 : 0.028) + rt, rTube: rt, rBell: pistol ? 0.018 : 0.029, rEye: pistol ? 0.015 : 0.022, bellLen: pistol ? 0.04 : 0.075, eyeLen: pistol ? 0.05 : 0.085 };
    sniperScope(kit, f, ACCENT[optic]);
    o = { group: kit.build(`Optic_${optic}`), sightLine: f.axis };
  } else {
    // On long guns the open reflex sits on a rail riser, clear of the rear sight.
    if (optic === 'reflex' && fit.kind === 'long') {
      const top = rail(kit, -0.028, 0.028, 0);
      kit.add('body', roundedBox(0.05, 0.014, 0.024, 0.003), C.anodised, 0, top + 0.007);
      kit.lift = top + 0.014;
    }
    const built = BUILDERS[optic](kit);
    built.window += kit.lift;
    const top = topAt(model, fit.optic - built.length / 2, fit.optic + built.length / 2);
    const group = kit.build(`Optic_${optic}`);
    group.position.set(fit.optic, top - 0.0015, 0);
    o = { group, sightLine: top - 0.0015 + built.window };
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
}

/** Fit `att` to a clone of weapon `id`: optic, suppressor, laser, flashlight, ammo counter, extended clip, recoil pad, ammo band. */
export function fitAttachments(weapons: Map<string, THREE.Object3D>, id: WeaponId, att: Attachments = {}, view: 'first' | 'third' = 'third'): Fitted {
  const fit = GUN_FIT[id], group = new THREE.Group();
  group.name = 'Attachments';
  const muzzle = vec(fit.muzzle);
  if (fit.kind === 'knife') return { group, sightLine: 0, muzzle };
  const optic = opticModel(weapons, id, (att.optic as OpticId | undefined) ?? 'irons');
  if (optic.group.children.length) group.add(optic.group.clone());
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
  return { group, sightLine: optic.sightLine, muzzle, laser, torch };
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

