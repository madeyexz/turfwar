/**
 * The recorder's own reader for `frame` and `match_event` (docs/RECORDING.md). On the small game-server
 * VM the SDK's general decoder and client cache cost ~2 ms of CPU per frame message, 30 a second for each
 * room. This second connection takes only those two tables, per room, and reads the few fields it needs
 * straight from the wire (BSATN, protocol `v2.bsatn.spacetimedb`): about a third of the CPU.
 *
 * Layouts (spacetimedb 2.10.2 `src/sdk/client_api/types.ts`; checked against the generated bindings by
 * `checkRowTypes` at start): a message is one compression byte (0 = none) and one ServerMessage.
 */
import { Frame, MatchEvent } from '../../src/module_bindings/types';

export const FRAME_PROTOCOL = 'v2.bsatn.spacetimedb';

// ServerMessage and its parts (sum tags in declaration order).
const SM_SUBSCRIBE_APPLIED = 1, SM_SUBSCRIPTION_ERROR = 3, SM_TRANSACTION_UPDATE = 4;
const ROWS_PERSISTENT = 0, ROWS_EVENT = 1;
const HINT_FIXED = 0, HINT_OFFSETS = 1;
// ClientMessage.
const CM_SUBSCRIBE = 0, CM_UNSUBSCRIBE = 1;

/** The row types this reader decodes by hand; a module that changes them must change this file too. */
export function checkRowTypes() {
  const names = (o: { algebraicType: unknown }) => {
    const t = o.algebraicType as { tag: string; value: { elements: { name: string; algebraicType: { tag: string } }[] } };
    return t.value.elements.map(e => `${e.name}:${e.algebraicType.tag}`).join(',');
  };
  const frame = names(Frame), event = names(MatchEvent);
  if (frame !== 'id:U8,mapId:String,data:Array' || event !== 'seq:U32,json:String,room:U8')
    throw new Error(`frame reader is out of date: frame ${frame}; match_event ${event}`);
}

class Reader {
  off = 0;
  readonly v: DataView;
  constructor(readonly b: Uint8Array) { this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  u8() { return this.b[this.off++]; }
  u16() { const x = this.v.getUint16(this.off, true); this.off += 2; return x; }
  u32() { const x = this.v.getUint32(this.off, true); this.off += 4; return x; }
  bytes() { const n = this.u32(); const s = this.b.subarray(this.off, this.off + n); this.off += n; if (this.off > this.b.length) throw new RangeError('short message'); return s; }
  str() { return dec.decode(this.bytes()); }
}
const dec = new TextDecoder(), enc = new TextEncoder();

/** Rows of a BsatnRowList: the size hint (skipped; rows are read by their layout) and the row bytes. */
function rowList(r: Reader): Reader {
  const hint = r.u8();
  if (hint === HINT_FIXED) r.u16();
  else if (hint === HINT_OFFSETS) { const n = r.u32(); r.off += 8 * n; }
  else throw new Error(`row size hint ${hint}`);
  return new Reader(r.bytes());
}

export interface FrameSink {
  frame(f: { id: number; mapId: string; data: Uint8Array }): void;
  event(e: { room: number; json: string }): void;
}

function readRows(table: string, rows: Reader, sink: FrameSink) {
  if (table === 'frame') {
    while (rows.off < rows.b.length) { const id = rows.u8(), mapId = rows.str(), data = rows.bytes(); sink.frame({ id, mapId, data }); }
  } else if (table === 'match_event') {
    while (rows.off < rows.b.length) { rows.u32(); const json = rows.str(), room = rows.u8(); sink.event({ room, json }); }
  }
}

/** One server message: frames and events in it go to `sink` in their order; the rest is skipped. */
export function readMessage(data: Uint8Array, sink: FrameSink, onError: (error: string) => void) {
  if (data[0] !== 0) throw new Error(`compressed message (${data[0]})`);
  const r = new Reader(data.subarray(1));
  const tag = r.u8();
  if (tag === SM_TRANSACTION_UPDATE) {
    for (let sets = r.u32(); sets > 0; sets--) {
      r.u32(); // query set id
      for (let tables = r.u32(); tables > 0; tables--) {
        const table = r.str();
        for (let parts = r.u32(); parts > 0; parts--) {
          const kind = r.u8();
          if (kind === ROWS_PERSISTENT) { readRows(table, rowList(r), sink); rowList(r); /* deletes: the old rows */ }
          else if (kind === ROWS_EVENT) readRows(table, rowList(r), sink);
          else throw new Error(`table rows ${kind}`);
        }
      }
    }
  } else if (tag === SM_SUBSCRIBE_APPLIED) {
    r.u32(); r.u32(); // request id, query set id
    for (let tables = r.u32(); tables > 0; tables--) { const table = r.str(); readRows(table, rowList(r), sink); }
  } else if (tag === SM_SUBSCRIPTION_ERROR) {
    if (r.u8() === 0) r.u32(); // request id (option: 0 = some)
    r.u32();
    onError(r.str());
  }
}

class Writer {
  parts: number[] = [];
  u8(x: number) { this.parts.push(x & 0xff); return this; }
  u32(x: number) { this.parts.push(x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff); return this; }
  str(s: string) { const b = enc.encode(s); this.u32(b.length); for (const x of b) this.parts.push(x); return this; }
  done() { return new Uint8Array(this.parts); }
}
export const subscribeMessage = (requestId: number, querySetId: number, queries: string[]) => {
  const w = new Writer().u8(CM_SUBSCRIBE).u32(requestId).u32(querySetId).u32(queries.length);
  for (const q of queries) w.str(q);
  return w.done();
};
export const unsubscribeMessage = (requestId: number, querySetId: number) => new Writer().u8(CM_UNSUBSCRIBE).u32(requestId).u32(querySetId).u8(0).done();

/**
 * The connection: `watch(rooms)` keeps one subscription per room. `onClose` runs once when it closes for
 * any reason (the recorder then reconnects everything).
 */
export class FrameFeed {
  #ws: WebSocket | undefined;
  #rooms = new Map<number, number>(); // room -> query set id
  #want = new Set<number>();
  #next = 1;
  #open = false;
  #closed = false;

  constructor(private o: { uri: string; db: string; token: string; sink: FrameSink; log: (msg: string, extra?: Record<string, unknown>) => void; onClose: () => void }) {}

  async start() {
    const http = this.o.uri.replace(/^ws/, 'http');
    const res = await fetch(`${http}/v1/identity/websocket-token`, { method: 'POST', headers: { Authorization: `Bearer ${this.o.token}` } });
    if (!res.ok) throw new Error(`websocket token ${res.status}`);
    const { token } = await res.json() as { token: string };
    if (this.#closed) return;
    const url = new URL(`v1/database/${this.o.db}/subscribe`, this.o.uri.endsWith('/') ? this.o.uri : `${this.o.uri}/`);
    url.searchParams.set('token', token);
    url.searchParams.set('compression', 'None');
    url.searchParams.set('light', 'true');
    const ws = new WebSocket(url.toString(), FRAME_PROTOCOL);
    ws.binaryType = 'arraybuffer';
    this.#ws = ws;
    ws.onopen = () => { this.#open = true; this.#sync(); };
    ws.onmessage = e => {
      try { readMessage(new Uint8Array(e.data as ArrayBuffer), this.o.sink, error => this.o.log('frame subscription error', { error })); }
      catch (error) { this.o.log('frame reader failed', { error: String(error) }); this.close(); }
    };
    ws.onclose = () => this.close();
    ws.onerror = () => this.close();
  }

  /** Take frames and events from exactly these rooms. */
  watch(rooms: Iterable<number>) { this.#want = new Set(rooms); this.#sync(); }
  get watching() { return this.#rooms.size; }

  #sync() {
    const ws = this.#ws;
    if (!ws || !this.#open || this.#closed) return;
    for (const [room, set] of this.#rooms) if (!this.#want.has(room)) { ws.send(unsubscribeMessage(this.#next++, set)); this.#rooms.delete(room); }
    for (const room of this.#want) {
      if (this.#rooms.has(room)) continue;
      const set = this.#next++;
      ws.send(subscribeMessage(this.#next++, set, [`SELECT * FROM frame WHERE id = ${room}`, `SELECT * FROM match_event WHERE room = ${room}`]));
      this.#rooms.set(room, set);
    }
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#rooms.clear();
    try { this.#ws?.close(); } catch { /* already closed */ }
    this.o.onClose();
  }
}
