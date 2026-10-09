import { inject } from '@vercel/analytics';
import { RETIRED_MAPS, loadMap, mapSummaries } from '../shared/maps/index';
import { cleanCode, hasSites, listOrder, mapsFor, pickAnyRoom, ROOM_SIZES, roomFull, sizeLabel } from '../shared/match/rooms';
import { ELIMINATION, SABOTAGE, type Mode, type Team } from '../shared/match/state';
import { loadAssets, type Assets } from './assets';
import { Audio } from './audio';
import { Game } from './game/game';
import { settings } from './game/settings';
import { loadLayout, matches } from './game/keybinds';
import type { GameLink } from './game/link';
import { OfflineLink } from './game/offline';
import { Bench, BENCH_SECONDS, benchReport, type BenchResult } from './game/bench';
import { onlineAvailable, connectOnline, watchRooms, ConnectError, OnlineLink, type OnlineEntry, type PublicRoom } from './net/online';
import { PING_WINDOW, PingMonitor, hostAnswers, pingAllowed, pingTone, pingUrl, serverHost, serverRegion } from './net/ping';
import { currentServer, gameServerList, onServer, type GameServer, type ServerId } from './net/servers';
import { WakeDriver, wakeProgress, wakeSeconds, type WakeState } from './net/wake';
import { matchJoined, matchLeft, setSuper, startAnalytics, track, type PlayKind, type Exit, type Reason } from './analytics';
import { LevelView } from './render/level';
import { THEMES } from './render/materials';
import { QUALITY, Renderer } from './render/renderer';
import { renderTheme, THEME_START } from './theme';
import { SettingsMenu, type GraphicsQuality, type SettingsFocus, type SettingsTab } from './ui/settingsmenu';
import { cjkFontReady } from './ui/fonts';
import { drawMapThumb } from './ui/mapthumb';
import { L, applyI18n, escapeHtml as esc, isZh, lang, mapName as localMapName, modeName, onLang, plural, serverError, sizeName, t, type Key } from './ui/i18n';
import './style.css';
import './menu.css';
import './ui/lang-zh.css';
import { currentDeviceKind, defaultQuality } from './game/device';
import { onTouchLayout, touchActive } from './game/touchlayout';
import { InstallBanner } from './ui/installhint';
import { onSideways, watchSideways } from './ui/viewport';
import { mountProgressBadge } from './ui/progressbadge';
import { askCallsign, madeUpCallsign } from './ui/callsign';
import { ask, confirmDialog } from './ui/ask';
import { watchClientErrors } from './errors';
import { registerServiceWorker, warmServiceWorker } from './pwa';

inject();
registerServiceWorker();

const app = document.querySelector<HTMLDivElement>('#app')!;
const params = new URLSearchParams(location.search);
/** Everything the lobby remembers lives under `lawbreaker.*` (the HUD reads `lawbreaker.crosshair`). */
const store = {
  get: (k: string, d: string) => { try { return localStorage.getItem(`lawbreaker.${k}`) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`lawbreaker.${k}`, v); } catch { /* storage disabled */ } },
};

/** Room sizes (soldiers per team; bots fill every slot a human does not). 24v24 plays on big maps only. */
const SIZES = ROOM_SIZES;
type SizeId = (typeof SIZES)[number]['id'];
const sizeOf = (id: string) => SIZES.find(s => s.id === id) ?? SIZES[1];
const MODE_TAGS: Record<Mode, string> = { elimination: 'E', sabotage: 'S' };
/**
 * The lobby's three online views: Quick Play (no setup), Start a Server (a form) and Join a Server
 * (the live room list and a private room code). Solo and Practice sit under all three.
 */
type Tab = 'quick' | 'start' | 'join';
const TABS: readonly Tab[] = ['quick', 'start', 'join'];
/** Ways into a match: Quick Play, Start, a listed room, a code, and offline Solo and Practice. */
type Action = 'quick' | 'start' | 'room' | 'code' | 'solo' | 'range';
/** How the match is reached, as storage and `?mode=` speak it. */
const modeOf = (a: Action) => a === 'solo' ? 'offline' : a === 'range' ? 'lab' : 'online';

const menu = document.createElement('div');
menu.id = 'menu';
const maps = mapSummaries();
const mapName = (id: string) => localMapName(id, maps.find(m => m.id === id)?.name ?? id);
/**
 * The game server the lobby shows: the one chosen in Settings (src/net/servers.ts). A choice made in
 * the lobby applies at once; one made in a match waits until the lobby is back (`followServer`).
 */
let server: GameServer | undefined = currentServer();
/** More than one server to choose from: the server chips open Settings on the choice. */
const choosable = gameServerList().length > 1;
const online = onlineAvailable();
/** Featured first in the map row's shortcuts: Taipei's two maps, then the usual order. */
const FEATURED = ['taipei', 'xinyi', ...maps.map(m => m.id).filter(id => id !== 'taipei' && id !== 'xinyi')];

const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.84 1.84M7.34 16.66 5.5 18.5M18.5 18.5l-1.84-1.84M7.34 7.34 5.5 5.5"/><circle cx="12" cy="12" r="6.4"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"/></svg>';
const CARET = '<svg class="caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
/** GitHub's mark, for the footer's source link. */
const GITHUB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3"/></svg>';
/** The public repository and the privacy page, linked from the lobby's footer. */
const REPO_URL = 'https://github.com/madeyexz/turfwar';
/** The privacy page in the lobby's language (a `?lang=` visit passes it on; otherwise the page reads the saved choice). */
const privacyHref = () => `/privacy${params.get('lang') ? `?lang=${lang()}` : ''}`;
const LOCK = '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const TAB_ICONS: Record<Tab, string> = {
  quick: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  start: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  join: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
};

/** Segmented buttons; `items` are [value, label HTML] (labels built with `L` follow the language). */
const choice = (group: string, attr: string, items: [string, string][], label: Key) =>
  `<div class="choices segmented" id="${group}" style="--n:${items.length}" role="group" aria-label="${t(label)}" data-i18n-aria-label="${label}">${items.map(([v, text]) => `<button type="button" class="choice" data-${attr}="${v}"><b>${text}</b></button>`).join('')}</div>`;
/** Segmented buttons with a second line: `items` are [value, label HTML, small HTML]. */
const choice2 = (group: string, attr: string, items: [string, string, string][], label: Key, cls = '') =>
  `<div class="choices segmented ${cls}" id="${group}" style="--n:${items.length}" role="group" aria-label="${t(label)}" data-i18n-aria-label="${label}">${items.map(([v, text, small]) => `<button type="button" class="choice" data-${attr}="${v}"><b>${text}</b><small>${small}</small></button>`).join('')}</div>`;
const sizeItems = (): [string, string, string][] => SIZES.map(s => [s.id, s.label, `${L(`size.${s.id}`)}${s.perTeam > 12 ? ` · ${L('lobby.bigMaps')}` : ''}`]);
const modeTag = (m: Mode) => `<span class="mtag">[${MODE_TAGS[m]}]</span> ${L(`mode.${m}`)}`;
const pop = (id: string, label: Key, body: string) =>
  `<div class="pop" id="${id}" role="dialog" aria-label="${t(label)}" data-i18n-aria-label="${label}" hidden>${body}</div>`;
const field = (label: Key, body: string) => `<div class="frow">${L(label, 'span', 'class="label"')}${body}</div>`;
/** The line under a big button: a status dot, what it will do, and the ping (or `tail` in its place). */
const line = (id: string, tail = `<span class="ping" id="${id}-ping"></span>`) =>
  `<p class="rooms-line" id="${id}-line"><span class="conn"><i></i></span><span class="line-text" id="${id}-hint"></span>${tail}</p>`;
/** "Server · Singapore · 110 ms ▾": which server the lobby shows; with a choice of servers it opens Settings on it. */
const serverChip = (id: string) => `<button type="button" class="server-chip" id="${id}"${choosable ? ' aria-haspopup="dialog"' : ' disabled'} hidden></button>`;
const deploy = (id: string, label: Key, right = '', title?: Key) =>
  `<button type="button" class="deploy" id="${id}"${title ? ` title="${t(title)}" data-i18n-title="${title}"` : ''} disabled><span class="deploy-l">${PLAY}<span class="deploy-t" data-label="${label}">${t('lobby.loading')}</span></span><span class="deploy-r">${right}</span></button>`;

/*
 * Top: the name, team, controls and settings. Left panel: the three online views as tabs (Quick
 * Play, Start a Server, Join a Server), then the offline row (Solo, Practice). Right: the live
 * battlefield backdrop with the map in view. The map picker and Solo's options are popovers.
 */
menu.innerHTML = `
  <header class="top">
    <div class="brand"><img class="brand-icon" src="/icons/icon-192.png" width="56" height="56" alt=""><div class="brand-text"><h1 class="logo" id="logo"></h1><div class="prog" id="prog"></div></div></div>
    <div class="who">
      <label class="callsign">${L('lobby.callsign', 'span', 'class="label"')}<input type="text" id="callsign" maxlength="16" autocomplete="off" spellcheck="false"></label>
      ${choice('teams', 'team', [['auto', L('lobby.auto')], ['0', L('team.0', 'span', 'class="swat"')], ['1', L('team.1', 'span', 'class="militia"')]], 'lobby.team')}
      <div class="icons">
        <button type="button" class="icon-btn" id="open-controls" data-tip="${t('lobby.controls')}" data-i18n-tip="lobby.controls" aria-label="${t('lobby.controls')}" data-i18n-aria-label="lobby.controls" aria-haspopup="dialog">?</button>
        <button type="button" class="icon-btn" id="open-settings" data-tip="${t('lobby.settings')}" data-i18n-tip="lobby.settings" aria-label="${t('lobby.settings')}" data-i18n-aria-label="lobby.settings" aria-haspopup="dialog">${GEAR}</button>
      </div>
    </div>
  </header>
  <section class="panel">
    <div class="tabs" id="tabs" role="tablist" aria-label="${t('lobby.ways')}" data-i18n-aria-label="lobby.ways">${TABS.map(id => `
      <button type="button" class="tab" role="tab" id="tab-${id}" data-tab="${id}" aria-controls="view-${id}">${TAB_ICONS[id]}<span>${L(`tab.${id}`, 'b')}${L(`tab.${id}Sub`, 'small')}</span></button>`).join('')}
    </div>

    <div class="wake" id="wake" hidden>
      <div class="wake-say" role="status" aria-live="polite">
        <b class="wake-head"><span class="conn wait" id="wake-dot"><i></i></span><span id="wake-title"></span></b>
        <p id="wake-body"></p>
        <p class="wake-note" id="wake-note" hidden></p>
      </div>
      <div class="wake-meter" id="wake-meter" aria-hidden="true"><span class="wake-bar"><i id="wake-fill"></i></span><span class="wake-time" id="wake-time"></span></div>
      <div class="wake-queued" id="wake-queued" hidden><span id="wake-queued-text"></span><button type="button" class="link" id="wake-cancel"></button></div>
      <button type="button" class="sub wake-retry" id="wake-retry" hidden></button>
    </div>

    <div class="view" id="view-quick" role="tabpanel" aria-labelledby="tab-quick">
      ${deploy('quick-go', 'tab.quick', L('quick.tag'), 'quick.about')}
      ${line('quick', serverChip('quick-server'))}
      <section class="browser" aria-labelledby="quick-rooms-title">
        <div class="browser-head"><b id="quick-rooms-title" data-i18n="lobby.liveRooms">${t('lobby.liveRooms')}</b><span class="count" id="quick-rooms-count"></span></div>
        <div class="browser-rows" id="quick-rooms" role="list"></div>
      </section>
    </div>

    <div class="view" id="view-start" role="tabpanel" aria-labelledby="tab-start" hidden>
      <div class="filters" role="group" aria-label="${t('tab.start')}" data-i18n-aria-label="tab.start">
        ${field('start.field.mode', choice('smodes', 'smode', [['elimination', modeTag('elimination')], ['sabotage', modeTag('sabotage')]], 'start.field.mode'))}
        ${field('lobby.field.size', choice2('ssizes', 'ssize', sizeItems(), 'lobby.roomSize', 'sizes'))}
        ${field('lobby.field.map', `<div class="mapline">
          <button type="button" class="map-trigger" id="map-trigger" aria-haspopup="dialog" aria-expanded="false" aria-controls="map-pop"><i class="sw"></i><b></b><small></small>${CARET}</button>
          <div class="quick-maps" id="quick-maps" role="group" aria-label="${t('lobby.field.map')}" data-i18n-aria-label="lobby.field.map"></div>
          <p class="notice" id="map-notice" role="status"></p>
        </div>`)}
        ${field('start.field.visibility', choice2('svis', 'svis', [['public', L('start.public'), L('start.publicSub')], ['private', L('start.private'), L('start.privateSub')]], 'start.field.visibility'))}
        ${field('lobby.field.bots', choice2('sbots', 'sbots', [['on', L('start.botsOn'), L('lobby.bots.on')], ['off', L('start.botsOff'), L('lobby.bots.off')]], 'lobby.field.bots'))}
      </div>
      ${deploy('start-go', 'start.go', '<span id="start-summary"></span>')}
      ${line('start')}
    </div>

    <div class="view" id="view-join" role="tabpanel" aria-labelledby="tab-join" hidden>
      <div class="filters join-filters">
        ${field('lobby.field.size', choice('jsizes', 'jsize', [['', L('join.all')], ...SIZES.map(s => [s.id, s.label] as [string, string])], 'lobby.roomSize'))}
        ${field('lobby.field.mode', choice('jmodes', 'jmode', [['', L('join.all')], ['elimination', `<span class="mtag">[E]</span><span class="jname"> ${L('mode.elimination')}</span>`], ['sabotage', `<span class="mtag">[S]</span><span class="jname"> ${L('mode.sabotage')}</span>`]], 'lobby.field.mode'))}
      </div>
      <section class="browser" id="browser" aria-labelledby="rooms-title">
        <div class="browser-head"><b id="rooms-title" data-i18n="lobby.liveRooms">${t('lobby.liveRooms')}</b><span class="count" id="rooms-count"></span>${serverChip('rooms-server')}</div>
        <div class="browser-rows" id="rooms" role="list"></div>
        <div class="browser-foot" id="rooms-foot"></div>
      </section>
      <div class="code-row">
        <label class="label" for="roomcode" data-i18n="join.code">${t('join.code')}</label>
        <div class="code-box" title="${t('lobby.codeHint')}" data-i18n-title="lobby.codeHint">
          <span class="hash" aria-hidden="true">#</span>
          <input type="text" id="roomcode" maxlength="4" autocomplete="off" spellcheck="false" placeholder="${t('lobby.codeShort')}" data-i18n-placeholder="lobby.codeShort" aria-label="${t('lobby.roomCode')}" data-i18n-aria-label="lobby.roomCode">
          <button type="button" class="code-go" id="join-go" disabled>${t('common.join')}</button>
        </div>
      </div>
    </div>

    <nav class="others" aria-label="${t('lobby.more')}" data-i18n-aria-label="lobby.more">
      ${L('lobby.offline', 'span', 'class="label"')}
      <button type="button" class="sub" id="open-solo" aria-haspopup="dialog" aria-expanded="false" aria-controls="solo-pop">${L('lobby.solo')}</button>
      <button type="button" class="sub" id="go-range" title="${t('lobby.rangeHint')}" data-i18n-title="lobby.rangeHint">${L('lobby.sub.range')}</button>
    </nav>
    <p class="unavailable" id="online-off"></p>
    <div class="status" id="status" role="status"></div>
  </section>
  <section class="stage">
    <div class="showcase" id="showcase"><h2></h2><div class="meta"></div></div>
  </section>
  <footer class="site-links" aria-label="${t('lobby.siteLinks')}" data-i18n-aria-label="lobby.siteLinks">
    <a href="${REPO_URL}" target="_blank" rel="noopener" title="${t('lobby.openSourceTitle')}" data-i18n-title="lobby.openSourceTitle">${GITHUB}${L('lobby.openSource')}</a>
    <span class="dot" aria-hidden="true">·</span>
    <a href="${privacyHref()}" id="privacy-link">${L('lobby.privacy')}</a>
  </footer>
  ${pop('map-pop', 'lobby.chooseMap', `<div class="pop-head"><b>${L('lobby.chooseMap')}</b><small id="map-pop-sub"></small></div><div class="map-grid" id="map-grid"></div>`)}
  ${pop('solo-pop', 'lobby.solo', `<div class="pop-head"><b>${L('lobby.solo')}</b><small class="rules" id="solo-rules"></small></div>
    <div class="field">${L('lobby.field.skill', 'span', 'class="label"')}${choice('skills', 'skill', [['0.25', L('lobby.skill.recruit')], ['0.45', L('lobby.skill.veteran')], ['0.75', L('lobby.skill.elite')]], 'lobby.field.skill')}</div>
    <button type="button" class="go" id="solo-go">${t('lobby.startMatch')}</button>${L('lobby.botsHint', 'p', 'class="hint"')}`)}`;
app.appendChild(menu);
document.body.classList.add('menu-open');

// ---- Phones and tablets: touch controls, the rotate prompt and the install hint. ----
const applyTouchClass = () => document.body.classList.toggle('touch', touchActive());
applyTouchClass();
onTouchLayout(applyTouchClass);
const rotate = document.createElement('div');
rotate.id = 'rotate';
rotate.setAttribute('role', 'alert');
const renderRotate = () => {
  rotate.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="15" y="6" width="18" height="36" rx="3"/><path d="M21 37h6"/></svg><b>${esc(t('rot.title'))}</b><small>${esc(t('rot.sub'))}</small>`;
};
renderRotate();
document.body.appendChild(rotate);
// A screen that stays upright in a match (in-app browsers, rotation lock) plays sideways: the page turns
// and a short tip asks the player to turn the phone.
onSideways(on => {
  document.getElementById('sideways-tip')?.remove();
  if (!on) return;
  const tip = document.createElement('div');
  tip.id = 'sideways-tip';
  tip.setAttribute('role', 'status');
  tip.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="15" y="6" width="18" height="36" rx="3"/><path d="M21 37h6"/></svg><span>${esc(t('rot.sideways'))}</span>`;
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 4600);
});
watchSideways();
// Inside the lobby, so it goes away with it during a match.
if (!params.has('bench')) new InstallBanner(menu);
// Level and the day's goal under the title (game/progress.ts).
mountProgressBadge(menu.querySelector<HTMLElement>('#prog')!);

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => menu.querySelector<T>(sel)!;
const select = (group: string, attr: string, value: string) => menu.querySelectorAll<HTMLButtonElement>(`#${group} [data-${attr}]`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));

// ---- Initial choices: URL flags first, then what this browser remembered. ----
const MODE_ALIASES: Record<string, string> = { solo: 'offline', practice: 'lab' };
let startMode = params.get('mode') ?? store.get('mode', online.ok ? 'online' : 'offline');
startMode = MODE_ALIASES[startMode] ?? startMode;
const isTab = (v: string | null): v is Tab => !!v && (TABS as readonly string[]).includes(v);
let tab: Tab = isTab(params.get('tab')) ? params.get('tab') as Tab : 'quick';
/**
 * Start a Server's form (Solo and Practice use it too): mode, size, map, public or private, bots.
 * Remembered under `start.*`; a first visit takes the older lobby's size and filters.
 */
let size: SizeId = sizeOf(params.get('size') ?? store.get('start.size', store.get('size', 'squad'))).id;
let mode: Mode = (params.get('game') ?? store.get('start.mode', store.get('lobby.mode', ''))) === 'sabotage' ? 'sabotage' : 'elimination';
let map = params.get('map') ?? store.get('start.map', store.get('lobby.map', ''));
let isPublic = store.get('start.public', '1') !== '0';
let bots = store.get('start.bots', store.get('botsFill', 'on')) !== 'off';
// A remembered map that has since been retired is dropped (a ?map= link still opens it).
if (map && (!maps.some(m => m.id === map) || (RETIRED_MAPS.has(map) && !params.get('map')))) map = '';
// A map from the URL picks the size that plays it (?map=meridian is a 24v24 map) and drops a mode it cannot host.
if (params.get('map') && map) {
  if (!mapsFor(sizeOf(size).perTeam).includes(map) && !params.get('size')) size = SIZES.find(s => mapsFor(s.perTeam).includes(map))?.id ?? size;
  if (mode === 'sabotage' && !hasSites(map)) mode = 'elimination';
}
/** Join a Server's optional list filters ('' = all; every visit starts with every room listed). */
let joinSize: SizeId | '' = '';
let joinMode: Mode | '' = '';
let team = params.get('team') ?? store.get('team', 'auto');
let skill = params.get('skill') ?? store.get('skill', '0.45');
// Phones and tablets start on low graphics unless the player chose a preset.
let quality = (params.get('quality') ?? store.get('quality', defaultQuality(touchActive()))) as keyof typeof QUALITY;
if (!QUALITY[quality]) quality = defaultQuality(touchActive());
/** ?bench: scripted solo run that measures frame times on this device (Elimination, Squad unless ?size). */
const benchMode = params.has('bench');
if (benchMode) { mode = 'elimination'; size = sizeOf(params.get('size') ?? 'squad').id; }
const callsign = $<HTMLInputElement>('#callsign');
callsign.value = params.get('name') ?? store.get('name', t('lobby.defaultName', { n: Math.floor(Math.random() * 900 + 100) }));
const roomCode = $<HTMLInputElement>('#roomcode');
roomCode.value = cleanCode(params.get('room') ?? '');
if (roomCode.value && !params.get('tab')) tab = 'join';
const status = $('#status');
if (!online.ok) {
  menu.classList.add('no-server');
  $('#online-off').dataset.i18n = 'lobby.noServer';
  $('#online-off').textContent = t('lobby.noServer');
}

const perTeam = () => sizeOf(size).perTeam;
/** Maps the form's size and mode can play. */
const validMaps = () => mapsFor(perTeam(), mode);
const mapOk = (id: string) => validMaps().includes(id);
/** The first featured map the form can play: where a map the form cannot host moves to. */
const firstMap = () => FEATURED.find(mapOk) ?? validMaps()[0];
if (!mapOk(map)) map = firstMap();

// ---- Live rooms: a light subscription to the server's room rows while the lobby is open. ----
/*
 * The server sleeps when nobody plays and boots on the next request (src/net/wake.ts). The wake
 * driver owns the rooms connection: it pings, connects, shows "waking" while the server boots and
 * gives up after 3 minutes. Play buttons pressed meanwhile are queued and run once it is up.
 */
/** A play action held until the server is up; `retried`: it already failed to reach the server once. */
interface Queued { action: Action; room: number; retried: boolean }
let rooms: PublicRoom[] = [];
/** Pings and connects reach the chosen server (choosing another stops the driver and starts it again). */
const wake = new WakeDriver<Queued>({
  ping: signal => { const url = server && pingUrl(server.uri); return url ? hostAnswers(url, signal) : Promise.resolve(false); },
  connect: lost => watchRooms(list => { rooms = list; refresh(); }, lost),
}, s => onWake(s), q => run(q.action, q.room, q.retried));
const phase = () => wake.state.phase;
/** What the screen last showed of the wake state: a change redraws everything, a tick only the timer. */
let wakeKey = '';
/** "Server unreachable" is reported to analytics once per page, not on every attempt. */
let unreachableReported = false;
function onWake(s: WakeState<Queued>) {
  pings.setActive(pingOn && s.phase === 'ready');
  const key = `${s.phase}|${s.hostUp}|${s.queued?.action ?? ''}`;
  if (key === wakeKey) { renderWake(); renderQuick(); renderStart(); return; }
  const [was, , queued] = wakeKey.split('|');
  wakeKey = key;
  // A new attempt (or a dropped connection): the old room list is stale. (Stopping keeps it: the
  // room being joined stays on screen while the game connects.)
  if (s.phase !== was && s.phase !== 'ready' && s.phase !== 'idle') rooms = [];
  if (s.phase === 'ready' && was !== 'ready' && s.woke) track('server_woke', { seconds: wakeSeconds(s, performance.now()), queued: !!queued });
  if (s.phase === 'unreachable' && !unreachableReported) { unreachableReported = true; track('error_shown', { where: 'rooms', message: 'server unreachable' }); }
  refresh();
}
function watchLobbyRooms() {
  if (!online.ok || benchMode) { refresh(); return; }
  // A server chosen during a match applies now.
  if (followServer()) wake.stop();
  wake.start();
  refresh();
}
/** Analytics super properties for the lobby's server: its database, host and the choice (sg/us). */
const serverProps = () => ({
  online_db: online.ok ? server?.database ?? '' : '', server_host: online.ok && server ? serverHost(server.uri) : '', server_choice: server?.id ?? '',
});
/**
 * The lobby follows the chosen server: pings (the old server is no longer pinged, which would keep
 * it awake), the room list, the chips and the analytics super properties. True when it changed.
 */
function followServer() {
  const next = currentServer();
  if (next === server) return false;
  pings.untrack(server?.uri);
  server = next;
  rooms = [];
  if (pingOn) pings.track(server?.uri);
  setSuper(serverProps());
  return true;
}
/**
 * A server chosen in Settings: in the lobby, the room list, chips and ping switch at once, and the
 * new server is woken if it sleeps (a play action waiting for the old one is dropped). In a match,
 * or while joining one, the lobby picks it up when it is back on screen.
 */
onServer(() => {
  if (game || starting || !inMenu) return;
  const watching = phase() !== 'idle';
  if (!followServer()) return;
  wake.stop();
  if (watching) watchLobbyRooms(); else refresh();
});
function unwatchRooms() {
  wake.stop();
  pings.setActive(false);
}
/**
 * A lobby left in a background tab lets the server sleep (an open connection keeps it awake, and
 * that costs money): after 5 minutes hidden it disconnects, and on coming back it reconnects,
 * waking the server if need be. Not while a play action waits for the server.
 */
const LET_SLEEP_HIDDEN_MS = 5 * 60_000;
let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
document.addEventListener('visibilitychange', () => {
  clearTimeout(hiddenTimer);
  if (!online.ok || benchMode || !inMenu) return;
  if (document.visibilityState === 'hidden') {
    hiddenTimer = setTimeout(() => { if (inMenu && document.visibilityState === 'hidden' && !wake.state.queued) unwatchRooms(); }, LET_SLEEP_HIDDEN_MS);
  } else if (phase() === 'idle') watchLobbyRooms();
});

// ---- Ping: round trip to each room's server, measured only while the lobby is on screen. ----
const pings = new PingMonitor(() => renderPings());
const pingOn = online.ok && !benchMode && pingAllowed(location.search);
if (pingOn) pings.track(server?.uri);
/**
 * Every server choice's ping beside it in Settings: measured only while that dialog is open in the
 * lobby. (US East never sleeps; a sleeping Singapore server wakes for it while the dialog is open.)
 */
const choicePings = new PingMonitor(() => options.refreshPings());
if (pingOn && choosable) for (const s of gameServerList()) choicePings.track(s.uri);
/** A room row's ping: "190 ms" ("—" while measuring); the class colours it. */
function pingHtml(uri: string | undefined) {
  const ms = pings.get(uri);
  return ms === undefined ? '—' : `${ms}<small> ms</small>`;
}
const pingClass = (uri: string | undefined) => { const ms = pings.get(uri); return `ping${ms === undefined ? '' : ` ${pingTone(ms)}`}`; };
/** The chosen server by its name in Settings ("Singapore", "US East", "Dev server"); any other by its region. */
const serverName = (uri: string) => server && uri === server.uri ? t(server.label) : serverRegion(uri);
const pingTitle = (uri: string | undefined) => uri ? t('server.pingTitle', { server: serverName(uri), n: PING_WINDOW }) : '';
/** "Server · Singapore · 110 ms ▾" for the chips; "Server · Singapore · waking" while it boots. */
function chipHtml(uri: string) {
  const ms = pings.get(uri), p = phase();
  const value = p === 'waking' ? `<span class="ping waking">${esc(t('wake.chip'))}</span>`
    : p === 'unreachable' ? `<span class="ping">${esc(t('wake.downChip'))}</span>`
    : `<span class="${pingClass(uri)}">${ms === undefined ? '—' : esc(t('server.ms', { n: ms }))}</span>`;
  return `<span class="server-word">${esc(t('server.label'))} · </span>${esc(serverName(uri))} · ${value}${choosable ? CARET : ''}`;
}
/** Updates the ping cells, the server chips and the lines under the big buttons in place (samples arrive every 4 s). */
function renderPings() {
  menu.querySelectorAll<HTMLElement>('#rooms [data-ping], #quick-rooms [data-ping]').forEach(el => { el.className = pingClass(el.dataset.ping); el.innerHTML = pingHtml(el.dataset.ping); });
  const live = pingOn && !!server && phase() === 'ready';
  // The chips show from the first connection attempt (so the server can be changed meanwhile) and
  // say when the server is waking (or could not be reached), never an error.
  const chips = pingOn && !!server && phase() !== 'idle';
  for (const chip of [$('#rooms-server'), $('#quick-server')]) {
    chip.hidden = !chips;
    if (!chips || !server) continue;
    const change = choosable ? t('server.change') : '';
    chip.title = [live ? pingTitle(server.uri) : '', change].filter(Boolean).join(' · ');
    const html = chipHtml(server.uri);
    if (chip.dataset.html !== html) { chip.dataset.html = html; chip.innerHTML = html; }
  }
  // Quick Play goes to its target room's server; a started room opens on the chosen server.
  const lines: [string, string | undefined][] = [['#start-ping', server?.uri]];
  for (const [sel, uri] of lines) {
    const el = $(sel), ms = pings.get(uri);
    el.hidden = !live;
    el.className = pingClass(uri);
    el.title = pingTitle(uri);
    el.textContent = ms === undefined ? t('server.measuring') : t('server.ping', { ms: t('server.ms', { n: ms }) });
  }
}

const roomStatus = (r: PublicRoom) => r.phase === 'warmup' ? t('lobby.warmup') : r.phase === 'ended' ? t('lobby.matchOver') : t('lobby.round', { n: r.round });
const players = (n: number, max: number) => t('common.players', { n, max });
const modeLabel = (m: Mode) => `[${MODE_TAGS[m]}] ${modeName(m)}`;
/** The room Quick Play would put us in: the fullest open public room, the lower ping on a tie (the server picks the same way, by fullness). */
const quickTarget = () => pickAnyRoom(rooms, r => pings.get(r.server));
/** A room list's order: public rooms (joinable first, then the most players, then the lowest ping), then private ones the same way. */
const listed = (list: readonly PublicRoom[]) => {
  const ping = (r: PublicRoom) => pings.get(r.server);
  return [...listOrder(list.filter(r => !r.private), ping), ...listOrder(list.filter(r => r.private), ping)];
};
/** Rooms Join a Server lists (every room unless its filters narrow them). */
const shownRooms = () => listed(rooms.filter(r => (!joinSize || r.size === sizeOf(joinSize).perTeam) && (!joinMode || r.mode === joinMode)));
/** Humans in public rooms of the form's size per map: the map picker's live counts. */
function liveByMap() {
  const counts = new Map<string, number>();
  for (const r of rooms) if (r.size === perTeam()) counts.set(r.mapId, (counts.get(r.mapId) ?? 0) + r.humans);
  return counts;
}
/** The form in a few words: "6v6 · Sabotage · Ximending". */
const rulesText = () => [sizeOf(size).label, modeName(mode), mapName(map)].join(' · ');

/**
 * The brand lockup: the game's name in the current language, large, with its second half in the
 * accent (角頭|械鬥, TURF WAR|TAIPEI), and the other language's name and the two sides under it.
 */
const CJK_RE = /[\u3400-\u9fff]/;
function renderBrand() {
  const name = t('brand.name'), alt = t('brand.alt'), logo = $('#logo');
  if (logo.dataset.name === name) return;
  logo.dataset.name = name;
  const split = (s: string) => CJK_RE.test(s) ? [s.slice(0, 2), s.slice(2)] : s.split(/:\s*/);
  const [a, b = ''] = split(name);
  const cjk = (s: string) => CJK_RE.test(s) ? ' lang="zh-TW"' : ' lang="en"';
  logo.innerHTML = `<span class="logo-name${CJK_RE.test(name) ? ' cjk' : ''}"${cjk(name)}>${esc(a)}<em>${esc(b)}</em></span>
    <small class="logo-sub"><span class="logo-alt${CJK_RE.test(alt) ? ' cjk' : ''}"${cjk(alt)}>${esc(alt)}</span><i aria-hidden="true"></i><span>${esc(t('lobby.title'))} <b>${esc(t('lobby.titleVs'))}</b></span></small>`;
  logo.setAttribute('aria-label', `${name} · ${alt}`);
}

// ---- Rendering: everything on screen follows the tab, the form, the rooms and the language. ----
let ready = false;
let starting: Action | undefined;
let loadFraction = -1;
let joiningRoom = -1;
const loadingText = () => loadFraction < 0 ? t('lobby.loading') : t('lobby.loadingPct', { n: (loadFraction * 100).toFixed(0) });

function renderTabs() {
  for (const id of TABS) {
    const on = id === tab;
    const b = $(`#tab-${id}`);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    $(`#view-${id}`).hidden = !on;
  }
  menu.dataset.tab = tab;
}

/** The queued action (pressed while the server wakes), if any. */
const queuedAction = () => wake.state.queued?.action;
/** A big button's label: loading, the action under way, waiting for the server, or its name. It stays usable while the server wakes. */
function renderDeploy(btn: HTMLButtonElement, action: Action, busyText: string, enabled: boolean) {
  const label = btn.querySelector<HTMLElement>('.deploy-t')!;
  const queued = queuedAction() === action;
  label.textContent = !ready ? loadingText() : starting === action ? busyText : queued ? t('wake.waiting') : t(label.dataset.label as Key);
  btn.disabled = !ready || !!starting || !enabled;
  btn.classList.toggle('queued', queued && !starting);
}

/** The status dot and text under a big button: connecting, waking (or waiting to join), unreachable, or what it will do. */
function renderLine(id: string, action: Action, liveText: string) {
  const el = $(`#${id}-line`);
  el.hidden = !online.ok;
  if (!online.ok) return;
  const p = phase();
  const [state, text] = p === 'ready' ? ['live', liveText]
    : p === 'waking' ? ['wait', queuedAction() === action ? t('wake.queued') : t('wake.line', { n: wakeSeconds(wake.state, performance.now()) })]
    : p === 'unreachable' ? ['down', t('wake.downHead')]
    : ['wait', queuedAction() === action ? t('wake.queued') : t('lobby.connecting')];
  el.querySelector('.conn')!.className = `conn ${state}`;
  el.title = p === 'ready' ? t('lobby.liveTitle', { db: server?.database ?? 'online' }) : '';
  setText($(`#${id}-hint`), text);
}

/** Text that only changes when it differs (the waking timer redraws every second; live regions should not re-announce). */
function setText(el: HTMLElement, text: string) { if (el.textContent !== text) el.textContent = text; }

/**
 * The waking card over the tabs' views: the server is asleep (not down), the time so far and a bar,
 * the queued play action with Cancel; after 3 minutes, "Can't reach the server" with Retry.
 */
function renderWake() {
  const box = $('#wake'), s = wake.state, p = s.phase;
  box.hidden = !online.ok || (p !== 'waking' && p !== 'unreachable');
  if (box.hidden) return;
  const down = p === 'unreachable';
  const secs = wakeSeconds(s, performance.now());
  box.classList.toggle('down', down);
  $('#wake-dot').className = `conn ${down ? 'down' : 'wait'}`;
  setText($('#wake-title'), t(down ? 'wake.downHead' : 'wake.head'));
  setText($('#wake-body'), t(down ? 'wake.downBody' : 'wake.body'));
  // The machine answers but the database is still loading; or it is slower than usual.
  const note = down ? '' : s.hostUp ? t('wake.loading') : secs >= 60 ? t('wake.slow') : '';
  $('#wake-note').hidden = !note;
  setText($('#wake-note'), note);
  $('#wake-meter').hidden = down;
  ($('#wake-fill') as HTMLElement).style.width = `${(wakeProgress(secs * 1000) * 100).toFixed(1)}%`;
  setText($('#wake-time'), t('wake.elapsed', { n: secs }));
  $('#wake-queued').hidden = down || !s.queued;
  setText($('#wake-queued-text'), t('wake.queued'));
  setText($('#wake-cancel'), t('wake.cancel'));
  $('#wake-retry').hidden = !down;
  setText($('#wake-retry'), t('wake.retry'));
}

/** QUICK PLAY: where it would put you (or that it opens a 6v6 with bots) beside the server chip, and every live room to pick from. */
function renderQuick() {
  renderDeploy($<HTMLButtonElement>('#quick-go'), 'quick', t('lobby.joining'), online.ok);
  const target = quickTarget();
  renderLine('quick', 'quick', target ? t('quick.joins', { map: mapName(target.mapId), size: sizeLabel(target.size), n: target.humans, max: target.size * 2 }) : t('quick.opens'));
  $('#quick-rooms-count').innerHTML = roomTotals();
  // Every room, unfiltered, in Join a Server's order (private ones last); the one Quick Play would join is marked.
  renderRoomRows($('#quick-rooms'), listed(rooms), `<div class="empty"><p>${esc(t('quick.noRooms'))}</p></div>`, target);
}

/** START A SERVER: the form, the button and what the room will be. */
function renderStart() {
  select('smodes', 'smode', mode);
  select('ssizes', 'ssize', size);
  select('svis', 'svis', isPublic ? 'public' : 'private');
  select('sbots', 'sbots', bots ? 'on' : 'off');
  const trigger = $('#map-trigger');
  const m = maps.find(x => x.id === map);
  trigger.dataset.theme = m?.theme ?? '';
  trigger.querySelector('b')!.textContent = mapName(map);
  const live = liveByMap();
  const n = live.get(map) ?? 0;
  trigger.querySelector('small')!.textContent = n ? t('lobby.playing', { n }) : '';
  // Shortcuts: up to three featured maps the form can play (not the one chosen); the picker has them all.
  const quick = FEATURED.filter(id => id !== map && mapOk(id)).slice(0, 3);
  const box = $('#quick-maps');
  const key = `${quick.join()}|${[...live].join()}|${isZh()}`;
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = quick.map(id => {
      const c = live.get(id) ?? 0;
      return `<button type="button" class="qmap" data-pick="${id}" data-theme="${maps.find(x => x.id === id)?.theme ?? ''}">${esc(mapName(id))}${c ? `<small>${c}</small>` : ''}</button>`;
    }).join('');
  }
  renderDeploy($<HTMLButtonElement>('#start-go'), 'start', t('lobby.starting'), online.ok);
  $('#start-summary').textContent = ready ? `${sizeOf(size).label} · ${t(isPublic ? 'start.public' : 'start.private')}` : '';
  renderLine('start', 'start', `${t(isPublic ? 'start.hintPublic' : 'start.hintPrivate')}${bots ? '' : ` ${t('start.hintBotsOff')}`}`);
}

/** A room list's header totals: every public room and everyone in them (whatever filters show). */
function roomTotals() {
  const humans = rooms.reduce((n, r) => n + r.humans, 0);
  return phase() === 'ready' && rooms.length ? `<span class="conn live"><i></i>${plural('lobby.roomCount', rooms.length)} · ${plural('lobby.playerCount', humans)}</span>` : '';
}

/**
 * A live room list: fixed-height rows, each with its ping and JOIN (Join a Server's filtered list,
 * Quick Play's full one). Without rooms it says why: no server, waking (Retry after 3 minutes),
 * connecting, else `none`. `target` marks the room Quick Play would put you in.
 */
function renderRoomRows(list: HTMLElement, shown: PublicRoom[], none: string, target?: PublicRoom) {
  for (const r of shown) if (pingOn) pings.track(r.server);
  // Keep keyboard focus on the same JOIN button across live updates.
  const focused = (document.activeElement as HTMLElement | null)?.closest?.('[data-joinroom]') as HTMLElement | null;
  const focusRoom = focused && list.contains(focused) ? focused.dataset.joinroom : undefined;
  if (!shown.length) {
    const p = phase();
    // While the server wakes the list says so (never an empty box); after 3 minutes it offers Retry.
    const html = !online.ok ? `<div class="empty">${esc(t('lobby.noServer'))}</div>`
      : p === 'waking' ? `<div class="empty waking"><p><span class="conn wait"><i></i></span>${esc(t('wake.rooms'))}</p><small>${esc(t('wake.roomsSub'))}</small></div>`
      : p === 'unreachable' ? `<div class="empty"><p>${esc(t('wake.downHead'))}</p><button type="button" class="sub" data-wake-retry>${esc(t('wake.retry'))}</button></div>`
      : p !== 'ready' ? `<div class="empty">${esc(t('lobby.connecting'))}</div>`
      : none;
    // (Unchanged markup is left alone, so a focused Retry keeps its focus.)
    if (list.dataset.html !== html) { list.dataset.html = html; list.innerHTML = html; }
    return;
  }
  list.dataset.html = '';
  list.innerHTML = shown.map(r => {
    const m = maps.find(x => x.id === r.mapId);
    const aria = t('lobby.roomAria', { map: mapName(r.mapId), mode: modeName(r.mode), size: sizeLabel(r.size), n: r.humans, max: r.size * 2, status: roomStatus(r) });
    const busy = !ready || !!starting || roomFull(r);
    const lock = r.fixedMap || r.fixedMode ? `<span class="fixed" title="${esc([r.fixedMap ? t('lobby.fixedMap') : '', r.fixedMode ? t('lobby.fixedMode') : ''].filter(Boolean).join(' · '))}">${LOCK}</span>` : '';
    // A private room is listed without its code: its button asks for the code (the host shares it).
    const priv = r.private ? `<span class="priv">${LOCK}${esc(t('join.private'))}</span>` : '';
    const button = r.private
      ? `<button type="button" class="join" data-coderoom="${r.room}" aria-label="${esc(`${roomFull(r) ? t('common.full') : t('join.enterCode')} · ${t('join.private')} · ${aria}`)}"${busy ? ' disabled' : ''}>${starting === 'code' && joiningRoom === r.room ? t('lobby.joining') : roomFull(r) ? t('common.full') : t('join.enterCode')}</button>`
      : `<button type="button" class="join" data-joinroom="${r.room}" aria-label="${esc(`${roomFull(r) ? t('common.full') : t('common.join')} · ${aria}`)}"${busy ? ' disabled' : ''}>${starting === 'room' && joiningRoom === r.room ? t('lobby.joining') : roomFull(r) ? t('common.full') : t('common.join')}</button>`;
    return `<div class="room${roomFull(r) ? ' full' : ''}${r === target ? ' target' : ''}${r.private ? ' private' : ''}" role="listitem" data-room="${r.room}"${r.private ? ' data-private="1"' : ''} data-theme="${m?.theme ?? ''}">
      <span class="srv"><span class="srv-name"><b>${esc(mapName(r.mapId))}</b>${lock}${priv}</span><small class="state ${r.phase}">${esc(roomStatus(r))}${r.noBots ? ` · ${esc(t('join.noBots'))}` : ''}</small></span>
      <span class="mode" title="${esc(modeName(r.mode))}"><span class="mtag">[${MODE_TAGS[r.mode]}]</span><span class="mname"> ${esc(modeName(r.mode))}</span></span>
      <span class="size">${sizeLabel(r.size)}</span>
      <span class="players">${r.humans}/${r.size * 2}</span>
      <span class="${pingClass(r.server)}" data-ping="${esc(r.server)}" title="${esc(pingTitle(r.server))}">${pingHtml(r.server)}</span>
      ${button}
    </div>`;
  }).join('');
  if (focusRoom) list.querySelector<HTMLElement>(`[data-joinroom="${focusRoom}"]`)?.focus({ preventScroll: true });
}

/** JOIN A SERVER: the filters, the live rooms they show (fixed-height rows in a box that keeps its size) and the code box. */
function renderJoin() {
  select('jsizes', 'jsize', joinSize);
  select('jmodes', 'jmode', joinMode);
  const shown = shownRooms();
  // Header totals: every public room and everyone in them, whatever the filters show.
  $('#rooms-count').innerHTML = roomTotals();
  renderRoomRows($('#rooms'), shown, rooms.length
    ? `<div class="empty"><p>${esc(t('join.emptyFiltered'))}</p><button type="button" class="link" data-clear>${esc(t('lobby.clearFilters'))}</button></div>`
    : `<div class="empty"><p>${esc(t('join.empty'))}</p><div class="empty-go"><button type="button" class="sub" data-go="quick">${esc(t('tab.quick'))}</button><button type="button" class="sub" data-go="start">${esc(t('tab.start'))}</button></div></div>`);
  // How many rooms the filters hide.
  const foot = $('#rooms-foot');
  const hiddenRooms = rooms.length - shown.length;
  const html = shown.length && hiddenRooms
    ? `<span>${esc(plural('join.hidden', hiddenRooms))}</span><span class="dot" aria-hidden="true">·</span><button type="button" class="link" data-clear>${esc(t('lobby.clearFilters'))}</button>` : '';
  if (foot.innerHTML !== html) foot.innerHTML = html;
  const join = $<HTMLButtonElement>('#join-go');
  roomCode.disabled = !online.ok;
  join.disabled = !ready || !!starting || !online.ok || roomCode.value.length < 4;
  join.textContent = starting === 'code' || queuedAction() === 'code' ? '…' : t('common.join');
}

/** The backdrop's map: Quick Play's target, the form's map, or the first listed room. */
const shownMap = () => tab === 'start' ? map : tab === 'join' ? shownRooms()[0]?.mapId ?? map : quickTarget()?.mapId ?? map;

function renderShowcase() {
  const box = $('#showcase');
  const target = tab === 'quick' ? quickTarget() : tab === 'join' ? shownRooms()[0] : undefined;
  const h2 = box.querySelector('h2')!, meta = box.querySelector('.meta')!;
  if (target) {
    h2.textContent = mapName(target.mapId);
    meta.textContent = `${t(tab === 'quick' ? 'tab.quick' : 'lobby.liveRooms')} · ${modeLabel(target.mode)} · ${sizeLabel(target.size)} · ${players(target.humans, target.size * 2)}`;
  } else if (tab === 'quick') {
    h2.textContent = `${sizeName('squad')} 6v6`;
    meta.textContent = `${t('lobby.newRoom')} · [E] ⇄ [S] · ${t('lobby.mapRotation')}`;
  } else {
    h2.textContent = mapName(map);
    const sites = mode === 'sabotage' ? ` · ${plural('lobby.bombSites', loadMap(map).def.sabotage?.sites.length ?? 0)}` : '';
    meta.textContent = `${t(isPublic ? 'start.public' : 'start.private')} · ${modeLabel(mode)} · ${sizeOf(size).label}${sites}`;
  }
}

function renderOthers() {
  select('teams', 'team', team);
  select('skills', 'skill', skill);
  const offlineBusy = !ready || !!starting;
  const solo = $<HTMLButtonElement>('#solo-go'), range = $<HTMLButtonElement>('#go-range');
  solo.disabled = offlineBusy;
  solo.textContent = !ready ? loadingText() : starting === 'solo' ? t('lobby.starting') : t('lobby.startMatch');
  range.disabled = offlineBusy;
  $('#solo-rules').textContent = rulesText();
}

/** Everything on screen follows the current choices. */
function refresh() {
  renderBrand();
  renderTabs();
  renderWake();
  renderQuick();
  renderStart();
  renderJoin();
  renderPings();
  renderShowcase();
  renderOthers();
  if (openPop?.id === 'map-pop') renderMapGrid();
  showBackdrop();
}

// ---- The form and the filters ----
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
/** A short note in the map row (e.g. why the map changed); it fades after a few seconds. */
function notice(text: string) {
  const el = $('#map-notice');
  el.textContent = text;
  menu.classList.toggle('noticing', !!text);
  clearTimeout(noticeTimer);
  if (text) noticeTimer = setTimeout(() => notice(''), 4500);
}
/** After a size or mode change: a map the form cannot host moves to the first one it can, with a note. */
function checkMap(reason: 'size' | 'mode') {
  if (mapOk(map)) return;
  const was = mapName(map);
  map = firstMap();
  notice(reason === 'size' ? t('start.mapSwitchSize', { map: was, size: sizeOf(size).label, next: mapName(map) }) : t('start.mapSwitchMode', { map: was, next: mapName(map) }));
}
function saveForm() {
  if (benchMode) return;
  store.set('start.size', size); store.set('start.mode', mode); store.set('start.map', map);
  store.set('start.public', isPublic ? '1' : '0'); store.set('start.bots', bots ? 'on' : 'off');
}
const changed = () => { saveForm(); refresh(); };
function setTab(next: Tab, focus = false) {
  tab = next;
  closePop(false);
  refresh();
  if (focus) $(`#tab-${next}`).focus({ preventScroll: true });
}

const audio = new Audio();
const onClick = (attr: string, fn: (value: string, el: HTMLElement) => void) => menu.addEventListener('click', e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(`[data-${attr}]`);
  // The menu itself carries data-tab (for styling): only its descendants are controls.
  if (!el || el === menu || !menu.contains(el) || (el as HTMLButtonElement).disabled) return;
  fn(el.dataset[attr.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())]!, el);
  audio.ui();
});
onClick('tab', v => setTab(v as Tab));
onClick('go', v => setTab(v as Tab, true));
onClick('smode', v => { mode = v === 'sabotage' ? 'sabotage' : 'elimination'; checkMap('mode'); changed(); });
onClick('ssize', v => { size = sizeOf(v).id; checkMap('size'); changed(); });
onClick('svis', v => { isPublic = v !== 'private'; changed(); });
onClick('sbots', v => { bots = v !== 'off'; changed(); });
onClick('pick', v => { if (mapOk(v)) map = v; notice(''); changed(); closePop(); });
onClick('jsize', v => { joinSize = SIZES.some(s => s.id === v) ? v as SizeId : ''; changed(); });
onClick('jmode', v => { joinMode = v === 'elimination' || v === 'sabotage' ? v : ''; changed(); });
onClick('clear', () => { joinSize = ''; joinMode = ''; changed(); });
onClick('team', v => { team = v; select('teams', 'team', team); });
onClick('skill', v => { skill = v; select('skills', 'skill', skill); });
onClick('joinroom', v => run('room', Number(v)));
onClick('coderoom', v => askRoomCode(Number(v)));
onClick('wake-retry', () => wake.retry());
$('#wake-retry').addEventListener('click', () => { audio.ui(); wake.retry(); });
$('#wake-cancel').addEventListener('click', () => { audio.ui(); wake.cancel(); });
roomCode.addEventListener('input', () => { roomCode.value = cleanCode(roomCode.value); renderJoin(); });
$('#quick-go').addEventListener('click', () => { audio.ui(); run('quick'); });
$('#start-go').addEventListener('click', () => { audio.ui(); run('start'); });
$('#go-range').addEventListener('click', () => { audio.ui(); run('range'); });
$('#join-go').addEventListener('click', () => { audio.ui(); run('code'); });
$('#solo-go').addEventListener('click', () => { audio.ui(); run('solo'); });
for (const id of ['#rooms', '#quick-rooms']) $(id).addEventListener('dblclick', e => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('.room');
  if (row) { if (row.dataset.private) askRoomCode(Number(row.dataset.room)); else run('room', Number(row.dataset.room)); }
});
/** A listed private room: ask for its code (the host shares it), then join by code like the Join a Server box. */
function askRoomCode(room: number) {
  const r = rooms.find(x => x.room === room && x.private);
  if (!r || !ready || starting || roomFull(r)) return;
  ask({
    title: t('join.privateTitle'), why: t('join.privateWhy', { map: mapName(r.mapId), size: sizeLabel(r.size) }),
    label: t('lobby.roomCode'), placeholder: t('lobby.codeShort'), go: t('common.join'), close: t('cs.close'), maxLength: 4,
    attrs: 'autocomplete="off" autocapitalize="characters"', clean: cleanCode,
    check: code => code.length === 4 ? { ok: code } : { error: t('join.codeShort') },
    // (The room rides along only to mark its row as joining; the code decides where we go.)
    done: code => { roomCode.value = code; run('code', room); },
  });
}
// Tabs: arrow keys move between them (and select), as a tab list does.
$('#tabs').addEventListener('keydown', e => {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!step && e.key !== 'Home' && e.key !== 'End') return;
  e.preventDefault();
  const i = TABS.indexOf(tab);
  setTab(e.key === 'Home' ? TABS[0] : e.key === 'End' ? TABS[TABS.length - 1] : TABS[(i + step + TABS.length) % TABS.length], true);
});

// ---- Popovers: the map picker and Solo. One open at a time; Esc or a click outside closes. ----
let openPop: HTMLElement | undefined;
let popAnchor: HTMLElement | undefined;
function placePop() {
  if (!openPop || !popAnchor) return;
  const a = popAnchor.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, margin = 12;
  const p = openPop;
  if (vw <= 700) { p.classList.add('sheet'); p.style.left = p.style.top = ''; return; }
  p.classList.remove('sheet');
  const w = p.offsetWidth, h = p.offsetHeight;
  const left = Math.max(margin, Math.min(a.left, vw - w - margin));
  // Below the anchor if it fits, else above; failing both, beside the panel (over the backdrop), else as low as fits.
  const below = a.bottom + 6, above = a.top - 6 - h;
  // (A sideways phone's compact lobby lays the panel's children out without the panel's own box.)
  const panel = $('.panel').getBoundingClientRect();
  const side = (panel.width ? panel.right : $('#tabs').getBoundingClientRect().right) + margin;
  const clampTop = (y: number) => Math.max(margin, Math.min(y, vh - h - margin));
  const [x, y] = below + h <= vh - margin ? [left, below] : above >= margin ? [left, above]
    : side + w <= vw - margin ? [side, clampTop(a.top - 60)] : [left, clampTop(vh)];
  p.style.left = `${x}px`; p.style.top = `${y}px`;
}
function showPop(id: string, anchor: HTMLElement) {
  if (openPop?.id === id) { closePop(); return; }
  closePop(false);
  openPop = $(`#${id}`); popAnchor = anchor;
  if (id === 'map-pop') renderMapGrid();
  openPop.hidden = false;
  anchor.setAttribute('aria-expanded', 'true');
  placePop();
  const first = openPop.querySelector<HTMLElement>('[aria-pressed="true"], [aria-current="true"]') ?? openPop.querySelector<HTMLElement>('button:not(:disabled)');
  first?.focus({ preventScroll: true });
}
function closePop(restore = true) {
  if (!openPop) return;
  openPop.hidden = true;
  popAnchor?.setAttribute('aria-expanded', 'false');
  if (restore && popAnchor && openPop.contains(document.activeElement)) popAnchor.focus({ preventScroll: true });
  openPop = undefined; popAnchor = undefined;
}
$('#map-trigger').addEventListener('click', e => { audio.ui(); showPop('map-pop', e.currentTarget as HTMLElement); });
$('#open-solo').addEventListener('click', e => { audio.ui(); showPop('solo-pop', e.currentTarget as HTMLElement); });
document.addEventListener('pointerdown', e => {
  if (!openPop) return;
  const target = e.target as Node;
  if (openPop.contains(target) || popAnchor?.contains(target)) return;
  closePop(false);
});
addEventListener('resize', placePop);
menu.addEventListener('scroll', placePop, true);
menu.addEventListener('focusout', e => {
  // Tabbing out of a popover closes it.
  const next = e.relatedTarget as Node | null;
  if (openPop && next && !openPop.contains(next) && next !== popAnchor) closePop(false);
});

/**
 * A map card's picture: the map's screenshot (public/media/maps/<id>.webp, shot by scripts/mapshots.ts),
 * or its top-down plan when there is none or it fails to load. Kept per map, so redraws (live
 * counts arrive often) move the same loaded element instead of loading it again.
 */
const thumbs = new Map<string, HTMLElement>();
function plan(id: string) {
  const c = document.createElement('canvas');
  c.width = 168; c.height = 96;
  drawMapThumb(c, id);
  return c;
}
function thumb(id: string) {
  let el = thumbs.get(id);
  if (!el) {
    const img = document.createElement('img');
    img.loading = 'lazy'; img.decoding = 'async'; img.width = 480; img.height = 270;
    img.addEventListener('error', () => { const c = plan(id); thumbs.set(id, c); img.replaceWith(c); }, { once: true });
    img.src = `/media/maps/${id}.webp`;
    thumbs.set(id, el = img);
  }
  if (el instanceof HTMLImageElement) el.alt = mapName(id);
  return el;
}
/** The map picker: every map the form's size plays, with its picture, its bomb sites in Sabotage and who is playing; maps the mode cannot host are disabled. */
function renderMapGrid() {
  const grid = $('#map-grid');
  const live = liveByMap();
  $('#map-pop-sub').textContent = `${t('lobby.mapsFor', { size: sizeOf(size).label })} · ${modeName(mode)}`;
  // Under the name: the bomb sites in Sabotage, nothing in Elimination (the line keeps its height either way).
  const sites = (m: (typeof maps)[number]) => mode === 'sabotage' ? t(m.sites > 1 ? 'lobby.sitesAB' : m.sites ? 'lobby.siteA' : 'lobby.noSites') : '';
  const fits = mapsFor(perTeam());
  grid.innerHTML = maps.filter(m => fits.includes(m.id)).map(m => {
    const ok = mapOk(m.id), n = live.get(m.id) ?? 0, note = ok ? sites(m) : t('lobby.noSites');
    return `<button type="button" class="mcard" data-pick="${m.id}" data-theme="${m.theme}" aria-pressed="${m.id === map}"${ok ? '' : ` disabled title="${esc(t('lobby.noSites'))}"`}>
      <span class="thumb" data-thumb="${m.id}"></span>
      <b>${esc(mapName(m.id))}</b>
      <small>${note ? esc(note) : '&nbsp;'}</small>
      <span class="live${n ? ' on' : ''}">${n ? `<i></i>${esc(t('lobby.playing', { n }))}` : '&nbsp;'}</span>
    </button>`;
  }).join('');
  grid.querySelectorAll<HTMLElement>('[data-thumb]').forEach(el => el.appendChild(thumb(el.dataset.thumb!)));
  placePop();
}
// Arrow keys move through the map cards (by rows and columns as laid out).
$('#map-grid').addEventListener('keydown', e => {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const cards = Array.from($('#map-grid').querySelectorAll<HTMLButtonElement>('.mcard:not(:disabled)'));
  const i = cards.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  const r = cards[i].getBoundingClientRect();
  let next = i;
  if (e.key === 'ArrowLeft') next = Math.max(0, i - 1);
  else if (e.key === 'ArrowRight') next = Math.min(cards.length - 1, i + 1);
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = cards.length - 1;
  else {
    // The nearest card in the next row up or down.
    const down = e.key === 'ArrowDown';
    let best = Infinity;
    cards.forEach((c, j) => {
      const q = c.getBoundingClientRect();
      if (down ? q.top <= r.top + 4 : q.top >= r.top - 4) return;
      const d = Math.abs(q.top - r.top) * 4 + Math.abs(q.left - r.left);
      if (d < best) { best = d; next = j; }
    });
  }
  cards[next].focus();
});

// ---- Settings and controls: the gear (and ?) open the shared settings menu in its lobby mode. ----
// Key labels follow the keyboard layout where the browser tells us (AZERTY shows A on KeyQ).
void loadLayout();
const clamp01 = (v: string) => Math.max(0, Math.min(1, Number(v) || 0));
const options = new SettingsMenu(document.body, {
  sensitivity: () => undefined, // `settings` is already updated; the next match reads it.
  crosshair: () => undefined, // Saved; the HUD reads `lawbreaker.crosshair` when a match starts.
  quality: q => { quality = q; renderer?.applyQuality(QUALITY[q]); },
  volume: v => audio.setVolume(v),
}, {
  lobby: {
    current: () => ({ volume: audio.volume, music: audio.musicVolume, quality: quality as GraphicsQuality }),
    music: v => audio.setMusicVolume(v),
    previewVolume: () => audio.cash(),
    bench: { label: () => t('lobby.bench', { n: BENCH_SECONDS }), run: () => { location.search = `?bench&map=${shownMap()}&quality=${quality}${params.get('lang') ? `&lang=${params.get('lang')}` : ''}`; } },
    credits: () => t('lobby.credits'),
    // The chosen server's ping is already warm in the lobby's own monitor (the same value as its chips).
    serverPing: s => pings.get(s.uri) ?? choicePings.get(s.uri),
    onClose: () => choicePings.setActive(false),
  },
});

// Language switch (Settings): the lobby's own text follows at once.
onLang(next => {
  renderRotate();
  setSuper({ lang: next });
  track('language_changed', { to: next }, { set: { lang: next } });
  applyI18n(menu);
  $<HTMLAnchorElement>('#privacy-link').href = privacyHref();
  $('#quick-maps').dataset.key = '';
  if (benchPanel) { benchPanel.remove(); if (benchResult) showBenchResult(benchResult); }
  refresh();
});
const openOptions = (tab: SettingsTab, focus?: SettingsFocus) => {
  audio.ui(); closePop(false);
  choicePings.setActive(pingOn && choosable);
  options.show(false, tab, focus);
};
for (const id of ['#quick-server', '#rooms-server']) $(id).addEventListener('click', () => openOptions('options', 'server'));
$('#open-settings').addEventListener('click', () => openOptions('options'));
$('#open-controls').addEventListener('click', () => openOptions('controls'));

/**
 * Options from storage into `settings` and the audio. Runs at start and again on returning to the
 * lobby: the in-game menu changes the same keys mid-match.
 */
function syncOptions() {
  settings.sensitivity = Math.max(0.2, Math.min(3, Number(store.get('sensitivity', '1')) || 1));
  settings.fov = Math.max(65, Math.min(95, Number(store.get('fov', '78')) || 78));
  settings.adsSensitivity = Math.max(0.5, Math.min(1.5, Number(store.get('adsSensitivity', '1')) || 1));
  audio.setVolume(clamp01(store.get('volume', '0.8')));
  audio.setMusicVolume(clamp01(store.get('music', '0.6')));
  if (game || ready) { const q = store.get('quality', quality) as keyof typeof QUALITY; if (QUALITY[q]) quality = q; }
}

let assets: Assets;
let renderer: Renderer;
let game: Game | undefined;
let backdrop: LevelView | undefined;
let backdropMap: string | undefined;
let bench: Bench | undefined;
let benchBanner: HTMLElement | undefined;
let theme: Promise<AudioBuffer> | undefined;
let inMenu = !benchMode;
let gestured = false;

syncOptions();
refresh();
watchLobbyRooms();
track('lobby_view', {});
// Analytics loads once the lobby is on screen, when the browser is idle: never in the way of the game.
const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 1500));
idle(() => startAnalytics({ lang: lang(), ...serverProps() }));

/** Loops the menu theme once the player has interacted (browsers block audio before a gesture). */
function menuMusic() {
  if (!inMenu || !gestured || !theme) return;
  audio.start();
  void theme.then(buffer => { if (inMenu) audio.playMusic(buffer, THEME_START); }, () => undefined);
}
for (const type of ['pointerdown', 'keydown'] as const) document.addEventListener(type, () => { gestured = true; menuMusic(); });

function showBackdrop() {
  const id = shownMap();
  if (!assets || game || backdropMap === id) return;
  if (backdrop) renderer.scene.remove(backdrop.group);
  const def = loadMap(id).def;
  renderer.setTheme(THEMES[def.theme], def.sun);
  backdrop = new LevelView(assets, def, THEMES[def.theme]);
  backdropMap = id;
  renderer.scene.add(backdrop.group);
}

/** A player still on the made-up callsign is asked for one before playing (automation and `?name=` skip it). */
const needsCallsign = () => !benchMode && !params.get('autostart') && !params.has('name') && madeUpCallsign(callsign.value);

/**
 * Run one way in. An online one pressed while the server is still waking is queued: it runs by
 * itself once the server is up (`retried`: it already failed to reach the server once).
 */
function run(action: Action, room = -1, retried = false) {
  if (!ready || starting) return;
  if (modeOf(action) === 'online' && !online.ok) return;
  if (action === 'code' && roomCode.value.length < 4) { roomCode.focus(); return; }
  // Still on the lobby's made-up callsign: ask for a name first, then play from that same tap.
  if (needsCallsign()) {
    askCallsign(callsign.value, name => { callsign.value = name; store.set('name', name); run(action, room, retried); });
    return;
  }
  if (modeOf(action) === 'online' && phase() !== 'ready') {
    // Still inside the tap: full screen now, as starting would (a queued start runs without a gesture).
    fullscreenForTouch();
    // (A lobby that let the server sleep in a background tab reconnects first.)
    if (phase() === 'idle') watchLobbyRooms();
    wake.queue({ action, room, retried });
    return;
  }
  if (action === 'room' && !rooms.some(r => r.room === room)) return;
  joiningRoom = room;
  void start(action, retried);
}

/** Solo's and Practice's map and mode: the form's (the performance check uses ?map or the size's first map, Elimination). */
function offlineRules(): { mapId: string; mode: Mode } {
  if (!benchMode) return { mapId: map, mode };
  const fits = mapsFor(perTeam());
  const asked = params.get('map');
  return { mapId: asked && maps.some(m => m.id === asked) ? asked : fits.includes(map) ? map : fits[0], mode: 'elimination' };
}

/**
 * Touch devices play full screen and sideways where the browser allows (Android; iPhones have no
 * Fullscreen API, so there the installed app is the full-screen way). Must run inside the tap.
 */
function fullscreenForTouch() {
  if (!touchActive() || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    return orientation?.lock?.('landscape');
  }).catch(() => undefined);
}

async function start(action: Action, retried = false) {
  // Before the first await: still inside the player's tap.
  if (!benchMode) fullscreenForTouch();
  const name = callsign.value.trim().slice(0, 16) || t('lobby.fallbackName');
  const via = modeOf(action);
  if (!benchMode) {
    store.set('name', name); store.set('mode', via); store.set('team', team); store.set('skill', skill);
    saveForm();
  }
  const kinds: Record<Action, PlayKind> = { quick: 'online', start: isPublic ? 'start' : 'private', room: 'room', code: 'code', solo: 'solo', range: 'practice' };
  // Quick Play, a listed room and a code choose no rules; Start, Solo and Practice send the form's.
  const ruled = action === 'start' || action === 'solo' || action === 'range';
  // An online match goes to the chosen server (connectOnline reads the same choice).
  const playServer: ServerId | undefined = via === 'online' ? currentServer()?.id : undefined;
  track('play_clicked', { kind: kinds[action], size: ruled ? sizeOf(size).label : '', mode: ruled ? mode : '', map: ruled ? map : '', ...(playServer ? { server_choice: playServer } : {}) }, { set: { name, lang: lang(), quality } });
  starting = action; closePop(false); refresh();
  options.hide();
  choicePings.setActive(false);
  status.textContent = '';
  unwatchRooms();
  inMenu = false;
  audio.start();
  if (params.has('audiodebug')) void import('./audio-probe').then(m => m.startAudioProbe(audio));
  audio.stopMusic();
  const teamChoice = team === 'auto' ? undefined : (Number(team) as Team);
  const botSkill = Math.max(0.1, Math.min(0.95, Number(skill) || 0.45));
  const rules = offlineRules();
  const how: OnlineEntry = action === 'code' ? { kind: 'code', code: cleanCode(roomCode.value) }
    : action === 'room' ? { kind: 'room', room: joiningRoom }
    : action === 'start' ? { kind: 'start', size: perTeam(), mode, mapId: map, bots, isPublic }
    : { kind: 'any' };
  let link: GameLink;
  try {
    link = via === 'online'
      ? await connectOnline(name, teamChoice, how, s => { status.textContent = s; })
      : via === 'lab'
        ? new OfflineLink(rules.mapId, name, teamChoice, {}, true)
        : new OfflineLink(rules.mapId, name, teamChoice, { ...(rules.mode === 'sabotage' ? SABOTAGE : ELIMINATION), teamSize: perTeam(), botSkill, freeBuy: params.has('freebuy') });
  } catch (error) {
    const room = joiningRoom;
    starting = undefined; joiningRoom = -1;
    inMenu = !benchMode; menuMusic();
    // The server could not be reached (it fell asleep under a lobby that still looked connected,
    // after a laptop slept say): wake it and join once it is up. Only once: a second failure is shown.
    if (error instanceof ConnectError && via === 'online' && !retried && !benchMode) {
      status.textContent = '';
      watchLobbyRooms();
      wake.queue({ action, room, retried: true });
      return;
    }
    status.textContent = t('lobby.couldNotJoin', { error: serverError((error as Error).message) });
    track('error_shown', { where: 'join', message: String((error as Error)?.message ?? error).slice(0, 120) });
    watchLobbyRooms(); refresh();
    return;
  }
  starting = undefined; joiningRoom = -1;
  status.textContent = '';
  if (backdrop) { renderer.scene.remove(backdrop.group); backdrop = undefined; backdropMap = undefined; }
  const linkMap = link.state()?.mapId ?? rules.mapId;
  launch(link, linkMap);
  joined(link, linkMap, playServer);
  matchServer = playServer;
  // The map's own files have loaded by now: cache them too on a first visit.
  setTimeout(warmServiceWorker, 15000);
  menu.hidden = true;
  document.body.classList.remove('menu-open');
  await game?.input.lock()?.catch?.(() => undefined);
}

function launch(link: GameLink, map: string) {
  game = new Game(assets, renderer, link, map, audio, app);
  if (benchMode && !bench) startBench(game);
  game.onMapChange = next => { game?.stop(true); launch(link, next); };
  game.onExit = how => backToLobby('menu', '', how);
}
/** Leave the match for the lobby: chosen (menu), or because the server removed us or the connection dropped. */
function backToLobby(reason: 'menu' | 'disconnect', message = '', exit?: Exit) {
  if (!game) return;
  leftMatch(reason, exit);
  game.stop(); game = undefined;
  track('lobby_view', {});
  document.body.classList.add('menu-open'); menu.hidden = false;
  syncOptions();
  inMenu = !benchMode; menuMusic();
  watchLobbyRooms(); refresh();
  if (message) status.textContent = message;
}
/** The server of the online match being played (for a rejoin after a dropped connection). */
let matchServer: ServerId | undefined;

/** Analytics: we are in a match (once per link; online map rotations keep the same session). */
function joined(link: GameLink, map: string, serverChoice: ServerId | undefined, rejoin = false) {
  const state = link.state(), me = state?.soldiers.find(s => s.id === link.myId());
  const config = state?.config;
  const info = link.roomInfo?.();
  matchJoined({
    online: link.mode === 'online', ...(info ? { room: info.code || `public-${info.room}` } : {}), map,
    mode: config?.mode ?? 'elimination', size: config?.practice ? 'practice' : sizeLabel(config?.teamSize ?? perTeam()), team: me?.team === 1 ? 'militia' : 'swat',
    ...(serverChoice ? { server_choice: serverChoice } : {}), device: currentDeviceKind(), ...(rejoin ? { rejoin: true } : {}),
  });
  // The server removed us (it stopped hearing from this client) or the connection dropped: back to
  // the lobby with a note, rather than playing on against a frozen match the server no longer runs.
  // A dropped connection (a phone that slept, an in-app browser sent to the background, a network
  // blip) reconnects and rejoins the same room first.
  if (link instanceof OnlineLink) link.onDrop = () => {
    if (link.dropReason === 'lost' && !benchMode && link.entry) void rejoinAfterDrop(link);
    else backToLobby('disconnect', t(link.dropReason === 'removed' ? 'net.removed' : 'net.lost'), link.dropReason === 'removed' ? 'removed' : 'lost');
  };
}

/** Tries to reconnect, waiting for the page to be visible first (a backgrounded app cannot connect). */
const REJOIN_TRIES = 3;
const visible = () => new Promise<void>(resolve => {
  if (document.visibilityState === 'visible') { resolve(); return; }
  const on = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', on); resolve(); } };
  document.addEventListener('visibilitychange', on);
});

/**
 * The connection dropped mid-match: say so over the frozen view, reconnect (same identity) and join the
 * same room again by its code or number. Only after a few failed tries is the player sent to the lobby.
 */
async function rejoinAfterDrop(old: OnlineLink) {
  const playing = game;
  if (!playing || !old.entry) return;
  const info = old.roomInfo();
  const how: OnlineEntry = info?.code ? { kind: 'code', code: info.code } : info ? { kind: 'room', room: info.room } : old.entry.how;
  const note = document.createElement('div');
  note.className = 'reconnecting';
  note.setAttribute('role', 'status');
  note.innerHTML = `<b>${esc(t('net.reconnecting'))}</b><small>${esc(t('net.reconnectingSub'))}</small>`;
  document.body.appendChild(note);
  try {
    for (let i = 0; i < REJOIN_TRIES; i++) {
      await visible();
      if (game !== playing) return; // left meanwhile
      try {
        const team = old.entry.team === 0 || old.entry.team === 1 ? old.entry.team as Team : undefined;
        const link = await connectOnline(old.entry.name, team, how, () => undefined);
        if (game !== playing) { link.dispose(); return; }
        leftMatch('disconnect', 'lost');
        playing.stop(); game = undefined;
        const map = link.state()?.mapId ?? playing.mapId;
        launch(link, map);
        joined(link, map, matchServer, true);
        return;
      } catch { await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
    }
    backToLobby('disconnect', t('net.lost'), 'lost');
  } finally { note.remove(); }
}
/** Analytics: the match is over for us (sent once per match). */
function leftMatch(reason: Reason, exit?: Exit) {
  const link = game?.link, me = link?.state()?.soldiers.find(s => s.id === link.myId());
  // Online: the match's connection quality, and its last report to the server.
  matchLeft(reason, { kills: me?.kills ?? 0, deaths: me?.deaths ?? 0 }, link instanceof OnlineLink ? link.netLeft() : undefined, exit);
}
// Closing the tab mid-match: match_left goes out by beacon.
addEventListener('pagehide', () => leftMatch('close', 'close'));

/** Fullscreen on or off. Entering it can drop pointer lock, so recapture after. */
function toggleFullscreen() {
  if (document.fullscreenElement) { void document.exitFullscreen().catch(() => undefined); return; }
  const relock = !!game?.input.locked;
  void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => {
    if (relock && game && !game.input.locked) void game.input.lock()?.catch?.(() => undefined);
  }, () => undefined);
}
// Fullscreen and leave bound to a mouse button (the left one never: it clicks the menu).
document.addEventListener('mousedown', e => {
  const code = `Mouse${e.button}`;
  if (matches('fullscreen', code)) toggleFullscreen();
  else if (matches('leave', code) && game && !game.input.locked) leaveByKey();
});
/**
 * The leave key (M) or mouse button: a match is left only after "Leave the match?" (it was too easy to
 * press by accident, after Esc or Alt-Tab freed the mouse); on the end screen it leaves at once.
 */
function leaveByKey() {
  if (!game || game.input.locked || document.querySelector('.ask-dialog')) return;
  if (game.link.state()?.phase === 'ended') { game.onExit?.('leave_key'); return; }
  confirmDialog({ title: t('leave.title'), why: t('leave.why'), go: t('leave.go'), stay: t('leave.stay'), done: () => game?.onExit?.('leave_key') });
}

/** How long to wait for the browser to hand the graphics back before offering a reload. */
const GFX_RESTORE_MS = 6000;
let gfxTimer = 0;
/**
 * The browser took the graphics context away (a black screen; phones do it to apps in the background):
 * say it is being restored, and offer a reload only if it does not come back.
 */
function graphicsLost() {
  if (document.querySelector('.gfx-lost')) return;
  const el = document.createElement('div');
  el.className = 'gfx-lost';
  el.setAttribute('role', 'alert');
  el.innerHTML = `<p>${esc(t('gfx.restoring'))}</p>`;
  document.body.appendChild(el);
  clearTimeout(gfxTimer);
  gfxTimer = window.setTimeout(() => {
    el.innerHTML = `<p>${esc(t('gfx.lost'))}</p><button type="button">${esc(t('gfx.reload'))}</button>`;
    el.querySelector('button')!.addEventListener('click', () => location.reload());
  }, GFX_RESTORE_MS);
}
/** The graphics are back (three.js rebuilds its GPU state by itself): carry on. */
function graphicsRestored() {
  clearTimeout(gfxTimer);
  document.querySelector('.gfx-lost')?.remove();
  renderer.resize();
}

const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
document.addEventListener('keydown', e => {
  // The leave key (M) from the in-game menu (the mouse is free): back to the lobby.
  if (matches('leave', e.code) && game && !game.input.locked && e.target === document.body) leaveByKey();
  // Fullscreen (F, BeGone's default key).
  if (matches('fullscreen', e.code) && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e)) toggleFullscreen();
  // Esc in the lobby: close the settings dialog, else the open popover.
  if (e.key === 'Escape' && !game && !menu.hidden) {
    if (options.open) { e.preventDefault(); options.close(); return; }
    if (openPop) { e.preventDefault(); closePop(); }
    return;
  }
  // Enter: the code box joins, an open Solo popover starts it, else the tab's big button (Quick Play or Start).
  if (e.key === 'Enter' && !e.repeat && !game && !menu.hidden && !options.open && !e.isComposing) {
    const target = e.target as HTMLElement;
    if (target === roomCode) { e.preventDefault(); run('code'); return; }
    // Buttons and links keep their own Enter.
    if (target.closest('button, summary, a')) return;
    e.preventDefault();
    if (openPop?.id === 'solo-pop') run('solo');
    else if (tab === 'quick') run('quick');
    else if (tab === 'start') run('start');
  }
});

function startBench(g: Game) {
  bench = new Bench(g, renderer, quality);
  benchBanner = document.createElement('div');
  benchBanner.className = 'bench-banner';
  app.appendChild(benchBanner);
  bench.onDone = result => { benchBanner?.remove(); showBenchResult(result); };
}

let benchPanel: HTMLElement | undefined;
let benchResult: BenchResult | undefined;
function showBenchResult(r: BenchResult) {
  const panel = benchPanel = document.createElement('div');
  benchResult = r;
  panel.className = 'bench-panel';
  panel.innerHTML = `
    <h2>${t('bench.title')}</h2>
    <div class="verdict ${r.meets60 ? 'ok' : 'bad'}">${t(r.meets60 ? 'bench.met' : 'bench.notMet')}</div>
    <table>${benchReport(r).map(([k]) => `<tr><th>${t(k)}</th><td></td></tr>`).join('')}</table>
    <p>${t('bench.about', { n: r.seconds })}</p>
    <div class="actions"><button data-a="copy">${t('bench.copy')}</button><button data-a="again">${t('bench.again')}</button><button data-a="menu">${t('bench.menu')}</button></div>`;
  // Values go in as text: the GPU string comes from the driver.
  panel.querySelectorAll('td').forEach((td, i) => { td.textContent = benchReport(r)[i][1]; });
  panel.addEventListener('click', e => {
    const a = (e.target as HTMLElement).dataset.a;
    if (a === 'copy') void navigator.clipboard?.writeText(JSON.stringify(r, null, 2)).then(() => { (e.target as HTMLElement).textContent = t('bench.copied'); }, () => undefined);
    if (a === 'again') location.reload();
    if (a === 'menu') location.href = location.pathname + (params.get('lang') ? `?lang=${params.get('lang')}` : '');
  });
  app.appendChild(panel);
  document.body.classList.add('bench-done');
  document.exitPointerLock?.();
}

/** What ?autostart (and the dev hook) runs: ?room joins by code, else the remembered or given `mode`. */
const startAction = (): Action => benchMode ? 'solo' : params.get('room') ? 'code' : startMode === 'offline' ? 'solo' : startMode === 'lab' ? 'range' : online.ok ? 'quick' : 'solo';

async function boot() {
  renderer = new Renderer(app, QUALITY[quality]);
  // The page's own failures go to PostHog; a lost graphics context also asks the player to reload.
  watchClientErrors(renderer.renderer.domElement, () => !!game, graphicsLost, graphicsRestored);
  // Chinese UI: fetch the CJK face with the assets, so the first screens never show a fallback font.
  const fonts = isZh() ? cjkFontReady('繁體中文') : Promise.resolve();
  assets = await loadAssets(f => { loadFraction = f; renderQuick(); renderStart(); renderOthers(); });
  await fonts;
  ready = true;
  warmServiceWorker();
  refresh();
  if (params.get('room') && !params.get('autostart')) roomCode.focus({ preventScroll: true });
  if (!benchMode) {
    theme = renderTheme();
    theme.then(menuMusic, error => console.warn('Menu theme unavailable', error));
  }
  let previous = performance.now();
  let angle = 0.6;
  // Dev/test: ?fixeddt advances exactly 1/30 s per rendered frame; ?capture steps only on demand.
  const fixed = import.meta.env.DEV && (params.has('fixeddt') || params.has('capture'));
  const step = (dt: number, now: number, render = true) => {
    if (game) game.frame(dt, render);
    else {
      angle += dt * 0.04;
      renderer.camera.position.set(Math.cos(angle) * 70, 26, Math.sin(angle) * 52);
      renderer.camera.lookAt(0, 2, 0);
      renderer.camera.fov = 60; renderer.camera.updateProjectionMatrix();
      backdrop?.update(now / 1000);
      renderer.render(now / 1000);
    }
  };
  let benchLeft = -1;
  const loop = (now: number) => {
    const interval = now - previous;
    const dt = fixed ? 1 / 30 : Math.max(0, Math.min(0.05, interval / 1000)); previous = now;
    const t0 = performance.now();
    if (bench && !bench.done && game) bench.drive(dt);
    step(dt, now);
    if (bench && !bench.done) {
      bench.record(interval, performance.now() - t0);
      const left = Math.ceil(bench.remaining);
      if (left !== benchLeft && benchBanner) { benchLeft = left; benchBanner.textContent = bench.warming ? t('bench.warming') : t('bench.left', { n: left }); }
    }
    requestAnimationFrame(loop);
  };
  if (!params.has('capture')) requestAnimationFrame(loop);
  let simNow = 0;
  /** Advance n fixed frames (capture mode). Returns once the frames are rendered. */
  const stepFrames = (n: number, render = true) => { for (let i = 0; i < n; i++) { simNow += 1000 / 30; step(1 / 30, simNow, render && i === n - 1); } return n; };
  // An online ?autostart waits for a sleeping server like a pressed button does.
  const startNow = () => { const action = startAction(); return modeOf(action) === 'online' ? run(action) : start(action); };
  if (params.get('autostart') || benchMode) void startNow();
  if (import.meta.env.DEV) Object.assign(window, { __lb: { get game() { return game; }, get bench() { return bench; }, renderer, assets, step: stepFrames, start: startNow } });
}

void boot().catch(error => {
  console.error(error);
  track('error_shown', { where: 'boot', message: String((error as Error)?.message ?? error).slice(0, 120) });
  status.textContent = t('lobby.unableToStart', { error: (error as Error).message });
});
