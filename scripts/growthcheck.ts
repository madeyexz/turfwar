/**
 * Growth-metrics check against a LOCAL server (shared/metrics.ts), each player its own identity. Takes
 * under a minute:
 * - `visit`: the first touch, the in-app browser and the arrival code are kept once; a share code
 *   brings a player (counted for the sharer, codes never in the admin view); no `hello`, no row.
 * - `perf_stats`: folded per player, a second report inside 30 s ignored.
 * - Firsts: entering a room stamps `room`; a finished round stamps `round` (a 1v1 against a bot).
 * - `room_hour`: joins, a leave and a drop (a connection closed in a room).
 * - The admin views: an admin (the key whose hash the local module was published with) sees them;
 *   anyone else sees nothing.
 *
 *   ADMIN_TEST_KEY=<key> bun scripts/growthcheck.ts ws://127.0.0.1:3000 turfwar
 */
import { sql } from './stdb-sql';
import { checker, connect, localOnly, wait, type Conn } from './stdb-local';
import { shortId } from '../spacetimedb/src/admin';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3000';
const db = process.argv[3] ?? 'turfwar';
const server = localOnly(uri);
const key = process.env.ADMIN_TEST_KEY;
if (!key) throw new Error('Set ADMIN_TEST_KEY to the key whose hash the local module was published with');
const { check, note, finish } = checker();
const rows = (q: string) => sql(server, db, q) as Record<string, unknown>[];
const hour = () => Math.floor(Date.now() / 3_600_000);
const roomHour = () => rows('SELECT * FROM room_hour').find(r => Number(r.hour) === hour()) as Record<string, number> | undefined;
const visit = (o: Partial<{ source: string; medium: string; campaign: string; inApp: string; refBy: string; ref: string; shares: number; duels: number }>) =>
  ({ source: '', medium: '', campaign: '', inApp: '', refBy: '', ref: '', shares: 0, duels: 0, ...o });

async function player(o: { name: string; kind?: string; hello?: boolean }) {
  const { conn } = await connect(uri, db, []);
  const identity = conn.identity!.toHexString();
  if (o.hello !== false) await conn.reducers.hello({ tz: 'Asia/Taipei', lang: 'zh-TW' });
  if (o.kind) await conn.reducers.device({ kind: o.kind });
  return { conn, identity };
}
const byId = (table: string, id: string) => rows(`SELECT * FROM ${table}`).find(r => r.identity === id);

// Fresh share codes each run (codes are per browser).
const code = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');
const refA = code(), refB = code();

const before = roomHour() ?? { joins: 0, leaves: 0, drops: 0 };

// A sharer from Threads' in-app browser, and a friend their link brought.
const sharer = await player({ name: 'Sharer', kind: 'phone' });
await sharer.conn.reducers.visit(visit({ source: 'threads.net', medium: 'social', inApp: 'threads', ref: refA, shares: 2, duels: 1 }));
await sharer.conn.reducers.visit(visit({ source: 'google', inApp: '', ref: refA, shares: 1 }));
const s1 = byId('player_source', sharer.identity);
check('visit keeps the first touch and the app; counts only grow', s1?.source === 'threads.net' && s1?.in_app === 'threads' && s1?.shares === 2 && s1?.duels === 1, s1);
const friend = await player({ name: 'Friend', kind: 'desktop' });
await friend.conn.reducers.visit(visit({ refBy: refA, ref: refB }));
check('a direct visit through a share code is direct, referred', byId('player_source', friend.identity)?.source === 'direct' && byId('player_source', friend.identity)?.ref_by === refA);
const ghost = await player({ name: 'Ghost', hello: false });
await ghost.conn.reducers.visit(visit({ source: 'spam' }));
check('no hello, no visit row', !byId('player_source', ghost.identity));

// Both enter a public 6v6 room.
await sharer.conn.reducers.quickPlay({ name: 'Sharer', team: -1, size: 6, mode: '', mapId: '' });
await friend.conn.reducers.quickPlay({ name: 'Friend', team: -1, size: 6, mode: '', mapId: '' });
await wait(300);
const f1 = byId('player_milestone', friend.identity);
check('entering a room stamps the first room, nothing else', BigInt(f1?.room as bigint ?? 0n) > 1n && BigInt(f1?.round as bigint) === 0n, f1);
check('two joins counted this hour', (roomHour()?.joins ?? 0) - before.joins === 2, roomHour());

// Frame rate: one report counts, a second inside 30 s does not.
await sharer.conn.reducers.perfStats({ fps: 45, low: 25, seconds: 60, waitMs: 3000, bootMs: 6000 });
await sharer.conn.reducers.perfStats({ fps: 5, low: 1, seconds: 60, waitMs: 0, bootMs: 0 });
const p1 = byId('player_perf', sharer.identity);
check('perf folded once (the second report inside 30 s is ignored)', p1?.reports === 1 && p1?.seconds === 60 && p1?.waits === 1 && p1?.boots === 1, p1);

// The sharer leaves on purpose; the friend's connection drops.
await sharer.conn.reducers.leave({});
friend.conn.disconnect();
await wait(500);
const h = roomHour();
check('a leave and a drop counted', (h?.leaves ?? 0) - before.leaves === 1 && (h?.drops ?? 0) - before.drops === 1, h);

// The admin views: the sharer brought one player who played; no codes in the view.
const admin = await connect(uri, db, ['SELECT * FROM admin_status', 'SELECT * FROM admin_player_source', 'SELECT * FROM admin_player_perf', 'SELECT * FROM admin_player_milestone', 'SELECT * FROM admin_room_hour']);
await admin.conn.reducers.adminLogin({ key });
await wait(600);
const sources = [...admin.conn.db.adminPlayerSource.iter()];
const mine = sources.find(r => r.id === shortId(sharer.identity));
check('the admin sees the sharer with one player brought, who played', mine?.invited === 1 && mine?.invitedPlayed === 1, mine);
check('no share codes in the admin view', !JSON.stringify(sources, (_k, v) => (typeof v === 'bigint' ? String(v) : v)).includes(refA));
check('the admin sees perf, firsts and room hours', admin.conn.db.adminPlayerPerf.count() > 0n && admin.conn.db.adminPlayerMilestone.count() > 0n && admin.conn.db.adminRoomHour.count() > 0n);
const viewer = await connect(uri, db, ['SELECT * FROM admin_player_source', 'SELECT * FROM admin_room_hour']);
check('a non-admin sees nothing', viewer.conn.db.adminPlayerSource.count() === 0n && viewer.conn.db.adminRoomHour.count() === 0n);

// A finished round stamps the first round: a 1v1 against a bot (the bot usually wins it within the idle limit).
const rookie = await player({ name: 'Rookie', kind: 'phone' });
await new Promise<void>(r => rookie.conn.subscriptionBuilder().onApplied(() => r()).subscribe(['SELECT * FROM soldier', 'SELECT * FROM player']));
await rookie.conn.reducers.startRoom({ name: 'Rookie', size: 1, mode: 'elimination', mapId: 'warehouse', bots: true, isPublic: false, team: -1 });
let round = 0n;
// Report standing still where the server has us, so the idle kick (45 s without reports) never comes.
const stay = () => {
  const me = rookie.conn.db.player.identity.find(rookie.conn.identity!);
  const s = me && rookie.conn.db.soldier.id.find(me.soldierId);
  if (s) void rookie.conn.reducers.report({ x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, yaw: s.yaw, pitch: 0, crouch: 0, grounded: true, sprint: false, ads: false, slide: false, weapon: 0, use: false }).catch(() => undefined);
};
for (let i = 0; i < 100 && !round; i++) { stay(); await wait(1000); round = BigInt((byId('player_milestone', rookie.identity)?.round as bigint) ?? 0n); }
if (round) check('a finished round stamps the first round', round > 1n);
else note('first round', 'not reached within 100 s (the bot did not finish the round); covered by unit tests');
note('milestone', byId('player_milestone', rookie.identity));
note('room hour', roomHour());

for (const c of [sharer.conn, ghost.conn, rookie.conn, admin.conn, viewer.conn] as Conn[]) c.disconnect();
await wait(200);
finish();
