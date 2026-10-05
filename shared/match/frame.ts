import type { Surface } from '../collision';
import type { CapturePointDef } from '../maps/types';
import { WEAPONS, type WeaponId } from '../weapons';
import { BODY_RADIUS, type Body, type BodyKind } from '../world';
import type { MatchEvent, MatchState, PointState, Team } from './state';

/**
 * Compact binary snapshot of everything that changes every tick: soldier poses and vitals, lawful
 * bodies, capture progress, the match clocks and this tick's shots. The server writes one frame
 * row per tick, so a hundred soldiers cost one small row update per client instead of hundreds of
 * row updates. Positions are quantized to 2 cm, velocities to 1 cm/s.
 */
export const FRAME_VERSION = 2;

const POS = 50;          // units per metre (2 cm)
const VEL = 100;         // units per m/s
const PITCH = 20000;     // units per radian
const YAW = 65536 / (Math.PI * 2);

const BODY_KINDS = Object.keys(BODY_RADIUS) as BodyKind[];
const SURFACES: (Surface | undefined)[] = [undefined, 'metal', 'concrete', 'rock', 'dirt', 'glass', 'energy'];
const SHOT_WEAPONS: (WeaponId | 'bolt')[] = [...Object.keys(WEAPONS) as WeaponId[], 'bolt'];

export interface FramePose {
  id: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number; crouch: number;
  alive: boolean; grounded: boolean; sprint: boolean; ads: boolean; slide: boolean; weapon: 0 | 1; reloading: boolean; firing: boolean;
  health: number; shield: number;
}

export interface FrameClock { tick: number; time: number; worldTime: number; phaseLeft: number; lawLeft: number; rewindLeft: number }

export interface DecodedFrame extends FrameClock {
  poses: FramePose[];
  bodies: Pick<Body, 'id' | 'kind' | 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz' | 'team'>[];
  points: Pick<PointState, 'progress' | 'owner' | 'contested' | 'capturing'>[];
  /** Per map pickup: whole seconds until it is back (0 = lying there). */
  pickups: number[];
  shots: Extract<MatchEvent, { type: 'shot' }>[];
}

const HEADER = 1 + 4 + 4 * 4 + 2 + 1 + 1 + 2 + 2 + 2;
const POSE = 22, BODY = 16, POINT = 5, SHOT = 16;
const i16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
const u8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function encodeFrame(state: MatchState, shots: Extract<MatchEvent, { type: 'shot' }>[]): Uint8Array {
  const soldiers = state.soldiers, bodies = state.bodies, points = state.points;
  const sentShots = shots.slice(0, 2000);
  const pickups = state.pickupLeft.slice(0, 255);
  const buf = new ArrayBuffer(HEADER + soldiers.length * POSE + bodies.length * BODY + points.length * POINT + pickups.length + sentShots.length * SHOT);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, FRAME_VERSION); o += 1;
  v.setUint32(o, state.tick >>> 0, true); o += 4;
  for (const f of [state.time, state.worldTime, state.phaseLeft, state.lawLeft]) { v.setFloat32(o, f, true); o += 4; }
  v.setUint16(o, Math.min(65535, state.rewindLeft), true); o += 2;
  v.setUint8(o, points.length); o += 1;
  v.setUint8(o, pickups.length); o += 1;
  v.setUint16(o, soldiers.length, true); o += 2;
  v.setUint16(o, bodies.length, true); o += 2;
  v.setUint16(o, sentShots.length, true); o += 2;
  for (const s of soldiers) {
    const m = s.m;
    v.setUint16(o, s.id, true);
    v.setInt16(o + 2, i16(m.x * POS), true); v.setInt16(o + 4, i16(m.y * POS), true); v.setInt16(o + 6, i16(m.z * POS), true);
    v.setInt16(o + 8, i16(m.vx * VEL), true); v.setInt16(o + 10, i16(m.vy * VEL), true); v.setInt16(o + 12, i16(m.vz * VEL), true);
    v.setUint16(o + 14, Math.round(((s.yaw % (Math.PI * 2)) + Math.PI * 2) * YAW) & 0xffff, true);
    v.setInt16(o + 16, i16(s.pitch * PITCH), true);
    v.setUint8(o + 18, u8(m.crouch * 255));
    const flags = (s.alive ? 1 : 0) | (m.grounded ? 2 : 0) | (s.sprint ? 4 : 0) | (s.ads ? 8 : 0) | (m.slideTime > 0 ? 16 : 0)
      | (s.weapon ? 32 : 0) | (s.reloadLeft > 0 ? 64 : 0) | (s.sinceShot < 0.15 ? 128 : 0);
    v.setUint8(o + 19, flags);
    v.setUint8(o + 20, u8(s.health)); v.setUint8(o + 21, u8(s.shield));
    o += POSE;
  }
  for (const b of bodies) {
    v.setUint16(o, b.id & 0xffff, true);
    v.setUint8(o + 2, Math.max(0, BODY_KINDS.indexOf(b.kind)));
    v.setInt8(o + 3, b.team);
    v.setInt16(o + 4, i16(b.x * POS), true); v.setInt16(o + 6, i16(b.y * POS), true); v.setInt16(o + 8, i16(b.z * POS), true);
    v.setInt16(o + 10, i16(b.vx * VEL), true); v.setInt16(o + 12, i16(b.vy * VEL), true); v.setInt16(o + 14, i16(b.vz * VEL), true);
    o += BODY;
  }
  for (const p of points) {
    v.setInt16(o, i16(p.progress * 100), true);
    v.setInt8(o + 2, p.owner); v.setInt8(o + 3, p.capturing); v.setUint8(o + 4, p.contested ? 1 : 0);
    o += POINT;
  }
  for (const left of pickups) { v.setUint8(o, Math.min(255, Math.ceil(left))); o += 1; }
  for (const s of sentShots) {
    v.setUint16(o, s.shooter & 0xffff, true);
    v.setUint8(o + 2, Math.max(0, SHOT_WEAPONS.indexOf(s.weapon)));
    v.setUint8(o + 3, s.hit | (Math.max(0, SURFACES.indexOf(s.surface as Surface | undefined)) << 2));
    v.setInt16(o + 4, i16(s.from.x * POS), true); v.setInt16(o + 6, i16(s.from.y * POS), true); v.setInt16(o + 8, i16(s.from.z * POS), true);
    v.setInt16(o + 10, i16(s.to.x * POS), true); v.setInt16(o + 12, i16(s.to.y * POS), true); v.setInt16(o + 14, i16(s.to.z * POS), true);
    o += SHOT;
  }
  return new Uint8Array(buf);
}

export function decodeFrame(bytes: Uint8Array): DecodedFrame | undefined {
  if (bytes.byteLength < HEADER) return undefined;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  if (v.getUint8(o) !== FRAME_VERSION) return undefined;
  o += 1;
  const tick = v.getUint32(o, true); o += 4;
  const time = v.getFloat32(o, true), worldTime = v.getFloat32(o + 4, true), phaseLeft = v.getFloat32(o + 8, true), lawLeft = v.getFloat32(o + 12, true); o += 16;
  const rewindLeft = v.getUint16(o, true); o += 2;
  const pointCount = v.getUint8(o); o += 1;
  const pickupCount = v.getUint8(o); o += 1;
  const soldierCount = v.getUint16(o, true), bodyCount = v.getUint16(o + 2, true), shotCount = v.getUint16(o + 4, true); o += 6;
  const poses: FramePose[] = [];
  for (let i = 0; i < soldierCount; i++, o += POSE) {
    const flags = v.getUint8(o + 19);
    poses.push({
      id: v.getUint16(o, true),
      x: v.getInt16(o + 2, true) / POS, y: v.getInt16(o + 4, true) / POS, z: v.getInt16(o + 6, true) / POS,
      vx: v.getInt16(o + 8, true) / VEL, vy: v.getInt16(o + 10, true) / VEL, vz: v.getInt16(o + 12, true) / VEL,
      yaw: v.getUint16(o + 14, true) / YAW, pitch: v.getInt16(o + 16, true) / PITCH, crouch: v.getUint8(o + 18) / 255,
      alive: !!(flags & 1), grounded: !!(flags & 2), sprint: !!(flags & 4), ads: !!(flags & 8), slide: !!(flags & 16),
      weapon: flags & 32 ? 1 : 0, reloading: !!(flags & 64), firing: !!(flags & 128),
      health: v.getUint8(o + 20), shield: v.getUint8(o + 21),
    });
  }
  const bodies: DecodedFrame['bodies'] = [];
  for (let i = 0; i < bodyCount; i++, o += BODY) {
    bodies.push({
      id: v.getUint16(o, true), kind: BODY_KINDS[v.getUint8(o + 2)] ?? 'debris', team: v.getInt8(o + 3),
      x: v.getInt16(o + 4, true) / POS, y: v.getInt16(o + 6, true) / POS, z: v.getInt16(o + 8, true) / POS,
      vx: v.getInt16(o + 10, true) / VEL, vy: v.getInt16(o + 12, true) / VEL, vz: v.getInt16(o + 14, true) / VEL,
    });
  }
  const points: DecodedFrame['points'] = [];
  for (let i = 0; i < pointCount; i++, o += POINT) {
    points.push({ progress: v.getInt16(o, true) / 100, owner: v.getInt8(o + 2) as -1 | Team, capturing: v.getInt8(o + 3) as -1 | Team, contested: v.getUint8(o + 4) === 1 });
  }
  const pickups: number[] = [];
  for (let i = 0; i < pickupCount; i++, o += 1) pickups.push(v.getUint8(o));
  const shots: DecodedFrame['shots'] = [];
  for (let i = 0; i < shotCount; i++, o += SHOT) {
    const hs = v.getUint8(o + 3);
    shots.push({
      type: 'shot', shooter: v.getUint16(o, true), weapon: SHOT_WEAPONS[v.getUint8(o + 2)] ?? 'carbine', hit: (hs & 3) as 0 | 1 | 2,
      surface: SURFACES[hs >> 2],
      from: { x: v.getInt16(o + 4, true) / POS, y: v.getInt16(o + 6, true) / POS, z: v.getInt16(o + 8, true) / POS },
      to: { x: v.getInt16(o + 10, true) / POS, y: v.getInt16(o + 12, true) / POS, z: v.getInt16(o + 14, true) / POS },
    });
  }
  return { tick, time, worldTime, phaseLeft, lawLeft, rewindLeft, poses, bodies, points, pickups, shots };
}

/** Point states in map order (the frame carries them by index). */
export const framePoints = (defs: CapturePointDef[], decoded: DecodedFrame['points']): PointState[] =>
  defs.map((d, i) => ({ id: d.id, progress: decoded[i]?.progress ?? 0, owner: decoded[i]?.owner ?? -1, contested: decoded[i]?.contested ?? false, capturing: decoded[i]?.capturing ?? -1 }));
