import * as THREE from 'three';

/**
 * Weapons the CC0 packs do not include, built in code in the same model space as the imported
 * guns: barrel along -X, up +Y, origin near the trigger. Registered next to the GLB models so the
 * view model and third-person soldiers treat them identically.
 */
export function addProceduralGuns(weapons: Map<string, THREE.Object3D>) {
  weapons.set('Gun_Scatter', scattergun());
  weapons.set('Gun_Stinger', stinger(weapons));
  weapons.set('Gun_Graviton', graviton());
}

const mat = (color: number, roughness = 0.6, metalness = 0.35, emissive = 0, glow = 1.2) => new THREE.MeshStandardMaterial({
  color, roughness, metalness, flatShading: true, emissive, emissiveIntensity: emissive ? glow : 0,
});
const METAL = mat(0x2a2e35, 0.45, 0.6);
const POLYMER = mat(0x4b515e, 0.85, 0.05);
const LIGHT = mat(0xb9bec6, 0.6, 0.2);

function part(group: THREE.Group, geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z = 0, rotZ = 0) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.rotation.z = rotZ;
  mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
/** Cylinder lying along the barrel axis (X). */
const tube = (r: number, len: number, sides = 10) => new THREE.CylinderGeometry(r, r, len, sides).rotateZ(Math.PI / 2);
/** Ring facing down the barrel. */
const ring = (r: number, t: number) => new THREE.TorusGeometry(r, t, 6, 18).rotateY(Math.PI / 2);

/** S-8 Breacher: pump scattergun with a ghost-ring sight and a glowing front bead. */
function scattergun() {
  const g = new THREE.Group();
  g.name = 'Gun_Scatter';
  const accent = mat(0xd8762a, 0.7, 0.1);
  part(g, box(0.34, 0.11, 0.07), LIGHT, 0.03, 0.06);
  part(g, box(0.58, 0.014, 0.028), METAL, -0.25, 0.127);
  part(g, tube(0.026, 0.56), METAL, -0.42, 0.095);
  part(g, tube(0.021, 0.44), METAL, -0.36, 0.044);
  part(g, box(0.2, 0.068, 0.082), accent, -0.4, 0.046);
  part(g, box(0.06, 0.07, 0.07), METAL, -0.71, 0.095);
  part(g, box(0.012, 0.026, 0.012), mat(0xffb35a, 0.4, 0, 0xff8a2a), -0.7, 0.14);
  part(g, ring(0.022, 0.0055), METAL, 0.12, 0.152);
  part(g, box(0.02, 0.03, 0.016), METAL, 0.12, 0.122);
  part(g, box(0.055, 0.13, 0.045), POLYMER, 0.09, -0.04, 0, 0.3);
  part(g, box(0.24, 0.085, 0.05), POLYMER, 0.32, 0.03, 0, -0.08);
  part(g, box(0.025, 0.11, 0.056), METAL, 0.445, 0.02);
  return g;
}

/** K-9 Stinger: the sidearm frame converted to full auto, with an extended magazine and compensator. */
function stinger(weapons: Map<string, THREE.Object3D>) {
  const g = new THREE.Group();
  g.name = 'Gun_Stinger';
  const pistol = weapons.get('Gun_Pistol')!.clone();
  pistol.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.material = (m.material as THREE.MeshStandardMaterial).clone(); (m.material as THREE.MeshStandardMaterial).color.set(0xa9c4ff); }
  });
  g.add(pistol);
  const mag = weapons.get('Gun_SMG_Ammo')!.clone();
  mag.position.set(0.035, -0.13, 0); mag.rotation.z = 0.18; mag.scale.setScalar(0.85);
  g.add(mag);
  const glow = mat(0x6ff0e8, 0.4, 0, 0x2fd8d0);
  part(g, box(0.07, 0.045, 0.042), METAL, -0.405, 0.105);
  part(g, box(0.05, 0.006, 0.044), glow, -0.405, 0.084);
  part(g, box(0.14, 0.008, 0.036), glow, -0.2, 0.06);
  return g;
}

/** G-0 Graviton: launcher whose violet coils fling charges that fall with the current laws. */
function graviton() {
  const g = new THREE.Group();
  g.name = 'Gun_Graviton';
  const glow = mat(0x6a4fb0, 0.3, 0, 0x7a4cff, 0.7);
  part(g, box(0.42, 0.13, 0.1), METAL, 0.02, 0.05);
  part(g, tube(0.055, 0.5, 12), POLYMER, -0.42, 0.075);
  part(g, tube(0.04, 0.012, 12), glow, -0.672, 0.075);
  for (const x of [-0.3, -0.42, -0.54]) part(g, ring(0.066, 0.011), glow, x, 0.075);
  // Charge cell glowing through a window in the receiver's side.
  part(g, new THREE.SphereGeometry(0.034, 12, 8), glow, 0.06, 0.05, 0.035);
  part(g, ring(0.03, 0.005), METAL, -0.02, 0.205);
  part(g, box(0.03, 0.05, 0.02), METAL, -0.02, 0.15);
  part(g, box(0.055, 0.13, 0.045), POLYMER, 0.1, -0.05, 0, 0.3);
  part(g, box(0.04, 0.1, 0.04), POLYMER, -0.25, -0.04);
  part(g, box(0.2, 0.1, 0.06), LIGHT, 0.32, 0.05);
  return g;
}
