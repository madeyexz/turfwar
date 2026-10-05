import type { WeaponId } from '../shared/weapons';

type V3 = { x: number; y: number; z: number };

/**
 * Sound design: recorded CC0 gunshots (public/assets/sfx, see tools/fetch-sounds.ts) played per
 * weapon with its own rate, gain and filtering, plus procedural mechanical tails, footsteps,
 * reloads, the knife, explosions, the bomb and round cues, all spatialized for remote sources.
 */
/**
 * Recorded shot per weapon: sample file, playback rate (pitch and length), gain and optional
 * filters. Every firearm has its own recording; the knife has none (a synthesized swish).
 */
interface GunSample { file: string; rate: number; gain: number; lowpass?: number; highpass?: number; layers?: GunSound['layers'] }
const GUN_SAMPLES: Partial<Record<WeaponId, GunSample>> = {
  m9a1: { file: 'pistol-9mm', rate: 1, gain: 0.85 },
  mp7: { file: 'smg-tokarev', rate: 1.12, gain: 0.74, highpass: 260 },
  mp5: { file: 'smg-9mm', rate: 1, gain: 0.8 },
  m4a1: { file: 'rifle-556', rate: 1, gain: 0.88 },
  m249: { file: 'rifle-762', rate: 0.94, gain: 0.95, lowpass: 9000 },
  m1014: { file: 'shotgun-pump', rate: 1, gain: 1 },
  m110: { file: 'sniper-3006', rate: 1.02, gain: 1 },
};

/** A decoded recording and where its shot starts (skips encoder padding and silence). */
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

type Listener = { pos: V3; yaw: number };

export class Audio {
  private ctx?: BaseAudioContext;
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  /** Start time for sounds while recording offline; live play uses the context clock. */
  private clock?: number;
  private music?: { src: AudioBufferSourceNode; gain: GainNode };
  private samples = new Map<string, Sample>();
  muted = false;
  volume = 0.8;
  musicVolume = 0.6;

  start() {
    if (this.ctx) { void (this.ctx as AudioContext).resume(); return; }
    const ctx = new AudioContext();
    this.build(ctx);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = reverbImpulse(ctx, 1.6);
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.wind();
    void this.loadSamples(ctx);
  }

  /** Fetch and decode the gunshot recordings; until each arrives its weapon stays synthesized. */
  private async loadSamples(ctx: AudioContext) {
    const files = [...new Set(Object.values(GUN_SAMPLES).map(g => g!.file))];
    await Promise.all(files.map(async file => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}assets/sfx/${file}.mp3`);
        if (!res.ok) return;
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        this.samples.set(file, { buffer, onset: onsetOf(buffer) });
      } catch { /* keep the synthesized shot */ }
    }));
  }

  private build(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
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

  /** Output chain: optional stereo pan + distance attenuation + reverb send. */
  private out(gain: number, listener?: Listener, at?: V3, wet = 0.35) {
    const ctx = this.ctx!;
    const g = ctx.createGain(); g.gain.value = gain;
    let node: AudioNode = g;
    if (listener && at) {
      const dx = at.x - listener.pos.x, dz = at.z - listener.pos.z, dy = at.y - listener.pos.y;
      const d = Math.hypot(dx, dy, dz);
      g.gain.value = gain / (1 + d * 0.09);
      const pan = ctx.createStereoPanner();
      // Listener right vector for yaw: (cos, -sin).
      const right = (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / (d || 1);
      pan.pan.value = Math.max(-1, Math.min(1, right * 0.85));
      // Distant shots lose their highs.
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(900, 16000 / (1 + d * 0.06));
      g.connect(lp).connect(pan); node = pan;
      wet = Math.min(0.9, wet + d * 0.01);
    }
    node.connect(this.master);
    const send = ctx.createGain(); send.gain.value = wet; node.connect(send).connect(this.reverbSend);
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
    return f;
  }

  private tone(dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number, attack = 0.002) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  /**
   * One shot of `weapon` (the knife swishes). `suppressed` (Suppressor attachment) trades the
   * crack for a muffled, quieter thump with a sharp mechanical snap and little room echo.
   */
  gunshot(weapon: WeaponId, listener?: Listener, at?: V3, suppressed = false) {
    if (!this.ready) return;
    const t = this.now(), sound = GUN_SOUNDS[weapon];
    if (sound.melee) { this.swish(t, listener, at); return; }
    const recorded = GUN_SAMPLES[weapon], sample = recorded && this.samples.get(recorded.file);
    if (recorded && sample) { this.playShot(recorded, sample, sound, t, listener, at, suppressed); return; }
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

  /** A recorded shot, pitched and filtered per weapon, muffled with distance (and by a suppressor), then its action cycling. */
  private playShot(g: GunSample, sample: Sample, sound: GunSound, t: number, listener: Listener | undefined, at: V3 | undefined, suppressed: boolean) {
    const ctx = this.ctx!;
    const out = this.out((listener ? 0.7 : 0.5) * g.gain * (suppressed ? 0.34 : 1), listener, at, suppressed ? 0.1 : listener ? 0.45 : 0.22);
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.value = g.rate * (suppressed ? 1.12 : 1) * (1 + (Math.random() - 0.5) * 0.05);
    let node: AudioNode = src;
    const distance = listener && at ? Math.hypot(at.x - listener.pos.x, at.y - listener.pos.y, at.z - listener.pos.z) : 0;
    const lowpass = Math.min(suppressed ? 1500 : g.lowpass ?? 20000, 20000 / (1 + distance * 0.04));
    if (lowpass < 19000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; node = node.connect(f); }
    const highpass = suppressed ? Math.max(g.highpass ?? 0, 240) : g.highpass;
    if (highpass) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = highpass; node = node.connect(f); }
    node.connect(out);
    src.start(t, sample.onset);
    if (suppressed) {
      // The crack is gone; what is left is the action slamming and gas spitting from the can.
      const snap = this.out(listener ? 0.45 : 0.35, listener, at, 0.05);
      this.noiseBurst(snap, t, 0.022, 'highpass', 3600, 0.8, 0.6);
      this.noiseBurst(snap, t + 0.004, 0.03, 'bandpass', 2000, 3, 0.35);
    } else for (const [type, f0, f1, dur, gain, delay = 0] of g.layers ?? []) this.tone(out, t + delay, type, f0, f1, dur, gain);
    this.actionTail(out, sound.tail, t);
  }

  /** Knife slash through the air. */
  private swish(t: number, listener?: Listener, at?: V3) {
    const out = this.out(listener ? 0.4 : 0.32, listener, at, 0.08);
    const f = this.noiseBurst(out, t, 0.18, 'bandpass', 900, 2.2, 0.8, 0.04);
    f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(3400, t + 0.16);
  }

  /** Knife: the swing, and on a hit a blunt stab into the target. */
  knife(hit: boolean, listener?: Listener, at?: V3) {
    if (!this.ready) return;
    const t = this.now();
    this.swish(t, listener, at);
    if (!hit) return;
    const out = this.out(listener ? 0.55 : 0.45, listener, at, 0.06);
    this.tone(out, t + 0.06, 'sine', 140, 55, 0.12, 0.8);
    this.noiseBurst(out, t + 0.06, 0.07, 'lowpass', 900, 1, 0.7);
    this.noiseBurst(out, t + 0.07, 0.05, 'bandpass', 2600, 4, 0.25);
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

  dryFire() { if (!this.ready) return; const t = this.now(); this.noiseBurst(this.out(0.3), t, 0.02, 'highpass', 3000, 2, 0.5); }

  reload(stage: 'out' | 'in' | 'charge') {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.35, undefined, undefined, 0.1);
    if (stage === 'out') { this.noiseBurst(out, t, 0.05, 'bandpass', 1800, 4, 0.6); this.tone(out, t, 'triangle', 600, 300, 0.05, 0.2); }
    else if (stage === 'in') { this.noiseBurst(out, t, 0.06, 'bandpass', 1200, 3, 0.9); this.noiseBurst(out, t + 0.05, 0.04, 'highpass', 4000, 2, 0.5); }
    else { this.noiseBurst(out, t, 0.04, 'bandpass', 2600, 5, 0.7); this.noiseBurst(out, t + 0.09, 0.05, 'bandpass', 1600, 5, 0.8); }
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

  /** Endless low filtered-noise wind bed. */
  private wind() {
    const ctx = this.ctx!, t = this.now();
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(f.frequency); lfo.start(t);
    src.connect(f).connect(g).connect(this.master); src.start(t);
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

/** Seconds into a recording where the shot begins (first sample above 5% of the peak, minus 1 ms). */
function onsetOf(buffer: AudioBuffer) {
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  const threshold = peak * 0.05;
  let i = 0;
  while (i < data.length && Math.abs(data[i]) < threshold) i++;
  return Math.max(0, i / buffer.sampleRate - 0.001);
}
