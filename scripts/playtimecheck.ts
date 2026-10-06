/**
 * Online play time check against a LOCAL server whose module was published with a TEST admin key
 * hash (never the real key), each player its own identity. Takes about two minutes:
 * - A joins (Play Online), plays, leaves, idles in the lobby, rejoins (Start a server) and disconnects:
 *   `player_time` holds the time in rooms, not the lobby gap;
 * - B opens a private room and stays past a minute boundary: the room's tick credits B while B is
 *   still in it (the once-a-minute flush), then B leaves;
 * - an admin sees both in `admin_player_time` (joined to `admin_players` by id) and today's
 *   `admin_daily_time`; a non-admin sees nothing.
 * Both players report their own position once a second so the idle kick (45 s) leaves them alone.
 *
 *   ADMIN_TEST_KEY=<test key> bun scripts/playtimecheck.ts ws://127.0.0.1:3254 lbtrack
 *   bun scripts/playtimecheck.ts ws://127.0.0.1:3254 lbtrack --linger 150   # one player in a room for 150 s
 */
import { mapsFor } from '../shared/match/rooms';
import { shortId } from '../spacetimedb/src/admin';
import { sql } from './stdb-sql';
import { checker, connect, localOnly, wait, type Conn } from './stdb-local';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3254';
const db = process.argv[3] ?? 'lbtrack';
const server = localOnly(uri);
const { check, note, finish } = checker();
const SUBS = ['SELECT * FROM player', 'SELECT * FROM soldier'];
const VIEWS = ['SELECT * FROM admin_status', 'SELECT * FROM admin_overview', 'SELECT * FROM admin_rooms', 'SELECT * FROM admin_players', 'SELECT * FROM admin_daily', 'SELECT * FROM admin_player_time', 'SELECT * FROM admin_daily_time'];

type TimeRow = { identity: string; play_seconds: bigint | number; since: bigint | number };
const times = () => sql(server, db, 'SELECT * FROM player_time') as TimeRow[];
const timeOf = (c: Conn) => times().find(r => r.identity === c.identity!.toHexString());
const secondsOf = (c: Conn) => Number(timeOf(c)?.play_seconds ?? 0);

/** Report the soldier's own position once a second (keeps it from being dropped as idle). */
function keepAlive(c: Conn) {
  const timer = setInterval(() => {
    const me = c.db.player.identity.find(c.identity!);
    const s = me && c.db.soldier.id.find(me.soldierId);
    if (s?.alive) void c.reducers.report({ x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, yaw: s.yaw, pitch: 0, crouch: 0, grounded: true, sprint: false, ads: false, slide: false, weapon: 0, use: false }).catch(() => undefined);
  }, 1000);
  return () => clearInterval(timer);
}

const lingerAt = process.argv.indexOf('--linger');
if (lingerAt > 0) {
  const seconds = Number(process.argv[lingerAt + 1] ?? 120);
  const l = await connect(uri, db, SUBS);
  await l.conn.reducers.hello({ tz: 'Asia/Taipei', lang: 'zh-TW' });
  await l.conn.reducers.quickPlay({ name: 'Linger', team: -1, size: 6, mode: '', mapId: '' });
  const stop = keepAlive(l.conn);
  console.log(JSON.stringify({ linger: l.conn.identity!.toHexString(), joined: new Date().toISOString(), seconds }));
  await wait(seconds * 1000);
  stop();
  l.conn.disconnect();
  await wait(500);
  console.log(JSON.stringify({ linger: l.conn.identity!.toHexString(), left: new Date().toISOString(), playSeconds: secondsOf(l.conn) }));
  process.exit(0);
}

const key = process.env.ADMIN_TEST_KEY;
if (!key) throw new Error('Set ADMIN_TEST_KEY to the test key whose hash the local module was published with');
const clock = () => Date.now() / 1000;
const MAP = mapsFor(6, 'elimination')[0];
const near = (got: number, want: number, slack = 3) => Math.abs(got - want) <= slack;

// B opens a private room and stays past a minute boundary.
const b = await connect(uri, db, SUBS);
await b.conn.reducers.hello({ tz: 'America/Los_Angeles', lang: 'en-US' });
const bJoined = clock();
await b.conn.reducers.createRoom({ name: 'TimeB', size: 6, mode: 'elimination', mapId: MAP, bots: false, team: -1 });
const stopB = keepAlive(b.conn);
check('joining opens a stretch for B', Number(timeOf(b.conn)?.since ?? 0) > 0 && secondsOf(b.conn) === 0, timeOf(b.conn));

// A: join, play, leave, lobby, rejoin by another path, disconnect.
const a = await connect(uri, db, SUBS);
await a.conn.reducers.hello({ tz: 'Asia/Taipei', lang: 'zh-TW' });
let aStart = clock();
await a.conn.reducers.quickPlay({ name: 'TimeA', team: -1, size: 6, mode: '', mapId: '' });
const stopA = keepAlive(a.conn);
await wait(20_000);
await a.conn.reducers.leave({});
let aPlayed = clock() - aStart;
check('leaving credits A with the time in the room and closes the stretch', near(secondsOf(a.conn), aPlayed) && Number(timeOf(a.conn)?.since) === 0, { credited: secondsOf(a.conn), wall: aPlayed });
await wait(8_000); // lobby: not counted
check('lobby time is not counted', near(secondsOf(a.conn), aPlayed), { credited: secondsOf(a.conn), wall: aPlayed });
aStart = clock();
await a.conn.reducers.startRoom({ name: 'TimeA', size: 6, mode: 'elimination', mapId: MAP, bots: true, isPublic: true, team: -1 });
await wait(15_000);
stopA();
a.conn.disconnect();
await wait(800);
aPlayed += clock() - aStart;
check('disconnecting credits the second stretch (A = both stretches, not the lobby gap)', near(secondsOf(a.conn), aPlayed, 4) && Number(timeOf(a.conn)?.since) === 0, { credited: secondsOf(a.conn), wall: aPlayed });

// B is still in the room: wait for the next minute boundary plus a tick, then B must have been credited.
const toBoundary = 60_000 - (Date.now() % 60_000) + 1500;
await wait(toBoundary);
const midway = timeOf(b.conn);
const bSoFar = clock() - bJoined;
check('the minute flush credits B while B is still in the room', Number(midway?.since ?? 0) > 0 && near(Number(midway?.play_seconds ?? 0), bSoFar - 1.5, 3), { row: midway, wall: bSoFar });

// The admin (and a stranger) look.
const admin = await connect(uri, db, VIEWS);
await admin.conn.reducers.adminLogin({ key });
await wait(400);
const row = (c: Conn) => [...admin.conn.db.adminPlayerTime.iter()].find(p => p.id === shortId(c.identity!.toHexString()));
const ra = row(a.conn), rb = row(b.conn);
check('the admin sees A\'s play time and that A is not in a room', !!ra && Number(ra.playSeconds) === secondsOf(a.conn) && ra.playingSince.microsSinceUnixEpoch === 0n, ra);
check('the admin sees B\'s credited time and the open stretch', !!rb && Number(rb.playSeconds) === secondsOf(b.conn) && rb.playingSince.microsSinceUnixEpoch > 0n, rb);
const timeIds = new Set([...admin.conn.db.adminPlayerTime.iter()].map(t => t.id));
check('admin_player_time lists every player in admin_players, by the same id', admin.conn.db.adminPlayerTime.count() === admin.conn.db.adminPlayers.count()
  && [...admin.conn.db.adminPlayers.iter()].every(p => timeIds.has(p.id)));
const total = times().reduce((n, r) => n + Number(r.play_seconds), 0);
const listed = [...admin.conn.db.adminPlayerTime.iter()].reduce((n, r) => n + Number(r.playSeconds), 0);
check('admin_player_time adds up to every player\'s play time', listed === total, { listed, total });
const today = Math.floor(Date.now() / 86_400_000);
const day = [...admin.conn.db.adminDailyTime.iter()].find(d => d.day === today);
check('admin_daily_time has today\'s play time (at least A + B)', admin.conn.db.adminDailyTime.count() === 30n && Number(day?.playSeconds ?? 0) >= secondsOf(a.conn) + secondsOf(b.conn) - 2, day);
const stranger = await connect(uri, db, VIEWS);
check('a non-admin sees no players, play time or days', stranger.conn.db.adminPlayers.count() === 0n && stranger.conn.db.adminPlayerTime.count() === 0n && stranger.conn.db.adminDailyTime.count() === 0n && stranger.conn.db.adminOverview.count() === 0n);

// B leaves; live updates reach the admin.
await wait(5_000);
stopB();
await b.conn.reducers.leave({});
const bPlayed = clock() - bJoined;
await wait(500);
check('leaving credits B with the whole stay', near(secondsOf(b.conn), bPlayed) && Number(timeOf(b.conn)?.since) === 0, { credited: secondsOf(b.conn), wall: bPlayed });
const rb2 = row(b.conn);
check('the admin page updates live when B leaves', !!rb2 && Number(rb2.playSeconds) === secondsOf(b.conn) && rb2.playingSince.microsSinceUnixEpoch === 0n, rb2);

note('A', { wall: Math.round(aPlayed), credited: secondsOf(a.conn) });
note('B', { wall: Math.round(bPlayed), credited: secondsOf(b.conn) });
note('admin_player_time rows', [ra, row(b.conn)].map(r => r && { id: r.id, playSeconds: r.playSeconds, rounds: r.rounds, playingSince: r.playingSince.toDate().toISOString() }));
for (const x of [b, admin, stranger]) x.conn.disconnect();
await wait(200);
finish();
