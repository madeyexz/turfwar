import { FRAME_HEADER, FRAME_POSE, FRAME_SHOT, FRAME_VERSION } from '../match/frame';
import type { RecEnv } from './policy';

/**
 * A segment (`.tfr`, "Turf Recording"): one room's frames, filtered events and roster changes for one
 * round, as the recorder received them. Layout (little-endian): "TFR1", u32 header length, the header
 * JSON, then records: u8 type, u32 tick, f64 receive time (epoch ms), u32 length, payload. Frames are
 * stored byte for byte as `encodeFrame` wrote them (after `zeroSoldiers`), so a later decoder reads them.
 * The file in R2 is this container compressed with zstd.
 */
export const SEGMENT_MAGIC = 'TFR1';

export const Rec = { Frame: 1, Event: 2, Roster: 3, Gap: 4 } as const;
export type Rec = typeof Rec[keyof typeof Rec];

/** A soldier seen in the segment. Humans who are not recording subjects carry `excluded` and no pid. */
export interface SegmentSoldier {
  soldierId: number; team: number; bot: boolean;
  /** Pseudonymous player id (shared/rec/policy.ts `pidOf`); only for recording subjects. */
  pid?: string;
  excluded?: boolean;
  device?: string;
  /** In the EU, EEA, UK or Switzerland, or unknown (left out of the export). */
  euUk?: boolean;
  termsVersion?: number;
  /** First and last tick the soldier was in the frames. */
  from: number; to: number;
}

export interface SegmentHeader {
  recFormat: 1;
  frameVersion: number;
  env: RecEnv;
  recorderSha: string;
  /** `schema:` + sha256 of the module's schema as the server describes it (changes with tables, reducers and views). */
  moduleHash: string;
  mapId: string;
  mapHash: string;
  configJson: string;
  mode: string;
  teamSize: number;
  room: number;
  roomKind: 'public' | 'private';
  /** Random id for the match this round belongs to (a room's run of rounds between map changes). */
  matchUid: string;
  round: number;
  startTick: number; endTick: number;
  startMs: number; endMs: number;
  ticksExpected: number; ticksReceived: number; gapRatio: number;
  /** Server ticks per wall-clock second over the segment (30 when the server keeps up). */
  ticksPerSecond: number;
  /** Closed early: the recorder's connection dropped, or it stopped. */
  truncated: boolean;
  /** A human who is not a recording subject was in the room (their bytes are zeros). */
  hasExcluded: boolean;
  soldiers: SegmentSoldier[];
}

export interface SegmentRecord { type: Rec; tick: number; ms: number; data: Uint8Array }
export interface Segment { header: SegmentHeader; records: SegmentRecord[] }

const enc = new TextEncoder(), dec = new TextDecoder();

export function encodeSegment(seg: Segment): Uint8Array {
  const head = enc.encode(JSON.stringify(seg.header));
  let size = 8 + head.length;
  for (const r of seg.records) size += 17 + r.data.length;
  const out = new Uint8Array(size), v = new DataView(out.buffer);
  out.set(enc.encode(SEGMENT_MAGIC), 0);
  v.setUint32(4, head.length, true);
  out.set(head, 8);
  let o = 8 + head.length;
  for (const r of seg.records) {
    v.setUint8(o, r.type); v.setUint32(o + 1, r.tick >>> 0, true); v.setFloat64(o + 5, r.ms, true); v.setUint32(o + 13, r.data.length, true);
    out.set(r.data, o + 17);
    o += 17 + r.data.length;
  }
  return out;
}

export function decodeSegment(bytes: Uint8Array): Segment {
  if (bytes.length < 8 || dec.decode(bytes.subarray(0, 4)) !== SEGMENT_MAGIC) throw new Error('not a TFR1 segment');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = v.getUint32(4, true);
  const header = JSON.parse(dec.decode(bytes.subarray(8, 8 + len))) as SegmentHeader;
  const records: SegmentRecord[] = [];
  let o = 8 + len;
  while (o < bytes.length) {
    if (o + 17 > bytes.length) throw new Error('truncated record');
    const type = v.getUint8(o) as Rec, tick = v.getUint32(o + 1, true), ms = v.getFloat64(o + 5, true), n = v.getUint32(o + 13, true);
    if (o + 17 + n > bytes.length) throw new Error('truncated record');
    records.push({ type, tick, ms, data: bytes.subarray(o + 17, o + 17 + n) });
    o += 17 + n;
  }
  return { header, records };
}

export const jsonRecord = (type: Rec, tick: number, ms: number, value: unknown): SegmentRecord => ({ type, tick, ms, data: enc.encode(JSON.stringify(value)) });
export const recordJson = <T>(r: SegmentRecord) => JSON.parse(dec.decode(r.data)) as T;

/** Frame header fields the recorder needs without a full decode. */
export function frameHead(bytes: Uint8Array): { version: number; tick: number; roundPhase: number; round: number } | undefined {
  if (bytes.length < FRAME_HEADER) return undefined;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { version: v.getUint8(0), tick: v.getUint32(1, true), roundPhase: v.getUint8(13), round: v.getUint16(14, true) };
}

/**
 * A copy of a packed frame with the given soldiers blanked: their pose bytes (all but the id) are zeros
 * (so dead, at the origin, no weapon) and their shots lose shooter and coordinates, and no vehicle seat or bomb names them. Used for humans who
 * are not recording subjects, so neither dataset holds their play.
 */
export function zeroSoldiers(bytes: Uint8Array, ids: ReadonlySet<number>): Uint8Array {
  const out = bytes.slice();
  if (!ids.size || out.length < FRAME_HEADER || out[0] !== FRAME_VERSION) return out;
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const soldiers = v.getUint16(21, true), bodies = v.getUint16(23, true), shots = v.getUint16(25, true), vehicles = v.getUint8(27);
  let o = FRAME_HEADER;
  for (let i = 0; i < soldiers; i++, o += FRAME_POSE) if (ids.has(v.getUint16(o, true))) out.fill(0, o + 2, o + FRAME_POSE);
  o += bodies * 16;
  for (let i = 0; i < vehicles; i++, o += 27) for (const at of [22, 24]) { const id = v.getInt16(o + at, true); if (id >= 0 && ids.has(id)) v.setInt16(o + at, -1, true); }
  for (let i = 0; i < shots; i++, o += FRAME_SHOT) if (ids.has(v.getUint16(o, true))) { v.setUint16(o, 0xffff, true); out.fill(0, o + 4, o + FRAME_SHOT); }
  // The bomb's carrier or arming soldier.
  const by = v.getInt16(19, true);
  if (by >= 0 && ids.has(by)) v.setInt16(19, -1, true);
  return out;
}
