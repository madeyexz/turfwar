/**
 * Run `admin_rebuild_taipei_days` once on a database: Taipei days rebuilt exactly from `player_hour`
 * and the launch days before it estimated from the UTC-day rows (spacetimedb/src/admin.ts,
 * `rebuildTaipeiDays`). A throwaway identity logs in with the admin key, calls it, prints what the
 * admin views then hold, and logs out. A second run is refused by the module.
 *
 *   TURFWAR_ADMIN_KEY=… bun scripts/taipei-rebuild.ts wss://tw.turfwar.ianhsiao.me turfwar
 */
import { connect, wait } from './stdb-local';

const [uri, db] = process.argv.slice(2);
const key = process.env.TURFWAR_ADMIN_KEY;
if (!uri || !db) throw new Error('Usage: bun scripts/taipei-rebuild.ts <ws(s)://server> <database>');
if (!key) throw new Error('Set TURFWAR_ADMIN_KEY');

const VIEWS = ['SELECT * FROM admin_status', 'SELECT * FROM admin_taipei_player_day', 'SELECT * FROM admin_taipei_player_day_time', 'SELECT * FROM admin_taipei_coverage', 'SELECT * FROM admin_taipei_rebuild'];
const { conn } = await connect(uri, db, VIEWS);
const date = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
const summary = () => {
  const days = new Map<number, number>(), seconds = new Map<number, number>();
  for (const r of conn.db.adminTaipeiPlayerDay.iter()) days.set(r.day, (days.get(r.day) ?? 0) + 1);
  for (const r of conn.db.adminTaipeiPlayerDayTime.iter()) seconds.set(r.day, (seconds.get(r.day) ?? 0) + r.seconds);
  return [...days.keys()].sort((a, b) => a - b).map(d => `${date(d)}  DAU ${days.get(d)}  play ${((seconds.get(d) ?? 0) / 3600).toFixed(1)} h`);
};
try {
  await conn.reducers.adminLogin({ key });
  await wait(500);
  if (![...conn.db.adminStatus.iter()][0]?.admin) throw new Error('Admin login failed');
  console.log('Before:', summary());
  await conn.reducers.adminRebuildTaipeiDays({});
  await wait(1500);
  const r = [...conn.db.adminTaipeiRebuild.iter()][0];
  const cov = [...conn.db.adminTaipeiCoverage.iter()][0];
  console.log('Rebuilt:', r && { exactFrom: date(r.exactFrom), estimatedFrom: date(r.estimatedFrom) }, 'coverage from', cov?.startedAt.toDate().toISOString());
  console.log('After:', summary());
} finally {
  await conn.reducers.adminLogout({}).catch(() => {});
  conn.disconnect();
}
process.exit(0);
