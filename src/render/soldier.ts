import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../assets';
import { dirFromAngles } from '../../shared/math';
import { curlFingers, orientHand, restorePose, rotateWorld, snapshotPose, solveArm } from './rig';
import { LOADOUTS, type LoadoutId, type WeaponId } from '../../shared/weapons';

/** Grip/foregrip/muzzle points per weapon model (native space: barrel along -X). */
const GUN_POINTS: Record<WeaponId, { model: string; grip: THREE.Vector3; fore: THREE.Vector3; muzzle: THREE.Vector3; pistol: boolean }> = {
  carbine: { model: 'Gun_Rifle', grip: new THREE.Vector3(0.02, -0.04, 0), fore: new THREE.Vector3(-0.3, 0.0, 0), muzzle: new THREE.Vector3(-0.76, 0.121, 0), pistol: false },
  lancer: { model: 'Gun_Sniper', grip: new THREE.Vector3(0.044, -0.048, 0), fore: new THREE.Vector3(-0.36, 0.012, 0), muzzle: new THREE.Vector3(-1.28, 0.077, 0), pistol: false },
  sidearm: { model: 'Gun_Pistol', grip: new THREE.Vector3(0.02, -0.024, 0), fore: new THREE.Vector3(0.01, -0.05, 0.02), muzzle: new THREE.Vector3(-0.37, 0.11, 0), pistol: true },
  magnum: { model: 'Gun_Revolver', grip: new THREE.Vector3(0.011, -0.024, 0), fore: new THREE.Vector3(0.0, -0.05, 0.02), muzzle: new THREE.Vector3(-0.45, 0.081, 0), pistol: true },
  scatter: { model: 'Gun_Scatter', grip: new THREE.Vector3(0.06, -0.03, 0), fore: new THREE.Vector3(-0.4, 0.02, 0), muzzle: new THREE.Vector3(-0.745, 0.095, 0), pistol: false },
  stinger: { model: 'Gun_Stinger', grip: new THREE.Vector3(0.02, -0.024, 0), fore: new THREE.Vector3(0.0, -0.05, 0.02), muzzle: new THREE.Vector3(-0.44, 0.105, 0), pistol: true },
  graviton: { model: 'Gun_Graviton', grip: new THREE.Vector3(0.08, -0.035, 0), fore: new THREE.Vector3(-0.25, -0.04, 0), muzzle: new THREE.Vector3(-0.68, 0.075, 0), pistol: false },
};

export const TEAM_ARMOR = [
  { armor: 0x355f8f, trim: 0xb9c4cc, visor: 0x55d6ff, suit: 0x262d35 },
  { armor: 0x8a2a24, trim: 0x2a2a2e, visor: 0xff6a3a, suit: 0x2b2726 },
];

interface ArmorKit { geometry: THREE.BufferGeometry; bindMatrix: THREE.Matrix4 }
let armorKit: ArmorKit | undefined;

/**
 * Build hard-surface armor as ONE rigid-skinned geometry bound to the character skeleton:
 * every piece follows its bone exactly and a whole soldier's armor costs three draw calls.
 */
function buildArmor(assets: Assets): ArmorKit {
  const scene = assets.soldier.scene;
  scene.updateMatrixWorld(true);
  let body!: THREE.SkinnedMesh;
  scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) body = o as THREE.SkinnedMesh; });
  const bones = body.skeleton.bones;
  const index = (name: string) => bones.findIndex(b => b.name === name);
  const at = (name: string) => bones[index(name)].getWorldPosition(new THREE.Vector3());
  const toLocal = new THREE.Matrix4().copy(body.matrixWorld).invert();
  const pieces: THREE.BufferGeometry[] = [];
  // Character faces +Z in bind space; right side is -X.
  const add = (bone: string, geo: THREE.BufferGeometry, pos: THREE.Vector3, rot: THREE.Euler, group: 0 | 1 | 2) => {
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
  const head = at('Head'), neck = at('neck_01'), s3 = at('spine_03'), s2 = at('spine_02'), pelvis = at('pelvis');
  // Helmet shell, brow ridge, visor and comms pod.
  const helmet = new THREE.SphereGeometry(1, 24, 16); helmet.scale(0.128, 0.142, 0.15);
  add('Head', helmet, head.clone().add(new THREE.Vector3(0, 0.1, -0.005)), E(), 0);
  add('Head', rb(0.24, 0.035, 0.08, 0.015), head.clone().add(new THREE.Vector3(0, 0.155, 0.075)), E(0.25), 1);
  const visor = new THREE.SphereGeometry(1, 24, 8, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.42, Math.PI * 0.16); visor.scale(0.133, 0.15, 0.156);
  add('Head', visor, head.clone().add(new THREE.Vector3(0, 0.1, 0.0)), E(), 2);
  add('Head', rb(0.04, 0.07, 0.07, 0.015), head.clone().add(new THREE.Vector3(-0.13, 0.09, -0.01)), E(), 1);
  add('Head', rb(0.04, 0.07, 0.07, 0.015), head.clone().add(new THREE.Vector3(0.13, 0.09, -0.01)), E(), 1);
  add('neck_01', new THREE.CylinderGeometry(0.075, 0.085, 0.08, 12), neck.clone().add(new THREE.Vector3(0, 0.03, 0)), E(), 1);
  // Torso: chest plate, collar, back plate, power pack with vents, abdomen plates, belt.
  add('spine_03', rb(0.36, 0.3, 0.14, 0.04), s3.clone().add(new THREE.Vector3(0, 0.03, 0.075)), E(-0.08), 0);
  add('spine_03', rb(0.3, 0.05, 0.05, 0.02), s3.clone().add(new THREE.Vector3(0, 0.22, 0.09)), E(0.3), 1);
  add('spine_03', rb(0.34, 0.32, 0.1, 0.04), s3.clone().add(new THREE.Vector3(0, 0.03, -0.1)), E(0.05), 0);
  add('spine_03', rb(0.3, 0.36, 0.16, 0.035), s3.clone().add(new THREE.Vector3(0, 0.0, -0.2)), E(0.05), 1);
  add('spine_03', rb(0.22, 0.04, 0.02, 0.008), s3.clone().add(new THREE.Vector3(0, 0.08, -0.285)), E(0.05), 2);
  add('spine_03', rb(0.22, 0.04, 0.02, 0.008), s3.clone().add(new THREE.Vector3(0, -0.02, -0.285)), E(0.05), 2);
  add('spine_02', rb(0.3, 0.14, 0.1, 0.03), s2.clone().add(new THREE.Vector3(0, 0.0, 0.07)), E(), 1);
  add('pelvis', rb(0.36, 0.08, 0.26, 0.03), pelvis.clone().add(new THREE.Vector3(0, 0.07, 0.0)), E(), 1);
  add('pelvis', rb(0.1, 0.1, 0.06, 0.02), pelvis.clone().add(new THREE.Vector3(-0.15, 0.02, 0.06)), E(), 0);
  add('pelvis', rb(0.1, 0.1, 0.06, 0.02), pelvis.clone().add(new THREE.Vector3(0.15, 0.02, 0.06)), E(), 0);
  for (const side of ['l', 'r'] as const) {
    const sign = side === 'l' ? 1 : -1;
    const shoulder = at(`upperarm_${side}`), elbow = at(`lowerarm_${side}`), hand = at(`hand_${side}`);
    const thigh = at(`thigh_${side}`), knee = at(`calf_${side}`), foot = at(`foot_${side}`), ball = at(`ball_${side}`);
    // Pauldron, upper-arm band, bracer, gauntlet.
    add(`upperarm_${side}`, rb(0.17, 0.08, 0.18, 0.03), shoulder.clone().add(new THREE.Vector3(sign * 0.06, 0.06, 0)), E(0, 0, sign * -0.35), 0);
    add(`upperarm_${side}`, rb(0.15, 0.085, 0.095, 0.02), shoulder.clone().lerp(elbow, 0.55), E(), 1);
    add(`lowerarm_${side}`, rb(0.17, 0.08, 0.085, 0.02), elbow.clone().lerp(hand, 0.55), E(), 0);
    add(`hand_${side}`, rb(0.11, 0.05, 0.1, 0.02), hand.clone().add(new THREE.Vector3(sign * 0.05, 0.0, 0.0)), E(), 1);
    // Thigh plate, knee pad, shin guard, boot.
    add(`thigh_${side}`, rb(0.14, 0.22, 0.07, 0.025), thigh.clone().lerp(knee, 0.45).add(new THREE.Vector3(0, 0, 0.075)), E(-0.05), 0);
    add(`thigh_${side}`, rb(0.06, 0.2, 0.12, 0.02), thigh.clone().lerp(knee, 0.4).add(new THREE.Vector3(sign * 0.085, 0, 0)), E(), 1);
    add(`calf_${side}`, rb(0.12, 0.11, 0.07, 0.03), knee.clone().add(new THREE.Vector3(0, 0, 0.075)), E(), 0);
    add(`calf_${side}`, rb(0.11, 0.26, 0.07, 0.025), knee.clone().lerp(foot, 0.5).add(new THREE.Vector3(0, 0, 0.055)), E(-0.04), 1);
    const boot = rb(0.13, 0.11, 0.27, 0.035);
    add(`foot_${side}`, boot, foot.clone().lerp(ball, 0.45).add(new THREE.Vector3(0, -0.05, 0.0)), E(), 1);
  }
  // Order pieces by material so the merged geometry needs only three groups.
  const sorted = pieces.map((g, i) => ({ g, i })).sort((a, b) => a.g.userData.group - b.g.userData.group);
  const geometry = mergeGeometries(sorted.map(s => s.g), false)!;
  geometry.clearGroups();
  let start = 0;
  for (const group of [0, 1, 2]) {
    const count = sorted.filter(s => s.g.userData.group === group).reduce((n, s) => n + s.g.getAttribute('position').count, 0);
    geometry.addGroup(start, count, group);
    start += count;
  }
  geometry.computeBoundingSphere();
  return { geometry, bindMatrix: body.bindMatrix.clone() };
}

export interface SoldierPose {
  x: number; y: number; z: number; vx: number; vz: number; vy: number;
  yaw: number; pitch: number; crouch: number; grounded: boolean; sprint: boolean; ads: boolean;
  slide: boolean; alive: boolean; weapon: WeaponId; reloading: number; firing: boolean;
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
  private currentGun?: WeaponId;
  private muzzle = new THREE.Object3D();
  private wasAlive = true;
  private flinch = 0;
  private flinchDir = 1;
  private legYaw = 0;
  private recoil = 0;
  readonly flash: THREE.Mesh;
  flashLeft = 0;
  private bindPose: Map<string, THREE.Quaternion>;
  /** Dev inspection of IK targets. */
  debug?: { chest: THREE.Vector3; grip: THREE.Vector3; fore: THREE.Vector3 };

  constructor(private assets: Assets, readonly team: number, loadout: LoadoutId) {
    armorKit ??= buildArmor(assets);
    this.model = SkeletonUtils.clone(assets.soldier.scene);
    const colors = TEAM_ARMOR[team];
    let body!: THREE.SkinnedMesh;
    this.model.traverse(o => {
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) {
        body = mesh;
        const original = mesh.material as THREE.MeshStandardMaterial;
        mesh.material = new THREE.MeshStandardMaterial({ color: colors.suit, normalMap: original.normalMap, roughness: 0.82, metalness: 0.05, normalScale: new THREE.Vector2(1.2, 1.2) });
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      }
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
    });
    const armor = new THREE.SkinnedMesh(armorKit.geometry, [
      new THREE.MeshStandardMaterial({ color: colors.armor, roughness: 0.42, metalness: 0.55 }),
      new THREE.MeshStandardMaterial({ color: colors.trim, roughness: 0.55, metalness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x050607, emissive: colors.visor, emissiveIntensity: 2.2, roughness: 0.2, metalness: 0.6 }),
    ]);
    armor.bind(body.skeleton, armorKit.bindMatrix);
    armor.castShadow = true; armor.frustumCulled = false;
    armor.position.copy(body.position); armor.quaternion.copy(body.quaternion); armor.scale.copy(body.scale);
    body.parent!.add(armor);
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
    for (const id of LOADOUTS[loadout].weapons) this.addGun(assets, id);
    this.gun.add(this.muzzle);
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.visible = false;
    this.muzzle.add(this.flash);
  }

  private addGun(assets: Assets, id: WeaponId) {
    if (this.guns.has(id)) return;
    const gun = assets.weapons.get(GUN_POINTS[id].model)!.clone();
    gun.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    gun.visible = false;
    this.gun.add(gun);
    this.guns.set(id, gun);
  }

  setLoadout(assets: Assets, loadout: LoadoutId) { for (const id of LOADOUTS[loadout].weapons) this.addGun(assets, id); }

  hit(fromLeft: boolean) { this.flinch = 1; this.flinchDir = fromLeft ? 1 : -1; }
  shoot() { this.recoil = 1; this.flashLeft = 0.05; this.muzzle.rotation.z = Math.random() * 6; }

  muzzleWorld(out = new THREE.Vector3()) { return this.muzzle.getWorldPosition(out); }

  /**
   * Level of detail for crowded battles: 0 near (full rate, shadows), 1 mid (half-rate animation),
   * 2 far (quarter rate), 3 off-screen (hidden, not animated). Positions always update every frame.
   */
  setLod(level: 0 | 1 | 2 | 3) {
    if (level === this.lod) return;
    if ((level === 0) !== (this.lod === 0)) {
      this.shadowMeshes ??= [...this.meshesOf(this.model), ...this.meshesOf(this.gun)];
      for (const m of this.shadowMeshes) m.castShadow = level === 0;
    }
    this.lod = level;
    this.root.visible = level < 3;
    if (level === 3) this.gun.visible = false;
  }
  private lod: 0 | 1 | 2 | 3 = 0;
  get onScreen() { return this.lod < 3; }
  private shadowMeshes?: THREE.Mesh[];
  private frame = 0;
  private pending = 0;
  private meshesOf(o: THREE.Object3D) { const out: THREE.Mesh[] = []; o.traverse(c => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); }); return out; }

  update(dt: number, p: SoldierPose) {
    // Distant and hidden soldiers animate at a reduced rate; between updates they only move.
    const every = LOD_INTERVAL[this.lod];
    this.pending += dt;
    if (this.lod === 3 || (++this.frame % every !== 0 && p.alive === this.wasAlive)) {
      const dx = p.x - this.root.position.x, dy = p.y - this.root.position.y, dz = p.z - this.root.position.z;
      this.root.position.set(p.x, p.y, p.z);
      this.root.rotation.y = p.yaw;
      this.gun.position.x += dx; this.gun.position.y += dy; this.gun.position.z += dz;
      if (this.lod === 3) this.pending = Math.min(this.pending, 0.25);
      return;
    }
    dt = this.pending; this.pending = 0;
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;
    // ---- Locomotion blend ----
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const forward = -(p.vx * sin + p.vz * cos), strafe = p.vx * cos - p.vz * sin;
    const speed = Math.hypot(p.vx, p.vz);
    const target: Partial<Record<ClipName, number>> = {};
    if (!p.alive) target.death = 1;
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
    this.legYaw += (clampAngle * (p.sprint ? 0.3 : 1) - this.legYaw) * Math.min(1, dt * 10);
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
    const pitch = p.pitch;
    // Bladed shooting stance: torso turns so the support shoulder leads; head stays on target.
    const pistol = GUN_POINTS[p.weapon].pistol;
    const blade = p.sprint ? 0 : pistol ? -0.15 : -0.5;
    rotateWorld(spine2, up, blade * 0.5);
    rotateWorld(spine3, up, blade * 0.5);
    rotateWorld(this.bones.get('neck_01')!, up, -blade * 0.6);
    rotateWorld(this.bones.get('Head')!, up, -blade * 0.4);
    rotateWorld(spine2, right, pitch * 0.35);
    rotateWorld(spine3, right, pitch * 0.35);
    this.flinch = Math.max(0, this.flinch - dt * 5);
    if (this.flinch > 0) rotateWorld(spine3, up, this.flinch * 0.25 * this.flinchDir);
    const neck = this.bones.get('neck_01')!;
    rotateWorld(neck, right, pitch * 0.3);

    // ---- Weapon placement ----
    if (this.currentGun !== p.weapon) {
      this.addGun(this.assets, p.weapon); // bought or picked up: any weapon can be in hand
      for (const [id, g] of this.guns) g.visible = id === p.weapon;
      this.currentGun = p.weapon;
      this.muzzle.position.copy(GUN_POINTS[p.weapon].muzzle);
    }
    this.gun.visible = true;
    const points = GUN_POINTS[p.weapon];
    this.recoil = Math.max(0, this.recoil - dt * 12);
    const chest = spine3.getWorldPosition(v1);
    const aimDir = dirFromAngles(p.yaw, pitch);
    const fwd = v2.set(aimDir.x, aimDir.y, aimDir.z);
    const gunUp = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const lowReady = p.sprint ? 1 : 0;
    const gripPos = chest.clone()
      .addScaledVector(right, points.pistol ? 0.04 : 0.12)
      .addScaledVector(gunUp, points.pistol ? 0.08 : 0.0 - lowReady * 0.12)
      .addScaledVector(fwd, (points.pistol ? 0.44 : 0.3) - this.recoil * 0.06 - lowReady * 0.1);
    // Gun basis: barrel (-X model) along fwd, +Y up.
    const basis = new THREE.Matrix4().makeBasis(fwd.clone().negate(), gunUp, new THREE.Vector3().crossVectors(fwd.clone().negate(), gunUp));
    q1.setFromRotationMatrix(basis);
    if (lowReady) q1.multiply(q2.setFromEuler(new THREE.Euler(0.5, 0.6, 0)));
    this.gun.quaternion.copy(q1);
    this.gun.position.copy(gripPos).sub(points.grip.clone().applyQuaternion(q1));
    this.gun.updateMatrixWorld(true);
    // ---- Two-bone IK: hands onto the weapon ----
    const gripWorld = points.grip.clone().applyMatrix4(this.gun.matrixWorld);
    let foreWorld = points.fore.clone().applyMatrix4(this.gun.matrixWorld);
    if (p.reloading > 0) {
      const t = Math.sin(Math.min(1, p.reloading) * Math.PI);
      foreWorld = foreWorld.lerp(chest.clone().addScaledVector(gunUp, -0.25).addScaledVector(right, -0.05), t * 0.8);
    }
    const pole = (sign: number) => chest.clone().addScaledVector(right, sign * 0.7).addScaledVector(up, -0.9).addScaledVector(fwd, sign > 0 ? -0.3 : 0.1);
    this.debug = { chest: chest.clone(), grip: gripWorld.clone(), fore: foreWorld.clone() };
    solveArm(this.bones, 'r', gripWorld, pole(1));
    solveArm(this.bones, 'l', foreWorld, pole(-1));
    orientHand(this.bones, 'r', fwd.clone().addScaledVector(gunUp, -0.8).normalize(), right.clone().negate());
    orientHand(this.bones, 'l', fwd.clone().addScaledVector(right, 0.3).normalize(), gunUp);
    curlFingers(this.bones, 'r', 0.55, 0.5);
    curlFingers(this.bones, 'l', 0.45, 0.4);
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
 * so the viewmodel shows real armored sleeves and gloved hands that pose with IK.
 */
export function createArms(assets: Assets, team: number) {
  armorKit ??= buildArmor(assets);
  const root = SkeletonUtils.clone(assets.soldier.scene);
  const colors = TEAM_ARMOR[team];
  const bones: Map<string, THREE.Bone> = new Map();
  let body!: THREE.SkinnedMesh;
  root.traverse(o => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) body = o as THREE.SkinnedMesh;
  });
  const boneList = body.skeleton.bones;
  const armIndex = new Set(boneList.map((b, i) => (ARM_BONE.test(b.name) ? i : -1)).filter(i => i >= 0));
  const src = body.geometry;
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
  body.material = new THREE.MeshStandardMaterial({ color: colors.suit, normalMap: original.normalMap, roughness: 0.78, metalness: 0.05, normalScale: new THREE.Vector2(1.2, 1.2) });
  body.frustumCulled = false;
  // Armor pieces on arm bones only (the kit geometry is non-indexed and rigidly skinned).
  const kit = armorKit.geometry;
  const kitIndex = kit.getAttribute('skinIndex');
  const pos: number[] = [], nor: number[] = [], si: number[] = [], sw: number[] = [];
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  for (const g of kit.groups) {
    const start = pos.length / 3;
    for (let v = g.start; v < g.start + g.count; v += 3) {
      if (!armIndex.has(kitIndex.getX(v))) continue;
      for (let k = 0; k < 3; k++) {
        const i = v + k;
        pos.push(kit.getAttribute('position').getX(i), kit.getAttribute('position').getY(i), kit.getAttribute('position').getZ(i));
        nor.push(kit.getAttribute('normal').getX(i), kit.getAttribute('normal').getY(i), kit.getAttribute('normal').getZ(i));
        si.push(kitIndex.getX(i), 0, 0, 0); sw.push(1, 0, 0, 0);
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
  const armor = new THREE.SkinnedMesh(armorGeo, [
    new THREE.MeshStandardMaterial({ color: colors.armor, roughness: 0.42, metalness: 0.55 }),
    new THREE.MeshStandardMaterial({ color: colors.trim, roughness: 0.55, metalness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: 0x050607, emissive: colors.visor, emissiveIntensity: 2.2 }),
  ]);
  armor.bind(body.skeleton, armorKit.bindMatrix);
  armor.position.copy(body.position); armor.quaternion.copy(body.quaternion); armor.scale.copy(body.scale);
  armor.frustumCulled = false;
  body.parent!.add(armor);
  root.traverse(o => { (o as THREE.Mesh).castShadow = false; (o as THREE.Mesh).receiveShadow = false; });
  return { root, bones, bindPose: snapshotPose(bones) };
}
