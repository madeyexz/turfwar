import type { WeaponId } from '../shared/weapons';

type V3 = { x: number; y: number; z: number };

/**
 * Procedural sound design (no sample assets): layered gunshots with transient, body, sub
 * thump and reverb tail; spatialized remote fire, footsteps, reloads, explosions and UI cues.
 */
export class Audio {
  private ctx?: AudioContext;
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private wind?: AudioBufferSourceNode;
  muted = false;
  volume = 0.8;

  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.reverb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, ctx.sampleRate * 1.6, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2);
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.32;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.startWind();
  }

  setMuted(muted: boolean) { this.muted = muted; if (this.master) this.master.gain.value = muted ? 0 : this.volume; }

  private get ready() { return !!this.ctx && !this.muted; }
  private now() { return this.ctx!.currentTime; }

  /** Output chain: optional stereo pan + distance attenuation + reverb send. */
  private out(gain: number, listener?: { pos: V3; yaw: number }, at?: V3, wet = 0.35) {
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

  gunshot(weapon: WeaponId, listener?: { pos: V3; yaw: number }, at?: V3) {
    if (!this.ready) return;
    const t = this.now();
    const heavy = weapon === 'lancer' ? 1.6 : weapon === 'magnum' ? 1.35 : weapon === 'sidearm' ? 0.8 : 1;
    const out = this.out(listener ? 0.75 : 0.55, listener, at, listener ? 0.5 : 0.28);
    // Transient crack, mid body, sub thump, mechanical tail and a faint energy zap.
    this.noiseBurst(out, t, 0.03, 'highpass', 2500, 0.7, 0.9 * heavy);
    this.noiseBurst(out, t, 0.11 * heavy, 'bandpass', 1100 / heavy, 0.9, 1.1);
    this.tone(out, t, 'sine', 130 * (1.2 - heavy * 0.25), 38, 0.14 * heavy, 0.95);
    this.noiseBurst(out, t + 0.01, 0.35 * heavy, 'lowpass', 900, 0.5, 0.35);
    if (weapon === 'carbine' || weapon === 'lancer') this.tone(out, t, 'sawtooth', weapon === 'lancer' ? 1800 : 1400, 260, 0.07 * heavy, 0.08);
    if (weapon === 'lancer') this.tone(out, t + 0.02, 'sine', 3200, 600, 0.35, 0.12);
  }

  boltShot(listener: { pos: V3; yaw: number }, at: V3) {
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

  damage(shield: boolean) {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.5, undefined, undefined, 0.1);
    if (shield) { this.tone(out, t, 'sine', 700, 380, 0.12, 0.25); this.noiseBurst(out, t, 0.08, 'highpass', 5000, 1, 0.2); }
    else { this.tone(out, t, 'sine', 90, 50, 0.18, 0.7); this.noiseBurst(out, t, 0.1, 'lowpass', 600, 1, 0.5); }
  }

  shieldBreak() {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.45);
    for (let i = 0; i < 4; i++) this.tone(out, t + i * 0.02, 'triangle', 2400 - i * 300, 600, 0.25, 0.12);
  }

  explosion(listener: { pos: V3; yaw: number }, at: V3) {
    if (!this.ready) return;
    const t = this.now(), out = this.out(1.4, listener, at, 0.6);
    this.noiseBurst(out, t, 1.4, 'lowpass', 500, 0.7, 1.2, 0.004);
    this.noiseBurst(out, t, 0.25, 'bandpass', 1400, 0.6, 0.8);
    this.tone(out, t, 'sine', 70, 28, 0.9, 1.1);
  }

  footstep(listener: { pos: V3; yaw: number } | undefined, at: V3 | undefined, sprint: boolean) {
    if (!this.ready) return;
    const t = this.now(), out = this.out(listener ? 0.35 : 0.18, listener, at, 0.1);
    this.noiseBurst(out, t, 0.07, 'bandpass', 380 + Math.random() * 140, 1.2, sprint ? 0.9 : 0.6);
    this.noiseBurst(out, t + 0.01, 0.04, 'highpass', 2600, 1, 0.12);
  }

  jump() { if (!this.ready) return; const t = this.now(); this.noiseBurst(this.out(0.2), t, 0.1, 'bandpass', 500, 1, 0.5); }
  land(strength: number) { if (!this.ready) return; const t = this.now(); this.noiseBurst(this.out(0.3), t, 0.12, 'lowpass', 400, 1, Math.min(1.2, strength * 0.1)); }
  slide() { if (!this.ready) return; const t = this.now(); this.noiseBurst(this.out(0.25), t, 0.6, 'bandpass', 900, 0.6, 0.6, 0.03); }

  capture(ours: boolean) {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.35, undefined, undefined, 0.5);
    const notes = ours ? [523, 659, 784, 1046] : [392, 349, 311];
    notes.forEach((f, i) => this.tone(out, t + i * 0.09, 'triangle', f, f, 0.35, 0.25));
  }

  tick() { if (!this.ready) return; const t = this.now(); this.tone(this.out(0.15), t, 'square', 1200, 1200, 0.03, 0.08); }

  law() {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.5, undefined, undefined, 0.8);
    this.tone(out, t, 'sine', 120, 1400, 0.7, 0.3, 0.05);
    this.tone(out, t + 0.1, 'triangle', 200, 2400, 0.6, 0.12, 0.05);
    this.noiseBurst(out, t, 0.8, 'bandpass', 1600, 0.5, 0.3, 0.2);
  }

  rewind() {
    if (!this.ready) return;
    const t = this.now(), out = this.out(0.45, undefined, undefined, 0.8);
    this.tone(out, t, 'sawtooth', 1600, 90, 1.2, 0.12, 0.3);
    this.noiseBurst(out, t, 1.1, 'bandpass', 900, 2, 0.3, 0.6);
  }

  ui() { if (!this.ready) return; const t = this.now(); this.tone(this.out(0.2, undefined, undefined, 0.05), t, 'sine', 900, 1100, 0.05, 0.2); }

  private startWind() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(f.frequency); lfo.start();
    src.connect(f).connect(g).connect(this.master); src.start();
    this.wind = src;
  }
}
