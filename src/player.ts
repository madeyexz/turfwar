import { Vector3 } from 'three';
import { groundHeight, MAP_EDGE, maps, segmentBox, type BattleMap } from './battlefield';

export class Player {
  position = new Vector3();
  velocity = new Vector3();
  yaw = 0;
  pitch = 0;
  verticalSpeed = 0;
  grounded = true;
  crouching = false;
  aiming = false;
  sprinting = false;
  health = 100;
  shield = 100;
  ammo = 30;
  reloadLeft = 0;
  fireLeft = 0;
  sinceHit = 10;
  map: BattleMap = maps[0];
  constructor() { this.reset(this.map); }
  reset(map: BattleMap) {
    this.map = map; this.position.set(0, groundHeight(0, 48, map) + 1.75, 48);
    this.velocity.set(0, 0, 0); this.yaw = 0; this.pitch = 0; this.verticalSpeed = 0;
    this.health = 100; this.shield = 100; this.ammo = 30; this.reloadLeft = 0; this.fireLeft = 0;
    this.sinceHit = 10; this.aiming = false; this.crouching = false; this.grounded = true;
  }
  reload() { if (!this.reloadLeft && this.ammo < 30 && this.health > 0) this.reloadLeft = 1.65; }
  fire() {
    if (this.health <= 0 || this.reloadLeft > 0 || this.fireLeft > 0 || this.sprinting) return false;
    if (!this.ammo) { this.reload(); return false; }
    this.ammo--; this.fireLeft = .12; return true;
  }
  damage(amount: number) {
    const absorbed = Math.min(this.shield, amount);
    this.shield -= absorbed; this.health = Math.max(0, this.health - amount + absorbed); this.sinceHit = 0;
  }
  update(dt: number, keys: Set<string>, active: boolean) {
    const previous = this.position.clone();
    this.fireLeft = Math.max(0, this.fireLeft - dt);
    if (this.reloadLeft > 0) { this.reloadLeft = Math.max(0, this.reloadLeft - dt); if (this.reloadLeft === 0) this.ammo = 30; }
    this.sinceHit += dt;
    if (this.sinceHit > 4 && this.health > 0) this.shield = Math.min(100, this.shield + dt * 18);
    this.sprinting = false;
    if (active && this.health > 0) {
      const feet = this.position.y - (this.crouching ? 1.1 : 1.75);
      this.crouching = keys.has('ControlLeft') || keys.has('KeyC');
      const eye = this.crouching ? 1.1 : 1.75;
      this.position.y = feet + eye;
      this.sprinting = keys.has('ShiftLeft') && !this.aiming && !this.crouching && keys.has('KeyW');
      const speed = this.crouching ? 2.8 : this.aiming ? 3.3 : this.sprinting ? 10 : 6;
      const input = new Vector3(Number(keys.has('KeyD')) - Number(keys.has('KeyA')), 0, Number(keys.has('KeyS')) - Number(keys.has('KeyW'))).normalize().applyAxisAngle(new Vector3(0, 1, 0), this.yaw).multiplyScalar(speed * dt);
      // Axis-separated sweeps slide against solid walls rather than teleporting through them.
      for (const axis of ['x', 'z'] as const) {
        const next = this.position.clone(); next[axis] = Math.max(-MAP_EDGE, Math.min(MAP_EDGE, next[axis] + input[axis]));
        const from = { x: this.position.x, y: feet, z: this.position.z };
        const to = { x: next.x, y: feet, z: next.z };
        if (!this.map.structures.some(b => feet < -3.25 + b.h - .1 && segmentBox(from, to, b, .35))) this.position[axis] = next[axis];
      }
      if (keys.has('Space') && this.grounded) { this.verticalSpeed = 6.5; this.grounded = false; }
      this.verticalSpeed -= 18 * dt;
      let ground = groundHeight(this.position.x, this.position.z, this.map) + eye;
      for (const b of this.map.structures) {
        const top = -3.25 + b.h;
        if (Math.abs(this.position.x - b.x) < b.w / 2 + .35 && Math.abs(this.position.z - b.z) < b.d / 2 + .35 && feet >= top - .1) ground = Math.max(ground, top + eye);
      }
      this.position.y += this.verticalSpeed * dt;
      this.grounded = this.position.y <= ground;
      if (this.grounded) { this.position.y = ground; this.verticalSpeed = 0; }
    }
    this.velocity.copy(this.position).sub(previous).divideScalar(dt || 1);
  }
}
