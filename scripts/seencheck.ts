/**
 * Player tracking check against a LOCAL server, each player its own identity:
 * - two clients say `hello` (time zone, language) and join a room: `player_seen` gets two rows;
 * - long or odd `hello` input is cleaned and capped (tz 64, lang 16);
 * - reconnecting with the same token counts a second session;
 * - a lobby-style connection that never says hello or joins is not counted.
 * Reads `player_seen` (private) with `spacetime sql` as the local owner.
 *
 *   bun scripts/seencheck.ts ws://127.0.0.1:3254 lbtrack
 */
import { sql } from './stdb-sql';
import { checker, connect, localOnly, wait } from './stdb-local';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3254';
const db = process.argv[3] ?? 'lbtrack';
const server = localOnly(uri);
const { check, note, finish } = checker();
const seen = () => sql(server, db, 'SELECT * FROM player_seen') as { identity: string; sessions: number; tz: string; lang: string; first_seen: bigint; last_seen: bigint }[];
const before = seen().length;

const a = await connect(uri, db, ['SELECT * FROM player']);
await a.conn.reducers.hello({ tz: 'Asia/Taipei', lang: 'zh-TW' });
await a.conn.reducers.quickPlay({ name: 'SeenA', team: -1, size: 6, mode: '', mapId: '' });
const b = await connect(uri, db, ['SELECT * FROM player']);
await b.conn.reducers.hello({ tz: `America/Los_Angeles${'x'.repeat(100)}`, lang: 'en-US<script>' });
await b.conn.reducers.quickPlay({ name: 'SeenB', team: -1, size: 6, mode: '', mapId: '' });
// A lobby-style watcher: connects, never says hello, never joins.
const watcher = await connect(uri, db, ['SELECT * FROM match']);
await wait(300);

const hexA = a.conn.identity!.toHexString(), hexB = b.conn.identity!.toHexString(), hexW = watcher.conn.identity!.toHexString();
let rows = seen();
const rowA = rows.find(r => r.identity === hexA), rowB = rows.find(r => r.identity === hexB);
check('two players are recorded', rows.length === before + 2 && !!rowA && !!rowB, rows);
check('time zone and language are kept', rowA?.tz === 'Asia/Taipei' && rowA?.lang === 'zh-TW', rowA);
check('long and odd input is cleaned and capped (tz 64, lang 16)', rowB?.tz.length === 64 && rowB.tz.startsWith('America/Los_Angeles') && rowB?.lang === 'en-USscript', rowB);
check('first session counts one', rowA?.sessions === 1 && rowB?.sessions === 1, [rowA?.sessions, rowB?.sessions]);
check('a lobby watcher that never joins is not counted', !rows.some(r => r.identity === hexW));
note('player_seen rows', rows.filter(r => r.identity === hexA || r.identity === hexB));

// Reconnect A with its token: a second session, same row.
a.conn.disconnect();
await wait(300);
const again = await connect(uri, db, ['SELECT * FROM player'], a.token);
check('reconnect keeps the identity', again.conn.identity!.toHexString() === hexA);
await again.conn.reducers.hello({ tz: 'Asia/Taipei', lang: 'zh-TW' });
await wait(200);
rows = seen();
const rowA2 = rows.find(r => r.identity === hexA);
check('sessions increment on reconnect', rowA2?.sessions === 2, rowA2);
check('first seen stays, last seen moves', rowA2?.first_seen === rowA?.first_seen && (rowA2?.last_seen ?? 0n) > (rowA?.last_seen ?? 0n), [rowA, rowA2]);
const days = sql(server, db, 'SELECT * FROM player_day') as { identity: string; day: number }[];
check('daily activity is recorded once per player per day', days.filter(d => d.identity === hexA).length === 1 && days.filter(d => d.identity === hexB).length === 1, days);

for (const c of [again.conn, b.conn, watcher.conn]) c.disconnect();
await wait(200);
finish();
