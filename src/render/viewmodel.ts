import * as THREE from 'three';
import type { Assets } from '../assets';
import { WEAPONS, type WeaponId } from '../../shared/weapons';
import type { LocalPlayer } from '../game/player';
import { curlFingers, orientHand, restorePose, solveArm, type Bones } from './rig';
import { createArms } from './soldier';

/** Per-weapon attachment points in the model's native space (barrel along -X, up +Y). */
interface Rig {
  model: string; grip: THREE.Vector3; fore: THREE.Vector3; sight: number; muzzle: THREE.Vector3; mag: THREE.Vector3;
  magModel?: string; hip: THREE.Vector3; adsZ: number; scope?: boolean; pistol?: boolean;
}
const RIGS: Record<WeaponId, Rig> = {
  carbine: { model: 'Gun_Rifle', grip: new THREE.Vector3(0.02, -0.04, 0), fore: new THREE.Vector3(-0.33, 0.0, 0), sight: 0.292, muzzle: new THREE.Vector3(-0.76, 0.121, 0), mag: new THREE.Vector3(-0.15, 0.06, 0.03), magModel: 'Gun_SMG_Ammo', hip: new THREE.Vector3(0.14, -0.32, -0.36), adsZ: -0.36 },
  lancer: { model: 'Gun_Sniper', grip: new THREE.Vector3(0.044, -0.048, 0), fore: new THREE.Vector3(-0.47, 0.012, 0), sight: 0.19, muzzle: new THREE.Vector3(-1.28, 0.077, 0), mag: new THREE.Vector3(-0.22, -0.06, 0), magModel: 'Gun_Sniper_Ammo', hip: new THREE.Vector3(0.14, -0.32, -0.38), adsZ: -0.4, scope: true },
  sidearm: { model: 'Gun_Pistol', grip: new THREE.Vector3(0.02, -0.024, 0), fore: new THREE.Vector3(0.025, -0.05, 0.03), sight: 0.192, muzzle: new THREE.Vector3(-0.37, 0.11, 0), mag: new THREE.Vector3(0.03, -0.09, 0), hip: new THREE.Vector3(0.13, -0.17, -0.4), adsZ: -0.38, pistol: true },
  magnum: { model: 'Gun_Revolver', grip: new THREE.Vector3(0.011, -0.024, 0), fore: new THREE.Vector3(0.02, -0.05, 0.03), sight: 0.17, muzzle: new THREE.Vector3(-0.45, 0.081, 0), mag: new THREE.Vector3(-0.08, 0.07, 0), hip: new THREE.Vector3(0.13, -0.17, -0.4), adsZ: -0.4, pistol: true },
  scatter: { model: 'Gun_Scatter', grip: new THREE.Vector3(0.06, -0.03, 0), fore: new THREE.Vector3(-0.4, 0.02, 0), sight: 0.182, muzzle: new THREE.Vector3(-0.745, 0.095, 0), mag: new THREE.Vector3(-0.3, 0.03, 0), hip: new THREE.Vector3(0.15, -0.31, -0.36), adsZ: -0.38 },
  stinger: { model: 'Gun_Stinger', grip: new THREE.Vector3(0.02, -0.024, 0), fore: new THREE.Vector3(0.03, -0.12, 0.03), sight: 0.192, muzzle: new THREE.Vector3(-0.44, 0.105, 0), mag: new THREE.Vector3(0.035, -0.2, 0), hip: new THREE.Vector3(0.13, -0.17, -0.4), adsZ: -0.38, pistol: true },
  graviton: { model: 'Gun_Graviton', grip: new THREE.Vector3(0.08, -0.035, 0), fore: new THREE.Vector3(-0.25, -0.04, 0), sight: 0.24, muzzle: new THREE.Vector3(-0.68, 0.075, 0), mag: new THREE.Vector3(0.13, 0.1, 0), hip: new THREE.Vector3(0.15, -0.32, -0.38), adsZ: -0.38 },
  // Imported guns: origin at the grip (tools/import-guns.ts).
  hornet: { model: 'Gun_Hornet', grip: new THREE.Vector3(0.005, 0, 0), fore: new THREE.Vector3(0.025, -0.06, 0.03), sight: 0.225, muzzle: new THREE.Vector3(-0.33, 0.2, 0), mag: new THREE.Vector3(0.02, -0.09, 0), hip: new THREE.Vector3(0.13, -0.17, -0.4), adsZ: -0.38, pistol: true },
  warden: { model: 'Gun_Warden', grip: new THREE.Vector3(0.005, 0, 0), fore: new THREE.Vector3(0.025, -0.06, 0.03), sight: 0.155, muzzle: new THREE.Vector3(-0.45, 0.125, 0), mag: new THREE.Vector3(0.0, -0.08, 0), hip: new THREE.Vector3(0.13, -0.17, -0.4), adsZ: -0.38, pistol: true },
  wasp: { model: 'Gun_Wasp', grip: new THREE.Vector3(0.005, 0, 0), fore: new THREE.Vector3(-0.21, -0.03, 0), sight: 0.2, muzzle: new THREE.Vector3(-0.45, 0.13, 0), mag: new THREE.Vector3(-0.2, -0.06, 0), magModel: 'Gun_SMG_Ammo', hip: new THREE.Vector3(0.14, -0.32, -0.36), adsZ: -0.36 },
  viper: { model: 'Gun_Viper', grip: new THREE.Vector3(0.005, 0, 0), fore: new THREE.Vector3(-0.3, 0.05, 0), sight: 0.125, muzzle: new THREE.Vector3(-0.46, 0.085, 0), mag: new THREE.Vector3(-0.13, -0.06, 0), magModel: 'Gun_SMG_Ammo', hip: new THREE.Vector3(0.14, -0.32, -0.36), adsZ: -0.36 },
  reaper: { model: 'Gun_Reaper', grip: new THREE.Vector3(0.005, 0, 0), fore: new THREE.Vector3(-0.45, 0.05, 0), sight: 0.115, muzzle: new THREE.Vector3(-0.69, 0.095, 0), mag: new THREE.Vector3(-0.2, 0.08, 0), hip: new THREE.Vector3(0.14, -0.32, -0.36), adsZ: -0.36 },
  thunder: { model: 'Gun_Thunder', grip: new THREE.Vector3(0.005, 0, 0), fore: new THREE.Vector3(-0.53, -0.005, 0), sight: 0.085, muzzle: new THREE.Vector3(-0.82, 0.06, 0), mag: new THREE.Vector3(-0.35, 0.0, 0), hip: new THREE.Vector3(0.14, -0.32, -0.36), adsZ: -0.36 },
  brawler: { model: 'Gun_Brawler', grip: new THREE.Vector3(0.005, 0, 0), fore: new THREE.Vector3(-0.38, 0.085, 0), sight: 0.16, muzzle: new THREE.Vector3(-0.76, 0.12, 0), mag: new THREE.Vector3(-0.24, -0.05, 0), magModel: 'Gun_SMG_Ammo', hip: new THREE.Vector3(0.14, -0.32, -0.36), adsZ: -0.36 },
  kestrel: { model: 'Gun_Kestrel', grip: new THREE.Vector3(0.005, 0, 0), fore: new THREE.Vector3(-0.52, 0.06, 0), sight: 0.268, muzzle: new THREE.Vector3(-0.67, 0.2, 0), mag: new THREE.Vector3(0.15, 0.0, 0), magModel: 'Gun_SMG_Ammo', hip: new THREE.Vector3(0.14, -0.32, -0.36), adsZ: -0.36 },
  marksman: { model: 'Gun_Marksman', grip: new THREE.Vector3(0.005, 0, 0), fore: new THREE.Vector3(-0.4, 0.11, 0), sight: 0.225, muzzle: new THREE.Vector3(-0.74, 0.165, 0), mag: new THREE.Vector3(-0.17, -0.05, 0), magModel: 'Gun_SMG_Ammo', hip: new THREE.Vector3(0.14, -0.32, -0.36), adsZ: -0.36 },
  swift: { model: 'Gun_Swift', grip: new THREE.Vector3(0.005, 0, 0), fore: new THREE.Vector3(-0.5, 0.0, 0), sight: 0.087, muzzle: new THREE.Vector3(-1.21, 0.035, 0), mag: new THREE.Vector3(-0.18, -0.04, 0), magModel: 'Gun_Sniper_Ammo', hip: new THREE.Vector3(0.14, -0.32, -0.38), adsZ: -0.4, scope: true },
  longbow: { model: 'Gun_Longbow', grip: new THREE.Vector3(0.005, 0, 0), fore: new THREE.Vector3(-0.55, 0.02, 0), sight: 0.137, muzzle: new THREE.Vector3(-1.26, 0.075, 0), mag: new THREE.Vector3(-0.25, 0.0, 0), magModel: 'Gun_Sniper_Ammo', hip: new THREE.Vector3(0.14, -0.32, -0.38), adsZ: -0.4, scope: true },
  hammer: { model: 'Gun_Hammer', grip: new THREE.Vector3(0.005, 0, 0), fore: new THREE.Vector3(-0.45, 0.12, 0), sight: 0.27, muzzle: new THREE.Vector3(-0.67, 0.2, 0), mag: new THREE.Vector3(0.25, -0.05, 0), magModel: 'Gun_SMG_Ammo', hip: new THREE.Vector3(0.14, -0.32, -0.36), adsZ: -0.36 },
};

/** Hand-tuned view kick for the original guns; the others scale with their recoil view punch. */
const KICK: Partial<Record<WeaponId, number>> = { lancer: 1.8, magnum: 1.5, sidearm: 0.9, carbine: 1, scatter: 1, stinger: 1, graviton: 1 };

const ease = (t: number) => t * t * (3 - 2 * t);

/** Spring-damped scalar for weapon motion. */
class Spring {
  value = 0; velocity = 0;
  constructor(private stiffness: number, private damping: number) {}
  update(target: number, dt: number) {
    this.velocity += ((target - this.value) * this.stiffness - this.velocity * this.damping) * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}

/** Model space (barrel -X) to gun-group space (barrel -Z). */
const toGun = (v: THREE.Vector3) => new THREE.Vector3(-v.z, v.y, v.x);

/**
 * First-person weapon: CC0 gun models held by the soldier's own rigged arms (IK onto the grip
 * and handguard), animated entirely in code: sway, bob, recoil, ADS, sprint, reload, equip, throw.
 */
export class ViewModel {
  readonly root = new THREE.Group();
  private rig = new THREE.Group();
  private gun = new THREE.Group();
  private models = new Map<WeaponId, THREE.Object3D>();
  private mags = new Map<string, THREE.Object3D>();
  private current: WeaponId = 'carbine';
  private arms: { root: THREE.Object3D; bones: Bones; bindPose: Map<string, THREE.Quaternion> };
  private grenade: THREE.Object3D;
  private flash: THREE.Group;
  private flashLeft = 0;
  private kickBack = new Spring(260, 20);
  private kickPitch = new Spring(220, 18);
  private kickRoll = new Spring(160, 14);
  private swayX = new Spring(60, 11);
  private swayY = new Spring(60, 11);
  private sprint = new Spring(70, 14);
  private time = 0;
  private equipT = 1;
  scopeVisible = false;

  constructor(assets: Assets, team: number) {
    this.root.add(this.rig);
    this.rig.add(this.gun);
    for (const [id, rig] of Object.entries(RIGS) as [WeaponId, Rig][]) {
      const model = assets.weapons.get(rig.model)!.clone();
      model.rotation.y = -Math.PI / 2;
      model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; } });
      model.visible = false;
      this.gun.add(model);
      this.models.set(id, model);
    }
    for (const name of ['Gun_SMG_Ammo', 'Gun_Sniper_Ammo']) {
      const mag = assets.weapons.get(name)!.clone();
      mag.rotation.y = -Math.PI / 2;
      mag.visible = false;
      this.root.add(mag);
      this.mags.set(name, mag);
    }
    this.arms = createArms(assets, team);
    // The rig faces +Z; turn it to look down -Z with the shoulders just behind the camera.
    this.arms.root.rotation.y = Math.PI;
    this.root.add(this.arms.root);
    this.root.updateMatrixWorld(true);
    const head = this.arms.bones.get('Head')!.getWorldPosition(new THREE.Vector3());
    this.arms.root.scale.setScalar(1.18);
    this.root.updateMatrixWorld(true);
    head.copy(this.arms.bones.get('Head')!.getWorldPosition(new THREE.Vector3()));
    // Shoulders sit slightly ahead of and below the eye so both hands reach the weapon.
    this.arms.root.position.set(-head.x, -head.y - 0.1, -head.z - 0.12);
    this.grenade = assets.weapons.get('Prop_Grenade')!.clone();
    this.grenade.visible = false;
    this.root.add(this.grenade);
    this.flash = makeFlash();
    this.gun.add(this.flash);
    this.setWeapon('carbine', true);
  }

  setWeapon(id: WeaponId, instant = false) {
    this.models.get(this.current)!.visible = false;
    this.current = id;
    this.models.get(id)!.visible = true;
    if (!instant) this.equipT = 0;
    this.flash.position.copy(toGun(RIGS[id].muzzle));
  }

  /** World-space muzzle position for tracers, re-projected from the view-model camera. */
  muzzleWorld(camera: THREE.PerspectiveCamera, viewCamera: THREE.PerspectiveCamera, out = new THREE.Vector3()) {
    this.flash.getWorldPosition(out);
    viewCamera.worldToLocal(out);
    const k = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(viewCamera.fov) / 2);
    out.x *= k; out.y *= k;
    return camera.localToWorld(out);
  }

  fire() {
    const kick = KICK[this.current];
    const strength = kick ?? 0.55 + WEAPONS[this.current].recoil.viewPunch * 0.38;
    this.kickBack.velocity += 2.6 * strength;
    this.kickPitch.velocity += 3.4 * strength * (0.8 + Math.random() * 0.4);
    this.kickRoll.velocity += (Math.random() - 0.5) * 3 * strength;
    this.flashLeft = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
  }

  update(dt: number, p: LocalPlayer, look: { x: number; y: number }) {
    this.time += dt;
    const w = p.weapon;
    if (w.id !== this.current) this.setWeapon(w.id);
    const rig = RIGS[this.current];
    this.equipT = Math.min(1, this.equipT + dt / Math.max(0.15, w.equipTime));
    const speed = Math.min(1.4, p.speed() / 6);
    const sprint = Math.max(0, Math.min(1, this.sprint.update(p.sprinting ? 1 : 0, dt)));
    // Coming out of a sprint, the weapon must finish lowering before the sights come up.
    const ads = ease(p.ads) * (1 - sprint);
    // Mouse sway lags behind the view.
    const sx = this.swayX.update(Math.max(-1, Math.min(1, -look.x * 0.0035)) * (1 - ads * 0.8), dt);
    const sy = this.swayY.update(Math.max(-1, Math.min(1, look.y * 0.0035)) * (1 - ads * 0.8), dt);
    const back = this.kickBack.update(0, dt), kick = this.kickPitch.update(0, dt), roll = this.kickRoll.update(0, dt);
    // Bob (figure eight), stronger when sprinting, nearly gone in ADS.
    const bobAmount = (p.m.grounded && p.m.slideTime <= 0 ? speed : 0) * (1 - ads * 0.9);
    const bx = Math.sin(p.bobPhase) * 0.011 * bobAmount * (1 + sprint), by = -Math.abs(Math.cos(p.bobPhase)) * 0.013 * bobAmount * (1 + sprint * 1.4);
    const breathe = Math.sin(this.time * 1.6) * 0.0022 * (1 - ads * 0.7);

    // ---- Base pose: hip -> ADS -> sprint ----
    const adsPos = new THREE.Vector3(0, -rig.sight, rig.adsZ);
    const pos = new THREE.Vector3().lerpVectors(rig.hip, adsPos, ads);
    let rx = 0.04 * (1 - ads), ry = 0.085 * (1 - ads), rz = 0.03 * (1 - ads);
    pos.x -= sprint * 0.02; pos.y -= sprint * 0.03; pos.z += sprint * 0.06;
    rx += sprint * -0.2; ry += sprint * 0.4; rz += sprint * 0.3;
    if (rig.pistol) { ry -= sprint * 0.5; rx -= sprint * 0.4; }
    rz += p.m.slideTime > 0 ? 0.25 * (1 - ads) : 0;
    pos.y -= p.landDip * 0.25;
    // ---- Reload choreography (left hand pulls and seats the magazine) ----
    let leftTarget: THREE.Vector3 | undefined;
    const mag = rig.magModel ? this.mags.get(rig.magModel) : undefined;
    if (mag) mag.visible = false;
    if (p.reloadLeft > 0) {
      const t = 1 - p.reloadLeft / p.reloadTotal;
      const tilt = Math.sin(Math.min(1, t * 1.2) * Math.PI);
      rz += tilt * 0.5; rx += tilt * 0.25; ry += tilt * -0.3; pos.y -= tilt * 0.03; pos.x -= tilt * 0.03;
      const magSpot = toGun(rig.mag), out = magSpot.clone().add(new THREE.Vector3(-0.08, -0.3, 0.1));
      if (t < 0.22) leftTarget = new THREE.Vector3().lerpVectors(toGun(rig.fore), magSpot, ease(t / 0.22));
      else if (t < 0.48) leftTarget = new THREE.Vector3().lerpVectors(magSpot, out, ease((t - 0.22) / 0.26));
      else if (t < 0.74) leftTarget = new THREE.Vector3().lerpVectors(out, magSpot, ease((t - 0.48) / 0.26));
      else leftTarget = new THREE.Vector3().lerpVectors(magSpot, toGun(rig.fore), ease((t - 0.74) / 0.26));
      if (t > 0.72 && t < 0.76) this.kickBack.velocity += 0.5;
    }
    // ---- Equip raise and grenade throw ----
    const e = ease(this.equipT);
    rx -= (1 - e) * 1.1; pos.y -= (1 - e) * 0.18;
    let throwing = 0;
    if (p.throwLeft > 0) { throwing = 1 - p.throwLeft / 0.32; pos.y -= Math.sin(throwing * Math.PI) * 0.14; rx -= Math.sin(throwing * Math.PI) * 0.5; }

    this.rig.position.set(pos.x + bx + sx * 0.02, pos.y + by + breathe + sy * 0.015, pos.z + back * 0.05);
    this.rig.rotation.set(rx + kick * 0.06 + sy * 0.05, ry + sx * 0.06, rz + roll * 0.04 + sx * 0.05, 'YXZ');
    this.gun.position.copy(toGun(rig.grip)).multiplyScalar(-1);
    this.root.updateMatrixWorld(true);

    // ---- Arms: IK onto the grip and handguard ----
    const bones = this.arms.bones;
    restorePose(bones, this.arms.bindPose);
    this.arms.root.updateMatrixWorld(true);
    const gunMatrix = this.gun.matrixWorld;
    const gripW = toGun(rig.grip).applyMatrix4(gunMatrix);
    let foreW = (leftTarget ?? toGun(rig.fore)).clone().applyMatrix4(gunMatrix);
    const gunFwd = new THREE.Vector3(0, 0, -1).transformDirection(gunMatrix);
    const gunUp = new THREE.Vector3(0, 1, 0).transformDirection(gunMatrix);
    const gunRight = new THREE.Vector3(1, 0, 0).transformDirection(gunMatrix);
    if (p.throwLeft > 0) foreW = new THREE.Vector3(-0.2, -0.08 + Math.sin(throwing * Math.PI) * 0.25, -0.3 - throwing * 0.25);
    solveArm(bones, 'r', gripW.clone().addScaledVector(gunRight, 0.03).addScaledVector(gunUp, -0.02), new THREE.Vector3(0.6, -0.7, 0.2));
    solveArm(bones, 'l', foreW.clone().addScaledVector(gunFwd, -0.05).addScaledVector(gunUp, -0.07).addScaledVector(gunRight, -0.025), new THREE.Vector3(-0.7, -0.6, -0.1));
    orientHand(bones, 'r', gunFwd.clone().addScaledVector(gunUp, -1.1).normalize(), gunRight.clone().negate());
    if (p.throwLeft > 0) orientHand(bones, 'l', new THREE.Vector3(0.2, 0.6, -1).normalize(), new THREE.Vector3(0.6, 0, -0.4));
    else if (rig.pistol && !leftTarget) orientHand(bones, 'l', gunFwd.clone().addScaledVector(gunUp, -0.9).normalize(), gunRight);
    else orientHand(bones, 'l', gunFwd.clone().addScaledVector(gunRight, 0.5).addScaledVector(gunUp, 0.3).normalize(), gunUp.clone().add(gunRight).normalize());
    curlFingers(bones, 'r', 0.62, 0.55);
    curlFingers(bones, 'l', leftTarget ? 0.75 : 0.5, 0.45);

    // ---- Held objects ----
    const lh = bones.get('hand_l')!;
    if (mag && p.reloadLeft > 0) {
      const t = 1 - p.reloadLeft / p.reloadTotal;
      if (t > 0.2 && t < 0.76) { mag.visible = true; lh.getWorldPosition(mag.position).add(new THREE.Vector3(0.02, -0.05, -0.04)); mag.quaternion.copy(this.gun.getWorldQuaternion(new THREE.Quaternion())); mag.rotateY(-Math.PI / 2); }
    }
    this.grenade.visible = p.throwLeft > 0;
    if (this.grenade.visible) lh.getWorldPosition(this.grenade.position).add(new THREE.Vector3(0.02, 0.03, -0.06));

    this.flashLeft -= dt;
    this.flash.visible = this.flashLeft > 0 && !(rig.scope && p.ads > 0.95);
    // Scoped rifles hide the model at full zoom; the HUD draws the reticle.
    this.scopeVisible = !!rig.scope && p.ads > 0.92;
    this.root.visible = !this.scopeVisible;
  }
}

function makeFlash() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.25, 'rgba(255,220,140,0.9)'); g.addColorStop(0.6, 'rgba(255,140,40,0.35)'); g.addColorStop(1, 'rgba(255,100,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, r = i % 2 ? 22 : 62; ctx.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd9a0 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), mat));
  for (const r of [0, Math.PI / 2]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.12), mat);
    side.rotation.set(0, Math.PI / 2, r);
    side.position.z = -0.12;
    group.add(side);
  }
  group.traverse(o => { (o as THREE.Mesh).frustumCulled = false; o.renderOrder = 10; });
  group.visible = false;
  return group;
}
