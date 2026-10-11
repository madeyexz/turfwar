/**
 * Renders the 1200×630 social previews (public/og/og-zh-TW.jpg and og-en.jpg) from tools/og/og.html with
 * the agent-browser CLI, then converts them with ImageMagick. Run: `bun tools/og/make.ts`.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(root, 'public/og');
mkdirSync(out, { recursive: true });
const run = (cmd: string[]) => { const p = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' }); if (p.exitCode) throw new Error(`${cmd.join(' ')}\n${p.stderr.toString()}`); };

for (const [lang, file] of [['zh-TW', 'og-zh-TW'], ['en', 'og-en']] as const) {
  const png = `/tmp/${file}.png`;
  run(['agent-browser', 'open', `file://${root}/tools/og/og.html${lang === 'en' ? '?lang=en' : ''}`]);
  run(['agent-browser', 'set', 'viewport', '1200', '630', '1']);
  run(['agent-browser', 'wait', '1500']);
  run(['agent-browser', 'screenshot', png]);
  run(['magick', png, '-strip', '-quality', '86', '-sampling-factor', '4:2:0', `${out}/${file}.jpg`]);
}
