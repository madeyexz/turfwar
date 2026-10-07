/**
 * Device-type check against a LOCAL server whose module was published with a TEST admin key hash
 * (never the real key), each player its own identity. Takes a few seconds:
 * - Players say hello, then `device` ('phone', 'tablet', 'desktop'): `player_device` rows appear.
 * - The rules: an unknown kind is ignored; an identity that never said hello is ignored; a second
 *   report within 30 s is ignored.
 * - An admin sees `admin_player_device` (joined to `admin_players` by id); a non-admin sees nothing.
 *
 *   ADMIN_TEST_KEY=<test key> bun scripts/devicecheck.ts ws://127.0.0.1:3301 twdevice
 */
import { shortId } from '../spacetimedb/src/admin';
import { sql } from './stdb-sql';
import { checker, connect, localOnly, wait, type Conn } from './stdb-local';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3301';
const db = process.argv[3] ?? 'twdevice';
const server = localOnly(uri);
const key = process.env.ADMIN_TEST_KEY;
if (!key) throw new Error('Set ADMIN_TEST_KEY to the test key whose hash the local module was published with');
const { check, note, finish } = checker();
const VIEWS = ['SELECT * FROM admin_status', 'SELECT * FROM admin_players', 'SELECT * FROM admin_player_device'];

type DeviceRow = { identity: string; device: string; phone: number; tablet: number; desktop: number; last_at: bigint };
const deviceOf = (c: Conn) => (sql(server, db, 'SELECT * FROM player_device') as unknown as DeviceRow[]).find(r => r.identity === c.identity!.toHexString());

/** A player who said hello from `tz`, then reported `kind`. */
async function player(tz: string, kind: string) {
  const { conn } = await connect(uri, db, []);
  await conn.reducers.hello({ tz, lang: 'en' });
  await conn.reducers.device({ kind });
  return conn;
}

const phone = await player('Asia/Taipei', 'phone');
const tablet = await player('Asia/Tokyo', 'tablet');
const desktop = await player('America/Los_Angeles', 'desktop');
check('a phone, a tablet and a computer are recorded with one connection each', deviceOf(phone)?.device === 'phone' && deviceOf(phone)?.phone === 1
  && deviceOf(tablet)?.device === 'tablet' && deviceOf(tablet)?.tablet === 1 && deviceOf(desktop)?.device === 'desktop' && deviceOf(desktop)?.desktop === 1,
  { phone: deviceOf(phone), tablet: deviceOf(tablet), desktop: deviceOf(desktop) });

const odd = await player('Europe/Berlin', 'watch');
await odd.reducers.device({ kind: 'Phone' });
await odd.reducers.device({ kind: ` ${'x'.repeat(5000)}` });
check('a kind other than phone, tablet or desktop is ignored', !deviceOf(odd));

const { conn: stranger } = await connect(uri, db, []);
await stranger.reducers.device({ kind: 'phone' });
check('an identity that never said hello (no player_seen row) is ignored', !deviceOf(stranger));

await phone.reducers.device({ kind: 'desktop' });
check('a second report within 30 s is ignored', deviceOf(phone)?.device === 'phone' && deviceOf(phone)?.phone === 1 && deviceOf(phone)?.desktop === 0, deviceOf(phone));

const admin = await connect(uri, db, VIEWS);
await admin.conn.reducers.adminLogin({ key });
await wait(500);
const view = (c: Conn) => [...admin.conn.db.adminPlayerDevice.iter()].find(r => r.id === shortId(c.identity!.toHexString()));
check('the admin sees each player\'s device by the admin_players id', view(phone)?.device === 'phone' && view(tablet)?.device === 'tablet' && view(desktop)?.desktop === 1
  && [...admin.conn.db.adminPlayers.iter()].some(p => p.id === view(tablet)?.id) && !view(odd) && !view(stranger));
const viewer = await connect(uri, db, VIEWS);
check('a non-admin sees no devices', viewer.conn.db.adminPlayerDevice.count() === 0n && viewer.conn.db.adminPlayers.count() === 0n);

note('rows', { phone: view(phone), tablet: view(tablet), desktop: view(desktop) });
for (const c of [phone, tablet, desktop, odd, stranger, admin.conn, viewer.conn]) c.disconnect();
await wait(200);
finish();
