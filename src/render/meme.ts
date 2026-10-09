import * as THREE from 'three';

/**
 * The National Day reskins' models, built in code (src/game/memeskins.ts): the 藍白拖 that stands in for
 * the knife (in the knife's model space: toe along -X, held by the heel at the origin, the sole's flat
 * face across Z so a swing lands flat) and the 珍奶 cup that stands in for the M18 (upright, centred).
 */

const BLUE = 0x2f6fe0, WHITE = 0xe4e8e4;
const mat = (color: number, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

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
function treads(group: THREE.Group) {
  const groove = new THREE.BoxGeometry(0.006, 0.07, 0.003);
  const m = mat(0x2458c0, 0.9);
  for (let x = 0.03; x > -0.22; x -= 0.03) {
    const bar = new THREE.Mesh(groove, m);
    bar.position.set(x, 0, -0.0105);
    bar.scale.y = x < -0.1 ? 1.2 : 0.95;
    group.add(bar);
  }
}

/** The 藍白拖: a white footbed on a blue outsole, one wide blue strap over the forefoot. */
export function slipperModel() {
  const group = new THREE.Group();
  group.name = 'Gun_Knife';
  group.add(new THREE.Mesh(slab(0.014, 0), mat(WHITE, 0.7)));
  group.add(new THREE.Mesh(slab(0.006, -0.008), mat(BLUE, 0.85)));
  treads(group);
  // The strap: an arch across the sole (in y–z), extruded along the slipper's length.
  const arch = new THREE.Shape();
  arch.absellipse(0, 0, 0.056, 0.034, 0, Math.PI, false);
  arch.lineTo(-0.048, 0);
  arch.absellipse(0, 0, 0.048, 0.027, Math.PI, 0, true);
  arch.lineTo(0.056, 0);
  const strap = new THREE.ExtrudeGeometry(arch, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.002, bevelSegments: 2, curveSegments: 16 });
  // Shape (x, y, extrusion) → slipper (y across, z up from the footbed, x along the length).
  strap.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  const band = new THREE.Mesh(strap, mat(BLUE, 0.6));
  band.position.set(-0.19, 0, 0.015);
  group.add(band);
  // The strap's moulded ridges catch the light like the real thing.
  for (const x of [-0.17, -0.15, -0.13]) {
    const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.0028, 6, 20, Math.PI), mat(0x4a86f0, 0.5));
    ridge.rotation.y = Math.PI / 2;
    ridge.scale.set(0.66, 1.02, 1);
    ridge.position.set(x, 0, 0.016);
    group.add(ridge);
  }
  group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
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
