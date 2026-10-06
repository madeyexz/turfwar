/**
 * Lifetimes of the sounds in the mix (src/audio.ts).
 *
 * Chrome keeps rendering a finished sound's nodes, silently but at full cost, until garbage collection
 * whenever one of them mixes two or more inputs (a gunshot's near and distant takes into one gain, a
 * casing's tones into one output). A long firefight piled up hundreds of these dead voices until the
 * audio thread missed its deadlines: the context clock fell to a fraction of real time and the output
 * dropped out for seconds, then came back by itself when a collection freed them. So every sound is a
 * Voice, unplugged from the shared buses as soon as its last source ends.
 */

/** What a voice needs of a source node and of a node it plugs into a bus (tests pass fakes). */
type Source = { addEventListener(type: 'ended', listener: () => void, options?: { once?: boolean }): void; stop(when?: number): void };
type Plug = { connect(destination: AudioNode): unknown; disconnect(): void };

export class Voice {
  private readonly sources = new Set<Source>();
  private readonly exits: Plug[] = [];
  private sealed = false;
  private done = false;
  /** Called once when the voice has ended and been unplugged. */
  onEnd?: () => void;

  /** Connects `node` to a shared bus; it is unplugged when the voice ends. */
  route<T extends Plug>(node: T, bus: AudioNode): T {
    node.connect(bus);
    this.exits.push(node);
    return node;
  }

  /** A source of this voice: the voice ends after the last one. */
  track<T extends Source>(src: T): T {
    this.sources.add(src);
    src.addEventListener('ended', () => { this.sources.delete(src); this.check(); }, { once: true });
    return src;
  }

  /** No more sources will be added (a voice without any ends now). */
  seal() { this.sealed = true; this.check(); }

  /** Cuts every source at `when` (stealing a voice, stopping an engine). */
  stop(when: number) {
    for (const src of this.sources) {
      try { src.stop(when); } catch { /* not started: nothing to stop */ }
    }
  }

  get ended() { return this.done; }

  private check() {
    if (!this.sealed || this.sources.size || this.done) return;
    this.done = true;
    for (const node of this.exits) node.disconnect();
    this.exits.length = 0;
    this.onEnd?.();
  }
}

/**
 * A cap on concurrent voices of one kind. When full, a voice that `mayDrop` is refused; any other takes the
 * place of the oldest, which `steal` fades out (it leaves the pool at once, so the cap holds).
 */
export class VoicePool<V> {
  private readonly live: V[] = [];
  constructor(readonly max: number, private readonly steal: (voice: V) => void) {}

  /** Admits `voice`, stealing the oldest when full; false (not admitted) only when full and `mayDrop`. */
  add(voice: V, mayDrop = false) {
    if (this.live.length >= this.max) {
      if (mayDrop) return false;
      while (this.live.length >= this.max) this.steal(this.live.shift()!);
    }
    this.live.push(voice);
    return true;
  }

  /** The voice ended on its own. */
  remove(voice: V) {
    const i = this.live.indexOf(voice);
    if (i >= 0) this.live.splice(i, 1);
  }

  get size() { return this.live.length; }
}

/** 0..1, and 0 for NaN or ±Infinity (a non-finite value thrown at an AudioParam aborts the caller). */
export const unit = (x: number) => Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
