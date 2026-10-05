import * as THREE from 'three';

/**
 * Parts the CC0 gun pack lacks, built in code in the imported guns' model space (barrel along -X,
 * up +Y, origin at the grip) and added to the shared models before they are refinished, so the view
 * model, soldiers and buy menu all show the same weapon: the M249's stock, ammo box and folded
 * bipod, the M110's folded bipod, the M4A1's vertical grip and the M1014's shell carrier.
 */
export function addProceduralGuns(weapons: Map<string, THREE.Object3D>) {
  const grip = weapons.get('Acc_Grip');
  const m249 = weapons.get('Gun_M249');
  if (m249) saw(m249);
  const m110 = weapons.get('Gun_M110');
  // The M110 (SniperRifle_2) has its own muzzle brake; the bipod clamps under the fore-end tip.
  if (m110) bipod(m110, -0.47, 0.012, 0.18);
  const m4 = weapons.get('Gun_M4A1');
  if (m4 && grip) { const g = grip.clone(); g.scale.setScalar(0.9); g.position.set(-0.33, 0.05, 0); m4.add(g); }
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

/** Side profile (x, y) extruded to `depth` across the gun, centred. */
function profile(points: [number, number][], depth: number) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 }).translate(0, 0, -depth / 2);
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

/** M249 SAW: skeleton stock, 200-round soft ammo box on the left with a belt into the feed tray, heavy barrel, bipod. */
function saw(gun: THREE.Object3D) {
  const body = mat(0x3c4236, 0.55, 0.4), dark = mat(0x1c1e1a, 0.7, 0.3), pouch = mat(0x535a40, 0.95, 0), brass = mat(0xb08a3e, 0.35, 0.85);
  part(gun, profile([[0.07, 0.212], [0.35, 0.178], [0.372, 0.18], [0.372, 0.02], [0.345, 0.02], [0.2, 0.1], [0.07, 0.112]], 0.04), body, 0, 0);
  part(gun, box(0.016, 0.16, 0.05), dark, 0.372, 0.1);
  // Ammo box: soft pouch with a flap and strap, hanging under the receiver on the left side.
  part(gun, box(0.14, 0.15, 0.1), pouch, -0.23, -0.05, 0.045);
  part(gun, box(0.142, 0.03, 0.102), mat(0x474d37, 0.95, 0), -0.23, 0.012, 0.045);
  part(gun, box(0.02, 0.152, 0.104), mat(0x2d3124, 0.9, 0), -0.23, -0.05, 0.045);
  for (let i = 0; i < 5; i++) part(gun, box(0.008, 0.016, 0.03), brass, -0.27 + i * 0.012, 0.06 + i * 0.012, 0.03, 0.4);
  // Feed cover ribs and the heavy barrel's flash hider.
  for (let i = 0; i < 4; i++) part(gun, box(0.012, 0.006, 0.052), dark, -0.04 + i * 0.03, 0.222);
  part(gun, tube(0.016, 0.05, 8), dark, -1.0, 0.18);
  part(gun, tube(0.011, 0.34, 10), body, -0.8, 0.18);
  bipod(gun, -0.6, 0.127, 0.24);
}

/** M1014: six-shell side saddle on the left of the receiver. */
function shellCarrier(gun: THREE.Object3D) {
  const plate = mat(0x1f2124, 0.6, 0.4), hull = mat(0x9c2a22, 0.6, 0.05), brass = mat(0xb48c40, 0.35, 0.85);
  part(gun, box(0.12, 0.04, 0.006), plate, -0.15, 0.035, 0.03);
  for (let i = 0; i < 6; i++) {
    const x = -0.2 + i * 0.02;
    part(gun, new THREE.CylinderGeometry(0.0075, 0.0075, 0.046, 8), hull, x, 0.035, 0.038);
    part(gun, new THREE.CylinderGeometry(0.0078, 0.0078, 0.01, 8), brass, x, 0.012, 0.038);
  }
}
