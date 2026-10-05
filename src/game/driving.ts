import * as THREE from 'three';
import type { CollisionWorld } from '../../shared/collision';
import { clamp, dirFromAngles, wrapAngle } from '../../shared/math';
import { eyeHeight } from '../../shared/movement';
import type { VehicleReport } from '../../shared/match/state';
import { VEHICLES, seatPosition, stepVehicle, type Vehicle, type VehicleEvents, type VehicleInput } from '../../shared/vehicles';
import type { Input } from './input';

const STEP = 1 / 120;
/** Chase camera per kind: height of the look-at point above the body and distance behind it. */
const CHASE = { car: { up: 1.7, back: 6.4 }, scooter: { up: 1.5, back: 4.2 }, heli: { up: 2.4, back: 12.5 } } as const;
const hit = new THREE.Vector3();

/**
 * The vehicle we drive: keyboard to controls (W/S throttle and brake, A/D steer, Space handbrake;
 * the helicopter climbs on Space, descends on C or Ctrl and turns to the mouse), client-side
 * prediction with the shared physics at 120 Hz, reports for the host, and the chase camera (V
 * switches to the driver's seat). The host validates every report like soldier movement.
 */
export class Driving {
  /** Predicted vehicle while we hold its driver's seat. */
  v?: Vehicle;
  private prev?: Vehicle;
  private accumulator = 0;
  /** Camera orbit: yaw relative to the body (cars, scooters) or absolute (helicopter), and pitch. */
  camYaw = 0;
  camPitch = -0.18;
  /** V: from the driver's seat instead of behind. */
  firstPerson = false;
  private lookIdle = 0;
  sensitivity = 0.0022;

  get active() { return !!this.v; }

  begin(v: Vehicle) {
    this.v = { ...v };
    this.prev = { ...v };
    this.accumulator = 0;
    this.camYaw = v.kind === 'heli' ? v.yaw : 0;
    this.camPitch = v.kind === 'heli' ? -0.22 : -0.16;
    this.lookIdle = 0;
  }

  end() { this.v = undefined; this.prev = undefined; }

  /** The host rejected a report: take its pose. */
  snap(v: Vehicle) {
    if (!this.v) return;
    Object.assign(this.v, { x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy, vz: v.vz, yaw: v.yaw, pitch: v.pitch, roll: v.roll, rotor: Math.max(this.v.rotor, v.rotor) });
    this.prev = { ...this.v };
  }

  /** Mouse look, keys to controls, fixed-step physics. `frozen` (round start) keeps it parked. */
  update(dt: number, input: Input | undefined, world: CollisionWorld, frozen: boolean): VehicleEvents {
    const events: VehicleEvents = { impact: 0, landed: 0 };
    const v = this.v;
    if (!v) return events;
    const heli = v.kind === 'heli';
    if (input) {
      const look = input.consumeLook();
      const sens = this.sensitivity * input.sensitivity;
      this.camYaw -= look.x * sens;
      this.camPitch = clamp(this.camPitch - look.y * sens, heli ? -1.3 : -0.9, this.firstPerson ? 0.9 : 0.35);
      if (Math.abs(look.x) + Math.abs(look.y) > 0.5) this.lookIdle = 0;
      if (input.take('KeyV')) this.firstPerson = !this.firstPerson;
    }
    this.lookIdle += dt;
    const speed = Math.hypot(v.vx, v.vz);
    // Cars and scooters: the camera swings back behind the body once you stop looking around.
    if (!heli && this.lookIdle > 1.2 && speed > 2) this.camYaw = wrapAngle(this.camYaw) * Math.exp(-dt * 2.5);
    const key = (code: string) => !!input?.down(code);
    const controls: VehicleInput = {
      throttle: Number(key('KeyW')) - Number(key('KeyS')),
      steer: Number(key('KeyD')) - Number(key('KeyA')),
      brake: key('Space'),
      lift: Number(key('Space')) - Number(key('KeyC') || key('ControlLeft')),
      yaw: heli ? this.camYaw : v.yaw,
      engine: true,
    };
    if (frozen) { controls.throttle = 0; controls.steer = 0; controls.lift = 0; controls.yaw = v.yaw; controls.brake = true; }
    this.accumulator += Math.min(dt, 0.1);
    while (this.accumulator >= STEP) {
      this.prev = { ...v };
      const e = stepVehicle(world, v, controls, STEP);
      events.impact = Math.max(events.impact, e.impact); events.landed = Math.max(events.landed, e.landed);
      this.accumulator -= STEP;
    }
    return events;
  }

  /** Pose between fixed steps, for rendering. */
  renderPose(): Vehicle | undefined {
    const v = this.v, p = this.prev;
    if (!v || !p) return v;
    const a = this.accumulator / STEP, mix = (x: number, y: number) => x + (y - x) * a;
    return { ...v, x: mix(p.x, v.x), y: mix(p.y, v.y), z: mix(p.z, v.z), yaw: p.yaw + wrapAngle(v.yaw - p.yaw) * a, pitch: mix(p.pitch, v.pitch), roll: mix(p.roll, v.roll) };
  }

  report(): VehicleReport | undefined {
    const v = this.v;
    if (!v) return undefined;
    return { vehicle: v.id, x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy, vz: v.vz, yaw: v.yaw, pitch: v.pitch, roll: v.roll };
  }

  /** Where the camera looks from and toward (chase or the driver's seat). Returns the view yaw. */
  placeCamera(cam: THREE.PerspectiveCamera, world: CollisionWorld) {
    const v = this.renderPose();
    if (!v) return 0;
    const heli = v.kind === 'heli';
    const yaw = heli ? this.camYaw : v.yaw + this.camYaw;
    if (this.firstPerson) {
      const seat = seatPosition(v, 0);
      cam.position.set(seat.x, seat.y + eyeHeight({ crouch: VEHICLES[v.kind].sit }) + 0.05, seat.z);
      cam.rotation.set(this.camPitch + v.pitch, yaw, -v.roll * 0.6, 'YXZ');
      return yaw;
    }
    const c = CHASE[v.kind];
    const target = { x: v.x, y: v.y + c.up, z: v.z };
    const dir = dirFromAngles(yaw, this.camPitch);
    // Keep the camera out of walls: pull it in along the boom to the first hit.
    const back = { x: -dir.x, y: -dir.y, z: -dir.z };
    const wall = world.raycast(target, back, c.back + 0.4);
    const dist = Math.max(1.2, wall ? wall.t - 0.4 : c.back);
    hit.set(target.x + back.x * dist, target.y + back.y * dist, target.z + back.z * dist);
    const floor = world.groundHeight(hit.x, hit.z, hit.y, 0.2, 0.5);
    cam.position.set(hit.x, Math.max(hit.y, floor + 0.4), hit.z);
    cam.rotation.set(this.camPitch, yaw, 0, 'YXZ');
    return yaw;
  }
}
