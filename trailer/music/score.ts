/**
 * The trailer's score: an original cinematic cue in D minor at 120 BPM, composed by rule and rendered
 * offline in the browser (trailer/web/audio.ts runs it; nothing here is sampled music).
 *
 * Orchestra (all synthesized): spiccato string ostinatos and legato strings (detuned saw ensembles),
 * low brass stabs and horn lines (filter-swept saw stacks with a little drive), a formant "choir",
 * taiko and orchestral drums, sub booms, braams, reverse-cymbal swells, risers and a Shepard tone.
 *
 * Woven into the score, the game's own sounds: CC0 recordings from public/assets/sfx (charging
 * handles, bolts and slides as percussion on the cuts, shell casings as hi-hat fills, single big M110
 * and M1014 shots with long tails on the impacts, an M249 burst as the drum fill into the drop, a
 * dry-fire click alone in the last silence) and sounds the game synthesizes through src/audio.ts (the
 * helicopter's rotor as a rhythmic swell into the vehicles, the M67's blast under the final hit, the
 * bomb's beep as the Sabotage pulse).
 *
 * A cut's music is a list of sections in beats ([kind, beats]) plus the times of its picture cuts
 * (trailer/edit.ts), so the impacts and percussion land on the edit. Any cut with the same timing
 * (the planned zh-TW version) reuses it unchanged.
 */
import { Audio, type EngineVoice } from '../../src/audio';

export const BPM = 120;
const BEAT = 60 / BPM;
const BAR = 4 * BEAT;
export const RATE = 48000;

export type Section = 'open' | 'title' | 'store' | 'guns' | 'tension' | 'fill' | 'drop' | 'silence' | 'climax' | 'rise' | 'end';
type Buf = Float32Array[];
type Bus = 'bed' | 'hit' | 'post';
interface Note { at: number; voice: string; gain: number; bus: Bus; pan?: number; hall?: number; tail?: number; rate?: number; impact?: boolean }

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// ---------------------------------------------------------------------------------------------
// Harmony: D minor, with heroic turns to Bb, C and a D major arrival.
// ---------------------------------------------------------------------------------------------

/** Chords as [root midi (octave 2), third, fifth] semitone offsets. */
const CH: Record<string, [number, number, number]> = {
  Dm: [38, 3, 7], Bb: [34, 4, 7], F: [41, 4, 7], C: [36, 4, 7], Gm: [43, 3, 7], A: [45, 4, 7], D: [38, 4, 7],
};
const PROG: Record<Section, string[]> = {
  open: ['Dm', 'Dm', 'Bb', 'A'],
  title: ['Dm', 'Dm'],
  store: ['Dm', 'Bb', 'Gm', 'A'],
  guns: ['Dm', 'Bb', 'F', 'C'],
  tension: ['Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'A', 'A'],
  fill: ['Bb', 'C', 'Gm', 'A'],
  drop: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'C', 'C'],
  silence: ['A'],
  climax: ['Bb', 'C', 'Dm', 'F', 'Gm', 'Bb', 'C', 'D'],
  rise: ['Bb', 'C', 'A'],
  end: ['Dm'],
};
/** The heroic theme over the climax: [bar, beat, midi, beats]. */
const THEME: [number, number, number, number][] = [
  [0, 0, 65, 1], [0, 1, 70, 1], [0, 2, 74, 2],
  [1, 0, 76, 1.5], [1, 1.5, 74, 0.5], [1, 2, 72, 2],
  [2, 0, 74, 1], [2, 1, 77, 1], [2, 2, 81, 2],
  [3, 0, 79, 1], [3, 1, 77, 1], [3, 2, 72, 2],
  [4, 0, 74, 1], [4, 1, 79, 1], [4, 2, 82, 2],
  [5, 0, 81, 1.5], [5, 1.5, 79, 0.5], [5, 2, 77, 2],
  [6, 0, 76, 1], [6, 1, 79, 1], [6, 2, 84, 2],
  [7, 0, 81, 4],
];

// ---------------------------------------------------------------------------------------------
// Instruments: each note is rendered once per pitch and length, then mixed by hand.
// ---------------------------------------------------------------------------------------------

async function offline(seconds: number, build: (ctx: OfflineAudioContext, out: AudioNode) => void | Promise<void>) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * RATE), RATE);
  await build(ctx, ctx.destination);
  const b = await ctx.startRendering();
  return [b.getChannelData(0).slice(), b.getChannelData(1).slice()];
}
let seed = 0x2545f491;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296); };
function noise(ctx: BaseAudioContext, seconds: number) {
  const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  return b;
}
function drive(ctx: BaseAudioContext, amount: number) {
  const ws = ctx.createWaveShaper(), n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  ws.curve = curve; ws.oversample = '4x';
  return ws;
}
/** An ensemble of detuned oscillators spread across the stereo field. */
function ensemble(ctx: BaseAudioContext, dest: AudioNode, midi: number, voices: number, cents: number, type: OscillatorType, len: number, gain = 1) {
  for (let v = 0; v < voices; v++) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(midi);
    o.detune.value = (v / Math.max(1, voices - 1) - 0.5) * 2 * cents + (rand() - 0.5) * 3;
    const p = ctx.createStereoPanner(); p.pan.value = voices > 1 ? (v / (voices - 1) - 0.5) * 1.6 : 0;
    const g = ctx.createGain(); g.gain.value = gain / Math.sqrt(voices);
    o.connect(g).connect(p).connect(dest); o.start(rand() * 0.01); o.stop(len);
  }
}
function adsr(p: AudioParam, a: number, peak: number, hold: number, release: number, sustain = peak) {
  p.setValueAtTime(0.0001, 0); p.linearRampToValueAtTime(peak, a);
  if (sustain !== peak) p.exponentialRampToValueAtTime(Math.max(0.0001, sustain), a + Math.max(0.01, hold * 0.5));
  p.setValueAtTime(Math.max(0.0001, sustain), a + hold); p.exponentialRampToValueAtTime(0.0001, a + hold + release);
}

const VOICES: Record<string, () => Promise<Buf>> = {
  taiko: () => offline(1.4, ctx => {
    for (const [delay, f0, f1, g] of [[0, 92, 46, 1], [0.012, 120, 60, 0.45]] as const) {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(f0, delay); o.frequency.exponentialRampToValueAtTime(f1, delay + 0.25);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, delay); og.gain.linearRampToValueAtTime(g, delay + 0.004); og.gain.exponentialRampToValueAtTime(0.0001, delay + 1.2);
      o.connect(og).connect(ctx.destination); o.start(delay); o.stop(1.4);
    }
    const n = ctx.createBufferSource(); n.buffer = noise(ctx, 0.5);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, 0); ng.gain.linearRampToValueAtTime(0.9, 0.003); ng.gain.exponentialRampToValueAtTime(0.0001, 0.25);
    n.connect(lp).connect(ng).connect(ctx.destination); n.start(0);
  }),
  taikoHi: () => offline(0.8, ctx => {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(190, 0); o.frequency.exponentialRampToValueAtTime(110, 0.12);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, 0); og.gain.linearRampToValueAtTime(0.8, 0.003); og.gain.exponentialRampToValueAtTime(0.0001, 0.6);
    o.connect(og).connect(ctx.destination); o.start(0); o.stop(0.8);
    const n = ctx.createBufferSource(); n.buffer = noise(ctx, 0.2);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, 0); ng.gain.linearRampToValueAtTime(0.5, 0.002); ng.gain.exponentialRampToValueAtTime(0.0001, 0.08);
    n.connect(bp).connect(ng).connect(ctx.destination); n.start(0);
  }),
  snare: () => offline(0.7, ctx => {
    const n = ctx.createBufferSource(); n.buffer = noise(ctx, 0.7);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(0.75, 0.002); g.gain.exponentialRampToValueAtTime(0.0001, 0.45);
    n.connect(bp).connect(g).connect(ctx.destination); n.start(0);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(210, 0); o.frequency.exponentialRampToValueAtTime(160, 0.1);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, 0); og.gain.linearRampToValueAtTime(0.5, 0.002); og.gain.exponentialRampToValueAtTime(0.0001, 0.18);
    o.connect(og).connect(ctx.destination); o.start(0); o.stop(0.3);
  }),
  boom: () => offline(4, ctx => {
    const n = ctx.createBufferSource(); n.buffer = noise(ctx, 4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, 0); lp.frequency.exponentialRampToValueAtTime(90, 2.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(0.8, 0.003); g.gain.exponentialRampToValueAtTime(0.0001, 3.8);
    n.connect(lp).connect(g).connect(ctx.destination); n.start(0);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(75, 0); o.frequency.exponentialRampToValueAtTime(29, 1.8);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, 0); og.gain.linearRampToValueAtTime(1, 0.004); og.gain.exponentialRampToValueAtTime(0.0001, 3.2);
    o.connect(og).connect(ctx.destination); o.start(0); o.stop(4);
  }),
  sub: () => offline(3, ctx => {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(58, 0); o.frequency.exponentialRampToValueAtTime(26, 2.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(1, 0.02); g.gain.linearRampToValueAtTime(0, 2.9);
    o.connect(g).connect(ctx.destination); o.start(0); o.stop(3);
  }),
  // Reverse cymbal: two seconds of rising wash that ends exactly at its length (placed to end on a hit).
  revcym: () => offline(2, ctx => {
    for (const [f, q, g] of [[7000, 0.5, 0.7], [3200, 3, 0.3]] as const) {
      const n = ctx.createBufferSource(); n.buffer = noise(ctx, 2);
      const bp = ctx.createBiquadFilter(); bp.type = f > 5000 ? 'highpass' : 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const gg = ctx.createGain(); gg.gain.setValueAtTime(0.0001, 0); gg.gain.exponentialRampToValueAtTime(g, 1.97); gg.gain.linearRampToValueAtTime(0, 2);
      const p = ctx.createStereoPanner(); p.pan.value = f > 5000 ? -0.4 : 0.4;
      n.connect(bp).connect(gg).connect(p).connect(ctx.destination); n.start(0);
    }
  }),
  riser: () => offline(4, ctx => {
    const n = ctx.createBufferSource(); n.buffer = noise(ctx, 4);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.2; bp.frequency.setValueAtTime(250, 0); bp.frequency.exponentialRampToValueAtTime(8000, 3.98);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.6, 3.97); g.gain.linearRampToValueAtTime(0, 4);
    n.connect(bp).connect(g).connect(ctx.destination); n.start(0);
  }),
  // Orchestral hit: a short tutti stab (brass, strings and a cymbal) for the cuts.
  stab: () => offline(1.6, ctx => {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, 0); lp.frequency.exponentialRampToValueAtTime(3500, 0.03); lp.frequency.exponentialRampToValueAtTime(700, 0.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(0.7, 0.01); g.gain.exponentialRampToValueAtTime(0.0001, 1.2);
    const d = drive(ctx, 2); lp.connect(d).connect(g).connect(ctx.destination);
    for (const m of [26, 38, 45, 50, 53, 57]) ensemble(ctx, lp, m, 3, 12, 'sawtooth', 1.6, 0.5);
  }),
};

/** Spiccato strings: short bowed ensemble note. */
const strings = (midi: number, len: number, bright: number) => offline(len + 0.25, ctx => {
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500 + bright * 3500; lp.Q.value = 0.7;
  const g = ctx.createGain(); adsr(g.gain, 0.012, 0.5, len * 0.6, 0.15, 0.28);
  lp.connect(hp).connect(g).connect(ctx.destination);
  ensemble(ctx, lp, midi, 6, 14, 'sawtooth', len + 0.25);
  ensemble(ctx, lp, midi - 12, 2, 8, 'sawtooth', len + 0.25, 0.5);
});
/** Legato strings / pad chord: slow bows, vibrato. */
const legato = (notes: number[], len: number, bright: number) => offline(len + 1.5, ctx => {
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 + bright * 2800; lp.Q.value = 0.5;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
  const g = ctx.createGain(); adsr(g.gain, Math.min(0.8, len * 0.3), 0.22, len, 1.4);
  lp.connect(hp).connect(g).connect(ctx.destination);
  const vib = ctx.createOscillator(); vib.frequency.value = 5.2; const vg = ctx.createGain(); vg.gain.value = 6; vib.connect(vg); vib.start(0);
  for (const m of notes) {
    for (let v = 0; v < 4; v++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = (v - 1.5) * 7; vg.connect(o.detune);
      const p = ctx.createStereoPanner(); p.pan.value = (v / 3 - 0.5) * 1.8;
      const og = ctx.createGain(); og.gain.value = 0.5 / Math.sqrt(notes.length);
      o.connect(og).connect(p).connect(lp); o.start(rand() * 0.02); o.stop(len + 1.5);
    }
  }
});
/** Low brass: filter-swept saw stacks with drive; short for stabs, long for horn lines. */
const brass = (notes: number[], len: number, bright: number) => offline(len + 0.6, ctx => {
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(250, 0); lp.frequency.exponentialRampToValueAtTime(900 + bright * 2600, 0.06); lp.frequency.exponentialRampToValueAtTime(500 + bright * 1300, Math.max(0.1, len));
  const g = ctx.createGain(); adsr(g.gain, 0.025, 0.55, len, 0.35, 0.4);
  const d = drive(ctx, 1.8);
  lp.connect(d).connect(g).connect(ctx.destination);
  const vib = ctx.createOscillator(); vib.frequency.value = 4.8; const vg = ctx.createGain(); vg.gain.value = len > 0.6 ? 5 : 0; vib.connect(vg); vib.start(0.2);
  for (const m of notes) for (let v = 0; v < 3; v++) {
    const o = ctx.createOscillator(); o.type = v === 1 ? 'square' : 'sawtooth'; o.frequency.value = hz(m); o.detune.value = (v - 1) * 9; vg.connect(o.detune);
    const p = ctx.createStereoPanner(); p.pan.value = (v - 1) * 0.5;
    const og = ctx.createGain(); og.gain.value = 0.4 / Math.sqrt(notes.length); o.connect(og).connect(p).connect(lp); o.start(0); o.stop(len + 0.6);
  }
});
/** "Choir": saw ensemble through three vowel formants (an open 'ah'). */
const choir = (notes: number[], len: number) => offline(len + 2, ctx => {
  const sum = ctx.createGain();
  const g = ctx.createGain(); adsr(g.gain, Math.min(1.2, len * 0.35), 0.5, len, 1.8);
  for (const [f, q, gain] of [[750, 6, 1], [1150, 7, 0.6], [2700, 9, 0.25]] as const) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const fg = ctx.createGain(); fg.gain.value = gain; sum.connect(bp).connect(fg).connect(g);
  }
  g.connect(ctx.destination);
  const vib = ctx.createOscillator(); vib.frequency.value = 5; const vg = ctx.createGain(); vg.gain.value = 8; vib.connect(vg); vib.start(0);
  for (const m of notes) for (let v = 0; v < 5; v++) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = (v - 2) * 8; vg.connect(o.detune);
    const p = ctx.createStereoPanner(); p.pan.value = (v / 4 - 0.5) * 1.6;
    const og = ctx.createGain(); og.gain.value = 0.9 / Math.sqrt(notes.length * 5); o.connect(og).connect(p).connect(sum); o.start(rand() * 0.03); o.stop(len + 2);
  }
});
/** Braam: a wall of detuned, driven brass on the root, its octaves and fifth, swelling then dying. */
const braam = (root: number, len: number) => offline(len + 1, ctx => {
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5;
  lp.frequency.setValueAtTime(140, 0); lp.frequency.exponentialRampToValueAtTime(2200, 0.3); lp.frequency.exponentialRampToValueAtTime(380, len);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(0.6, 0.08); g.gain.setTargetAtTime(0.0001, len * 0.45, len * 0.28);
  const d = drive(ctx, 3);
  lp.connect(d).connect(g).connect(ctx.destination);
  for (const [m, n, c, gain] of [[root - 12, 3, 10, 1], [root, 6, 14, 0.8], [root + 7, 4, 12, 0.5], [root + 12, 4, 10, 0.4]] as const) ensemble(ctx, lp, m, n, c, 'sawtooth', len + 1, gain);
  const s = ctx.createOscillator(); s.frequency.value = hz(root - 24);
  const sg = ctx.createGain(); sg.gain.setValueAtTime(0.0001, 0); sg.gain.linearRampToValueAtTime(0.7, 0.05); sg.gain.setTargetAtTime(0.0001, len * 0.5, len * 0.3);
  s.connect(sg).connect(ctx.destination); s.start(0); s.stop(len + 1);
});

/** Shepard tone: octave-spaced partials that glide forever upward under a fixed bell-shaped window. */
function shepard(seconds: number, cycle: number, start = 0): Buf {
  const n = Math.ceil(seconds * RATE), L = new Float32Array(n), R = new Float32Array(n);
  const octaves = 8, base = 40, phases = new Float64Array(octaves);
  for (let i = 0; i < n; i++) {
    const t = i / RATE, pos = (start + t / cycle) % 1;
    let s = 0, w = 0;
    for (let k = 0; k < octaves; k++) {
      const oct = (k + pos) % octaves, f = base * 2 ** oct;
      const amp = 0.5 - 0.5 * Math.cos(2 * Math.PI * oct / octaves);
      phases[k] += f / RATE; s += Math.sin(2 * Math.PI * phases[k]) * amp; w += amp;
    }
    const v = s / w * 0.5;
    L[i] = v; R[i] = v * 0.9 + Math.sin(2 * Math.PI * 0.2 * t) * 0.1 * v;
  }
  return [L, R];
}

/** The game's CC0 recordings, onset-trimmed. */
async function loadSample(name: string): Promise<Buf> {
  const res = await fetch(`/assets/sfx/${name}.mp3`);
  const ctx = new OfflineAudioContext(2, RATE, RATE);
  const b = await ctx.decodeAudioData(await res.arrayBuffer());
  const d0 = b.getChannelData(0), d1 = b.numberOfChannels > 1 ? b.getChannelData(1) : d0;
  let onset = 0; while (onset < d0.length && Math.abs(d0[onset]) < 0.02) onset++;
  return [d0.slice(Math.max(0, onset - 24)), d1.slice(Math.max(0, onset - 24))];
}
const SAMPLES = ['shot-m110-1', 'shot-m110-3', 'shot-m1014-2', 'shot-m4a1-1', 'shot-m4a1-2', 'shot-m249-1', 'shot-m249-2', 'shot-m249-3', 'shot-m249-4',
  'foley-charge', 'foley-bolt', 'foley-rack', 'foley-clack', 'foley-slide', 'foley-shell', 'foley-click', 'foley-mag-in', 'foley-mag-out', 'foley-latch'];
const COCKS = ['foley-charge', 'foley-bolt', 'foley-rack', 'foley-slide', 'foley-clack'];

/** Sounds the game synthesizes itself (src/audio.ts), recorded offline. */
async function gameSounds(): Promise<Record<string, Buf>> {
  const LISTENER = { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }, AHEAD = { x: 0, y: 0, z: -4 };
  const toBuf = (b: AudioBuffer) => [b.getChannelData(0).slice(), b.getChannelData(1).slice()];
  const blast = toBuf(await Audio.record(3, s => s.explosion(LISTENER, AHEAD), RATE));
  const beep = toBuf(await Audio.record(0.3, s => s.bombBeep(), RATE));
  // The helicopter: the live engine voice spinning up over four seconds.
  const ctx = new OfflineAudioContext(2, 4.5 * RATE, RATE);
  const heli = new Audio();
  await heli.start(ctx);
  const v = heli.engine('heli') as EngineVoice;
  for (let i = 0; i < 18; i++) void ctx.suspend(Math.max(128 / RATE, i * 0.25)).then(() => { v.set(0.35 + 0.65 * Math.min(1, i / 16)); void ctx.resume(); });
  const rotor = toBuf(await ctx.startRendering());
  return { 'game-blast': blast, 'game-beep': beep, 'game-heli': rotor };
}

// ---------------------------------------------------------------------------------------------
// Arrangement
// ---------------------------------------------------------------------------------------------

interface Plan { notes: Note[]; seconds: number; hits: number[]; silences: [number, number][]; shepards: { at: number; seconds: number; gain: number }[] }

function arrange(sections: [Section, number][], cuts: number[]): Plan {
  const notes: Note[] = [], hits: number[] = [], silences: [number, number][] = [], shepards: Plan['shepards'] = [];
  const add = (at: number, voice: string, gain: number, bus: Bus, extra: Partial<Note> = {}) => notes.push({ at, voice, gain, bus, ...extra });
  const triad = (c: string, octave = 0) => { const [r, t, f] = CH[c]; return [r + 12 + octave, r + 12 + t + octave, r + 12 + f + octave]; };
  let cock = 0;
  const bigHit = (t: number, kind: 'title' | 'drop' | 'climax' | 'end', root = 38) => {
    hits.push(t);
    const first = notes.length;
    add(t - 2, 'revcym', kind === 'title' ? 0.7 : 0.9, 'hit', { hall: 0.3 });
    add(t, 'boom', 1, 'hit', { hall: 0.3 }); add(t, 'sub', 0.9, 'hit');
    add(t, `braam:${root}|${kind === 'end' ? 6 : 3}`, kind === 'end' ? 1 : 0.8, 'hit', { hall: 0.45 });
    add(t, kind === 'drop' ? 'shot-m1014-2' : 'shot-m110-1', 0.85, 'hit', { tail: 1, hall: 0.2 });
    add(t, 'taiko', 1.1, 'hit', { hall: 0.3 }); add(t + 0.01, 'taiko', 0.8, 'hit', { pan: -0.4, hall: 0.3 }); add(t + 0.02, 'taiko', 0.8, 'hit', { pan: 0.4, hall: 0.3 });
    if (kind === 'end') add(t, 'game-blast', 1, 'hit', { tail: 0.6 });
    if (kind !== 'title') add(t, 'stab', 0.7, 'hit', { hall: 0.5 });
    for (let i = first; i < notes.length; i++) notes[i].impact = true;
  };

  let beat0 = 0;
  const total = sections.reduce((n, [, b]) => n + b, 0);
  sections.forEach(([kind, beats], si) => {
    const start = beat0 * BEAT, end = (beat0 + beats) * BEAT, next = sections[si + 1]?.[0];
    const prog = PROG[kind];
    const bars = Math.ceil(beats / 4);
    for (let b = 0; b < bars; b++) {
      const t = start + b * BAR, at = (q: number) => t + q * BEAT, inBar = (q: number) => b * 4 + q < beats;
      const chord = prog[b % prog.length], [root] = CH[chord], tri = triad(chord);
      const barLen = Math.min(BAR, end - t);
      // ---- Beds ----
      if (kind === 'open') {
        add(t, `legato:${[root - 12, root + 7 - 12, root].join(',')}|${barLen}|0.1`, 0.55 + b * 0.12, 'bed', { hall: 0.6 });
        add(at(0), 'taiko', 0.35 + b * 0.12, 'hit', { hall: 0.7 });
        if (b % 2 === 1) add(at(2.5), 'taikoHi', 0.25, 'hit', { hall: 0.7, pan: 0.3 });
      }
      if (kind === 'title' || kind === 'end') {
        if (b === 0) {
          add(t, `legato:${[root - 12, root, root + 7, root + 12, root + 15].join(',')}|${(end - start) * 0.9}|0.4`, 0.8, 'bed', { hall: 0.7 });
          if (kind === 'end') add(t, `choir:${[root + 12, root + 19, root + 24, root + 27].join(',')}|${(end - start) * 0.75}`, 0.7, 'bed', { hall: 0.8 });
        }
      }
      if (kind === 'store' || kind === 'guns' || kind === 'tension' || kind === 'fill' || kind === 'drop' || kind === 'climax' || kind === 'rise') {
        const energy = { store: 0.35, guns: 0.6, tension: 0.5, fill: 0.7, drop: 1, climax: 1, rise: 0.8 }[kind];
        // String ostinato: chord tones around the root an octave up, 8ths when calm, 16ths when driving.
        const sixteenths = kind === 'guns' || kind === 'drop' || kind === 'climax' || kind === 'fill' || (kind === 'rise');
        const pat = [0, 12, CH[chord][2], 12, CH[chord][1], 12, CH[chord][2], 12];
        const step = sixteenths ? 0.25 : 0.5, len = step * BEAT * 0.9;
        for (let q = 0; q < 4; q += step) if (inBar(q)) {
          const i = Math.round(q / step) % pat.length;
          add(at(q), `str:${root + 12 + pat[i]}|${len.toFixed(3)}|${energy.toFixed(2)}`, (q % 1 === 0 ? 0.9 : 0.65) * (0.7 + 0.5 * energy), 'bed', { hall: 0.35, pan: i % 2 ? 0.25 : -0.25 });
        }
        if (kind !== 'store') add(t, `legato:${tri.join(',')}|${barLen}|${energy.toFixed(2)}`, 0.45 + 0.4 * energy, 'bed', { hall: 0.55 });
        if (kind === 'tension' || kind === 'fill') add(t, `legato:${[root - 12, root].join(',')}|${barLen}|0.2`, 0.6, 'bed', { hall: 0.4 });
      }
      // ---- Drums ----
      if (kind === 'store') {
        for (const q of [0, 2]) if (inBar(q)) add(at(q), 'taiko', 0.55, 'hit', { hall: 0.45 });
        for (let s = 0; s < 4; s++) if (s % 2 && inBar(s)) add(at(s + 0.5), 'foley-shell', 0.35, 'hit', { pan: 0.5, hall: 0.25, rate: 1.1 });
      }
      if (kind === 'guns' || kind === 'drop' || kind === 'climax') {
        const heavy = kind !== 'guns';
        for (const [q, g] of [[0, 1], [0.75, 0.6], [1.5, 0.8], [2, 0.9], [2.75, 0.6], [3, 0.85], [3.5, 0.7]] as const) if (inBar(q)) add(at(q), 'taiko', g * (heavy ? 1 : 0.8), 'hit', { hall: 0.35, pan: (q % 1) ? 0.3 : -0.1 });
        for (const q of [1, 3]) if (inBar(q)) { add(at(q), 'snare', heavy ? 0.85 : 0.6, 'hit', { hall: 0.4 }); if (heavy) add(at(q), b % 2 ? 'shot-m4a1-2' : 'shot-m4a1-1', 0.35, 'hit', { hall: 0.3, pan: b % 2 ? 0.3 : -0.3 }); }
        // Shell casings as hats: eighths in the drops, a sixteenth fill closing every second bar.
        if (heavy) for (let q = 0.5; q < 4; q += 1) if (inBar(q)) add(at(q), 'foley-shell', 0.32, 'hit', { pan: 0.55, hall: 0.2, rate: 1.05 + (q % 2) * 0.1 });
        if (b % 2 === 1) for (let s = 0; s < 4; s++) if (inBar(3 + s / 4)) add(at(3 + s / 4), 'foley-shell', 0.25 + s * 0.06, 'hit', { pan: -0.5 + s * 0.3, hall: 0.25, rate: 1 + s * 0.06 });
        // Low brass stabs on the chord.
        if (kind !== 'guns' || b % 2 === 0) for (const q of kind === 'guns' ? [0] : [0, 1.5, 3]) if (inBar(q)) add(at(q), `brass:${[root - 12, root, root + 7].join(',')}|${q === 0 ? 0.55 : 0.28}|${kind === 'climax' ? 0.8 : 0.6}`, q === 0 ? 0.9 : 0.6, 'bed', { hall: 0.4 });
      }
      if (kind === 'tension') {
        add(at(0), 'taiko', 0.9, 'hit', { hall: 0.45 });
        if (inBar(2.5)) add(at(2.5), 'taiko', 0.6, 'hit', { hall: 0.45, pan: 0.3 });
        if (inBar(3)) add(at(3), 'snare', 0.4, 'hit', { hall: 0.6 });
        // The bomb's beep as the pulse, quickening through the section.
        const rate = b < bars / 3 ? 1 : b < bars * 2 / 3 ? 2 : 4;
        for (let q = 0; q < 4; q += 1 / rate) if (inBar(q)) add(at(q), 'game-beep', 0.22, 'hit', { hall: 0.4, pan: 0.2 });
      }
      if (kind === 'fill' || kind === 'rise') {
        const k = (b + 1) / bars;
        for (const q of [0, 1, 2, 3]) if (inBar(q)) add(at(q), 'taiko', 0.5 + 0.4 * k, 'hit', { hall: 0.4 });
        if (b >= bars - 2) for (let s = 0; s < 16; s++) if (inBar(s / 4)) add(at(s / 4), 'snare', 0.12 + 0.5 * ((b - (bars - 2)) * 16 + s) / 32, 'hit', { hall: 0.4, pan: s % 2 ? 0.2 : -0.2 });
        if (inBar(0)) add(at(0), `brass:${[root - 12, root].join(',')}|1.2|0.4`, 0.6, 'bed', { hall: 0.5 });
      }
      // ---- The theme ----
      if (kind === 'climax') {
        for (const [tb, q, midi, len] of THEME) if (tb === b && inBar(q)) {
          add(at(q), `brass:${[midi - 12, midi - 24].join(',')}|${(len * BEAT * 0.95).toFixed(3)}|0.9`, 0.75, 'bed', { hall: 0.5 });
          add(at(q), `str:${midi}|${(len * BEAT * 0.95).toFixed(3)}|1`, 0.45, 'bed', { hall: 0.5 });
        }
        if (b % 2 === 0) add(t, `choir:${tri.map(m => m + 12).join(',')}|${(BAR * 2 * 0.95).toFixed(3)}`, 0.6, 'bed', { hall: 0.7 });
      }
      if (kind === 'drop' && b >= 4) add(t, `choir:${tri.map(m => m + 12).join(',')}|${(barLen * 0.95).toFixed(3)}`, 0.4, 'bed', { hall: 0.7 });
    }

    // ---- Section entrances ----
    if (kind === 'title') bigHit(start, 'title');
    if (kind === 'drop') bigHit(start, 'drop');
    if (kind === 'climax') bigHit(start, 'climax', 34);
    if (kind === 'end') bigHit(start, 'end');
    if (kind === 'store' || kind === 'guns' || kind === 'tension' || kind === 'fill') { add(start, 'stab', 0.55, 'hit', { hall: 0.5 }); add(start, 'sub', 0.5, 'hit'); hits.push(start); }
    if (kind === 'tension') add(start, 'shot-m110-3', 0.6, 'hit', { tail: 1 });
    // Tension builds: Shepard tones under the suspense.
    if (kind === 'tension') shepards.push({ at: start, seconds: end - start, gain: 0.12 });
    if (kind === 'fill' || kind === 'rise') shepards.push({ at: start, seconds: end - start - (kind === 'rise' ? BEAT : 0), gain: 0.22 });
    // Into the drop: the helicopter spinning up, then an M249 burst as the fill.
    if (next === 'drop') {
      const swell = Math.min(4, end - start);
      add(end - swell, 'game-heli', 0.75, 'hit', { hall: 0.2 });
      add(end - 2, 'riser', 0.6, 'hit', { hall: 0.3, rate: 2 });
      for (let i = 0; i < 9; i++) add(end - BEAT * 1.5 + i * (1 / 9) * 1.3, `shot-m249-${(i % 4) + 1}`, 0.35 + i * 0.05, 'hit', { hall: 0.25, pan: (i % 2 ? 0.2 : -0.2) });
    }
    if (next === 'climax' || next === 'title' || next === 'end') add(end - 4, 'riser', 0.55, 'hit', { hall: 0.3 });
    // Stops: a silent beat (a casing falls in it) before the montage; the last beat before the end card holds only a dry-fire click.
    if (kind === 'silence') { silences.push([start, end]); add(start + 0.3, 'foley-shell', 0.6, 'post', { rate: 0.95 }); add(start + 0.55, 'foley-shell', 0.35, 'post', { rate: 1.1, pan: 0.3 }); }
    if (kind === 'rise') { silences.push([end - BEAT, end]); add(end - BEAT * 0.5, 'foley-click', 0.9, 'post'); }
    beat0 += beats;
  });

  // Gun handling on the picture's cuts: charging handles, bolts and slides as percussion.
  const zones = new Set<Section>(['guns', 'tension', 'fill', 'drop', 'climax']);
  const sectionAt = (t: number) => { let acc = 0; for (const [k, b] of sections) { if (t < (acc + b) * BEAT - 1e-6) return k; acc += b; } return 'end' as Section; };
  for (const c of cuts) {
    if (!zones.has(sectionAt(c)) || hits.some(h => Math.abs(h - c) < 0.1)) continue;
    add(c, COCKS[cock++ % COCKS.length], 0.95, 'hit', { hall: 0.3, pan: cock % 2 ? 0.25 : -0.25 });
    add(c, 'taikoHi', 0.6, 'hit', { hall: 0.3 });
  }
  // Dynamics across the acts: everything but the impacts sits at its section's level, so the drop and
  // the climax open up against the build.
  const LEVEL: Record<Section, number> = { open: 0.75, title: 0.85, store: 0.55, guns: 0.7, tension: 0.6, fill: 0.75, drop: 1, silence: 1, climax: 1, rise: 0.85, end: 0.9 };
  for (const n of notes) if (!n.impact && n.bus !== 'post') n.gain *= LEVEL[sectionAt(n.at + 0.01)];
  for (const s of shepards) s.gain *= LEVEL[sectionAt(s.at + 0.01)];
  return { notes, seconds: total * BEAT, hits, silences, shepards };
}

// ---------------------------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------------------------

/** Hall impulse response: early reflections, then a decorrelated, darkening stereo tail. */
function hall(seconds: number, rt60: number, damping: number): AudioBuffer {
  const n = Math.ceil(seconds * RATE), ir = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: RATE });
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (const [ms, g] of [[11, 0.5], [19, 0.35], [27, 0.42], [37, 0.3], [49, 0.25], [61, 0.2], [79, 0.18]]) d[Math.round((ms + c * 3.7) * RATE / 1000)] += g * (c ? -1 : 1);
    let lp = 0;
    for (let i = Math.round(0.02 * RATE); i < n; i++) {
      const t = i / n, a = Math.min(0.97, damping * t);
      lp = lp * a + (rand() * 2 - 1) * (1 - a);
      d[i] += lp * Math.exp(-6.9 * (i / RATE) / rt60) * 0.6;
    }
  }
  return ir;
}

function mixInto(dry: Buf, wets: Record<'hall' | 'tail', Buf>, n: Note, src: Buf) {
  const rate = n.rate ?? 1, first = Math.round(n.at * RATE);
  const frames = Math.floor((src[0].length - 1) / rate);
  const angle = ((n.pan ?? 0) + 1) * Math.PI / 4;
  for (let c = 0; c < 2; c++) {
    const s = src[c], out = dry[c], h = wets.hall[c], tl = wets.tail[c], g = n.gain * (c ? Math.sin(angle) : Math.cos(angle)) * Math.SQRT2;
    const hs = n.hall ?? 0, ts = n.tail ?? 0;
    for (let i = 0; i < frames; i++) {
      const at = first + i;
      if (at < 0 || at >= out.length) continue;
      const x = i * rate, k = Math.floor(x), f = x - k;
      const v = (s[k] + ((s[k + 1] ?? 0) - s[k]) * f) * g;
      out[at] += v; if (hs) h[at] += v * hs; if (ts) tl[at] += v * ts;
    }
  }
}

export async function renderScore(sections: [Section, number][], cuts: number[]): Promise<AudioBuffer> {
  seed = 0x2545f491;
  const plan = arrange(sections, cuts);
  const tail = 4, length = Math.ceil((plan.seconds + tail) * RATE);
  const samples = Object.fromEntries(await Promise.all(SAMPLES.map(async f => [f, await loadSample(f)] as const)));
  const game = await gameSounds();
  const cache = new Map<string, Buf>();
  const voice = async (key: string): Promise<Buf> => {
    const hit = cache.get(key) ?? samples[key] ?? game[key];
    if (hit) return hit;
    let buf: Buf;
    if (VOICES[key]) buf = await VOICES[key]();
    else {
      const [kind, rest] = key.split(':'), [a, b, c] = rest.split('|'), list = a.split(',').map(Number), len = Number(b);
      buf = kind === 'str' ? await strings(list[0], len, Number(c))
        : kind === 'legato' ? await legato(list, len, Number(c))
        : kind === 'brass' ? await brass(list, len, Number(c))
        : kind === 'choir' ? await choir(list, len)
        : await braam(list[0], len);
    }
    cache.set(key, buf);
    return buf;
  };
  const mk = () => [new Float32Array(length), new Float32Array(length)];
  const buses: Record<Bus, Buf> = { bed: mk(), hit: mk(), post: mk() };
  const wets: Record<Bus, Record<'hall' | 'tail', Buf>> = { bed: { hall: mk(), tail: mk() }, hit: { hall: mk(), tail: mk() }, post: { hall: mk(), tail: mk() } };
  for (const n of plan.notes) mixInto(buses[n.bus], wets[n.bus], n, await voice(n.voice));
  for (const s of plan.shepards) mixInto(buses.bed, wets.bed, { at: s.at, voice: 'shepard', gain: s.gain, bus: 'bed', hall: 0.4 }, shepard(s.seconds, 6, 0));

  // Sidechain: the beds (strings, brass, choir) dip under every impact and recover over half a second.
  const duck = new Float32Array(length).fill(1);
  for (const h of plan.hits) {
    const i0 = Math.round(h * RATE);
    for (let i = i0; i < Math.min(length, i0 + RATE * 1.5); i++) duck[i] = Math.min(duck[i], 1 - 0.55 * Math.exp(-(i - i0) / RATE / 0.35));
  }
  for (const b of [buses.bed, wets.bed.hall, wets.bed.tail]) for (const ch of b) for (let i = 0; i < length; i++) ch[i] *= duck[i];

  const ctx = new OfflineAudioContext(2, length, RATE);
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -14; glue.ratio.value = 2.5; glue.knee.value = 10; glue.attack.value = 0.015; glue.release.value = 0.3;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 28;
  hp.connect(glue).connect(ctx.destination);
  const hallIn = ctx.createGain(); hallIn.gain.value = 0.5;
  const hallConv = ctx.createConvolver(); hallConv.normalize = true; hallConv.buffer = hall(4.5, 3.4, 0.9);
  const hallEq = ctx.createBiquadFilter(); hallEq.type = 'highpass'; hallEq.frequency.value = 180;
  hallIn.connect(hallConv).connect(hallEq).connect(hp);
  const tailIn = ctx.createGain(); tailIn.gain.value = 0.6;
  const tailConv = ctx.createConvolver(); tailConv.normalize = true; tailConv.buffer = hall(7, 5.5, 0.95);
  const tailEq = ctx.createBiquadFilter(); tailEq.type = 'highpass'; tailEq.frequency.value = 140;
  tailIn.connect(tailConv).connect(tailEq).connect(hp);
  const feed = (bus: Buf, dest: AudioNode) => {
    const b = ctx.createBuffer(2, length, RATE); b.copyToChannel(bus[0] as Float32Array<ArrayBuffer>, 0); b.copyToChannel(bus[1] as Float32Array<ArrayBuffer>, 1);
    const src = ctx.createBufferSource(); src.buffer = b; src.connect(dest); src.start();
  };
  for (const bus of ['bed', 'hit'] as const) { feed(buses[bus], hp); feed(wets[bus].hall, hallIn); feed(wets[bus].tail, tailIn); }
  const out = await ctx.startRendering();

  // Stops: everything (tails too) drops out for the silent beats, then the post elements play in the hole.
  const gate = new Float32Array(length).fill(1);
  for (const [a, b] of plan.silences) {
    const i0 = Math.round(a * RATE), i1 = Math.round(b * RATE), fade = Math.round(0.03 * RATE);
    for (let i = i0; i < i1; i++) gate[i] = Math.min(gate[i], Math.max(0, 1 - (i - i0) / fade), Math.max(0, (i - (i1 - fade)) / fade));
  }
  let peak = 0;
  for (let c = 0; c < 2; c++) {
    const d = out.getChannelData(c), post = buses.post[c];
    for (let i = 0; i < length; i++) { d[i] = d[i] * gate[i] + post[i] * 0.8; peak = Math.max(peak, Math.abs(d[i])); }
  }
  // Peak-normalize to -1 dBFS with a soft knee over the top few dB; the final loudness is set in the edit (build.ts).
  const scale = 1.1 / (peak || 1);
  for (let c = 0; c < 2; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const v = d[i] * scale, a = Math.abs(v); d[i] = a < 0.7 ? v : Math.sign(v) * (0.7 + 0.19 * Math.tanh((a - 0.7) / 0.19)); }
    const fade = Math.floor(tail * RATE);
    for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
  }
  return out;
}

/** Hits and stops of a plan (for checking them against the cuts). */
export function scoreMarkers(sections: [Section, number][], cuts: number[]) {
  const p = arrange(sections, cuts);
  return { hits: p.hits, silences: p.silences, cocks: p.notes.filter(n => COCKS.includes(n.voice)).map(n => n.at) };
}
