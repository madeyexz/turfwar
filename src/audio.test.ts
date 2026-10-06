import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Audio } from './audio';

/**
 * A minimal fake Web Audio graph: nodes remember what they are connected to, sources remember when they
 * were stopped and end when the test says so, and params throw on non-finite values as Chrome's do.
 */
const finite = (x: number) => { if (!Number.isFinite(x)) throw new TypeError(`non-finite AudioParam value ${x}`); };
class Param {
  constructor(private v = 0) {}
  get value() { return this.v; }
  set value(x: number) { finite(x); this.v = x; }
  setValueAtTime(x: number) { finite(x); this.v = x; return this; }
  setTargetAtTime(x: number) { finite(x); return this; }
  linearRampToValueAtTime(x: number) { finite(x); return this; }
  exponentialRampToValueAtTime(x: number) { finite(x); if (x === 0) throw new RangeError('0'); return this; }
  cancelScheduledValues() { return this; }
}
class Node {
  readonly outputs = new Set<object>();
  connect<T extends object>(dest: T) { this.outputs.add(dest); return dest; }
  disconnect() { this.outputs.clear(); }
}
class Source extends Node {
  stoppedAt?: number;
  ended = false;
  onended: (() => void) | null = null;
  buffer: unknown = null;
  loop = false;
  type = 'sine';
  readonly playbackRate = new Param(1);
  readonly frequency = new Param(440);
  private listeners: (() => void)[] = [];
  constructor(private ctx: FakeContext) { super(); }
  start() { this.ctx.sources.push(this); }
  stop(when: number) { this.stoppedAt = when; }
  addEventListener(_type: string, fn: () => void) { this.listeners.push(fn); }
  end() { if (this.ended) return; this.ended = true; this.listeners.forEach(fn => fn()); this.onended?.(); }
}
const buffer = (channels: number, length: number) => {
  const data = Array.from({ length: channels }, () => new Float32Array(length).fill(0.5));
  return { length, duration: length / 8000, getChannelData: (c: number) => data[c] };
};
class FakeContext {
  readonly sampleRate = 8000;
  currentTime = 0;
  readonly destination = new Node();
  readonly sources: Source[] = [];
  readonly state = 'running';
  resume() { return Promise.resolve(); }
  createGain() { return Object.assign(new Node(), { gain: new Param(1) }); }
  createStereoPanner() { return Object.assign(new Node(), { pan: new Param(0) }); }
  createBiquadFilter() { return Object.assign(new Node(), { type: 'lowpass', frequency: new Param(350), Q: new Param(1), gain: new Param(0) }); }
  createDynamicsCompressor() {
    return Object.assign(new Node(), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param(), reduction: 0 });
  }
  createConvolver() { return Object.assign(new Node(), { buffer: null }); }
  createBuffer(channels: number, length: number) { return buffer(channels, length); }
  createBufferSource() { return new Source(this); }
  createOscillator() { return new Source(this); }
  decodeAudioData() { return Promise.resolve(buffer(1, 800)); }
}

/** The private buses the per-sound nodes plug into. */
type Mix = { master: Node; world: Node; gunBus: Node; tailBus: Node; reverbSend: Node };
/** Every node connected into one of the shared buses, by bus. */
function plugged(ctx: FakeContext, nodes: Set<Node>, mix: Mix) {
  const buses = Object.values(mix) as Node[];
  return [...nodes].filter(n => buses.some(b => n.outputs.has(b))).length;
}

describe('Audio voices', () => {
  let ctx: FakeContext;
  let nodes: Set<Node>;
  let audio: Audio;
  const L = { pos: { x: 0, y: 1.6, z: 0 }, yaw: 0 };

  beforeEach(async () => {
    nodes = new Set();
    // Track every node the mix creates.
    const C = class extends FakeContext { constructor() { super(); ctx = this; } };
    for (const name of Object.getOwnPropertyNames(FakeContext.prototype).filter(n => n.startsWith('create') && n !== 'createBuffer')) {
      const make = (FakeContext.prototype as unknown as Record<string, () => Node>)[name];
      (C.prototype as unknown as Record<string, () => Node>)[name] = function (this: FakeContext) { const n = make.call(this); nodes.add(n); return n; };
    }
    vi.stubGlobal('AudioContext', C);
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
    audio = new Audio();
    audio.start();
    // Let the recordings "decode".
    await vi.waitFor(() => expect((audio as unknown as { samples: Map<string, unknown> }).samples.has('foley-click')).toBe(true));
  });
  afterEach(() => vi.unstubAllGlobals());

  const mix = () => audio as unknown as Mix;
  const endAll = () => { for (const s of ctx.sources) s.end(); };
  const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

  it('unplugs every sound of a long firefight from the mix once its sources end', async () => {
    const permanent = plugged(ctx, nodes, mix());
    for (let i = 0; i < 40; i++) {
      ctx.currentTime += 0.08;
      audio.gunshot('m249');
      audio.gunshot('m4a1', L, { x: 5 + i, y: 1.5, z: 3 });
      if (i % 10 === 0) { audio.explosion(L, { x: 4, y: 0, z: 2 }); audio.footstep(undefined, undefined, true); audio.reload('out'); }
    }
    await flush();
    expect(plugged(ctx, nodes, mix())).toBeGreaterThan(permanent);
    endAll();
    // Only the permanent chain (buses, reverbs, compressors, wind) is left in the graph.
    expect(plugged(ctx, nodes, mix())).toBe(permanent);
  });

  it('stops each own shot\'s takes once the next shot chokes it', () => {
    audio.gunshot('m249');
    const first = ctx.sources.filter(s => s.stoppedAt === undefined);
    ctx.currentTime = 0.08;
    audio.gunshot('m249');
    // The near and room takes of the first shot stop shortly after the choke.
    expect(first.filter(s => s.stoppedAt !== undefined && Math.abs(s.stoppedAt - 0.28) < 1e-9).length).toBe(2);
  });

  it('caps remote gunshots: near shots steal the oldest, distant ones are dropped when full', () => {
    for (let i = 0; i < 30; i++) audio.gunshot('m4a1', L, { x: 3, y: 1.5, z: 4 });
    const remote = (audio as unknown as { remote: { size: number } }).remote;
    expect(remote.size).toBe(14);
    // Stolen voices fade and stop 0.12 s after being displaced.
    expect(ctx.sources.filter(s => s.stoppedAt === 0.12).length).toBeGreaterThanOrEqual(16 * 2);
    const before = ctx.sources.length;
    audio.gunshot('m4a1', L, { x: 60, y: 1.5, z: 4 });
    expect(ctx.sources.length).toBe(before);
    // Ending them all frees the pool.
    endAll();
    expect(remote.size).toBe(0);
  });

  it('survives NaN positions and values instead of throwing out of the game frame', () => {
    const bad = { x: NaN, y: 0, z: 0 };
    expect(() => audio.gunshot('m4a1', L, bad)).not.toThrow();
    expect(() => audio.explosion({ pos: { x: NaN, y: 0, z: 0 }, yaw: 0 }, { x: 1, y: 1, z: 1 })).not.toThrow();
    expect(() => audio.footstep(L, bad, false)).not.toThrow();
    const engine = audio.engine('heli')!;
    const screech = audio.screech('car')!;
    expect(() => engine.set(NaN, L, bad)).not.toThrow();
    expect(() => screech.set(Infinity, { pos: L.pos, yaw: NaN }, { x: 1, y: 0, z: 1 })).not.toThrow();
  });

  it('unplugs an engine once stop() has ended its sources', () => {
    const permanent = plugged(ctx, nodes, mix());
    const first = ctx.sources.length;
    const engine = audio.engine('car')!;
    engine.set(0.5);
    expect(plugged(ctx, nodes, mix())).toBe(permanent + 1);
    engine.stop();
    expect(ctx.sources.slice(first).every(s => s.stoppedAt !== undefined)).toBe(true);
    endAll();
    expect(plugged(ctx, nodes, mix())).toBe(permanent);
  });
});
