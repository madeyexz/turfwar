/**
 * The trailer's score: an original piece in D minor at 120 BPM, composed by rule and rendered
 * offline in the browser (trailer/web/audio.ts runs it). It follows the menu theme's approach
 * (src/theme.ts): every voice is rendered once as a one-shot, then the notes are mixed by hand into
 * dry and reverb-send buses, and a short master chain (reverb, glue compressor, soft clip) finishes it.
 *
 * Voices: synthesized kick, snare, hats, toms, sub drops, risers, reverse swells, a detuned-saw
 * "braam", pads, a pulsing bass, an arp pluck and a lead; and the game's own CC0 recordings
 * (public/assets/sfx: M4A1, M9A1, M1014 and M110 shots, mag and bolt foley) as layered hits.
 *
 * A cut is a list of sections ([kind, bars]) — the edit (trailer/edit.ts) is cut to the same bars,
 * so the hits land on the picture's cuts.
 */
import { reverbImpulse } from '../../src/audio';
import type { Section } from '../edit';

export const BPM = 120;
const BEAT = 60 / BPM;
const BAR = 4 * BEAT;
export const RATE = 48000;

type Buf = Float32Array[];
interface Note { at: number; voice: string; gain: number; pan?: number; wet?: number; rate?: number; length?: number }

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** D minor: i – VI – III – VII (Dm, Bb, F, C) as bass roots and pad voicings. */
const PROG = [
  { root: 38, pad: [62, 65, 69, 74] },
  { root: 34, pad: [62, 65, 70, 74] },
  { root: 41, pad: [60, 65, 69, 72] },
  { root: 36, pad: [60, 64, 67, 72] },
];
/** Main theme over four bars (one per chord): [bar, beat, midi, beats long]. */
const THEME: [number, number, number, number][] = [
  [0, 0, 74, 1], [0, 1, 77, 0.5], [0, 1.5, 76, 0.5], [0, 2, 74, 1], [0, 3, 69, 1],
  [1, 0, 70, 1.5], [1, 1.5, 74, 0.5], [1, 2, 77, 1], [1, 3, 79, 1],
  [2, 0, 81, 1.5], [2, 1.5, 79, 0.5], [2, 2, 77, 1], [2, 3, 76, 0.5], [2, 3.5, 77, 0.5],
  [3, 0, 76, 2], [3, 2, 72, 1], [3, 3, 76, 1],
];
/** Short drop motif (lead stabs), one bar per chord. */
const MOTIF: [number, number][] = [[0, 0], [0.75, 0], [1.5, 1], [2.5, 0], [3, 2], [3.5, 1]];

// ---------------------------------------------------------------------------------------------
// One-shot voices
// ---------------------------------------------------------------------------------------------

async function offline(seconds: number, build: (ctx: OfflineAudioContext, out: AudioNode) => void) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * RATE), RATE);
  build(ctx, ctx.destination);
  const b = await ctx.startRendering();
  return [b.getChannelData(0).slice(), b.getChannelData(1).slice()];
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number) {
  const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 1234567;
  for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  return b;
}

function env(g: AudioParam, t: number, a: number, peak: number, d: number, curve = 'exp') {
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(peak, t + a);
  if (curve === 'exp') g.exponentialRampToValueAtTime(0.0001, t + a + d); else g.linearRampToValueAtTime(0, t + a + d);
}

const VOICES: Record<string, () => Promise<Buf>> = {
  kick: () => offline(0.6, (ctx, out) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(160, 0); o.frequency.exponentialRampToValueAtTime(44, 0.13);
    env(g.gain, 0, 0.002, 1, 0.5); o.connect(g).connect(out); o.start(0); o.stop(0.6);
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.02);
    const ng = ctx.createGain(); env(ng.gain, 0, 0.001, 0.35, 0.015); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    n.connect(hp).connect(ng).connect(out); n.start(0);
  }),
  snare: () => offline(0.5, (ctx, out) => {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.5);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.7;
    const g = ctx.createGain(); env(g.gain, 0, 0.001, 0.8, 0.22); n.connect(bp).connect(g).connect(out); n.start(0);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(220, 0); o.frequency.exponentialRampToValueAtTime(150, 0.08);
    const og = ctx.createGain(); env(og.gain, 0, 0.001, 0.6, 0.12); o.connect(og).connect(out); o.start(0); o.stop(0.3);
  }),
  hat: () => offline(0.12, (ctx, out) => {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.12);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
    const g = ctx.createGain(); env(g.gain, 0, 0.001, 0.5, 0.05); n.connect(hp).connect(g).connect(out); n.start(0);
  }),
  ohat: () => offline(0.5, (ctx, out) => {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.5);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6500;
    const g = ctx.createGain(); env(g.gain, 0, 0.002, 0.4, 0.35); n.connect(hp).connect(g).connect(out); n.start(0);
  }),
  tom: () => offline(0.8, (ctx, out) => {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(110, 0); o.frequency.exponentialRampToValueAtTime(62, 0.4);
    const g = ctx.createGain(); env(g.gain, 0, 0.003, 0.9, 0.6); o.connect(g).connect(out); o.start(0); o.stop(0.8);
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const ng = ctx.createGain(); env(ng.gain, 0, 0.001, 0.4, 0.12); n.connect(lp).connect(ng).connect(out); n.start(0);
  }),
  sub: () => offline(2.4, (ctx, out) => {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(70, 0); o.frequency.exponentialRampToValueAtTime(27, 2.2);
    const g = ctx.createGain(); env(g.gain, 0, 0.01, 1, 2.3, 'lin'); o.connect(g).connect(out); o.start(0); o.stop(2.4);
  }),
  boom: () => offline(3.5, (ctx, out) => {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 3.5);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(5000, 0); lp.frequency.exponentialRampToValueAtTime(120, 2.5);
    const g = ctx.createGain(); env(g.gain, 0, 0.002, 0.9, 3.2); n.connect(lp).connect(g).connect(out); n.start(0);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, 0); o.frequency.exponentialRampToValueAtTime(30, 1.5);
    const og = ctx.createGain(); env(og.gain, 0, 0.002, 1, 2.5); o.connect(og).connect(out); o.start(0); o.stop(3.5);
  }),
  // Rising noise swell over one bar (played at other rates for longer or shorter builds).
  riser: () => offline(BAR * 2, (ctx, out) => {
    const T = BAR * 2;
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, T);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(300, 0); bp.frequency.exponentialRampToValueAtTime(9000, T);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.9, T - 0.02); g.gain.linearRampToValueAtTime(0, T);
    n.connect(bp).connect(g).connect(out); n.start(0);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(110, 0); o.frequency.exponentialRampToValueAtTime(880, T);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, 0); lp.frequency.exponentialRampToValueAtTime(5000, T);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, 0); og.gain.exponentialRampToValueAtTime(0.18, T - 0.02); og.gain.linearRampToValueAtTime(0, T);
    o.connect(lp).connect(og).connect(out); o.start(0); o.stop(T);
  }),
  swell: () => offline(BAR, (ctx, out) => {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, BAR);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.6, BAR - 0.01); g.gain.linearRampToValueAtTime(0, BAR);
    n.connect(hp).connect(g).connect(out); n.start(0);
  }),
  beep: () => offline(0.15, (ctx, out) => {
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1760;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
    const g = ctx.createGain(); env(g.gain, 0, 0.002, 0.25, 0.1); o.connect(lp).connect(g).connect(out); o.start(0); o.stop(0.15);
  }),
};

/** Sustained or pitched voices, rendered per pitch and length. */
function braam(root: number, seconds: number) {
  return offline(seconds + 0.6, (ctx, out) => {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(180, 0); lp.frequency.exponentialRampToValueAtTime(1400, 0.35); lp.frequency.exponentialRampToValueAtTime(300, seconds);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(0.5, 0.06); g.gain.setTargetAtTime(0.0001, seconds * 0.55, seconds * 0.25);
    lp.connect(g).connect(out);
    for (const [m, det] of [[root, -9], [root, 8], [root + 12, 4], [root + 7, -5], [root - 12, 0]] as const) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = m < root ? 0.7 : 0.35; o.connect(og).connect(lp); o.start(0); o.stop(seconds + 0.6);
    }
  });
}
function pad(notes: number[], seconds: number, bright: number) {
  return offline(seconds + 1.2, (ctx, out) => {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600 + bright * 2600; lp.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(0.16, Math.min(0.9, seconds * 0.4));
    g.gain.setValueAtTime(0.16, seconds); g.gain.linearRampToValueAtTime(0.0001, seconds + 1.1);
    lp.connect(g).connect(out);
    notes.forEach((m, i) => {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det + i;
        const p = ctx.createStereoPanner(); p.pan.value = det < 0 ? -0.5 : 0.5;
        o.connect(p).connect(lp); o.start(0); o.stop(seconds + 1.2);
      }
    });
  });
}
function bass(midi: number, seconds: number) {
  return offline(seconds + 0.05, (ctx, out) => {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
    lp.frequency.setValueAtTime(1600, 0); lp.frequency.exponentialRampToValueAtTime(220, Math.min(0.25, seconds));
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(0.55, 0.004); g.gain.setValueAtTime(0.55, seconds - 0.03); g.gain.linearRampToValueAtTime(0, seconds);
    lp.connect(g).connect(out);
    for (const [type, mult, gain] of [['sawtooth', 1, 0.6], ['square', 0.5, 0.4], ['sine', 0.5, 0.8]] as const) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(midi) * mult;
      const og = ctx.createGain(); og.gain.value = gain; o.connect(og).connect(lp); o.start(0); o.stop(seconds + 0.05);
    }
  });
}
function pluck(midi: number, seconds: number, bright = 1) {
  return offline(seconds + 0.4, (ctx, out) => {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(800 + 5200 * bright, 0); lp.frequency.exponentialRampToValueAtTime(500, seconds + 0.3);
    const g = ctx.createGain(); env(g.gain, 0, 0.003, 0.3, seconds + 0.3);
    lp.connect(g).connect(out);
    for (const [type, det] of [['square', -6], ['sawtooth', 6]] as const) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(midi); o.detune.value = det; o.connect(lp); o.start(0); o.stop(seconds + 0.4);
    }
  });
}
function lead(midi: number, seconds: number) {
  return offline(seconds + 0.5, (ctx, out) => {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 1;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(0.22, 0.02); g.gain.setValueAtTime(0.2, seconds); g.gain.linearRampToValueAtTime(0, seconds + 0.45);
    lp.connect(g).connect(out);
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5; const vg = ctx.createGain(); vg.gain.value = 9; vib.connect(vg); vib.start(0);
    for (const [type, det, gain] of [['sawtooth', -8, 0.5], ['sawtooth', 8, 0.5], ['square', 0, 0.3]] as const) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(midi); o.detune.value = det; vg.connect(o.detune);
      const og = ctx.createGain(); og.gain.value = gain; o.connect(og).connect(lp); o.start(0); o.stop(seconds + 0.5);
    }
  });
}

/** The game's own recordings (CC0, public/assets/sfx) as hit layers. */
const SAMPLES = { gun: 'shot-m4a1-1', pistol: 'shot-m9a1-2', shotgun: 'shot-m1014-1', sniper: 'shot-m110-1', magOut: 'foley-mag-out', magIn: 'foley-mag-in', bolt: 'foley-bolt', charge: 'foley-charge' };
async function loadSample(name: string): Promise<Buf> {
  const res = await fetch(`/assets/sfx/${name}.mp3`);
  const ctx = new OfflineAudioContext(2, RATE, RATE);
  const b = await ctx.decodeAudioData(await res.arrayBuffer());
  // Skip the encoder's lead-in: start at the first sample above the noise floor.
  const d0 = b.getChannelData(0), d1 = b.numberOfChannels > 1 ? b.getChannelData(1) : d0;
  let onset = 0; while (onset < d0.length && Math.abs(d0[onset]) < 0.02) onset++;
  return [d0.slice(Math.max(0, onset - 20)), d1.slice(Math.max(0, onset - 20))];
}

// ---------------------------------------------------------------------------------------------
// Arrangement
// ---------------------------------------------------------------------------------------------

/** Notes for a cut's sections; sustained voices are keyed by pitch and length (`pad:62,65|4`). */
function arrange(sections: [Section, number][]) {
  const notes: Note[] = [];
  const add = (at: number, voice: string, gain: number, extra: Partial<Note> = {}) => notes.push({ at, voice, gain, ...extra });
  let bar0 = 0;
  const total = sections.reduce((n, [, b]) => n + b, 0);
  sections.forEach(([kind, bars], si) => {
    const next = sections[si + 1]?.[0];
    const start = bar0 * BAR;
    for (let b = 0; b < bars; b++) {
      const t = (bar0 + b) * BAR, at = (beat: number) => t + beat * BEAT;
      const chord = PROG[(bar0 + b) % 4], last = b === bars - 1;
      const big = kind === 'drop' || kind === 'drop2';
      // ---- Pads and drones ----
      if (kind === 'intro') { add(t, `pad:${[50, 57, 62].join(',')}|${BAR}|0.15`, 0.45 + b * 0.08, { wet: 0.6 }); add(t, `bass:26|${BAR}`, 0.3 + b * 0.06); }
      else if (kind === 'title' || kind === 'outro') { if (b % 2 === 0) add(t, `pad:${[50, 57, 62, 65].join(',')}|${BAR * 2}|0.35`, 0.65, { wet: 0.7 }); }
      else add(t, `pad:${chord.pad.join(',')}|${BAR}|${big ? 0.7 : kind === 'theme' ? 0.9 : 0.4}`, big ? 0.42 : kind === 'theme' ? 0.55 : kind === 'build' || kind === 'rise' ? 0.45 : 0.35, { wet: 0.55 });

      // ---- Drums ----
      if (kind === 'intro') {
        for (let q = 0; q < 4; q++) add(at(q), 'hat', 0.25 + 0.1 * b, { pan: 0.3 });
        if (b >= Math.max(0, bars - 2)) { add(at(0), 'kick', 0.8); add(at(0.75), 'kick', 0.5); add(at(2), 'kick', 0.8); add(at(2.75), 'kick', 0.5); }
      }
      if (kind === 'title') {
        if (b === bars - 1) for (const q of [2, 2.5, 3, 3.25, 3.5, 3.75]) add(at(q), 'tom', 0.5 + q * 0.08, { wet: 0.3 });
      }
      if (kind === 'build' || kind === 'rise') {
        const k = (b + 1) / bars;
        for (let q = 0; q < 4; q++) add(at(q), 'kick', 0.6 + 0.4 * k);
        for (let e = 0; e < 8; e++) add(at(e / 2), 'hat', 0.18 + 0.2 * k, { pan: e % 2 ? 0.35 : -0.2 });
        if (b >= bars / 2) { add(at(1), 'snare', 0.5 * k, { wet: 0.3 }); add(at(3), 'snare', 0.5 * k, { wet: 0.3 }); }
        if (last) { for (let s = 0; s < 16; s++) add(at(s / 4), 'snare', 0.15 + s * 0.035, { wet: 0.25, pan: s % 2 ? 0.2 : -0.2 }); }
      }
      if (big || kind === 'theme') {
        for (let q = 0; q < 4; q++) add(at(q), 'kick', 1);
        add(at(1), 'snare', 0.7, { wet: 0.3 }); add(at(3), 'snare', 0.7, { wet: 0.3 });
        add(at(1), 'gun', kind === 'drop2' ? 0.4 : 0.3, { wet: 0.35 }); add(at(3), 'gun', kind === 'drop2' ? 0.4 : 0.3, { wet: 0.35 });
        const hats = kind === 'drop2' ? 16 : 8;
        for (let e = 0; e < hats; e++) add(at(e * 4 / hats), e % (hats / 4) === hats / 8 ? 'ohat' : 'hat', e % 2 ? 0.28 : 0.4, { pan: e % 2 ? 0.4 : -0.3 });
        if (b % 2 === 1) add(at(3.75), 'pistol', 0.25, { pan: 0.4, wet: 0.3 });
        if (last && next && next !== 'theme') for (let s = 0; s < 8; s++) add(at(2 + s / 4), 'snare', 0.25 + s * 0.06, { wet: 0.3 });
      }
      if (kind === 'breakdown') {
        add(at(0), 'kick', 0.9);
        if (b % 2 === 1) add(at(2.5), 'kick', 0.6);
        // The bomb's beep, speeding up across the section.
        const rate = [2, 2, 4, 8][Math.min(3, Math.floor(b * 4 / bars))];
        for (let i = 0; i < rate; i++) add(at(i * 4 / rate), 'beep', 0.5, { wet: 0.4, pan: 0.15 });
        if (last) add(at(2), 'swell', 0.7, { rate: 2 });
      }
      if (kind === 'tension') {
        add(at(0), 'kick', 1); add(at(2.5), 'kick', 0.8); add(at(2), 'snare', 0.8, { wet: 0.45 }); add(at(2), 'gun', 0.35, { wet: 0.4 });
        for (let e = 0; e < 8; e++) add(at(e / 2), 'hat', 0.22, { pan: 0.3 });
        add(at(3.5), 'tom', 0.5, { wet: 0.3 });
      }
      if (kind === 'online') {
        add(at(0), 'kick', 0.6); add(at(2), 'kick', 0.5);
        for (let e = 0; e < 8; e++) add(at(e / 2), 'hat', 0.15, { pan: 0.3 });
      }

      // ---- Bass ----
      if (big || kind === 'theme' || kind === 'build' || kind === 'rise') {
        for (let e = 0; e < 8; e++) {
          if (kind === 'build' && b < bars / 2 && e % 2) continue;
          const oct = big && e % 4 === 3 ? 12 : 0;
          add(at(e / 2), `bass:${chord.root + oct}|${BEAT * 0.45}`, kind === 'theme' ? 0.8 : 0.95);
        }
      }
      if (kind === 'tension' || kind === 'breakdown' || kind === 'online') add(at(0), `bass:${chord.root}|${BAR * 0.9}`, 0.5);
      if (kind === 'outro' && b === 0) add(t, `bass:26|${BAR * 2}`, 0.9);

      // ---- Arp, motif and theme ----
      if (kind === 'build' || kind === 'online' || kind === 'rise' || kind === 'theme') {
        const arp = [chord.pad[0], chord.pad[1], chord.pad[2], chord.pad[1] + 12, chord.pad[2], chord.pad[1], chord.pad[0] + 12, chord.pad[2]];
        for (let s = 0; s < 16; s++) add(at(s / 4), `pluck:${arp[s % 8] + 12}|0.12|${kind === 'online' ? 0.3 : 0.8}`, kind === 'theme' ? 0.35 : 0.45, { pan: s % 2 ? 0.45 : -0.45, wet: 0.35 });
      }
      if (big) for (const [beat, i] of MOTIF) add(at(beat), `pluck:${chord.pad[i] + 12}|0.25|1`, 0.7, { wet: 0.4, pan: 0.1 });
      if (kind === 'theme' || (kind === 'drop2' && b >= 4)) {
        for (const [tb, beat, midi, len] of THEME) if (tb === b % 4) add(at(beat), `lead:${midi}|${len * BEAT}`, kind === 'theme' ? 0.9 : 0.6, { wet: 0.45 });
      }

      // ---- Hits on phrase starts ----
      if (big && b % 4 === 0) { add(t, 'boom', 0.5, { wet: 0.4 }); add(t, 'ohat', 0.6, { wet: 0.5 }); }
      if (kind === 'theme' && b % 4 === 0) add(t, 'ohat', 0.6, { wet: 0.5 });
    }

    // ---- Section entrances and exits ----
    if (['title', 'drop', 'drop2', 'outro'].includes(kind)) {
      add(start, 'boom', 1, { wet: 0.5 }); add(start, 'sub', 0.9); add(start, kind === 'title' || kind === 'outro' ? 'shotgun' : 'gun', 0.6, { wet: 0.6 });
      add(start, `braam:${kind === 'outro' || kind === 'title' ? 26 : 38}|${kind === 'title' || kind === 'outro' ? BAR * 2 : BAR}`, kind === 'title' || kind === 'outro' ? 1 : 0.6, { wet: 0.5 });
    }
    if (kind === 'breakdown' || kind === 'tension' || kind === 'theme' || kind === 'online') { add(start, 'boom', 0.6, { wet: 0.5 }); add(start, 'sub', 0.6); }
    if (kind === 'tension') add(start, 'sniper', 0.5, { wet: 0.6 });
    if (kind === 'outro') {
      // The last shot rings out over the end card.
      add(start + BAR * Math.min(3, bars - 1.5), 'sniper', 0.55, { wet: 0.8 });
    }
    // Into the next section: a riser (two bars when there is room) and a gun reload in the gap.
    if (next && ['title', 'drop', 'drop2', 'theme'].includes(next)) {
      const len = bars >= 2 ? 2 : 1, end = (bar0 + bars) * BAR;
      add(end - len * BAR, 'riser', 0.7, { rate: 2 / len, wet: 0.4 });
      add(end - BAR, 'swell', 0.5);
      if (next === 'drop' || next === 'drop2') { add(end - BEAT * 1.5, 'magOut', 0.6); add(end - BEAT * 0.9, 'magIn', 0.6); add(end - BEAT * 0.45, 'charge', 0.7); }
    }
    bar0 += bars;
  });
  return { notes, seconds: total * BAR };
}

// ---------------------------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------------------------

function mixInto(dry: Buf, wet: Buf, n: Note, src: Buf) {
  const rate = n.rate ?? 1, first = Math.round(n.at * RATE);
  const frames = Math.min(Math.floor((src[0].length - 1) / rate), n.length ? Math.floor(n.length * RATE) : Infinity);
  const angle = ((n.pan ?? 0) + 1) * Math.PI / 4, send = n.wet ?? 0;
  for (let c = 0; c < 2; c++) {
    const s = src[c], out = dry[c], w = wet[c], g = n.gain * (c ? Math.sin(angle) : Math.cos(angle)) * Math.SQRT2;
    for (let i = 0; i < frames; i++) {
      const at = first + i;
      if (at < 0 || at >= out.length) continue;
      const x = i * rate, k = Math.floor(x), f = x - k;
      const v = (s[k] + ((s[k + 1] ?? 0) - s[k]) * f) * g;
      out[at] += v; if (send) w[at] += v * send;
    }
  }
}

export async function renderScore(sections: [Section, number][]): Promise<AudioBuffer> {
  const { notes, seconds } = arrange(sections);
  const tail = 3;
  const length = Math.ceil((seconds + tail) * RATE);
  const cache = new Map<string, Buf>();
  const samples = Object.fromEntries(await Promise.all(Object.entries(SAMPLES).map(async ([k, f]) => [k, await loadSample(f)] as const)));
  const voice = async (key: string): Promise<Buf> => {
    const hit = cache.get(key);
    if (hit) return hit;
    let buf: Buf;
    if (key in samples) buf = samples[key as keyof typeof SAMPLES];
    else if (VOICES[key]) buf = await VOICES[key]();
    else {
      const [kind, rest] = key.split(':'), [a, b, c] = rest.split('|');
      const len = Number(b);
      buf = kind === 'pad' ? await pad(a.split(',').map(Number), len, Number(c))
        : kind === 'bass' ? await bass(Number(a), len)
        : kind === 'pluck' ? await pluck(Number(a), len, Number(c ?? 1))
        : kind === 'lead' ? await lead(Number(a), len)
        : await braam(Number(a), len);
    }
    cache.set(key, buf);
    return buf;
  };
  const dry: Buf = [new Float32Array(length), new Float32Array(length)], wet: Buf = [new Float32Array(length), new Float32Array(length)];
  for (const n of notes) mixInto(dry, wet, n, await voice(n.voice));

  const ctx = new OfflineAudioContext(2, length, RATE);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.ratio.value = 2; comp.attack.value = 0.01; comp.release.value = 0.25; comp.knee.value = 6;
  comp.connect(ctx.destination);
  const reverb = ctx.createConvolver(); reverb.buffer = reverbImpulse(ctx, 2.8, 2.4);
  const reverbIn = ctx.createGain(); reverbIn.gain.value = 0.4;
  reverbIn.connect(reverb).connect(comp);
  for (const [bus, dest] of [[dry, comp], [wet, reverbIn]] as const) {
    const b = ctx.createBuffer(2, length, RATE);
    b.copyToChannel(bus[0], 0); b.copyToChannel(bus[1], 1);
    const src = ctx.createBufferSource(); src.buffer = b; src.connect(dest); src.start();
  }
  const out = await ctx.startRendering();
  // Peak-normalize to -1 dBFS, keeping the dynamics between sections (the final mix is loudness-normalized
  // linearly by ffmpeg), with a soft knee on the last few dB so a stacked hit never clips.
  let peak = 0;
  for (let c = 0; c < 2; c++) for (const v of out.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  const scale = 1.05 / (peak || 1);
  for (let c = 0; c < 2; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const v = d[i] * scale, a = Math.abs(v); d[i] = a < 0.75 ? v : Math.sign(v) * (0.75 + 0.14 * Math.tanh((a - 0.75) / 0.14)); }
    // Fade the tail out.
    const fade = Math.floor(tail * RATE);
    for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
  }
  return out;
}
