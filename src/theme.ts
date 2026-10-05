import { Audio, reverbImpulse } from './audio';

/**
 * Menu theme: a 60-second A-minor loop sequenced entirely from the game's own sound effects.
 * Each effect is recorded once offline, then used as a sampler instrument (pitched by playback
 * rate): kicks are body hits, snares are gunshots, hats are dry fire, bass and lead are
 * hitmarkers, arpeggios are objective ticks, and a falling sweep carries the end back to bar 1.
 */
const BPM = 128;
const BEAT = 60 / BPM;
const BARS = 32;
export const THEME_SECONDS = BARS * 4 * BEAT;
const RATE = 44100;
/** Seconds of the loop's end rendered before its start, so tails, reverb and compression wrap seamlessly. */
const PRE_ROLL = 10;

const LISTENER = { pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
const AHEAD = { x: 0, y: 0, z: -3 };

/** Recorded effects, with the pitch (Hz) each one sounds at its natural rate when used melodically. */
const KIT = {
  kick: { seconds: 0.4, play: (s: Audio) => s.damage(false) },
  boom: { seconds: 2, play: (s: Audio) => s.explosion(LISTENER, AHEAD) },
  snare: { seconds: 0.6, play: (s: Audio) => s.gunshot('carbine') },
  rim: { seconds: 0.4, play: (s: Audio) => s.gunshot('sidearm') },
  crash: { seconds: 1.2, play: (s: Audio) => s.gunshot('lancer') },
  magnum: { seconds: 0.8, play: (s: Audio) => s.gunshot('magnum') },
  hat: { seconds: 0.1, play: (s: Audio) => s.dryFire() },
  step: { seconds: 0.2, play: (s: Audio) => s.footstep(undefined, undefined, true) },
  magOut: { seconds: 0.15, play: (s: Audio) => s.reload('out') },
  magIn: { seconds: 0.2, play: (s: Audio) => s.reload('in') },
  charge: { seconds: 0.2, play: (s: Audio) => s.reload('charge') },
  slide: { seconds: 0.8, play: (s: Audio) => s.slide() },
  jump: { seconds: 0.2, play: (s: Audio) => s.jump() },
  land: { seconds: 0.3, play: (s: Audio) => s.land(10) },
  bolt: { seconds: 0.4, play: (s: Audio) => s.boltShot(LISTENER, AHEAD), pitch: 220 },
  shield: { seconds: 0.3, play: (s: Audio) => s.damage(true) },
  shatter: { seconds: 0.5, play: (s: Audio) => s.shieldBreak() },
  pluck: { seconds: 0.15, play: (s: Audio) => s.hitmarker(false, false), pitch: 1450 },
  ping: { seconds: 0.25, play: (s: Audio) => s.hitmarker(true, false), pitch: 2100 },
  kill: { seconds: 0.5, play: (s: Audio) => s.hitmarker(false, true), pitch: 880 },
  capture: { seconds: 0.7, play: (s: Audio) => s.capture(true), pitch: 523.25 },
  lost: { seconds: 0.6, play: (s: Audio) => s.capture(false), pitch: 392 },
  tick: { seconds: 0.1, play: (s: Audio) => s.tick(), pitch: 1200 },
  ui: { seconds: 0.1, play: (s: Audio) => s.ui() },
  chime: { seconds: 1, play: (s: Audio) => s.chime() },
  sweep: { seconds: 1.4, play: (s: Audio) => s.sweep() },
} satisfies Record<string, { seconds: number; play: (s: Audio) => void; pitch?: number }>;
type Voice = keyof typeof KIT;

type Note = {
  voice: Voice; time: number; gain: number;
  /** Target pitch (Hz) for melodic voices; otherwise the natural rate. */
  hz?: number; pan?: number; wet?: number;
  /** Seconds into the recording to start from (skips a voice's lead-in). */
  offset?: number;
  /** Cut after this many seconds with a short release. */
  length?: number;
};

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const at = (bar: number, beat = 0) => (bar * 4 + beat) * BEAT;
/** Playback opens on the reload fill into the first drop; the quiet intro returns as the loop's breather. */
export const THEME_START = at(3);

/** Am – F – C – G, two bars each. Roots and triads as MIDI notes. */
const CHORDS = [
  { root: 45, triad: [69, 72, 76] },
  { root: 41, triad: [65, 69, 72] },
  { root: 48, triad: [67, 72, 76] },
  { root: 43, triad: [67, 71, 74] },
];
const chord = (bar: number) => CHORDS[Math.floor(bar / 2) % 4];

/** Main theme over eight bars: [bar, beat, midi]. */
const MELODY: [number, number, number][] = [
  [0, 0, 76], [0, 1, 81], [0, 1.5, 83], [0, 2, 84], [0, 3, 83], [0, 3.5, 81],
  [1, 0, 76], [1, 1.5, 79], [1, 2, 81], [1, 3, 76],
  [2, 0, 77], [2, 1, 81], [2, 1.5, 84], [2, 2, 81], [2, 3, 77], [2, 3.5, 76],
  [3, 0, 72], [3, 1.5, 74], [3, 2, 76], [3, 3, 77],
  [4, 0, 79], [4, 1, 84], [4, 1.5, 88], [4, 2, 86], [4, 3, 84], [4, 3.5, 83],
  [5, 0, 79], [5, 1.5, 84], [5, 2, 83], [5, 3, 79],
  [6, 0, 86], [6, 1, 83], [6, 1.5, 79], [6, 2, 81], [6, 3, 83],
  [7, 0, 86], [7, 2, 88], [7, 3, 86], [7, 3.5, 83],
];

function score() {
  const notes: Note[] = [];
  const add = (voice: Voice, time: number, gain: number, extra: Partial<Note> = {}) => notes.push({ voice, time, gain, ...extra });

  for (let bar = 0; bar < BARS; bar++) {
    const { root, triad } = chord(bar);
    const intro = bar < 4, groove = bar >= 4 && bar < 12, build = bar >= 12 && bar < 16;
    const theme = bar >= 16 && bar < 28, outro = bar >= 28;

    // Objective-timer arpeggio: chord tones climbing in sixteenths.
    const tickGain = intro ? 0.35 + bar * 0.06 : build ? 0.3 : outro ? 0.32 - (bar - 28) * 0.06 : 0.22;
    const arp = [triad[0], triad[1], triad[2], triad[1] + 12, triad[2], triad[1], triad[0] + 12, triad[2]];
    for (let i = 0; i < 16; i++) add('tick', at(bar, i / 4), tickGain * (i % 4 === 0 ? 1 : 0.7), { hz: hz(arp[i % 8] + 12), pan: i % 2 ? 0.35 : -0.35, wet: 0.35 });

    // Chord bell on each change (every intro bar).
    if (bar % 2 === 0 || intro) add('kill', at(bar), intro ? 0.6 : 0.45, { hz: hz(root + 24), offset: 0.05, wet: 0.7 });

    // Bass: hitmarker plucks on a syncopated root figure.
    if (groove || build || theme || bar === 28 || bar === 29) {
      const figure = build ? [0, 2.5] : [0, 0.75, 1.5, 2.5, 3, 3.5];
      for (const beat of figure) add('pluck', at(bar, beat), beat === 0 ? 1.1 : 0.8, { hz: hz(root + (beat === 3 ? 12 : 0)), length: BEAT * 0.9 });
    }

    // Drums.
    if (groove || theme) {
      for (let beat = 0; beat < 4; beat++) add('kick', at(bar, beat), 1.3);
      add('snare', at(bar, 1), 0.55, { wet: 0.4 }); add('snare', at(bar, 3), 0.55, { wet: 0.4 });
      for (let s = 0; s < 16; s++) {
        if (s % 4 === 2) add('hat', at(bar, s / 4), 0.55, { pan: 0.25 });
        else if (s % 2) add('step', at(bar, s / 4), theme ? 0.45 : 0.3, { pan: -0.3 });
      }
      if (bar % 2 === 1) add('rim', at(bar, 3.75), 0.3, { pan: 0.4 });
    }
    if (build) {
      add('kick', at(bar, 0), 1.3); add('kick', at(bar, 2.5), 1);
      add('shield', at(bar, 2), 0.5, { wet: 0.6 });
      for (const beat of [1.5, 3]) add('bolt', at(bar, beat), 0.35, { hz: hz(root + 12), wet: 0.5, pan: beat === 3 ? 0.5 : -0.5 });
      add('jump', at(bar, 1), 0.6); add('jump', at(bar, 3.5), 0.4);
    }
    if (outro) {
      add('kick', at(bar, 0), 1.2); if (bar < 31) add('kick', at(bar, 2), 1);
      for (let beat = 0.5; beat < 4; beat++) add('hat', at(bar, beat), 0.4, { pan: 0.25 });
    }

    // Capture fanfare in the build; the lost-objective fall in the outro.
    if (build) add('capture', at(bar, 0), 0.7, { hz: hz(root + 24), wet: 0.6 });
    if (outro && bar % 2 === 0) add('lost', at(bar, 0), 0.8, { hz: hz(bar === 28 ? 67 : 71), wet: 0.7 });
  }

  // Theme lead, then its first half again an octave up with the bell doubling.
  for (const [bar, beat, midi] of MELODY) add('ping', at(16 + bar, beat), 0.75, { hz: hz(midi), wet: 0.45 });
  for (const [bar, beat, midi] of MELODY.filter(([bar]) => bar < 4)) {
    add('ping', at(24 + bar, beat), 0.6, { hz: hz(midi), wet: 0.45 });
    add('ping', at(24 + bar, beat), 0.35, { hz: hz(midi + 12), wet: 0.6, pan: 0.3 });
  }
  for (const [bar, beat, midi] of MELODY) if (beat === 0) add('kill', at(16 + bar, beat), 0.3, { hz: hz(midi), offset: 0.05, wet: 0.6 });

  // Intro answers and section fills.
  for (let bar = 0; bar < 4; bar++) add('ui', at(bar, 3.5), 0.4, { wet: 0.6 });
  add('magOut', at(3, 2), 0.6); add('magIn', at(3, 2.5), 0.6); add('charge', at(3, 3), 0.6);
  for (const bar of [7, 19, 23]) { add('magOut', at(bar, 3), 0.5); add('magIn', at(bar, 3.5), 0.5); add('charge', at(bar, 3.75), 0.45); }
  for (let s = 0; s < 8; s++) add('rim', at(15, 2 + s / 4), 0.15 + s * 0.04, { pan: s % 2 ? 0.3 : -0.3 });
  for (let s = 0; s < 4; s++) add('rim', at(11, 3 + s / 4), 0.2 + s * 0.05);

  // Risers into each section and impacts on the downbeat.
  for (const bar of [4, 16, 24]) {
    add('chime', at(bar - 1, 2.5), 0.9, { wet: 0.7 });
    add('slide', at(bar - 1, 2.2), 0.5, { wet: 0.5 });
    add('boom', at(bar), 0.8, { wet: 0.5 });
    add('crash', at(bar), 0.5, { wet: 0.6 });
  }
  add('magnum', at(12), 0.6, { wet: 0.6 }); add('land', at(12), 0.9);
  add('magnum', at(28), 0.5, { wet: 0.7 });
  for (const bar of [12, 20, 28]) add('shatter', at(bar, 0.5), 0.6, { wet: 0.7, pan: 0.2 });

  // The sweep that drags the last bar back to the first.
  add('sweep', at(31, 1.3), 1.1, { wet: 0.8 });
  add('slide', at(31, 2.6), 0.4, { wet: 0.6 });
  return notes;
}

async function recordKit() {
  const voices = Object.keys(KIT) as Voice[];
  const buffers = await Promise.all(voices.map(v => Audio.record(KIT[v].seconds, KIT[v].play, RATE)));
  return Object.fromEntries(voices.map((v, i) => [v, buffers[i]])) as Record<Voice, AudioBuffer>;
}

/**
 * Mixes one note into the dry and reverb-send buses. Voices are summed here rather than as
 * thousands of scheduled nodes, which an offline context would process on every render quantum.
 */
function mix(dry: Float32Array[], wet: Float32Array[], n: Note, buffer: AudioBuffer, start: number) {
  const pitch = (KIT[n.voice] as { pitch?: number }).pitch;
  const rate = n.hz && pitch ? n.hz / pitch : 1;
  const from = (n.offset ?? 0) * RATE, last = buffer.length - 1;
  const frames = Math.min(Math.floor((last - from) / rate), n.length ? Math.floor(n.length * RATE) : Infinity);
  const first = Math.round(start * RATE), release = n.length ? 0.04 * RATE : 0;
  const angle = ((n.pan ?? 0) + 1) * Math.PI / 4, sends = n.wet ?? 0;
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  for (let c = 0; c < 2; c++) {
    const src = channels[c], out = dry[c], send = wet[c];
    // Equal-power pan, matching StereoPannerNode for a centred recording.
    const g = n.gain * (c ? Math.sin(angle) : Math.cos(angle)) * Math.SQRT2;
    for (let i = 0; i < frames; i++) {
      const at = first + i;
      if (at < 0 || at >= out.length) continue;
      const x = from + i * rate, k = Math.floor(x), f = x - k;
      let v = src[k] + (src[Math.min(k + 1, last)] - src[k]) * f;
      v *= g * (release ? Math.min(1, (frames - i) / release) : 1);
      out[at] += v;
      if (sends) send[at] += v * sends;
    }
  }
}

/** Renders the seamless loop. Runs offline, so it needs no user gesture. */
export async function renderTheme(): Promise<AudioBuffer> {
  const kit = await recordKit();
  const total = Math.ceil((PRE_ROLL + THEME_SECONDS) * RATE);
  const dry = [new Float32Array(total), new Float32Array(total)], wet = [new Float32Array(total), new Float32Array(total)];
  for (const n of score()) {
    mix(dry, wet, n, kit[n.voice], PRE_ROLL + n.time);
    // The loop's end also plays before its start, so the first bar opens with the tails it loops into.
    if (n.time >= THEME_SECONDS - PRE_ROLL) mix(dry, wet, n, kit[n.voice], PRE_ROLL + n.time - THEME_SECONDS);
  }

  const ctx = new OfflineAudioContext(2, total, RATE);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
  comp.connect(ctx.destination);
  const reverb = ctx.createConvolver(); reverb.buffer = reverbImpulse(ctx, 2.4, 2.6);
  const reverbIn = ctx.createGain(); reverbIn.gain.value = 0.35;
  reverbIn.connect(reverb).connect(comp);
  for (const [bus, dest] of [[dry, comp], [wet, reverbIn]] as const) {
    const buffer = ctx.createBuffer(2, total, RATE);
    buffer.copyToChannel(bus[0], 0); buffer.copyToChannel(bus[1], 1);
    const src = ctx.createBufferSource(); src.buffer = buffer; src.connect(dest); src.start();
  }
  const rendered = await ctx.startRendering();

  const length = Math.round(THEME_SECONDS * RATE), skip = Math.round(PRE_ROLL * RATE);
  const loop = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: RATE });
  let energy = 0;
  for (let c = 0; c < 2; c++) {
    const data = rendered.getChannelData(c).subarray(skip, skip + length);
    for (const v of data) energy += v * v;
    loop.copyToChannel(data, c);
  }
  // Level to about -19 dBFS RMS and round off the few transients that would clip. The curve is
  // applied per sample, so the loop point stays continuous.
  const scale = 0.11 / Math.sqrt(energy / (2 * length) || 1);
  for (let c = 0; c < 2; c++) {
    const d = loop.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = d[i] * scale, a = Math.abs(v);
      d[i] = a < 0.6 ? v : Math.sign(v) * (0.6 + 0.38 * Math.tanh((a - 0.6) / 0.38));
    }
  }
  return loop;
}
