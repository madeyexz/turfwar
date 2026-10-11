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
import type AdminPeakHourRow from '../module_bindings/admin_peak_hour_table';
import type AdminPlayerPerfRow from '../module_bindings/admin_player_perf_table';
import type AdminPlayerSourceRow from '../module_bindings/admin_player_source_table';
import type AdminPlayerMilestoneRow from '../module_bindings/admin_player_milestone_table';
import type AdminRoomHourRow from '../module_bindings/admin_room_hour_table';
import { countByCountry, countryOf } from '../../shared/tzcountry';
import { fmtPing, fmtRate, medianCorrections, medianPing, pingByCountry, pingClass, type NetOf } from './net';
import { deviceCounts, deviceLabel, deviceShare, fmtShare, type DeviceOf } from './devices';
import { activeBetween, cameBack, change, cohorts, daysById, firstDayOf, fmtRetention, newBetween, RETENTION_DAYS, type Cell } from './retention';
import { releasesByDay, releaseTitle, type Release } from './releases';
import { peakBetween, peakFor, peaksBy, type PeakOf } from './peak';
import { averageDaily, BEGONE_EVIDENCE, BEGONE_FUNNEL, BEGONE_TAIWAN, LAUNCH_PEAKS, versus } from './benchmarks';
import { activeByDay, GROUPS, niceStep, pingByDay, sideOf, SIDES, splitBySide, sumByDay, type DayNet as DayNetOf, type GroupId, type Side } from './groups';
import { formatPlayTime, liveSeconds } from '../../shared/playtime';
import { channelOf } from '../../shared/metrics';
import {
  activation, channels, dayN, firstsSince, grade, minutesPerActiveDay, pct, quality, qualityByBrowser, roomHealth, roomHealthBy, roundBuckets, secs,
  TARGETS, virality, worse, worstStep, CORE_ROUNDS, type FirstsOf, type PerfOf, type RoomHourOf, type SourceOf, type Status, type Step,
} from './growth';
import { hostAnswers, pingUrl, serverIdentityKey } from '../net/ping';
import { ConnectDriver, type ConnectLink } from '../net/connect';
import { adminServers, chosenServer, regionName, rememberServer, type AdminServer } from './servers';
import './admin.css';

/**
 * The owner's dashboard at /admin (not linked from the game, not indexed). It holds no secrets:
 * the owner types the admin key once, `admin_login` checks its hash inside the module and marks this
 * browser's SpacetimeDB identity as an admin, and the `admin_*` views then stream the data (they
 * return nothing to anyone else). Only "this browser is logged in" is remembered, never the key.
 *
 * A switcher picks the server (src/admin/servers.ts): the build's own (production: the Taipei
 * server) or the others that stay published (legacy Maincloud production, dev). Each has its own
 * admin table, so the login, the identity and the "logged in" flag are per server.
 * (Singapore's server was retired on 2026-10-11 and is no longer listed.)
 */
type Room = Infer<typeof AdminRoomsRow>;
type Overview = Infer<typeof AdminOverviewRow>;
type PlayerTime = Infer<typeof AdminPlayerTimeRow>;
type DayTime = Infer<typeof AdminDailyTimeRow>;
type PlayerNet = Infer<typeof AdminPlayerNetRow>;
type PlayerDevice = Infer<typeof AdminPlayerDeviceRow>;
type PlayerDay = Infer<typeof AdminPlayerDayRow>;
type PeakHour = Infer<typeof AdminPeakHourRow>;
type PlayerPerf = Infer<typeof AdminPlayerPerfRow>;
type PlayerSource = Infer<typeof AdminPlayerSourceRow>;
type PlayerFirsts = Infer<typeof AdminPlayerMilestoneRow>;
type RoomHour = Infer<typeof AdminRoomHourRow>;
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
  /** The hour first seen (hours since the epoch) and each active hour's play time and connection (`admin_player_hour`). */
  firstHour: number; hours?: Map<number, HourOf>;
  /** First seen (ms); firsts (`admin_player_milestone`), visit (`admin_player_source`) and frame rate (`admin_player_perf`), if reported. */
  firstSeenMs: number; firsts?: FirstsOf; src?: SourceOf; perf?: PerfOf;
  /** For the table: the channel they came through and their typical frame rate. */
  channel?: string; fps?: number;
};
/** A player's hour: play time, mean p50 and p95 (with `netSeconds` measured), corrections. */
interface HourOf { seconds: number; p50: number; p95: number; netSeconds: number; corrections: number }

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
const HOUR_MS = 3_600_000;
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
  errors: ['SELECT * FROM admin_errors'],
  net: ['SELECT * FROM admin_player_net'],
  device: ['SELECT * FROM admin_player_device'],
  days: ['SELECT * FROM admin_player_day'],
  dayTime: ['SELECT * FROM admin_player_day_time'],
  dayNet: ['SELECT * FROM admin_player_day_net'],
  hours: ['SELECT * FROM admin_player_hour'],
  peak: ['SELECT * FROM admin_peak_hour'],
  perf: ['SELECT * FROM admin_player_perf'],
  source: ['SELECT * FROM admin_player_source'],
  firsts: ['SELECT * FROM admin_player_milestone'],
  roomHours: ['SELECT * FROM admin_room_hour'],
};
type ViewState = 'wait' | 'on' | 'missing';
const freshViews = (): Record<keyof typeof OPTIONAL, ViewState> => ({ errors: 'wait', net: 'wait', device: 'wait', days: 'wait', dayTime: 'wait', dayNet: 'wait', hours: 'wait', peak: 'wait', perf: 'wait', source: 'wait', firsts: 'wait', roomHours: 'wait' });
let views = freshViews();
/** Which players the list shows. */
let playerGroup: GroupId = 'all';
/**
 * How the charts show time and players (remembered in this browser): the last 30 or 7 UTC days, or
 * the last 48 hours; Phone and Computer side by side, or everyone combined in one bar.
 */
type Range = '30d' | '7d' | '48h';
const RANGES: { id: Range; label: string }[] = [{ id: '30d', label: '30 d' }, { id: '7d', label: '7 d' }, { id: '48h', label: '48 h' }];
const CHART_KEY = 'turfwar.admin.charts';
let charts: { range: Range; combined: boolean } = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(CHART_KEY) ?? '{}') as { range?: string; combined?: boolean };
    return { range: RANGES.some(r => r.id === v.range) ? v.range as Range : '30d', combined: v.combined === true };
  } catch { return { range: '30d', combined: false }; }
})();
const saveCharts = () => { try { localStorage.setItem(CHART_KEY, JSON.stringify(charts)); } catch { /* storage disabled */ } };
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
  const hours = new Map<string, Map<number, HourOf>>();
  if (views.hours === 'on') for (const r of db.adminPlayerHour.iter()) {
    let m = hours.get(r.id);
    if (!m) hours.set(r.id, (m = new Map()));
    m.set(r.hour, { seconds: r.seconds, p50: r.p50, p95: r.p95, netSeconds: r.netSeconds, corrections: r.corrections });
  }
  const perfs = new Map<string, PlayerPerf>();
  if (views.perf === 'on') for (const r of db.adminPlayerPerf.iter()) perfs.set(r.id, r);
  const sources = new Map<string, PlayerSource>();
  if (views.source === 'on') for (const r of db.adminPlayerSource.iter()) sources.set(r.id, r);
  const firsts = new Map<string, PlayerFirsts>();
  if (views.firsts === 'on') for (const r of db.adminPlayerMilestone.iter()) firsts.set(r.id, r);
  const ms = (micros: bigint) => (micros > 1n ? Number(micros / 1000n) : Number(micros));
  const nowMicros = BigInt(Date.now()) * 1000n;
  return [...db.adminPlayers.iter()].map(p => {
    const f = firsts.get(p.id), s = sources.get(p.id), pf = perfs.get(p.id);
    const src: SourceOf | undefined = s && { source: s.source, medium: s.medium, campaign: s.campaign, inApp: s.inApp, referred: s.referred, shares: s.shares, duels: s.duels, invited: s.invited, invitedPlayed: s.invitedPlayed };
    const perf: PerfOf | undefined = pf && { fps: pf.fps, low: pf.low, seconds: pf.seconds, waitMs: pf.waitMs, waits: pf.waits, bootMs: pf.bootMs, boots: pf.boots, lastAtMs: pf.lastAt.toDate().getTime() };
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
      firstHour: Math.floor(p.firstSeen.toDate().getTime() / HOUR_MS), hours: hours.get(p.id),
      firstSeenMs: p.firstSeen.toDate().getTime(), firsts: f && { room: ms(f.room), round: ms(f.round), kill: ms(f.kill), match: ms(f.match) }, src, perf,
      channel: src ? channelOf(src) : undefined, fps: perf && perf.seconds > 0 ? perf.fps : undefined,
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

/** A figure for everyone only (rooms are not split by device). */
function tile1(label: string, f: Fig, note = '', hero = false) {
  const d = f?.delta && change(f.delta[0], f.delta[1]);
  const delta = d ? `<em class="delta ${d.dir}">${d.text}</em>` : '';
  return `<div class="tile one${hero ? ' hero' : ''}"><small>${label}</small><b${f?.cls ? ` class="${f.cls}"` : ''}${f?.title ? ` title="${esc(f.title)}"` : ''}>${f ? f.v : '—'}</b>${delta || f?.sub ? `<span>${[delta, f?.sub ?? ''].filter(Boolean).join(' ')}</span>` : ''}${note ? `<span class="note">${note}</span>` : ''}</div>`;
}

/** One section of the dashboard: a heading the nav links to, its figures, then its cards. */
const group = (id: string, title: string, sub: string, tiles: string[], cards: string) => `
  <section class="group" id="${id}" aria-labelledby="${id}-h"><h2 class="group-h" id="${id}-h">${title}<small>${sub}</small></h2>
    ${tiles.length ? `<div class="tiles">${tiles.join('')}</div>` : ''}${cards}</section>`;
const card = (title: string, sub: string, content: string, cls = '') => `<section class="card${cls ? ` ${cls}` : ''}"><h3>${title} <small>${sub}</small></h3>${content}</section>`;
const SECTIONS: [string, string][] = [
  ['scorecard', 'Score'], ['now', 'Now'], ['growth', 'Acquisition'], ['activation', 'Activation'], ['retention', 'Retention'], ['play', 'Engagement'],
  ['virality', 'Virality'], ['health', 'Health'], ['errors', 'Errors'], ['connection', 'Quality'], ['benchmarks', 'Benchmarks'], ['players', 'Players'],
];
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
  const peaks = peakRows();
  const hasDays = views.days === 'on';
  const sideNote = views.device === 'missing' ? 'Phone and Computer need the device view, which this server lacks' : '';

  // Now: who is playing at this moment.
  const nowTiles = [
    tile('Online now', per((ps, g) => ({ v: num(g === 'all' ? o?.onlineNow ?? 0 : ps.filter(p => p.playing).length) })), 'players in rooms', true),
    tile('Active 24 h', per(ps => ({ v: num(ps.filter(p => last(p) >= now - DAY_MS).length) })), 'seen in the last 24 hours'),
    tile('Peak today', per((_ps, g) => peakFig(peakBetween(peaks, today * 24, today * 24 + 23), g, 'time')), 'most in rooms at once, UTC day'),
    tile('Peak 7 d', per((_ps, g) => {
      const cur = peakBetween(peaks, (today - 6) * 24, today * 24 + 23), prev = peakBetween(peaks, (today - 13) * 24, (today - 6) * 24 - 1);
      const fig = peakFig(cur, g, 'date');
      return fig && cur && prev ? { ...fig, delta: [peakFor(cur, g), peakFor(prev, g)] } : fig;
    }), 'vs the 7 days before'),
    tile('Peak ever', per((_ps, g) => peakFig(peakBetween(peaks, 0, Infinity), g, 'date')), 'since peaks were recorded'),
  ];
  const roomRows = rooms.map(r => `<tr><td>${r.code ? `<span class="tag">#${esc(r.code)}</span>` : '<span class="tag">public</span>'}</td><td>${esc(titleCase(r.mapId))}</td><td>${esc(titleCase(r.mode))}</td>
    <td>${r.size}v${r.size}</td><td class="num">${r.humans}</td><td class="num">${r.bots}</td><td class="num">${r.round}</td><td><span class="tag${r.phase === 'live' ? ' live' : ''}">${esc(r.phase)}</span></td></tr>`).join('');
  const peakCard = card('Peak online', `most players in rooms at once ${rangeText()}`, peakChart(G));
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
    tile('Active 30 d', per(ps => {
      if (!hasDays) return { v: num(ps.filter(p => last(p) >= now - 30 * DAY_MS).length) };
      const n = activeBetween(ps, today - 29, today);
      return { v: num(n), delta: [n, activeBetween(ps, today - 59, today - 30)] };
    }), `MAU${hasDays ? ' · vs the 30 days before' : ''}`),
  ];
  const growthCards = `<div class="grid2">${card('New and returning', `players active ${rangeText()}`, playersChart(G))}${card('Where from', 'time zone → country, estimate', countryList(G))}</div>`;

  // Retention: who came back (needs the active-days view).
  const ret = hasDays ? { phone: cohorts(G.phone, today), computer: cohorts(G.computer, today), all: cohorts(G.all, today) } : undefined;
  const retFig = (c: Cell | undefined): Fig => (!hasDays ? undefined : { v: fmtRetention(c), sub: c ? `${num(c.back)} of ${num(c.players)}` : 'not yet' });
  const retTiles = [
    tile('Came back', per(ps => retFig(hasDays ? cameBack(ps, today) : undefined)), 'played again on a later day', true),
    ...([1, 7, 30] as const).map(n => tile(`Day ${n}`, per((_ps, g) => retFig(ret?.[g].overall[RETENTION_DAYS.indexOf(n)])), `back exactly ${n} day${n === 1 ? '' : 's'} after their first`)),
  ];
  // Combined (the charts' switch): one table for everyone; split: Phone and Computer side by side.
  const retCards = charts.combined
    ? card('Cohorts', 'all players · share of each UTC day\'s new players back exactly N days later', retentionTable(ret?.all, G.all.length))
    : `<div class="grid2 even">${SIDES.map(s => card(`${SIDE_LABEL[s]} cohorts`, 'share of each UTC day\'s new players back exactly N days later', retentionTable(ret?.[s], G[s].length))).join('')}</div>`;

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

  // The growth stages (src/admin/growth.ts): each section's headline figures, graded against its target.
  const g = growthFigures(G, now, today);

  const shown = playerGroup === 'all' ? players : G[playerGroup];
  const chips = `<div class="chips" role="group" aria-label="Show players">${GROUPS.map(g => `<button type="button" class="chip${g.id === playerGroup ? ' on' : ''}" data-group="${g.id}" aria-pressed="${g.id === playerGroup}">${g.label} <span>${num(G[g.id].length)}</span></button>`).join('')}</div>`;

  body.innerHTML = `
    <nav class="sections" aria-label="Sections"><div class="nav-links">${SECTIONS.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('')}</div>
      <div class="chart-controls"><span>Charts</span>
        <div class="seg" role="group" aria-label="Chart range">${RANGES.map(r => `<button type="button" data-range="${r.id}" aria-pressed="${charts.range === r.id}">${r.label}</button>`).join('')}</div>
        <div class="seg" role="group" aria-label="Chart groups"><button type="button" data-combined="0" aria-pressed="${!charts.combined}">Split</button><button type="button" data-combined="1" aria-pressed="${charts.combined}">Combined</button></div>
      </div></nav>
    ${sideNote ? `<p class="notice">${sideNote}.</p>` : ''}
    ${scorecard(g)}
    ${group('now', 'Now', 'live', nowTiles, roomCard + peakCard)}
    ${group('growth', 'Acquisition', 'where new players come from, and which channels bring players who stay', growthTiles, growthCards + card('Channels', 'new players in the last 30 days by in-app browser or first-touch source', channelTable(G.all, now)))}
    ${group('activation', 'Activation', 'how far a new player gets in their first 24 hours', g.activationTiles, activationCard(g))}
    ${group('retention', 'Retention', 'do players come back?', retTiles, retCards + card('Who comes back', 'D1 and D7 by device and channel, new players of the last 30 days', retentionBySegment(G, today)))}
    ${group('play', 'Engagement', 'how much they play, and how big the core is', [...playTiles, ...g.engagementTiles], `<div class="grid2">${card('Over time', `online play time ${rangeText()}`, playChart(G))}${card('Players by rounds played', `career rounds; ${CORE_ROUNDS}+ is the core`, roundsPanel(G.all))}</div>`)}
    ${group('virality', 'Virality', 'do players bring players?', g.viralityTiles, viralityCard(G.all))}
    ${group('health', 'Server health', 'do rooms feel alive, and do connections hold?', g.healthTiles, card('Rooms', `human share of seats (bars) and drops per join (tick) ${rangeText()}`, healthChart()))}
    ${group('errors', 'Errors', 'latest 200 host reports; raw logs stay on the VM', [], card('Server errors', 'requires the optional host watcher', views.errors !== 'on' ? '<p>Error view unavailable on this module.</p>' : [...db.adminErrors.iter()].length === 0 ? '<p>No reports. This does not confirm that the watcher is active.</p>' : `<table><thead><tr><th>Time</th><th>Source</th><th>Message</th></tr></thead><tbody>${[...db.adminErrors.iter()].sort((a, b) => a.id > b.id ? -1 : 1).map(e => `<tr><td>${esc(e.at.toDate().toISOString())}</td><td>${esc(e.reducer)}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody></table>`))}
    ${group('connection', 'Quality', 'frame rate, load times, ping, what players play on', [...g.qualityTiles, ...netTiles], `
      <div class="grid2 even">${card('Frame rate', 'players by their typical fps, last 7 days', fpsPanel(G, now))}${card('By browser', 'in-app browsers against plain browsers, last 7 days, slowest first', browserTable(G.all, now))}</div>
      <div class="grid2">${card('Ping', `median of players' p50 (tick: p95) ${rangeText()}`, pingChart(G))}${card('Ping by country', 'median typical p50, time zone → country', countryPing(G))}</div>
      ${card('Devices', 'players by the device they last played on online, last 7 days', devicePanel(players, now))}`)}
    ${group('benchmarks', 'Benchmarks', 'BeGone (nplay) in Taiwan at its peak, estimated', [], benchmarks(G.all, peaks, today))}
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
      Growth stages (Scorecard, Activation, Virality, Server health, frame rate) come from tables added on 2026-10-11 and fill in from then on:
      firsts count within 24 hours of a player's first connection; channels are the in-app browser, else the first UTM source or referrer;
      the K-factor counts players who arrived through a share code and entered a room; drops are connections that closed in a room.
      Purple flags on the charts are releases to production (hover for what shipped).</p>
      <button type="button" class="btn revoke" id="revoke">Sign out all admins</button></footer>`;
  body.querySelectorAll<HTMLButtonElement>('th button[data-sort]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.sort as typeof sortKey;
    if (sortKey === k) sortDir = sortDir === 1 ? -1 : 1; else { sortKey = k; sortDir = k === 'name' || k === 'country' || k === 'tz' || k === 'deviceName' || k === 'channel' ? 1 : -1; }
    render();
    body.querySelector<HTMLButtonElement>(`th button[data-sort="${k}"]`)?.focus();
  }));
  body.querySelectorAll<HTMLButtonElement>('.chip[data-group]').forEach(b => b.addEventListener('click', () => {
    playerGroup = b.dataset.group as GroupId; playerLimit = 100;
    render();
    requestAnimationFrame(() => body.querySelector<HTMLButtonElement>(`.chip[data-group="${playerGroup}"]`)?.focus());
  }));
  body.querySelectorAll<HTMLButtonElement>('.chart-controls button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.range) charts.range = b.dataset.range as Range;
    if (b.dataset.combined) charts.combined = b.dataset.combined === '1';
    saveCharts();
    render();
    const sel = b.dataset.range ? `[data-range="${b.dataset.range}"]` : `[data-combined="${b.dataset.combined}"]`;
    requestAnimationFrame(() => body.querySelector<HTMLButtonElement>(`.chart-controls button${sel}`)?.focus());
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

// ---- Growth stages (src/admin/growth.ts) ----------------------------------------------------

const STATUS_LABEL: Record<Status, string> = { good: 'On track', watch: 'Watch', bad: 'Problem', none: 'No data yet' };
/** A figure coloured by how it stands against its target. */
const graded = (v: string, status: Status, sub?: string, title?: string): NonNullable<Fig> => ({ v, cls: `st st-${status}`, sub, title });
/** The views a figure needs: "—" (undefined) while any is loading or missing. */
const have = (...need: (keyof typeof OPTIONAL)[]) => need.every(v => views[v] === 'on');
const WEEK = 7 * DAY_MS;

/** One stage on the scorecard. */
interface Stage { id: string; name: string; question: string; value: string; status: Status; target: string; split?: string; action: string }

/**
 * Every stage's headline figure (All, Phone, Computer), its tiles, and the scorecard entry: the value,
 * the target, how it stands and what to look at when it is off.
 */
function growthFigures(G: Record<GroupId, Player[]>, now: number, today: number) {
  const since = firstsSince(G.all);
  const per = (f: (ps: Player[], g: GroupId) => Fig) => GROUPS.map(g => f(G[g.id], g.id));
  const split = (f: (ps: Player[]) => string) => `Phone ${f(G.phone)} · Computer ${f(G.computer)}`;
  const stages: Stage[] = [];

  // Acquisition: new players this week against last week.
  const newIn = (ps: Player[], from: number, to: number) => ps.filter(p => p.firstDay >= from && p.firstDay <= to).length;
  const n7 = newIn(G.all, today - 6, today), p7 = newIn(G.all, today - 13, today - 7);
  const growth = p7 ? n7 / p7 - 1 : undefined;
  const top = channels(G.all, today - 29, now)[0];
  stages.push({
    id: 'growth', name: 'Acquisition', question: 'Are new players arriving?', value: num(n7), status: grade(growth, TARGETS.growth),
    target: `new players in 7 d${growth === undefined ? '' : ` · ${growth >= 0 ? '+' : '−'}${Math.round(Math.abs(growth) * 100)}% vs the week before`}`,
    split: top ? `Top channel (30 d): ${top.channel}, ${pct(top.share)} of new` : undefined,
    action: 'Fewer new players: post again where the Channels table shows players who stay (activated and D1), not just the most visits.',
  });

  // Activation: a kill in the first 24 hours.
  const act = (ps: Player[]) => activation(ps, now - 15 * DAY_MS, now, now, since);
  const killRate = (ps: Player[]) => { const a = act(ps); return a.cohort ? a.steps.find(s => s.key === 'kill')!.rate : undefined; };
  const all = act(G.all), worst = worstStep(all.steps);
  stages.push({
    id: 'activation', name: 'Activation', question: 'Do new players get into the fight?', value: have('firsts') ? pct(killRate(G.all)) : '—',
    status: have('firsts') ? grade(killRate(G.all), TARGETS.activation) : 'none', target: `made a kill within 24 h · target ${pct(TARGETS.activation.good)}`,
    split: have('firsts') ? split(ps => pct(killRate(ps))) : undefined,
    action: worst ? `Biggest leak: “${worst.label}” keeps only ${pct(worst.fromPrev)} of the step before. ${worst.fix}` : 'Waiting for new players since firsts were recorded.',
  });
  const activationTiles = [
    tile('New players', per(ps => have('firsts') ? { v: num(act(ps).cohort), sub: 'first seen 1–15 days ago' } : undefined), since ? `since ${dateOf(Math.floor(since / DAY_MS))}, when firsts began` : 'firsts not recorded yet'),
    ...(['room', 'round', 'kill', 'match'] as const).map(k => tile(all.steps.find(s => s.key === k)!.label, per(ps => {
      if (!have('firsts')) return undefined;
      const a = act(ps), st = a.steps.find(s => s.key === k)!;
      return a.cohort ? (k === 'kill' ? graded(pct(st.rate), grade(st.rate, TARGETS.activation), `${num(st.n)} of ${num(a.cohort)}`) : { v: pct(st.rate), sub: `${num(st.n)} of ${num(a.cohort)}` }) : { v: '—' };
    }), 'within 24 h of connecting', k === 'kill')),
  ];

  // Retention: day 1 (day 7 alongside).
  const d1 = (ps: Player[]) => dayN(ps.filter(p => p.firstDay >= today - 30), 1, today)?.rate;
  const d7 = (ps: Player[]) => dayN(ps.filter(p => p.firstDay >= today - 37), 7, today)?.rate;
  stages.push({
    id: 'retention', name: 'Retention', question: 'Do they come back?', value: have('days') ? pct(d1(G.all)) : '—',
    status: have('days') ? worse(grade(d1(G.all), TARGETS.d1), grade(d7(G.all), TARGETS.d7)) : 'none',
    target: `D1 (target ${pct(TARGETS.d1.good)}) · D7 ${pct(d7(G.all))} (target ${pct(TARGETS.d7.good)})`, split: have('days') ? split(ps => pct(d1(ps))) : undefined,
    action: 'Find the segment that does not return in “Who comes back” (an in-app browser, phones) and fix that first; then give a reason to return (a daily goal, friends).',
  });

  // Engagement: minutes per player per active day, last 7 days.
  const mins = (ps: Player[]) => (have('dayTime') ? minutesPerActiveDay(ps, today - 6, today) : undefined);
  const rb = roundBuckets(G.all);
  stages.push({
    id: 'play', name: 'Engagement', question: 'Do they play long?', value: mins(G.all) === undefined ? '—' : `${Math.round(mins(G.all)!)} min`,
    status: grade(mins(G.all), TARGETS.minutes), target: `online minutes per player per active day, 7 d · target ${TARGETS.minutes.good}`,
    split: `Core (${CORE_ROUNDS}+ rounds): ${num(rb.core.players)} players play ${pct(rb.core.roundShare)} of rounds`,
    action: 'Short days: check where matches end early (PostHog match_left by rounds_played) and whether the core group grows week to week.',
  });
  const engagementTiles = [
    tile('Min / active day', per(ps => { const m = mins(ps); return m === undefined ? undefined : graded(`${Math.round(m)} min`, grade(m, TARGETS.minutes)); }), 'online, per player per day played, 7 d'),
    tile(`Core (${CORE_ROUNDS}+ rounds)`, per(ps => { const r = roundBuckets(ps); return { v: num(r.core.players), sub: `${pct(r.core.playerShare)} of players · ${pct(r.core.roundShare)} of rounds` }; }), 'career rounds'),
  ];

  // Virality: the K-factor.
  const vir = (ps: Player[]) => virality(ps);
  const v = vir(G.all);
  stages.push({
    id: 'virality', name: 'Virality', question: 'Do players bring players?', value: have('source') && v.k !== undefined ? v.k.toFixed(2) : '—',
    status: have('source') ? grade(v.k, TARGETS.k) : 'none', target: `K-factor: new players a share brought, per player · target ${TARGETS.k.good}`,
    split: have('source') ? `${num(v.sharers)} sharers sent ${num(v.invites)} invites; ${num(v.broughtPlayed)} became players` : undefined,
    action: 'Few invites, or invites that do not turn into players: make 約朋友單挑 the obvious end-screen action, and check the challenge link opens straight into a match.',
  });
  const viralityTiles = [
    tile('K-factor', per(ps => { if (!have('source')) return undefined; const x = vir(ps); return x.k === undefined ? { v: '—' } : graded(x.k.toFixed(2), grade(x.k, TARGETS.k), `${num(x.broughtPlayed)} of ${num(x.reporting)}`); }), 'new players brought per player', true),
    tile('Sharers', per(ps => { if (!have('source')) return undefined; const x = vir(ps); return { v: num(x.sharers), sub: pct(x.sharerShare) + ' of players' }; }), 'sent a card or opened a duel'),
    tile('Invites / sharer', per(ps => { if (!have('source')) return undefined; const x = vir(ps); return { v: x.perSharer === undefined ? '—' : x.perSharer.toFixed(1) }; }), 'cards sent + duels opened'),
    tile('Invite → player', per(ps => { if (!have('source')) return undefined; const x = vir(ps); return { v: pct(x.conversion), sub: `${num(x.brought)} arrived, ${num(x.broughtPlayed)} played` }; }), 'arrived through a share and entered a room'),
  ];

  // Server health: drops per join and the human share of seats, 7 days.
  const hours = roomHourRows(), nowHour = Math.floor(now / HOUR_MS);
  const h7 = roomHealth(hours, nowHour - 7 * 24 + 1, nowHour), hPrev = roomHealth(hours, nowHour - 14 * 24 + 1, nowHour - 7 * 24);
  const healthStatus = have('roomHours') ? worse(grade(h7.dropRate, TARGETS.drops), grade(h7.fill, TARGETS.fill)) : 'none';
  stages.push({
    id: 'health', name: 'Server health', question: 'Do rooms feel alive and connections hold?', value: have('roomHours') ? pct(h7.dropRate) : '—',
    status: healthStatus, target: `drops per join, 7 d (target ≤ ${pct(TARGETS.drops.good)}) · humans fill ${pct(h7.fill)} of seats`,
    split: have('roomHours') && h7.humansPerRoom !== undefined ? `${h7.humansPerRoom.toFixed(1)} humans per room on average` : undefined,
    action: grade(h7.dropRate, TARGETS.drops) !== 'good' ? 'Connections drop mid-match: look at ping by country, corrections, and the lost/rejoined exits in PostHog.' : 'Rooms are mostly bots: send Quick Play into fewer rooms (one size and mode) off-peak so players meet.',
  });
  const one = (f: (h: typeof h7) => Fig): Fig => (have('roomHours') ? f(h7) : undefined);
  const healthTiles = [
    tile1('Drops / join', one(h => graded(pct(h.dropRate), grade(h.dropRate, TARGETS.drops), `${num(h.drops)} of ${num(h.joins)} joins`)), 'connection closed in a room, 7 d', true),
    tile1('Seats with humans', one(h => ({ ...graded(pct(h.fill), grade(h.fill, TARGETS.fill)), delta: h.fill !== undefined && hPrev.fill !== undefined ? [Math.round(h.fill * 100), Math.round(hPrev.fill * 100)] : undefined })), 'bots fill the rest, 7 d'),
    tile1('Humans / room', one(h => ({ v: h.humansPerRoom === undefined ? '—' : h.humansPerRoom.toFixed(1), sub: `${num(Math.round(h.roomMinutes / 60))} room-hours` })), 'average at once, 7 d'),
    tile1('Idle kicks / join', one(h => ({ v: pct(h.kickRate), sub: `${num(h.kicks)}` })), 'removed after 45 s silent, 7 d'),
    tile('Wait to match', per(ps => { if (!have('perf')) return undefined; const q = quality(ps, now - WEEK); return { v: secs(q.waitMs), sub: `median · ${num(q.waits)} player${q.waits === 1 ? '' : 's'}` }; }), 'Play pressed → in the match'),
  ];

  // Quality: median fps on phones.
  const q = (ps: Player[]) => quality(ps, now - WEEK);
  const phoneFps = q(G.phone).fps;
  stages.push({
    id: 'connection', name: 'Quality', question: 'Does it run well?', value: have('perf') && phoneFps !== undefined ? `${Math.round(phoneFps)} fps` : '—',
    status: have('perf') ? grade(phoneFps, TARGETS.fps) : 'none', target: `median on phones, 7 d · target ${TARGETS.fps.good}`,
    split: have('perf') ? `Computer ${q(G.computer).fps === undefined ? '—' : `${Math.round(q(G.computer).fps!)} fps`} · page load ${secs(q(G.all).bootMs)}` : undefined,
    action: 'Slow phones: lower the default quality on phones and in-app browsers (By browser table), and check the 1% low for hitches.',
  });
  const qualityTiles = [
    tile('Median fps', per(ps => { if (!have('perf')) return undefined; const x = q(ps); return x.fps === undefined ? { v: '—' } : graded(`${Math.round(x.fps)}`, grade(x.fps, TARGETS.fps), `1% low ${x.low === undefined ? '—' : Math.round(x.low)} · ${num(x.players)} players`); }), 'typical per player, 7 d', true),
    tile('Under 30 fps', per(ps => { if (!have('perf')) return undefined; const x = q(ps); return { v: pct(x.slowShare) }; }), 'share of players, 7 d'),
    tile('Page load', per(ps => { if (!have('perf')) return undefined; const x = q(ps); return { v: secs(x.bootMs), sub: `median · ${num(x.boots)}` }; }), 'open → lobby ready'),
  ];

  return { stages, since, activation: all, activationTiles, engagementTiles, viralityTiles, healthTiles, qualityTiles, G };
}

/** The top of the page: one card per stage, and where to look first (the earliest stage in the funnel with a problem). */
function scorecard(g: ReturnType<typeof growthFigures>) {
  const focus = g.stages.find(s => s.status === 'bad') ?? g.stages.find(s => s.status === 'watch');
  const banner = focus
    ? `<div class="focus st-${focus.status}"><b>Focus first: ${esc(focus.name)}</b><span>${esc(focus.question)} ${esc(focus.value)} (${esc(focus.target)}).</span><span>${esc(focus.action)}</span><a href="#${focus.id}">Details ↓</a></div>`
    : `<div class="focus st-good"><b>${g.stages.some(s => s.status === 'good') ? 'Every stage with data is on track.' : 'Not enough data yet.'}</b><span>Stages fill in as players arrive after this version of the server.</span></div>`;
  const cards = g.stages.map(s => `<a class="stage st-${s.status}" href="#${s.id}"><small>${esc(s.name)}</small><span class="q">${esc(s.question)}</span>
    <b>${esc(s.value)}</b><span class="badge st-${s.status}">${STATUS_LABEL[s.status]}</span><span class="target">${esc(s.target)}</span>${s.split ? `<span class="split">${esc(s.split)}</span>` : ''}</a>`).join('');
  return `<section class="group" id="scorecard" aria-labelledby="scorecard-h"><h2 class="group-h" id="scorecard-h">Scorecard<small>one number per stage, against its target; the earliest leak in the funnel comes first</small></h2>
    ${banner}<div class="stages">${cards}</div>
    <p class="table-note">Targets are rules of thumb for free web and mobile shooters (src/admin/growth.ts, <code>TARGETS</code>); online play only, since Solo never reaches the server.</p></section>`;
}

/** The funnel: each step for All, Phone and Computer, with the share kept from the step before; the biggest leak is marked. */
function activationCard(g: ReturnType<typeof growthFigures>) {
  if (views.firsts !== 'on') return card('First 24 hours', '', needs('firsts')!);
  const now = Date.now();
  const by = Object.fromEntries(GROUPS.map(x => [x.id, activation(g.G[x.id], now - 15 * DAY_MS, now, now, g.since)])) as Record<GroupId, { cohort: number; steps: Step[] }>;
  if (!by.all.cohort) return card('First 24 hours', '', `<div class="empty">${g.since ? `No new players whose first 24 hours are over yet (firsts began ${dateOf(Math.floor(g.since / DAY_MS))}).` : 'Firsts are recorded from this version of the server on; none yet.'}</div>`);
  const worst = worstStep(by.all.steps);
  const rows = by.all.steps.map((st, i) => `<tr class="${worst?.key === st.key ? 'leak' : ''}"><th><b>${st.label}</b><small>${st.hint}</small></th>${GROUPS.map(x => {
    const s = by[x.id].steps[i];
    if (!by[x.id].cohort) return '<td>—</td>';
    return `<td><div class="fbar"><i style="width:${(s.rate * 100).toFixed(1)}%" class="g-${x.id}"></i></div><span><b>${pct(s.rate)}</b> ${num(s.n)}${i && st.key !== 'back' ? ` <em title="kept from the step before">${pct(s.fromPrev)} kept</em>` : ''}</span></td>`;
  }).join('')}</tr>`).join('');
  return card('First 24 hours', `players first seen 1–15 days ago (${num(by.all.cohort)}); bars are shares of everyone who connected`, `<div class="scroll"><table class="funnel"><thead><tr><th>Step</th>${GROUPS.map(x => `<th>${x.label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="table-note">${worst ? `<b>Biggest leak:</b> ${esc(worst.label)} keeps ${pct(worst.fromPrev)} of the players who reached the step before. ${esc(worst.fix)} ` : ''}“Connected” is pressing Play Online with this browser for the first time; Solo players never appear here. A step counts if it happened within 24 hours of connecting.</p>`);
}

/** New players by channel: how many, and whether they activate and come back. The channel to repeat is the one whose players stay. */
function channelTable(players: Player[], now: number) {
  if (views.source !== 'on') return needs('source')!;
  const rows = channels(players, Math.floor(now / DAY_MS) - 29, now);
  if (!rows.length) return '<div class="empty">No visits reported yet: channels are recorded from this version of the server on.</div>';
  const cell = (v: number | undefined, t: { good: number; watch: number }, n?: number) => `<td class="num"><span class="st st-${grade(v, t)}"${n !== undefined ? ` title="of ${n}"` : ''}>${pct(v)}</span></td>`;
  const body = rows.slice(0, 15).map(r => `<tr><td>${esc(r.channel)}</td><td class="num">${num(r.players)}</td><td class="num">${pct(r.share)}</td>${cell(r.activated, TARGETS.activation)}${cell(r.d1, TARGETS.d1, r.d1n)}${cell(r.d7, TARGETS.d7, r.d7n)}<td class="num">${r.minutes ? `${Math.round(r.minutes)} min` : '—'}</td></tr>`).join('');
  return `<div class="scroll"><table><thead><tr><th>Channel</th><th class="num">New</th><th class="num">Share</th><th class="num">Kill in 24 h</th><th class="num">D1</th><th class="num">D7</th><th class="num">Median play</th></tr></thead><tbody>${body}</tbody></table></div>
    <p class="table-note">Channel: the app whose built-in browser it was (Threads, Instagram, LINE…), else the first UTM source or referrer, else direct. Colours follow the stage targets. Players from before channels were recorded are left out.</p>`;
}

/** D1 and D7 by device and by channel, so the segment that does not return stands out. */
function retentionBySegment(G: Record<GroupId, Player[]>, today: number) {
  if (views.days !== 'on') return needs('days')!;
  const recent = (ps: Player[]) => ps.filter(p => p.firstDay >= today - 37);
  const row = (label: string, ps: Player[]) => {
    const a = dayN(recent(ps).filter(p => p.firstDay >= today - 30), 1, today), b = dayN(recent(ps), 7, today);
    return `<tr><td>${esc(label)}</td><td class="num">${num(recent(ps).length)}</td><td class="num"><span class="st st-${grade(a?.rate, TARGETS.d1)}" title="${a ? `${a.back} of ${a.players}` : ''}">${pct(a?.rate)}</span></td><td class="num"><span class="st st-${grade(b?.rate, TARGETS.d7)}" title="${b ? `${b.back} of ${b.players}` : ''}">${pct(b?.rate)}</span></td></tr>`;
  };
  const byChannel = new Map<string, Player[]>();
  for (const p of G.all) if (p.channel) { let l = byChannel.get(p.channel); if (!l) byChannel.set(p.channel, (l = [])); l.push(p); }
  const top = [...byChannel].filter(([, l]) => recent(l).length).sort((a, b) => recent(b[1]).length - recent(a[1]).length).slice(0, 8);
  return `<div class="scroll"><table><thead><tr><th>Segment</th><th class="num">New</th><th class="num">D1</th><th class="num">D7</th></tr></thead><tbody>
    ${row('All', G.all)}${row('Phone', G.phone)}${row('Computer', G.computer)}${top.map(([c, l]) => row(c, l)).join('')}</tbody></table></div>
    <p class="table-note">New: first seen in the last 37 days; D1 over those whose next day is over, D7 likewise. Hover a figure for the counts. ${views.source === 'on' ? '' : 'Channels appear once the server records visits.'}</p>`;
}

/** Players by career rounds: how many in each band and their share of all rounds played. */
function roundsPanel(players: Player[]) {
  const r = roundBuckets(players);
  if (!r.players) return '<div class="empty">No rounds played yet.</div>';
  return `<ul class="rounds">${r.rows.map(b => `<li class="${b.min >= CORE_ROUNDS ? 'core' : ''}"><span>${b.label}</span><div class="bar two"><i class="p" style="width:${(b.playerShare * 100).toFixed(1)}%"></i><i class="r" style="width:${(b.roundShare * 100).toFixed(1)}%"></i></div>
    <small>${num(b.players)} players (${pct(b.playerShare)}) · ${pct(b.roundShare)} of rounds</small></li>`).join('')}</ul>
    <div class="legend"><span><i class="lp"></i>share of players</span><span><i class="lr"></i>share of rounds</span></div>
    <p class="table-note">The core (${CORE_ROUNDS}+ rounds) is ${num(r.core.players)} player${r.core.players === 1 ? '' : 's'} (${pct(r.core.playerShare)}) playing ${pct(r.core.roundShare)} of all rounds. Grow it by turning 10–29-round players into regulars.</p>`;
}

/** The sharers and what they brought. */
function viralityCard(players: Player[]) {
  if (views.source !== 'on') return card('Sharers', '', needs('source')!);
  const sharers = players.filter(p => p.src && p.src.shares + p.src.duels > 0)
    .sort((a, b) => b.src!.invitedPlayed - a.src!.invitedPlayed || b.src!.shares + b.src!.duels - (a.src!.shares + a.src!.duels)).slice(0, 15);
  const v = virality(players);
  const flow = `<div class="flow"><div><b>${num(v.reporting)}</b><small>players</small></div><i>→</i><div><b>${num(v.sharers)}</b><small>shared (${pct(v.sharerShare)})</small></div><i>→</i>
    <div><b>${num(v.invites)}</b><small>invites</small></div><i>→</i><div><b>${num(v.brought)}</b><small>arrived</small></div><i>→</i><div><b>${num(v.broughtPlayed)}</b><small>played</small></div></div>`;
  const table = sharers.length ? `<div class="scroll"><table><thead><tr><th>Player</th><th class="num">Cards</th><th class="num">Duels</th><th class="num">Arrived</th><th class="num">Played</th></tr></thead><tbody>
    ${sharers.map(p => `<tr><td>${esc(p.name || '—')}</td><td class="num">${num(p.src!.shares)}</td><td class="num">${num(p.src!.duels)}</td><td class="num">${num(p.src!.invited)}</td><td class="num">${num(p.src!.invitedPlayed)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nobody has shared yet.</div>';
  return card('From share to player', 'running totals since visits were recorded; shares made in Solo count at the player\'s next online visit', `${flow}${table}
    <p class="table-note">K-factor = players who arrived through a share and entered a room ÷ players. Above 1 the game spreads by itself; 0.3 makes sharing a real channel. ${num(v.referred)} player${v.referred === 1 ? '' : 's'} arrived through a share.</p>`);
}

/** This server's `admin_room_hour` rows (none until the view is there). */
function roomHourRows(): RoomHourOf[] {
  if (views.roomHours !== 'on' || !conn) return [];
  return [...conn.db.adminRoomHour.iter()].map((r: RoomHour) => ({ ...r }));
}

/** Human share of seats per bucket (bars) with drops per join (tick). */
function healthChart() {
  const missing = needs('roomHours');
  if (missing) return missing;
  const b = buckets(), rows = roomHourRows();
  const by = roomHealthBy(rows, b.keys, b.hourly);
  if (!by.size) return '<div class="empty">No rooms in this range (recorded from this version of the server on).</div>';
  return groupedChart({
    aria: `Room fill and drops ${rangeText()}`, groups: ['all'], wide: true, minMax: 100, shades: ['mid'], refs: [{ v: TARGETS.fill.good * 100, label: `target: humans in ${pct(TARGETS.fill.good)} of seats` }],
    value: key => {
      const h = by.get(key);
      if (!h || h.fill === undefined) return undefined;
      return { stack: [h.fill * 100], tick: h.dropRate !== undefined ? Math.min(100, h.dropRate * 100) : undefined, title: `${bucketName(b, key)}: humans in ${pct(h.fill)} of seats · ${h.humansPerRoom?.toFixed(1) ?? '—'} per room · ${num(h.joins)} joins, ${num(h.drops)} drops (${pct(h.dropRate)}), ${num(h.kicks)} idle kicks` };
    },
    axis: v => `${Math.round(v)}%`, legend: '<span><i class="g-all"></i>humans / seats</span><span><i class="line"></i>drops / join</span><span><i class="ref"></i>fill target</span>',
  });
}

/** Players by their typical frame rate, Phone and Computer. */
function fpsPanel(G: Record<GroupId, Player[]>, now: number) {
  if (views.perf !== 'on') return needs('perf')!;
  const bands = [{ label: 'under 20', lo: 0, hi: 20 }, { label: '20–29', lo: 20, hi: 30 }, { label: '30–44', lo: 30, hi: 45 }, { label: '45–54', lo: 45, hi: 55 }, { label: '55+', lo: 55, hi: Infinity }];
  const of = (ps: Player[]) => ps.filter(p => p.perf && p.perf.seconds > 0 && p.perf.lastAtMs >= now - WEEK).map(p => p.perf!.fps);
  const sides = { phone: of(G.phone), computer: of(G.computer) };
  if (!sides.phone.length && !sides.computer.length) return '<div class="empty">No frame-rate reports in the last 7 days (recorded from this version on).</div>';
  return `<ul class="rounds">${bands.map(b => `<li class="${b.hi <= 30 ? 'slow' : ''}"><span>${b.label}</span><div class="bar two">${SIDES.map(s => {
    const n = sides[s].filter(f => f >= b.lo && f < b.hi).length;
    return `<i class="g-${s}" style="width:${sides[s].length ? ((n / sides[s].length) * 100).toFixed(1) : 0}%"></i>`;
  }).join('')}</div><small>${SIDES.map(s => { const n = sides[s].filter(f => f >= b.lo && f < b.hi).length; return `${SIDE_LABEL[s]} ${num(n)} (${pct(sides[s].length ? n / sides[s].length : undefined)})`; }).join(' · ')}</small></li>`).join('')}</ul>
    <div class="legend"><span><i class="g-phone"></i>Phone</span><span><i class="g-computer"></i>Computer</span></div>
    <p class="table-note">A player's typical fps is their median frame rate in online matches, averaged over the time measured. Under 30 a shooter feels broken.</p>`;
}

/** Frame rate and load times by in-app browser, slowest first. */
function browserTable(players: Player[], now: number) {
  if (views.perf !== 'on') return needs('perf')!;
  const rows = qualityByBrowser(players, now - WEEK);
  if (!rows.length) return '<div class="empty">No frame-rate reports in the last 7 days.</div>';
  return `<div class="scroll"><table><thead><tr><th>Browser</th><th class="num">Players</th><th class="num">Median fps</th><th class="num">1% low</th><th class="num">Under 30</th><th class="num">Page load</th><th class="num">Wait to match</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.browser)}</td><td class="num">${num(r.players)}</td><td class="num"><span class="st st-${grade(r.fps, TARGETS.fps)}">${r.fps === undefined ? '—' : Math.round(r.fps)}</span></td><td class="num">${r.low === undefined ? '—' : Math.round(r.low)}</td><td class="num">${pct(r.slowShare)}</td><td class="num">${secs(r.bootMs)}</td><td class="num">${secs(r.waitMs)}</td></tr>`).join('')}</tbody></table></div>
    <p class="table-note">In-app browsers (Threads, Instagram, LINE…) are often slower than the phone's own browser; the lobby already suggests opening the game outside them.</p>`;
}

/** A player's typical frame rate, coloured. */
function fpsCell(p: Player) {
  const f = p.perf;
  if (!f || !(f.seconds > 0)) return `<td class="num">—</td>`;
  return `<td class="num" title="${esc(`1% low ${Math.round(f.low)} · ${Math.round(f.seconds / 60)} min measured · last ${ago(new Date(f.lastAtMs))}`)}"><span class="st st-${grade(f.fps, TARGETS.fps)}">${Math.round(f.fps)}</span></td>`;
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
  { key: 'ping', label: 'Ping', num: true }, { key: 'corrPerMin', label: 'Corr/min', num: true }, { key: 'fps', label: 'FPS', num: true }, { key: 'deviceName', label: 'Device' },
  { key: 'channel', label: 'Channel' },
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
      ${pingCell(p)}<td class="num">${fmtRate(p.corrPerMin)}</td>${fpsCell(p)}${deviceCell(p)}<td>${esc(p.channel ?? '—')}</td>
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
 * The charts' time buckets: UTC days (30 or 7), or the last 48 hours (hours since the epoch, labelled
 * in this browser's time zone). `now` is the bucket in progress.
 */
interface Buckets { hourly: boolean; keys: number[]; now: number; unit: number }
function buckets(): Buckets {
  const hourly = charts.range === '48h';
  const now = Math.floor(Date.now() / (hourly ? HOUR_MS : DAY_MS));
  const n = charts.range === '30d' ? 30 : charts.range === '7d' ? 7 : 48;
  return { hourly, now, unit: hourly ? 3600 : 86_400, keys: Array.from({ length: n }, (_, i) => now - n + 1 + i) };
}
const pad2 = (n: number) => String(n).padStart(2, '0');
/** A bucket in a tooltip: "2026-10-09" (UTC day) or "10-09 21:00" (local hour). */
function bucketName(b: Buckets, key: number) {
  if (!b.hourly) return dateOf(key);
  const d = new Date(key * HOUR_MS);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:00`;
}
/** The axis label under a bucket, if it gets one: every 5th day of 30, every day of 7, every 6th hour (the date at midnight). */
function bucketLabel(b: Buckets, i: number, narrow: boolean): string | undefined {
  const key = b.keys[i];
  if (b.hourly) {
    const d = new Date(key * HOUR_MS), h = d.getHours();
    if (h % (narrow ? 12 : 6)) return undefined;
    return h ? `${pad2(h)}:00` : `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  if (b.keys.length <= 7) return dateOf(key).slice(5);
  return (narrow ? i % 7 === 1 : i % 5 === 4 || i === 0) ? dateOf(key).slice(5) : undefined;
}
/** The range in a card's subtitle. */
const rangeText = () => (charts.range === '48h' ? 'per hour (your time zone), last 48 hours' : `per UTC day, last ${charts.range === '7d' ? 7 : 30} days`);

/** Release flags over a chart: a dashed line down each bucket with releases and a flag at the top to hover (what shipped, in UTC). */
function releaseMarks(b: Buckets, cx: (i: number) => number, top: number, bottom: number) {
  let svg = '';
  for (const [key, list] of releasesByDay(RELEASES, b.keys[0], b.now, b.unit)) {
    const x = cx(key - b.keys[0]), y = top - 9;
    svg += `<g class="release"><line x1="${x}" x2="${x}" y1="${y + 6}" y2="${bottom}"/><path d="M${x - 4.5},${y} L${x + 4.5},${y} L${x},${y + 7} Z"/>`
      + `${list.length > 1 ? `<text x="${x + 6}" y="${y + 6}">${list.length}</text>` : ''}<rect class="hit" x="${x - 7}" y="${y - 3}" width="${list.length > 1 ? 22 : 14}" height="13"/><title>${esc(releaseTitle(key, list, b.unit))}</title></g>`;
  }
  return svg;
}
/** The legend entry for release flags, when the chart has any. */
const releaseLegend = (b: Buckets) => (releasesByDay(RELEASES, b.keys[0], b.now, b.unit).size ? '<span><i class="release"></i>Release</span>' : '');

/** The bars a chart draws per bucket: Phone and Computer side by side, or everyone combined. */
const chartGroups = (): GroupId[] => (charts.combined ? ['all'] : [...SIDES]);
const GROUP_LABEL: Record<GroupId, string> = { all: 'All players', phone: 'Phone', computer: 'Computer' };
const groupLegend = (extra = '') => `${chartGroups().map(g => `<span><i class="g-${g}"></i>${GROUP_LABEL[g]}</span>`).join('')}${extra}`;

/** One group's bar in one bucket: stacked segments from the bottom (shaded `shades` in order), an optional tick (p95), and its tooltip. */
interface Bar { stack: number[]; tick?: number; title: string }

/**
 * Bars over the chosen range: per bucket one bar per group (Phone and Computer side by side, or
 * everyone), on one scale, with release flags. `value` gives a group's bar in a bucket (undefined: none).
 */
function groupedChart(o: { aria: string; value: (key: number, g: GroupId) => Bar | undefined; axis: (v: number) => string; counts?: boolean; minMax?: number; shades?: string[]; legend: string; wide?: boolean; note?: string; refs?: { v: number; label: string }[]; groups?: GroupId[] }) {
  const b = buckets(), groups = o.groups ?? chartGroups();
  const data = b.keys.map(k => groups.map(g => o.value(k, g)));
  // Narrow screens draw a narrower chart, so its labels keep a readable size.
  const narrow = innerWidth < 600;
  const W = narrow ? 360 : o.wide ? 1100 : 600, H = narrow || !o.wide ? 230 : 200, L = 46, R = 8, T = 20, B = 26;
  const max = Math.max(o.minMax ?? 1, ...(o.refs ?? []).map(r => r.v), ...data.flat().map(x => (x ? Math.max(x.stack.reduce((n, v) => n + v, 0), x.tick ?? 0) : 0)));
  const step = niceStep(max, o.counts), top = Math.ceil(max / step - 1e-9) * step;
  const col = (W - L - R) / data.length, bw = (col * (groups.length > 1 ? 0.84 : 0.7)) / groups.length;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const cx = (i: number) => L + col * i + col / 2;
  const shades = o.shades ?? ['s0', 's1'];
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria)}">`;
  for (let v = 0; v <= top + 1e-9; v += step) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${o.axis(v)}</text>`;
  for (const r of o.refs ?? []) svg += `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(r.v)}" y2="${y(r.v)}"><title>${esc(r.label)}</title></line>`;
  data.forEach((bars, i) => {
    bars.forEach((x, j) => {
      if (!x) return;
      const left = cx(i) - (bw * groups.length) / 2 + j * bw;
      let base = 0, g = `<g class="day g-${groups[j]}">`;
      x.stack.forEach((v, k) => { g += `<rect class="bar ${shades[k] ?? 's1'}" x="${left}" y="${y(base + v)}" width="${bw}" height="${Math.max(0, y(base) - y(base + v))}"/>`; base += v; });
      if (x.tick !== undefined) g += `<line class="tick" x1="${left - 1}" x2="${left + bw + 1}" y1="${y(x.tick)}" y2="${y(x.tick)}"/>`;
      svg += `${g}<title>${esc(x.title)}</title></g>`;
    });
    const label = bucketLabel(b, i, narrow);
    if (label) svg += `<text x="${cx(i)}" y="${H - 8}" text-anchor="middle">${label}</text>`;
  });
  svg += releaseMarks(b, cx, T, H - B);
  return `<div class="legend">${o.legend}${releaseLegend(b)}</div><div class="chart">${svg}</svg></div>${o.note ? `<p class="table-note">${o.note}</p>` : ''}`;
}

/** What a chart says when the view it needs is missing or still loading; undefined when it is there. */
function needs(view: keyof typeof OPTIONAL): string | undefined {
  if (views[view] === 'on') return undefined;
  return `<div class="empty">${views[view] === 'missing' ? "— This server's module has no view for this yet." : 'Loading…'}</div>`;
}
/** Under an hourly chart: when hourly records begin, if inside the range. */
function hourlyNote(players: Player[], b: Buckets): string | undefined {
  if (!b.hourly) return undefined;
  let first = Infinity;
  for (const p of players) if (p.hours) for (const h of p.hours.keys()) if (h < first) first = h;
  if (first === Infinity) return 'Hours are recorded from this version of the server on; nothing recorded yet.';
  return first > b.keys[0] ? `Hours are recorded from ${bucketName(b, first)} on (new players before that come from when they were first seen).` : undefined;
}
const hourSet = (p: Player) => new Set(p.hours?.keys() ?? []);
const hourSeconds = (p: Player) => (p.hours ? new Map([...p.hours].map(([h, r]) => [h, r.seconds])) : undefined);
const hourNet = (p: Player) => (p.hours ? new Map([...p.hours].filter(([, r]) => r.netSeconds > 0).map(([h, r]) => [h, { p50: r.p50, p95: r.p95, seconds: r.netSeconds, corrections: r.corrections }])) : undefined);

/** Players active per bucket for each group: returning (seen before that bucket) under new. */
function playersChart(G: Record<GroupId, Player[]>) {
  const b = buckets();
  const missing = needs(b.hourly ? 'hours' : 'days');
  if (missing) return missing;
  const from = b.keys[0], to = b.now;
  const by = Object.fromEntries(chartGroups().map(g => [g, activeByDay(G[g].map(p => (b.hourly ? { firstDay: p.firstHour, days: hourSet(p) } : p)), from, to)])) as Record<GroupId, ReturnType<typeof activeByDay>>;
  return groupedChart({
    aria: `Returning and new players ${rangeText()}`, counts: true,
    value: (key, g) => {
      const r = by[g].get(key);
      return r && r.active ? { stack: [r.active - r.fresh, r.fresh], title: `${bucketName(b, key)} · ${GROUP_LABEL[g]}: ${r.active} active (${r.active - r.fresh} returning, ${r.fresh} new)` } : undefined;
    },
    axis: v => String(v), legend: groupLegend('<span class="hint">dim: returning · bright: new</span>'), note: hourlyNote(G.all, b),
  });
}

/** Online play time per bucket for each group (hours, or minutes when no bucket reaches two); the bucket in progress includes sessions still open. */
function playChart(G: Record<GroupId, Player[]>) {
  const b = buckets();
  const missing = needs(b.hourly ? 'hours' : 'dayTime');
  if (missing) return missing;
  const by = Object.fromEntries(chartGroups().map(g => {
    const m = sumByDay(G[g].map(p => (b.hourly ? hourSeconds(p) : p.daySeconds)));
    m.set(b.now, (m.get(b.now) ?? 0) + G[g].reduce((n, p) => n + p.openSeconds, 0));
    return [g, m];
  })) as Record<GroupId, Map<number, number>>;
  let maxSeconds = 0;
  for (const g of chartGroups()) for (const k of b.keys) maxSeconds = Math.max(maxSeconds, by[g].get(k) ?? 0);
  if (!maxSeconds) return `<div class="empty">No online play time in this range.</div>${b.hourly ? `<p class="table-note">${hourlyNote(G.all, b) ?? ''}</p>` : ''}`;
  const unit = maxSeconds >= 7200 ? 3600 : 60, suffix = unit === 3600 ? 'h' : 'm';
  return groupedChart({
    aria: `Online play time ${rangeText()}`, wide: true, shades: ['mid'],
    value: (key, g) => {
      const sec = by[g].get(key) ?? 0;
      return sec ? { stack: [sec / unit], title: `${bucketName(b, key)} · ${GROUP_LABEL[g]}: ${hm(sec)}${key === b.now ? ' (incl. sessions in progress)' : ''}` } : undefined;
    },
    axis: v => (v ? `${Math.round(v * 10) / 10}${suffix}` : '0'), legend: groupLegend(), note: hourlyNote(G.all, b),
  });
}

/** Median p50 per bucket for each group (bars, a tick at the median p95); buckets without reports are gaps. */
function pingChart(G: Record<GroupId, Player[]>) {
  const b = buckets();
  const missing = needs(b.hourly ? 'hours' : 'dayNet');
  if (missing) return missing;
  const by = Object.fromEntries(chartGroups().map(g => [g, pingByDay(G[g].map(p => (b.hourly ? hourNet(p) : p.dayNet)))])) as Record<GroupId, ReturnType<typeof pingByDay>>;
  if (!chartGroups().some(g => b.keys.some(k => by[g].has(k)))) return `<div class="empty">No ping reports in this range.</div>${b.hourly ? `<p class="table-note">${hourlyNote(G.all, b) ?? ''}</p>` : ''}`;
  return groupedChart({
    aria: `Median ping ${rangeText()}`, minMax: 80, shades: ['mid'],
    value: (key, g) => {
      const r = by[g].get(key);
      return r ? { stack: [r.p50], tick: r.p95, title: `${bucketName(b, key)} · ${GROUP_LABEL[g]}: median p50 ${r.p50} ms, p95 ${r.p95} ms · ${r.players} player${r.players === 1 ? '' : 's'} · ${fmtRate(r.correctionsPerMin)} corrections/min` } : undefined;
    },
    axis: v => (v ? `${v} ms` : '0'), legend: groupLegend('<span><i class="line"></i>p95</span>'), note: hourlyNote(G.all, b),
  });
}

// ---- Peak online and benchmarks -----------------------------------------------------------

/** This server's `admin_peak_hour` rows (none until the view is there). */
function peakRows(): PeakOf[] {
  if (views.peak !== 'on' || !conn) return [];
  return [...conn.db.adminPeakHour.iter()].map((r: PeakHour) => ({ hour: r.hour, peak: r.peak, phone: r.phone, computer: r.computer, atMs: r.at.toDate().getTime() }));
}

/** A group's peak as a tile figure, with when the all-player peak was reached (local time or date); "—" without the view, 0 without records. */
function peakFig(p: ReturnType<typeof peakBetween>, g: GroupId, when: 'time' | 'date'): Fig {
  if (views.peak !== 'on') return undefined;
  if (!p) return { v: '0' };
  const at = new Date(p.atMs);
  const sub = g !== 'all' ? undefined : when === 'time' ? `at ${pad2(at.getHours())}:${pad2(at.getMinutes())}` : `${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  return { v: num(peakFor(p, g)), sub, title: g === 'all' ? `reached ${at.toLocaleString()}` : undefined };
}

/** Under the peak chart: when peaks begin, if inside the range. */
function peakNote(peaks: PeakOf[], b: Buckets): string | undefined {
  if (!peaks.length) return 'Peaks are recorded from this version of the server on; nothing recorded yet. Launch-week peaks are under Benchmarks.';
  const first = Math.min(...peaks.map(r => r.hour));
  const key = b.hourly ? first : Math.floor(first / 24);
  return key > b.keys[0] ? `Peaks are recorded from ${bucketName(b, key)} on; launch-week peaks are under Benchmarks.` : undefined;
}

/** The most players in rooms at once per bucket for each group (bars), with the average at once (tick: play time over the bucket's length). */
function peakChart(G: Record<GroupId, Player[]>) {
  const missing = needs('peak');
  if (missing) return missing;
  const b = buckets();
  const peaks = peakRows();
  const by = peaksBy(peaks, b.hourly);
  const avgView = b.hourly ? 'hours' : 'dayTime';
  const avg = Object.fromEntries(chartGroups().map(g => [g, views[avgView] === 'on' ? sumByDay(G[g].map(p => (b.hourly ? hourSeconds(p) : p.daySeconds))) : new Map<number, number>()])) as Record<GroupId, Map<number, number>>;
  if (!b.keys.some(k => by.has(k))) return `<div class="empty">No players in rooms in this range.</div><p class="table-note">${peakNote(peaks, b) ?? ''}</p>`;
  return groupedChart({
    aria: `Most players in rooms at once ${rangeText()}`, counts: true, shades: ['mid'], refs: [{ v: 12, label: '12: one full 6v6 room' }],
    value: (key, g) => {
      const p = by.get(key);
      if (!p || !peakFor(p, g)) return undefined;
      const average = (avg[g].get(key) ?? 0) / b.unit;
      const at = g === 'all' ? ` (${new Date(p.atMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : '';
      return { stack: [peakFor(p, g)], tick: average > 0 ? average : undefined, title: `${bucketName(b, key)} · ${GROUP_LABEL[g]}: peak ${peakFor(p, g)} at once${at}${average > 0 ? ` · average ${average.toFixed(1)} at once` : ''}` };
    },
    axis: v => String(v), legend: groupLegend('<span><i class="line"></i>average at once</span><span><i class="ref"></i>12: one full 6v6 room</span>'), note: peakNote(peaks, b),
  });
}

/**
 * Turf War on this server against BeGone's estimated Taiwan peak (src/admin/benchmarks.ts): MAU, DAU,
 * peak CCU and lifetime players, then the estimate step by step and Turf War's launch-week peaks.
 */
function benchmarks(players: Player[], peaks: PeakOf[], today: number) {
  const hasDays = views.days === 'on';
  const taiwan = players.filter(p => countryOf(p.tz) === 'Taiwan');
  const peak7 = peakBetween(peaks, (today - 6) * 24, today * 24 + 23);
  const ours: Record<string, { all?: number; taiwan?: number }> = {
    'MAU': hasDays ? { all: activeBetween(players, today - 29, today), taiwan: activeBetween(taiwan, today - 29, today) } : {},
    'DAU': hasDays ? { all: Math.round(averageDaily(players, today - 7, today - 1)), taiwan: Math.round(averageDaily(taiwan, today - 7, today - 1)) } : {},
    'Peak CCU': views.peak === 'on' ? { all: peak7?.all ?? 0 } : {},
    'Lifetime players': { all: players.length, taiwan: taiwan.length },
  };
  const mark = { below: 'below its range', within: 'within its range', above: 'above its range' };
  const rows = BEGONE_TAIWAN.map(b => {
    const o = ours[b.metric], v = o.taiwan ?? o.all;
    const where = v === undefined ? '' : versus(v, b);
    return `<tr><td><b>${b.metric}</b><br><small class="muted">${b.how}</small></td>
      <td class="num">${o.all === undefined ? '—' : num(o.all)}</td><td class="num">${o.taiwan === undefined ? (o.all === undefined ? '—' : '<small class="muted">all</small>') : num(o.taiwan)}</td>
      <td class="num">${b.begone}<br><small class="muted">${num(b.low)}–${num(b.high)}</small></td><td>${where ? `<span class="tag vs ${where}">${mark[where]}</span>` : '—'}</td></tr>`;
  }).join('');
  const table = `<div class="scroll"><table class="bench"><thead><tr><th>Metric</th><th class="num">Turf War</th><th class="num">Taiwan only</th><th class="num">BeGone, Taiwan</th><th>Turf War is</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="table-note">Turf War: this server, all players and those on a Taiwan time zone (the comparison uses Taiwan where there is one; peak CCU counts everyone in rooms). Days are UTC days.
    BeGone: estimated Taiwan figures at its peak (2012–14); each is good to about 2× either way.</p>`;
  const launch = `<ul class="launch">${LAUNCH_PEAKS.map(d => `<li><span>${d.day}${d.partial ? ' <small class="muted">to 13:00</small>' : ''}</span><b>${d.peak}</b><small class="muted">at ${d.at}</small></li>`).join('')}</ul>
    <p class="table-note">The most players in Online rooms at once per Taipei day, rebuilt from PostHog joins and leaves before the server recorded peaks (sessions without a leave event end at their last event, so these may read up to ~3 low).</p>`;
  const how = `<pre class="funnel">${esc(BEGONE_FUNNEL)}</pre><ul class="evidence">${BEGONE_EVIDENCE.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`;
  return `${card('Turf War vs BeGone in Taiwan', 'MAU sizes the player base; DAU says how sticky it is; peak CCU says whether rooms fill', table)}
    <div class="grid2">${card('How the BeGone estimate was made', 'from nplay.com in the Wayback Machine, 2026-10-11', how)}${card('Launch-week peaks', 'Turf War, Oct 7–11, Online rooms', launch)}</div>`;
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
    if (p === 'unreachable') { unreachableCard(); return; }
    // Remembered as logged in, but the server says no (revoked, or a new key): back to the login.
    if (conn && status() && store.get(flagKey())) store.del(flagKey());
    if (!conn && p !== 'ready') { body.innerHTML = `<div class="empty">Connecting to ${esc(server.name)}…</div>`; return; }
    renderLogin();
  });
}

/** The header's dot: connected, connecting (amber), or not reachable. */
function renderConn() {
  const p = driver.state.phase;
  if (p === 'ready') setConn(conn ? 'live' : 'off', conn ? 'Connected' : 'Connected, but this database has no admin views');
  else if (p === 'probing') setConn('wait', 'Connecting');
  else setConn('off', p === 'unreachable' ? "Can't reach the server" : 'Not connected');
}

/** "Can't reach the server" with Retry, after 30 s of trying. Redrawn whole only when the server changes. */
let unreachableShown = '';
function unreachableCard() {
  const key = server.id;
  if (unreachableShown === key && body.querySelector('.unreachable')) return;
  unreachableShown = key;
  body.innerHTML = `<section class="unreachable"><h2><i class="dot off"></i>Can't reach the server</h2>
      <p role="status">It did not answer within 30 seconds. Check that the server is running, or try again.</p>
      <button type="button" class="btn primary" id="unreachable-retry">Retry</button></section>`;
  body.querySelector('#unreachable-retry')?.addEventListener('click', () => driver.retry());
}

logoutBtn.addEventListener('click', () => {
  store.del(flagKey());
  message = 'Logged out.'; messageError = false;
  void conn?.reducers.adminLogout({}).catch(() => undefined).finally(render);
});

/**
 * One connection to a server's admin views (the connection driver retries until it answers).
 * `live` once the views have arrived, or once the server answered but has no admin views (an older
 * module: there is nothing to retry, the login form says so).
 */
function adminLink(s: AdminServer, lost: () => void): ConnectLink {
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
        cc.db.adminPlayerDevice, cc.db.adminPlayerDay, cc.db.adminPlayerDayTime, cc.db.adminPlayerDayNet, cc.db.adminPlayerHour, cc.db.adminPeakHour,
        cc.db.adminPlayerPerf, cc.db.adminPlayerSource, cc.db.adminPlayerMilestone, cc.db.adminRoomHour, cc.db.adminErrors,
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
  return new ConnectDriver<never>({
    ping: signal => ping ? hostAnswers(ping, signal) : Promise.resolve(false),
    connect: lost => adminLink(s, lost),
  }, () => render(), () => undefined);
}
let driver = makeDriver();

/** Show another server: drop this connection, remember the choice, connect to the other. */
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
