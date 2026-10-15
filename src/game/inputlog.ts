import { InState, InputWriter, encodeBatch, type InputHeader } from '../../shared/rec/inputlog';
import { ACTION_IDS, binding, boundCodes } from './keybinds';
import { mayRecord, onConsent } from './consent';

/**
 * The input logger for match recording (docs/RECORDING.md): in an online match on a recorded server,
 * for a player who accepted the Terms and did not switch datasets off, it records the raw controls
 * (pointer-lock mouse movement with coalesced events, keys bound to game actions, mouse buttons, wheel,
 * touches), each rendered frame's look input, aim-assist effect and aim, the newest server tick, and the
 * movement reports and shots sent with their round trips. Never chat or text: keys are only the bound
 * codes, and nothing is logged while a text field has focus or the pointer is free. Batches go every
 * 30 s (and on leaving) to the ingest Worker, gzip-compressed, never through reducers.
 */
const ENDPOINT = (import.meta.env.VITE_REC_URL as string | undefined) ?? 'https://rec.turfwar.ianhsiao.me';
const BATCH_MS = 30_000;
/** Unsent batches kept for a retry, at most. */
const PENDING_MAX = 2 * 1024 * 1024;
/** Databases whose matches are recorded. */
export const RECORDED_DBS = new Set(['turfwar', 'lawbreaker-dev']);

declare const __APP_VERSION__: string;

export interface LogAuth { token: string; database: string; room: number; soldierId: number }

const isTyping = (e: Event) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};
const uid = () => { const b = new Uint8Array(12); crypto.getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); };

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class InputLog {
  private writer = new InputWriter(performance.now());
  private readonly session = uid();
  private seq = 0;
  private keys: string[];
  private actions: string[];
  private keyIndex: Map<string, number>;
  private readonly abort = new AbortController();
  private timer: ReturnType<typeof setInterval>;
  private pending: { seq: number; body: Uint8Array }[] = [];
  private sending = false;
  private closed = false;
  private lastTick = 0;
  private lastTickAt = 0;
  private sendSeq = 0;
  private sens = 0;
  private coalesced = false;
  /** Paused: the player switched datasets off (logging stops at once; already sent batches stay). */
  private off = false;

  constructor(
    private canvas: HTMLElement,
    private locked: () => boolean,
    private auth: () => LogAuth | undefined,
    private context: () => { device: string; touch: boolean; assist: boolean; sens: number; fov: number },
  ) {
    this.keys = ['other', ...[...boundCodes()].sort()];
    this.actions = this.keys.map(k => ACTION_IDS.filter(a => binding(a).includes(k)).join('|'));
    this.keyIndex = new Map(this.keys.map((k, i) => [k, i]));
    const signal = this.abort.signal;
    const now = () => performance.now();
    const on = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void, opts: AddEventListenerOptions = {}) =>
      document.addEventListener(type, fn, { ...opts, signal, passive: true });
    on('keydown', e => { if (!e.repeat && this.live() && !isTyping(e)) this.writer.key(now(), this.keyIndex.get(e.code) ?? 0, true); });
    on('keyup', e => { if (this.live() && !isTyping(e)) this.writer.key(now(), this.keyIndex.get(e.code) ?? 0, false); });
    on('pointermove', e => {
      if (!this.live()) return;
      if (e.pointerType === 'touch') { this.touch(e, 1); return; }
      if (document.pointerLockElement !== this.canvas) return;
      // Coalesced events carry the movement between frames; use them only when they add up to the event's own.
      const parts = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const sum = parts.reduce((s, p) => ({ x: s.x + p.movementX, y: s.y + p.movementY }), { x: 0, y: 0 });
      if (parts.length > 1 && Math.abs(sum.x - e.movementX) <= 1 && Math.abs(sum.y - e.movementY) <= 1) {
        this.coalesced = true;
        for (const p of parts) if (p.movementX || p.movementY) this.writer.move(p.timeStamp || now(), p.movementX, p.movementY, true);
      } else if (e.movementX || e.movementY) this.writer.move(now(), e.movementX, e.movementY, false);
    });
    on('pointerdown', e => { if (e.pointerType === 'touch' && this.live()) this.touch(e, 0); });
    on('pointerup', e => { if (e.pointerType === 'touch' && this.live()) this.touch(e, 2); });
    on('pointercancel', e => { if (e.pointerType === 'touch' && this.live()) this.touch(e, 2); });
    on('mousedown', e => { if (this.live() && document.pointerLockElement === this.canvas) this.writer.key(now(), this.keyIndex.get(`Mouse${e.button}`) ?? 0, true); });
    on('mouseup', e => { if (this.live()) this.writer.key(now(), this.keyIndex.get(`Mouse${e.button}`) ?? 0, false); });
    on('wheel', e => { if (this.live() && e.deltaY) this.writer.wheel(now(), e.deltaY); });
    on('visibilitychange', () => {
      this.state(document.hidden ? InState.Hidden : InState.Visible);
      if (document.hidden) void this.flush(true);
    });
    on('pointerlockchange', () => this.state(document.pointerLockElement === this.canvas ? InState.Lock : InState.Unlock));
    addEventListener('blur', () => this.state(InState.Blur), { signal });
    addEventListener('focus', () => this.state(InState.Focus), { signal });
    addEventListener('pagehide', () => { void this.flush(true); }, { signal });
    const stop = onConsent(() => { if (!mayRecord()) { this.off = true; this.writer.take(); this.pending = []; } });
    signal.addEventListener('abort', stop);
    this.timer = setInterval(() => { void this.flush(false); }, BATCH_MS);
  }

  private live() { return !this.closed && !this.off && this.locked(); }
  private state(s: number) { if (!this.closed && !this.off) this.writer.state(performance.now(), s); }
  private touch(e: PointerEvent, phase: number) {
    const r = this.canvas.getBoundingClientRect();
    this.writer.touch(e.timeStamp || performance.now(), e.pointerId & 255, phase, (e.clientX - r.left) / Math.max(1, r.width), (e.clientY - r.top) / Math.max(1, r.height));
  }

  /** A frame of the room arrived from the server. */
  serverTick(tick: number) { this.lastTick = tick; this.lastTickAt = performance.now(); }
  /** One rendered frame: the look input it consumed (px), radians per px applied, the assist effect, and the aim after. */
  frame(f: { lookX: number; lookY: number; scale: number; assistYaw: number; assistPitch: number; assistScale: number; yaw: number; pitch: number; alive: boolean }) {
    if (this.closed || this.off) return;
    const now = performance.now();
    const sens = this.context().sens;
    if (sens !== this.sens) { this.sens = sens; this.writer.sens(now, sens); }
    this.writer.frame(now, { ...f, tick: this.lastTick, tickAgeMs: this.lastTick ? now - this.lastTickAt : 0 });
  }
  /** A movement report (0) or a shot (1) went to the server; returns its sequence number. */
  sent(kind: 0 | 1) { if (this.closed || this.off) return -1; const seq = ++this.sendSeq; this.writer.send(performance.now(), kind, seq); return seq; }
  rtt(ms: number) { if (!this.closed && !this.off) this.writer.rtt(performance.now(), ms); }

  private header(t0: number, auth: LogAuth): InputHeader {
    const c = this.context();
    return {
      recFormat: 1, session: this.session, seq: this.seq, build: typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__,
      db: auth.database, room: auth.room, soldierId: auth.soldierId, device: c.device, platform: 'web', touch: c.touch, assist: c.assist,
      sens: c.sens, fov: c.fov, unadjusted: false, dpr: devicePixelRatio || 1, refreshHz: 0, coalesced: this.coalesced, keys: this.keys, actions: this.actions,
      timeOrigin: performance.timeOrigin, t0,
    };
  }

  /** Close the current batch and send what is waiting. `leaving`: the page may go away (keepalive). */
  async flush(leaving: boolean) {
    const auth = this.auth();
    if (!auth || this.off || !RECORDED_DBS.has(auth.database)) { this.writer.take(); return; }
    if (this.writer.count > 0) {
      const { bytes, t0 } = this.writer.take();
      const body = await gzip(encodeBatch(this.header(t0, auth), bytes));
      this.pending.push({ seq: this.seq++, body });
      let size = this.pending.reduce((n, p) => n + p.body.length, 0);
      while (size > PENDING_MAX && this.pending.length > 1) size -= this.pending.shift()!.body.length;
    }
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.pending.length) {
        const p = this.pending[0];
        const url = `${ENDPOINT}/v1/input?db=${encodeURIComponent(auth.database)}&s=${this.session}&b=${p.seq}`;
        const res = await fetch(url, {
          method: 'POST', body: p.body as BodyInit, keepalive: leaving && p.body.length < 60_000,
          headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/octet-stream' },
        }).catch(() => undefined);
        // 4xx: the Worker will never take this batch (too big, not a recorded player); drop it. Otherwise retry later.
        if (res && (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429))) this.pending.shift();
        else break;
      }
    } finally { this.sending = false; }
  }

  close() {
    if (this.closed) return;
    void this.flush(true).finally(() => { this.closed = true; });
    clearInterval(this.timer);
    this.abort.abort();
  }
}

