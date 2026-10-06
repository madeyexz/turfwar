/**
 * Scouting tool: open the game with URL params, step N frames, run a snippet and screenshot.
 *   bun trailer/scripts/probe.ts "mode=offline&map=taipei" --frames 60 --js "__trailer.cam(...)" --out /tmp/p.jpg
 * Several --js/--frames/--out triples may follow one another; they run in order on the same page.
 */
import { writeFileSync } from 'node:fs';
import { Browser } from './cdp';
import { VCLOCK_SOURCE } from './vclock';

const BASE = process.env.TRAILER_URL ?? 'http://127.0.0.1:5201';
const [params, ...rest] = process.argv.slice(2);
const browser = new Browser();
await browser.launch();
try {
  const page = await browser.page(1920, 1080, Number(process.env.TRAILER_SCALE ?? 1));
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: VCLOCK_SOURCE });
  const t0 = Date.now();
  await page.navigate(`${BASE}/?capture&trailer&debuginput&autostart=1&quality=high&${params}`);
  await page.waitFor('window.__lb && window.__lb.game && window.__trailer', 120000, 'game');
  console.log(`ready in ${Date.now() - t0} ms`);
  let frames = 0;
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i], value = rest[i + 1];
    if (flag === '--frames') {
      const n = Number(value), t = Date.now();
      for (let k = 0; k < n; k++) await page.eval('__trailer.tick(1)');
      frames += n;
      console.log(`stepped ${n} frames in ${Date.now() - t} ms`);
    } else if (flag === '--sleep') await Bun.sleep(Number(value));
    else if (flag === '--js') console.log('js →', JSON.stringify(await page.eval(value)));
    else if (flag === '--out') {
      const t = Date.now();
      const img = await page.screenshot(value.endsWith('.png') ? 'png' : 'jpeg', 92);
      writeFileSync(value, img);
      console.log(`shot ${value} (${img.length >> 10} KB) in ${Date.now() - t} ms at frame ${frames}`);
    }
  }
} finally { browser.close(); }
