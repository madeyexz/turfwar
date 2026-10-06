import type { Audio } from './audio';

let started = false;

/** In dev builds the game (window.__game) adds its vehicle voices and whether we are alive. */
function gameExtras() {
  const g = (window as unknown as { __game?: { engines?: Map<number, unknown>; screeches?: Map<number, unknown>; player?: { alive: boolean } } }).__game;
  return g ? { engines: g.engines?.size ?? 0, screeches: g.screeches?.size ?? 0, alive: g.player?.alive } : {};
}

/**
 * Debug only (?audiodebug): every 250 ms logs the level (dBFS RMS / peak) and NaN count at each
 * stage of the mix, the compressors' gain reduction, bus gains, voice counts, the context state and
 * the audio clock's speed against the wall clock (below 1: the audio thread is missing deadlines).
 */
export function startAudioProbe(audio: Audio, extra: () => Record<string, unknown> = gameExtras) {
  const taps = audio.debugTaps();
  if (!taps || started) return;
  started = true;
  const { ctx } = taps;
  const stages: [string, AudioNode][] = [['world', taps.world], ['gun', taps.gunBus], ['tail', taps.tail], ['verb', taps.reverb], ['master', taps.master], ['comp', taps.comp], ['out', taps.limit]];
  const probes = stages.map(([name, node]) => {
    const a = ctx.createAnalyser(); a.fftSize = 8192; node.connect(a);
    return { name, a, buf: new Float32Array(a.fftSize) };
  });
  const db = (x: number) => x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf';
  let errors = 0;
  // Automated browsers read (and drain) the trace from here.
  const log: string[] = (window as unknown as { __audioLog: string[] }).__audioLog = [];
  addEventListener('error', () => errors++);
  let lastWall = performance.now(), lastAudio = ctx.currentTime;
  // Main-thread load and audio-node churn per interval.
  let frames = 0, longTask = 0, created = 0;
  const countFrame = () => { frames++; requestAnimationFrame(countFrame); };
  requestAnimationFrame(countFrame);
  try { new PerformanceObserver(list => { for (const e of list.getEntries()) longTask += e.duration; }).observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ }
  const proto = BaseAudioContext.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of Object.getOwnPropertyNames(BaseAudioContext.prototype)) {
    if (!name.startsWith('create') || typeof proto[name] !== 'function') continue;
    const original = proto[name];
    proto[name] = function (this: BaseAudioContext, ...args: unknown[]) { created++; return original.apply(this, args); };
  }
  setInterval(() => {
    // Audio clock speed against the wall clock: well below 1 means the render thread is starving.
    const wall = performance.now(), rate = (ctx.currentTime - lastAudio) / Math.max(1e-3, (wall - lastWall) / 1000);
    lastWall = wall; lastAudio = ctx.currentTime;
    const parts: string[] = [];
    for (const p of probes) {
      p.a.getFloatTimeDomainData(p.buf);
      let sum = 0, peak = 0, nan = 0;
      for (const x of p.buf) { if (!Number.isFinite(x)) { nan++; continue; } sum += x * x; peak = Math.max(peak, Math.abs(x)); }
      parts.push(`${p.name}=${db(Math.sqrt(sum / p.buf.length))}/${db(peak)}${nan ? ` NaN${nan}` : ''}`);
    }
    const info = { wall: (wall / 1000).toFixed(2), t: ctx.currentTime.toFixed(2), rate: rate.toFixed(2), frames, longTask: Math.round(longTask), nodes: created, state: (ctx as AudioContext).state, comp: taps.comp.reduction.toFixed(1), lim: taps.limit.reduction.toFixed(1), worldGain: taps.world.gain.value.toFixed(2), masterGain: taps.master.gain.value.toFixed(2), ...taps.voices(), errors, ...extra() };
    const line = `[audio] ${Object.entries(info).map(([k, v]) => `${k}=${v}`).join(' ')} | ${parts.join(' ')}`;
    console.log(line);
    log.push(line); if (log.length > 4000) log.splice(0, 1000);
    frames = 0; longTask = 0; created = 0;
  }, 250);
}
