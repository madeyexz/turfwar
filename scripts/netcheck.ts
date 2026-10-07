/**
 * Connection-quality check against a LOCAL server whose module was published with a TEST admin key
 * hash (never the real key), each player its own identity. Takes about a minute and a half:
 * - A (Play Online) and B (a private room) play for ~35 s, timing their movement reports the way the
 *   game does (shared/netstats.ts: a sample at most every 500 ms) and counting the server's
 *   corrections of their soldier from `roster`; B teleports every few seconds, which the server
 *   refuses. Leaving, each sends its `net_stats` report: `player_net` rows appear with those numbers.
 * - The rules: a second report within 30 s is ignored; a report without samples is ignored; an
 *   identity that never said hello is ignored; absurd values are clamped; a later report may not
 *   claim more seconds than the wall clock since the previous one plus a minute.
 * - An admin sees `admin_player_net` (joined to `admin_players` by id) and today's `admin_daily_net`;
 *   a non-admin sees nothing.
 *
 *   ADMIN_TEST_KEY=<test key> bun scripts/netcheck.ts ws://127.0.0.1:3271 twnet
 */
import { mapsFor } from '../shared/match/rooms';
import { NetReporter, PING_MAX_MS, SAMPLE_EVERY_MS, SECONDS_MAX, SECONDS_SLACK } from '../shared/netstats';
import { shortId } from '../spacetimedb/src/admin';
import { sql } from './stdb-sql';
import { checker, connect, localOnly, wait, type Conn } from './stdb-local';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3271';
const db = process.argv[3] ?? 'twnet';
const server = localOnly(uri);
const key = process.env.ADMIN_TEST_KEY;
if (!key) throw new Error('Set ADMIN_TEST_KEY to the test key whose hash the local module was published with');
const { check, note, finish } = checker();
const SUBS = ['SELECT * FROM player', 'SELECT * FROM soldier', 'SELECT * FROM roster'];
const VIEWS = ['SELECT * FROM admin_status', 'SELECT * FROM admin_players', 'SELECT * FROM admin_player_net', 'SELECT * FROM admin_daily_net'];

type NetRow = { identity: string; reports: number; last_p_50: number; last_p_95: number; avg_p_50: number; avg_p_95: number; worst_p_95: number; corrections: number; measured_seconds: number; last_at: bigint };
const netRows = () => sql(server, db, 'SELECT * FROM player_net') as unknown as NetRow[];
const netOf = (c: Conn) => netRows().find(r => r.identity === c.identity!.toHexString());

/** A player in a room: reports its position ten times a second (B also teleports), measures round trips and counts corrections. */
function play(c: Conn, teleport: boolean) {
  const net = new NetReporter(performance.now());
  let me = -1, lastPing = 0, ticks = 0;
  c.db.roster.onUpdate((_ctx, old, row) => { if (row.id === me && row.corrections > old.corrections) net.meter.correct(row.corrections - old.corrections); });
  const timer = setInterval(() => {
    const p = c.db.player.identity.find(c.identity!);
    me = p?.soldierId ?? -1;
    const s = p && c.db.soldier.id.find(p.soldierId);
    if (!s?.alive) return;
    // Every 5 s B claims to be 40 m away: the server refuses it (a correction).
    const jump = teleport && ++ticks % 50 === 0 ? 40 : 0;
    const sent = performance.now();
    void c.reducers.report({ x: s.x + jump, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, yaw: s.yaw, pitch: 0, crouch: 0, grounded: true, sprint: false, ads: false, slide: false, weapon: 0, use: false })
      .then(() => { if (sent - lastPing > SAMPLE_EVERY_MS) { net.meter.sample(performance.now() - sent); lastPing = sent; } }, () => undefined);
  }, 100);
  return { net, stop: () => clearInterval(timer), soldier: () => me };
}

const MAP = mapsFor(6, 'elimination')[0];
const a = await connect(uri, db, SUBS);
await a.conn.reducers.hello({ tz: 'Asia/Taipei', lang: 'zh-TW' });
await a.conn.reducers.quickPlay({ name: 'NetA', team: -1, size: 6, mode: '', mapId: '' });
const b = await connect(uri, db, SUBS);
await b.conn.reducers.hello({ tz: 'America/Los_Angeles', lang: 'en-US' });
await b.conn.reducers.createRoom({ name: 'NetB', size: 6, mode: 'elimination', mapId: MAP, bots: false, team: -1 });
const pa = play(a.conn, false), pb = play(b.conn, true);

// Meanwhile: C has said hello (so it may report) and tests the clamps; D never said hello.
const c = await connect(uri, db, []);
await c.conn.reducers.hello({ tz: 'Europe/Berlin', lang: 'de-DE' });
await c.conn.reducers.netStats({ p50Ms: 99_999, p95Ms: 3, samples: 4_000_000_000, corrections: 4_000_000_000, seconds: 4_000_000_000 });
const cFirst = netOf(c.conn);
check('absurd values are clamped (ms 5000, p95 ≥ p50, seconds 86400, corrections ≤ 30 a second)', !!cFirst && cFirst.last_p_50 === PING_MAX_MS && cFirst.last_p_95 === PING_MAX_MS
  && cFirst.measured_seconds === SECONDS_MAX && cFirst.corrections === SECONDS_MAX * 30 && cFirst.reports === 1, cFirst);
const cAt = Date.now();
const d = await connect(uri, db, []);
await d.conn.reducers.netStats({ p50Ms: 50, p95Ms: 90, samples: 100, corrections: 0, seconds: 60 });
check('an identity that never said hello (no player_seen row) is ignored', !netOf(d.conn));
const e = await connect(uri, db, []);
await e.conn.reducers.hello({ tz: 'Asia/Tokyo', lang: 'ja' });
await e.conn.reducers.netStats({ p50Ms: 50, p95Ms: 90, samples: 0, corrections: 0, seconds: 60 });
await e.conn.reducers.netStats({ p50Ms: 50, p95Ms: 90, samples: 10, corrections: 0, seconds: 0 });
check('a report without samples or seconds is ignored', !netOf(e.conn));

await wait(35_000);
pa.stop(); pb.stop();
await wait(300);
const bCorrections = b.conn.db.roster.id.find(pb.soldier())?.corrections ?? 0;
const leftA = pa.net.leave(performance.now()), leftB = pb.net.leave(performance.now());
check('A and B leave with a report each (the leave trigger)', !!leftA.report && !!leftB.report, { a: leftA, b: leftB });
await a.conn.reducers.netStats(leftA.report!);
await b.conn.reducers.netStats(leftB.report!);
await a.conn.reducers.leave({});
await b.conn.reducers.leave({});
const ra = netOf(a.conn), rb = netOf(b.conn);
check('player_net has A\'s report with sane values', !!ra && ra.reports === 1 && ra.last_p_50 === leftA.report!.p50Ms && ra.last_p_95 === leftA.report!.p95Ms
  && ra.last_p_50 >= 0 && ra.last_p_50 < 1000 && ra.last_p_95 >= ra.last_p_50 && Math.abs(ra.measured_seconds - 35) <= 3 && ra.corrections === 0, { row: ra, sent: leftA.report });
check('B\'s corrections are the ones the server counted (roster), and at least one teleport was refused', !!rb && bCorrections >= 3 && rb.corrections === bCorrections
  && leftB.report!.corrections === bCorrections, { row: rb, roster: bCorrections, sent: leftB.report });
check('the typical ping of a first report is that report', !!ra && Math.round(ra.avg_p_50) === ra.last_p_50 && ra.worst_p_95 === ra.last_p_95);

// The rate limit: A again at once is ignored.
await a.conn.reducers.netStats({ p50Ms: 999, p95Ms: 999, samples: 50, corrections: 7, seconds: 25 });
const ra2 = netOf(a.conn);
check('a second report within 30 s is ignored', !!ra2 && ra2.reports === 1 && ra2.last_p_50 === ra!.last_p_50 && ra2.corrections === 0, ra2);

// C's second report, over 30 s after its first: allowed, but no more seconds than the wall clock since then (+60 s).
await wait(Math.max(0, 31_000 - (Date.now() - cAt)));
await c.conn.reducers.netStats({ p50Ms: 40, p95Ms: 80, samples: 60, corrections: 1, seconds: 3600 });
const cSecond = netOf(c.conn);
const cGap = Math.round((Date.now() - cAt) / 1000);
const added = cSecond ? cSecond.measured_seconds - SECONDS_MAX : -1;
check('after 30 s a report is accepted, its seconds capped at the wall clock since the previous one plus a minute', !!cSecond && cSecond.reports === 2
  && added >= 31 + SECONDS_SLACK - 1 && added <= cGap + SECONDS_SLACK + 1 && cSecond.last_p_50 === 40 && cSecond.worst_p_95 === PING_MAX_MS, { row: cSecond, added, gap: cGap });

// The admin (and a stranger) look.
const admin = await connect(uri, db, VIEWS);
await admin.conn.reducers.adminLogin({ key });
await wait(500);
const view = (x: Conn) => [...admin.conn.db.adminPlayerNet.iter()].find(r => r.id === shortId(x.identity!.toHexString()));
const va = view(a.conn), vb = view(b.conn);
check('the admin sees A\'s and B\'s connection quality by the admin_players id', !!va && !!vb && va.pingP50 === Math.round(ra!.avg_p_50) && vb.pingP50 === Math.round(rb!.avg_p_50)
  && [...admin.conn.db.adminPlayers.iter()].some(p => p.id === va.id) && Math.abs(vb.correctionsPerMin - rb!.corrections / (rb!.measured_seconds / 60)) < 0.01, { va, vb });
check('admin_player_net lists exactly the players who reported', admin.conn.db.adminPlayerNet.count() === BigInt(netRows().length) && !view(d.conn) && !view(e.conn));
const today = Math.floor(Date.now() / 86_400_000);
const day = [...admin.conn.db.adminDailyNet.iter()].find(x => x.day === today);
check('admin_daily_net has today (at least A, B and C)', admin.conn.db.adminDailyNet.count() === 30n && (day?.players ?? 0) >= 3 && (day?.medianP50 ?? 0) > 0, day);
const stranger = await connect(uri, db, VIEWS);
check('a non-admin sees no connection quality', stranger.conn.db.adminPlayerNet.count() === 0n && stranger.conn.db.adminDailyNet.count() === 0n && stranger.conn.db.adminPlayers.count() === 0n);

note('A', { sent: leftA.report, row: ra, view: va });
note('B', { sent: leftB.report, rosterCorrections: bCorrections, row: rb, view: vb });
note('C', { first: cFirst, second: cSecond });
note('today', day);
for (const x of [a, b, c, d, e, admin, stranger]) x.conn.disconnect();
await wait(200);
finish();
