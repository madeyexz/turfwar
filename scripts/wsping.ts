/**
 * Measures the WebSocket round trip a player feels: connects like the game does and times `hello`
 * reducer calls (the same reducer-promise round trip the in-game ping uses). Read-only apart from
 * `hello`, which records the probe as a player (lang "probe"): on production, delete that player_seen row after.
 *   bun scripts/wsping.ts <wss-uri> <database> [calls]
 */
import { DbConnection } from '../src/module_bindings';

const [uri, database, n = '15'] = process.argv.slice(2);
if (!uri || !database) { console.error('usage: bun scripts/wsping.ts <wss-uri> <database> [calls]'); process.exit(2); }

const conn = await new Promise<DbConnection>((resolve, reject) => {
  const t0 = performance.now();
  DbConnection.builder().withUri(uri).withDatabaseName(database)
    .onConnect(c => { console.log(`connected in ${Math.round(performance.now() - t0)} ms`); resolve(c); })
    .onConnectError((_c, e) => reject(e))
    .build();
  setTimeout(() => reject(new Error('connect timeout')), 60_000);
});
const times: number[] = [];
for (let i = 0; i < Number(n); i++) {
  const t = performance.now();
  await conn.reducers.hello({ tz: 'Asia/Taipei', lang: 'probe' });
  times.push(performance.now() - t);
  await new Promise(r => setTimeout(r, 200));
}
times.sort((a, b) => a - b);
const pick = (q: number) => Math.round(times[Math.min(times.length - 1, Math.floor(q * times.length))]);
console.log(`reducer round trip over ${times.length} calls: min ${pick(0)} ms · median ${pick(0.5)} ms · p90 ${pick(0.9)} ms`);
conn.disconnect();
process.exit(0);
