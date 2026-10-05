import { CollisionWorld } from '../../shared/collision';
import { clamp, dirFromAngles, type Vec3 } from '../../shared/math';
import { MOVE, createMoveState, eyeHeight, isSprinting, stepMovement, type MoveEvents, type MoveInput, type MoveState } from '../../shared/movement';
import type { Soldier } from '../../shared/match/state';
import { GRENADE, WEAPONS, pelletCone, type LoadoutId, type WeaponDef, type WeaponId } from '../../shared/weapons';
import type { Input } from './input';
import { adsFov, settings } from './settings';

const STEP = 1 / 120;
const DEG = Math.PI / 180;

export interface FrameResult {
  shots: { origin: Vec3; dir: Vec3; weapon: WeaponDef }[];
  grenade?: { origin: Vec3; dir: Vec3 };
  reloadStarted: boolean;
  switched: boolean;
  dryFire: boolean;
  move: MoveEvents;
}

/**
 * The lawbreaker you control: client-predicted movement (the same shared controller the server
 * validates against), weapon handling, recoil and spread, plus camera feel state.
 */
export class LocalPlayer {
  m: MoveState = createMoveState(0, 0, 0);
  private prev = { x: 0, y: 0, z: 0, crouch: 0 };
  private accumulator = 0;
  yaw = 0;
  pitch = 0;
  team = 0;
  loadout: LoadoutId = 'assault';
  slot: 0 | 1 = 0;
  /** Weapons in the primary/secondary slots (kit, bought or picked up; the host decides). */
  weapons: [WeaponId, WeaponId] = ['carbine', 'sidearm'];
  ammo: [number, number] = [30, 14];
  /** Spare rounds per slot as last reported by the host. */
  reserve: [number, number] = [0, 0];
  reloadLeft = 0;
  reloadTotal = 1;
  switchLeft = 0;
  fireCooldown = 0;
  bloom = 0;
  ads = 0;
  grenades = GRENADE.perLife;
  throwLeft = 0;
  alive = false;
  sprinting = false;
  private sprintBlock = 0;
  /** Sprint-to-fire delay: the weapon has to come back up before it can shoot. */
  private sprintRecover = 0;
  private triggerHeld = false;
  private shotsInBurst = 0;
  private sinceShot = 9;
  private recoilDebt = 0;
  /** Visual-only camera offsets (radians) and feel state. */
  punchPitch = 0;
  punchYaw = 0;
  punchVel = 0;
  landDip = 0;
  stepOffset = 0;
  shake = 0;
  bobPhase = 0;
  sensitivity = 0.0022;

  get weapon(): WeaponDef { return WEAPONS[this.weapons[this.slot]]; }
  get reloading() { return this.reloadLeft > 0; }

  spawnFrom(s: Soldier) {
    this.m = { ...s.m, vx: 0, vy: 0, vz: 0 };
    this.prev = { x: s.m.x, y: s.m.y, z: s.m.z, crouch: s.m.crouch };
    this.yaw = s.yaw; this.pitch = 0; this.team = s.team; this.loadout = s.loadout; this.slot = 0;
    this.weapons = [...s.weapons]; this.reserve = [...s.reserve];
    this.ammo = [WEAPONS[s.weapons[0]].magazine, WEAPONS[s.weapons[1]].magazine];
    this.reloadLeft = 0; this.switchLeft = WEAPONS[s.weapons[0]].equipTime; this.fireCooldown = 0; this.bloom = 0; this.ads = 0;
    this.grenades = GRENADE.perLife; this.alive = true; this.recoilDebt = 0; this.accumulator = 0;
  }

  /**
   * Follow the host's gear: a bought or picked-up weapon arrives with a full magazine and brings
   * itself up; spare ammo follows the host (reloads and ammo pickups), except mid-reload.
   */
  syncGear(s: Soldier) {
    for (const i of [0, 1] as const) {
      if (s.weapons[i] === this.weapons[i]) continue;
      this.weapons[i] = s.weapons[i]; this.ammo[i] = WEAPONS[s.weapons[i]].magazine;
      this.slot = i; this.reloadLeft = 0; this.switchLeft = WEAPONS[s.weapons[i]].equipTime; this.bloom = 0; this.ads = 0;
    }
    if (this.reloadLeft <= 0) this.reserve = [...s.reserve];
  }

  /** Snap to the server's position after a rejected movement report. */
  correct(s: Soldier) { this.m = { ...this.m, x: s.m.x, y: s.m.y, z: s.m.z, vx: 0, vy: 0, vz: 0 }; this.prev = { x: s.m.x, y: s.m.y, z: s.m.z, crouch: this.m.crouch }; }

  /** Interpolated feet position for rendering between fixed physics steps. */
  renderPos(): Vec3 & { crouch: number } {
    const a = this.accumulator / STEP;
    return {
      x: this.prev.x + (this.m.x - this.prev.x) * a, y: this.prev.y + (this.m.y - this.prev.y) * a,
      z: this.prev.z + (this.m.z - this.prev.z) * a, crouch: this.prev.crouch + (this.m.crouch - this.prev.crouch) * a,
    };
  }

  eye(): Vec3 { const p = this.renderPos(); return { x: p.x, y: p.y + eyeHeight(p) + this.stepOffset - this.landDip, z: p.z }; }
  aimDir(): Vec3 { return dirFromAngles(this.yaw, this.pitch); }

  update(dt: number, input: Input | undefined, world: CollisionWorld, active: boolean, blockFire: boolean): FrameResult {
    const result: FrameResult = { shots: [], reloadStarted: false, switched: false, dryFire: false, move: { jumped: false, landed: 0, slideStarted: false, stepped: 0 } };
    const can = active && this.alive && !!input;
    // ---- Look ----
    if (can) {
      const look = input!.consumeLook();
      const zoom = adsFov(this.weapon) / settings.fov;
      const sens = this.sensitivity * input!.sensitivity * (1 - this.ads * (1 - zoom * 1.05));
      this.yaw -= look.x * sens;
      this.pitch = clamp(this.pitch - look.y * sens, -1.48, 1.48);
    } else input?.consumeLook();

    // ---- Weapon timers ----
    const w = this.weapon;
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.switchLeft = Math.max(0, this.switchLeft - dt);
    this.sprintBlock = Math.max(0, this.sprintBlock - dt);
    this.sinceShot += dt;
    this.bloom = Math.max(0, this.bloom - w.spread.recovery * dt * (this.sinceShot > 0.08 ? 1 : 0.25));
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        this.reloadLeft = 0;
        const take = Math.min(w.magazine - this.ammo[this.slot], this.reserve[this.slot]);
        this.ammo[this.slot] += take; this.reserve[this.slot] -= take;
      }
    }

    // ---- Movement (fixed 120 Hz using the shared controller) ----
    const wantsFire = can && input!.fire && !blockFire;
    if (wantsFire) this.sprintBlock = 0.2;
    const moveInput: MoveInput = can ? {
      forward: Number(input!.down('KeyW')) - Number(input!.down('KeyS')),
      strafe: Number(input!.down('KeyD')) - Number(input!.down('KeyA')),
      yaw: this.yaw, jump: input!.down('Space'), crouch: input!.down('KeyC') || input!.down('ControlLeft'),
      sprint: (input!.down('ShiftLeft') || input!.down('ShiftRight')) && this.sprintBlock <= 0 && this.reloadLeft <= 0,
      ads: input!.aim && this.reloadLeft <= 0 && this.switchLeft < 0.1,
    } : { forward: 0, strafe: 0, yaw: this.yaw, jump: false, crouch: false, sprint: false, ads: false };
    if (this.alive) {
      this.accumulator += Math.min(dt, 0.1);
      while (this.accumulator >= STEP) {
        this.prev = { x: this.m.x, y: this.m.y, z: this.m.z, crouch: this.m.crouch };
        const e = stepMovement(world, this.m, moveInput, STEP, this.team);
        result.move.jumped ||= e.jumped; result.move.slideStarted ||= e.slideStarted;
        result.move.landed = Math.max(result.move.landed, e.landed); result.move.stepped += e.stepped;
        this.accumulator -= STEP;
      }
    }
    this.sprinting = this.alive && isSprinting(this.m, moveInput) && this.m.grounded;
    this.sprintRecover = this.sprinting ? 0.14 : Math.max(0, this.sprintRecover - dt);
    const adsTarget = moveInput.ads && !this.sprinting && this.alive ? 1 : 0;
    this.ads = clamp(this.ads + Math.sign(adsTarget - this.ads) * dt / w.adsTime, 0, 1);

    // ---- Weapon actions ----
    if (can) {
      if ((input!.take('KeyQ') || input!.consumeWheel() !== 0) && this.throwLeft <= 0) this.swap(result);
      if (input!.take('KeyR')) this.startReload(result);
      if (input!.take('KeyG') && this.grenades > 0 && this.throwLeft <= 0 && this.reloadLeft <= 0) { this.throwLeft = 0.32; this.grenades--; }
    }
    if (this.throwLeft > 0) {
      this.throwLeft -= dt;
      if (this.throwLeft <= 0) result.grenade = { origin: this.eye(), dir: dirFromAngles(this.yaw, this.pitch + 0.06) };
    }

    const trigger = wantsFire && !this.sprinting && this.sprintRecover <= 0 && this.throwLeft <= 0;
    if (!trigger) { this.triggerHeld = false; this.shotsInBurst = 0; }
    if (trigger && this.switchLeft <= 0 && this.reloadLeft <= 0 && this.fireCooldown <= 0 && (w.auto || !this.triggerHeld)) {
      if (this.ammo[this.slot] <= 0) {
        if (!this.triggerHeld) result.dryFire = true;
        this.startReload(result);
      } else {
        this.ammo[this.slot]--;
        this.fireCooldown += w.interval;
        if (this.fireCooldown < 0) this.fireCooldown = w.interval;
        // Pellet weapons fire a fixed pattern around the exact aim (the server re-traces it), and
        // launcher charges leave straight down the sights; everything else samples the spread cone.
        const spread = w.pellets > 1 || w.projectile ? 0 : this.currentSpread() * DEG;
        // Uniform disc sampling inside the cone.
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
        const dir = dirFromAngles(this.yaw + Math.cos(a) * r, this.pitch + Math.sin(a) * r);
        result.shots.push({ origin: this.eye(), dir, weapon: w });
        this.kick(w);
        this.bloom = Math.min(w.spread.bloomMax, this.bloom + w.spread.bloomPerShot);
        this.sinceShot = 0; this.shotsInBurst++;
      }
      this.triggerHeld = true;
    }
    if (this.fireCooldown < 0) this.fireCooldown = 0;

    // ---- Recoil recovery & camera feel ----
    if (this.sinceShot > 0.12 && this.recoilDebt > 0) {
      const back = Math.min(this.recoilDebt, this.recoilDebt * (1 - Math.exp(-w.recoil.recover * dt)));
      this.pitch -= back * 0.72; this.recoilDebt -= back;
    }
    // Spring the view punch back to rest.
    this.punchVel += (-this.punchPitch * 220 - this.punchVel * 22) * dt;
    this.punchPitch += this.punchVel * dt;
    this.punchYaw *= Math.exp(-dt * 14);
    if (result.move.landed > 3) this.landDip = Math.min(0.32, this.landDip + result.move.landed * 0.022);
    this.landDip *= Math.exp(-dt * 9);
    if (result.move.stepped > 0) this.stepOffset -= result.move.stepped;
    this.stepOffset *= Math.exp(-dt * 16);
    this.shake *= Math.exp(-dt * 6);
    const speed = Math.hypot(this.m.vx, this.m.vz);
    if (this.m.grounded && this.m.slideTime <= 0) this.bobPhase += dt * speed * (this.sprinting ? 1.5 : 1.75);
    return result;
  }

  currentSpread() {
    const w = this.weapon;
    if (w.pellets > 1) return pelletCone(w, this.ads > 0.5);
    const moving = Math.hypot(this.m.vx, this.m.vz) > 1.5;
    let s = w.spread.hip + (w.spread.ads - w.spread.hip) * this.ads;
    if (moving) s += w.spread.moving * (1 - this.ads * 0.65);
    if (!this.m.grounded) s += w.spread.air;
    if (this.m.crouch > 0.5 && !moving) s *= 0.7;
    return s + this.bloom * (1 - this.ads * 0.6);
  }

  private kick(w: WeaponDef) {
    const ads = 1 - this.ads * 0.35;
    const pitchKick = w.recoil.pitch * DEG * (0.85 + Math.random() * 0.3) * ads * (this.m.crouch > 0.5 ? 0.8 : 1);
    const pattern = w.recoil.pattern[this.shotsInBurst % w.recoil.pattern.length];
    const yawKick = (pattern + (Math.random() - 0.5) * 0.6) * w.recoil.yaw * DEG * ads;
    this.pitch = Math.min(1.48, this.pitch + pitchKick);
    this.yaw -= yawKick;
    this.recoilDebt += pitchKick;
    this.punchVel += w.recoil.viewPunch * 0.9;
    this.punchYaw += (Math.random() - 0.5) * w.recoil.viewPunch * 0.01;
  }

  private swap(result: FrameResult) {
    this.slot = this.slot === 0 ? 1 : 0;
    this.reloadLeft = 0; this.switchLeft = this.weapon.equipTime; this.bloom = 0; this.ads = 0;
    result.switched = true;
  }

  startReload(result?: FrameResult) {
    const w = this.weapon;
    if (this.reloadLeft > 0 || this.ammo[this.slot] >= w.magazine || this.switchLeft > 0 || this.reserve[this.slot] <= 0) return;
    this.reloadLeft = this.reloadTotal = w.reload;
    if (result) result.reloadStarted = true;
  }

  /** Movement report for the server. */
  report() {
    return {
      x: this.m.x, y: this.m.y, z: this.m.z, vx: this.m.vx, vy: this.m.vy, vz: this.m.vz, yaw: this.yaw, pitch: this.pitch,
      crouch: this.m.crouch, grounded: this.m.grounded, sprint: this.sprinting, ads: this.ads > 0.5, slide: this.m.slideTime > 0, weapon: this.slot,
    };
  }

  speed() { return Math.hypot(this.m.vx, this.m.vz); }
  slideFactor() { return this.m.slideTime > 0 ? 1 : 0; }
}

export { MOVE };
