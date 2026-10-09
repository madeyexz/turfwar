/**
 * Admin dashboard check against a LOCAL server whose module was published with a TEST admin key
 * hash (never the real key): pass the test key in ADMIN_TEST_KEY.
 * - a player is in a room, so there is something to see;
 * - a wrong key is refused (admin_status counts the failure) and, after five, rate-limited;
 * - the right key makes a second identity an admin, which then sees every admin view;
 * - a third, non-admin identity subscribed to the same views sees nothing;
 * - logout empties the admin's views; revoke_all is refused to non-admins and signs every admin out.
 *
 *   ADMIN_TEST_KEY=local-test-admin-key bun scripts/admincheck.ts ws://127.0.0.1:3254 lbtrack
 */
import { checker, connect, localOnly, wait, type Conn } from './stdb-local';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3254';
const db = process.argv[3] ?? 'lbtrack';
localOnly(uri);
const key = process.env.ADMIN_TEST_KEY;
if (!key) throw new Error('Set ADMIN_TEST_KEY to the test key whose hash the local module was published with');
const { check, note, finish } = checker();
const VIEWS = ['SELECT * FROM admin_status', 'SELECT * FROM admin_overview', 'SELECT * FROM admin_rooms', 'SELECT * FROM admin_players', 'SELECT * FROM admin_daily', 'SELECT * FROM admin_player_time', 'SELECT * FROM admin_daily_time', 'SELECT * FROM admin_player_day'];
const counts = (c: Conn) => ({
  overview: c.db.adminOverview.count(), rooms: c.db.adminRooms.count(), players: c.db.adminPlayers.count(), daily: c.db.adminDaily.count(),
  playerTime: c.db.adminPlayerTime.count(), dailyTime: c.db.adminDailyTime.count(), playerDay: c.db.adminPlayerDay.count(),
});
const status = (c: Conn) => [...c.db.adminStatus.iter()][0];
const error = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return String((e as Error).message ?? e); } };

// Someone playing.
const player = await connect(uri, db, ['SELECT * FROM player']);
await player.conn.reducers.hello({ tz: 'Asia/Taipei', lang: 'zh-TW' });
await player.conn.reducers.quickPlay({ name: 'Player1', team: -1, size: 6, mode: '', mapId: '' });

// Wrong keys: recorded, then rate-limited.
const guesser = await connect(uri, db, VIEWS);
for (let i = 1; i <= 5; i++) {
  const got = await error(guesser.conn.reducers.adminLogin({ key: `wrong-${i}` }));
  await wait(100);
  check(`wrong key ${i} is refused and counted`, got === '' && status(guesser.conn)?.admin === false && status(guesser.conn)?.failures === i, { got, status: status(guesser.conn) });
}
const sixth = await error(guesser.conn.reducers.adminLogin({ key: `wrong-6` }));
check('a sixth attempt within 10 minutes is refused with an error', /Too many attempts/.test(sixth), sixth);
const rightButLocked = await error(guesser.conn.reducers.adminLogin({ key }));
await wait(100);
check('even the right key is refused while locked out', /Too many attempts/.test(rightButLocked) && status(guesser.conn)?.admin === false, rightButLocked);
check('the guesser sees no admin data', Object.values(counts(guesser.conn)).every(n => n === 0n), counts(guesser.conn));

// The owner logs in.
const admin = await connect(uri, db, VIEWS);
check('before login: not an admin, no data', status(admin.conn)?.admin === false && Object.values(counts(admin.conn)).every(n => n === 0n), counts(admin.conn));
check('admin_login with the right key succeeds', (await error(admin.conn.reducers.adminLogin({ key }))) === '');
await wait(300);
check('the admin is an admin', status(admin.conn)?.admin === true, status(admin.conn));
const c = counts(admin.conn);
check('the admin sees the overview, rooms, players, daily rows, play time and active days', c.overview === 1n && c.rooms >= 1n && c.players >= 1n && c.daily === 30n && c.playerTime === c.players && c.dailyTime === 30n && c.playerDay >= 1n, c);
const overview = [...admin.conn.db.adminOverview.iter()][0];
check('online now counts the player in a room', (overview?.onlineNow ?? 0) >= 1, overview);
const p1 = [...admin.conn.db.adminPlayers.iter()].find(p => p.tz === 'Asia/Taipei' && p.lang === 'zh-TW');
check('players are listed by a short anonymous id, not the identity', !!p1 && /^[0-9a-f]{10}$/.test(p1.id) && !player.conn.identity!.toHexString().includes(p1.id), p1);
note('admin_overview', overview);
note('admin_rooms', [...admin.conn.db.adminRooms.iter()]);
note('admin_daily (last 2)', [...admin.conn.db.adminDaily.iter()].sort((a, b) => a.day - b.day).slice(-2));
note('admin_players (first 3)', [...admin.conn.db.adminPlayers.iter()].slice(0, 3).map(p => ({ ...p, firstSeen: p.firstSeen.toDate().toISOString(), lastSeen: p.lastSeen.toDate().toISOString() })));

// A non-admin on the same views.
const stranger = await connect(uri, db, VIEWS);
check('a non-admin sees nothing', status(stranger.conn)?.admin === false && Object.values(counts(stranger.conn)).every(n => n === 0n), counts(stranger.conn));
check('a non-admin cannot revoke', /Admins only/.test(await error(stranger.conn.reducers.adminRevokeAll({}))));

// Live updates reach the admin: a second player joins.
const before = [...admin.conn.db.adminOverview.iter()][0]?.onlineNow ?? 0;
const player2 = await connect(uri, db, ['SELECT * FROM player']);
await player2.conn.reducers.quickPlay({ name: 'Player2', team: -1, size: 6, mode: '', mapId: '' });
await wait(300);
check('the overview updates live', ([...admin.conn.db.adminOverview.iter()][0]?.onlineNow ?? 0) === before + 1);

// Logout, then revoke_all.
await admin.conn.reducers.adminLogout({});
await wait(300);
check('logout empties the views', status(admin.conn)?.admin === false && Object.values(counts(admin.conn)).every(n => n === 0n), counts(admin.conn));
await admin.conn.reducers.adminLogin({ key });
const second = await connect(uri, db, VIEWS);
await second.conn.reducers.adminLogin({ key });
await wait(300);
check('two admins', status(admin.conn)?.admin === true && status(second.conn)?.admin === true);
check('revoke_all by an admin succeeds', (await error(second.conn.reducers.adminRevokeAll({}))) === '');
await wait(300);
check('revoke_all signs every admin out', status(admin.conn)?.admin === false && status(second.conn)?.admin === false && counts(admin.conn).players === 0n);

for (const x of [player, player2, guesser, admin, stranger, second]) x.conn.disconnect();
await wait(200);
finish();
