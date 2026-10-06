/**
 * Renders each cut's audio in a headless browser (trailer/web/audio.ts):
 *   build/<cut>.music.wav   the score for the cut's sections (also kept as music/<cut>.flac)
 *   build/<cut>.sfx.wav     the game's sounds replayed from the capture logs, placed by the edit
 *   bun trailer/scripts/audio.ts [--music-only | --sfx-only] [cut ids…]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CUTS, FPS, type Cut } from '../edit';
import { Browser, type Page } from './cdp';
import { FFMPEG, ROOT, run } from './util';

const BASE = process.env.TRAILER_URL ?? 'http://127.0.0.1:5201';
const args = process.argv.slice(2);
const wanted = args.filter(a => !a.startsWith('--'));
const BUILD = join(ROOT, 'build');
mkdirSync(BUILD, { recursive: true });

interface SoundEvent { t: number; f: string; a: unknown[]; v?: number }

/** The game sounds of a cut: each segment's slice of its clip's log, moved to the segment's place. */
export function sfxPlan(cut: Cut) {
  const events: SoundEvent[] = [];
  let at = 0;
  cut.segments.forEach((seg, i) => {
    const start = at / FPS, t0 = seg.in / FPS, t1 = (seg.in + seg.frames) / FPS;
    at += seg.frames;
    if (seg.clip.startsWith('card:') || seg.sound === false) return;
    const log = join(ROOT, 'captures', `${seg.clip}.sounds.json`);
    if (!existsSync(log)) { console.warn(`  no sound log for ${seg.clip}`); return; }
    const { sounds } = JSON.parse(readFileSync(log, 'utf8')) as { sounds: SoundEvent[] };
    const id = (v?: number) => v === undefined ? undefined : i * 100000 + v;
    // Engines and screeches already running at the in-point start with the segment, at their last setting.
    const running = new Map<number, { make: SoundEvent; set?: SoundEvent }>();
    for (const e of sounds) {
      if (e.t >= t0) break;
      if (e.f === 'engine' || e.f === 'screech') running.set(e.v!, { make: e });
      else if (e.f === 'voice.set' && running.has(e.v!)) running.get(e.v!)!.set = e;
      else if (e.f === 'voice.stop') running.delete(e.v!);
    }
    for (const { make, set } of running.values()) {
      events.push({ ...make, t: start, v: id(make.v) });
      if (set) events.push({ ...set, t: start + 0.001, v: id(set.v) });
    }
    const live = new Set<number>(running.keys());
    for (const e of sounds) {
      if (e.t < t0 || e.t >= t1) continue;
      events.push({ ...e, t: start + (e.t - t0), v: id(e.v) });
      if (e.f === 'engine' || e.f === 'screech') live.add(e.v!);
      if (e.f === 'voice.stop') live.delete(e.v!);
    }
    // Hard cut: whatever still runs stops with the shot.
    for (const v of live) events.push({ t: start + (t1 - t0) - 0.01, f: 'voice.stop', a: [], v: id(v) });
  });
  events.sort((a, b) => a.t - b.t);
  return { seconds: at / FPS, events };
}

async function fetchBase64(page: Page, expression: string) {
  const length = await page.eval<number>(`(async () => { window.__out = await (${expression}); return window.__out.length; })()`);
  let out = '';
  for (let i = 0; i < length; i += 4_000_000) out += await page.eval<string>(`window.__out.slice(${i}, ${i + 4_000_000})`);
  return Buffer.from(out, 'base64');
}

if (import.meta.main) {
  const browser = new Browser();
  await browser.launch();
  try {
    const page = await browser.page(800, 600, 1);
    await page.navigate(`${BASE}/trailer/web/audio.html`);
    await page.waitFor('window.__trailerAudio', 60000, 'audio renderer');
    for (const cut of CUTS.filter(c => !wanted.length || wanted.includes(c.id))) {
      if (!args.includes('--sfx-only')) {
        const t = Date.now();
        const music = await fetchBase64(page, `__trailerAudio.renderScore(${JSON.stringify(cut.score)})`);
        writeFileSync(join(BUILD, `${cut.id}.music.wav`), music);
        await run(FFMPEG, ['-v', 'error', '-y', '-i', join(BUILD, `${cut.id}.music.wav`), '-compression_level', '8', join(ROOT, 'music', `${cut.id}.flac`)]);
        console.log(`  ${cut.id}: music ${(music.length / 1e6).toFixed(1)} MB in ${((Date.now() - t) / 1000).toFixed(0)} s`);
      }
      if (!args.includes('--music-only')) {
        const t = Date.now(), plan = sfxPlan(cut);
        const sfx = await fetchBase64(page, `__trailerAudio.renderSfx(${JSON.stringify(plan)})`);
        writeFileSync(join(BUILD, `${cut.id}.sfx.wav`), sfx);
        console.log(`  ${cut.id}: ${plan.events.length} game sounds in ${((Date.now() - t) / 1000).toFixed(0)} s`);
      }
    }
  } finally { browser.close(); }
}
