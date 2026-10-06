import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../assets';
import { dirFromAngles, wrapAngle } from '../../shared/math';
import { riderTwist } from '../../shared/vehicles';
import { curlFingers, orientHand, restorePose, rotateWorld, snapshotPose, solveArm } from './rig';
import { ATTACHMENT_SLOTS, WEAPONS, type Attachments, type WeaponId } from '../../shared/weapons';
import { GUN_FIT, fitAttachments, vec, type Fitted } from './optics';

/**
 * BeGone's two sides, painted onto the shared CC0 character: SWAT (team 0) in dark navy tactical
 * gear (ballistic helmet, goggles, balaclava, plate carrier, knee pads); Militia (team 1) as
 * irregulars in mixed tan and olive (shemagh, chest rig, bare face and hands), varied per soldier.
 * Body colours are baked per region (head, shirt, gloves, trousers, boots) as vertex colours; gear
 * is one rigid-skinned mesh with four materials.
 */
interface Look { head: number; shirt: number; hands: number; pants: number; boots: number; gear: number; pouch: number; accent: number; patch: number }
const SWAT: Look = { head: 0x1b1e25, shirt: 0x2c3b58, hands: 0x16171a, pants: 0x283550, boots: 0x111214, gear: 0x24324e, pouch: 0x1b2029, accent: 0x0b0e13, patch: 0xb8c6dc };
const MILITIA: Look[] = [
  { head: 0x9a7457, shirt: 0x5d6240, hands: 0x8d6a4f, pants: 0x9b8762, boots: 0x3b3027, gear: 0x55593b, pouch: 0x4a4330, accent: 0xa5927a, patch: 0x55593b },
  { head: 0x7d5a42, shirt: 0xa48e66, hands: 0x7a573f, pants: 0x55583c, boots: 0x2d2a24, gear: 0x6e6447, pouch: 0x3f3c2c, accent: 0x8e3b33, patch: 0x6e6447 },
  { head: 0xa27e60, shirt: 0x7d7356, hands: 0x96714f, pants: 0x6e6447, boots: 0x463728, gear: 0x4c5034, pouch: 0x5a4d36, accent: 0x4d5236, patch: 0x4c5034 },
];
const lookOf = (team: number, variant: number) => team === 0 ? SWAT : MILITIA[variant % MILITIA.length];

/** Body region by bone name (vertex colours are blended by skin weight across seams). */
function region(bone: string): keyof Look {
  if (/^(Head|neck)/.test(bone)) return 'head';
  if (/^(hand|index|middle|ring|pinky|thumb)_/.test(bone)) return 'hands';
  if (/^(foot|ball)_/.test(bone)) return 'boots';
  if (/^(thigh|calf|pelvis)/.test(bone)) return 'pants';
  return 'shirt';
}

const bodies = new Map<string, THREE.BufferGeometry>();
/** The character's geometry with the look's colours baked in (cached per team and variant). */
function paintedBody(body: THREE.SkinnedMesh, look: Look) {
  const key = JSON.stringify(look);
  let geo = bodies.get(key);
  if (geo) return geo;
  geo = body.geometry.clone();
  const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
  const colors = body.skeleton.bones.map(b => new THREE.Color(look[region(b.name)]));
  const out = new Float32Array(si.count * 3), c = new THREE.Color();
  for (let v = 0; v < si.count; v++) {
    c.setRGB(0, 0, 0);
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(v, k); if (w > 0) { const bc = colors[si.getComponent(v, k)]; c.r += bc.r * w; c.g += bc.g * w; c.b += bc.b * w; } }
    out[v * 3] = c.r; out[v * 3 + 1] = c.g; out[v * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
  bodies.set(key, geo);
  return geo;
}

const bodyOf = (root: THREE.Object3D) => {
  let body!: THREE.SkinnedMesh;
  root.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && (!body || m.geometry.getAttribute('position').count > body.geometry.getAttribute('position').count)) body = m; });
  return body;
};

interface GearKit { geometry: THREE.BufferGeometry; bindMatrix: THREE.Matrix4 }
const kits = new Map<number, GearKit>();

/**
 * Build a team's gear as ONE rigid-skinned geometry bound to the character skeleton: every piece
 * follows its bone exactly and a whole soldier's gear costs four draw calls.
 * Groups: 0 gear (vest / chest rig, helmet), 1 pouches, straps, pads and boots, 2 accent (goggle
 * lens / shemagh), 3 ID patches.
 */
function buildGear(assets: Assets, team: number): GearKit {
  const scene = assets.soldier.scene;
  scene.updateMatrixWorld(true);
  const body = bodyOf(scene);
  const bones = body.skeleton.bones;
  const index = (name: string) => bones.findIndex(b => b.name === name);
  const at = (name: string) => bones[index(name)].getWorldPosition(new THREE.Vector3());
  const toLocal = new THREE.Matrix4().copy(body.matrixWorld).invert();
  const pieces: THREE.BufferGeometry[] = [];
  // Character faces +Z in bind space; right side is -X.
  const add = (bone: string, geo: THREE.BufferGeometry, pos: THREE.Vector3, rot: THREE.Euler, group: 0 | 1 | 2 | 3) => {
    geo = geo.index ? geo.toNonIndexed() : geo;
    geo.applyMatrix4(new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(rot), new THREE.Vector3(1, 1, 1)));
    geo.applyMatrix4(toLocal);
    const n = geo.getAttribute('position').count;
    const bi = index(bone);
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).map((_, i) => (i % 4 === 0 ? bi : 0)), 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(k)) geo.deleteAttribute(k);
    geo.userData.group = group;
    pieces.push(geo);
  };
  const rb = (w: number, h: number, d: number, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
  const E = (x = 0, y = 0, z = 0) => new THREE.Euler(x, y, z);
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const head = at('Head'), neck = at('neck_01'), s3 = at('spine_03'), s2 = at('spine_02'), pelvis = at('pelvis');
  const dome = (sx: number, sy: number, sz: number, cut = 0.56) => { const g = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI * cut); g.scale(sx, sy, sz); return g; };
  if (team === 0) {
    // ---- SWAT: ballistic helmet with rails and NVG shroud, goggles, plate carrier, pads ----
    add('Head', dome(0.135, 0.145, 0.152), head.clone().add(V(0, 0.105, -0.008)), E(-0.12), 0);
    add('Head', new THREE.TorusGeometry(0.137, 0.008, 6, 32).rotateX(Math.PI / 2).scale(1, 1, 1.1), head.clone().add(V(0, 0.1, -0.006)), E(-0.12), 0);
    for (const s of [-1, 1]) add('Head', rb(0.016, 0.03, 0.09, 0.006), head.clone().add(V(s * 0.136, 0.115, -0.005)), E(-0.12), 1);
    add('Head', rb(0.045, 0.03, 0.02, 0.006), head.clone().add(V(0, 0.2, 0.138)), E(0.5), 1);
    add('Head', rb(0.06, 0.06, 0.05, 0.015), head.clone().add(V(0, 0.15, -0.14)), E(0.3), 1);
    add('Head', new THREE.TorusGeometry(0.128, 0.009, 6, 32, Math.PI * 1.25).rotateX(Math.PI / 2).rotateY(Math.PI * 0.62 - Math.PI), head.clone().add(V(0, 0.085, 0)), E(), 1);
    for (const s of [-1, 1]) {
      const lens = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateX(Math.PI / 2); lens.scale(0.034, 0.026, 0.02);
      add('Head', lens, head.clone().add(V(s * 0.044, 0.095, 0.118)), E(0, s * 0.25, 0), 2);
      add('Head', rb(0.075, 0.042, 0.02, 0.012), head.clone().add(V(s * 0.044, 0.095, 0.112)), E(0, s * 0.25, 0), 1);
    }
    // Plate carrier: front and back plates, cummerbund, shoulder pads, magazine pouches, radio, ID patches.
    add('spine_03', rb(0.34, 0.3, 0.075, 0.03), s3.clone().add(V(0, 0.02, 0.1)), E(-0.08), 0);
    add('spine_03', rb(0.34, 0.32, 0.07, 0.03), s3.clone().add(V(0, 0.02, -0.115)), E(0.06), 0);
    for (const s of [-1, 1]) add('spine_03', rb(0.06, 0.24, 0.2, 0.02), s3.clone().add(V(s * 0.165, -0.02, 0)), E(), 0);
    for (const s of [-1, 1]) add('spine_03', rb(0.09, 0.03, 0.26, 0.012), s3.clone().add(V(s * 0.1, 0.19, 0)), E(0, 0, s * -0.15), 0);
    for (let i = 0; i < 3; i++) add('spine_02', rb(0.075, 0.12, 0.05, 0.012), s2.clone().add(V((i - 1) * 0.085, 0.02, 0.135)), E(-0.05), 1);
    add('spine_03', rb(0.07, 0.14, 0.05, 0.012), s3.clone().add(V(0.09, 0.03, -0.17)), E(0.06), 1);
    add('spine_03', cyl(0.006, 0.18), s3.clone().add(V(0.12, 0.17, -0.17)), E(0.1), 1);
    add('spine_03', rb(0.2, 0.06, 0.008, 0.004), s3.clone().add(V(0, 0.07, -0.152)), E(0.06), 3);
    add('spine_03', rb(0.12, 0.04, 0.008, 0.004), s3.clone().add(V(0, 0.12, 0.14)), E(-0.08), 3);
    add('pelvis', rb(0.38, 0.06, 0.27, 0.025), pelvis.clone().add(V(0, 0.07, 0)), E(), 1);
  } else {
    // ---- Militia: shemagh head wrap and scarf, chest rig with rifle pouches, bandolier strap ----
    // Wrapped cloth: a low crown under three loose, tilted turns, the knot and a tail hanging at the back.
    add('Head', dome(0.132, 0.11, 0.142, 0.5), head.clone().add(V(0, 0.125, -0.012)), E(-0.2), 2);
    for (const [y, tilt, r] of [[0.097, 0.18, 0.128], [0.112, -0.12, 0.13], [0.14, 0.3, 0.12]]) {
      add('Head', new THREE.TorusGeometry(r, 0.02, 6, 24).rotateX(Math.PI / 2).scale(1, 1, 1.12), head.clone().add(V(0, y, -0.012)), E(-0.2 + tilt * 0.4, 0, tilt * 0.3), 2);
    }
    add('Head', new THREE.SphereGeometry(0.04, 10, 8), head.clone().add(V(0.02, 0.1, -0.15)), E(), 2);
    add('Head', rb(0.08, 0.17, 0.025, 0.01), head.clone().add(V(0.02, 0.0, -0.15)), E(0.25, 0, 0.1), 2);
    add('neck_01', new THREE.TorusGeometry(0.085, 0.035, 8, 24).rotateX(Math.PI / 2), neck.clone().add(V(0, 0.01, 0.005)), E(0.25), 2);
    add('neck_01', rb(0.13, 0.09, 0.04, 0.02), neck.clone().add(V(0, -0.04, 0.1)), E(-0.4), 2);
    add('spine_02', rb(0.32, 0.17, 0.07, 0.025), s2.clone().add(V(0, 0.04, 0.12)), E(-0.04), 0);
    for (let i = 0; i < 3; i++) add('spine_02', rb(0.08, 0.15, 0.045, 0.014), s2.clone().add(V((i - 1) * 0.092, 0.035, 0.17)), E(-0.04), 1);
    for (const s of [-1, 1]) add('spine_03', rb(0.035, 0.42, 0.012, 0.005), s3.clone().add(V(s * 0.06, 0.02, -0.13)), E(0.05, 0, s * 0.55), 1);
    for (const s of [-1, 1]) add('spine_03', rb(0.04, 0.012, 0.26, 0.005), s3.clone().add(V(s * 0.1, 0.205, 0)), E(), 1);
    add('spine_03', rb(0.05, 0.5, 0.014, 0.006), s3.clone().add(V(0, 0.0, 0.135)), E(-0.1, 0, 0.75), 1);
    add('pelvis', rb(0.37, 0.045, 0.26, 0.02), pelvis.clone().add(V(0, 0.08, 0)), E(), 1);
    add('pelvis', rb(0.12, 0.11, 0.07, 0.025), pelvis.clone().add(V(0.17, 0.0, -0.06)), E(0, 0.6, 0), 0);
  }
  for (const side of ['l', 'r'] as const) {
    const sign = side === 'l' ? 1 : -1;
    const elbow = at(`lowerarm_${side}`), hand = at(`hand_${side}`), thigh = at(`thigh_${side}`), knee = at(`calf_${side}`), foot = at(`foot_${side}`), ball = at(`ball_${side}`);
    add(`foot_${side}`, rb(0.12, 0.1, 0.26, 0.035), foot.clone().lerp(ball, 0.45).add(V(0, -0.05, 0)), E(), 1);
    add(`calf_${side}`, rb(0.12, 0.07, 0.11, 0.03), foot.clone().add(V(0, 0.03, -0.01)), E(), 1);
    if (team === 0) {
      add(`calf_${side}`, rb(0.12, 0.12, 0.06, 0.03), knee.clone().add(V(0, -0.01, 0.07)), E(), 1);
      add(`lowerarm_${side}`, rb(0.1, 0.08, 0.1, 0.03), elbow.clone().add(V(0, 0.0, -0.03)), E(), 1);
      add(`hand_${side}`, rb(0.1, 0.04, 0.09, 0.015), hand.clone().add(V(sign * 0.05, 0.0, 0.0)), E(), 1);
      if (side === 'r') add(`thigh_${side}`, rb(0.06, 0.16, 0.11, 0.02), thigh.clone().lerp(knee, 0.35).add(V(sign * 0.1, 0, 0.0)), E(), 1);
    } else if (side === 'l') add(`thigh_${side}`, rb(0.05, 0.12, 0.13, 0.02), thigh.clone().lerp(knee, 0.45).add(V(sign * 0.095, 0, 0)), E(), 1);
  }
  // Order pieces by material so the merged geometry needs only four groups.
  const sorted = pieces.map((g, i) => ({ g, i })).sort((a, b) => a.g.userData.group - b.g.userData.group);
  const geometry = mergeGeometries(sorted.map(s => s.g), false)!;
  geometry.clearGroups();
  let start = 0;
  for (const group of [0, 1, 2, 3]) {
    const count = sorted.filter(s => s.g.userData.group === group).reduce((n, s) => n + s.g.getAttribute('position').count, 0);
    geometry.addGroup(start, count, group);
    start += count;
  }
  geometry.computeBoundingSphere();
  return { geometry, bindMatrix: body.bindMatrix.clone() };
}
const cyl = (r: number, h: number) => new THREE.CylinderGeometry(r, r, h, 6);
const gearOf = (assets: Assets, team: number) => { let k = kits.get(team); if (!k) kits.set(team, k = buildGear(assets, team)); return k; };

function gearMaterials(look: Look, team: number) {
  return [
    new THREE.MeshStandardMaterial({ color: look.gear, roughness: team === 0 ? 0.62 : 0.9, metalness: team === 0 ? 0.2 : 0 }),
    new THREE.MeshStandardMaterial({ color: look.pouch, roughness: 0.85, metalness: 0.05 }),
    team === 0 ? new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.12, metalness: 0.85, emissive: 0x0a1626 }) : new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.95, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: look.patch, roughness: 0.7, metalness: 0 }),
  ];
}
const bodyMaterial = (original: THREE.MeshStandardMaterial) =>
  new THREE.MeshStandardMaterial({ vertexColors: true, normalMap: original.normalMap, roughness: 0.84, metalness: 0.04, normalScale: new THREE.Vector2(1.2, 1.2) });

/** Soldiers are varied by a running counter: Militia mix their shirts, trousers and scarves. */
let spawned = 0;

export interface SoldierPose {
  x: number; y: number; z: number; vx: number; vz: number; vy: number;
  yaw: number; pitch: number; crouch: number; grounded: boolean; sprint: boolean; ads: boolean;
  slide: boolean; alive: boolean; weapon: WeaponId; reloading: number; firing: boolean;
  /** Fitted attachments of the held weapon. */
  attachments?: Attachments;
  /** Holding E on a bomb site (arming/defusing): kneels with both hands on the device. */
  using?: boolean;
  /** Riding a scooter: the hips and legs face the bike's heading (yaw) while the torso turns to the aim. */
  hips?: number;
}

type ClipName = 'idle' | 'walk' | 'jog' | 'sprint' | 'crouchIdle' | 'crouchWalk' | 'air' | 'slide' | 'death';
const CLIPS: Record<ClipName, string> = {
  idle: 'Idle_Loop', walk: 'Walk_Loop', jog: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop', crouchIdle: 'Crouch_Idle_Loop',
  crouchWalk: 'Crouch_Fwd_Loop', air: 'Jump_Loop', slide: 'Slide_Loop', death: 'Death01',
};
/** Ground speed (m/s) at which each locomotion clip plays at 1x. */
const CLIP_SPEED: Partial<Record<ClipName, number>> = { walk: 1.6, jog: 4.4, sprint: 7.2, crouchWalk: 1.8 };

/** Frames between full animation updates per level of detail (see SoldierView.setLod). */
const LOD_INTERVAL = [1, 2, 4, 8] as const;

const up = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const attachKey = (a: Attachments = {}) => ATTACHMENT_SLOTS.map(c => a[c] ?? '').join('|');

/** A fully animated third-person soldier (remote players and bots). */
export class SoldierView {
  readonly root = new THREE.Group();
  readonly gun = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<ClipName, THREE.AnimationAction>();
  private weights = new Map<ClipName, number>();
  private bones = new Map<string, THREE.Bone>();
  private guns = new Map<WeaponId, THREE.Object3D>();
  private fitted = new Map<string, Fitted>();
  private fit?: Fitted;
  private shown = '';
  private currentGun?: WeaponId;
  private muzzle = new THREE.Object3D();
  private wasAlive = true;
  private flinch = 0;
  private flinchDir = 1;
  private legYaw = 0;
  private recoil = 0;
  private stab = 0;
  private suppressed = false;
  readonly flash: THREE.Mesh;
  flashLeft = 0;
  private bindPose: Map<string, THREE.Quaternion>;
  /** Dev inspection of IK targets. */
  debug?: { chest: THREE.Vector3; grip: THREE.Vector3; fore: THREE.Vector3 };

  constructor(private assets: Assets, readonly team: number) {
    const kit = gearOf(assets, team);
    const look = lookOf(team, spawned++);
    this.model = SkeletonUtils.clone(assets.soldier.scene);
    const body = bodyOf(this.model);
    this.model.traverse(o => { if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone); });
    const original = body.material as THREE.MeshStandardMaterial;
    body.geometry = paintedBody(body, look);
    body.material = bodyMaterial(original);
    body.castShadow = true; body.receiveShadow = true; body.frustumCulled = false;
    const gear = new THREE.SkinnedMesh(kit.geometry, gearMaterials(look, team));
    gear.bind(body.skeleton, kit.bindMatrix);
    gear.castShadow = true; gear.frustumCulled = false;
    gear.position.copy(body.position); gear.quaternion.copy(body.quaternion); gear.scale.copy(body.scale);
    body.parent!.add(gear);
    this.bindPose = snapshotPose(this.bones);
    this.root.add(this.model);
    // The rig faces +Z; our yaw 0 faces -Z.
    this.model.rotation.y = Math.PI;

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [name, clipName] of Object.entries(CLIPS) as [ClipName, string][]) {
      const clip = assets.clips.get(clipName);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      if (name === 'death') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
      action.play(); action.setEffectiveWeight(0);
      this.actions.set(name, action); this.weights.set(name, 0);
    }
    this.gun.add(this.muzzle);
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.visible = false;
    this.muzzle.add(this.flash);
  }

  /** Show weapon `id` with `attachments` (models and fitted parts are built on first use). */
  private showGun(id: WeaponId, attachments?: Attachments) {
    const key = `${id}|${attachKey(attachments)}`;
    if (key === this.shown) return;
    this.shown = key;
    let gun = this.guns.get(id);
    if (!gun) {
      gun = this.assets.weapons.get(WEAPONS[id].model)!.clone();
      gun.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = this.lod === 0; });
      this.gun.add(gun);
      this.guns.set(id, gun);
    }
    for (const [gid, g] of this.guns) g.visible = gid === id;
    let fit = this.fitted.get(key);
    if (!fit) { fit = fitAttachments(this.assets.weapons, id, attachments, 'third'); this.fitted.set(key, fit); }
    this.fit?.group.removeFromParent();
    gun.add(fit.group);
    this.fit = fit;
    this.currentGun = id;
    this.muzzle.position.copy(fit.muzzle);
    this.suppressed = attachments?.muzzle === 'suppressor';
  }

  hit(fromLeft: boolean) { this.flinch = 1; this.flinchDir = fromLeft ? 1 : -1; }
  /** A shot (no flash when suppressed), or a knife stab. */
  shoot() {
    if (this.currentGun === 'knife') { this.stab = 1; return; }
    this.recoil = 1; this.flashLeft = this.suppressed ? 0 : 0.05; this.muzzle.rotation.z = Math.random() * 6;
  }

  muzzleWorld(out = new THREE.Vector3()) { return this.muzzle.getWorldPosition(out); }

  /**
   * Level of detail for crowded battles: 0 near (full rate, shadows), 1 mid (half-rate animation),
   * 2 far (quarter rate), 3 off-screen (hidden, not animated). Positions always update every frame.
   */
  setLod(level: 0 | 1 | 2 | 3) {
    if (level === this.lod) return;
    if ((level === 0) !== (this.lod === 0)) for (const m of [...this.meshesOf(this.model), ...this.meshesOf(this.gun)]) m.castShadow = level === 0;
    this.lod = level;
    this.root.visible = level < 3;
    if (level === 3) this.gun.visible = false;
  }
  private lod: 0 | 1 | 2 | 3 = 0;
  get onScreen() { return this.lod < 3; }
  private frame = 0;
  private pending = 0;
  /** Opaque meshes (beams, cones and flashes never cast shadows). */
  private meshesOf(o: THREE.Object3D) { const out: THREE.Mesh[] = []; o.traverse(c => { const m = c as THREE.Mesh; if (m.isMesh && !(m.material as THREE.Material).transparent) out.push(m); }); return out; }

  /**
   * The body's facing: the aim, or for a rider the bike's heading turned toward the aim by the
   * torso's twist (never round on the seat: the whole body used to follow a look behind).
   */
  private bodyYaw(p: SoldierPose) { return p.hips === undefined ? p.yaw : p.hips + riderTwist(p.yaw, p.hips); }

  update(dt: number, p: SoldierPose) {
    // Distant and hidden soldiers animate at a reduced rate; between updates they only move.
    const every = LOD_INTERVAL[this.lod];
    this.pending += dt;
    if (this.lod === 3 || (++this.frame % every !== 0 && p.alive === this.wasAlive)) {
      const dx = p.x - this.root.position.x, dy = p.y - this.root.position.y, dz = p.z - this.root.position.z;
      this.root.position.set(p.x, p.y, p.z);
      this.root.rotation.y = this.bodyYaw(p);
      this.gun.position.x += dx; this.gun.position.y += dy; this.gun.position.z += dz;
      if (this.lod === 3) this.pending = Math.min(this.pending, 0.25);
      return;
    }
    dt = this.pending; this.pending = 0;
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = this.bodyYaw(p);
    const using = !!p.using && p.alive;
    // ---- Locomotion blend ----
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const forward = -(p.vx * sin + p.vz * cos), strafe = p.vx * cos - p.vz * sin;
    const speed = Math.hypot(p.vx, p.vz);
    const target: Partial<Record<ClipName, number>> = {};
    if (!p.alive) target.death = 1;
    else if (using) target.crouchIdle = 1;
    else if (!p.grounded && Math.abs(p.vy) > 1.5) target.air = 1;
    else if (p.slide) target.slide = 1;
    else if (p.crouch > 0.5) { if (speed < 0.4) target.crouchIdle = 1; else target.crouchWalk = 1; }
    else if (speed < 0.3) target.idle = 1;
    else if (speed < 2.5) { const t = speed / 2.5; target.idle = 1 - t; target.walk = t; }
    else if (speed < 6.2) { const t = (speed - 2.5) / 3.7; target.walk = 1 - t; target.jog = t; }
    else { const t = Math.min(1, (speed - 6.2) / 2.2); target.jog = 1 - t; target.sprint = t; }
    if (p.alive !== this.wasAlive) {
      const death = this.actions.get('death')!;
      if (!p.alive) { death.reset(); death.play(); for (const k of this.weights.keys()) this.weights.set(k, 0); }
      this.wasAlive = p.alive;
    }
    // Moving backwards plays the cycle in reverse; legs twist toward strafe direction.
    const backwards = forward < -0.3;
    let moveAngle = speed > 0.5 ? Math.atan2(strafe, forward) : 0;
    if (backwards) moveAngle = Math.atan2(-strafe, -forward);
    const clampAngle = Math.max(-1.1, Math.min(1.1, moveAngle));
    // On a seat the hips and legs stay on the bike (exactly, every frame): the body turns toward the
    // aim only as far as the torso twists; the arms bring the weapon the rest of the way.
    if (p.hips !== undefined) this.legYaw = riderTwist(p.yaw, p.hips);
    else this.legYaw += (clampAngle * (p.sprint ? 0.3 : 1) - this.legYaw) * Math.min(1, dt * 10);
    for (const [name, action] of this.actions) {
      const w = this.weights.get(name)! + ((target[name] ?? 0) - this.weights.get(name)!) * Math.min(1, dt * (p.alive ? 12 : 30));
      this.weights.set(name, w);
      action.setEffectiveWeight(w);
      const natural = CLIP_SPEED[name];
      if (natural) action.timeScale = Math.max(0.4, Math.min(1.8, speed / natural)) * (backwards ? -1 : 1);
    }
    // Fingers are not animated by the clips; restore them before posing the grip.
    restorePose(this.bones, this.bindPose, n => /^(index|middle|ring|pinky|thumb)_/.test(n));
    this.mixer.update(dt);
    if (!p.alive) { this.gun.visible = false; return; }

    // ---- Procedural layer: leg twist, aim pitch, flinch ----
    const pelvis = this.bones.get('pelvis')!, spine1 = this.bones.get('spine_01')!, spine2 = this.bones.get('spine_02')!, spine3 = this.bones.get('spine_03')!;
    this.model.updateMatrixWorld(true);
    rotateWorld(pelvis, up, -this.legYaw);
    rotateWorld(spine1, up, this.legYaw * 0.6);
    rotateWorld(spine2, up, this.legYaw * 0.4);
    const right = v3.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const fit = GUN_FIT[p.weapon];
    const pistol = fit.kind !== 'long';
    if (using) {
      // Kneeling over the bomb: lean in, gun slung, both hands working on the device in front.
      rotateWorld(spine2, right, -0.35); rotateWorld(spine3, right, -0.25);
      rotateWorld(this.bones.get('neck_01')!, right, -0.2);
      this.model.updateMatrixWorld(true);
      const fwdFlat = v2.set(-sin, 0, -cos);
      const device = this.root.position.clone().addScaledVector(fwdFlat, 0.5).addScaledVector(up, 0.12 + Math.sin(performance.now() / 160) * 0.015);
      const pole = (s: number) => device.clone().addScaledVector(right, s * 0.6).addScaledVector(up, 0.4);
      solveArm(this.bones, 'r', device.clone().addScaledVector(right, 0.09), pole(1));
      solveArm(this.bones, 'l', device.clone().addScaledVector(right, -0.09), pole(-1));
      orientHand(this.bones, 'r', fwdFlat.clone().addScaledVector(up, -0.8).normalize(), up.clone().negate());
      orientHand(this.bones, 'l', fwdFlat.clone().addScaledVector(up, -0.8).normalize(), up.clone().negate());
      curlFingers(this.bones, 'r', 0.35, 0.3); curlFingers(this.bones, 'l', 0.35, 0.3);
      this.gun.visible = false;
      return;
    }
    const pitch = p.pitch;
    // Bladed shooting stance: torso turns so the support shoulder leads; head stays on target.
    const blade = p.sprint ? 0 : pistol ? -0.15 : -0.5;
    rotateWorld(spine2, up, blade * 0.5);
    rotateWorld(spine3, up, blade * 0.5);
    rotateWorld(this.bones.get('neck_01')!, up, -blade * 0.6);
    rotateWorld(this.bones.get('Head')!, up, -blade * 0.4);
    rotateWorld(spine2, right, pitch * 0.35);
    rotateWorld(spine3, right, pitch * 0.35);
    this.flinch = Math.max(0, this.flinch - dt * 5);
    if (this.flinch > 0) rotateWorld(spine3, up, this.flinch * 0.25 * this.flinchDir);
    rotateWorld(this.bones.get('neck_01')!, right, pitch * 0.3);

    // ---- Weapon placement ----
    this.showGun(p.weapon, p.attachments);
    this.gun.visible = true;
    const knife = fit.kind === 'knife';
    this.recoil = Math.max(0, this.recoil - dt * 12);
    this.stab = Math.max(0, this.stab - dt * 3.2);
    // Stab: a quick thrust out and back (peaks early).
    const thrust = this.stab > 0 ? Math.sin((1 - this.stab) * Math.PI) ** 0.7 : 0;
    const chest = spine3.getWorldPosition(v1);
    const aimDir = dirFromAngles(p.yaw, pitch);
    const fwd = v2.set(aimDir.x, aimDir.y, aimDir.z);
    const gunUp = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const lowReady = p.sprint ? 1 : 0;
    const grip = vec(fit.grip), fore = vec(fit.fore);
    const gripPos = chest.clone()
      .addScaledVector(right, knife ? 0.16 : pistol ? 0.04 : 0.12)
      .addScaledVector(gunUp, knife ? -0.08 + thrust * 0.06 : pistol ? 0.08 : 0.0 - lowReady * 0.12)
      .addScaledVector(fwd, (knife ? 0.3 + thrust * 0.38 : pistol ? 0.44 : 0.3) - this.recoil * 0.06 - lowReady * 0.1);
    // Gun basis: barrel (-X model) along fwd, +Y up; the knife points a little upward.
    const basis = new THREE.Matrix4().makeBasis(fwd.clone().negate(), gunUp, new THREE.Vector3().crossVectors(fwd.clone().negate(), gunUp));
    q1.setFromRotationMatrix(basis);
    if (knife) q1.multiply(q2.setFromEuler(new THREE.Euler(0, 0, -0.35 + thrust * 0.3)));
    if (lowReady) q1.multiply(q2.setFromEuler(new THREE.Euler(0.5, 0.6, 0)));
    this.gun.quaternion.copy(q1);
    this.gun.position.copy(gripPos).sub(grip.clone().applyQuaternion(q1));
    this.gun.updateMatrixWorld(true);
    // ---- Two-bone IK: hands onto the weapon ----
    const gripWorld = grip.applyMatrix4(this.gun.matrixWorld);
    let foreWorld = fore.applyMatrix4(this.gun.matrixWorld);
    // The knife leaves the support hand at guard by the chest.
    if (knife) foreWorld = chest.clone().addScaledVector(right, -0.14).addScaledVector(fwd, 0.22).addScaledVector(gunUp, -0.12);
    if (p.reloading > 0 && !knife) {
      const t = Math.sin(Math.min(1, p.reloading) * Math.PI);
      foreWorld = foreWorld.lerp(chest.clone().addScaledVector(gunUp, -0.25).addScaledVector(right, -0.05), t * 0.8);
    }
    const pole = (sign: number) => chest.clone().addScaledVector(right, sign * 0.7).addScaledVector(up, -0.9).addScaledVector(fwd, sign > 0 ? -0.3 : 0.1);
    this.debug = { chest: chest.clone(), grip: gripWorld.clone(), fore: foreWorld.clone() };
    solveArm(this.bones, 'r', gripWorld, pole(1));
    solveArm(this.bones, 'l', foreWorld, pole(-1));
    orientHand(this.bones, 'r', fwd.clone().addScaledVector(gunUp, -0.8).normalize(), right.clone().negate());
    orientHand(this.bones, 'l', knife ? fwd.clone().addScaledVector(gunUp, 0.5).normalize() : fwd.clone().addScaledVector(right, 0.3).normalize(), knife ? right : gunUp);
    curlFingers(this.bones, 'r', knife ? 0.85 : 0.55, 0.5);
    curlFingers(this.bones, 'l', knife ? 0.8 : 0.45, 0.4);
    this.flashLeft -= dt;
    this.flash.visible = this.flashLeft > 0;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}

const ARM_BONE = /^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_/;

/**
 * First-person arms cut from the same rigged soldier: only triangles driven by arm bones are kept,
 * so the viewmodel shows the team's sleeves, gloves (SWAT) or bare hands (Militia) posed with IK.
 */
export function createArms(assets: Assets, team: number) {
  const kit = gearOf(assets, team);
  const look = lookOf(team, 0);
  const root = SkeletonUtils.clone(assets.soldier.scene);
  const bones: Map<string, THREE.Bone> = new Map();
  root.traverse(o => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
  const body = bodyOf(root);
  root.traverse(o => { if ((o as THREE.Mesh).isMesh && o !== body) o.visible = false; });
  const boneList = body.skeleton.bones;
  const armIndex = new Set(boneList.map((b, i) => (ARM_BONE.test(b.name) ? i : -1)).filter(i => i >= 0));
  const src = paintedBody(body, look);
  const skinIndex = src.getAttribute('skinIndex'), skinWeight = src.getAttribute('skinWeight');
  const dominant = (v: number) => {
    let best = 0, w = -1;
    for (let k = 0; k < 4; k++) { const wk = skinWeight.getComponent(v, k); if (wk > w) { w = wk; best = skinIndex.getComponent(v, k); } }
    return best;
  };
  const index = src.index!;
  const kept: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    if (armIndex.has(dominant(a)) && armIndex.has(dominant(b)) && armIndex.has(dominant(c))) kept.push(a, b, c);
  }
  const armsGeo = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) armsGeo.setAttribute(name, attr);
  armsGeo.setIndex(kept);
  const original = body.material as THREE.MeshStandardMaterial;
  body.geometry = armsGeo;
  body.material = bodyMaterial(original);
  body.frustumCulled = false;
  // Gear pieces on arm bones only (the kit geometry is non-indexed and rigidly skinned).
  const gear = kit.geometry;
  const gearIndex = gear.getAttribute('skinIndex');
  const pos: number[] = [], nor: number[] = [], si: number[] = [], sw: number[] = [];
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  for (const g of gear.groups) {
    const start = pos.length / 3;
    for (let v = g.start; v < g.start + g.count; v += 3) {
      if (!armIndex.has(gearIndex.getX(v))) continue;
      for (let k = 0; k < 3; k++) {
        const i = v + k;
        pos.push(gear.getAttribute('position').getX(i), gear.getAttribute('position').getY(i), gear.getAttribute('position').getZ(i));
        nor.push(gear.getAttribute('normal').getX(i), gear.getAttribute('normal').getY(i), gear.getAttribute('normal').getZ(i));
        si.push(gearIndex.getX(i), 0, 0, 0); sw.push(1, 0, 0, 0);
      }
    }
    groups.push({ start, count: pos.length / 3 - start, materialIndex: g.materialIndex ?? 0 });
  }
  const armorGeo = new THREE.BufferGeometry();
  armorGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  armorGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  armorGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  armorGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  for (const g of groups) armorGeo.addGroup(g.start, g.count, g.materialIndex);
  const armor = new THREE.SkinnedMesh(armorGeo, gearMaterials(look, team));
  armor.bind(body.skeleton, kit.bindMatrix);
  armor.position.copy(body.position); armor.quaternion.copy(body.quaternion); armor.scale.copy(body.scale);
  armor.frustumCulled = false;
  body.parent!.add(armor);
  root.traverse(o => { (o as THREE.Mesh).castShadow = false; (o as THREE.Mesh).receiveShadow = false; });
  return { root, bones, bindPose: snapshotPose(bones) };
}
