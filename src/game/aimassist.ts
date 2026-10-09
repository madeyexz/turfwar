import type { Vec3 } from '../../shared/math';

/**
 * Aim assist for touch screens only (a thumb cannot track like a mouse): near an enemy the crosshair
 * slows down ("friction"), and while firing it drifts onto them ("magnetism"), never faster than
 * `PULL_RATE`. Mouse and keyboard never get it. The caller passes enemies it can see (line of sight,
 * not behind smoke); the rules here only use angles.
 */
export const ASSIST = {
  /** Half-angle (radians) inside which friction starts; full friction inside `inner`. */
  outer: 7 * Math.PI / 180,
  inner: 2.5 * Math.PI / 180,
  /** Look speed kept at full friction. */
  slow: 0.5,
  /** Magnetism: only while firing, inside this half-angle, at most this many radians per second. */
  pullCone: 5 * Math.PI / 180,
  pullRate: 0.35,
  /** Ignored beyond this range (m). */
  range: 60,
};

export interface AssistResult {
  /** Multiply this frame's look input by this. */
  lookScale: number;
  /** Add to yaw and pitch (radians). */
  yaw: number;
  pitch: number;
  /** The enemy point it worked on, if any. */
  target?: Vec3;
}

const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** Yaw and pitch from `eye` to `p` (the game's convention: forward = (−sin yaw, sin pitch, −cos yaw)). */
export function anglesTo(eye: Vec3, p: Vec3) {
  const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), dist: Math.hypot(dx, dy, dz) };
}

/**
 * `zoom`: the current magnification (aiming down sights narrows the cones, so a scope does not snap).
 */
export function aimAssist(o: { eye: Vec3; yaw: number; pitch: number; targets: readonly Vec3[]; firing: boolean; dt: number; zoom?: number }): AssistResult {
  const zoom = Math.max(1, o.zoom ?? 1);
  let best: { off: number; dyaw: number; dpitch: number; p: Vec3 } | undefined;
  for (const p of o.targets) {
    const a = anglesTo(o.eye, p);
    if (a.dist > ASSIST.range || a.dist < 0.5) continue;
    const dyaw = wrap(a.yaw - o.yaw), dpitch = a.pitch - o.pitch;
    const off = Math.hypot(dyaw * Math.cos(o.pitch), dpitch);
    if (!best || off < best.off) best = { off, dyaw, dpitch, p };
  }
  const none = { lookScale: 1, yaw: 0, pitch: 0 };
  if (!best) return none;
  const outer = ASSIST.outer / zoom, inner = ASSIST.inner / zoom;
  if (best.off > outer) return none;
  const t = Math.min(1, Math.max(0, (outer - best.off) / (outer - inner)));
  const lookScale = 1 - (1 - ASSIST.slow) * t;
  let yaw = 0, pitch = 0;
  if (o.firing && best.off < ASSIST.pullCone / zoom && best.off > 1e-4) {
    const step = Math.min(best.off, ASSIST.pullRate * o.dt);
    yaw = best.dyaw / best.off * step;
    pitch = best.dpitch / best.off * step;
  }
  return { lookScale, yaw, pitch, target: best.p };
}
