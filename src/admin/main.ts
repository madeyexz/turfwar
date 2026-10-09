import type { Infer } from 'spacetimedb';
import { DbConnection } from '../module_bindings';
import type AdminPlayersRow from '../module_bindings/admin_players_table';
import type AdminRoomsRow from '../module_bindings/admin_rooms_table';
import type AdminOverviewRow from '../module_bindings/admin_overview_table';
import type AdminPlayerTimeRow from '../module_bindings/admin_player_time_table';
import type AdminDailyTimeRow from '../module_bindings/admin_daily_time_table';
import type AdminPlayerNetRow from '../module_bindings/admin_player_net_table';
import type AdminPlayerDeviceRow from '../module_bindings/admin_player_device_table';
import type AdminPlayerDayRow from '../module_bindings/admin_player_day_table';
import { countByCountry, countryOf } from '../../shared/tzcountry';
import { fmtPing, fmtRate, medianCorrections, medianPing, pingByCountry, pingClass, type NetOf } from './net';
import { deviceCounts, deviceLabel, deviceShare, fmtShare, type DeviceOf } from './devices';
import { activeBetween, cameBack, change, cohorts, daysById, firstDayOf, fmtRetention, newBetween, RETENTION_DAYS, type Cell } from './retention';
import { releasesByDay, releaseTitle, type Release } from './releases';
import { activeByDay, GROUPS, niceStep, pingByDay, sideOf, SIDES, splitBySide, sumByDay, type DayNet as DayNetOf, type GroupId, type Side } from './groups';
import { formatPlayTime, liveSeconds } from '../../shared/playtime';
import { hostAnswers, pingUrl, serverIdentityKey } from '../net/ping';
import { WakeDriver, wakeProgress, wakeSeconds, type WakeLink } from '../net/wake';
import { adminServers, chosenServer, regionName, rememberServer, type AdminServer } from './servers';
import './admin.css';

/**
 * The owner's dashboard at /admin (not linked from the game, not indexed). It holds no secrets:
 * the owner types the admin key once, `admin_login` checks its hash inside the module and marks this
 * browser's SpacetimeDB identity as an admin, and the `admin_*` views then stream the data (they
 * return nothing to anyone else). Only "this browser is logged in" is remembered, never the key.
 *
 * A switcher picks the server (src/admin/servers.ts): the build's own (production: the Taipei
 * server) or the others that stay published (Singapore, legacy Maincloud production, dev). Each has its own
 * admin table, so the login, the identity and the "logged in" flag are per server. The Singapore
 * server sleeps when idle: opening this page wakes it, shown as "waking" (src/net/wake.ts).
 */
type Room = Infer<typeof AdminRoomsRow>;
type Overview = Infer<typeof AdminOverviewRow>;
type PlayerTime = Infer<typeof AdminPlayerTimeRow>;
type DayTime = Infer<typeof AdminDailyTimeRow>;
type PlayerNet = Infer<typeof AdminPlayerNetRow>;
type PlayerDevice = Infer<typeof AdminPlayerDeviceRow>;
type PlayerDay = Infer<typeof AdminPlayerDayRow>;
/**
 * An `admin_players` row joined (by id) with its `admin_player_time` row (rounds, and play time
 * including a session in progress), its `admin_player_net` row, if any (connection quality:
 * `ping` is the typical p50 in ms, `corrPerMin` the corrections per minute), and its
 * `admin_player_device` row, if any (`deviceName`: Phone, Tablet or Computer), and its
 * `admin_player_day` rows, if any (`days`: the UTC days active; `firstDay`: the first of them or the
 * day first seen, whichever is earlier).
 */
type Player = Infer<typeof AdminPlayersRow> & {
  rounds: number; playTime: number; playing: boolean; openSeconds: number; net?: NetOf; ping?: number; corrPerMin?: number; device?: DeviceOf; deviceName?: string;
  firstDay: number; days: Set<number>; activeDays?: number;
  /** Phone or Computer, by the device last played on (none without a report). */
  side?: Side;
  /** Play time and connection quality per UTC day (`admin_player_day_time`, `admin_player_day_net`). */
  daySeconds?: Map<number, number>; dayNet?: Map<number, DayNetOf>;
};

/** Releases marked on the charts (vite.config.ts: git history of `main` and src/admin/releases.json). */
declare const __RELEASES__: Release[];
const RELEASES: Release[] = typeof __RELEASES__ === 'undefined' ? [] : __RELEASES__;

const POSTHOG = 'https://us.posthog.com/project/649207';
const env = import.meta.env as Record<string, string | undefined>;
let buildUri = env.VITE_SPACETIMEDB_URI;
if (buildUri === 'same-origin') buildUri = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/stdb/`;
const SERVERS = adminServers({ uri: buildUri, database: env.VITE_SPACETIMEDB_DATABASE });
const storage = (() => { try { return localStorage; } catch { return undefined; } })();
let server: AdminServer = chosenServer(SERVERS, storage);
// Its own identity, not the game's: closing this tab must never drop the owner's soldier from a match.
// Per server (as before the switcher, so an existing login carries over).
const tokenKey = () => `lawbreaker.admin.token:${serverIdentityKey(server.uri)}:${server.database}`;
const flagKey = () => `lawbreaker.admin.loggedIn:${serverIdentityKey(server.uri)}:${server.database}`;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage disabled */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* storage disabled */ } },
};

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const num = (n: number | bigint) => Number(n).toLocaleString('en-US');
const DAY_MS = 86_400_000;
const ago = (d: Date) => {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
};
const shortDate = (d: Date) => d.toISOString().slice(0, 10);
const titleCase = (id: string) => id.replace(/(^|[-_ ])(\w)/g, (_m, sep: string, c: string) => `${sep ? ' ' : ''}${c.toUpperCase()}`);

const root = document.querySelector<HTMLDivElement>('#admin')!;
const serverLabel = (s: AdminServer) => `${s.name} · ${regionName(s.uri)} · ${s.database}`;
root.innerHTML = `
  <header class="top">
    <h1><img src="/icons/icon-192.png" width="32" height="32" alt=""> Turf War <em>Admin</em></h1>
    <label class="server-pick" title="Which game server to show; each has its own login">
      <span>Server</span>
      <select id="server">${SERVERS.map(s => `<option value="${esc(s.id)}">${esc(serverLabel(s))}</option>`).join('')}</select>
    </label>
    <span class="db" id="db" title="SpacetimeDB server and database"><i class="dot wait" id="conn"></i><b id="srv-name"></b><span id="srv-region"></span><span class="db-name">db <b id="srv-db"></b></span></span>
    <span class="spacer"></span>
    <nav class="links"><a href="${POSTHOG}" target="_blank" rel="noopener noreferrer">PostHog ↗</a><button type="button" class="btn" id="logout" hidden>Log out</button></nav>
  </header>
  <main id="body"></main>`;
const body = root.querySelector<HTMLElement>('#body')!;
const connDot = root.querySelector<HTMLElement>('#conn')!;
const logoutBtn = root.querySelector<HTMLButtonElement>('#logout')!;
const serverSelect = root.querySelector<HTMLSelectElement>('#server')!;

let conn: DbConnection | undefined;
let loggingIn = false;
/** The line under the login form: an error, or a plain note. */
let message = '';
let messageError = true;
let playerLimit = 100;
let sortKey: keyof Player | 'country' = 'lastSeen';
let sortDir: 1 | -1 = -1;
/**
 * Views added after the first admin page, each subscribed on its own: a server whose module predates
 * one refuses only that subscription, and the page shows "—" where it would be used.
 */
const OPTIONAL = {
  net: ['SELECT * FROM admin_player_net'],
  device: ['SELECT * FROM admin_player_device'],
  days: ['SELECT * FROM admin_player_day'],
  dayTime: ['SELECT * FROM admin_player_day_time'],
  dayNet: ['SELECT * FROM admin_player_day_net'],
};
type ViewState = 'wait' | 'on' | 'missing';
const freshViews = (): Record<keyof typeof OPTIONAL, ViewState> => ({ net: 'wait', device: 'wait', days: 'wait', dayTime: 'wait', dayNet: 'wait' });
let views = freshViews();
/** Which players the list shows. */
let playerGroup: GroupId = 'all';
const setConn = (s: 'wait' | 'live' | 'off', title: string) => { connDot.className = `dot ${s}`; connDot.title = title; };

/** The header: which server, where, which database. */
function renderServer() {
  serverSelect.value = server.id;
  root.querySelector('#srv-name')!.textContent = server.name;
  root.querySelector('#srv-region')!.textContent = `· ${regionName(server.uri)} ·`;
  root.querySelector('#srv-db')!.textContent = server.database;
  root.querySelector<HTMLElement>('#db')!.title = `${server.uri} · database ${server.database}`;
  document.title = `Turf War Admin · ${server.name}`;
}

function status() { return conn ? [...conn.db.adminStatus.iter()][0] : undefined; }
const isAdmin = () => !!status()?.admin;

// ---- Login -------------------------------------------------------------------------------

function renderLogin() {
  logoutBtn.hidden = true;
  const s = status();
  const now = BigInt(Date.now()) * 1000n;
  const lockedUntil = s && s.failures >= 5 ? Number((s.windowStart.microsSinceUnixEpoch + 600_000_000n - now) / 60_000_000n) + 1 : 0;
  body.innerHTML = `
    <form class="login" id="login" autocomplete="off">
      <h2>Admin login</h2>
      <p>Enter the admin key for <b>${esc(server.name)}</b> (${esc(server.database)}). Each server keeps its own login; this browser stays logged in, and the key itself is never stored.</p>
      <label for="key">Admin key</label>
      <div class="row"><input id="key" type="password" autocomplete="current-password" spellcheck="false" required ${conn ? '' : 'disabled'}>
      <button class="btn primary" type="submit" ${conn && !loggingIn ? '' : 'disabled'}>${loggingIn ? '…' : 'Log in'}</button></div>
      <p class="msg${(message ? messageError : lockedUntil > 0) ? '' : ' ok'}" role="status">${esc(message || (!conn ? 'Connecting…' : lockedUntil > 0 ? `Too many attempts; try again in ${lockedUntil} min.` : ''))}</p>
    </form>`;
  const form = body.querySelector<HTMLFormElement>('#login')!;
  const input = form.querySelector<HTMLInputElement>('#key')!;
  input.focus();
  form.addEventListener('submit', e => {
    e.preventDefault();
    const key = input.value;
    input.value = '';
    if (!conn || !key || loggingIn) return;
    loggingIn = true; message = ''; messageError = true; renderLogin();
    conn.reducers.adminLogin({ key }).then(() => {
      // The admin_status view says how it went (a wrong key returns normally so its failure is counted).
      setTimeout(() => {
        loggingIn = false;
        const s = status();
        if (s?.admin) { store.set(flagKey(), '1'); message = ''; render(); return; }
        const left = Math.max(0, 5 - (s?.failures ?? 0));
        message = left > 0 ? `Wrong key. ${left} attempt${left === 1 ? '' : 's'} left in this 10-minute window.` : 'Wrong key. Too many attempts; try again in 10 minutes.';
        render();
      }, 400);
    }, (error: unknown) => {
      loggingIn = false;
      message = String((error as Error)?.message ?? error).replace(/^.*?:\s*/, '') || 'Login failed.';
      render();
    });
  });
}

// ---- Dashboard ---------------------------------------------------------------------------

/** Players with their play time (credited seconds plus the open stretch of anyone in a room right now) and every optional view's data. */
function joinedPlayers(): Player[] {
  const db = conn!.db;
  const times = new Map<string, PlayerTime>();
  for (const t of db.adminPlayerTime.iter()) times.set(t.id, t);
  const nets = new Map<string, PlayerNet>();
  if (views.net === 'on') for (const n of db.adminPlayerNet.iter()) nets.set(n.id, n);
  const devices = new Map<string, PlayerDevice>();
  if (views.device === 'on') for (const d of db.adminPlayerDevice.iter()) devices.set(d.id, d);
  const days = views.days === 'on' ? daysById(db.adminPlayerDay.iter() as Iterable<PlayerDay>) : new Map<string, Set<number>>();
  const dayTime = new Map<string, Map<number, number>>();
  if (views.dayTime === 'on') for (const r of db.adminPlayerDayTime.iter()) {
    let m = dayTime.get(r.id);
    if (!m) dayTime.set(r.id, (m = new Map()));
    m.set(r.day, r.seconds);
  }
  const dayNet = new Map<string, Map<number, DayNetOf>>();
  if (views.dayNet === 'on') for (const r of db.adminPlayerDayNet.iter()) {
    let m = dayNet.get(r.id);
    if (!m) dayNet.set(r.id, (m = new Map()));
    m.set(r.day, { p50: r.p50, p95: r.p95, seconds: r.seconds, corrections: r.corrections });
  }
  const nowMicros = BigInt(Date.now()) * 1000n;
  return [...db.adminPlayers.iter()].map(p => {
    const t = times.get(p.id);
    const since = t?.playingSince.microsSinceUnixEpoch ?? 0n;
    const credited = t?.playSeconds ?? 0n;
    const live = Number(liveSeconds({ seconds: credited, since }, nowMicros));
    const n = nets.get(p.id);
    const net: NetOf | undefined = n && { pingP50: n.pingP50, pingP95: n.pingP95, worstP95: n.worstP95, correctionsPerMin: n.correctionsPerMin, measuredMinutes: n.measuredMinutes, lastAtMs: n.lastAt.toDate().getTime() };
    const d = devices.get(p.id);
    const device: DeviceOf | undefined = d && { device: d.device, phone: d.phone, tablet: d.tablet, desktop: d.desktop, lastAtMs: d.lastAt.toDate().getTime() };
    const active = days.get(p.id);
    return {
      ...p, rounds: t?.rounds ?? 0, playTime: live, playing: since > 0n, openSeconds: live - Number(credited), net, ping: net?.pingP50, corrPerMin: net?.correctionsPerMin,
      device, deviceName: deviceLabel(device), side: sideOf(device?.device),
      firstDay: firstDayOf(Math.floor(p.firstSeen.toDate().getTime() / DAY_MS), active), days: active ?? new Set(), activeDays: active?.size,
      daySeconds: dayTime.get(p.id), dayNet: dayNet.get(p.id),
    };
  });
}

/** Play time for the tiles: a zero reads "0 m" there (the table shows "—"). */
const hm = (seconds: number) => (seconds >= 1 ? formatPlayTime(seconds) : '0 m');
/** Play time as a tile figure: whole hours from 10 h on, so three fit side by side (the exact time in the tooltip). */
const hmFig = (seconds: number): NonNullable<Fig> => (seconds >= 36_000 ? { v: `${num(Math.round(seconds / 3600))} h`, title: hm(seconds) } : { v: hm(seconds) });

/**
 * A group's play time: totals over its players, and per UTC day (credited per day plus the sessions
 * in progress, which belong to today). `byDay` is undefined without the per-day view, except for
 * everyone, which falls back to the server's daily totals.
 */
function playStats(ps: Player[], today: number, fallback?: DayTime[]) {
  const played = ps.map(p => p.playTime).filter(s => s > 0).sort((a, b) => a - b);
  const total = played.reduce((n, s) => n + s, 0);
  const mid = played.length >> 1;
  const median = !played.length ? 0 : played.length % 2 ? played[mid] : (played[mid - 1] + played[mid]) / 2;
  const open = ps.reduce((n, p) => n + p.openSeconds, 0);
  let byDay: Map<number, number> | undefined;
  if (views.dayTime === 'on') byDay = sumByDay(ps.map(p => p.daySeconds));
  else if (fallback) byDay = new Map(fallback.map(d => [d.day, Number(d.playSeconds)]));
  if (byDay) byDay.set(today, (byDay.get(today) ?? 0) + open);
  const span = (from: number, to: number) => { let n = 0; for (let d = from; d <= to; d++) n += byDay?.get(d) ?? 0; return n; };
  return { total, players: played.length, average: played.length ? total / played.length : 0, median, byDay, today: span(today, today), week: span(today - 6, today), prevWeek: span(today - 13, today - 7) };
}

/** One group's figure in a tile: the value, a line under it, a change from the period before (`delta`: now, before). */
type Fig = { v: string; sub?: string; cls?: string; title?: string; delta?: [number, number] } | undefined;

/** A figure for All, Phone and Computer side by side (`figs` in GROUPS order); the note under them is shared. */
function tile(label: string, figs: Fig[], note = '', hero = false) {
  const cols = GROUPS.map((g, i) => {
    const f = figs[i], d = f?.delta && change(f.delta[0], f.delta[1]);
    const delta = d ? `<em class="delta ${d.dir}" title="${esc(`${num(f!.delta![0])} vs ${num(f!.delta![1])}`)}">${d.text}</em>` : '';
    return `<div class="col ${g.id}"><i>${g.label}</i><b${f?.cls ? ` class="${f.cls}"` : ''}${f?.title ? ` title="${esc(f.title)}"` : ''}>${f ? f.v : '—'}</b>${delta || f?.sub ? `<span>${[delta, f?.sub ?? ''].filter(Boolean).join(' ')}</span>` : ''}</div>`;
  }).join('');
  return `<div class="tile${hero ? ' hero' : ''}"><small>${label}</small><div class="cols">${cols}</div>${note ? `<span class="note">${note}</span>` : ''}</div>`;
}

/** One section of the dashboard: a heading the nav links to, its figures, then its cards. */
const group = (id: string, title: string, sub: string, tiles: string[], cards: string) => `
  <section class="group" id="${id}" aria-labelledby="${id}-h"><h2 class="group-h" id="${id}-h">${title}<small>${sub}</small></h2>
    ${tiles.length ? `<div class="tiles">${tiles.join('')}</div>` : ''}${cards}</section>`;
const card = (title: string, sub: string, content: string, cls = '') => `<section class="card${cls ? ` ${cls}` : ''}"><h3>${title} <small>${sub}</small></h3>${content}</section>`;
const SECTIONS: [string, string][] = [['now', 'Now'], ['growth', 'Growth'], ['retention', 'Retention'], ['play', 'Play time'], ['connection', 'Connection'], ['players', 'Players']];
const SIDE_LABEL: Record<Side, string> = { phone: 'Phone', computer: 'Computer' };
const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

function dashboard() {
  const db = conn!.db;
  const o: Overview | undefined = [...db.adminOverview.iter()][0];
  const players = joinedPlayers();
  const G = splitBySide(players);
  /** A figure per group, in GROUPS order. */
  const per = (f: (ps: Player[], g: GroupId) => Fig) => GROUPS.map(g => f(G[g.id], g.id));
  const rooms = [...db.adminRooms.iter()].sort((a, b) => b.humans - a.humans || a.room - b.room);
  const now = Date.now();
  const today = Math.floor(now / DAY_MS);
  const last = (p: Player) => p.lastSeen.toDate().getTime();
  const hasDays = views.days === 'on';
  const sideNote = views.device === 'missing' ? 'Phone and Computer need the device view, which this server lacks' : '';

  // Now: who is playing at this moment.
  const nowTiles = [
    tile('Online now', per((ps, g) => ({ v: num(g === 'all' ? o?.onlineNow ?? 0 : ps.filter(p => p.playing).length) })), 'players in rooms', true),
    tile('Active 24 h', per(ps => ({ v: num(ps.filter(p => last(p) >= now - DAY_MS).length) })), 'seen in the last 24 hours'),
  ];
  const roomRows = rooms.map(r => `<tr><td>${r.code ? `<span class="tag">#${esc(r.code)}</span>` : '<span class="tag">public</span>'}</td><td>${esc(titleCase(r.mapId))}</td><td>${esc(titleCase(r.mode))}</td>
    <td>${r.size}v${r.size}</td><td class="num">${r.humans}</td><td class="num">${r.bots}</td><td class="num">${r.round}</td><td><span class="tag${r.phase === 'live' ? ' live' : ''}">${esc(r.phase)}</span></td></tr>`).join('');
  const roomCard = card('Live rooms', rooms.length ? `${num(o?.humansInRooms ?? 0)} human${o?.humansInRooms === 1 ? '' : 's'} in ${rooms.length} room${rooms.length === 1 ? '' : 's'}` : 'none open',
    rooms.length ? `<div class="scroll"><table><thead><tr><th>Room</th><th>Map</th><th>Mode</th><th>Size</th><th class="num">Humans</th><th class="num">Bots</th><th class="num">Round</th><th>Phase</th></tr></thead><tbody>${roomRows}</tbody></table></div>` : '<div class="empty">No rooms open: nobody is playing online right now.</div>');

  // Growth: new and active players, each against the period before it (UTC days, today included).
  const growthTiles = [
    tile('Total players', per(ps => ({ v: num(ps.length) })), 'ever seen'),
    tile('New today', per(ps => ({ v: num(newBetween(ps, today, today)), sub: `yesterday ${num(newBetween(ps, today - 1, today - 1))}` })), 'UTC day'),
    tile('New 7 d', per(ps => { const n = newBetween(ps, today - 6, today); return { v: num(n), delta: [n, newBetween(ps, today - 13, today - 7)] }; }), 'vs the 7 days before'),
    tile('New 30 d', per(ps => { const n = newBetween(ps, today - 29, today); return { v: num(n), delta: [n, newBetween(ps, today - 59, today - 30)] }; }), 'vs the 30 days before'),
    tile('Active 7 d', per(ps => {
      if (!hasDays) return { v: num(ps.filter(p => last(p) >= now - 7 * DAY_MS).length) };
      const n = activeBetween(ps, today - 6, today);
      return { v: num(n), delta: [n, activeBetween(ps, today - 13, today - 7)] };
    }), hasDays ? 'vs the 7 days before' : ''),
  ];
  const growthCards = `<div class="grid2">${card('New and returning', 'players active per UTC day, last 30 days', playersChart(today, G))}${card('Where from', 'time zone → country, estimate', countryList(G))}</div>`;

  // Retention: who came back (needs the active-days view).
  const ret = hasDays ? { phone: cohorts(G.phone, today), computer: cohorts(G.computer, today), all: cohorts(G.all, today) } : undefined;
  const retFig = (c: Cell | undefined): Fig => (!hasDays ? undefined : { v: fmtRetention(c), sub: c ? `${num(c.back)} of ${num(c.players)}` : 'not yet' });
  const retTiles = [
    tile('Came back', per(ps => retFig(hasDays ? cameBack(ps, today) : undefined)), 'played again on a later day', true),
    ...([1, 7, 30] as const).map(n => tile(`Day ${n}`, per((_ps, g) => retFig(ret?.[g].overall[RETENTION_DAYS.indexOf(n)])), `back exactly ${n} day${n === 1 ? '' : 's'} after their first`)),
  ];
  const retCards = `<div class="grid2 even">${SIDES.map(s => card(`${SIDE_LABEL[s]} cohorts`, 'share of each UTC day\'s new players back exactly N days later', retentionTable(ret?.[s], G[s].length))).join('')}</div>`;

  // Play time.
  const play = { all: playStats(G.all, today, [...db.adminDailyTime.iter()]), phone: playStats(G.phone, today), computer: playStats(G.computer, today) };
  const perDay = (g: GroupId, v: (s: ReturnType<typeof playStats>) => number, delta?: (s: ReturnType<typeof playStats>) => [number, number]): Fig =>
    play[g].byDay ? { ...hmFig(v(play[g])), delta: delta?.(play[g]) } : undefined;
  const playTiles = [
    tile('Total play time', per((_ps, g) => hmFig(play[g].total)), 'online, all time'),
    tile('Avg / player', per((_ps, g) => ({ ...hmFig(play[g].average), sub: `median ${hm(play[g].median)}` })), 'over players who played online'),
    tile('Today', per((_ps, g) => perDay(g, s => s.today)), 'UTC day'),
    tile('7 d', per((_ps, g) => perDay(g, s => s.week, s => [Math.round(s.week / 60), Math.round(s.prevWeek / 60)])), 'vs the 7 days before'),
    tile('Matches played', per(ps => ({ v: num(ps.reduce((n, p) => n + p.matches, 0)) })), 'player-matches finished'),
  ];

  // Connection quality: the typical p50 of the players who reported in the window ("—" without data, or on an older module).
  const pingFig = (ps: Player[], since: number): Fig => {
    if (views.net !== 'on') return undefined;
    const m = medianPing(ps, since);
    return { v: fmtPing(m.ms), cls: m.ms === undefined ? '' : `ping ${pingClass(m.ms)}`, sub: `${num(m.players)} player${m.players === 1 ? '' : 's'}` };
  };
  const netTiles = [
    tile('Median ping 24 h', per(ps => pingFig(ps, now - DAY_MS)), 'typical p50'),
    tile('Median ping 7 d', per(ps => pingFig(ps, now - 7 * DAY_MS)), 'typical p50'),
    tile('Corrections / min', per(ps => { if (views.net !== 'on') return undefined; const c = medianCorrections(ps, now - 7 * DAY_MS); return { v: fmtRate(c.perMin), sub: `${num(c.players)} player${c.players === 1 ? '' : 's'}` }; }), 'median, 7 d'),
  ];

  const shown = playerGroup === 'all' ? players : G[playerGroup];
  const chips = `<div class="chips" role="group" aria-label="Show players">${GROUPS.map(g => `<button type="button" class="chip${g.id === playerGroup ? ' on' : ''}" data-group="${g.id}" aria-pressed="${g.id === playerGroup}">${g.label} <span>${num(G[g.id].length)}</span></button>`).join('')}</div>`;

  body.innerHTML = `
    <nav class="sections" aria-label="Sections">${SECTIONS.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('')}</nav>
    ${sideNote ? `<p class="notice">${sideNote}.</p>` : ''}
    ${group('now', 'Now', 'live', nowTiles, roomCard)}
    ${group('growth', 'Growth', 'new and active players', growthTiles, growthCards)}
    ${group('retention', 'Retention', 'do players come back?', retTiles, retCards)}
    ${group('play', 'Play time', 'online rooms only', playTiles, card('Per day', 'online play time, last 30 days', playChart(today, play)))}
    ${group('connection', 'Connection & devices', 'ping, corrections, what players play on', netTiles, `
      <div class="grid2">${card('Ping', 'median of players\' p50 per UTC day (tick: p95), last 30 days', pingChart(today, G))}${card('Ping by country', 'median typical p50, time zone → country', countryPing(G))}</div>
      ${card('Devices', 'players by the device they last played on online, last 7 days', devicePanel(players, now))}`)}
    ${group('players', 'Players', `${num(shown.length)} · sorted by ${sortLabel()}`, [], `<section class="card">${chips}${playerTable(shown)}</section>`)}
    <footer><p>Updates live. Players are identities that said hello or joined a room; ids are anonymous. <b>Phone</b> and <b>Computer</b> group players by
      the device they last played on online (phones and tablets are Phone); players who never reported a device count only in All, and per-day figures
      use that latest device for every day. Days are UTC days; "the days before" compares with the same number of days just before (today counts in
      the 7 and 30 days, so early in a UTC day they read low). Career numbers come from <code>profile</code>:
      matches counts finished first-to-10 matches, rounds every round played. Play time is online play time only: time spent in an online room
      (lobby time, Solo and Practice are not counted), credited every minute and on leaving. Retention counts the UTC days each player was seen on this
      server; a player who moved to another server counts as gone. Ping is the round trip of a player's movement reports
      as their browser measured it (typical p50: a mean over their reports, weighted by time in rooms; hover for p95), and corrections are the
      server's rejections of their reported movement, per minute in rooms; both are reported every 2 minutes in a match and on leaving.
      Purple flags on the charts are releases to production (hover for what shipped).</p>
      <button type="button" class="btn revoke" id="revoke">Sign out all admins</button></footer>`;
  body.querySelectorAll<HTMLButtonElement>('th button[data-sort]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.sort as typeof sortKey;
    if (sortKey === k) sortDir = sortDir === 1 ? -1 : 1; else { sortKey = k; sortDir = k === 'name' || k === 'country' || k === 'tz' || k === 'deviceName' ? 1 : -1; }
    render();
    body.querySelector<HTMLButtonElement>(`th button[data-sort="${k}"]`)?.focus();
  }));
  body.querySelectorAll<HTMLButtonElement>('.chip[data-group]').forEach(b => b.addEventListener('click', () => {
    playerGroup = b.dataset.group as GroupId; playerLimit = 100;
    render();
    requestAnimationFrame(() => body.querySelector<HTMLButtonElement>(`.chip[data-group="${playerGroup}"]`)?.focus());
  }));
  body.querySelector('#more')?.addEventListener('click', () => { playerLimit += 200; render(); });
  body.querySelector('#revoke')?.addEventListener('click', () => {
    // After rotating the key, or when a device is lost: every browser (this one too) must log in again.
    if (!confirm(`Sign every admin browser out of ${server.name} (${server.database})? Each one will need the admin key again.`)) return;
    store.del(flagKey());
    message = 'Every admin session was signed out.'; messageError = false;
    void conn?.reducers.adminRevokeAll({}).catch(() => undefined);
  });
}

/**
 * A side's cohort table: the pooled figure over every cohort whose day N is over, then the last 14
 * UTC days' cohorts, newest first. A cell's shade grows with its rate; a day in progress is in italics.
 */
function retentionTable(ret: ReturnType<typeof cohorts> | undefined, everyone: number) {
  if (!ret) return `<div class="empty">${views.days === 'missing' ? "— This server's module has no active-days view yet." : 'Loading…'}</div>`;
  if (!ret.rows.length && ret.overall.every(c => !c)) return '<div class="empty">No new players in the last 14 days.</div>';
  const cellOf = (c: Cell | undefined, n: number) => !c ? '<td class="num ret none">·</td>'
    : `<td class="num ret${c.open ? ' open' : ''}" style="--r:${Math.sqrt(c.rate).toFixed(3)}" title="${esc(`${num(c.back)} of ${num(c.players)} back on day ${n}${c.open ? ' so far (that day is today)' : ''}`)}">${fmtRetention(c)}</td>`;
  const head = `<tr><th>First day</th><th class="num">New</th>${RETENTION_DAYS.map(n => `<th class="num">D${n}</th>`).join('')}</tr>`;
  const all = `<tr class="all"><td>All</td><td class="num">${num(everyone)}</td>${ret.overall.map((c, i) => cellOf(c, RETENTION_DAYS[i])).join('')}</tr>`;
  const rows = ret.rows.map(r => `<tr><td>${dateOf(r.day).slice(5)}</td><td class="num">${num(r.size)}</td>${r.cells.map((c, i) => cellOf(c, RETENTION_DAYS[i])).join('')}</tr>`).join('');
  return `<div class="scroll"><table class="cohorts"><thead>${head}</thead><tbody>${all}${rows}</tbody></table></div>
    <p class="table-note">D<i>N</i>: played again exactly N UTC days after their first. "All" pools every cohort whose day N is over; · not reached yet; <i>italics</i>: today, so far.</p>`;
}

const COLUMNS: { key: keyof Player | 'country'; label: string; num?: boolean }[] = [
  { key: 'name', label: 'Name' }, { key: 'lastSeen', label: 'Last seen' }, { key: 'firstSeen', label: 'First seen' },
  { key: 'playTime', label: 'Play time', num: true }, { key: 'sessions', label: 'Sessions', num: true }, { key: 'activeDays', label: 'Days', num: true }, { key: 'rounds', label: 'Rounds', num: true },
  { key: 'matches', label: 'Matches', num: true }, { key: 'kills', label: 'Kills', num: true },
  { key: 'ping', label: 'Ping', num: true }, { key: 'corrPerMin', label: 'Corr/min', num: true }, { key: 'deviceName', label: 'Device' },
  { key: 'country', label: 'Country' }, { key: 'tz', label: 'Time zone' }, { key: 'lang', label: 'Lang' }, { key: 'id', label: 'Id' },
];
const sortLabel = () => `${COLUMNS.find(c => c.key === sortKey)?.label.toLowerCase()}, ${sortDir === 1 ? 'ascending' : 'descending'}`;

function playerTable(players: Player[]) {
  if (!players.length) return '<div class="empty">No players yet.</div>';
  const value = (p: Player): string | number | undefined => sortKey === 'country' ? countryOf(p.tz)
    : sortKey === 'lastSeen' || sortKey === 'firstSeen' ? p[sortKey].toDate().getTime() : (p[sortKey] as string | number | undefined);
  const sorted = [...players].sort((a, b) => {
    const x = value(a), y = value(b);
    // Without a value (no connection report yet): last, whichever the direction.
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sortDir;
  });
  const head = COLUMNS.map(c => {
    const on = c.key === sortKey;
    return `<th class="${c.num ? 'num' : ''}"${on ? ` aria-sort="${sortDir === 1 ? 'ascending' : 'descending'}"` : ''}><button type="button" data-sort="${c.key}" class="${on ? `sorted ${sortDir === 1 ? 'asc' : 'desc'}` : ''}">${c.label}</button></th>`;
  }).join('');
  const rows = sorted.slice(0, playerLimit).map(p => {
    const lastSeen = p.lastSeen.toDate(), firstSeen = p.firstSeen.toDate();
    return `<tr><td>${esc(p.name || '—')}</td><td title="${lastSeen.toISOString()}">${ago(lastSeen)}</td><td title="${firstSeen.toISOString()}">${shortDate(firstSeen)}</td>
      <td class="num"${p.playing ? ' title="In an online room now"' : ''}>${p.playing ? '<i class="dot live" aria-label="In a room now"></i>' : ''}${formatPlayTime(p.playTime)}</td>
      <td class="num">${num(p.sessions)}</td><td class="num"${p.activeDays ? ` title="Active on ${p.activeDays} UTC day${p.activeDays === 1 ? '' : 's'}"` : ''}>${p.activeDays === undefined ? '—' : num(p.activeDays)}</td><td class="num">${num(p.rounds)}</td><td class="num">${num(p.matches)}</td><td class="num">${num(p.kills)}</td>
      ${pingCell(p)}<td class="num">${fmtRate(p.corrPerMin)}</td>${deviceCell(p)}
      <td>${esc(countryOf(p.tz))}</td><td class="tz" title="${esc(p.tz)}">${esc(p.tz || '—')}</td><td>${esc(p.lang || '—')}</td><td class="id">${esc(p.id)}</td></tr>`;
  }).join('');
  const more = sorted.length > playerLimit ? `<button type="button" class="btn more" id="more">Show more (${num(sorted.length - playerLimit)} left)</button>` : '';
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>${more}`;
}

/** A player's typical ping, coloured; the title has p95, the worst p95 and how much was measured. */
function pingCell(p: Player) {
  const n = p.net;
  if (!n) return '<td class="num">—</td>';
  const title = `p50 ${n.pingP50} ms · p95 ${n.pingP95} ms · worst p95 ${n.worstP95} ms · ${n.measuredMinutes} min measured · last ${ago(new Date(n.lastAtMs))}`;
  return `<td class="num" title="${esc(title)}"><span class="ping ${pingClass(n.pingP50)}">${fmtPing(n.pingP50)}</span></td>`;
}

/** A player's device (Phone, Tablet or Computer); the title has the connections per kind and the latest report. */
function deviceCell(p: Player) {
  const d = p.device;
  if (!d || !p.deviceName) return `<td${views.device === 'missing' ? ' title="Not on this server yet"' : ''}>—</td>`;
  return `<td title="${esc(`connections: ${deviceCounts(d)} · last ${ago(new Date(d.lastAtMs))}`)}">${esc(p.deviceName)}</td>`;
}

/**
 * Share of players by the device they last played on: the last 7 days (the big number and the bar)
 * and all time, one block per kind; loading, an older module (—) or no reports yet otherwise.
 */
function devicePanel(players: Player[], now: number) {
  if (views.device !== 'on') return `<div class="empty">${views.device === 'missing' ? "— This server's module has no device view yet." : 'Loading…'}</div>`;
  const since = now - 7 * DAY_MS;
  const week = deviceShare(players, since), ever = deviceShare(players);
  if (!ever.total) return '<div class="empty">No device reports yet.</div>';
  const blocks = week.kinds.map((k, i) => {
    const all = ever.kinds[i];
    return `<div class="device"><small>${k.label}</small><b>${week.total ? fmtShare(k.share) : '—'}</b><span>${num(k.players)} player${k.players === 1 ? '' : 's'}</span>
      <div class="bar"><i style="width:${(k.share * 100).toFixed(1)}%"></i></div><span class="all">All time ${fmtShare(all.share)} · ${num(all.players)}</span></div>`;
  }).join('');
  const active = players.filter(p => p.lastSeen.toDate().getTime() >= since).length;
  return `<div class="devices">${blocks}</div>
    <p class="devices-note">${num(week.total)} of ${num(active)} player${active === 1 ? '' : 's'} active in the last 7 days reported a device (${num(ever.total)} ever); each counts once, by their latest report.</p>`;
}

/** What a connection-quality panel says without data: loading, an older module (—), or nothing reported yet. */
const netEmpty = (none: string, view: 'net' | 'dayNet' = 'net') => `<div class="empty">${views[view] === 'missing' ? "— This server's module has no view for this yet." : views[view] === 'wait' ? 'Loading…' : none}</div>`;

/** The top countries (time zone → country) by players: everyone's count, and the bar split into Phone and Computer. */
function countryList(G: Record<GroupId, Player[]>) {
  const top = countByCountry(G.all.map(p => p.tz)).slice(0, 10);
  if (!top.length) return '<div class="empty">No players yet.</div>';
  const max = Math.max(1, ...top.map(([, n]) => n));
  const of = (s: Side) => new Map(countByCountry(G[s].map(p => p.tz)));
  const phone = of('phone'), computer = of('computer');
  return `<ul class="countries">${top.map(([c, n]) => {
    const p = phone.get(c) ?? 0, k = computer.get(c) ?? 0;
    return `<li>${esc(c)}<span>${num(n)} · ${Math.round((n / G.all.length) * 100)}%</span>
      <div class="bar split" title="${esc(`Phone ${p} · Computer ${k}${n - p - k ? ` · no device ${n - p - k}` : ''}`)}"><i class="g-phone" style="width:${(p / max) * 100}%"></i><i class="g-computer" style="width:${(k / max) * 100}%"></i><i class="g-none" style="width:${((n - p - k) / max) * 100}%"></i></div>
      <small class="sides"><b class="g-phone">Phone ${num(p)}</b><b class="g-computer">Computer ${num(k)}</b></small></li>`;
  }).join('')}</ul><div class="legend"><span><i class="g-phone"></i>Phone</span><span><i class="g-computer"></i>Computer</span><span><i class="g-none"></i>No device report</span></div>`;
}

/** Median typical ping per country for Phone and Computer side by side, countries with the most reporting players first. */
function countryPing(G: Record<GroupId, Player[]>) {
  const rows = pingByCountry(G.all).slice(0, 10);
  if (views.net !== 'on' || !rows.length) return netEmpty('No ping reports yet.');
  const of = (s: Side) => new Map(pingByCountry(G[s]).map(r => [r.country, r]));
  const sides = { phone: of('phone'), computer: of('computer') };
  const cell = (s: Side, country: string) => {
    const r = sides[s].get(country);
    return `<b class="g-${s}">${SIDE_LABEL[s]}</b> ${r ? `<span class="ping ${pingClass(r.ms)}" title="${num(r.players)} player${r.players === 1 ? '' : 's'}">${fmtPing(r.ms)}</span>` : '—'}`;
  };
  return `<ul class="countries">${rows.map(r => `<li>${esc(r.country)}<span>${num(r.players)} player${r.players === 1 ? '' : 's'}</span>
    <small class="sides ping-sides">${SIDES.map(s => `<span>${cell(s, r.country)}</span>`).join('')}</small></li>`).join('')}</ul>`;
}

/**
 * Release flags over a 30-day chart whose first column is `firstDay`: a dashed line down each day
 * with releases and a flag at the top to hover (what shipped, in UTC). Empty when none fall in range.
 */
function releaseMarks(firstDay: number, columns: number, cx: (i: number) => number, top: number, bottom: number) {
  let svg = '';
  for (const [day, list] of releasesByDay(RELEASES, firstDay, firstDay + columns - 1)) {
    const x = cx(day - firstDay), y = top - 9;
    svg += `<g class="release"><line x1="${x}" x2="${x}" y1="${y + 6}" y2="${bottom}"/><path d="M${x - 4.5},${y} L${x + 4.5},${y} L${x},${y + 7} Z"/>`
      + `${list.length > 1 ? `<text x="${x + 6}" y="${y + 6}">${list.length}</text>` : ''}<rect class="hit" x="${x - 7}" y="${y - 3}" width="${list.length > 1 ? 22 : 14}" height="13"/><title>${esc(releaseTitle(day, list))}</title></g>`;
  }
  return svg;
}
/** The legend entry for release flags, when the chart has any. */
const releaseLegend = (firstDay: number, columns: number) => (releasesByDay(RELEASES, firstDay, firstDay + columns - 1).size ? '<span><i class="release"></i>Release</span>' : '');
const sideLegend = (extra = '') => `<span><i class="g-phone"></i>Phone</span><span><i class="g-computer"></i>Computer</span>${extra}`;

/** One side's bar on one day: stacked segments from the bottom (shaded `shades` in order), an optional tick (p95), and its tooltip. */
interface Bar { stack: number[]; tick?: number; title: string }

/**
 * The last 30 UTC days as grouped bars: Phone and Computer side by side each day, on one scale,
 * with release flags. `value` gives a side's bar for a day (undefined: no bar).
 */
function groupedChart(o: { today: number; aria: string; value: (day: number, side: Side) => Bar | undefined; axis: (v: number) => string; counts?: boolean; minMax?: number; shades?: string[]; legend: string; wide?: boolean }) {
  const first = o.today - 29;
  const data = Array.from({ length: 30 }, (_, i) => SIDES.map(s => o.value(first + i, s)));
  // Narrow screens draw a narrower chart, so its labels keep a readable size.
  const narrow = innerWidth < 600;
  const W = narrow ? 360 : o.wide ? 1100 : 600, H = narrow || !o.wide ? 230 : 200, L = 46, R = 8, T = 20, B = 26;
  const max = Math.max(o.minMax ?? 1, ...data.flat().map(b => (b ? Math.max(b.stack.reduce((n, v) => n + v, 0), b.tick ?? 0) : 0)));
  const step = niceStep(max, o.counts), top = Math.ceil(max / step - 1e-9) * step;
  const col = (W - L - R) / data.length, bw = (col * 0.84) / 2;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const cx = (i: number) => L + col * i + col / 2;
  const shades = o.shades ?? ['s0', 's1'];
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria)}">`;
  for (let v = 0; v <= top + 1e-9; v += step) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${o.axis(v)}</text>`;
  data.forEach((bars, i) => {
    bars.forEach((b, j) => {
      if (!b) return;
      const x = L + col * i + col * 0.08 + j * bw, side = SIDES[j];
      let base = 0, g = `<g class="day g-${side}">`;
      b.stack.forEach((v, k) => { g += `<rect class="bar ${shades[k] ?? 's1'}" x="${x}" y="${y(base + v)}" width="${bw}" height="${Math.max(0, y(base) - y(base + v))}"/>`; base += v; });
      if (b.tick !== undefined) g += `<line class="tick" x1="${x - 1}" x2="${x + bw + 1}" y1="${y(b.tick)}" y2="${y(b.tick)}"/>`;
      svg += `${g}<title>${esc(b.title)}</title></g>`;
    });
    const date = dateOf(first + i);
    if (narrow ? i % 7 === 1 : i % 5 === 4 || i === 0) svg += `<text x="${cx(i)}" y="${H - 8}" text-anchor="middle">${date.slice(5)}</text>`;
  });
  svg += releaseMarks(first, 30, cx, T, H - B);
  return `<div class="legend">${o.legend}${releaseLegend(first, 30)}</div><div class="chart">${svg}</svg></div>`;
}

/** Players active per day for each side: returning (seen before that day) under new. */
function playersChart(today: number, G: Record<GroupId, Player[]>) {
  if (views.days !== 'on') return `<div class="empty">${views.days === 'missing' ? "— This server's module has no active-days view yet." : 'Loading…'}</div>`;
  const by = { phone: activeByDay(G.phone, today - 29, today), computer: activeByDay(G.computer, today - 29, today) };
  return groupedChart({
    today, aria: 'Returning and new players per day, Phone and Computer, last 30 days', counts: true,
    value: (day, s) => {
      const r = by[s].get(day);
      return r && r.active ? { stack: [r.active - r.fresh, r.fresh], title: `${dateOf(day)} · ${SIDE_LABEL[s]}: ${r.active} active (${r.active - r.fresh} returning, ${r.fresh} new)` } : undefined;
    },
    axis: v => String(v), legend: sideLegend('<span class="hint">dim: returning · bright: new</span>'),
  });
}

/** Online play time per day for each side (hours, or minutes when no day reaches two); today includes sessions in progress. */
function playChart(today: number, play: Record<GroupId, ReturnType<typeof playStats>>) {
  if (views.dayTime !== 'on') return `<div class="empty">${views.dayTime === 'missing' ? "— This server's module has no per-player play-time view yet." : 'Loading…'}</div>`;
  let maxSeconds = 0;
  for (const s of SIDES) for (let d = today - 29; d <= today; d++) maxSeconds = Math.max(maxSeconds, play[s].byDay?.get(d) ?? 0);
  if (!maxSeconds) return '<div class="empty">No online play time in the last 30 days.</div>';
  const unit = maxSeconds >= 7200 ? 3600 : 60, suffix = unit === 3600 ? 'h' : 'm';
  return groupedChart({
    today, aria: 'Online play time per day, Phone and Computer, last 30 days', wide: true, shades: ['mid'],
    value: (day, s) => {
      const sec = play[s].byDay?.get(day) ?? 0;
      return sec ? { stack: [sec / unit], title: `${dateOf(day)} · ${SIDE_LABEL[s]}: ${hm(sec)}${day === today ? ' (incl. sessions in progress)' : ''}` } : undefined;
    },
    axis: v => (v ? `${Math.round(v * 10) / 10}${suffix}` : '0'), legend: sideLegend(),
  });
}

/** Median p50 per day for each side (bars, a tick at the median p95); days without reports are gaps. */
function pingChart(today: number, G: Record<GroupId, Player[]>) {
  if (views.dayNet !== 'on') return netEmpty('', 'dayNet');
  const by = { phone: pingByDay(G.phone.map(p => p.dayNet)), computer: pingByDay(G.computer.map(p => p.dayNet)) };
  let any = false;
  for (const s of SIDES) for (const d of by[s].keys()) if (d > today - 30) any = true;
  if (!any) return netEmpty('No ping reports in the last 30 days.', 'dayNet');
  return groupedChart({
    today, aria: 'Median ping per day, Phone and Computer, last 30 days', minMax: 80, shades: ['mid'],
    value: (day, s) => {
      const r = by[s].get(day);
      return r ? { stack: [r.p50], tick: r.p95, title: `${dateOf(day)} · ${SIDE_LABEL[s]}: median p50 ${r.p50} ms, p95 ${r.p95} ms · ${r.players} player${r.players === 1 ? '' : 's'} · ${fmtRate(r.correctionsPerMin)} corrections/min` } : undefined;
    },
    axis: v => (v ? `${v} ms` : '0'), legend: sideLegend('<span><i class="line"></i>p95</span>'),
  });
}

// ---- Wiring ------------------------------------------------------------------------------

let frame = 0;
function render() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const p = driver.state.phase;
    renderConn();
    if (conn && isAdmin()) { logoutBtn.hidden = false; dashboard(); return; }
    logoutBtn.hidden = true;
    if (p === 'waking' || p === 'unreachable') { wakeCard(); return; }
    // Remembered as logged in, but the server says no (revoked, or a new key): back to the login.
    if (conn && status() && store.get(flagKey())) store.del(flagKey());
    if (!conn && p !== 'ready') { body.innerHTML = `<div class="empty">Connecting to ${esc(server.name)}…</div>`; return; }
    renderLogin();
  });
}

/** The header's dot: connected, connecting or waking (amber), or not reachable. */
function renderConn() {
  const p = driver.state.phase;
  if (p === 'ready') setConn(conn ? 'live' : 'off', conn ? 'Connected' : 'Connected, but this database has no admin views');
  else if (p === 'probing') setConn('wait', 'Connecting');
  else if (p === 'waking') setConn('wait', 'Waking the server');
  else setConn('off', p === 'unreachable' ? "Can't reach the server" : 'Not connected');
}

/**
 * While the server boots: it is asleep (not down), the time so far and a bar. After 3 minutes:
 * "Can't reach" with Retry. Redrawn whole only when that changes; the timer ticks in place.
 */
let wakeShown = '';
function wakeCard() {
  const s = driver.state, down = s.phase === 'unreachable';
  const key = `${s.phase}|${server.id}`;
  if (wakeShown !== key || !body.querySelector('.wake')) {
    wakeShown = key;
    body.innerHTML = down
      ? `<section class="wake down"><h2><i class="dot off"></i>Can't reach the server</h2>
          <p role="status">It did not wake up within 3 minutes. Check the server on InstaCloud, or try again.</p>
          <button type="button" class="btn primary" id="wake-retry">Retry</button></section>`
      : `<section class="wake"><h2><i class="dot wait"></i>Waking the server</h2>
          <p role="status">The server is asleep to save costs — waking it up (about 30 s). Opening this page woke it.</p>
          <p class="note" id="wake-note"></p>
          <div class="wake-meter" aria-hidden="true"><span class="wake-bar"><i id="wake-fill"></i></span><span class="wake-time" id="wake-time"></span></div></section>`;
    body.querySelector('#wake-retry')?.addEventListener('click', () => driver.retry());
  }
  if (down) return;
  const secs = wakeSeconds(s, performance.now());
  body.querySelector<HTMLElement>('#wake-fill')!.style.width = `${(wakeProgress(secs * 1000) * 100).toFixed(1)}%`;
  body.querySelector('#wake-time')!.textContent = `${secs} s`;
  const note = s.hostUp ? 'Almost there: the machine is up and loading the database.' : secs >= 60 ? 'Taking a little longer than usual — still trying.' : '';
  const noteEl = body.querySelector<HTMLElement>('#wake-note')!;
  if (noteEl.textContent !== note) noteEl.textContent = note;
  noteEl.hidden = !note;
}

logoutBtn.addEventListener('click', () => {
  store.del(flagKey());
  message = 'Logged out.'; messageError = false;
  void conn?.reducers.adminLogout({}).catch(() => undefined).finally(render);
});

/**
 * One connection to a server's admin views (the wake driver retries and says when it is waking).
 * `live` once the views have arrived, or once the server answered but has no admin views (an older
 * module: there is nothing to retry, the login form says so).
 */
function adminLink(s: AdminServer, lost: () => void): WakeLink {
  const key = `lawbreaker.admin.token:${s.uri}:${s.database}`;
  let c: DbConnection | undefined, stopped = false, isLive = false, ended = false;
  let settle: { resolve(): void; reject(error: Error): void } = { resolve() {}, reject() {} };
  const live = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
  live.catch(() => undefined);
  const stop = () => { stopped = true; if (c && conn === c) conn = undefined; try { c?.disconnect(); } catch { /* already closed */ } };
  const end = (error: Error) => {
    if (ended || stopped) return;
    ended = true;
    stop();
    if (isLive) { lost(); render(); } else settle.reject(error);
  };
  c = DbConnection.builder().withUri(s.uri).withDatabaseName(s.database).withToken(store.get(key) ?? undefined)
    .onConnect((cc, _identity, token) => {
      if (stopped) { cc.disconnect(); return; }
      store.set(key, token);
      for (const t of [
        cc.db.adminStatus, cc.db.adminOverview, cc.db.adminRooms, cc.db.adminPlayers, cc.db.adminPlayerTime, cc.db.adminDailyTime, cc.db.adminPlayerNet,
        cc.db.adminPlayerDevice, cc.db.adminPlayerDay, cc.db.adminPlayerDayTime, cc.db.adminPlayerDayNet,
      ]) {
        t.onInsert(render); t.onDelete(render);
      }
      // The newer views on their own subscriptions (see OPTIONAL).
      views = freshViews();
      for (const [name, queries] of Object.entries(OPTIONAL) as [keyof typeof OPTIONAL, string[]][]) {
        cc.subscriptionBuilder()
          .onApplied(() => { if (!stopped) { views[name] = 'on'; render(); } })
          .onError(() => { if (!stopped) { views[name] = 'missing'; render(); } })
          .subscribe(queries);
      }
      cc.subscriptionBuilder()
        .onApplied(() => { if (stopped) return; isLive = true; conn = cc; message = ''; settle.resolve(); render(); })
        .onError(() => {
          if (stopped) return;
          isLive = true; messageError = true; message = 'This database has no admin views yet (publish the module first).';
          settle.resolve(); render();
        })
        .subscribe(['SELECT * FROM admin_status', 'SELECT * FROM admin_overview', 'SELECT * FROM admin_rooms', 'SELECT * FROM admin_players',
          'SELECT * FROM admin_player_time', 'SELECT * FROM admin_daily_time']);
    })
    // A socket that fails before the handshake reports an error and then a close: `end` keeps the first.
    .onConnectError((_ctx, error) => end(error ?? new Error('Connection failed.')))
    .onDisconnect(() => end(new Error('Disconnected.')))
    .build();
  return { live, stop };
}

function makeDriver() {
  const ping = pingUrl(server.uri);
  const s = server;
  return new WakeDriver<never>({
    ping: signal => ping ? hostAnswers(ping, signal) : Promise.resolve(false),
    connect: lost => adminLink(s, lost),
  }, () => render(), () => undefined);
}
let driver = makeDriver();

/** Show another server: drop this connection, remember the choice, connect (and wake) the other. */
function switchServer(next: AdminServer) {
  if (next.id === server.id) return;
  driver.stop();
  conn = undefined; loggingIn = false; message = ''; messageError = true; playerLimit = 100; views = freshViews();
  server = next;
  rememberServer(server, storage);
  renderServer();
  driver = makeDriver();
  driver.start();
  render();
}
serverSelect.addEventListener('change', () => { const next = SERVERS.find(s => s.id === serverSelect.value); if (next) switchServer(next); });

renderServer();
driver.start();
render();
// Relative times ("3 min ago") and today's counts move on without new data.
setInterval(() => { if (conn && isAdmin() && !document.hidden && !body.contains(document.activeElement)) render(); }, 30_000);
addEventListener('resize', () => { if (conn && isAdmin()) render(); });
