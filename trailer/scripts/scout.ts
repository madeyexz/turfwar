/**
 * Location scouting: stills from a list of camera positions on one map, tiled into one sheet.
 *   bun trailer/scripts/scout.ts "<url params>" '<json [[label,[px,py,pz],[tx,ty,tz],fov?],…]>' out.jpg [setup-js]
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Browser } from './cdp';
import { VCLOCK_SOURCE } from './vclock';
import { FFMPEG, run } from './util';

const BASE = process.env.TRAILER_URL ?? 'http://127.0.0.1:5201';
const [params, list, out, setup] = process.argv.slice(2);
const cams = JSON.parse(list) as [string, number[], number[], number?][];
const dir = '/tmp/lb-scout';
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const browser = new Browser();
await browser.launch();
try {
  const page = await browser.page(1920, 1080, 1);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: VCLOCK_SOURCE });
  await page.navigate(`${BASE}/?capture&trailer&debuginput&autostart=1&quality=high&${params}`);
  await page.waitFor('window.__trailer && window.__lb && window.__lb.game', 120000, 'game');
  await Bun.sleep(4000);
  await page.eval('__trailer.tick(3)');
  if (setup) console.log('setup →', JSON.stringify(await page.eval(setup)).slice(0, 500));
  await page.eval(`__trailer.hud('none')`);
  for (const [i, [label, p, t, fov]] of cams.entries()) {
    await page.eval(`__trailer.camera({kind:'fixed', p:${JSON.stringify(p)}, t:${JSON.stringify(t)}, fov:${fov ?? 60}}); __trailer.tick(2)`);
    writeFileSync(join(dir, `${String(i).padStart(3, '0')}.jpg`), await page.screenshot('jpeg', 85));
    writeFileSync(join(dir, `${String(i).padStart(3, '0')}.txt`), label);
  }
  const cols = cams.length > 4 ? 3 : 2, rows = Math.ceil(cams.length / cols);
  const font = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
  const inputs = cams.flatMap((_, i) => ['-i', join(dir, `${String(i).padStart(3, '0')}.jpg`)]);
  const labelled = cams.map(([label], i) => `[${i}:v]scale=640:360,drawtext=fontfile=${font}:text='${label.replace(/[':]/g, ' ')}':x=6:y=6:fontsize=20:fontcolor=yellow:box=1:boxcolor=black@0.6[v${i}]`).join(';');
  const layout = cams.map((_, i) => `${(i % cols) * 640}_${Math.floor(i / cols) * 360}`).join('|');
  await run(FFMPEG, ['-v', 'error', '-y', ...inputs, '-filter_complex', `${labelled};${cams.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${cams.length}:layout=${layout}:fill=black`, '-frames:v', '1', out]);
  console.log(out, `${cols}x${rows}`);
} finally { browser.close(); }
