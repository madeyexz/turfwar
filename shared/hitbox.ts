import { rayCapsule, raySphere, type Vec3 } from './math';
import type { HitZone } from './weapons';

/**
 * Simplified soldier hit volumes. The renderer's animated skeleton is decorative; these volumes
 * are what the client and the server agree on, so validation is deterministic.
 */
export interface HitShape { head: Vec3; headR: number; chestTop: Vec3; chestBottom: Vec3; chestR: number; hip: Vec3; foot: Vec3; legR: number }

export function hitShape(feet: Vec3, crouch: number, yaw: number): HitShape {
  const s = 1 - 0.34 * crouch;
  // Crouching soldiers lean forward slightly; shift upper volumes along the facing direction.
  const lean = 0.12 * crouch, fx = -Math.sin(yaw) * lean, fz = -Math.cos(yaw) * lean;
  return {
    head: { x: feet.x + fx * 1.4, y: feet.y + 1.66 * s, z: feet.z + fz * 1.4 }, headR: 0.17,
    chestTop: { x: feet.x + fx, y: feet.y + 1.42 * s, z: feet.z + fz }, chestBottom: { x: feet.x, y: feet.y + 0.98 * s, z: feet.z }, chestR: 0.27,
    hip: { x: feet.x, y: feet.y + 0.9 * s, z: feet.z }, foot: { x: feet.x, y: feet.y + 0.12, z: feet.z }, legR: 0.2,
  };
}

export function raycastSoldier(o: Vec3, d: Vec3, shape: HitShape): { t: number; zone: HitZone } | null {
  let best: { t: number; zone: HitZone } | null = null;
  const consider = (t: number, zone: HitZone) => { if (t >= 0 && (!best || t < best.t)) best = { t, zone }; };
  consider(raySphere(o, d, shape.head, shape.headR), 'head');
  consider(rayCapsule(o, d, shape.chestBottom, shape.chestTop, shape.chestR), 'body');
  consider(rayCapsule(o, d, shape.foot, shape.hip, shape.legR), 'legs');
  return best;
}

/** Center of mass used for aiming, radar and validation tolerances. */
export const chestPoint = (feet: Vec3, crouch: number): Vec3 => ({ x: feet.x, y: feet.y + 1.2 * (1 - 0.34 * crouch), z: feet.z });
