/**
 * Dev-only trailer prop (`?trailer`, loaded by src/game/trailer.ts): a SWAT soldier free-soloing the
 * outside of Taipei 101 on the Xinyi map, a tribute to Alex Honnold's 2025 free solo. It is not in
 * the game: no rules, collision or simulation are involved. The game's soldier rig is posed by hand
 * every frame: a four-limb climbing cycle (right hand, left foot, left hand, right foot) with two-bone
 * IK onto holds on the glass, the body leaning with the facade's flare, the rifle slung across the back,
 * a puff of chalk when a hand lands. `stand` puts him on the terrace at the top of the eighth segment.
 */
import * as THREE from 'three';
import { TOWER, TOWER_LOFTS } from '../../shared/maps/xinyi-data';
import { WEAPONS } from '../../shared/weapons';
import type { Assets } from '../assets';
import { aimBone, curlFingers, orientHand, rotateWorld, solveArm, type Bones } from '../render/rig';
import { SoldierView } from '../render/soldier';
import { vehicleModel } from '../render/vehicles';

/** The tower's centre in the Xinyi map (the map is centred on its playable area). */
const CX = TOWER.cx - (655 + 925) / 2, CZ = TOWER.cz - (62 + 350) / 2;

/** Half-width of the tower's square section at height y (the facade, ignoring the corner notches). */
export function towerHalf(y: number) {
  for (const [y0, y1, h0, , h1] of TOWER_LOFTS) if (y1 > y0 && y >= y0 && y <= y1) return h0 + (h1 - h0) * (y - y0) / (y1 - y0);
  return TOWER.segHalf0;
}

/** The climbed face: the west one (the low golden-hour sun lights it), a few metres in from a corner. */
const FACE_Z = CZ + 13;
/** World x of the west facade's glass at height y. */
export const wallX = (y: number) => CX - towerHalf(y);
/** The terrace at the top of the eighth segment (the crown's base): where the climb tops out. */
export const TOP = 388.18;

const STEP = 0.62;           // metres gained per cycle
const ease = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));

/** Limbs: [side, kind, move window within the cycle, lowest height of its hold above the feet origin]. */
const LIMBS = [
  ['r', 'hand', [0.0, 0.2], 1.42], ['l', 'foot', [0.25, 0.42], 0.06],
  ['l', 'hand', [0.5, 0.7], 1.42], ['r', 'foot', [0.75, 0.92], 0.06],
] as const;

export class Climber {
  readonly view: SoldierView;
  private bones: Bones;
  private rifle: THREE.Object3D;
  private puffs: { mesh: THREE.Mesh; age: number }[] = [];
  private landed = new Map<string, number>();
  /** Height of the feet origin. */
  y = 300;
  /** Climbing cycles done (drives the limbs). */
  cycle = 0;
  /** 'climb' on the glass, or 'stand' on the terrace. */
  mode: 'climb' | 'stand' = 'climb';
  /** Head turn while standing (radians toward the camera side). */
  look = 0;
  heli?: { root: THREE.Object3D; rotor?: THREE.Object3D; blur?: THREE.Mesh; spin: number };

  constructor(private assets: Assets, private scene: THREE.Scene) {
    this.view = new SoldierView(assets, 0);
    this.view.root.rotation.order = 'YXZ';
    this.bones = (this.view as unknown as { bones: Bones }).bones;
    this.rifle = assets.weapons.get(WEAPONS.m4a1.model)!.clone();
    this.rifle.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    scene.add(this.view.root, this.view.gun, this.rifle);
  }

  dispose() {
    this.view.dispose(); this.view.gun.removeFromParent(); this.rifle.removeFromParent();
    for (const p of this.puffs) p.mesh.removeFromParent();
    this.heli?.root.removeFromParent();
  }

  /** Where the climber's chest is (camera targets). */
  chest() { return this.bones.get('spine_03')!.getWorldPosition(new THREE.Vector3()); }
  feet() { return this.view.root.position.clone(); }

  /** A helicopter (the game's model) hovering at a point, rotor turning. */
  setHeli(at: THREE.Vector3 | null, yaw = 0) {
    if (!at) { this.heli?.root.removeFromParent(); this.heli = undefined; return; }
    if (!this.heli) { const m = vehicleModel('heli'); this.heli = { ...m, spin: 0 }; this.scene.add(m.root); }
    this.heli.root.position.copy(at); this.heli.root.rotation.set(0, yaw, 0);
  }

  update(dt: number, climbRate: number) {
    if (this.mode === 'climb') { this.cycle += dt * climbRate; this.y += dt * climbRate * STEP; }
    const yaw = -Math.PI / 2;                        // facing +x, into the west face
    const into = new THREE.Vector3(1, 0, 0), right = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0);
    if (this.mode === 'stand') {
      // On the terrace, rifle up at low ready, looking out over the city.
      const x = wallX(TOP - 0.05) + 1.4;
      this.view.update(dt, { x, y: TOP, z: FACE_Z, vx: 0, vy: 0, vz: 0, yaw: Math.PI / 2 - this.look, pitch: -0.05, crouch: 0, grounded: true, sprint: false, ads: false, slide: false, alive: true, weapon: 'm4a1', reloading: 0, firing: false });
      this.view.root.rotation.x = 0;
      this.rifle.visible = false;
      this.updateProps(dt);
      return;
    }
    // ---- On the glass ----
    const wall = wallX(this.y + 1.1);
    // The segment flares outward going up: lean the body back with it, plus a little.
    const flare = Math.atan2(towerHalf(this.y + 2) - towerHalf(this.y), 2);
    this.view.update(dt, { x: wall - 0.5, y: this.y, z: FACE_Z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0.5, crouch: 0, grounded: true, sprint: false, ads: false, slide: false, alive: true, weapon: 'knife', reloading: 0, firing: false });
    this.view.gun.visible = false;
    const root = this.view.root;
    root.position.set(wall - 0.47, this.y, FACE_Z);
    root.rotation.set(0.12 + flare, yaw, 0);
    root.updateMatrixWorld(true);
    // Chest close to the glass, head up toward the next hold.
    const spine2 = this.bones.get('spine_02')!, spine3 = this.bones.get('spine_03')!, neck = this.bones.get('neck_01')!;
    rotateWorld(spine2, right, -0.12); rotateWorld(spine3, right, -0.1); rotateWorld(neck, right, 0.35);

    for (const [side, kind, [a, b], base] of LIMBS) {
      const k = Math.floor(this.cycle - a), frac = this.cycle - a - k, span = b - a;
      const u = clamp01(frac / span), moving = frac < span;
      // Holds stay put on the glass while the body rises past them, then the limb moves one step up.
      const hold = this.y - this.cycle * STEP + base + STEP * (k + ease(u));
      const lateral = (side === 'r' ? 1 : -1) * (kind === 'hand' ? 0.34 : 0.2);
      const out = (kind === 'hand' ? 0.02 : 0.08) + (moving ? Math.sin(Math.PI * u) * 0.14 : 0);
      const target = new THREE.Vector3(wallX(hold) - out, hold, FACE_Z + lateral);
      if (kind === 'hand') {
        const pole = target.clone().add(new THREE.Vector3(-0.5, -0.7, lateral * 1.5));
        solveArm(this.bones, side, target, pole);
        orientHand(this.bones, side, up.clone().addScaledVector(into, 0.15).normalize(), into);
        curlFingers(this.bones, side, moving ? 0.25 : 0.7, 0.35);
        // Chalk: a puff where a hand lands.
        const key = `${side}${kind}`;
        if (!moving && this.landed.get(key) !== k) { this.landed.set(key, k); this.puff(target); }
      } else {
        const pole = target.clone().add(new THREE.Vector3(-0.8, 0.5, lateral));
        solveLeg(this.bones, side, target, pole);
        const foot = this.bones.get(`foot_${side}`)!, ball = this.bones.get(`ball_${side}`);
        if (ball) aimBone(foot, ball, target.clone().addScaledVector(into, 0.25).add(new THREE.Vector3(0, -0.05, 0)));
      }
    }
    this.updateRifle(into, up);
    this.updateProps(dt);
  }

  /** The rifle slung across the back, muzzle up over the right shoulder. */
  private updateRifle(into: THREE.Vector3, up: THREE.Vector3) {
    const spine3 = this.bones.get('spine_03')!;
    const back = into.clone().negate();
    const center = spine3.getWorldPosition(new THREE.Vector3()).addScaledVector(back, 0.2).addScaledVector(up, -0.05);
    const barrel = new THREE.Vector3(0, 0.82, 0.5).normalize();
    const x = barrel.clone().negate(), y = back, z = new THREE.Vector3().crossVectors(x, y).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, new THREE.Vector3().crossVectors(z, x), z));
    this.rifle.visible = true;
    this.rifle.quaternion.copy(q);
    this.rifle.position.copy(center);
  }

  private puff(at: THREE.Vector3) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), new THREE.MeshBasicMaterial({ color: 0xf4f1ea, transparent: true, opacity: 0.3, depthWrite: false }));
    mesh.position.copy(at).add(new THREE.Vector3(-0.05, 0.02, 0));
    this.scene.add(mesh);
    this.puffs.push({ mesh, age: 0 });
  }

  private updateProps(dt: number) {
    for (const p of this.puffs) {
      p.age += dt;
      const s = 1 + p.age * 4;
      p.mesh.scale.setScalar(s);
      p.mesh.position.y += dt * 0.15; p.mesh.position.x -= dt * 0.1;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.16 * (1 - p.age / 0.8));
    }
    this.puffs = this.puffs.filter(p => { if (p.age < 0.8) return true; p.mesh.removeFromParent(); return false; });
    if (this.heli) {
      this.heli.spin += dt * 38;
      if (this.heli.rotor) this.heli.rotor.rotation.y = this.heli.spin;
      if (this.heli.blur) (this.heli.blur.material as THREE.MeshBasicMaterial).opacity = 0.22;
    }
  }
}

/** Two-bone IK for a leg (thigh, calf, foot), the knee bending toward `pole`. */
function solveLeg(bones: Bones, side: 'l' | 'r', target: THREE.Vector3, pole: THREE.Vector3) {
  const upper = bones.get(`thigh_${side}`), lower = bones.get(`calf_${side}`), foot = bones.get(`foot_${side}`);
  if (!upper || !lower || !foot) return;
  const s = upper.getWorldPosition(new THREE.Vector3()), e = lower.getWorldPosition(new THREE.Vector3()), h = foot.getWorldPosition(new THREE.Vector3());
  const a = s.distanceTo(e), b = e.distanceTo(h);
  const toTarget = target.clone().sub(s);
  const d = Math.max(0.05, Math.min(toTarget.length(), a + b - 0.002));
  const dir = toTarget.normalize();
  const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const toPole = pole.clone().sub(s);
  const perp = toPole.sub(dir.clone().multiplyScalar(toPole.dot(dir))).normalize();
  const knee = s.clone().addScaledVector(dir, cosA * a).addScaledVector(perp, sinA * a);
  aimBone(upper, lower, knee);
  aimBone(lower, foot, s.clone().addScaledVector(dir, d));
}
