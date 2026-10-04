// Small allocation-light vector helpers shared by the browser, tests and the SpacetimeDB module.
export type Vec3 = { x: number; y: number; z: number };

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const length3 = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
export const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
export const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

export function normalize3(v: Vec3): Vec3 {
  const l = length3(v) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/** Unit forward vector for a yaw/pitch pair; yaw 0 looks toward -Z like a Three.js camera. */
export function dirFromAngles(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

export function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Closest distance from point p to segment ab, plus the segment parameter. */
export function segmentPointDistance(p: Vec3, a: Vec3, b: Vec3) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len2 = dx * dx + dy * dy + dz * dz || 1;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / len2, 0, 1);
  return { distance: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy, p.z - a.z - t * dz), t };
}

/** Ray/sphere intersection distance along a unit direction, or -1. */
export function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t = -b - s;
  if (t >= 0) return t;
  return -b + s >= 0 ? 0 : -1;
}

/** Ray/capsule (segment a-b with radius r) intersection distance, or -1. */
export function rayCapsule(o: Vec3, d: Vec3, a: Vec3, b: Vec3, r: number) {
  // Sample-free approach: closest approach between ray and segment, then sphere test there.
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const wx = o.x - a.x, wy = o.y - a.y, wz = o.z - a.z;
  const A = d.x * d.x + d.y * d.y + d.z * d.z;
  const B = d.x * ux + d.y * uy + d.z * uz;
  const C = ux * ux + uy * uy + uz * uz;
  const D = d.x * wx + d.y * wy + d.z * wz;
  const E = ux * wx + uy * wy + uz * wz;
  const den = A * C - B * B;
  let sc = 0, tc = 0;
  if (den < 1e-9) { tc = clamp(E / (C || 1), 0, 1); }
  else { sc = (B * E - C * D) / den; tc = clamp((A * E - B * D) / den, 0, 1); }
  // Re-solve ray parameter for the clamped segment point.
  const px = a.x + ux * tc, py = a.y + uy * tc, pz = a.z + uz * tc;
  sc = Math.max(0, (px - o.x) * d.x + (py - o.y) * d.y + (pz - o.z) * d.z);
  const qx = o.x + d.x * sc - px, qy = o.y + d.y * sc - py, qz = o.z + d.z * sc - pz;
  if (qx * qx + qy * qy + qz * qz > r * r) return -1;
  return raySphere(o, d, { x: px, y: py, z: pz }, r);
}

/** Deterministic PRNG (mulberry32). Used for bots so server and offline runs match their seeds. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
