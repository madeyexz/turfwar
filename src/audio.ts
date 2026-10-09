import type { WeaponId } from '../shared/weapons';
import { Voice, VoicePool, unit } from './voices';
import { MEME_SKINS } from './game/memeskins';
import { assetUrl } from './assetUrl';

type V3 = { x: number; y: number; z: number };
type Listener = { pos: V3; yaw: number };
/** A looping vehicle sound (see Audio.engine). */
export interface EngineVoice { set(rpm: number, listener?: Listener, at?: V3): void; stop(): void }

/**
 * Sound design. Firearms are recorded CC0 gunshots (public/assets/sfx, built by
 * tools/fetch-sounds.ts) layered per shot:
 *
 * - body: one of two to four near-distance takes of the weapon (round-robin, never the same take
 *   twice in a row), with a little random pitch and level, shaped by the weapon's EQ;
 * - room: for the shooter, the class's mid-distance take tucked under the body for density;
 * - crack and thump: a synthesized transient and a shooter-only low-end kick;
 * - mechanical: a recorded action clack (bolt, slide) after the shot;
 * - tail: an outdoor slap-and-roll convolution shared by every shot;
 * - casings: a subtle synthesized brass (or shotgun hull) bounce for the shooter.
 *
 * Automatic fire chokes the previous shot's body when the next fires (its tail rides on in the
 * convolver), the shooter's own shots duck the rest of the world briefly, and a bus compressor
 * plus a final limiter keep long bursts from clipping. Remote shots arrive after the speed of
 * sound, crossfade from the near take to the distant one, lose their highs and gain tail with
 * distance, and keep a distant crack beyond about 60 m. Suppressed shots drop the crack and room
 * for a muffled thud, gas spit and a louder action.
 *
 * Reloads, dry fire and weapon equips play recorded CC0 handling foley per weapon class. The knife,
 * footsteps, explosions, the bomb, round cues and UI are synthesized. Until the recordings load
 * (and when Audio.record renders the menu theme offline) every weapon falls back to the
 * synthesized voices below.
 */

/** Recorded handling foley (public/assets/sfx/foley-*.mp3). */
type Foley = 'mag-out' | 'mag-in' | 'smg-out' | 'smg-in' | 'pistol-out' | 'pistol-in' | 'slide' | 'bolt' | 'charge' | 'clack' | 'click' | 'latch' | 'shell' | 'rack';
const FOLEY: Foley[] = ['mag-out', 'mag-in', 'smg-out', 'smg-in', 'pistol-out', 'pistol-in', 'slide', 'bolt', 'charge', 'clack', 'click', 'latch', 'shell', 'rack'];

/** Distant (mid-distance) takes, one per class (public/assets/sfx/far-*.mp3). */
type FarTake = 'pistol' | 'smg' | 'rifle' | 'lmg' | 'shotgun' | 'sniper';

/** One foley hit: [sample, delay s, gain, playback rate]. */
type Hit = [Foley, number, number, number];

/** Recorded voice of a firearm. */
interface GunVoice {
  /** Round-robin takes: shot-<weapon>-1 … shot-<weapon>-<takes>. */
  takes: number;
  far: FarTake;
  rate: number;
  gain: number;
  highpass: number;
  lowpass?: number;
  /** Peaking EQ bands: [Hz, dB]. */
  eq: [number, number][];
  /** Shooter-only low-end kick: [start Hz, end Hz, seconds, gain]. */
  thump: [number, number, number, number];
  /** Synthesized transient crack on top of the recording. */
  crack: number;
  /** Distant take under the shooter's body (close/distant mic blend). */
  room: number;
  /** Action cycling after the shot. */
  mech: Hit;
  /** Outdoor tail send. */
  tail: number;
  casing: 'small' | 'brass' | 'hull';
  /** Low blast (shotgun) and mid bark (LMG) layers. */
  blast?: number;
  bark?: number;
  /** Supersonic: keeps a crack at long range. */
  supersonic?: boolean;
}
const GUNS: Partial<Record<WeaponId, GunVoice>> = {
  // Pistol: snappy, bright, short, a high slide clack.
  m9a1: { takes: 3, far: 'pistol', rate: 1.04, gain: 0.8, highpass: 110, eq: [[220, 2], [2800, 2.5]], thump: [150, 55, 0.06, 0.4], crack: 0.4, room: 0.2, mech: ['clack', 0.004, 0.2, 1.45], tail: 0.6, casing: 'small' },
  // PDW: thin, fast and crisp.
  mp7: { takes: 4, far: 'smg', rate: 1.16, gain: 0.72, highpass: 200, eq: [[3400, 3]], thump: [135, 55, 0.045, 0.3], crack: 0.35, room: 0.16, mech: ['click', 0.003, 0.12, 1.35], tail: 0.5, casing: 'small' },
  // 9 mm SMG: rounder, a little low-mid.
  mp5: { takes: 3, far: 'smg', rate: 1, gain: 0.76, highpass: 110, eq: [[240, 2.5], [1900, 1.5]], thump: [125, 50, 0.055, 0.4], crack: 0.3, room: 0.22, mech: ['click', 0.004, 0.14, 1.05], tail: 0.55, casing: 'small' },
  // Carbine: punchy body, bright crack.
  m4a1: { takes: 2, far: 'rifle', rate: 1, gain: 0.86, highpass: 60, eq: [[160, 3], [3600, 2]], thump: [110, 42, 0.085, 0.65], crack: 0.5, room: 0.3, mech: ['bolt', 0, 0.13, 1.3], tail: 0.8, casing: 'brass', supersonic: true },
  // LMG: heavier, lower, a mid bark and a deeper action.
  m249: { takes: 4, far: 'lmg', rate: 0.93, gain: 0.95, highpass: 50, lowpass: 11000, eq: [[135, 4], [720, 2]], thump: [95, 36, 0.1, 0.8], crack: 0.42, room: 0.36, mech: ['clack', 0.003, 0.17, 0.85], tail: 0.95, casing: 'brass', bark: 0.32, supersonic: true },
  // Semi-auto shotgun: a heavy boom and the action clacking home (no pump).
  m1014: { takes: 4, far: 'shotgun', rate: 1, gain: 1, highpass: 38, eq: [[90, 4], [420, 1.5]], thump: [80, 30, 0.2, 1.05], crack: 0.35, room: 0.42, mech: ['bolt', 0.06, 0.42, 0.95], tail: 1.25, casing: 'hull', blast: 0.55 },
  // Marksman rifle: a sharp crack and a long rolling tail.
  m110: { takes: 4, far: 'sniper', rate: 1, gain: 1, highpass: 45, eq: [[120, 3], [4800, 3.5]], thump: [85, 32, 0.15, 0.95], crack: 0.75, room: 0.34, mech: ['bolt', 0.04, 0.3, 1.1], tail: 1.6, casing: 'brass', supersonic: true },
};

/** Reload foley per weapon and stage (game.ts plays 'out', then 'in' at 65% and 'charge' at 88% of the reload). */
type ReloadStage = 'out' | 'in' | 'charge';
const RELOADS: Partial<Record<WeaponId, Record<ReloadStage, Hit[]>>> = {
  m9a1: { out: [['pistol-out', 0, 0.8, 1]], in: [['pistol-in', 0, 0.9, 1]], charge: [['slide', 0, 0.75, 1.05]] },
  mp7: { out: [['smg-out', 0, 0.75, 1.1]], in: [['smg-in', 0, 0.7, 1.1]], charge: [['charge', 0, 0.55, 1.2], ['latch', 0.1, 0.4, 1.2]] },
  mp5: { out: [['smg-out', 0, 0.8, 1]], in: [['smg-in', 0, 0.8, 0.95]], charge: [['charge', 0, 0.6, 1], ['bolt', 0.09, 0.6, 1]] },
  m4a1: { out: [['click', 0, 0.35, 0.9], ['mag-out', 0.03, 0.8, 1]], in: [['mag-in', 0, 0.85, 1]], charge: [['charge', 0, 0.6, 1.05], ['bolt', 0.12, 0.55, 1.1]] },
  m249: { out: [['clack', 0, 0.6, 0.8], ['mag-out', 0.18, 0.8, 0.85]], in: [['mag-in', 0, 0.85, 0.85], ['latch', 0.22, 0.55, 0.8], ['clack', 0.3, 0.7, 0.75]], charge: [['charge', 0, 0.7, 0.85]] },
  m1014: { out: [['shell', 0, 0.7, 1], ['shell', 0.42, 0.65, 1.03], ['shell', 0.84, 0.7, 0.98]], in: [['shell', 0, 0.7, 1.01], ['shell', 0.34, 0.68, 0.99]], charge: [['bolt', 0, 0.75, 0.95]] },
  m110: { out: [['click', 0, 0.35, 0.85], ['mag-out', 0.03, 0.8, 0.92]], in: [['mag-in', 0, 0.85, 0.92]], charge: [['bolt', 0, 0.7, 0.95]] },
};

/** Handling when a weapon comes up. */
const EQUIPS: Partial<Record<WeaponId, Hit[]>> = {
  m9a1: [['latch', 0.07, 0.5, 1.1]],
  mp7: [['click', 0.08, 0.45, 1.1]],
  mp5: [['click', 0.08, 0.5, 1], ['latch', 0.2, 0.3, 0.95]],
  m4a1: [['latch', 0.06, 0.5, 0.9], ['bolt', 0.2, 0.3, 1.2]],
  m249: [['clack', 0.1, 0.55, 0.8], ['latch', 0.32, 0.4, 0.8]],
  m1014: [['latch', 0.07, 0.5, 0.9], ['bolt', 0.22, 0.35, 1]],
  m110: [['latch', 0.06, 0.5, 0.88], ['bolt', 0.2, 0.3, 1.05]],
};

/** A decoded recording and where its sound starts (skips encoder padding and silence). */
interface Sample { buffer: AudioBuffer; onset: number }

/**
 * Synthesized gunshot per weapon (the fallback until samples load, and the menu theme's voice): `heavy` scales the shared crack/body/thump/tail, `layers` add the
 * weapon's character as [oscillator, start Hz, end Hz, seconds, gain, delay?], and `tail` plays the
 * action cycling after the shot. `melee` is the knife: a swish, no shot.
 */
interface GunSound {
  heavy: number;
  layers?: [OscillatorType, number, number, number, number, number?][];
  blast?: boolean;
  tail?: 'pump' | 'bolt' | 'action';
  melee?: boolean;
}
const GUN_SOUNDS: Record<WeaponId, GunSound> = {
  knife: { heavy: 0, melee: true },
  m9a1: { heavy: 0.8 },
  mp7: { heavy: 0.65, layers: [['square', 2600, 900, 0.03, 0.05]] },
  mp5: { heavy: 0.72, layers: [['square', 2200, 800, 0.025, 0.05]] },
  m4a1: { heavy: 1, layers: [['sawtooth', 1400, 260, 0.07, 0.06]] },
  m249: { heavy: 1.15, layers: [['sawtooth', 1100, 220, 0.08, 0.07]] },
  m1014: { heavy: 1.5, blast: true, tail: 'action' },
  m110: { heavy: 1.45, layers: [['sawtooth', 1500, 300, 0.09, 0.08], ['sine', 2600, 500, 0.2, 0.08, 0.015]], tail: 'action' },
};

const SPEED_OF_SOUND = 343;
/** Remote gunshot voices allowed to ring at once: beyond it distant shots are dropped and near ones take the oldest's place. */
const MAX_REMOTE_VOICES = 14;
/** Where a source with no valid position (NaN or infinite) is heard: far off, nearly silent, centred. */
const UNPLACED = 1000;
const smoothstep = (a: number, b: number, x: number) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const jitter = (amount: number) => 1 + (Math.random() - 0.5) * 2 * amount;

export class Audio {
  private ctx?: BaseAudioContext;
  private master!: GainNode;
  /** Remote/world sources; ducked under the player's own shots. */
  private world!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  /** Live-only buses: the player's weapon (compressed) and the outdoor gunshot tail. */
  private gunBus?: GainNode;
  private tailBus?: GainNode;
  /** Start time for sounds while recording offline; live play uses the context clock. */
  private clock?: number;
  private music?: { src: AudioBufferSourceNode; gain: GainNode };
  private samples = new Map<string, Sample>();
  /** The player's weapon in hand (last equipped or fired), for reloads and dry fire without one. */
  private held: WeaponId = 'mp5';
  private lastTake = new Map<WeaponId, number>();
  /** The player's previous shot: its body is choked (and its takes stopped) when the next one fires. */
  private lastShot?: { body: GainNode; takes: AudioScheduledSourceNode[] };
  private lastShotAt = -1;
  private lastCasingAt = -1;
  /** Remote gunshots ringing now; a stolen one fades out on its input gain. */
  private remote = new VoicePool<{ voice: Voice; input: GainNode }>(MAX_REMOTE_VOICES, ({ voice, input }) => {
    const t = this.ctx!.currentTime;
    input.gain.cancelScheduledValues(t); input.gain.setValueAtTime(input.gain.value, t); input.gain.setTargetAtTime(0, t, 0.015);
    voice.stop(t + 0.12);
  });
  /** The sound being built: its nodes leave the mix together when its last source ends (see src/voices.ts). */
  private voice?: Voice;
  private comp?: DynamicsCompressorNode;
  private limit?: DynamicsCompressorNode;
  private tailVerb?: ConvolverNode;
  muted = false;
  volume = 0.8;
  musicVolume = 0.6;

  start() {
    if (this.ctx) { void (this.ctx as AudioContext).resume(); return; }
    const ctx = new AudioContext();
    this.build(ctx);
    const comp = this.comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    // A final safety limiter so stacked gunfire never clips the output.
    const limit = this.limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -1.5; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.08;
    this.master.connect(comp).connect(limit).connect(ctx.destination);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = reverbImpulse(ctx, 1.6);
    this.reverbSend.connect(this.reverb).connect(this.master);
    // The player's weapon: a fast bus compressor holds full-auto bursts level without dulling the first transient.
    this.gunBus = ctx.createGain();
    const gunComp = ctx.createDynamicsCompressor();
    gunComp.threshold.value = -16; gunComp.knee.value = 8; gunComp.ratio.value = 4; gunComp.attack.value = 0.0015; gunComp.release.value = 0.12;
    this.gunBus.connect(gunComp).connect(this.master);
    // Outdoor tail: slap off buildings and a rolling decay, kept out of the lows so bursts stay clear.
    this.tailBus = ctx.createGain();
    const tail = this.tailVerb = ctx.createConvolver(); tail.buffer = outdoorImpulse(ctx);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 170;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
    this.tailBus.connect(hp).connect(lp).connect(tail).connect(this.master);
    this.wind();
    void this.loadSamples(ctx);
  }

  private get live() { return !!this.gunBus; }

  /** Debug (?audiodebug): the mix's nodes and counters, for src/audio-probe.ts. */
  debugTaps() {
    if (!this.ctx || !this.comp || !this.limit) return undefined;
    return {
      ctx: this.ctx, master: this.master, world: this.world, gunBus: this.gunBus!, tail: this.tailVerb!, reverb: this.reverb,
      comp: this.comp, limit: this.limit, voices: () => ({ remote: this.remote.size }),
    };
  }

  /** Fetch and decode the recordings; until each arrives its sound stays synthesized. */
  private async loadSamples(ctx: AudioContext) {
    const files = [
      ...Object.entries(GUNS).flatMap(([id, v]) => Array.from({ length: v!.takes }, (_, i) => `shot-${id}-${i + 1}`)),
      ...[...new Set(Object.values(GUNS).map(v => `far-${v!.far}`))],
      ...FOLEY.map(f => `foley-${f}`),
    ];
    await Promise.all(files.map(async file => {
      try {
        const res = await fetch(assetUrl(`assets/sfx/${file}.mp3`));
        if (!res.ok) return;
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        this.samples.set(file, { buffer, onset: onsetOf(buffer) });
      } catch { /* keep the synthesized sound */ }
    }));
  }

  private build(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    this.world = ctx.createGain(); this.world.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.32;
  }

  /**
   * Records sound effects offline into a dry buffer (no reverb or compressor), so other
   * code can reuse the exact game sounds as instruments. Effects start at time zero.
   */
  static record(seconds: number, play: (sfx: Audio) => void, sampleRate = 44100) {
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
    const sfx = new Audio();
    sfx.build(ctx);
    sfx.master.gain.value = 1;
    sfx.master.connect(ctx.destination);
    sfx.clock = 0;
    play(sfx);
    return ctx.startRendering();
  }

  /** Loops a rendered music buffer on its own bus (bypassing the effects compressor), starting `from` seconds in. */
  playMusic(buffer: AudioBuffer, from = 0, fadeIn = 0.4) {
    const ctx = this.ctx;
    if (!(ctx instanceof AudioContext) || this.music) return;
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(this.muted ? 0 : this.musicVolume, ctx.currentTime + fadeIn);
    src.connect(gain).connect(ctx.destination); src.start(0, from);
    this.music = { src, gain };
  }

  stopMusic(fadeOut = 1.2) {
    const music = this.music, ctx = this.ctx;
    if (!music || !ctx) return;
    this.music = undefined;
    const t = ctx.currentTime;
    music.gain.gain.cancelScheduledValues(t);
    music.gain.gain.setValueAtTime(music.gain.gain.value, t);
    music.gain.gain.linearRampToValueAtTime(0, t + fadeOut);
    music.src.stop(t + fadeOut + 0.05);
  }

  setMusicVolume(volume: number) {
    this.musicVolume = volume;
    const music = this.music, ctx = this.ctx;
    if (music && ctx) music.gain.gain.setTargetAtTime(this.muted ? 0 : volume, ctx.currentTime, 0.05);
  }

  setMuted(muted: boolean) { this.muted = muted; if (this.master) this.master.gain.value = muted ? 0 : this.volume; this.setMusicVolume(this.musicVolume); }

  /** Sound-effect volume (0–1); the menu music has its own. */
  setVolume(volume: number) { this.volume = volume; if (this.master && !this.muted) this.master.gain.value = volume; }

  private get ready() { return !!this.ctx && !this.muted; }
  private now() { return this.clock ?? this.ctx!.currentTime; }

  /**
   * The voice collecting the nodes being created. play() gives a sound its own; any other call shares one
   * per task (everything one frame starts), sealed once the task's synchronous work is done.
   */
  private get v(): Voice {
    if (!this.voice) {
      const v = this.voice = new Voice();
      queueMicrotask(() => { if (this.voice === v) this.voice = undefined; v.seal(); });
    }
    return this.voice;
  }

  /** Builds one sound in its own voice. */
  private play(build: () => void, voice = new Voice()) {
    const outer = this.voice;
    this.voice = voice;
    try { build(); } finally { this.voice = outer; voice.seal(); }
  }

  /** Distance, stereo position and facing of a world source relative to the listener. */
  private spatial(listener: Listener, at: V3) {
    const dx = at.x - listener.pos.x, dz = at.z - listener.pos.z, dy = at.y - listener.pos.y;
    // A NaN position would reach an AudioParam, which throws (and aborts the frame that played it).
    if (!Number.isFinite(dx + dy + dz + listener.yaw)) return { d: UNPLACED, pan: 0, front: 0 };
    const d = Math.hypot(dx, dy, dz) || 0.001;
    // Listener right vector for yaw: (cos, -sin); forward: (-sin, -cos).
    const right = (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / d;
    const front = (-dx * Math.sin(listener.yaw) - dz * Math.cos(listener.yaw)) / d;
    // Very close sources pan less hard (they are wide, not point-like).
    const pan = Math.max(-1, Math.min(1, right * 0.85 * Math.min(1, 0.4 + d / 6)));
    return { d, pan, front };
  }

  /** Output chain: optional stereo pan + distance attenuation + reverb send. */
  private out(gain: number, listener?: Listener, at?: V3, wet = 0.35) {
    const ctx = this.ctx!;
    const g = ctx.createGain(); g.gain.value = gain;
    let node: AudioNode = g;
    const world = !!(listener && at);
    if (listener && at) {
      const { d, pan: p } = this.spatial(listener, at);
      g.gain.value = gain / (1 + d * 0.09);
      const pan = ctx.createStereoPanner();
      pan.pan.value = p;
      // Distant sources lose their highs.
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(900, 16000 / (1 + d * 0.06));
      g.connect(lp).connect(pan); node = pan;
      wet = Math.min(0.9, wet + d * 0.01);
    }
    const voice = this.v;
    voice.route(node, world ? this.world : this.master);
    const send = ctx.createGain(); send.gain.value = wet; node.connect(send);
    voice.route(send, this.reverbSend);
    return g;
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, attack = 0.001) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    this.v.track(src);
    return f;
  }

  private tone(dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number, attack = 0.002) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
    this.v.track(o);
  }

  /** Plays a decoded recording from its onset into `dest`. */
  private sample(name: string, dest: AudioNode, t: number, rate = 1, gain = 1) {
    const s = this.samples.get(name);
    if (!s) return undefined;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = s.buffer; src.playbackRate.value = rate;
    if (gain === 1) src.connect(dest);
    else { const g = ctx.createGain(); g.gain.value = gain; src.connect(g).connect(dest); }
    src.start(Math.max(t, this.now()), s.onset);
    return this.v.track(src);
  }

  /** Foley hits with a little random pitch and level. */
  private foley(hits: Hit[], dest: AudioNode, t: number) {
    for (const [name, delay, gain, rate] of hits) this.sample(`foley-${name}`, dest, t + delay, rate * jitter(0.03), gain * jitter(0.08));
  }

  private get hasFoley() { return this.live && this.samples.has('foley-click'); }

  /** Next round-robin take of a weapon, never the one just played. */
  private take(weapon: WeaponId, v: GunVoice) {
    const last = this.lastTake.get(weapon) ?? 0;
    let k = 1 + Math.floor(Math.random() * v.takes);
    if (v.takes > 1 && k === last) k = (k % v.takes) + 1;
    this.lastTake.set(weapon, k);
    return `shot-${weapon}-${k}`;
  }

  /** The weapon's EQ (and the suppressor's muffling) from `input`; returns the chain's end. */
  private shape(input: AudioNode, v: GunVoice, suppressed: boolean) {
    const ctx = this.ctx!;
    let node = input;
    const filter = (type: BiquadFilterType, freq: number, q = 0.7, gain = 0) => {
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; f.gain.value = gain;
      node = node.connect(f);
    };
    filter('highpass', suppressed ? Math.max(v.highpass, 170) : v.highpass);
    if (!suppressed) for (const [freq, db] of v.eq) filter('peaking', freq, 0.9, db);
    const lowpass = suppressed ? 1150 : v.lowpass;
    if (lowpass) filter('lowpass', lowpass, suppressed ? 0.5 : 0.7);
    return node;
  }

  /**
   * One shot of `weapon` (the knife swishes). Without `listener`/`at` it is the player's own shot.
   * `suppressed` (Suppressor attachment) trades the crack for a muffled, quieter thud, a puff of
   * gas and a more audible action, with little room echo.
   */
  gunshot(weapon: WeaponId, listener?: Listener, at?: V3, suppressed = false) {
    if (!this.ready) return;
    const t = this.now(), sound = GUN_SOUNDS[weapon];
    const remote = !!(listener && at);
    if (!remote) this.held = weapon;
    if (sound.melee) { this.swish(t, listener, at); return; }
    const voice = GUNS[weapon];
    if (this.live && voice && this.samples.has(`shot-${weapon}-1`)) {
      if (listener && at) this.remoteShot(weapon, voice, t, listener, at, suppressed);
      else this.ownShot(weapon, voice, t, suppressed);
      return;
    }
    this.synthShot(sound, t, listener, at, suppressed);
  }

  /** The player's own shot: every layer, through the weapon bus. */
  private ownShot(weapon: WeaponId, v: GunVoice, t: number, suppressed: boolean) {
    this.play(() => this.buildOwnShot(weapon, v, t, suppressed));
  }

  private buildOwnShot(weapon: WeaponId, v: GunVoice, t: number, suppressed: boolean) {
    const ctx = this.ctx!, bus = this.gunBus!, voice = this.v;
    const since = t - this.lastShotAt;
    this.lastShotAt = t;
    const rapid = since < 0.16;
    // Choke the previous shot's body so bursts stay tight; its tail keeps ringing in the convolver. Its takes
    // stop once choked, so full auto keeps one or two bodies playing instead of every take to its end.
    if (this.lastShot) {
      const g = this.lastShot.body.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.setTargetAtTime(0, t + 0.006, 0.022);
      for (const take of this.lastShot.takes) take.stop(t + 0.2);
    }
    const body = ctx.createGain();
    const takes: AudioScheduledSourceNode[] = [];
    this.lastShot = { body, takes };
    voice.route(body, bus);
    const send = ctx.createGain(); send.gain.value = v.tail * (suppressed ? 0.07 : rapid ? 0.24 : 0.42);
    body.connect(send);
    voice.route(send, this.tailBus!);

    const level = 0.55 * v.gain * (suppressed ? 0.32 : 1) * jitter(0.1);
    const input = ctx.createGain(); input.gain.value = level;
    this.shape(input, v, suppressed).connect(body);
    const rate = v.rate * (suppressed ? 1.06 : 1) * jitter(0.022);
    const near = this.sample(this.take(weapon, v), input, t, rate);
    if (near) takes.push(near);
    // Not choked: the kick, the action and the suppressor's gas.
    const direct = ctx.createGain(); direct.gain.value = 0.55 * v.gain;
    voice.route(direct, bus);
    const [f0, f1, dur, kick] = v.thump;
    const thump = kick * (suppressed ? 0.45 : 1) * (rapid ? 0.8 : 1);
    this.tone(direct, t, 'sine', f0, f1, dur, thump, 0.0015);
    this.tone(direct, t, 'triangle', f0 * 2, f1 * 2, dur * 0.6, thump * 0.22, 0.0015);
    const [mech, delay, mechGain, mechRate] = v.mech;
    const action = ctx.createBiquadFilter(); action.type = 'highpass'; action.frequency.value = 350;
    action.connect(direct);
    this.sample(`foley-${mech}`, action, t + delay, mechRate * jitter(0.04), mechGain * (suppressed ? 1.7 : 1) * jitter(0.1));
    if (suppressed) {
      this.noiseBurst(direct, t, 0.07, 'bandpass', 520, 1.1, 0.45);
      this.noiseBurst(direct, t + 0.002, 0.05, 'highpass', 4200, 0.7, 0.1, 0.004);
    } else {
      const room = this.sample(`far-${v.far}`, input, t + 0.006, rate, v.room);
      if (room) takes.push(room);
      this.noiseBurst(input, t, 0.012, 'highpass', 3600, 0.7, v.crack);
      if (v.blast) this.noiseBurst(input, t, 0.24, 'lowpass', 650, 0.6, v.blast, 0.002);
      if (v.bark) this.noiseBurst(input, t, 0.06, 'bandpass', 760, 1.2, v.bark);
      this.duck(t, rapid ? 0.62 : 0.5);
    }
    if (since > 0.13 || Math.random() < 0.4) this.casing(t, v.casing);
  }

  /** Someone else's shot: near take crossfading into the distant one, delayed by the speed of sound. */
  private remoteShot(weapon: WeaponId, v: GunVoice, now: number, listener: Listener, at: V3, suppressed: boolean) {
    const ctx = this.ctx!;
    const { d, pan: p, front } = this.spatial(listener, at);
    const input = ctx.createGain();
    const entry = { voice: new Voice(), input };
    // A full pool drops a distant shot; a near one takes the oldest's place.
    if (!this.remote.add(entry, d > 20)) return;
    entry.voice.onEnd = () => this.remote.remove(entry);
    this.play(() => this.buildRemoteShot(weapon, v, now, d, p, front, input, suppressed), entry.voice);
  }

  private buildRemoteShot(weapon: WeaponId, v: GunVoice, now: number, d: number, p: number, front: number, input: GainNode, suppressed: boolean) {
    const ctx = this.ctx!, voice = this.v;
    const t = now + d / SPEED_OF_SOUND;
    const far = smoothstep(12, 60, d);
    const level = 0.72 * v.gain * (suppressed ? 0.32 : 1) * (12 / (12 + d)) * jitter(0.08);
    input.gain.value = level;
    // Highs fall away with distance, a little more from behind.
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = Math.min(suppressed ? 1100 : 18000, Math.max(1500, 18000 * Math.exp(-d / 45)) * (front < 0 ? 1 + front * 0.3 : 1));
    const pan = ctx.createStereoPanner(); pan.pan.value = p;
    this.shape(input, v, suppressed).connect(lp).connect(pan);
    voice.route(pan, this.world);
    const send = ctx.createGain(); send.gain.value = v.tail * (0.3 + far * 0.75) * (suppressed ? 0.25 : 1);
    pan.connect(send);
    voice.route(send, this.tailBus!);

    const rate = v.rate * (suppressed ? 1.06 : 1) * jitter(0.025);
    this.sample(this.take(weapon, v), input, t, rate, Math.cos(far * Math.PI / 2) + 0.05);
    if (!suppressed) {
      this.sample(`far-${v.far}`, input, t, rate, 0.15 + Math.sin(far * Math.PI / 2) * 0.95);
      // Beyond the crossfade a supersonic round still cracks through the low-passed rumble.
      if (v.supersonic && d > 45) this.noiseBurst(pan, t, 0.018, 'bandpass', 2600, 1.4, 0.22 * level * smoothstep(45, 75, d) * 4);
      if (d < 18) this.noiseBurst(input, t, 0.01, 'highpass', 3600, 0.7, v.crack * (1 - d / 18));
    }
    if (d < 12) {
      const [mech, delay, mechGain, mechRate] = v.mech;
      this.sample(`foley-${mech}`, input, t + delay, mechRate, mechGain * (suppressed ? 1.6 : 1) * (1 - d / 12));
    }
  }

  /** Briefly lowers everything else under the player's own shot. */
  private duck(t: number, depth: number) {
    const g = this.world.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.setTargetAtTime(depth, t, 0.004);
    g.setTargetAtTime(1, t + 0.05, 0.12);
  }

  /** Spent brass (or a shotgun hull) bouncing on the ground: subtle and synthesized. */
  private casing(t: number, kind: GunVoice['casing']) {
    if (t - this.lastCasingAt < 0.07) return;
    this.lastCasingAt = t;
    const out = this.out(0.13, undefined, undefined, 0.06);
    let at = t + 0.36 + Math.random() * 0.16;
    if (kind === 'hull') {
      for (let i = 0; i < 2; i++, at += 0.09 + Math.random() * 0.04) {
        this.noiseBurst(out, at, 0.04, 'bandpass', 950, 2, 0.6 / (i + 1));
        this.tone(out, at, 'sine', 520, 380, 0.05, 0.25 / (i + 1));
      }
      return;
    }
    const base = (kind === 'small' ? 4200 : 3300) * jitter(0.08);
    for (let i = 0, gain = 0.5; i < 3; i++, gain *= 0.55, at += 0.06 + Math.random() * 0.05) {
      this.noiseBurst(out, at, 0.006, 'highpass', 5000, 0.7, gain * 0.6);
      for (const ratio of [1, 1.47, 2.31]) this.tone(out, at, 'sine', base * ratio, base * ratio * 0.985, 0.05 + 0.05 / ratio, gain * 0.16 / ratio, 0.001);
    }
  }

  /** Synthesized shot: the fallback until recordings load, and the menu theme's drum voices. */
  private synthShot(sound: GunSound, t: number, listener: Listener | undefined, at: V3 | undefined, suppressed: boolean) {
    if (suppressed) {
      const out = this.out(listener ? 0.5 : 0.4, listener, at, 0.12);
      this.noiseBurst(out, t, 0.025, 'highpass', 3200, 0.8, 0.5);
      this.noiseBurst(out, t, 0.08 * Math.max(0.8, sound.heavy), 'bandpass', 700, 1.1, 0.8);
      this.tone(out, t, 'sine', 160, 50, 0.08, 0.5);
      this.actionTail(out, sound.tail ?? 'action', t);
      return;
    }
    const out = this.out(listener ? 0.75 : 0.55, listener, at, listener ? 0.5 : 0.28);
    const heavy = sound.heavy;
    // Transient crack, mid body, sub thump and mechanical tail, then the weapon's own character.
    this.noiseBurst(out, t, 0.03, 'highpass', 2500, 0.7, 0.9 * heavy);
    this.noiseBurst(out, t, 0.11 * heavy, 'bandpass', 1100 / heavy, 0.9, 1.1);
    this.tone(out, t, 'sine', 130 * (1.2 - heavy * 0.25), 38, 0.14 * heavy, 0.95);
    this.noiseBurst(out, t + 0.01, 0.35 * heavy, 'lowpass', 900, 0.5, 0.35);
    for (const [type, f0, f1, dur, gain, delay = 0] of sound.layers ?? []) this.tone(out, t + delay, type, f0, f1, dur, gain);
    // Shotguns: a wide low blast.
    if (sound.blast) this.noiseBurst(out, t, 0.22, 'lowpass', 600, 0.6, 0.9);
    this.actionTail(out, sound.tail, t);
  }

  /** Knife slash through the air: a low whoosh with a thin edge on top. */
  private swish(t: number, listener?: Listener, at?: V3) {
    const out = this.out(listener ? 0.4 : 0.32, listener, at, 0.08);
    const f = this.noiseBurst(out, t, 0.18, 'bandpass', 900, 2.2, 0.8, 0.04);
    f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(3400, t + 0.16);
    if (!this.live) return;
    const edge = this.noiseBurst(out, t + 0.02, 0.13, 'bandpass', 3000, 5, 0.22, 0.05);
    edge.frequency.setValueAtTime(2400, t + 0.02); edge.frequency.exponentialRampToValueAtTime(7000, t + 0.14);
  }

  /** Knife: the swing, and on a hit a blunt stab into the target. */
  knife(hit: boolean, listener?: Listener, at?: V3) {
    if (!this.ready) return;
    const t = this.now();
    this.swish(t, listener, at);
    if (!hit) return;
    if (MEME_SKINS) return this.slap(t + 0.05, listener, at);
    const out = this.out(listener ? 0.55 : 0.45, listener, at, 0.06);
    this.tone(out, t + 0.06, 'sine', 140, 55, 0.12, 0.8);
    this.noiseBurst(out, t + 0.06, 0.07, 'lowpass', 900, 1, 0.7);
    this.noiseBurst(out, t + 0.07, 0.05, 'bandpass', 2600, 4, 0.25);
    if (this.live) this.noiseBurst(out, t + 0.075, 0.12, 'bandpass', 420, 1.5, 0.35, 0.01);
  }

  /** The 藍白拖 landing (src/game/memeskins.ts): a bright rubber THWACK with a little cartoon boing after it. */
  private slap(t: number, listener?: Listener, at?: V3) {
    const out = this.out(listener ? 0.7 : 0.6, listener, at, 0.12);
    this.noiseBurst(out, t, 0.045, 'highpass', 1800, 0.7, 1.1);
    this.noiseBurst(out, t, 0.07, 'bandpass', 1100, 1.4, 0.9);
    this.tone(out, t, 'sine', 260, 120, 0.06, 0.5);
    if (!this.live) return;
    this.tone(out, t + 0.05, 'triangle', 520, 300, 0.16, 0.16, 0.005);
    this.tone(out, t + 0.09, 'triangle', 380, 520, 0.12, 0.08, 0.005);
  }

  /** Mechanical cycling after the shot: pump, bolt or a short action clack. */
  private actionTail(out: AudioNode, tail: GunSound['tail'], t: number) {
    if (tail === 'pump') {
      this.noiseBurst(out, t + 0.36, 0.05, 'bandpass', 1800, 2, 0.35);
      this.noiseBurst(out, t + 0.5, 0.06, 'bandpass', 1300, 2, 0.4);
    } else if (tail === 'bolt') {
      // Bolt lifted, drawn back and run home.
      this.noiseBurst(out, t + 0.42, 0.04, 'bandpass', 2400, 3, 0.3);
      this.noiseBurst(out, t + 0.55, 0.06, 'bandpass', 1500, 2, 0.35);
      this.noiseBurst(out, t + 0.72, 0.05, 'bandpass', 1900, 2.5, 0.4);
    } else if (tail === 'action') {
      this.noiseBurst(out, t + 0.07, 0.035, 'bandpass', 2200, 2.5, 0.25);
    }
  }

  boltShot(listener: Listener, at: V3) {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.5, listener, at, 0.4);
    this.tone(out, t, 'square', 900, 140, 0.18, 0.18);
    this.tone(out, t, 'sine', 420, 60, 0.22, 0.3);
  }

  /** Trigger on an empty chamber: the hammer/striker's dead click (`weapon` defaults to the one in hand). */
  dryFire(weapon: WeaponId = this.held) {
    if (!this.ready) return;
    const t = this.now();
    if (this.hasFoley && weapon !== 'knife') {
      const out = this.out(0.3, undefined, undefined, 0.05);
      this.sample('foley-click', out, t, (weapon === 'm9a1' || weapon === 'mp7' ? 1.35 : 1.15) * jitter(0.03), 0.9);
      this.noiseBurst(out, t, 0.012, 'highpass', 4500, 1.5, 0.25);
      return;
    }
    this.noiseBurst(this.out(0.3), t, 0.02, 'highpass', 3000, 2, 0.5);
  }

  /**
   * One reload step for `weapon` (default: the weapon in hand): 'out' (magazine out; shotgun
   * shells), 'in' (magazine seated; more shells) and 'charge' (slide, charging handle or bolt).
   */
  reload(stage: ReloadStage, weapon: WeaponId = this.held) {
    if (!this.ready) return;
    const t = this.now();
    const plan = RELOADS[weapon];
    if (this.hasFoley && plan) {
      const out = this.out(0.4, undefined, undefined, 0.08);
      this.foley(plan[stage], out, t);
      // Airsoft-recorded magazines get a little weight when they seat.
      if (stage === 'in' && weapon !== 'm1014') { this.tone(out, t + 0.01, 'sine', 190, 85, 0.06, 0.22); this.noiseBurst(out, t + 0.01, 0.05, 'lowpass', 700, 0.8, 0.25); }
      return;
    }
    const out = this.out(0.35, undefined, undefined, 0.1);
    if (stage === 'out') { this.noiseBurst(out, t, 0.05, 'bandpass', 1800, 4, 0.6); this.tone(out, t, 'triangle', 600, 300, 0.05, 0.2); }
    else if (stage === 'in') { this.noiseBurst(out, t, 0.06, 'bandpass', 1200, 3, 0.9); this.noiseBurst(out, t + 0.05, 0.04, 'highpass', 4000, 2, 0.5); }
    else { this.noiseBurst(out, t, 0.04, 'bandpass', 2600, 5, 0.7); this.noiseBurst(out, t + 0.09, 0.05, 'bandpass', 1600, 5, 0.8); }
  }

  /** Weapon raised after a switch, pickup or purchase: cloth rustle and the gun's handling clicks (the knife rings out). */
  equip(weapon: WeaponId) {
    this.held = weapon;
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.36, undefined, undefined, 0.06);
    this.noiseBurst(out, t, 0.16, 'bandpass', 1300, 0.7, 0.28, 0.05);
    if (weapon === 'knife') {
      const f = this.noiseBurst(out, t + 0.05, 0.22, 'bandpass', 3500, 6, 0.35, 0.03);
      f.frequency.setValueAtTime(3000, t + 0.05); f.frequency.exponentialRampToValueAtTime(7500, t + 0.25);
      for (const hz of [3150, 4620, 6930]) this.tone(out, t + 0.08, 'sine', hz, hz * 0.99, 0.35, 0.05, 0.01);
      return;
    }
    const hits = EQUIPS[weapon];
    if (this.hasFoley && hits) { this.foley(hits, out, t); return; }
    this.noiseBurst(out, t + 0.08, 0.03, 'bandpass', 2400, 4, 0.6);
    this.noiseBurst(out, t + 0.18, 0.04, 'bandpass', 1500, 3, 0.5);
  }

  hitmarker(head: boolean, kill: boolean) {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.35, undefined, undefined, 0.05);
    this.tone(out, t, 'triangle', head ? 2200 : 1500, head ? 2000 : 1400, 0.06, 0.4);
    if (head) this.tone(out, t + 0.02, 'sine', 3300, 3100, 0.12, 0.25);
    if (kill) { this.tone(out, t + 0.05, 'sine', 880, 870, 0.18, 0.3); this.tone(out, t + 0.12, 'sine', 1320, 1310, 0.22, 0.25); }
  }

  /** Taking a hit. (The old shield argument is ignored: BeGone soldiers have health only.) */
  damage(_shield?: boolean) {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.5, undefined, undefined, 0.1);
    this.tone(out, t, 'sine', 90, 50, 0.18, 0.7); this.noiseBurst(out, t, 0.1, 'lowpass', 600, 1, 0.5);
  }

  /** @deprecated No shields any more; silent until callers drop it. */
  shieldBreak() { /* no shields */ }

  /** Low health (below 25): one lub-dub. Call about once a second; nearby players hear it too. */
  heartbeat(listener?: Listener, at?: V3) {
    if (!this.ready) return;
    const t = this.now(), out = this.out(listener ? 0.5 : 0.55, listener, at, 0.04);
    this.tone(out, t, 'sine', 62, 38, 0.16, 0.9, 0.012);
    this.noiseBurst(out, t, 0.06, 'lowpass', 160, 0.7, 0.4);
    this.tone(out, t + 0.24, 'sine', 54, 34, 0.14, 0.6, 0.012);
  }

  /** The armed bomb's beep (callers beep faster as the clock runs down). */
  bombBeep(listener?: Listener, at?: V3) {
    if (!this.ready) return;
    const t = this.now(), out = this.out(listener ? 0.5 : 0.3, listener, at, 0.25);
    this.tone(out, t, 'square', 2100, 2100, 0.07, 0.12);
    this.tone(out, t, 'sine', 4200, 4200, 0.05, 0.08);
  }

  /** Bomb armed: a rising three-step alarm. */
  bombArmed() {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.4, undefined, undefined, 0.35);
    [880, 1175, 1568].forEach((f, i) => { this.tone(out, t + i * 0.13, 'square', f, f, 0.11, 0.12); this.tone(out, t + i * 0.13, 'sine', f * 2, f * 2, 0.1, 0.06); });
    this.tone(out, t + 0.42, 'sawtooth', 600, 1800, 0.5, 0.08, 0.05);
  }

  /** Bomb disarmed: the charge powers down with a clean click. */
  bombDisarmed() {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.4, undefined, undefined, 0.3);
    this.noiseBurst(out, t, 0.03, 'bandpass', 2600, 4, 0.7);
    this.tone(out, t + 0.03, 'sine', 1600, 140, 0.7, 0.3, 0.01);
    this.tone(out, t + 0.03, 'triangle', 800, 80, 0.6, 0.12, 0.01);
  }

  /** Round start (freeze time over): a short two-tone go signal. */
  roundStart() {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.35, undefined, undefined, 0.45);
    this.tone(out, t, 'triangle', 587, 587, 0.16, 0.22);
    this.tone(out, t + 0.16, 'triangle', 880, 880, 0.32, 0.26);
    this.tone(out, t + 0.16, 'sine', 1760, 1760, 0.3, 0.07);
  }

  /** Round over: a rising fanfare when won, a falling line when lost, two flat notes for a draw (undefined). */
  roundEnd(won: boolean | undefined) {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.35, undefined, undefined, 0.5);
    const notes = won === undefined ? [494, 494] : won ? [523, 659, 784, 1046] : [392, 349, 311];
    notes.forEach((f, i) => this.tone(out, t + i * (won === undefined ? 0.18 : 0.09), 'triangle', f, f, 0.35, 0.25));
  }

  /** @deprecated Domination capture cue; silent until callers drop it. */
  capture(_ours: boolean) { /* no capture points */ }

  /** Cash award or purchase: a register ka-ching. */
  cash() {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.28, undefined, undefined, 0.2);
    this.noiseBurst(out, t, 0.03, 'bandpass', 3000, 3, 0.4);
    this.tone(out, t + 0.03, 'triangle', 2637, 2637, 0.16, 0.22);
    this.tone(out, t + 0.09, 'triangle', 3520, 3520, 0.3, 0.2);
    this.noiseBurst(out, t + 0.09, 0.25, 'highpass', 7000, 1, 0.12, 0.01);
  }

  /** Binoculars (Z) raised or lowered: a lens click and a short focus whirr. */
  binoculars() {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.25, undefined, undefined, 0.05);
    this.noiseBurst(out, t, 0.025, 'bandpass', 2200, 5, 0.7);
    this.tone(out, t + 0.03, 'sawtooth', 180, 260, 0.14, 0.05, 0.02);
    this.noiseBurst(out, t + 0.16, 0.02, 'bandpass', 3000, 5, 0.4);
  }

  explosion(listener: Listener, at: V3) {
    if (!this.ready) return;
    const t = this.now(), out = this.out(1.4, listener, at, 0.6);
    this.noiseBurst(out, t, 1.4, 'lowpass', 500, 0.7, 1.2, 0.004);
    this.noiseBurst(out, t, 0.25, 'bandpass', 1400, 0.6, 0.8);
    this.tone(out, t, 'sine', 70, 28, 0.9, 1.1);
  }

  /** An M18 popping: a dull pop, then the canister's long hiss. */
  smoke(listener: Listener, at: V3) {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.7, listener, at, 0.3);
    this.noiseBurst(out, t, 0.18, 'lowpass', 700, 0.8, 0.9, 0.003);
    this.noiseBurst(out, t + 0.05, 2.6, 'highpass', 2400, 0.5, 0.35, 0.25);
    this.noiseBurst(out, t + 0.05, 2.2, 'bandpass', 900, 0.7, 0.25, 0.3);
  }

  /** Drinking a 珍奶 (ours, or someone's nearby): the lid's pop, a long slurp through the straw and pearls bubbling up. */
  drink(listener?: Listener, at?: V3) {
    const t = this.now(), out = this.out(listener ? 0.5 : 0.75, listener, at, 0.3);
    this.tone(out, t, 'sine', 420, 1500, 0.06, 0.6);
    this.noiseBurst(out, t, 0.05, 'bandpass', 2200, 2, 0.45);
    const slurp = this.noiseBurst(out, t + 0.08, 0.9, 'bandpass', 500, 3, 0.4, 0.08);
    slurp.frequency.setValueAtTime(380, t + 0.08); slurp.frequency.exponentialRampToValueAtTime(1600, t + 0.9);
    for (let i = 0; i < 7; i++) this.tone(out, t + 0.2 + i * 0.11 + Math.random() * 0.04, 'sine', 300 + Math.random() * 260, 700 + Math.random() * 400, 0.05, 0.18);
    this.noiseBurst(out, t + 0.1, 2.2, 'bandpass', 900, 0.7, 0.18, 0.3);
  }

  footstep(listener: Listener | undefined, at: V3 | undefined, sprint: boolean) {
    if (!this.ready) return;
    const t = this.now(), out = this.out(listener ? 0.35 : 0.18, listener, at, 0.1);
    this.noiseBurst(out, t, 0.07, 'bandpass', 380 + Math.random() * 140, 1.2, sprint ? 0.9 : 0.6);
    this.noiseBurst(out, t + 0.01, 0.04, 'highpass', 2600, 1, 0.12);
  }

  jump() { if (!this.ready) return; const t = this.now(); this.noiseBurst(this.out(0.2), t, 0.1, 'bandpass', 500, 1, 0.5); }
  land(strength: number) { if (!this.ready) return; const t = this.now(); this.noiseBurst(this.out(0.3), t, 0.12, 'lowpass', 400, 1, Math.min(1.2, strength * 0.1)); }
  slide() { if (!this.ready) return; const t = this.now(); this.noiseBurst(this.out(0.25), t, 0.6, 'bandpass', 900, 0.6, 0.6, 0.03); }

  tick() { if (!this.ready) return; const t = this.now(); this.tone(this.out(0.15), t, 'square', 1200, 1200, 0.03, 0.08); }

  /** Rising shimmer (menu theme). */
  chime() {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.5, undefined, undefined, 0.8);
    this.tone(out, t, 'sine', 120, 1400, 0.7, 0.3, 0.05);
    this.tone(out, t + 0.1, 'triangle', 200, 2400, 0.6, 0.12, 0.05);
    this.noiseBurst(out, t, 0.8, 'bandpass', 1600, 0.5, 0.3, 0.2);
  }

  /** Falling sweep (menu theme). */
  sweep() {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.45, undefined, undefined, 0.8);
    this.tone(out, t, 'sawtooth', 1600, 90, 1.2, 0.12, 0.3);
    this.noiseBurst(out, t, 1.1, 'bandpass', 900, 2, 0.3, 0.6);
  }

  ui() { if (!this.ready) return; const t = this.now(); this.tone(this.out(0.2, undefined, undefined, 0.05), t, 'sine', 900, 1100, 0.05, 0.2); }

  /**
   * A running vehicle: a looping synthesized voice. Cars growl (two detuned saws through a low-pass
   * that opens with the revs), scooters buzz (a 125 cc single: square and saw through a band-pass),
   * the helicopter chops (filtered noise gated at the blade rate over a low thump). `set` moves revs
   * (0..1), level and position every frame; `stop` fades it out. Undefined until audio has started.
   */
  engine(kind: 'car' | 'scooter' | 'heli'): EngineVoice | undefined {
    const ctx = this.ctx;
    if (!(ctx instanceof AudioContext) || !this.live) return undefined;
    const t = this.now();
    const out = ctx.createGain(); out.gain.value = 0;
    const pan = ctx.createStereoPanner();
    // Unplugged from the world bus once stop() has ended every source (see src/voices.ts).
    const voice = new Voice();
    out.connect(pan);
    voice.route(pan, this.world);
    const osc = (type: OscillatorType, f: number) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(t); voice.track(o); return o; };
    let tune: (rpm: number) => void;
    if (kind === 'heli') {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true; src.start(t); voice.track(src);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      const chop = ctx.createGain(); chop.gain.value = 0.5;
      const lfo = osc('sine', 10); const depth = ctx.createGain(); depth.gain.value = 0.5;
      lfo.connect(depth).connect(chop.gain);
      src.connect(lp).connect(chop).connect(out);
      const thump = osc('sine', 46); const tg = ctx.createGain(); tg.gain.value = 0.5;
      thump.connect(tg).connect(out);
      const whine = osc('sawtooth', 380); const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 900; wf.Q.value = 4;
      const wg = ctx.createGain(); wg.gain.value = 0.05; whine.connect(wf).connect(wg).connect(out);
      tune = rpm => {
        const now = ctx.currentTime;
        lfo.frequency.setTargetAtTime(3 + rpm * 10, now, 0.1);
        thump.frequency.setTargetAtTime(30 + rpm * 22, now, 0.1);
        whine.frequency.setTargetAtTime(160 + rpm * 300, now, 0.2);
        lp.frequency.setTargetAtTime(400 + rpm * 700, now, 0.1);
      };
    } else if (kind === 'scooter') {
      const a = osc('square', 60), b = osc('sawtooth', 121);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
      const mix = ctx.createGain(); mix.gain.value = 0.22;
      a.connect(bp); b.connect(bp); bp.connect(mix).connect(out);
      tune = rpm => {
        const now = ctx.currentTime, f = 55 + rpm * 165;
        a.frequency.setTargetAtTime(f, now, 0.06); b.frequency.setTargetAtTime(f * 2.02, now, 0.06);
        bp.frequency.setTargetAtTime(700 + rpm * 1500, now, 0.08);
      };
    } else {
      const a = osc('sawtooth', 40), b = osc('sawtooth', 40.7), sub = osc('sine', 20);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 2;
      const mix = ctx.createGain(); mix.gain.value = 0.3;
      a.connect(lp); b.connect(lp); lp.connect(mix).connect(out);
      const sg = ctx.createGain(); sg.gain.value = 0.4; sub.connect(sg).connect(out);
      tune = rpm => {
        const now = ctx.currentTime, f = 34 + rpm * 92;
        a.frequency.setTargetAtTime(f, now, 0.08); b.frequency.setTargetAtTime(f * 1.012, now, 0.08); sub.frequency.setTargetAtTime(f / 2, now, 0.08);
        lp.frequency.setTargetAtTime(300 + rpm * 1700, now, 0.08);
      };
    }
    const base = kind === 'heli' ? 0.55 : kind === 'scooter' ? 0.32 : 0.4;
    voice.seal();
    let stopped = false;
    return {
      set: (rpm, listener, at) => {
        if (stopped) return;
        const r = unit(rpm);
        tune(r);
        let gain = base * (0.55 + r * 0.45), p = 0;
        if (listener && at) { const sp = this.spatial(listener, at); gain /= 1 + sp.d * 0.07; p = sp.pan; }
        out.gain.setTargetAtTime(this.muted ? 0 : gain, ctx.currentTime, 0.08);
        pan.pan.setTargetAtTime(p, ctx.currentTime, 0.05);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        out.gain.setTargetAtTime(0, now, 0.15);
        voice.stop(now + 0.8);
      },
    };
  }

  /**
   * Tyre screech while a car or scooter slides: a squeal (two detuned triangles wobbling at a fast
   * vibrato) over band-passed hiss. `set(amount)` (0..1 skid) fades it in and bends it up with the
   * slide; `stop` fades it out. Undefined until audio has started.
   */
  screech(kind: 'car' | 'scooter'): EngineVoice | undefined {
    const ctx = this.ctx;
    if (!(ctx instanceof AudioContext) || !this.live) return undefined;
    const t = this.now();
    const out = ctx.createGain(); out.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const voice = new Voice();
    out.connect(pan);
    voice.route(pan, this.world);
    const base = kind === 'car' ? 820 : 1150;
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = 'triangle'; b.type = 'triangle'; a.frequency.value = base; b.frequency.value = base * 1.47;
    const vib = ctx.createOscillator(); vib.frequency.value = 13;
    const vibDepth = ctx.createGain(); vibDepth.gain.value = base * 0.03;
    vib.connect(vibDepth); vibDepth.connect(a.frequency); vibDepth.connect(b.frequency);
    const tone = ctx.createGain(); tone.gain.value = 0.13;
    a.connect(tone); b.connect(tone);
    const hiss = ctx.createBufferSource(); hiss.buffer = this.noise; hiss.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = base * 1.6; bp.Q.value = 3;
    const hg = ctx.createGain(); hg.gain.value = 0.5;
    hiss.connect(bp).connect(hg).connect(out);
    tone.connect(out);
    for (const n of [a, b, vib, hiss]) { n.start(t); voice.track(n); }
    voice.seal();
    let stopped = false;
    return {
      set: (amount, listener, at) => {
        if (stopped) return;
        const r = unit(amount), now = ctx.currentTime;
        a.frequency.setTargetAtTime(base * (0.9 + r * 0.25), now, 0.08);
        b.frequency.setTargetAtTime(base * 1.47 * (0.9 + r * 0.25), now, 0.08);
        let gain = (kind === 'car' ? 0.36 : 0.24) * r * r, p = 0;
        if (listener && at) { const sp = this.spatial(listener, at); gain /= 1 + sp.d * 0.08; p = sp.pan; }
        out.gain.setTargetAtTime(this.muted ? 0 : gain, now, 0.06);
        pan.pan.setTargetAtTime(p, now, 0.05);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        out.gain.setTargetAtTime(0, now, 0.1);
        voice.stop(now + 0.6);
      },
    };
  }

  /** Doors and seat: a latch clunk getting in or out of a vehicle. */
  door() {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.35, undefined, undefined, 0.15);
    this.noiseBurst(out, t, 0.09, 'lowpass', 600, 1, 0.9);
    this.tone(out, t, 'square', 140, 70, 0.07, 0.15);
    this.noiseBurst(out, t + 0.05, 0.05, 'bandpass', 2200, 3, 0.25);
  }

  /** Metal impact (a vehicle hitting something), louder with the speed lost. */
  crash(strength: number, listener?: Listener, at?: V3) {
    if (!this.ready) return;
    const t = this.now(), out = this.out(Math.min(1.2, 0.3 + strength * 0.05), listener, at, 0.4);
    this.noiseBurst(out, t, 0.35, 'lowpass', 900, 0.8, 1);
    this.noiseBurst(out, t, 0.2, 'bandpass', 2600, 2, 0.5);
    this.tone(out, t, 'sine', 90, 40, 0.3, 0.6);
  }

  /** Endless low filtered-noise wind bed. */
  private wind() {
    const ctx = this.ctx!, t = this.now();
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(f.frequency); lfo.start(t);
    src.connect(f).connect(g).connect(this.world); src.start(t);
  }
}

/** Decaying stereo noise impulse response used for the shared reverb. */
export function reverbImpulse(ctx: BaseAudioContext, seconds: number, decay = 3.2) {
  const ir = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
  }
  return ir;
}

/**
 * Outdoor gunshot tail: a handful of discrete slaps off nearby walls (40–260 ms, different per ear),
 * then a diffuse roll that swells, darkens and decays over about 2.4 s.
 */
function outdoorImpulse(ctx: BaseAudioContext, seconds = 2.4) {
  const rate = ctx.sampleRate, n = Math.ceil(rate * seconds);
  const ir = ctx.createBuffer(2, n, rate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    // Diffuse roll: noise through a one-pole low-pass that closes over time.
    let y = 0;
    for (let i = 0; i < n; i++) {
      const s = i / rate;
      const env = Math.min(1, s / 0.12) * Math.exp(-s * 2.6);
      const k = 0.55 - 0.45 * Math.min(1, s / seconds);
      y += k * ((Math.random() * 2 - 1) - y);
      d[i] = y * env * 0.55;
    }
    // Early slaps: short bright bursts.
    for (let r = 0; r < 7; r++) {
      const at = 0.04 + Math.random() * 0.22, len = Math.floor(rate * (0.003 + Math.random() * 0.004));
      const start = Math.floor(at * rate), gain = (0.9 - r * 0.08) * (0.5 + Math.random() * 0.5);
      for (let i = 0; i < len && start + i < n; i++) d[start + i] += (Math.random() * 2 - 1) * gain * (1 - i / len);
    }
  }
  return ir;
}

/** Seconds into a recording where the sound begins (first sample above 5% of the peak, minus 1 ms). */
function onsetOf(buffer: AudioBuffer) {
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  const threshold = peak * 0.05;
  let i = 0;
  while (i < data.length && Math.abs(data[i]) < threshold) i++;
  return Math.max(0, i / buffer.sampleRate - 0.001);
}
