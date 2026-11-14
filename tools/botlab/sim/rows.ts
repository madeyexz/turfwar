// The row formats that the recorded data and the headless sim both write, so one set of metrics reads both.
// Aim rows: one per 30 Hz sample of one soldier (alive, live round). Movement rows: one per 0.1 s.
import type { CollisionWorld } from './shared/collision';
import { smokeBlocks } from './shared/match/combat';
import { WEAPON_IDS } from './shared/weapons';
import type { Decoded } from './shared/rec/clean';

export const OWN = 26, SLOTS = 3, SLOT = 8, OV = OWN + SLOTS * SLOT, NA = OV + 3, NM = 38;
// Aim row columns OV..OV+2: the slot-0 enemy as a spectator of the server frames sees it at the tick this aim reaches the server
// (eyaw, epitchChest, vis). For bots and the sim this equals slot 0; for humans the slots hold what the client drew (older).
/** Aim row columns. Per enemy slot (3 slots, nearest to the crosshair first, visible ones first): id, bot, dist, eyaw, epitchChest, epitchHead, vis (1 chest, 2 head), health. */
export const A = {
  t: 0, dt: 1, yaw: 2, pitch: 3, mdyaw: 4, mdpitch: 5, fire: 6, shots: 7, hits: 8, heads: 9, weapon: 10, ads: 11, crouch: 12, speed: 13,
  vf: 14, vs: 15, grounded: 16, health: 17, ammo: 18, reloading: 19, nvis: 20, nenemy: 21, hurt: 22, nframes: 23, tick: 24, aimkey: 25,
} as const;
export const M = {
  t: 0, dt: 1, x: 2, y: 3, z: 4, yaw: 5, pitch: 6, vf: 7, vs: 8, vy: 9, flags: 10, health: 11, weapon: 12, nvDist: 13, nvBear: 14, neDist: 15, neBear: 16,
  ntDist: 17, ntBear: 18, nAllies: 19, nEnemies: 20, nVisible: 21, siteA: 22, siteABear: 23, siteB: 24, siteBBear: 25, bomb: 26, left: 27, rays: 28, node: 36, hurt: 37,
} as const;
export const WIDX: Record<string, number> = Object.fromEntries(WEAPON_IDS.map((w, i) => [w, i]));
export const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export interface Seen { id: number; bot: number; x: number; y: number; z: number; crouch: number; health: number }
interface Cand { s: Seen; ang: number; d: number; ey: number; epc: number; eph: number; vis: number }
const cands: Cand[] = [];
const eye = { x: 0, y: 0, z: 0 }, chest = { x: 0, y: 0, z: 0 }, head = { x: 0, y: 0, z: 0 };
type Clouds = readonly { kind: string; x: number; y: number; z: number }[] | undefined;

/**
 * Fill the enemy slots of an aim row at offset `o`: the enemies as this soldier sees them (positions in `seen`,
 * the first `count`), from the eye, with the aim `yaw`/`pitch`. Returns the number in sight.
 */
export function fillEnemies(out: Float32Array, o: number, world: CollisionWorld, clouds: Clouds, ex: number, ey: number, ez: number, yaw: number, pitch: number, team: number, seen: Seen[], count: number, cap = 10): number {
  const cp = Math.cos(pitch), fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp;
  eye.x = ex; eye.y = ey; eye.z = ez;
  cands.length = 0;
  for (let i = 0; i < count; i++) {
    const s = seen[i], sc = 1 - 0.34 * s.crouch;
    const dx = s.x - ex, dy = s.y + 1.2 * sc - ey, dz = s.z - ez, d = Math.hypot(dx, dy, dz);
    if (d > 120 || d < 0.05) continue;
    const h = Math.hypot(dx, dz);
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dy * fy + dz * fz) / d)));
    cands.push({ s, ang, d, ey: wrap(Math.atan2(-dx, -dz) - yaw), epc: Math.atan2(dy, h) - pitch, eph: Math.atan2(s.y + 1.66 * sc - ey, h) - pitch, vis: 0 });
  }
  if (cands.length > cap) { cands.sort((a, b) => a.ang - b.ang); cands.length = cap; }
  let nvis = 0;
  for (const c of cands) {
    const s = c.s, sc = 1 - 0.34 * s.crouch;
    chest.x = s.x; chest.y = s.y + 1.2 * sc; chest.z = s.z; head.x = s.x; head.y = s.y + 1.66 * sc; head.z = s.z;
    if (world.lineOfSight(eye, chest, team) && !(clouds && smokeBlocks(clouds as never, eye, chest))) c.vis |= 1;
    if (world.lineOfSight(eye, head, team) && !(clouds && smokeBlocks(clouds as never, eye, head))) c.vis |= 2;
    if (c.vis) nvis++;
  }
  cands.sort((a, b) => (a.vis ? 0 : 1) - (b.vis ? 0 : 1) || a.ang - b.ang);
  for (let j = 0; j < SLOTS; j++) {
    const c = cands[j], p = o + j * SLOT;
    if (!c) { out.fill(0, p, p + SLOT); out[p] = -1; continue; }
    out[p] = c.s.id; out[p + 1] = c.s.bot; out[p + 2] = c.d; out[p + 3] = c.ey; out[p + 4] = c.epc; out[p + 5] = c.eph; out[p + 6] = c.vis; out[p + 7] = c.s.health;
  }
  return nvis;
}

const PH: Record<string, number> = { freeze: 0, live: 1, over: 2 };
/** A decoded segment as per-soldier arrays over frames (index = frame * S + slot). */
export class SegView {
  n: number; S: number; ids: number[]; slotOf = new Map<number, number>(); team: Int8Array; bot: Uint8Array;
  tick: Int32Array; time: Float64Array; phase: Uint8Array; tick0: number; byTick: Int32Array;
  x: Float32Array; y: Float32Array; z: Float32Array; vx: Float32Array; vy: Float32Array; vz: Float32Array; yaw: Float32Array; pitch: Float32Array; crouch: Float32Array;
  flags: Uint8Array; health: Uint8Array; weapon: Uint8Array; ammo: Uint8Array;
  clouds: Clouds[]; liveStart = -1;
  constructor(public d: Decoded) {
    const fr = d.frames, hs = d.header.soldiers;
    this.n = fr.length; this.S = hs.length; this.ids = hs.map(s => s.soldierId);
    hs.forEach((s, i) => this.slotOf.set(s.soldierId, i));
    this.team = Int8Array.from(hs.map(s => s.team)); this.bot = Uint8Array.from(hs.map(s => (s.bot ? 1 : 0)));
    const n = this.n, S = this.S, N = n * S;
    this.tick = new Int32Array(n); this.time = new Float64Array(n); this.phase = new Uint8Array(n);
    this.x = new Float32Array(N); this.y = new Float32Array(N); this.z = new Float32Array(N); this.vx = new Float32Array(N); this.vy = new Float32Array(N); this.vz = new Float32Array(N);
    this.yaw = new Float32Array(N); this.pitch = new Float32Array(N); this.crouch = new Float32Array(N);
    this.flags = new Uint8Array(N); this.health = new Uint8Array(N); this.weapon = new Uint8Array(N); this.ammo = new Uint8Array(N);
    this.clouds = new Array(n);
    this.tick0 = n ? fr[0].tick : 0;
    this.byTick = new Int32Array(n ? fr[n - 1].tick - this.tick0 + 1 : 0).fill(-1);
    for (let f = 0; f < n; f++) {
      const F = fr[f];
      this.tick[f] = F.tick; this.time[f] = F.time; this.phase[f] = PH[F.roundPhase] ?? 1; this.byTick[F.tick - this.tick0] = f;
      if (this.liveStart < 0 && F.roundPhase === 'live') this.liveStart = f;
      const cl = F.bodies.filter(b => b.kind === 'smokeCloud');
      this.clouds[f] = cl.length ? cl : undefined;
      for (const p of F.poses) {
        const s = this.slotOf.get(p.id); if (s === undefined) continue;
        const i = f * S + s;
        this.x[i] = p.x; this.y[i] = p.y; this.z[i] = p.z; this.vx[i] = p.vx; this.vy[i] = p.vy; this.vz[i] = p.vz; this.yaw[i] = p.yaw; this.pitch[i] = p.pitch; this.crouch[i] = p.crouch;
        // 1 alive, 2 grounded, 4 sprint, 8 ads, 16 slide, 32 using, 64 reloading, 128 firing
        this.flags[i] = (p.alive ? 1 : 0) | (p.grounded ? 2 : 0) | (p.sprint ? 4 : 0) | (p.ads ? 8 : 0) | (p.slide ? 16 : 0) | (p.using ? 32 : 0) | (p.reloading ? 64 : 0) | (p.firing ? 128 : 0);
        this.health[i] = p.health; this.weapon[i] = (WIDX[p.weaponId] ?? 0) | (p.weapon << 4); this.ammo[i] = p.ammo;
      }
    }
    // A human's server pose only moves when a report arrives (about 14 to 20 a second), and holds between.
    // Fill the short holds (up to 3 frames) with a straight line between the two reports, as the clients' interpolation does.
    for (let s = 0; s < S; s++) {
      if (this.bot[s]) continue;
      let k0 = -1;
      for (let f = 0; f < n; f++) {
        const i = f * S + s;
        if (!(this.flags[i] & 1)) { k0 = -1; continue; }
        if (k0 < 0) { k0 = f; continue; }
        const p = (f - 1) * S + s;
        if (this.x[i] === this.x[p] && this.y[i] === this.y[p] && this.z[i] === this.z[p]) continue;
        if (f - k0 > 1 && f - k0 <= 4) {
          const a = k0 * S + s, span = this.time[f] - this.time[k0];
          for (let g = k0 + 1; g < f; g++) {
            const j = g * S + s, w = span > 0 ? (this.time[g] - this.time[k0]) / span : 0;
            this.x[j] = this.x[a] + (this.x[i] - this.x[a]) * w; this.y[j] = this.y[a] + (this.y[i] - this.y[a]) * w; this.z[j] = this.z[a] + (this.z[i] - this.z[a]) * w;
          }
        }
        k0 = f;
      }
    }
  }
  /** Frame index of the newest frame at or before tick `k` (-1 before the first). */
  at(k: number): number {
    let i = Math.floor(k) - this.tick0;
    if (i < 0) return -1;
    if (i >= this.byTick.length) return this.n - 1;
    while (i >= 0 && this.byTick[i] < 0) i--;
    return i < 0 ? -1 : this.byTick[i];
  }
  alive(slot: number, f: number) { return (this.flags[f * this.S + slot] & 1) === 1; }
  /** Position and crouch of `slot` at fractional tick `k`, into `out`; false when not alive there. */
  pose(slot: number, k: number, out: { x: number; y: number; z: number; crouch: number; health: number }): boolean {
    const f0 = this.at(k); if (f0 < 0) return false;
    const i0 = f0 * this.S + slot;
    if (!(this.flags[i0] & 1)) return false;
    const f1 = f0 + 1 < this.n ? f0 + 1 : f0, i1 = f1 * this.S + slot;
    let a = f1 > f0 && (this.flags[i1] & 1) ? (k - this.tick[f0]) / (this.tick[f1] - this.tick[f0]) : 0;
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    out.x = this.x[i0] + (this.x[i1] - this.x[i0]) * a; out.y = this.y[i0] + (this.y[i1] - this.y[i0]) * a; out.z = this.z[i0] + (this.z[i1] - this.z[i0]) * a;
    out.crouch = this.crouch[i0] + (this.crouch[i1] - this.crouch[i0]) * a; out.health = this.health[i0];
    return true;
  }
}

/** Append-only Float32 row file. */
export class RowFile {
  private w; rows = 0; private buf: Float32Array; private n = 0;
  constructor(path: string, public width: number) { this.w = Bun.file(path).writer({ highWaterMark: 1 << 22 }); this.buf = new Float32Array(width * 4096); }
  row(): { a: Float32Array; o: number } {
    if (this.n + this.width > this.buf.length) this.flush();
    const o = this.n; this.n += this.width; this.rows++;
    this.buf.fill(0, o, o + this.width);
    return { a: this.buf, o };
  }
  flush() { if (this.n) { this.w.write(new Uint8Array(this.buf.buffer.slice(0, this.n * 4))); this.n = 0; } }
  async end() { this.flush(); await this.w.end(); }
}
