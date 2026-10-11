/**
 * Peak-online check against a LOCAL server whose module was published with a TEST admin key hash
 * (never the real key), each player its own identity. Takes a few seconds:
 * - Players enter rooms one by one (a phone, a computer, one without a device report): this hour's
 *   `peak_hour` row rises with each entry, all and per side.
 * - Someone leaving lowers nothing; an entry that only gets back to the peak does not move `at`.
 * - An admin sees `admin_peak_hour`; a non-admin sees nothing.
 *
 *   ADMIN_TEST_KEY=<test key> bun scripts/peakcheck.ts ws://127.0.0.1:3301 twpeak
 */
import { sql } from './stdb-sql';
import { checker, connect, localOnly, wait, type Conn } from './stdb-local';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3301';
const db = process.argv[3] ?? 'twpeak';
const server = localOnly(uri);
const key = process.env.ADMIN_TEST_KEY;
if (!key) throw new Error('Set ADMIN_TEST_KEY to the test key whose hash the local module was published with');
const { check, note, finish } = checker();

type PeakRow = { hour: number; peak: number; phone: number; computer: number; at: bigint };
const hour = () => Math.floor(Date.now() / 3_600_000);
const peakNow = () => (sql(server, db, 'SELECT * FROM peak_hour') as unknown as PeakRow[]).find(r => Number(r.hour) === hour());

/** A player who said hello, reported `kind` (none: no report) and entered a public 6v6 room. */
async function player(name: string, kind?: string) {
  const { conn } = await connect(uri, db, []);
  await conn.reducers.hello({ tz: 'Asia/Taipei', lang: 'zh-TW' });
  if (kind) await conn.reducers.device({ kind });
  await conn.reducers.quickPlay({ name, team: -1, size: 6, mode: '', mapId: '' });
  return conn;
}

const before = peakNow();
check('no peak recorded this hour before anyone plays', !before, before);
const phone = await player('PeakPhone', 'phone');
check('the first entry starts the hour at 1 (a phone)', peakNow()?.peak === 1 && peakNow()?.phone === 1 && peakNow()?.computer === 0, peakNow());
const desktop = await player('PeakDesk', 'desktop');
const plain = await player('PeakPlain');
const three = peakNow();
check('each entry raises it: 3 in rooms, 1 phone, 1 computer (no report counts only in all)', three?.peak === 3 && three?.phone === 1 && three?.computer === 1, three);

await desktop.reducers.leave({});
await wait(200);
check('leaving lowers nothing', peakNow()?.peak === 3 && peakNow()?.computer === 1, peakNow());
const again = await player('PeakAgain', 'tablet');
check('getting back to the peak keeps it and its time; a tablet raises Phone', peakNow()?.peak === 3 && peakNow()?.at === three?.at && peakNow()?.phone === 2, { now: peakNow(), three });

const admin = await connect(uri, db, ['SELECT * FROM admin_status', 'SELECT * FROM admin_peak_hour']);
await admin.conn.reducers.adminLogin({ key });
await wait(500);
const seen = [...admin.conn.db.adminPeakHour.iter()].find(r => r.hour === hour());
check('the admin sees this hour\'s peak', seen?.peak === 3 && seen?.phone === 2 && seen?.computer === 1, seen);
const viewer = await connect(uri, db, ['SELECT * FROM admin_peak_hour']);
check('a non-admin sees no peaks', viewer.conn.db.adminPeakHour.count() === 0n);

note('row', peakNow());
for (const c of [phone, desktop, plain, again, admin.conn, viewer.conn] as Conn[]) c.disconnect();
await wait(200);
finish();
