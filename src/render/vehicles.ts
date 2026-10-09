import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vehicle, VehicleKind } from '../../shared/vehicles';
import { InterpBuffer } from './interp';
import { UI_STACK } from '../ui/fonts';
import { t } from '../ui/i18n';

/**
 * Drivable vehicles, modelled in code: Taipei's yellow taxis and city sedans, Taiwanese 125 cc
 * scooters in their usual colours, and a light police helicopter whose rotors spin with the engine.
 * Models face -Z (yaw 0) like the simulation; wrecks turn to charred hulks.
 *
 * Bodies are bevelled side profiles (ExtrudeGeometry), lofted sections and lathed wheels. Each
 * model's static pieces are merged by material (paint, trim, glass, lights) into one geometry,
 * built once per kind and look and shared by every instance: a car is 8 draw calls (9 for a taxi),
 * a scooter 5, the helicopter 7. Only the body casts shadows (and the heli's rotor).
 */

export type VehiclePose = Pick<Vehicle, 'x' | 'y' | 'z' | 'yaw' | 'pitch' | 'roll' | 'vx' | 'vz' | 'rotor'>;
type Sample = { x: number; y: number; z: number; yaw: number; pitch: number; roll: number; vx: number; vz: number; rotor: number };

/** What each car looks like (by its spot index): taxi first, then city sedans. */
const CAR_LOOKS: { body: number; taxi?: boolean }[] = [
  { body: 0xf2c418, taxi: true }, { body: 0xe8e8e4 }, { body: 0xf2c418, taxi: true }, { body: 0x2a3e66 }, { body: 0x9a9ea4 }, { body: 0x8c1f22 },
];
const SCOOTER_COLORS = [0xf4f2ec, 0xc8262a, 0x2f6bb0, 0x22252a, 0x9ed6c4, 0xf2c418, 0x6a6e74];

/** Short display name for a vehicle (HUD, prompts). */
export function vehicleName(v: Pick<Vehicle, 'kind' | 'id'>) {
  if (v.kind !== 'car') return t(v.kind === 'heli' ? 'vehicle.heli' : 'vehicle.scooter');
  return t(CAR_LOOKS[v.id % CAR_LOOKS.length].taxi ? 'vehicle.taxi' : 'vehicle.car');
}

// ---------------------------------------------------------------------------------------------
// Materials (shared by every vehicle; only the paint differs by colour)

const mats = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material) {
  let m = mats.get(key);
  if (!m) { m = make(); mats.set(key, m); }
  return m;
}
const paint = (color: number, rough = 0.32, metal = 0.35) => mat(`paint${color}${rough}${metal}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
const glass = () => mat('glass', () => new THREE.MeshStandardMaterial({ color: 0x2c3c4c, roughness: 0.06, metalness: 0.55, envMapIntensity: 1.8 }));
/** Plastics, rubber, metal fittings, plates: coloured per vertex. */
const trim = () => mat('trim', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 }));
/** The helicopter's paint scheme (white, police blue, grey belly), coloured per vertex. */
const livery = () => mat('livery', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.3 }));
const tyres = () => mat('wheel', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 }));
/** Lamps: each vertex glows in its own colour (headlights, tail lights, indicators in one draw). */
const lights = () => mat('lights', () => {
  const m = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, vertexColors: true, emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.25, metalness: 0.1 });
  m.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;'); };
  m.customProgramCacheKey = () => 'vehicle-lights';
  return m;
});
const charred = () => mat('charred', () => new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 1, metalness: 0.1 }));
const ember = () => mat('ember', () => new THREE.MeshStandardMaterial({ color: 0x2a0d04, emissive: 0xff5a18, emissiveIntensity: 2.2, roughness: 1 }));

/** The taxi's roof sign lettering (one texture for every taxi). */
const taxiLabel = () => mat('taxiLabel', () => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 48;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff2b0'; g.fillRect(0, 0, 128, 48);
  g.fillStyle = '#1a1a1a'; g.font = `bold 30px ${UI_STACK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TAXI', 64, 26);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6, roughness: 0.6 });
});

// Trim colours.
const BLACK = 0x141517, DARK = 0x2a2c30, GREY = 0x4a4d52, CHROME = 0xc4c8cc, PLATE = 0xf2f2ec, RUBBER = 0x1a1a1c;
// Lamp colours (linear, scaled: above 1 glows into the bloom).
const HEAD: [number, number, number] = [1.3, 1.25, 1.1], TAIL: [number, number, number] = [1.0, 0.06, 0.04];
const AMBER: [number, number, number] = [0.9, 0.38, 0.02], REVERSE: [number, number, number] = [0.5, 0.5, 0.5];

// ---------------------------------------------------------------------------------------------
// Geometry toolkit

type Geo = THREE.BufferGeometry;
type V3 = [number, number, number];
type Rgb = number | [number, number, number];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Smoothstep from a to b (b may be below a). */
const smooth = (a: number, b: number, x: number) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };

/** Widening of a body by height and length: x' = x * s(y, z). */
type Warp = (y: number, z: number) => number;

/** Scales x by `s(y, z)`, carrying the normals through the deformation. */
function warpX(g: Geo, s: Warp) {
  const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute, e = 1e-3;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = s(y, z), ky = (s(y + e, z) - s(y - e, z)) / (2 * e), kz = (s(y, z + e) - s(y, z - e)) / (2 * e);
    p.setX(i, x * k);
    const nx = n.getX(i) / k;
    v.set(nx, n.getY(i) - x * ky * nx, n.getZ(i) - x * kz * nx).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
}

/** Collects a model's static pieces by material, each a coloured, placed copy, merged into one geometry per material. */
class Parts {
  private lists = new Map<string, Geo[]>();
  /** Applied to every piece added while set (the body's plan and tumblehome). */
  warp?: Warp;
  add(part: string, geo: Geo, color: Rgb, m?: THREE.Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.clearGroups();
    if (m) g.applyMatrix4(m);
    if (this.warp) warpX(g, this.warp);
    const c = typeof color === 'number' ? new THREE.Color(color) : new THREE.Color(...color);
    const count = g.attributes.position.count, col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    let list = this.lists.get(part);
    if (!list) this.lists.set(part, list = []);
    list.push(g);
    return this;
  }
  geometry(part: string) {
    const list = this.lists.get(part);
    if (!list?.length) return undefined;
    const g = mergeGeometries(list);
    if (!g) throw new Error(`vehicles: cannot merge ${part}`);
    return g;
  }
}

/** A placement: position, Euler rotation (XYZ) and scale. */
function at(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: number | V3 = 1) {
  const sc = typeof s === 'number' ? [s, s, s] as V3 : s;
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...sc));
}
/** A placement for a piece built along local Z, centred between a and b (local Y toward `up`). */
function along(a: V3, b: V3, up: V3 = [0, 1, 0]) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const m = new THREE.Matrix4().lookAt(va, vb, new THREE.Vector3(...up).normalize());
  return m.setPosition(va.add(vb).multiplyScalar(0.5));
}
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** A bar of w × h section from a to b. */
function beam(P: Parts, part: string, a: V3, b: V3, w: number, h: number, color: Rgb, up?: V3) {
  P.add(part, new THREE.BoxGeometry(w, h, dist(a, b)), color, along(a, b, up));
}
/** A tube of radius r from a to b. */
function rod(P: Parts, part: string, a: V3, b: V3, r: number, color: Rgb, seg = 6) {
  const g = new THREE.CylinderGeometry(r, r, dist(a, b), seg, 1);
  g.rotateX(Math.PI / 2);
  P.add(part, g, color, along(a, b, Math.abs(a[1] - b[1]) > 0.9 * dist(a, b) ? [0, 0, 1] : [0, 1, 0]));
}
/** Turns a mesh inside out (seen from within: wheel arch liners). */
function flip(geo: Geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of ['position', 'normal']) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i += 3) for (let k = 0; k < 3; k++) {
      const t1 = a.getComponent(i + 1, k); a.setComponent(i + 1, k, a.getComponent(i + 2, k)); a.setComponent(i + 2, k, t1);
    }
  }
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

/** A closed side profile (x forward, y up), each corner rounded by its radius. */
function outline(pts: [number, number, number?][]) {
  const s = new THREE.Shape(), n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x, y, r = 0] = pts[i];
    if (r <= 0) { if (i === 0) s.moveTo(x, y); else s.lineTo(x, y); continue; }
    const [px, py] = pts[(i + n - 1) % n], [qx, qy] = pts[(i + 1) % n];
    const d1 = Math.hypot(px - x, py - y), d2 = Math.hypot(qx - x, qy - y);
    const k1 = Math.min(r, d1 / 2) / d1, k2 = Math.min(r, d2 / 2) / d2;
    const ax = x + (px - x) * k1, ay = y + (py - y) * k1;
    if (i === 0) s.moveTo(ax, ay); else s.lineTo(ax, ay);
    s.quadraticCurveTo(x, y, x + (qx - x) * k2, y + (qy - y) * k2);
  }
  s.closePath();
  return s;
}
/** Points along a circular arc (centre, radius, from/to angle in radians, steps). */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps: number): [number, number][] {
  return Array.from({ length: steps + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / steps; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
}
/**
 * A side profile (forward, up) extruded across the body, centred on x = 0: forward becomes -Z.
 * Its edges are rounded by `bevel`; the silhouette stays the profile.
 */
function slab(shape: THREE.Shape, width: number, bevel: number, curve = 3, bevelSegs = 2) {
  const depth = Math.max(0.002, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: bevelSegs, curveSegments: curve, steps: 1 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

/** A licence plate facing local +Z (white, a dark rim and its characters in `ink`), placed by m. */
function plate(P: Parts, m: THREE.Matrix4, w: number, h: number, ink: number) {
  P.add('trim', new THREE.BoxGeometry(w + 0.03, h + 0.03, 0.012), BLACK, m.clone().multiply(at(0, 0, -0.008)));
  P.add('trim', new THREE.BoxGeometry(w, h, 0.012), PLATE, m);
  // ABC-1234: three letters, a dash, four digits.
  const step = w * 0.108, gw = step * 0.6, gh = h * 0.56;
  [-4, -3, -2, -0.6, 0.6, 1.6, 2.6, 3.6].forEach((k, i) => {
    const dash = i === 3;
    P.add('trim', new THREE.BoxGeometry(dash ? gw * 0.6 : gw, dash ? h * 0.1 : gh, 0.006), ink, m.clone().multiply(at(k * step * 0.92 + step * 0.16, -h * 0.02, 0.007)));
  });
}

/**
 * A wheel turning about X, its outer face toward +X: a lathed tyre with rounded shoulders, a dished
 * rim with spokes and a hub, and a dark back plate so nothing shows through.
 */
function wheelGeo(R: number, w: number, rimR: number, spokes: number, seg: number) {
  const P = new Parts(), h = w / 2, d = R - rimR;
  const lathe = (pts: [number, number][]) => {
    const g = new THREE.LatheGeometry(pts.map(([r, a]) => new THREE.Vector2(r, a)), seg);
    g.rotateZ(-Math.PI / 2);
    return g;
  };
  P.add('w', lathe([[rimR, -0.82 * h], [rimR + 0.4 * d, -h], [R - 0.25 * d, -0.97 * h], [R - 0.05 * d, -0.78 * h], [R, -0.5 * h], [R, 0.5 * h], [R - 0.05 * d, 0.78 * h], [R - 0.25 * d, 0.97 * h], [rimR + 0.4 * d, h], [rimR, 0.82 * h]]), RUBBER);
  // Rim: the lip facing out, then the barrel seen from inside.
  P.add('w', lathe([[rimR + 0.006, 0.6 * h], [rimR + 0.006, 0.88 * h], [rimR - 0.018, 0.9 * h], [rimR - 0.02, -0.3 * h]]), CHROME);
  const back = new THREE.CircleGeometry(rimR - 0.015, seg); back.rotateY(Math.PI / 2);
  P.add('w', back, 0x222326, at(-0.2 * h, 0, 0));
  for (let k = 0; k < spokes; k++) {
    const a = k * Math.PI * 2 / spokes, r0 = rimR * 0.22, r1 = rimR - 0.012;
    const g = new THREE.BoxGeometry(rimR * 0.1, r1 - r0, rimR * 0.2);
    g.translate(0, (r0 + r1) / 2, 0);
    P.add('w', g, CHROME, at(0.55 * h, 0, 0, a, 0, 0));
  }
  const hub = new THREE.CylinderGeometry(rimR * 0.3, rimR * 0.34, 0.5 * h, 12); hub.rotateZ(Math.PI / 2);
  P.add('w', hub, CHROME, at(0.5 * h, 0, 0));
  const cap = new THREE.CylinderGeometry(rimR * 0.14, rimR * 0.14, 0.3 * h, 10); cap.rotateZ(Math.PI / 2);
  P.add('w', cap, DARK, at(0.75 * h, 0, 0));
  return P.geometry('w')!;
}

// Geometries are built once per kind and look and shared by every instance.
const geoCache = new Map<string, Record<string, Geo | undefined>>();
function cached(key: string, build: () => Record<string, Geo | undefined>) {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, g = build());
  return g;
}

function mesh(geo: Geo | undefined, m: THREE.Material, castShadow = false) {
  const o = new THREE.Mesh(geo, m);
  o.castShadow = castShadow; o.receiveShadow = true;
  if (!geo) o.visible = false;
  return o;
}

interface Model { root: THREE.Group; body: THREE.Group; wheels: THREE.Object3D[]; rotor?: THREE.Object3D; tail?: THREE.Object3D; blur?: THREE.Mesh; wheelR: number }

// ---------------------------------------------------------------------------------------------
// Cars: a compact four-door sedan, 4.4 m long; the taxi adds its roof sign and red-lettered plates.

const CAR_WHEEL = { r: 0.34, x: 0.82, z: 1.36 };
/** The body's plan (narrower toward the bumpers) and tumblehome (narrower toward the roof). */
const carWarp: Warp = (y, z) => {
  const e = smooth(1.5, 2.25, Math.abs(z));
  return (1 - 0.13 * e * e) * (1 - 0.045 * smooth(0.7, 1.0, y) - 0.15 * smooth(1.0, 1.5, y));
};
/** Greenhouse: windshield base, top, roof's rear end, rear window base (forward, up). */
const GH = { w0: [1.0, 0.99], w1: [0.2, 1.455], r1: [-0.86, 1.455], b: [-1.48, 0.99], hw: 0.87 } as const;

function carGeometry(taxi: boolean) {
  return cached(taxi ? 'taxi' : 'car', () => {
    const P = new Parts();
    P.warp = carWarp;
    const { r: R, z: WZ } = CAR_WHEEL, AR = 0.44, a0 = Math.asin((0.34 - 0.27) / AR);
    // Lower body: bumpers, bonnet, waist and boot, with wheel arches cut out.
    const archPts = (c: number) => arc(c, 0.34, AR, Math.PI + a0, -a0, 10).map(([x, y]) => [x, y] as [number, number]);
    P.add('paint', slab(outline([
      [-2.2, 0.27, 0.06], ...archPts(-WZ), ...archPts(WZ), [2.16, 0.27, 0.06],
      [2.245, 0.42, 0.08], [2.235, 0.70, 0.04], [2.08, 0.85, 0.1], [1.0, 0.985, 0.12], [-1.42, 1.02, 0.08],
      [-2.03, 1.0, 0.12], [-2.225, 0.86, 0.08], [-2.24, 0.45, 0.08],
    ]), 1.84, 0.07, 6, 3), 0xffffff);
    // Glasshouse (all glass), with the roof, pillars and frames over it.
    P.add('glass', slab(outline([[GH.w0[0], GH.w0[1]], [GH.w1[0], GH.w1[1], 0.06], [-0.3, 1.49, 0.6], [GH.r1[0], GH.r1[1], 0.08], [GH.b[0], GH.b[1]]]), GH.hw * 2, 0.06, 6, 2), 0xffffff);
    P.add('paint', slab(outline([[0.33, 1.39], [0.17, 1.47, 0.06], [-0.3, 1.497, 0.6], [-0.88, 1.47, 0.08], [-1.01, 1.39], [-0.86, 1.4], [0.18, 1.4]]), GH.hw * 2 + 0.04, 0.03, 6, 2), 0xffffff);
    // Shark-fin antenna.
    P.add('paint', slab(outline([[-0.58, 1.46], [-0.86, 1.46], [-0.82, 1.54, 0.03]]), 0.06, 0.012), 0xffffff);
    const wsN: V3 = [0, 0.86, -0.51]; // windshield normal (up and forward)
    for (const s of [-1, 1]) {
      const gx = GH.hw - 0.035;
      // A pillars along the windshield's edges, C pillars over the rear quarter.
      beam(P, 'paint', [s * gx, 1.0 + 0.02, -1.0 + 0.012], [s * gx, 1.405, -0.3], 0.1, 0.04, 0xffffff, wsN);
      P.add('paint', slab(outline([[-0.7, 1.465, 0.02], [-1.02, 0.995, 0.02], [-1.5, 0.995], [-0.9, 1.475, 0.02]]), 0.03, 0.01), 0xffffff, at(s * (GH.hw + 0.006), 0, 0));
      // B pillar, waist line, rocker panel, wheel arch liners.
      beam(P, 'trim', [s * (GH.hw + 0.006), 0.99, 0.08], [s * (GH.hw + 0.006), 1.415, 0.1], 0.025, 0.09, BLACK, [0, 0, 1]);
      beam(P, 'trim', [s * (GH.hw + 0.01), 1.0, -0.96], [s * (GH.hw + 0.01), 1.0, 1.43], 0.03, 0.03, BLACK);
      beam(P, 'trim', [s * 0.915, 0.31, -0.9], [s * 0.915, 0.31, 0.9], 0.03, 0.08, DARK);
      for (const z of [-WZ, WZ]) {
        const liner = new THREE.CylinderGeometry(AR - 0.012, AR - 0.012, 0.32, 14, 1, true, -0.25, Math.PI + 0.5);
        liner.rotateZ(Math.PI / 2);
        P.add('trim', flip(liner), BLACK, at(s * 0.75, 0.34, z));
      }
      // Door seams and handles.
      for (const [f, y0] of [[0.86, 0.34], [-0.1, 0.34], [-1.02, 0.66]] as const) beam(P, 'trim', [s * 0.921, y0, -f], [s * 0.921, 0.95, -f], 0.008, 0.01, BLACK, [0, 0, 1]);
      for (const f of [0.42, -0.6]) P.add('trim', new THREE.BoxGeometry(0.02, 0.035, 0.16), CHROME, at(s * 0.925, 0.86, -f));
      // Mirrors: arm, housing, glass.
      beam(P, 'trim', [s * 0.85, 1.03, -0.78], [s * 0.98, 1.06, -0.8], 0.04, 0.03, BLACK);
      P.add('paint', slab(outline([[0.88, 1.03, 0.03], [0.88, 1.12, 0.03], [0.71, 1.13, 0.04], [0.7, 1.02, 0.03]]), 0.13, 0.03), 0xffffff, at(s * 1.03, 0, 0));
      P.add('glass', new THREE.BoxGeometry(0.1, 0.075, 0.004), 0xffffff, at(s * 1.035, 1.075, -0.698));
      // Front: headlight (bezel and lens), indicator, fog light; side repeater.
      beam(P, 'trim', [s * 0.34, 0.765, -2.168], [s * 0.8, 0.765, -2.168], 0.15, 0.04, BLACK, [0, 0.7, -0.71]);
      beam(P, 'lights', [s * 0.37, 0.768, -2.176], [s * 0.77, 0.768, -2.176], 0.12, 0.04, HEAD, [0, 0.7, -0.71]);
      P.add('lights', new THREE.BoxGeometry(0.14, 0.05, 0.03), AMBER, at(s * 0.7, 0.62, -2.235));
      const fog = new THREE.CylinderGeometry(0.045, 0.045, 0.03, 12); fog.rotateX(Math.PI / 2);
      P.add('lights', fog, [0.3, 0.3, 0.27], at(s * 0.6, 0.38, -2.25));
      P.add('lights', new THREE.BoxGeometry(0.012, 0.03, 0.08), AMBER, at(s * 0.922, 0.82, -1.58));
      // Rear: tail light wrapping round the corner, reverse light.
      P.add('trim', new THREE.BoxGeometry(0.46, 0.16, 0.03), BLACK, at(s * 0.63, 0.75, 2.232));
      P.add('lights', new THREE.BoxGeometry(0.32, 0.13, 0.04), TAIL, at(s * 0.68, 0.75, 2.235));
      P.add('lights', new THREE.BoxGeometry(0.1, 0.13, 0.04), REVERSE, at(s * 0.47, 0.75, 2.235));
      P.add('lights', new THREE.BoxGeometry(0.03, 0.12, 0.2), TAIL, at(s * 0.915, 0.75, 2.07));
      // Wipers resting at the windshield's foot.
      beam(P, 'trim', [s * 0.03, 1.035, -0.915], [s * 0.6, 1.025, -0.935], 0.03, 0.015, BLACK, wsN);
    }
    // Grille, intake, badge; plates; diffuser, exhaust, third brake light.
    P.add('trim', new THREE.BoxGeometry(0.86, 0.13, 0.05), BLACK, at(0, 0.62, -2.222));
    for (const y of [0.6, 0.645]) P.add('trim', new THREE.BoxGeometry(0.84, 0.012, 0.012), CHROME, at(0, y, -2.25));
    P.add('trim', new THREE.BoxGeometry(0.12, 0.05, 0.02), CHROME, at(0, 0.66, -2.252));
    P.add('trim', new THREE.BoxGeometry(1.1, 0.09, 0.05), BLACK, at(0, 0.35, -2.238));
    const ink = taxi ? 0xc81818 : 0x18181a;
    plate(P, at(0, 0.5, -2.262, 0, Math.PI, 0), 0.48, 0.13, ink);
    plate(P, at(0, 0.56, 2.262), 0.48, 0.15, ink);
    P.add('trim', new THREE.BoxGeometry(1.5, 0.09, 0.05), DARK, at(0, 0.33, 2.232));
    rod(P, 'trim', [0.55, 0.27, 2.12], [0.55, 0.27, 2.3], 0.035, GREY, 10);
    P.add('trim', new THREE.BoxGeometry(0.14, 0.04, 0.02), CHROME, at(-0.42, 0.66, 2.25));
    P.add('lights', new THREE.BoxGeometry(0.3, 0.03, 0.03), TAIL, at(0, 1.03, 1.47));
    if (taxi) {
      // Roof sign on its mount; a dark stripe along the doors.
      P.add('lights', slab(outline([[0.15, 1.5, 0.02], [0.09, 1.7, 0.05], [-0.09, 1.7, 0.05], [-0.15, 1.5, 0.02]]), 0.62, 0.03), [1.0, 0.92, 0.62], at(0, 0, 0.2));
      P.add('trim', new THREE.BoxGeometry(0.5, 0.03, 0.26), BLACK, at(0, 1.5, 0.2));
      for (const s of [-1, 1]) beam(P, 'trim', [s * 0.924, 0.85, -1.62], [s * 0.924, 0.85, 1.85], 0.012, 0.05, BLACK);
    }
    let label: Geo | undefined;
    if (taxi) {
      const planes = [-1, 1].map(s => {
        const g = new THREE.PlaneGeometry(0.5, 0.16);
        g.applyMatrix4(at(0, 1.6, 0.2 + s * 0.128, -s * 0.28, s > 0 ? 0 : Math.PI, 0));
        return g;
      });
      label = mergeGeometries(planes)!;
    }
    P.warp = undefined;
    return { paint: P.geometry('paint'), trim: P.geometry('trim'), glass: P.geometry('glass'), lights: P.geometry('lights'), label, wheel: wheelGeo(R, 0.24, 0.235, 5, 20) };
  });
}

function carModel(id: number): Model {
  const look = CAR_LOOKS[id % CAR_LOOKS.length];
  const g = carGeometry(!!look.taxi);
  const root = new THREE.Group(), body = new THREE.Group();
  body.add(mesh(g.paint, paint(look.body), true), mesh(g.trim, trim()), mesh(g.glass, glass()), mesh(g.lights, lights()));
  if (g.label) body.add(mesh(g.label, taxiLabel()));
  const { r, x, z } = CAR_WHEEL;
  const wheels = [-1, 1].flatMap(sx => [-z, z].map(wz => {
    const w = mesh(g.wheel, tyres());
    w.position.set(sx * x, r, wz); w.scale.x = sx;
    return w;
  }));
  root.add(body, ...wheels);
  return { root, body, wheels, wheelR: r };
}

// ---------------------------------------------------------------------------------------------
// Scooters: a Taiwanese 125 cc step-through (leg shield, flat floor, long seat, rear rack).

const SCOOTER_WHEEL = { r: 0.22, z: 0.62 };
/** Narrower toward the nose of the leg shield, the tail and the floor. */
const scooterWarp: Warp = (y, z) => {
  const f = -z;
  return (1 - 0.38 * smooth(0.42, 0.62, f)) * (1 - 0.32 * smooth(-0.72, -1.02, f)) * (1 - 0.18 * smooth(0.6, 0.28, y) * smooth(0.25, 0.4, f));
};

function scooterGeometry() {
  return cached('scooter', () => {
    const color = 0xffffff; // the paint material carries each scooter's colour: one geometry for all
    const P = new Parts(), SEAT = 0x1c1c1f, SPRING = 0xc89a1a;
    P.warp = scooterWarp;
    // Body panels: under-seat body, floor skirt, leg shield, front mudguard, handlebar cover.
    P.add('paint', slab(outline([[-0.22, 0.3, 0.02], [-0.12, 0.4, 0.05], [-0.08, 0.7, 0.06], [-0.9, 0.72, 0.1], [-1.0, 0.6, 0.08], [-0.96, 0.48, 0.06], [-0.8, 0.42, 0.04], [-0.42, 0.38, 0.05], [-0.34, 0.26, 0.03]]), 0.38, 0.07, 4, 2), color);
    P.add('paint', slab(outline([[0.36, 0.17, 0.03], [0.39, 0.27, 0.02], [-0.3, 0.27, 0.02], [-0.36, 0.18, 0.03]]), 0.3, 0.04, 3, 1), color);
    P.add('paint', slab(outline([[0.3, 0.25, 0.03], [0.36, 0.26, 0.04], [0.40, 0.42, 0.06], [0.52, 0.5, 0.05], [0.57, 0.66, 0.08], [0.6, 0.98, 0.06], [0.56, 1.08, 0.05], [0.44, 1.06, 0.05], [0.38, 0.62, 0.1], [0.33, 0.34, 0.04]]), 0.46, 0.06, 4, 2), color);
    // Seat.
    P.add('trim', slab(outline([[-0.06, 0.7], [-0.06, 0.78, 0.04], [-0.14, 0.81, 0.06], [-0.4, 0.8, 0.1], [-0.56, 0.845, 0.08], [-0.84, 0.85, 0.05], [-0.9, 0.8, 0.04], [-0.88, 0.7]]), 0.34, 0.05, 4, 2), SEAT);
    P.warp = undefined;
    P.add('paint', slab(outline([...arc(0.62, 0.22, 0.285, 0.35, 2.7, 8), ...arc(0.62, 0.22, 0.255, 2.7, 0.35, 8)]), 0.12, 0.012, 3, 1), color);
    P.add('paint', slab(outline([[0.42, 1.03, 0.03], [0.6, 1.06, 0.03], [0.66, 1.1, 0.03], [0.68, 1.19, 0.04], [0.6, 1.25, 0.04], [0.44, 1.26, 0.04]]), 0.36, 0.05, 3, 1), color);
    // Glove-box panel on the back of the leg shield, floorboard with its rubber ribs.
    P.add('trim', new THREE.BoxGeometry(0.26, 0.3, 0.02), GREY, at(0, 0.8, -0.395, 0.14, 0, 0));
    P.add('trim', slab(outline([[0.38, 0.27], [0.36, 0.34, 0.02], [-0.22, 0.34, 0.02], [-0.26, 0.27]]), 0.36, 0.015, 3, 1), GREY);
    for (const x of [-0.12, -0.06, 0, 0.06, 0.12]) beam(P, 'trim', [x, 0.345, 0.18], [x, 0.345, -0.32], 0.015, 0.008, BLACK);
    // Engine and CVT case (left), muffler (right), rear shock, kickstand.
    P.add('trim', slab(outline([[-0.06, 0.18], [-0.06, 0.32, 0.04], [-0.32, 0.36], [-0.32, 0.16, 0.04]]), 0.22, 0.03, 3, 1), GREY);
    P.add('trim', slab(outline([[-0.12, 0.3, 0.05], [-0.3, 0.36, 0.06], [-0.7, 0.31, 0.08], [-0.74, 0.17, 0.06], [-0.3, 0.12, 0.05], [-0.14, 0.18, 0.04]]), 0.08, 0.02, 3, 1), GREY, at(-0.1, 0, 0));
    rod(P, 'trim', [0.04, 0.17, 0.15], [0.13, 0.24, 0.38], 0.022, DARK);
    rod(P, 'trim', [0.15, 0.27, 0.4], [0.15, 0.33, 0.8], 0.058, DARK, 12);
    P.add('trim', new THREE.BoxGeometry(0.02, 0.09, 0.28), CHROME, at(0.212, 0.3, 0.58, 0.15, 0, 0));
    rod(P, 'trim', [0.15, 0.33, 0.8], [0.15, 0.345, 0.86], 0.03, CHROME);
    rod(P, 'trim', [-0.11, 0.3, 0.66], [-0.11, 0.6, 0.5], 0.026, SPRING);
    rod(P, 'trim', [-0.1, 0.2, 0.18], [-0.22, 0.02, 0.05], 0.014, DARK);
    P.add('trim', new THREE.BoxGeometry(0.06, 0.014, 0.035), DARK, at(-0.225, 0.007, 0.05));
    for (const s of [-1, 1]) {
      // Front fork, handlebar grips, levers, mirrors, passenger pegs.
      rod(P, 'trim', [s * 0.072, 0.22, -0.62], [s * 0.072, 0.92, -0.51], 0.022, 0x8c9096);
      rod(P, 'trim', [s * 0.21, 1.2, -0.5], [s * 0.33, 1.2, -0.5], 0.025, BLACK);
      beam(P, 'trim', [s * 0.17, 1.215, -0.56], [s * 0.3, 1.205, -0.58], 0.014, 0.012, CHROME);
      rod(P, 'trim', [s * 0.19, 1.23, -0.48], [s * 0.27, 1.38, -0.46], 0.008, DARK, 6);
      const head = new THREE.CylinderGeometry(0.042, 0.042, 0.022, 12); head.rotateX(Math.PI / 2);
      P.add('trim', head, BLACK, at(s * 0.28, 1.41, -0.46, 0, 0, 0, [1.45, 1, 1]));
      const face = new THREE.CylinderGeometry(0.034, 0.034, 0.004, 12); face.rotateX(Math.PI / 2);
      P.add('trim', face, CHROME, at(s * 0.28, 1.41, -0.447, 0, 0, 0, [1.45, 1, 1]));
      rod(P, 'trim', [s * 0.15, 0.36, 0.4], [s * 0.23, 0.36, 0.42], 0.012, BLACK, 6);
      // Rack rails.
      rod(P, 'trim', [s * 0.13, 0.76, 0.84], [s * 0.12, 0.79, 1.02], 0.014, DARK, 6);
      // Indicators: front on the leg shield, rear beside the tail light; position-light strips.
      P.add('lights', new THREE.BoxGeometry(0.04, 0.035, 0.05), AMBER, at(s * 0.12, 0.98, -0.585));
      P.add('lights', new THREE.BoxGeometry(0.05, 0.035, 0.04), AMBER, at(s * 0.12, 0.54, 0.985));
      beam(P, 'lights', [s * 0.02, 0.9, -0.6], [s * 0.085, 0.87, -0.596], 0.025, 0.012, HEAD, [0, 0, -1]);
    }
    rod(P, 'trim', [-0.21, 1.2, -0.5], [0.21, 1.2, -0.5], 0.016, DARK);
    P.add('trim', new THREE.BoxGeometry(0.16, 0.012, 0.08), BLACK, at(0, 1.258, -0.5, -0.15, 0, 0));
    P.add('trim', new THREE.BoxGeometry(0.06, 0.02, 0.01), CHROME, at(0, 0.72, -0.58));
    rod(P, 'trim', [-0.12, 0.79, 1.02], [0.12, 0.79, 1.02], 0.014, DARK, 6);
    P.add('trim', new THREE.BoxGeometry(0.2, 0.014, 0.16), DARK, at(0, 0.775, 0.93));
    // Number plate on its mudguard bracket, headlight, tail light.
    beam(P, 'trim', [0, 0.47, 0.9], [0, 0.4, 1.04], 0.16, 0.02, BLACK);
    plate(P, at(0, 0.36, 1.05, -0.25, 0, 0), 0.21, 0.11, 0x18181a);
    beam(P, 'lights', [-0.11, 1.15, -0.676], [0.11, 1.15, -0.676], 0.07, 0.03, HEAD, [0, 0.2, -1]);
    beam(P, 'lights', [-0.09, 0.62, 0.99], [0.09, 0.62, 0.99], 0.05, 0.02, TAIL, [0, 0, 1]);
    const { r } = SCOOTER_WHEEL;
    return { paint: P.geometry('paint'), trim: P.geometry('trim'), lights: P.geometry('lights'), wheel: wheelGeo(r, 0.11, 0.15, 5, 12) };
  });
}

function scooterModel(id: number): Model {
  const color = SCOOTER_COLORS[id % SCOOTER_COLORS.length];
  const g = scooterGeometry();
  const root = new THREE.Group(), body = new THREE.Group();
  body.add(mesh(g.paint, paint(color, 0.3, 0.2), true), mesh(g.trim, trim()), mesh(g.lights, lights()));
  const { r, z } = SCOOTER_WHEEL;
  const wheels = [-z, z].map(wz => { const w = mesh(g.wheel, tyres()); w.position.set(0, r, wz); return w; });
  root.add(body, ...wheels);
  return { root, body, wheels, wheelR: r };
}

// ---------------------------------------------------------------------------------------------
// Helicopter: a light police helicopter (glazed nose, tail boom, skids, four-blade rotor).

/** A cross-section of a lofted body: its z, half width and half height, and centre height. */
interface Station { z: number; rx: number; ry: number; cy: number }
/** The section at z, interpolated smoothly (Catmull-Rom) between key sections. */
function stationAt(keys: Station[], z: number): Station {
  let i = 0;
  while (i < keys.length - 2 && z > keys[i + 1].z) i++;
  const p1 = keys[i], p2 = keys[i + 1], p0 = keys[i - 1] ?? p1, p3 = keys[i + 2] ?? p2;
  const u = clamp01((z - p1.z) / (p2.z - p1.z)), u2 = u * u, u3 = u2 * u;
  const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (3 * b - a - 3 * c + d) * u3);
  return { z, rx: cr(p0.rx, p1.rx, p2.rx, p3.rx), ry: cr(p0.ry, p1.ry, p2.ry, p3.ry), cy: cr(p0.cy, p1.cy, p2.cy, p3.cy) };
}
/** A point on a superelliptic section (phi in degrees from +X toward +Y), pushed out by `inflate`. */
function sectionPoint(s: Station, phi: number, n: number, inflate = 0): V3 {
  const a = phi * Math.PI / 180, c = Math.cos(a), si = Math.sin(a);
  return [Math.sign(c) * Math.abs(c) ** (2 / n) * (s.rx + inflate), s.cy + Math.sign(si) * Math.abs(si) ** (2 / n) * (s.ry + inflate), s.z];
}
/**
 * A lofted skin over sections at `zs` and angles `phis`, split into parts by `paint(zMid, phiMid)`
 * (which also gives each quad's colour): crisp seams between glass and paint.
 */
function loft(P: Parts, keys: Station[], zs: number[], phis: number[], n: number, paint: (z: number, phi: number) => [part: string, color: Rgb], inflate = 0) {
  const nz = zs.length, np = phis.length, pos = new Float32Array(nz * np * 3), index: number[] = [];
  zs.forEach((z, i) => { const s = stationAt(keys, z); phis.forEach((p, j) => pos.set(sectionPoint(s, p, n, inflate), (i * np + j) * 3)); });
  for (let i = 0; i < nz - 1; i++) for (let j = 0; j < np - 1; j++) {
    const a = i * np + j, b = a + 1, c = a + np, d = c + 1;
    index.push(a, b, c, b, d, c);
  }
  const grid = new THREE.BufferGeometry();
  grid.setAttribute('position', new THREE.BufferAttribute(pos, 3)); grid.setIndex(index); grid.computeVertexNormals();
  const nrm = grid.attributes.normal.array as Float32Array, out = new Map<string, { p: number[]; n: number[]; color: Rgb }[]>();
  for (let i = 0; i < nz - 1; i++) for (let j = 0; j < np - 1; j++) {
    const [part, color] = paint((zs[i] + zs[i + 1]) / 2, (phis[j] + phis[j + 1]) / 2);
    const a = i * np + j, b = a + 1, c = a + np, d = c + 1, quad = { p: [] as number[], n: [] as number[], color };
    for (const v of [a, b, c, b, d, c]) { quad.p.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); quad.n.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]); }
    let list = out.get(part);
    if (!list) out.set(part, list = []);
    list.push(quad);
  }
  for (const [part, quads] of out) for (const q of quads) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(q.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(q.n, 3));
    P.add(part, g, q.color);
  }
}
const range = (a: number, b: number, step: number, extra: number[] = []) => {
  const out = new Set<number>(extra.filter(v => v >= a && v <= b));
  for (let v = a; v < b; v += step) out.add(+v.toFixed(4));
  out.add(b);
  return [...out].sort((p, q) => p - q);
};

const HELI_BODY: Station[] = [
  { z: -2.14, rx: 0.03, ry: 0.03, cy: 1.3 }, { z: -2.08, rx: 0.34, ry: 0.38, cy: 1.31 }, { z: -1.95, rx: 0.56, ry: 0.62, cy: 1.33 },
  { z: -1.7, rx: 0.76, ry: 0.82, cy: 1.36 }, { z: -1.35, rx: 0.9, ry: 0.94, cy: 1.38 }, { z: -0.9, rx: 0.98, ry: 0.99, cy: 1.4 },
  { z: -0.3, rx: 1.0, ry: 1.0, cy: 1.42 }, { z: 0.25, rx: 0.96, ry: 0.95, cy: 1.45 }, { z: 0.7, rx: 0.78, ry: 0.76, cy: 1.52 },
  { z: 1.05, rx: 0.48, ry: 0.48, cy: 1.6 }, { z: 1.3, rx: 0.27, ry: 0.28, cy: 1.63 }, { z: 1.6, rx: 0.23, ry: 0.24, cy: 1.64 },
  { z: 4.85, rx: 0.12, ry: 0.13, cy: 1.7 }, { z: 5.0, rx: 0.08, ry: 0.09, cy: 1.7 }, { z: 5.06, rx: 0.02, ry: 0.02, cy: 1.7 },
];
const HELI_COWL: Station[] = [
  { z: -1.0, rx: 0.06, ry: 0.04, cy: 2.28 }, { z: -0.85, rx: 0.32, ry: 0.17, cy: 2.31 }, { z: -0.5, rx: 0.42, ry: 0.22, cy: 2.33 },
  { z: 0.4, rx: 0.42, ry: 0.22, cy: 2.33 }, { z: 0.8, rx: 0.3, ry: 0.15, cy: 2.2 }, { z: 1.2, rx: 0.1, ry: 0.06, cy: 1.97 },
];
const WHITE = 0xeeeeea, BLUE = 0x1f4fa8, BELLY = 0x3a3e46;

function heliGeometry() {
  return cached('heli', () => {
    const P = new Parts(), n = 2.5;
    const isCanopy = (z: number, p: number) => z < -0.75 && p > -35 && p < 215;
    const isWindow = (z: number, p: number) => z > -0.62 && z < 0.3 && ((p > 15 && p < 70) || (p > 110 && p < 165));
    const scheme = (p: number) => p < -55 || p > 235 ? BELLY : (p > -22 && p < -6) || (p > 186 && p < 202) ? BLUE : WHITE;
    loft(P, HELI_BODY, range(-2.14, 1.6, 0.1, [-2.08, -0.79, -0.75, -0.71, -0.62, 0.3]).concat([2.6, 3.7, 4.85, 5.0, 5.06]),
      range(-90, 270, 7.5, [-55, -35, -22, -6, 15, 70, 110, 165, 186, 202, 215, 235]), n,
      (z, p) => isCanopy(z, p) || isWindow(z, p) ? ['glass', 0xffffff] : ['body', scheme(p)]);
    loft(P, HELI_COWL, range(-1.0, 1.2, 0.1), range(-30, 210, 10), 3, () => ['body', WHITE]);
    // Frames round the glazing (proud of the skin).
    const band = (z0: number, z1: number, p0: number, p1: number) => loft(P, HELI_BODY, range(z0, z1, 0.08), range(p0, p1, 6), n, () => ['body', WHITE], 0.014);
    band(-0.8, -0.72, -37, 217); band(-2.06, -0.75, 87, 93); band(-2.1, -0.75, -38, -33); band(-2.1, -0.75, 213, 218);
    for (const [p0, p1] of [[13, 72], [108, 167]]) {
      band(-0.66, -0.59, p0, p1); band(0.28, 0.35, p0, p1);
      band(-0.62, 0.3, p0, p0 + 4); band(-0.62, 0.3, p1 - 4, p1);
    }
    // Door seams, handles.
    for (const [p0, p1] of [[-40, 14], [166, 220]]) for (const z of [-0.62, 0.3]) loft(P, HELI_BODY, [z - 0.01, z + 0.01], range(p0, p1, 6), n, () => ['trim', DARK], 0.006);
    for (const p of [4, 176]) { const [x, y] = sectionPoint(stationAt(HELI_BODY, 0.18), p, n, 0.02); P.add('trim', new THREE.BoxGeometry(0.03, 0.03, 0.14), CHROME, at(x, y, 0.18)); }
    // Fin with its ventral fin, stabiliser with end plates.
    P.add('body', slab(outline([[-4.5, 1.78, 0.04], [-4.94, 2.62, 0.05], [-5.14, 2.64, 0.04], [-5.1, 1.7], [-5.13, 1.28, 0.04], [-4.97, 1.26, 0.04], [-4.78, 1.62]]), 0.07, 0.02), BLUE);
    P.add('body', slab(outline([[-4.16, 1.64, 0.02], [-4.2, 1.69, 0.02], [-4.46, 1.69, 0.02], [-4.46, 1.64, 0.02]]), 1.12, 0.02), WHITE);
    for (const s of [-1, 1]) P.add('body', slab(outline([[-4.14, 1.58, 0.03], [-4.24, 1.84, 0.03], [-4.48, 1.84, 0.03], [-4.48, 1.56, 0.03]]), 0.03, 0.01), BLUE, at(s * 0.57, 0, 0));
    // Engine exhausts and intakes, rotor mast and swashplate, tail rotor gearbox.
    for (const s of [-1, 1]) {
      rod(P, 'trim', [s * 0.2, 2.3, 0.62], [s * 0.24, 2.34, 0.95], 0.06, DARK, 10);
      P.add('trim', new THREE.BoxGeometry(0.02, 0.12, 0.3), BLACK, at(s * 0.41, 2.36, -0.45));
    }
    rod(P, 'trim', [0, 2.4, -0.3], [0, 2.62, -0.3], 0.07, GREY, 10);
    const swash = new THREE.CylinderGeometry(0.17, 0.17, 0.04, 14);
    P.add('trim', swash, DARK, at(0, 2.56, -0.3));
    P.add('trim', new THREE.BoxGeometry(0.1, 0.14, 0.18), GREY, at(0.06, 2.05, 4.95));
    // Skids: tubes with turned-up toes, on two arched cross tubes.
    for (const s of [-1, 1]) {
      const x = s * 0.86;
      const skid = new THREE.CatmullRomCurve3([[x, 0.06, 0.95], [x, 0.06, 0.3], [x, 0.06, -0.6], [x, 0.06, -1.4], [x, 0.09, -1.74], [x, 0.18, -1.92], [x, 0.31, -2.02]].map(p => new THREE.Vector3(...p)));
      P.add('trim', new THREE.TubeGeometry(skid, 28, 0.045, 8), DARK);
      P.add('trim', new THREE.SphereGeometry(0.045, 8, 6), DARK, at(x, 0.06, 0.95));
      for (const z of [-1.2, 0.3]) {
        const cross = new THREE.CatmullRomCurve3([[x, 0.08, z], [s * 0.85, 0.24, z], [s * 0.76, 0.4, z], [s * 0.58, 0.52, z], [s * 0.36, 0.6, z]].map(p => new THREE.Vector3(...p)));
        P.add('trim', new THREE.TubeGeometry(cross, 12, 0.04, 8), DARK);
      }
      // Step on the cross tubes.
      P.add('trim', new THREE.BoxGeometry(0.16, 0.025, 1.6), GREY, at(s * 0.83, 0.3, -0.45));
    }
    // Lights: nav (red left, green right), beacons, tail light, searchlight under the nose.
    for (const s of [-1, 1]) {
      P.add('lights', new THREE.SphereGeometry(0.03, 8, 6), s < 0 ? [1.4, 0.05, 0.05] : [0.05, 1.4, 0.2], at(s * 0.59, 1.86, 4.3));
    }
    P.add('lights', new THREE.SphereGeometry(0.045, 10, 6), [1.6, 0.12, 0.05], at(0, 2.66, 5.04));
    P.add('lights', new THREE.SphereGeometry(0.05, 10, 6), [1.6, 0.12, 0.05], at(0, 0.42, -0.2));
    P.add('lights', new THREE.SphereGeometry(0.035, 8, 6), HEAD, at(0, 1.7, 5.07));
    rod(P, 'trim', [0.42, 0.62, -1.4], [0.42, 0.5, -1.45], 0.02, DARK);
    rod(P, 'trim', [0.42, 0.48, -1.38], [0.42, 0.44, -1.62], 0.07, DARK, 12);
    const lens = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12); lens.rotateX(Math.PI / 2);
    P.add('lights', lens, [0.7, 0.68, 0.6], along([0.42, 0.44, -1.62], [0.42, 0.43, -1.64]));
    // Antennas.
    rod(P, 'trim', [0, 0.45, 0.4], [0, 0.22, 0.6], 0.012, BLACK, 5);
    rod(P, 'trim', [0, 2.38, 0.55], [0, 2.62, 0.75], 0.01, BLACK, 5);

    // Main rotor: hub, grips and four aerofoil blades with yellow tips (built about the mast, spun as one).
    const R = new Parts();
    R.add('r', new THREE.CylinderGeometry(0.17, 0.19, 0.12, 14), DARK, at(0, 0.08, 0));
    R.add('r', new THREE.SphereGeometry(0.12, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), GREY, at(0, 0.14, 0, 0, 0, 0, [1, 0.6, 1]));
    const foil = (c: number, th: number, span: number) => {
      const s = new THREE.Shape();
      s.moveTo(0.5 * c, 0); s.lineTo(0.28 * c, 0.5 * th); s.lineTo(-0.15 * c, 0.48 * th); s.lineTo(-0.5 * c, 0.12 * th);
      s.lineTo(-0.5 * c, -0.12 * th); s.lineTo(-0.15 * c, -0.4 * th); s.lineTo(0.28 * c, -0.38 * th); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: false });
      g.rotateY(Math.PI / 2);
      return g;
    };
    for (let k = 0; k < 4; k++) {
      const yaw = k * Math.PI / 2;
      R.add('r', new THREE.BoxGeometry(0.34, 0.07, 0.14), GREY, at(0, 0.11, 0, 0, yaw, 0).multiply(at(0.29, 0, 0)));
      R.add('r', foil(0.27, 0.045, 4.5), 0x2a2d33, at(0, 0.12, 0, 0, yaw, 0).multiply(at(0.45, 0, 0)));
      R.add('r', foil(0.27, 0.045, 0.25), 0xf2c418, at(0, 0.12, 0, 0, yaw, 0).multiply(at(4.95, 0, 0)));
    }
    // Tail rotor: hub and two blades (four arms) with red and white tips, turning about X.
    const T = new Parts();
    const thub = new THREE.CylinderGeometry(0.05, 0.05, 0.08, 10); thub.rotateZ(Math.PI / 2);
    T.add('t', thub, GREY);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      T.add('t', new THREE.BoxGeometry(0.014, 0.38, 0.1), DARK, at(0.02, 0, 0, a, 0, 0).multiply(at(0, 0.23, 0)));
      T.add('t', new THREE.BoxGeometry(0.014, 0.08, 0.1), 0xe8e8e4, at(0.02, 0, 0, a, 0, 0).multiply(at(0, 0.46, 0)));
      T.add('t', new THREE.BoxGeometry(0.014, 0.06, 0.1), 0xc81818, at(0.02, 0, 0, a, 0, 0).multiply(at(0, 0.53, 0)));
    }
    return { body: P.geometry('body'), trim: P.geometry('trim'), glass: P.geometry('glass'), lights: P.geometry('lights'), rotor: R.geometry('r'), tail: T.geometry('t') };
  });
}

function heliModel(): Model {
  const g = heliGeometry();
  const root = new THREE.Group(), body = new THREE.Group();
  body.add(mesh(g.body, livery(), true), mesh(g.trim, trim()), mesh(g.glass, glass()), mesh(g.lights, lights()));
  const rotor = mesh(g.rotor, trim(), true);
  rotor.position.set(0, 2.62, -0.3);
  const blur = new THREE.Mesh(new THREE.CircleGeometry(5.2, 40), new THREE.MeshBasicMaterial({ color: 0x202226, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  blur.rotation.x = -Math.PI / 2; blur.position.set(0, 2.76, -0.3);
  const tail = mesh(g.tail, trim());
  tail.position.set(0.12, 2.05, 4.95);
  body.add(rotor, blur, tail);
  root.add(body);
  return { root, body, wheels: [], rotor, tail, blur, wheelR: 1 };
}

function buildModel(kind: VehicleKind, id: number) {
  return kind === 'car' ? carModel(id) : kind === 'scooter' ? scooterModel(id) : heliModel();
}

interface View { kind: VehicleKind; model: Model; buffer: InterpBuffer<Sample>; wrecked: boolean; spin: number; roll: number; pose: Sample; embers?: THREE.Object3D }

/** Renders every vehicle of the match: interpolated from snapshots, or a predicted pose for the one we drive. */
export class VehiclesView {
  readonly group = new THREE.Group();
  private views = new Map<number, View>();

  sync(vehicles: Vehicle[], t: number) {
    const seen = new Set<number>();
    for (const v of vehicles) {
      seen.add(v.id);
      let view = this.views.get(v.id);
      if (!view || view.kind !== v.kind) {
        if (view) view.model.root.removeFromParent();
        const model = buildModel(v.kind, v.id);
        this.group.add(model.root);
        view = { kind: v.kind, model, buffer: new InterpBuffer(), wrecked: false, spin: 0, roll: 0, pose: { ...v } };
        this.views.set(v.id, view);
      }
      const last = view.buffer.latest();
      // Round resets park vehicles far away: never interpolate across the map.
      if (last && Math.hypot(last.x - v.x, last.z - v.z) > 25) view.buffer.clear();
      view.buffer.push(t, { x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: v.pitch, roll: v.roll, vx: v.vx, vz: v.vz, rotor: v.rotor });
      if (v.wrecked !== view.wrecked) this.setWrecked(view, v.wrecked);
    }
    for (const [id, view] of this.views) if (!seen.has(id)) { view.model.root.removeFromParent(); this.views.delete(id); }
  }

  /** Interpolated pose of vehicle `id` (what the renderer shows), if known. */
  pose(id: number): Sample | undefined { return this.views.get(id)?.pose; }

  /** Place every vehicle; `predicted` overrides the interpolated pose (the vehicle we drive). */
  update(dt: number, renderTime: number, predicted?: { id: number; pose: VehiclePose }) {
    for (const [id, view] of this.views) {
      const sample = predicted?.id === id ? predicted.pose : view.buffer.sample(renderTime, ['yaw']);
      if (!sample) continue;
      view.pose = { x: sample.x, y: sample.y, z: sample.z, yaw: sample.yaw, pitch: sample.pitch, roll: sample.roll, vx: sample.vx, vz: sample.vz, rotor: sample.rotor };
      const { root, body, wheels, rotor, tail, blur, wheelR } = view.model;
      root.position.set(sample.x, sample.y, sample.z);
      root.rotation.set(sample.pitch, sample.yaw, -sample.roll, 'YXZ');
      if (view.wrecked) continue;
      // Wheels roll with the ground speed along the heading.
      const forward = -Math.sin(sample.yaw) * sample.vx - Math.cos(sample.yaw) * sample.vz;
      for (const w of wheels) w.rotation.x -= forward / wheelR * dt;
      if (rotor) {
        view.spin += sample.rotor * 38 * dt;
        rotor.rotation.y = view.spin;
        if (tail) tail.rotation.x = view.spin * 2.7;
        if (blur) (blur.material as THREE.MeshBasicMaterial).opacity = Math.max(0, sample.rotor - 0.35) * 0.35;
      }
      void body;
    }
  }

  private setWrecked(view: View, wrecked: boolean) {
    view.wrecked = wrecked;
    if (!wrecked) {
      // A round reset brings a fresh vehicle: rebuild it.
      const id = [...this.views.entries()].find(([, v]) => v === view)![0];
      view.model.root.removeFromParent();
      view.model = buildModel(view.kind, id);
      this.group.add(view.model.root);
      return;
    }
    view.model.root.traverse(o => {
      if (o instanceof THREE.Mesh) {
        if (o.material instanceof THREE.MeshBasicMaterial) o.visible = false;
        else o.material = charred();
      }
    });
    if (view.model.rotor) { view.model.rotor.visible = true; view.model.rotor.rotation.z = 0.25; }
    // Smouldering engine bay (car), engine (scooter) or turbine (helicopter).
    const embers = new THREE.Mesh(new THREE.BoxGeometry(view.kind === 'scooter' ? 0.3 : 0.9, 0.12, view.kind === 'scooter' ? 0.4 : 0.8), ember());
    const at = { car: [0.97, -1.5], scooter: [0.84, 0.45], heli: [2.52, -0.1] }[view.kind];
    embers.position.set(0, at[0], at[1]);
    view.model.root.add(embers);
    view.embers = embers;
    view.model.body.rotation.z = 0.05;
  }

  dispose() { this.group.clear(); this.views.clear(); }
}
