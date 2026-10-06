/**
 * Capture driver: renders every shot in trailer/shots.ts frame by frame in a headless GPU Chrome.
 *
 *   bun trailer/scripts/capture.ts                 # every shot not captured yet
 *   bun trailer/scripts/capture.ts --only a,b      # just these (re-captures them)
 *   bun trailer/scripts/capture.ts --preview       # a contact sheet per shot (every 15th frame), fast
 *   bun trailer/scripts/capture.ts --force         # re-capture everything
 *
 * Needs the Vite dev server (TRAILER_URL, default http://127.0.0.1:5201). Each shot loads the game
 * with `?capture&trailer` under a virtual clock (vclock.ts), runs its setup, then for each frame
 * advances exactly 1/30 s and screenshots at 1.5× device scale. Frames become a near-lossless
 * 1920×1080 clip (captures/<id>.mp4) and the sounds the game played become captures/<id>.sounds.json.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOTS, type Shot, type Step } from '../shots';
import { Browser, type Page } from './cdp';
import { VCLOCK_SOURCE } from './vclock';
import { FFMPEG, ROOT, run } from './util';

const BASE = process.env.TRAILER_URL ?? 'http://127.0.0.1:5201';
const SCALE = 1.5;
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : undefined;
const preview = flag('--preview');
const keep = flag('--keep');
const CAPTURES = join(ROOT, 'captures');
mkdirSync(join(CAPTURES, 'preview'), { recursive: true });

const shots = SHOTS.filter(s => only ? only.includes(s.id) : flag('--force') || preview || !existsSync(join(CAPTURES, `${s.id}.mp4`)));
if (only) for (const id of only) if (!SHOTS.some(s => s.id === id)) throw new Error(`unknown shot ${id}`);
console.log(`${shots.length} shot(s): ${shots.map(s => s.id).join(', ')}`);

const browser = new Browser();
await browser.launch();
let page: Page | undefined;
try {
  for (const shot of shots) {
    const t0 = Date.now();
    // A fresh page per shot: no state leaks between shots.
    page?.close();
    page = await browser.page(1920, 1080, shot.scale ?? SCALE);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: VCLOCK_SOURCE });
    await capture(page, shot);
    console.log(`  ${shot.id} done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
} finally {
  page?.close();
  browser.close();
}

async function runSteps(page: Page, steps: Step[] = []) {
  for (const s of steps) {
    if (s.js) {
      const r = await page.eval(s.js);
      if (s.log) console.log(`    ${s.log}:`, JSON.stringify(r).slice(0, 600));
    }
    if (s.sleep) await Bun.sleep(s.sleep);
    if (s.frames) await page.eval(`__trailer.tick(${s.frames})`);
    if (s.until) {
      let n = 0;
      while (!(await page.eval(`!!(${s.until})`))) {
        await page.eval('__trailer.tick(5)');
        n += 5;
        if (n > (s.max ?? 3000)) throw new Error(`setup step never met: ${s.until}`);
      }
    }
  }
}

async function capture(page: Page, shot: Shot) {
  const url = `${BASE}/${shot.page ?? ''}?capture&trailer&debuginput&quality=high${shot.lobby ? '' : '&autostart=1'}&${shot.url}`;
  await page.navigate(url);
  await page.waitFor('window.__trailer && window.__lb', 120000, 'trailer hooks');
  if (!shot.lobby) await page.waitFor('window.__lb.game', 120000, 'game');
  await page.eval(`__vclock.seed(${shot.seed ?? 7})`);
  // Let on-demand assets (district meshes, skyline, store preview) arrive in real time.
  await Bun.sleep(shot.load ?? 2500);
  await runSteps(page, shot.setup);
  await page.eval('__trailer.mark()');
  const dir = join(CAPTURES, shot.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cues = new Map<number, Step[]>();
  for (const c of shot.cues ?? []) cues.set(c.at, [...(cues.get(c.at) ?? []), c]);
  const every = preview ? 15 : 1;
  let written = 0;
  for (let f = 0; f < shot.frames; f++) {
    if (cues.has(f)) await runSteps(page, cues.get(f));
    const render = f % every === 0;
    await page.eval(`__trailer.tick(1)`);
    if (!render) continue;
    const img = await page.screenshot('jpeg', 95);
    writeFileSync(join(dir, `${String(written++).padStart(5, '0')}.jpg`), img);
  }
  const sounds = await page.eval('__trailer.sounds');
  console.log('    end:', JSON.stringify(await page.eval(`(() => { const m = __trailer.me(), s = __trailer.state(); return s && { kills: m && m.kills, alive: m && m.alive, round: s.round, roundPhase: s.roundPhase, scores: s.scores, bomb: s.bomb.armed, sounds: __trailer.sounds.length }; })()`)));
  if (preview) {
    const cols = 6, rows = Math.ceil(written / cols);
    await run(FFMPEG, ['-v', 'error', '-y', '-framerate', '1', '-i', join(dir, '%05d.jpg'), '-vf', `scale=480:-1,drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial Bold.ttf:text='%{expr\\:n*${every}}':x=8:y=8:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.5,tile=${cols}x${rows}`, '-frames:v', '1', join(CAPTURES, 'preview', `${shot.id}.jpg`)]);
    rmSync(dir, { recursive: true, force: true });
    return;
  }
  writeFileSync(join(CAPTURES, `${shot.id}.sounds.json`), JSON.stringify({ frames: shot.frames, sounds }));
  await run(FFMPEG, ['-v', 'error', '-y', '-framerate', '30', '-i', join(dir, '%05d.jpg'),
    '-vf', shot.native ? 'null' : 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', join(CAPTURES, `${shot.id}.mp4`)]);
  if (!keep) rmSync(dir, { recursive: true, force: true });
}
