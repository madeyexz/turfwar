import * as THREE from 'three';
import type { Assets } from '../assets';
import { ATTACHMENT_SLOTS, WEAPONS, WEAPON_IDS, type Attachments, type WeaponId } from '../../shared/weapons';
import type { LocalPlayer } from '../game/player';
import { curlFingers, orientHand, restorePose, solveArm, type Bones } from './rig';
import { GUN_FIT, fitAttachments, overlayFor, vec, type Fitted, type Overlay } from './optics';
import { opticFov, settings } from '../game/settings';
import { requestScope } from './sights';
import { createArms } from './soldier';

/** Where the weapon rests at the hip (gun-group space) and how far ahead of the eye it sits when aimed (fitted sights set their own eye relief). */
const HOLD: Record<WeaponId, { hip: THREE.Vector3; adsZ: number }> = {
  knife: { hip: new THREE.Vector3(0.16, -0.18, -0.34), adsZ: -0.34 },
  mp5: { hip: new THREE.Vector3(0.14, -0.3, -0.36), adsZ: -0.34 },
  mp7: { hip: new THREE.Vector3(0.14, -0.28, -0.36), adsZ: -0.33 },
  m4a1: { hip: new THREE.Vector3(0.14, -0.32, -0.36), adsZ: -0.36 },
  m110: { hip: new THREE.Vector3(0.12, -0.22, -0.34), adsZ: -0.4 },
  m249: { hip: new THREE.Vector3(0.15, -0.36, -0.38), adsZ: -0.4 },
  m1014: { hip: new THREE.Vector3(0.15, -0.27, -0.36), adsZ: -0.38 },
  m9a1: { hip: new THREE.Vector3(0.14, -0.19, -0.42), adsZ: -0.4 },
};

const ease = (t: number) => t * t * (3 - 2 * t);

/** Knife slash keyframes: [time, position, rotation (pitch, yaw, roll)] from the guard pose and back. */
type Key = [number, number[], number[]];
const SLASH: Key[] = [
  [0, [0.16, -0.18, -0.34], [0.35, 0.25, -0.35]], [0.18, [0.24, -0.08, -0.42], [0.5, -0.5, -0.6]], [0.42, [0.02, -0.13, -0.5], [0.15, 0.4, -0.7]],
  [0.6, [-0.12, -0.22, -0.46], [-0.15, 0.85, -0.8]], [1, [0.16, -0.18, -0.34], [0.35, 0.25, -0.35]],
];
const BACKHAND: Key[] = [
  [0, [0.16, -0.18, -0.34], [0.35, 0.25, -0.35]], [0.18, [-0.06, -0.22, -0.42], [-0.1, 0.8, 0.5]], [0.42, [0.1, -0.11, -0.5], [0.25, 0.0, 0.6]],
  [0.6, [0.24, -0.06, -0.44], [0.45, -0.6, 0.7]], [1, [0.16, -0.18, -0.34], [0.35, 0.25, -0.35]],
];

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
const g = (v: [number, number, number]) => toGun(vec(v));

/**
 * First-person weapon: CC0 gun models held by the soldier's own rigged arms (IK onto the grip
 * and handguard), animated entirely in code: sway, bob, recoil, ADS, sprint, reload, equip, throw,
 * knife slashes. Fitted attachments (optic, suppressor, laser, flashlight, clip…) come from optics.ts.
 */
export class ViewModel {
  readonly root = new THREE.Group();
  /**
   * Weapon light for a fitted flashlight. It lights the world, so it belongs in the world scene:
   * the game adds it (and its target) to the world camera once; intensity stays 0 without a flashlight.
   */
  readonly torch = new THREE.SpotLight(0xfff1dc, 0, 45, 0.36, 0.55, 1.4);
  private rig = new THREE.Group();
  private gun = new THREE.Group();
  private models = new Map<WeaponId, THREE.Object3D>();
  private fitted = new Map<string, Fitted>();
  private fit!: Fitted;
  private mags = new Map<string, THREE.Object3D>();
  private current: WeaponId = 'mp5';
  private attachments: Attachments = {};
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
  private lower = new Spring(60, 13);
  private time = 0;
  private equipT = 1;
  /** Knife slash progress (1 = done) and alternating direction. */
  private slashT = 1;
  private slashDir = 1;
  scopeVisible = false;
  /** Eyepiece overlay of the fitted optic (x6 sniper scope, ACOG/x4 prism); the 3D model hides behind it. */
  overlay: Overlay;

  constructor(private assets: Assets, team: number) {
    this.root.add(this.rig);
    this.rig.add(this.gun);
    for (const id of WEAPON_IDS) {
      const model = assets.weapons.get(WEAPONS[id].model)!.clone();
      model.rotation.y = -Math.PI / 2;
      model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; } });
      model.visible = false;
      this.gun.add(model);
      this.models.set(id, model);
    }
    for (const name of ['Gun_SMG_Ammo']) {
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
    this.arms.root.scale.setScalar(1.18);
    this.root.updateMatrixWorld(true);
    const head = this.arms.bones.get('Head')!.getWorldPosition(new THREE.Vector3());
    // Shoulders sit slightly ahead of and below the eye so both hands reach the weapon.
    this.arms.root.position.set(-head.x, -head.y - 0.1, -head.z - 0.12);
    this.grenade = assets.weapons.get('Prop_Grenade')!.clone();
    this.grenade.visible = false;
    this.root.add(this.grenade);
    this.flash = makeFlash();
    this.gun.add(this.flash);
    this.torch.position.set(0.12, -0.12, 0);
    this.torch.target.position.set(0.05, -0.1, -10);
    this.setWeapon('mp5', {}, true);
  }

  /** Show weapon `id` with its fitted attachments (rebuilt when they change). */
  setWeapon(id: WeaponId, attachments: Attachments = {}, instant = false) {
    const key = `${id}|${ATTACHMENT_SLOTS.map(c => attachments[c] ?? '').join('|')}`;
    let fit = this.fitted.get(key);
    if (!fit) {
      fit = fitAttachments(this.assets.weapons, id, attachments, 'first');
      fit.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; m.frustumCulled = false; } });
      this.fitted.set(key, fit);
    }
    if (this.fit) this.fit.group.removeFromParent();
    this.models.get(this.current)!.visible = false;
    if (id !== this.current && !instant) this.equipT = 0;
    this.current = id;
    this.attachments = attachments;
    this.fit = fit;
    const model = this.models.get(id)!;
    model.visible = true;
    model.add(fit.group);
    this.flash.position.copy(toGun(fit.muzzle));
    this.overlay = overlayFor({ ...WEAPONS[id], attachments });
    this.slashT = 1;
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
    if (this.current === 'knife') { this.slashT = 0; this.slashDir = -this.slashDir; return; }
    const w = WEAPONS[this.current];
    const strength = w.class === 'sniper' ? 1.8 : w.class === 'shotgun' ? 1.6 : w.class === 'pistol' ? 0.9 : 0.55 + w.recoil.viewPunch * 0.3;
    this.kickBack.velocity += 2.6 * strength;
    this.kickPitch.velocity += 3.4 * strength * (0.8 + Math.random() * 0.4);
    this.kickRoll.velocity += (Math.random() - 0.5) * 3 * strength;
    // A suppressor hides the muzzle flash.
    this.flashLeft = this.attachments.muzzle === 'suppressor' ? 0 : 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar((0.8 + Math.random() * 0.5) * (w.class === 'shotgun' || w.class === 'lmg' ? 1.3 : 1));
  }

  update(dt: number, p: LocalPlayer, look: { x: number; y: number }) {
    this.time += dt;
    const fit = GUN_FIT[this.current], hold = HOLD[this.current], knife = fit.kind === 'knife', pistol = fit.kind === 'pistol';
    this.equipT = Math.min(1, this.equipT + dt / Math.max(0.15, p.weapon.equipTime));
    const speed = Math.min(1.4, p.speed() / 6);
    const sprint = Math.max(0, Math.min(1, this.sprint.update(p.sprinting ? (p.reloadLeft > 0 ? 0.35 : 1) : 0, dt)));
    // Arming or disarming the bomb lowers the weapon out of the way.
    const lowered = Math.max(0, Math.min(1, this.lower.update(p.using ? 1 : 0, dt)));
    // Coming out of a sprint, the weapon must finish lowering before the sights come up.
    const ads = knife ? 0 : ease(p.ads) * (1 - sprint) * (1 - lowered);
    // Mouse sway lags behind the view.
    const sx = this.swayX.update(Math.max(-1, Math.min(1, -look.x * 0.0035)) * (1 - ads * 0.8), dt);
    const sy = this.swayY.update(Math.max(-1, Math.min(1, look.y * 0.0035)) * (1 - ads * 0.8), dt);
    const back = this.kickBack.update(0, dt), kick = this.kickPitch.update(0, dt), roll = this.kickRoll.update(0, dt);
    // Bob (figure eight), stronger when sprinting, nearly gone in ADS.
    const bobAmount = (p.m.grounded && p.m.slideTime <= 0 ? speed : 0) * (1 - ads * 0.9);
    const bx = Math.sin(p.bobPhase) * 0.011 * bobAmount * (1 + sprint), by = -Math.abs(Math.cos(p.bobPhase)) * 0.013 * bobAmount * (1 + sprint * 1.4);
    const breathe = Math.sin(this.time * 1.6) * 0.0022 * (1 - ads * 0.7);

    // ---- Base pose: hip -> ADS -> sprint ----
    // The sight's rear surface sits its eye relief ahead of the eye (red dots and holo sights frame the view, scopes fill it).
    const adsZ = this.fit.relief !== undefined && this.fit.eyeX !== undefined ? -(this.fit.relief + this.fit.eyeX - fit.grip[0]) : hold.adsZ;
    const adsPos = new THREE.Vector3(0, -(this.fit.sightLine - fit.grip[1]), adsZ);
    const pos = new THREE.Vector3().lerpVectors(hold.hip, adsPos, ads);
    let rx = 0.04 * (1 - ads), ry = 0.085 * (1 - ads), rz = 0.03 * (1 - ads);
    if (knife) { rx = 0.35; ry = 0.25; rz = -0.35; }
    pos.x -= sprint * 0.02; pos.y -= sprint * 0.03; pos.z += sprint * 0.06;
    rx += sprint * -0.2; ry += sprint * 0.4; rz += sprint * 0.3;
    if (pistol || knife) { ry -= sprint * 0.5; rx -= sprint * 0.4; }
    pos.y -= lowered * 0.16; rx -= lowered * 0.7; ry += lowered * 0.3;
    rz += p.m.slideTime > 0 ? 0.25 * (1 - ads) : 0;
    pos.y -= p.landDip * 0.25;
    // ---- Knife slash: wind up, a fast diagonal cut across the screen, follow through; forehand and backhand alternate ----
    if (knife && this.slashT < 1) {
      this.slashT = Math.min(1, this.slashT + dt / 0.34);
      const keys = this.slashDir > 0 ? SLASH : BACKHAND, t = this.slashT;
      let i = 0;
      while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
      const [t0, p0, r0] = keys[i], [t1, p1, r1] = keys[i + 1], k = ease(Math.min(1, (t - t0) / (t1 - t0)));
      const at = (a: number[], b: number[], j: number) => a[j] + (b[j] - a[j]) * k;
      pos.set(at(p0, p1, 0), at(p0, p1, 1), at(p0, p1, 2));
      rx = at(r0, r1, 0); ry = at(r0, r1, 1); rz = at(r0, r1, 2);
    }
    // ---- Reload choreography (left hand pulls and seats the magazine) ----
    let leftTarget: THREE.Vector3 | undefined;
    const mag = fit.magModel ? this.mags.get(fit.magModel) : undefined;
    if (mag) mag.visible = false;
    if (p.reloadLeft > 0 && !knife) {
      const t = 1 - p.reloadLeft / p.reloadTotal;
      const tilt = Math.sin(Math.min(1, t * 1.2) * Math.PI);
      rz += tilt * 0.5; rx += tilt * 0.25; ry += tilt * -0.3; pos.y -= tilt * 0.03; pos.x -= tilt * 0.03;
      const magSpot = g(fit.mag), out = magSpot.clone().add(new THREE.Vector3(-0.08, -0.3, 0.1));
      if (t < 0.22) leftTarget = new THREE.Vector3().lerpVectors(g(fit.fore), magSpot, ease(t / 0.22));
      else if (t < 0.48) leftTarget = new THREE.Vector3().lerpVectors(magSpot, out, ease((t - 0.22) / 0.26));
      else if (t < 0.74) leftTarget = new THREE.Vector3().lerpVectors(out, magSpot, ease((t - 0.48) / 0.26));
      else leftTarget = new THREE.Vector3().lerpVectors(magSpot, g(fit.fore), ease((t - 0.74) / 0.26));
      if (t > 0.72 && t < 0.76) this.kickBack.velocity += 0.5;
    }
    // ---- Equip raise and grenade throw ----
    const e = ease(this.equipT);
    rx -= (1 - e) * 1.1; pos.y -= (1 - e) * 0.18;
    let throwing = 0;
    if (p.throwLeft > 0) { throwing = 1 - p.throwLeft / 0.32; pos.y -= Math.sin(throwing * Math.PI) * 0.14; rx -= Math.sin(throwing * Math.PI) * 0.5; }

    this.rig.position.set(pos.x + bx + sx * 0.02, pos.y + by + breathe + sy * 0.015, pos.z + back * 0.05);
    this.rig.rotation.set(rx + kick * 0.06 + sy * 0.05, ry + sx * 0.06, rz + roll * 0.04 + sx * 0.05, 'YXZ');
    this.gun.position.copy(g(fit.grip)).multiplyScalar(-1);
    this.root.updateMatrixWorld(true);

    // ---- Arms: IK onto the grip and handguard ----
    const bones = this.arms.bones;
    restorePose(bones, this.arms.bindPose);
    this.arms.root.updateMatrixWorld(true);
    const gunMatrix = this.gun.matrixWorld;
    const gripW = g(fit.grip).applyMatrix4(gunMatrix);
    let foreW = (leftTarget ?? g(fit.fore)).clone().applyMatrix4(gunMatrix);
    const gunFwd = new THREE.Vector3(0, 0, -1).transformDirection(gunMatrix);
    const gunUp = new THREE.Vector3(0, 1, 0).transformDirection(gunMatrix);
    const gunRight = new THREE.Vector3(1, 0, 0).transformDirection(gunMatrix);
    // The knife leaves the support hand free: it hangs low, out of the way.
    if (knife) foreW = new THREE.Vector3(-0.24, -0.52 + Math.sin(this.time * 1.6) * 0.004, -0.16);
    if (p.throwLeft > 0) foreW = new THREE.Vector3(-0.2, -0.08 + Math.sin(throwing * Math.PI) * 0.25, -0.3 - throwing * 0.25);
    if (knife) solveArm(bones, 'r', gripW.clone().addScaledVector(gunFwd, -0.07).addScaledVector(gunUp, -0.02).addScaledVector(gunRight, 0.02), new THREE.Vector3(0.6, -0.7, 0.2));
    else solveArm(bones, 'r', gripW.clone().addScaledVector(gunRight, 0.03).addScaledVector(gunUp, -0.02), new THREE.Vector3(0.6, -0.7, 0.2));
    solveArm(bones, 'l', foreW.clone().addScaledVector(gunFwd, -0.05).addScaledVector(gunUp, -0.07).addScaledVector(gunRight, -0.025), new THREE.Vector3(-0.7, -0.6, -0.1));
    // A knife is held in a fist, wrist behind the handle; guns with the wrist under the grip.
    orientHand(bones, 'r', gunFwd.clone().addScaledVector(gunUp, knife ? -0.3 : -1.1).normalize(), gunRight.clone().negate());
    if (p.throwLeft > 0) orientHand(bones, 'l', new THREE.Vector3(0.2, 0.6, -1).normalize(), new THREE.Vector3(0.6, 0, -0.4));
    else if (knife) orientHand(bones, 'l', new THREE.Vector3(0.2, -0.6, -0.8).normalize(), new THREE.Vector3(1, 0, 0));
    else if (pistol && !leftTarget) orientHand(bones, 'l', gunFwd.clone().addScaledVector(gunUp, -0.9).normalize(), gunRight);
    else orientHand(bones, 'l', gunFwd.clone().addScaledVector(gunRight, 0.5).addScaledVector(gunUp, 0.3).normalize(), gunUp.clone().add(gunRight).normalize());
    curlFingers(bones, 'r', knife ? 0.9 : 0.62, 0.55);
    curlFingers(bones, 'l', leftTarget ? 0.75 : knife ? 0.3 : 0.62, 0.45);

    // ---- Held objects ----
    const lh = bones.get('hand_l')!;
    if (mag && p.reloadLeft > 0) {
      const t = 1 - p.reloadLeft / p.reloadTotal;
      if (t > 0.2 && t < 0.76) { mag.visible = true; lh.getWorldPosition(mag.position).add(new THREE.Vector3(0.02, -0.05, -0.04)); mag.quaternion.copy(this.gun.getWorldQuaternion(new THREE.Quaternion())); mag.rotateY(-Math.PI / 2); }
    }
    this.grenade.visible = p.throwLeft > 0;
    if (this.grenade.visible) lh.getWorldPosition(this.grenade.position).add(new THREE.Vector3(0.02, 0.03, -0.06));

    this.flashLeft -= dt;
    this.flash.visible = this.flashLeft > 0 && !(this.overlay && p.ads > 0.95);
    // Full-screen eyepiece option: scoped weapons hide the model at full zoom (the HUD draws it); binoculars hide it entirely.
    this.scopeVisible = !!this.overlay && settings.scopeMode === 'overlay' && p.ads > 0.92 && !p.binoculars;
    this.root.visible = !this.scopeVisible && !p.binoculars;
    // Picture-in-picture: the lens shows the world at the optic's magnification once it is raised to the eye.
    const lens = this.fit.lens, sight = this.fit.sight;
    if (lens && sight) {
      const active = settings.scopeMode === 'pip' && this.root.visible ? Math.max(0, Math.min(1, (ads - 0.55) / 0.35)) : 0;
      (lens.material as THREE.ShaderMaterial).uniforms.uActive.value = active;
      if (active > 0) {
        const w = p.weapon, tanHalf = Math.tan(opticFov(w) * Math.PI / 360) / (p.zoomLevel && w.class === 'sniper' ? 2 : 1);
        requestScope({ lens, sight, tanHalf, size: settings.opticDetail === 'high' ? 768 : 512 });
      }
    }
    if (this.fit.laser) this.fit.laser.visible = sprint < 0.5 && lowered < 0.5;
    this.torch.intensity = this.fit.torch && p.alive && !p.binoculars ? 70 : 0;
  }
}

function makeFlash() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,240,1)'); grad.addColorStop(0.25, 'rgba(255,220,140,0.9)'); grad.addColorStop(0.6, 'rgba(255,140,40,0.35)'); grad.addColorStop(1, 'rgba(255,100,0,0)');
  ctx.fillStyle = grad;
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
