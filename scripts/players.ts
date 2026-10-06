/**
 * "How many players do I have and where are they from?" — a read-only report from a database's
 * private `player_seen` table (plus `player`, `match` and `profile`), via `spacetime sql` with the
 * owner's CLI login. Works against any database:
 *
 *   bun scripts/players.ts lawbreaker-dev                      # Maincloud (default server)
 *   bun scripts/players.ts 3d-game-c4lhd --server maincloud
 *   bun scripts/players.ts lbtrack --server http://127.0.0.1:3254
 *
 * Where from = the browser's time zone mapped to a country (an estimate; no IPs are stored).
 * Players are identities that said `hello` or joined a room (lobby-only visitors are not counted).
 */
import { countByCountry } from '../shared/tzcountry';
import { sql } from './stdb-sql';

const args = process.argv.slice(2);
const db = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--server');
const server = args.includes('--server') ? args[args.indexOf('--server') + 1] : 'maincloud';
if (!db) { console.error('usage: bun scripts/players.ts <database> [--server maincloud|http://127.0.0.1:3000]'); process.exit(2); }

const seen = sql(server, db, 'SELECT * FROM player_seen') as { identity: string; first_seen: bigint; last_seen: bigint; sessions: number; tz: string; lang: string }[];
const online = sql(server, db, 'SELECT * FROM player').length;
const rooms = sql(server, db, 'SELECT * FROM match') as { humans: number; code: string; map_id: string }[];
const profiles = sql(server, db, 'SELECT * FROM profile') as { matches_played: number; matches_won: number; rounds_played: number; kills: number }[];

const now = BigInt(Date.now()) * 1000n;
const DAY = 86_400_000_000n;
const startOfToday = BigInt(new Date(new Date().toISOString().slice(0, 10)).getTime()) * 1000n; // UTC midnight
const since = (t: bigint, from: bigint) => t >= from;
const count = (f: (s: (typeof seen)[number]) => boolean) => seen.filter(f).length;
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const num = (n: number) => n.toLocaleString('en-US');

console.log(`Players on ${db} (${server}), ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC\n`);
console.log(`  Total players ever        ${num(seen.length)}`);
console.log(`  New today (UTC)           ${num(count(s => since(s.first_seen, startOfToday)))}`);
console.log(`  New in the last 7 days    ${num(count(s => since(s.first_seen, now - 7n * DAY)))}`);
console.log(`  New in the last 30 days   ${num(count(s => since(s.first_seen, now - 30n * DAY)))}`);
console.log(`  Active in the last 24 h   ${num(count(s => since(s.last_seen, now - DAY)))}`);
console.log(`  Active in the last 7 days ${num(count(s => since(s.last_seen, now - 7n * DAY)))}`);
console.log(`  Sessions (all time)       ${num(seen.reduce((n, s) => n + s.sessions, 0))}`);

console.log(`\nOnline now: ${num(online)} in rooms (${rooms.length} room${rooms.length === 1 ? '' : 's'} open)`);
for (const r of rooms) console.log(`  ${pad(r.code ? `#${r.code}` : 'public', 8)} ${pad(r.map_id, 12)} ${r.humans} human${r.humans === 1 ? '' : 's'}`);

console.log('\nWhere from (time zone → country, estimate):');
const countries = countByCountry(seen.map(s => s.tz));
for (const [country, n] of countries.slice(0, 15)) console.log(`  ${pad(country, 22)} ${pad(num(n), 6)} ${((n / Math.max(1, seen.length)) * 100).toFixed(0)}%`);
if (countries.length > 15) console.log(`  … ${countries.length - 15} more`);

const zones = new Map<string, number>();
for (const s of seen) zones.set(s.tz || '(none)', (zones.get(s.tz || '(none)') ?? 0) + 1);
console.log('\nTop time zones:');
for (const [tz, n] of [...zones].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${pad(tz, 30)} ${num(n)}`);

const langs = new Map<string, number>();
for (const s of seen) langs.set(s.lang || '(none)', (langs.get(s.lang || '(none)') ?? 0) + 1);
console.log('\nBrowser languages:');
for (const [l, n] of [...langs].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${pad(l, 12)} ${num(n)}`);

const sum = (k: keyof (typeof profiles)[number]) => profiles.reduce((n, p) => n + Number(p[k]), 0);
console.log(`\nCareer (profile): ${num(profiles.length)} players with stats, ${num(sum('matches_played'))} player-matches played (${num(sum('matches_won'))} won), ${num(sum('rounds_played'))} player-rounds, ${num(sum('kills'))} kills`);
