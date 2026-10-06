/**
 * Renders every card the cuts use (trailer/web/card.ts) into PNG frames, with alpha for the
 * captions and tags: build/cards/<id>@<frames>/00000.png …
 *   bun trailer/scripts/cards.ts [--force] [--lang zh-TW]
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARDS, CUTS, cardLines } from '../edit';
import { Browser } from './cdp';
import { missingGlyphs } from './glyphs';
import { LANG, ROOT } from './util';

const BASE = process.env.TRAILER_URL ?? 'http://127.0.0.1:5201';
const force = process.argv.includes('--force');

/** Card renders the cuts need: [card id, frames]. */
export function cardUses() {
  const uses = new Set<string>();
  for (const cut of CUTS) {
    for (const seg of cut.segments) if (seg.clip.startsWith('card:')) uses.add(`${seg.clip.slice(5)}@${seg.frames}`);
    for (const o of cut.overlays) uses.add(`${o.card}@${o.frames ?? CARDS.find(c => c[0] === o.card)![3]}`);
  }
  return [...uses].map(u => { const [id, n] = u.split('@'); return [id, Number(n)] as const; });
}
export const cardDir = (id: string, frames: number) => join(ROOT, 'build', 'cards', LANG === 'en' ? '' : LANG, `${id}@${frames}`);

if (import.meta.main) {
  if (LANG !== 'en') {
    const missing = missingGlyphs();
    if (missing.length) throw new Error(`zh-TW card copy uses characters the game font lacks: ${missing.join(' ')}`);
  }
  const browser = new Browser();
  await browser.launch();
  try {
    const page = await browser.page(1920, 1080, 1);
    await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await page.navigate(`${BASE}/trailer/web/card.html?lang=${LANG}`);
    await page.waitFor('window.__card', 30000, 'card page');
    for (const [id, frames] of cardUses()) {
      const dir = cardDir(id, frames);
      if (!force && existsSync(join(dir, `${String(frames - 1).padStart(5, '0')}.png`))) continue;
      const def = CARDS.find(c => c[0] === id);
      if (!def) throw new Error(`no card ${id}`);
      rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
      await page.eval(`__card.show(${JSON.stringify(def[1])}, ${JSON.stringify(cardLines(id, LANG))}, ${frames})`);
      for (let f = 0; f < frames; f++) {
        await page.eval(`__card.at(${f})`);
        writeFileSync(join(dir, `${String(f).padStart(5, '0')}.png`), await page.screenshot('png'));
      }
      console.log(`  card ${id} (${frames} frames)`);
    }
  } finally { browser.close(); }
}
