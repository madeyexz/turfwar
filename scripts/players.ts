/**
 * "How many players do I have and where are they from?" — a read-only report from a database's
 * private `player_seen` table (plus `player`, `match`, `profile` and `player_time`), via `spacetime sql` with the
 * owner's CLI login. Works against any database:
 *
 *   bun scripts/players.ts lawbreaker-dev                      # Maincloud (default server)
 *   bun scripts/players.ts 3d-game-c4lhd --server maincloud
 *   bun scripts/players.ts lbtrack --server http://127.0.0.1:3254
 *
 * Where from = the browser's time zone mapped to a country (an estimate; no IPs are stored).
 * Players are identities that said `hello` or joined a room (lobby-only visitors are not counted).
 */
import { formatPlayTime } from '../shared/playtime';
import { countByCountry } from '../shared/tzcountry';
import { shortId } from '../spacetimedb/src/admin';
import { sql } from './stdb-sql';

const args = process.argv.slice(2);
const db = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--server');
const server = args.includes('--server') ? args[args.indexOf('--server') + 1] : 'maincloud';
if (!db) { console.error('usage: bun scripts/players.ts <database> [--server maincloud|http://127.0.0.1:3000]'); process.exit(2); }

const seen = sql(server, db, 'SELECT * FROM player_seen') as { identity: string; first_seen: bigint; last_seen: bigint; sessions: number; tz: string; lang: string; name: string }[];
const online = sql(server, db, 'SELECT * FROM player').length;
const rooms = sql(server, db, 'SELECT * FROM match') as { humans: number; code: string; map_id: string }[];
const profiles = sql(server, db, 'SELECT * FROM profile') as { identity: string; name: string; matches_played: number; matches_won: number; rounds_played: number; kills: number }[];
// Online play time (seconds credited; `since` > 0 = in a room now). Missing on a database whose module predates it.
let times: { identity: string; play_seconds: number | bigint; since: number | bigint }[] | undefined;
try { times = sql(server, db, 'SELECT * FROM player_time') as typeof times; } catch { times = undefined; }

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
console.log('\nOnline play time (time in online rooms; lobby, Solo and Practice not counted):');
if (!times) console.log('  (no player_time table: publish the module with play-time tracking first)');
else {
  const nameOf = new Map<string, string>();
  for (const p of profiles) if (p.name) nameOf.set(p.identity, p.name);
  for (const s of seen) if (s.name) nameOf.set(s.identity, s.name);
  const roundsOf = new Map(profiles.map(p => [p.identity, Number(p.rounds_played)]));
  const played = times.map(t => ({ ...t, seconds: Number(t.play_seconds) })).filter(t => t.seconds > 0).sort((a, b) => b.seconds - a.seconds);
  const total = played.reduce((n, t) => n + t.seconds, 0);
  console.log(`  Total                     ${formatPlayTime(total)} over ${num(played.length)} player${played.length === 1 ? '' : 's'}`);
  if (played.length) console.log(`  Average / median          ${formatPlayTime(total / played.length)} / ${formatPlayTime(played[played.length >> 1].seconds)}`);
  const top = played.slice(0, 50);
  if (top.length) console.log(`\n  ${pad('Player', 18)} ${pad('Play time', 11)} ${pad('Rounds', 7)} Id`);
  for (const t of top) {
    console.log(`  ${pad(nameOf.get(t.identity) || '—', 18)} ${pad(formatPlayTime(t.seconds), 11)} ${pad(num(roundsOf.get(t.identity) ?? 0), 7)} ${shortId(t.identity)}${Number(t.since) > 0 ? '  (in a room now)' : ''}`);
  }
  if (played.length > top.length) console.log(`  … ${played.length - top.length} more`);
}

console.log(`\nCareer (profile): ${num(profiles.length)} players with stats, ${num(sum('matches_played'))} player-matches played (${num(sum('matches_won'))} won), ${num(sum('rounds_played'))} player-rounds, ${num(sum('kills'))} kills`);
