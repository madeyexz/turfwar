import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Models built in code: the knife skins (shared/skins.ts) in the knife's model space (held at the
 * origin, reaching along -X, the flat face across Z so a swing lands flat): the 藍白拖 (toe along -X,
 * held by the heel) and the 掃把 (held at the end of the handle, the brush at -X); and the 珍奶
 * cup (upright, centred).
 */

const BLUE = 0x2f6fe0, WHITE = 0xe4e8e4;
const mat = (color: number, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

/** A slipper's paint: [colour, roughness, metalness] for each part. */
interface SlipperPaint { footbed: [number, number, number]; sole: [number, number, number]; tread: [number, number, number]; strap: [number, number, number]; ridge: [number, number, number] }
const BLUE_WHITE: SlipperPaint = { footbed: [WHITE, 0.7, 0], sole: [BLUE, 0.85, 0], tread: [0x2458c0, 0.9, 0], strap: [BLUE, 0.6, 0], ridge: [0x4a86f0, 0.5, 0] };
/** 金拖 (the invite reward): the same slipper in polished gold on a satin-gold footbed. */
const GOLD: SlipperPaint = { footbed: [0xffe39a, 0.35, 0.35], sole: [0xf0b020, 0.28, 0.8], tread: [0xb07a12, 0.45, 0.7], strap: [0xffc21f, 0.18, 0.85], ridge: [0xfff3c0, 0.12, 0.9] };
/** Metal parts glow a little of their own colour, so the gold still reads as gold in a dark alley. */
const paint = ([color, roughness, metalness]: [number, number, number]) => {
  const m = mat(color, roughness, metalness);
  if (metalness > 0) m.emissive.setHex(color).multiplyScalar(0.18);
  return m;
};

/** The slipper's outline (x along its length, toe at -X; y across it). */
function footprint() {
  const s = new THREE.Shape();
  s.moveTo(0.06, 0);
  s.bezierCurveTo(0.06, 0.033, 0.035, 0.037, -0.03, 0.037);
  s.bezierCurveTo(-0.11, 0.038, -0.15, 0.05, -0.19, 0.049);
  s.bezierCurveTo(-0.235, 0.047, -0.25, 0.022, -0.25, 0);
  s.bezierCurveTo(-0.25, -0.024, -0.235, -0.046, -0.195, -0.047);
  s.bezierCurveTo(-0.14, -0.048, -0.1, -0.033, -0.03, -0.034);
  s.bezierCurveTo(0.035, -0.035, 0.06, -0.032, 0.06, 0);
  return s;
}

const slab = (depth: number, z: number) => new THREE.ExtrudeGeometry(footprint(), { depth, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.003, bevelSegments: 2, curveSegments: 10 }).translate(0, 0, z);

/** Rows of grip grooves across the outsole. */
function treads(group: THREE.Group, m: THREE.Material) {
  const groove = new THREE.BoxGeometry(0.006, 0.07, 0.003);
  for (let x = 0.03; x > -0.22; x -= 0.03) {
    const bar = new THREE.Mesh(groove, m);
    bar.position.set(x, 0, -0.0105);
    bar.scale.y = x < -0.1 ? 1.2 : 0.95;
    group.add(bar);
  }
}

/** The 藍白拖: a white footbed on a blue outsole, one wide blue strap over the forefoot. `gold`: the 金拖. */
export function slipperModel(gold = false) {
  const c = gold ? GOLD : BLUE_WHITE;
  const group = new THREE.Group();
  group.name = gold ? 'Knife_GoldSlipper' : 'Knife_Slipper';
  group.add(new THREE.Mesh(slab(0.014, 0), paint(c.footbed)));
  group.add(new THREE.Mesh(slab(0.006, -0.008), paint(c.sole)));
  treads(group, paint(c.tread));
  // The strap: an arch across the sole (in y–z), extruded along the slipper's length.
  const arch = new THREE.Shape();
  arch.absellipse(0, 0, 0.056, 0.034, 0, Math.PI, false);
  arch.lineTo(-0.048, 0);
  arch.absellipse(0, 0, 0.048, 0.027, Math.PI, 0, true);
  arch.lineTo(0.056, 0);
  const strap = new THREE.ExtrudeGeometry(arch, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.002, bevelSegments: 2, curveSegments: 16 });
  // Shape (x, y, extrusion) → slipper (y across, z up from the footbed, x along the length).
  strap.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  const band = new THREE.Mesh(strap, paint(c.strap));
  band.position.set(-0.19, 0, 0.015);
  group.add(band);
  // The strap's moulded ridges catch the light like the real thing.
  for (const x of [-0.17, -0.15, -0.13]) {
    const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.0028, 6, 20, Math.PI), paint(c.ridge));
    ridge.rotation.y = Math.PI / 2;
    ridge.scale.set(0.66, 1.02, 1);
    ridge.position.set(x, 0, 0.016);
    group.add(ridge);
  }
  group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return group;
}

/** Paint a geometry one colour (as a vertex colour attribute) so pieces of one material can be merged. */
function painted(geo: THREE.BufferGeometry, color: number) {
  const g = geo.index ? geo.toNonIndexed() : geo, c = new THREE.Color(color), n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

/** A cylinder along -X from `x0` to `x1` (radius `r0` at x0, `r1` at x1). */
const alongX = (x0: number, x1: number, r0: number, r1: number, segments = 10) =>
  new THREE.CylinderGeometry(r1, r0, x0 - x1, segments).rotateZ(Math.PI / 2).translate((x0 + x1) / 2, 0, 0);

/**
 * The 掃把: the plastic broom in every Taiwanese home, held at the end of its red handle. A neon-green
 * head (socket and crossbar, a white price sticker) carries pink and green bristles that splay and
 * split at the ends (開叉) from years of sweeping. The bristles fan across Y with their flat side
 * across Z, so a swing lands with the whole brush. About a metre long.
 */
/** How far up the broom's handle (from the butt) the hand holds it, as the swing does. */
export const BROOM_CHOKE = 0.3;
export function broomModel() {
  const group = new THREE.Group();
  group.name = 'Knife_Broom';
  const plastic = (roughness: number) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 });
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // The handle: a red plastic-sleeved tube with a hanging cap at the butt.
  const handle = [painted(alongX(0.06, -0.72, 0.0135, 0.0135, 12), 0xd23a3c), painted(alongX(0.075, 0.055, 0.0145, 0.015, 12), 0xb02a2e)];
  group.add(new THREE.Mesh(mergeGeometries(handle), plastic(0.38)));
  // The head: a socket round the handle, a neck flaring into the crossbar, and the sticker on its face.
  const head = [
    painted(alongX(-0.69, -0.76, 0.019, 0.022, 12), 0x3df03a),
    painted(new THREE.BoxGeometry(0.05, 0.06, 0.04).translate(-0.775, 0, 0), 0x3df03a),
    painted(new THREE.BoxGeometry(0.045, 0.3, 0.046).translate(-0.82, 0, 0), 0x46f53f),
    painted(new THREE.BoxGeometry(0.012, 0.3, 0.05).translate(-0.84, 0, 0), 0x32d82f),
    painted(new THREE.BoxGeometry(0.026, 0.05, 0.002).translate(-0.818, -0.075, 0.0235), 0xf2f2ec),
  ];
  group.add(new THREE.Mesh(mergeGeometries(head), plastic(0.45)));
  // The bristles: rows of strands, green in the middle rows and pink outside, each bending outward at
  // its tip so the brush splays wider than the bar and splits into tufts.
  const bristles: THREE.BufferGeometry[] = [];
  const pinks = [0xd8306f, 0xc42460, 0xe2457f], greens = [0x4fb83a, 0x3d9f2c, 0x67c94a];
  const strand = (x: number, y: number, z: number, yaw: number, pitch: number, length: number, color: number) =>
    painted(new THREE.BoxGeometry(length, 0.0036, 0.0036).translate(-length / 2, 0, 0).rotateY(pitch).rotateZ(-yaw).translate(x, y, z), color);
  for (let row = 0; row < 4; row++) {
    const z = (row - 1.5) * 0.011;
    for (let i = 0; i < 48; i++) {
      const across = (i + random() * 0.6) / 47.6 * 2 - 1, y = across * 0.142;
      // Fan out toward the ends of the bar, and out of the bar's plane a little (the outer rows more).
      const yaw = across * 0.38 + (random() - 0.5) * 0.12, pitch = (row - 1.5) * 0.14 + (random() - 0.5) * 0.14;
      const base = 0.07 + random() * 0.03, tip = 0.05 + random() * 0.04;
      const color = (row === 1 || row === 2) && Math.abs(across) < 0.85 && random() < 0.8 ? greens[i % 3] : pinks[i % 3];
      bristles.push(strand(-0.845, y, z, yaw, pitch, base, color));
      // 開叉: past the bend the tip kinks further out, to one side or the other.
      const ex = -0.845 - Math.cos(yaw) * Math.cos(pitch) * base, ey = y + Math.cos(pitch) * Math.sin(yaw) * base, ez = z + Math.sin(pitch) * base;
      const split = (random() < 0.5 ? -1 : 1) * (0.25 + random() * 0.45) + across * 0.3;
      bristles.push(strand(ex, ey, ez, yaw + split, pitch + (random() - 0.5) * 0.5, tip, color));
    }
  }
  group.add(new THREE.Mesh(mergeGeometries(bristles), plastic(0.6)));
  // Choked up: the hand holds it a third of the way up the handle (the model's origin), the butt behind.
  group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.position.x = BROOM_CHOKE; m.castShadow = true; m.receiveShadow = true; } });
  return group;
}

/** A tapioca pearl's look: dark brown, glossy. */
export const pearlMaterial = () => new THREE.MeshStandardMaterial({ color: 0x24140b, roughness: 0.25, metalness: 0.05 });

/** The 珍奶 cup: a clear cup of milk tea with pearls at the bottom, a sealed lid and a fat straw (about the M18's size). */
export function bobaCupModel(scale = 1) {
  const group = new THREE.Group();
  const h = 0.15, top = 0.042, bottom = 0.033;
  const tea = new THREE.Mesh(new THREE.CylinderGeometry(top * 0.94, bottom * 0.94, h * 0.86, 16), mat(0xa8713f, 0.55));
  tea.position.y = -h * 0.06;
  group.add(tea);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, h, 16, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  group.add(cup);
  const pearls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0085, 8, 6), pearlMaterial(), 18);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 18; i++) {
    const a = i * 2.39996, r = (i % 6) / 6 * bottom * 0.75 + 0.006, layer = Math.floor(i / 7);
    m.makeTranslation(Math.cos(a) * r, -h / 2 + 0.011 + layer * 0.014, Math.sin(a) * r);
    pearls.setMatrixAt(i, m);
  }
  group.add(pearls);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(top * 1.04, top * 1.04, 0.006, 16), mat(0xf6f1e6, 0.4));
  lid.position.y = h / 2;
  group.add(lid);
  const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, h * 1.3, 10), mat(0xff4f86, 0.45));
  straw.position.set(0.01, h * 0.52, 0);
  straw.rotation.z = -0.18;
  group.add(straw);
  group.scale.setScalar(scale);
  group.traverse(o => { const mm = o as THREE.Mesh; if (mm.isMesh) mm.castShadow = true; });
  return group;
}
