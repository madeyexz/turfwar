/**
 * One command for the whole trailer: `bun trailer/scripts/make.ts`
 *
 *  1. starts what the captures need, all local and disposable: an in-memory SpacetimeDB on
 *     127.0.0.1:3251 with the module published as `lbtrailer` and headless clients (scripts/loadtest.ts)
 *     Quick-Playing into 1v1, 6v6 and 24v24 rooms for the lobby shot, and the Vite dev server on
 *     127.0.0.1:5201 pointed at it;
 *  2. captures every shot not captured yet (scripts/capture.ts; `--recapture` redoes them all);
 *  3. renders the cards, the score and the game sound (scripts/cards.ts, scripts/audio.ts);
 *  4. cuts trailer/out/lawbreaker-trailer.mp4 and lawbreaker-trailer-30s.mp4 (scripts/build.ts);
 *  5. stops everything it started.
 * Flags: --recapture, --only-build (skip 1–3, reuse captures, cards and audio), --lang zh-TW (the
 * Traditional Chinese trailer: the game in Chinese, Chinese cards, the same score; out/<cut>.zh-TW.mp4).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { LANG, REPO, ROOT } from './util';

const args = process.argv.slice(2);
const STDB_PORT = 3251, VITE_PORT = 5201, DB = 'lbtrailer';
const children: ChildProcess[] = [];

function start(cmd: string, argv: string[], env: Record<string, string> = {}) {
  const p = spawn(cmd, argv, { cwd: REPO, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit'], detached: true });
  children.push(p);
  return p;
}
function step(script: string, argv: string[] = []) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn('bun', [join(ROOT, 'scripts', script), ...argv, '--lang', LANG], { cwd: REPO, stdio: 'inherit' });
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)));
  });
}
async function waitFor(url: string, label: string) {
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await Bun.sleep(250);
  }
  throw new Error(`${label} did not start (${url})`);
}
// Each service runs in its own process group: stopping the group also stops the load test's workers.
const cleanup = () => { for (const c of children) { try { process.kill(-c.pid!, 'SIGTERM'); } catch { c.kill('SIGTERM'); } } };
process.on('SIGINT', () => { cleanup(); process.exit(130); });

try {
  if (!args.includes('--only-build')) {
    console.log('— local services');
    start('spacetime', ['start', '--listen-addr', `127.0.0.1:${STDB_PORT}`, '--in-memory', '--non-interactive']);
    await waitFor(`http://127.0.0.1:${STDB_PORT}/v1/ping`, 'SpacetimeDB');
    await new Promise<void>((resolve, reject) => {
      const p = spawn('spacetime', ['publish', DB, '--module-path', 'spacetimedb', '--server', `http://127.0.0.1:${STDB_PORT}`, '--yes'], { cwd: REPO, stdio: 'inherit' });
      p.on('close', code => code === 0 ? resolve() : reject(new Error('spacetime publish failed')));
    });
    start('bun', [join(ROOT, 'scripts', 'rooms.ts'), `ws://127.0.0.1:${STDB_PORT}`, DB, '7200']);
    start(join(REPO, 'node_modules/.bin/vite'), ['--port', String(VITE_PORT), '--strictPort', '--host', '127.0.0.1'],
      { VITE_SPACETIMEDB_URI: `ws://127.0.0.1:${STDB_PORT}`, VITE_SPACETIMEDB_DATABASE: DB });
    await waitFor(`http://127.0.0.1:${VITE_PORT}/`, 'Vite');
    await Bun.sleep(4000);

    console.log('— captures');
    await step('capture.ts', args.includes('--recapture') ? ['--force'] : []);
    console.log('— cards');
    await step('cards.ts');
    console.log('— audio');
    await step('audio.ts');
  }
  console.log('— cut');
  await step('build.ts');
} finally {
  cleanup();
}
