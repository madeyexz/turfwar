/**
 * Fills a local, disposable SpacetimeDB with a handful of public rooms for the lobby shots: headless
 * clients from scripts/loadtest.ts play online with filters (a 6v6 Sabotage on Taipei 101 · 88F, a
 * 6v6 Elimination on Memorial Hall, a 24v24 on Xinyi, a 1v1 on Crane). Local only; it stops with the
 * process group (make.ts starts it detached).
 *   bun trailer/scripts/rooms.ts ws://127.0.0.1:3251 lbtrailer [seconds]
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { REPO } from './util';

const [uri = 'ws://127.0.0.1:3251', db = 'lbtrailer', seconds = '7200'] = process.argv.slice(2);
if (!/^ws:\/\/(127\.0\.0\.1|localhost)/.test(uri)) throw new Error('rooms.ts only fills a local server');
const ROOMS: [size: number, clients: number, mode?: string, map?: string][] = [
  [6, 5, 'sabotage', 'taipei101'], [6, 3, 'elimination', 'memorial'], [24, 8, 'elimination', 'xinyi'], [1, 1, 'elimination', 'crane'],
];
const kids = ROOMS.map(([size, clients, mode, map]) => spawn('bun', [join(REPO, 'scripts/loadtest.ts'), '--uri', uri, '--db', db, '--clients', String(clients), '--procs', '1',
  '--seconds', seconds, '--size', String(size), ...(mode ? ['--mode', mode] : []), ...(map ? ['--map', map] : [])], { cwd: REPO, stdio: 'ignore' }));
const stop = () => { for (const k of kids) k.kill('SIGTERM'); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
await Promise.all(kids.map(k => new Promise(r => k.on('close', r))));
