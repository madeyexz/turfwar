/**
 * The client input log (`.til`, "Turf Input Log"): what one player's browser did with the game's controls
 * during an online match, for training bots that move and aim like people. One batch = "TIL1", u32 header
 * length, the header JSON, then records: u8 type, varint microseconds since the previous record (the first
 * since `header.t0`), and the type's fields. Sent gzip-compressed to the ingest Worker
 * (deploy/cloudflare/rec-ingest), which stores it in R2 as it is. No chat, callsign or text is ever logged:
 * keys are indexes into `header.keys`, the codes bound to game actions (others are "other").
 */
export const INPUT_MAGIC = 'TIL1';

export const In = {
  /** Mouse movement in pointer lock (px, `movementX/Y`); `coalesced` when it came from getCoalescedEvents. */
  Move: 1,
  /** A key or mouse button (index into `keys`), down or up. */
  Key: 2,
  Wheel: 3,
  /** A touch point: id, phase (0 down, 1 move, 2 up), position normalized to the view (0..65535). */
  Touch: 4,
  /** One rendered frame: the look input it consumed, the aim-assist effect, the aim after, the newest server tick. */
  Frame: 5,
  /** A movement report (0) or a shot (1) sent to the server, with its sequence number. */
  Send: 6,
  /** A movement report's round trip (ms). */
  Rtt: 7,
  /** A state change (`InState`). */
  State: 8,
  /** The look sensitivity changed (rad per px, everything included but ADS). */
  Sens: 9,
} as const;
export type In = typeof In[keyof typeof In];

export const InState = { Focus: 1, Blur: 2, Lock: 3, Unlock: 4, Visible: 5, Hidden: 6 } as const;

export interface InputHeader {
  recFormat: 1;
  /** Random id of this logging session (one match on one map), and the batch's number in it. */
  session: string;
  seq: number;
  /** The client build (short git SHA). */
  build: string;
  /** SpacetimeDB database (`turfwar` or `lawbreaker-dev`), room and our soldier id. */
  db: string;
  room: number;
  soldierId: number;
  device: string;
  platform: string;
  touch: boolean;
  /** Touch aim assist switched on (only matters with `touch`). */
  assist: boolean;
  /** Look radians per pixel of mouse movement (sensitivity × the player's base rate), FOV in degrees. */
  sens: number;
  fov: number;
  /** Pointer lock without OS acceleration (`unadjustedMovement`). */
  unadjusted: boolean;
  dpr: number;
  refreshHz: number;
  /** Whether movement came from coalesced pointer events. */
  coalesced: boolean;
  /** Key codes, indexed by Key records; index 0 is "other". */
  keys: string[];
  /** The game actions bound to each of `keys` (same index), joined with '|' (the export keeps these, not the codes). */
  actions: string[];
  /** `performance.timeOrigin` (epoch ms) and the `performance.now()` the first record counts from. */
  timeOrigin: number;
  t0: number;
}

export type InputRecord =
  | { type: typeof In.Move; t: number; dx: number; dy: number; coalesced: boolean }
  | { type: typeof In.Key; t: number; key: number; down: boolean }
  | { type: typeof In.Wheel; t: number; dir: number }
  | { type: typeof In.Touch; t: number; id: number; phase: number; x: number; y: number }
  | { type: typeof In.Frame; t: number; lookX: number; lookY: number; scale: number; assistYaw: number; assistPitch: number; assistScale: number; yaw: number; pitch: number; alive: boolean; tick: number; tickAgeMs: number }
  | { type: typeof In.Send; t: number; kind: 0 | 1; seq: number }
  | { type: typeof In.Rtt; t: number; ms: number }
  | { type: typeof In.State; t: number; state: number }
  | { type: typeof In.Sens; t: number; sens: number };

/** `t` in records is milliseconds since `header.t0` (performance.now() clock). */
export class InputWriter {
  private buf = new Uint8Array(4096);
  private n = 0;
  private last = 0;
  count = 0;
  constructor(public t0: number) { this.last = t0; }
  get size() { return this.n; }
  private room(k: number) {
    if (this.n + k <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    next.set(this.buf.subarray(0, this.n)); this.buf = next;
  }
  private u8(x: number) { this.room(1); this.buf[this.n++] = x & 255; }
  private varint(x: number) {
    let v = Math.max(0, Math.floor(x));
    this.room(10);
    while (v >= 128) { this.buf[this.n++] = (v % 128) | 128; v = Math.floor(v / 128); }
    this.buf[this.n++] = v;
  }
  private zig(x: number) { const v = Math.round(x); this.varint(v >= 0 ? v * 2 : -v * 2 - 1); }
  private f32(x: number) { this.room(4); new DataView(this.buf.buffer).setFloat32(this.n, x, true); this.n += 4; }
  private u16(x: number) { this.room(2); new DataView(this.buf.buffer).setUint16(this.n, Math.max(0, Math.min(65535, Math.round(x))), true); this.n += 2; }
  private start(type: In, now: number) {
    this.u8(type);
    const dt = Math.max(0, now - this.last);
    this.varint(dt * 1000);
    this.last = Math.max(this.last, now);
    this.count++;
  }
  move(now: number, dx: number, dy: number, coalesced: boolean) { this.start(In.Move, now); this.zig(dx); this.zig(dy); this.u8(coalesced ? 1 : 0); }
  key(now: number, key: number, down: boolean) { this.start(In.Key, now); this.varint(key); this.u8(down ? 1 : 0); }
  wheel(now: number, dir: number) { this.start(In.Wheel, now); this.zig(Math.sign(dir)); }
  touch(now: number, id: number, phase: number, x: number, y: number) { this.start(In.Touch, now); this.u8(id); this.u8(phase); this.u16(x * 65535); this.u16(y * 65535); }
  frame(now: number, f: Omit<Extract<InputRecord, { type: typeof In.Frame }>, 'type' | 't'>) {
    this.start(In.Frame, now);
    for (const x of [f.lookX, f.lookY, f.scale, f.assistYaw, f.assistPitch, f.assistScale, f.yaw, f.pitch]) this.f32(x);
    this.u8(f.alive ? 1 : 0); this.varint(f.tick); this.f32(f.tickAgeMs);
  }
  send(now: number, kind: 0 | 1, seq: number) { this.start(In.Send, now); this.u8(kind); this.varint(seq); }
  rtt(now: number, ms: number) { this.start(In.Rtt, now); this.f32(ms); }
  state(now: number, state: number) { this.start(In.State, now); this.u8(state); }
  sens(now: number, sens: number) { this.start(In.Sens, now); this.f32(sens); }
  /** The records so far, and a fresh writer state for the next batch (times continue from the last record). */
  take(): { bytes: Uint8Array; t0: number } {
    const bytes = this.buf.slice(0, this.n), t0 = this.t0;
    this.n = 0; this.count = 0; this.t0 = this.last;
    return { bytes, t0 };
  }
}

const enc = new TextEncoder(), dec = new TextDecoder();

export function encodeBatch(header: InputHeader, records: Uint8Array): Uint8Array {
  const head = enc.encode(JSON.stringify(header));
  const out = new Uint8Array(8 + head.length + records.length);
  out.set(enc.encode(INPUT_MAGIC), 0);
  new DataView(out.buffer).setUint32(4, head.length, true);
  out.set(head, 8); out.set(records, 8 + head.length);
  return out;
}

export function decodeBatch(bytes: Uint8Array): { header: InputHeader; records: InputRecord[] } {
  if (bytes.length < 8 || dec.decode(bytes.subarray(0, 4)) !== INPUT_MAGIC) throw new Error('not a TIL1 batch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = v.getUint32(4, true);
  const header = JSON.parse(dec.decode(bytes.subarray(8, 8 + len))) as InputHeader;
  let o = 8 + len, t = header.t0;
  const varint = () => { let x = 0, mul = 1, b: number; do { b = bytes[o++]; x += (b & 127) * mul; mul *= 128; } while (b & 128 && o < bytes.length); return x; };
  const zig = () => { const z = varint(); return z % 2 ? -(z + 1) / 2 : z / 2; };
  const f32 = () => { const x = v.getFloat32(o, true); o += 4; return x; };
  const u16 = () => { const x = v.getUint16(o, true); o += 2; return x; };
  const records: InputRecord[] = [];
  while (o < bytes.length) {
    const type = bytes[o++] as In;
    t += varint() / 1000;
    switch (type) {
      case In.Move: { const dx = zig(), dy = zig(); records.push({ type, t, dx, dy, coalesced: !!bytes[o++] }); break; }
      case In.Key: { const key = varint(); records.push({ type, t, key, down: !!bytes[o++] }); break; }
      case In.Wheel: records.push({ type, t, dir: zig() }); break;
      case In.Touch: { const id = bytes[o++], phase = bytes[o++]; records.push({ type, t, id, phase, x: u16() / 65535, y: u16() / 65535 }); break; }
      case In.Frame: {
        const [lookX, lookY, scale, assistYaw, assistPitch, assistScale, yaw, pitch] = [f32(), f32(), f32(), f32(), f32(), f32(), f32(), f32()];
        const alive = !!bytes[o++], tick = varint(), tickAgeMs = f32();
        records.push({ type, t, lookX, lookY, scale, assistYaw, assistPitch, assistScale, yaw, pitch, alive, tick, tickAgeMs });
        break;
      }
      case In.Send: { const kind = bytes[o++] as 0 | 1; records.push({ type, t, kind, seq: varint() }); break; }
      case In.Rtt: records.push({ type, t, ms: f32() }); break;
      case In.State: records.push({ type, t, state: bytes[o++] }); break;
      case In.Sens: records.push({ type, t, sens: f32() }); break;
      default: throw new Error(`unknown input record ${type}`);
    }
  }
  return { header, records };
}
