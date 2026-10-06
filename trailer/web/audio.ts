/**
 * Offline audio for the trailer, run in the browser by trailer/scripts/audio.ts:
 *  - renderScore(sections): the original score (trailer/music/score.ts);
 *  - renderSfx(plan): the game's own sound replayed from the capture logs — the same Audio class,
 *    live mix chain and CC0 recordings the game plays, stepped on an OfflineAudioContext so every
 *    gunshot, reload, engine and explosion lands on the frame it was captured on.
 * Both return 16-bit PCM WAV files as base64.
 */
import { Audio, type EngineVoice } from '../../src/audio';
import { renderScore, RATE } from '../music/score';
import type { Section } from '../music/score';

interface SoundEvent { t: number; f: string; a: unknown[]; v?: number }

function wav(buffer: AudioBuffer) {
  const n = buffer.length, ch = buffer.numberOfChannels, bytes = 44 + n * ch * 2;
  const out = new DataView(new ArrayBuffer(bytes));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, buffer.sampleRate, true);
  out.setUint32(28, buffer.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  // Base64 in chunks (String.fromCharCode has an argument limit).
  const u8 = new Uint8Array(out.buffer);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function renderSfx(plan: { seconds: number; events: SoundEvent[] }) {
  const ctx = new OfflineAudioContext(2, Math.ceil(plan.seconds * RATE), RATE);
  const sfx = new Audio();
  await sfx.start(ctx);
  const quantum = 128 / RATE;
  const groups = new Map<number, SoundEvent[]>();
  for (const e of plan.events) {
    const k = Math.max(1, Math.round(e.t / quantum));
    if (k * quantum >= plan.seconds - 0.05) continue;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const voices = new Map<number, EngineVoice>();
  const play = (e: SoundEvent) => {
    const a = sfx as unknown as Record<string, (...args: unknown[]) => unknown>;
    try {
      if (e.f === 'engine' || e.f === 'screech') { const v = a[e.f](...e.a) as EngineVoice | undefined; if (v && e.v !== undefined) voices.set(e.v, v); }
      else if (e.f === 'voice.set') voices.get(e.v!)?.set(...(e.a as Parameters<EngineVoice['set']>));
      else if (e.f === 'voice.stop') { voices.get(e.v!)?.stop(); voices.delete(e.v!); }
      else a[e.f]?.(...e.a);
    } catch (error) { console.warn('sound', e.f, error); }
  };
  for (const [k, list] of [...groups].sort((x, y) => x[0] - y[0])) {
    void ctx.suspend(k * quantum).then(() => { for (const e of list) play(e); void ctx.resume(); });
  }
  return wav(await ctx.startRendering());
}

Object.assign(window, {
  __trailerAudio: {
    renderScore: async (sections: [Section, number][], cuts: number[]) => wav(await renderScore(sections, cuts)),
    renderSfx,
  },
});
