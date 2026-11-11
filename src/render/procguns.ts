import * as THREE from 'three';

/**
 * Parts the CC0 gun models lack, built in code in their model space (barrel along -X, up +Y, origin
 * at the grip) and added to the shared models, so the view model, soldiers and buy menu all show the
 * same weapon: the folded bipods of the M249 and M110, the M4A1's vertical grip and the M1014's
 * shell carrier.
 */
export function addProceduralGuns(weapons: Map<string, THREE.Object3D>) {
  const grip = weapons.get('Acc_Grip');
  const m249 = weapons.get('Gun_M249');
  if (m249) bipod(m249, -0.62, 0.095, 0.14);
  const m110 = weapons.get('Gun_M110');
  if (m110) bipod(m110, -0.58, 0.043, 0.18);
  const m4 = weapons.get('Gun_M4A1');
  if (m4 && grip) { const g = grip.clone(); g.scale.setScalar(0.9); g.position.set(-0.38, 0.045, 0); m4.add(g); }
  const m1014 = weapons.get('Gun_M1014');
  if (m1014) shellCarrier(m1014);
}

const mat = (color: number, roughness = 0.6, metalness = 0.35) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
/** Cylinder lying along the barrel axis (X). */
const tube = (r: number, len: number, sides = 10) => new THREE.CylinderGeometry(r, r, len, sides).rotateZ(Math.PI / 2);

function part(group: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z = 0, rotZ = 0) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.rotation.z = rotZ;
  mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/** Folded bipod: a clamp under the handguard at (x, y) with both legs swung forward along the barrel. */
function bipod(gun: THREE.Object3D, x: number, y: number, leg: number) {
  const steel = mat(0x1d1f22, 0.5, 0.6), rubber = mat(0x0d0d0e, 0.9, 0);
  part(gun, box(0.04, 0.022, 0.04), steel, x, y - 0.011);
  part(gun, tube(0.006, 0.03, 8), steel, x - 0.01, y - 0.026);
  for (const z of [-0.011, 0.011]) {
    part(gun, box(leg, 0.011, 0.009), steel, x - 0.02 - leg / 2, y - 0.03, z);
    part(gun, box(0.018, 0.016, 0.014), rubber, x - 0.02 - leg, y - 0.03, z);
  }
}

/** M1014: six-shell side saddle on the left of the receiver. */
function shellCarrier(gun: THREE.Object3D) {
  const plate = mat(0x1f2124, 0.6, 0.4), hull = mat(0x9c2a22, 0.6, 0.05), brass = mat(0xb48c40, 0.35, 0.85);
  part(gun, box(0.12, 0.04, 0.005), plate, -0.195, 0.045, 0.017);
  for (let i = 0; i < 6; i++) {
    const x = -0.245 + i * 0.02;
    part(gun, new THREE.CylinderGeometry(0.0075, 0.0075, 0.046, 8), hull, x, 0.045, 0.026);
    part(gun, new THREE.CylinderGeometry(0.0078, 0.0078, 0.01, 8), brass, x, 0.022, 0.026);
  }
}
