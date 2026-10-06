import { inject } from '@vercel/analytics';
import { RETIRED_MAPS, loadMap, mapSummaries } from '../shared/maps/index';
import { cleanCode, hasSites, mapsFor, newRoomRules, pickRoom, roomFull, roomMatches, ROOM_SIZES, sizeLabel, type RoomFilter } from '../shared/match/rooms';
import { ELIMINATION, SABOTAGE, type Mode, type Team } from '../shared/match/state';
import { loadAssets, type Assets } from './assets';
import { Audio } from './audio';
import { Game } from './game/game';
import { settings } from './game/settings';
import { loadLayout, matches } from './game/keybinds';
import type { GameLink } from './game/link';
import { OfflineLink } from './game/offline';
import { Bench, BENCH_SECONDS, benchReport, type BenchResult } from './game/bench';
import { onlineAvailable, onlineConfig, connectOnline, watchRooms, OnlineLink, type OnlineEntry, type PublicRoom } from './net/online';
import { matchJoined, matchLeft, setSuper, startAnalytics, track, type PlayKind, type Reason } from './analytics';
import { LevelView } from './render/level';
import { THEMES } from './render/materials';
import { QUALITY, Renderer } from './render/renderer';
import { renderTheme, THEME_START } from './theme';
import { SettingsMenu, type GraphicsQuality, type SettingsTab } from './ui/settingsmenu';
import { cjkFontReady } from './ui/fonts';
import { drawMapThumb } from './ui/mapthumb';
import { L, applyI18n, escapeHtml as esc, isZh, lang, mapName as localMapName, mapRegion, modeName, onLang, plural, serverError, sizeName, t, type Key } from './ui/i18n';
import './style.css';
import './menu.css';
import './ui/lang-zh.css';

inject();

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
 * Ways into a match. `play` is the primary one (Play Online with the filters); the rest are the
 * live room list (`room`), the bottom row (`solo`, `range`, `private`) and the code box (`code`).
 */
type Action = 'play' | 'room' | 'solo' | 'range' | 'private' | 'code';
/** How the match is reached, as storage and `?mode=` speak it. */
const modeOf = (a: Action) => a === 'solo' ? 'offline' : a === 'range' ? 'lab' : 'online';

const menu = document.createElement('div');
menu.id = 'menu';
const maps = mapSummaries();
const mapName = (id: string) => localMapName(id, maps.find(m => m.id === id)?.name ?? id);
const server = onlineConfig();
const online = onlineAvailable();
/** Featured first in the map row's shortcuts: Taipei's two maps, then the usual order. */
const FEATURED = ['taipei', 'xinyi', ...maps.map(m => m.id).filter(id => id !== 'taipei' && id !== 'xinyi')];

const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.84 1.84M7.34 16.66 5.5 18.5M18.5 18.5l-1.84-1.84M7.34 7.34 5.5 5.5"/><circle cx="12" cy="12" r="6.4"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"/></svg>';
const CARET = '<svg class="caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const LOCK = '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const ROTATE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>';

/** Segmented buttons; `items` are [value, label HTML] (labels built with `L` follow the language). */
const choice = (group: string, attr: string, items: [string, string][], label: Key) =>
  `<div class="choices segmented" id="${group}" style="--n:${items.length}" role="group" aria-label="${t(label)}" data-i18n-aria-label="${label}">${items.map(([v, text]) => `<button type="button" class="choice" data-${attr}="${v}"><b>${text}</b></button>`).join('')}</div>`;
const pop = (id: string, label: Key, body: string) =>
  `<div class="pop" id="${id}" role="dialog" aria-label="${t(label)}" data-i18n-aria-label="${label}" hidden>${body}</div>`;

/*
 * Top: the name, team, controls and settings. Left panel: the filters (size, mode, map), PLAY ONLINE,
 * the live rooms those filters match, and one row of other ways in. Right: the live battlefield
 * backdrop with the map in view. The map picker and the Solo / Private room options are popovers.
 */
menu.innerHTML = `
  <header class="top">
    <div class="brand"><h1 class="logo" id="logo"></h1></div>
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
    <div class="filters" role="group" aria-label="${t('lobby.filters')}" data-i18n-aria-label="lobby.filters">
      <div class="frow">${L('lobby.field.size', 'span', 'class="label"')}
        <div class="choices segmented sizes" id="sizes" style="--n:${SIZES.length}" role="group" aria-label="${t('lobby.roomSize')}" data-i18n-aria-label="lobby.roomSize">${SIZES.map(s => `<button type="button" class="choice" data-size="${s.id}"><b>${s.label}</b><small>${L(`size.${s.id}`)}${s.perTeam > 12 ? ` · ${L('lobby.bigMaps')}` : ''}</small></button>`).join('')}</div>
      </div>
      <div class="frow">${L('lobby.field.mode', 'span', 'class="label"')}
        ${choice('modes', 'gamemode', [['', L('lobby.any')], ['elimination', `<span class="mtag">[E]</span> ${L('mode.elimination')}`], ['sabotage', `<span class="mtag">[S]</span> ${L('mode.sabotage')}`]], 'lobby.field.mode')}
      </div>
      <div class="frow">${L('lobby.field.map', 'span', 'class="label"')}
        <div class="mapline">
          <button type="button" class="map-trigger" id="map-trigger" aria-haspopup="dialog" aria-expanded="false" aria-controls="map-pop"><i class="sw"></i><b></b><small></small>${CARET}</button>
          <div class="quick-maps" id="quick-maps" role="group" aria-label="${t('lobby.field.map')}" data-i18n-aria-label="lobby.field.map"></div>
          <p class="notice" id="map-notice" role="status"></p>
        </div>
      </div>
    </div>

    <div class="play-block">
      <button type="button" class="deploy" id="play" disabled><span class="deploy-l">${PLAY}<span class="deploy-t">${t('lobby.loading')}</span></span><span class="deploy-r" id="play-summary"></span></button>
      <p class="rooms-line" id="rooms-line"><span class="conn" id="conn"><i></i></span><span id="play-hint"></span></p>
    </div>

    <section class="browser" id="browser" aria-labelledby="rooms-title">
      <div class="browser-head"><b id="rooms-title" data-i18n="lobby.liveRooms">${t('lobby.liveRooms')}</b>${L('lobby.matching', 'small')}<span class="count" id="rooms-count"></span></div>
      <div class="browser-rows" id="rooms" role="list"></div>
      <div class="browser-foot" id="rooms-foot"></div>
    </section>

    <nav class="others" aria-label="${t('lobby.more')}" data-i18n-aria-label="lobby.more">
      <button type="button" class="sub" id="open-solo" aria-haspopup="dialog" aria-expanded="false" aria-controls="solo-pop">${L('lobby.solo')}</button>
      <button type="button" class="sub" id="go-range" title="${t('lobby.rangeHint')}" data-i18n-title="lobby.rangeHint">${L('lobby.sub.range')}</button>
      <button type="button" class="sub" id="open-private" aria-haspopup="dialog" aria-expanded="false" aria-controls="private-pop">${L('lobby.sub.create')}</button>
      <div class="code-box" title="${t('lobby.codeHint')}" data-i18n-title="lobby.codeHint">
        <span class="hash" aria-hidden="true">#</span>
        <input type="text" id="roomcode" maxlength="4" autocomplete="off" spellcheck="false" placeholder="${t('lobby.codeShort')}" data-i18n-placeholder="lobby.codeShort" aria-label="${t('lobby.roomCode')}" data-i18n-aria-label="lobby.roomCode">
        <button type="button" class="code-go" id="join-go" disabled>${t('common.join')}</button>
      </div>
    </nav>
    <p class="unavailable" id="online-off"></p>
    <div class="status" id="status" role="status"></div>
  </section>
  <section class="stage">
    <div class="showcase" id="showcase"><h2></h2><div class="meta"></div></div>
  </section>
  ${pop('map-pop', 'lobby.chooseMap', `<div class="pop-head"><b>${L('lobby.chooseMap')}</b><small id="map-pop-sub"></small></div><div class="map-grid" id="map-grid"></div>`)}
  ${pop('solo-pop', 'lobby.solo', `<div class="pop-head"><b>${L('lobby.solo')}</b><small class="rules" id="solo-rules"></small></div>
    <div class="field">${L('lobby.field.skill', 'span', 'class="label"')}${choice('skills', 'skill', [['0.25', L('lobby.skill.recruit')], ['0.45', L('lobby.skill.veteran')], ['0.75', L('lobby.skill.elite')]], 'lobby.field.skill')}</div>
    <button type="button" class="go" id="solo-go">${t('lobby.startMatch')}</button>${L('lobby.botsHint', 'p', 'class="hint"')}`)}
  ${pop('private-pop', 'lobby.sub.create', `<div class="pop-head"><b>${L('lobby.sub.create')}</b><small class="rules" id="private-rules"></small></div>
    <div class="field">${L('lobby.field.bots', 'span', 'class="label"')}${choice('botsfills', 'botsfill', [['on', L('lobby.bots.on')], ['off', L('lobby.bots.off')]], 'lobby.field.bots')}</div>
    <button type="button" class="go" id="private-go">${t('lobby.createRoom')}</button>${L('lobby.createHint', 'p', 'class="hint"')}`)}`;
app.appendChild(menu);
document.body.classList.add('menu-open');

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => menu.querySelector<T>(sel)!;
const select = (group: string, attr: string, value: string) => menu.querySelectorAll<HTMLButtonElement>(`#${group} [data-${attr}]`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));

// ---- Initial choices: URL flags first, then what this browser remembered. ----
const MODE_ALIASES: Record<string, string> = { solo: 'offline', practice: 'lab' };
let startMode = params.get('mode') ?? store.get('mode', online.ok ? 'online' : 'offline');
startMode = MODE_ALIASES[startMode] ?? startMode;
let size: SizeId = sizeOf(params.get('size') ?? store.get('size', 'squad')).id;
/** The filters: '' = any mode / any map. */
let modeF = (params.get('game') ?? store.get('lobby.mode', '')) as Mode | '';
if (modeF !== '' && modeF !== 'elimination' && modeF !== 'sabotage') modeF = '';
let mapF = params.get('map') ?? store.get('lobby.map', '');
// A remembered map that has since been retired falls back to Any (a ?map= link still opens it).
if (mapF && (!maps.some(m => m.id === mapF) || (RETIRED_MAPS.has(mapF) && !params.get('map')))) mapF = '';
// A map from the URL picks the size that plays it (?map=meridian is a 24v24 map) and drops a mode it cannot host.
if (params.get('map') && mapF) {
  if (!mapsFor(sizeOf(size).perTeam).includes(mapF) && !params.get('size')) size = SIZES.find(s => mapsFor(s.perTeam).includes(mapF))?.id ?? size;
  if (modeF === 'sabotage' && !hasSites(mapF)) modeF = '';
}
let botsFill = store.get('botsFill', 'on');
let team = params.get('team') ?? store.get('team', 'auto');
let skill = params.get('skill') ?? store.get('skill', '0.45');
let quality = (params.get('quality') ?? store.get('quality', 'medium')) as keyof typeof QUALITY;
if (!QUALITY[quality]) quality = 'medium';
/** ?bench: scripted solo run that measures frame times on this device (Elimination, Squad unless ?size). */
const benchMode = params.has('bench');
if (benchMode) { modeF = 'elimination'; size = sizeOf(params.get('size') ?? 'squad').id; }
const callsign = $<HTMLInputElement>('#callsign');
callsign.value = params.get('name') ?? store.get('name', t('lobby.defaultName', { n: Math.floor(Math.random() * 900 + 100) }));
const roomCode = $<HTMLInputElement>('#roomcode');
roomCode.value = cleanCode(params.get('room') ?? '');
const playBtn = $<HTMLButtonElement>('#play');
const status = $('#status');
if (!online.ok) {
  menu.classList.add('no-server');
  $('#online-off').dataset.i18n = 'lobby.noServer';
  $('#online-off').textContent = t('lobby.noServer');
}

const perTeam = () => sizeOf(size).perTeam;
const filter = (): RoomFilter => ({ size: perTeam(), mode: modeF, map: mapF });
/** Maps the size (and the mode filter) can play. */
const validMaps = () => mapsFor(perTeam(), modeF || undefined);
const mapOk = (id: string) => validMaps().includes(id);

// ---- Live rooms: a light subscription to the server's room rows while the lobby is open. ----
let rooms: PublicRoom[] = [];
let roomsState: 'connecting' | 'live' | 'offline' = 'offline';
let stopRooms: (() => void) | undefined;
let roomsGen = 0;
let roomsRetry: ReturnType<typeof setTimeout> | undefined;
/** "Server offline" is reported to analytics once per page, not on every retry. */
let roomsErrorShown = false;
function watchLobbyRooms() {
  unwatchRooms();
  if (!online.ok || benchMode) { refresh(); return; }
  const gen = ++roomsGen;
  void watchRooms(list => { if (gen !== roomsGen) return; rooms = list; refresh(); }, state => {
    if (gen !== roomsGen) return;
    roomsState = state;
    if (state === 'offline') {
      rooms = [];
      if (!roomsErrorShown) { roomsErrorShown = true; track('error_shown', { where: 'rooms', message: 'server offline' }); }
      // The server may come back: try again while the lobby stays open.
      roomsRetry = setTimeout(() => { if (gen === roomsGen && inMenu) watchLobbyRooms(); }, 5000);
    }
    refresh();
  }).then(stop => { if (gen === roomsGen) stopRooms = stop; else stop(); }, () => { if (gen === roomsGen) { roomsState = 'offline'; refresh(); } });
}
function unwatchRooms() {
  roomsGen++;
  clearTimeout(roomsRetry);
  stopRooms?.(); stopRooms = undefined;
}
const roomStatus = (r: PublicRoom) => r.phase === 'warmup' ? t('lobby.warmup') : r.phase === 'ended' ? t('lobby.matchOver') : t('lobby.round', { n: r.round });
const players = (n: number, max: number) => t('common.players', { n, max });
const modeLabel = (m: Mode) => `[${MODE_TAGS[m]}] ${modeName(m)}`;
/** The room PLAY ONLINE would put us in (the server makes the same choice with `pickRoom`). */
const playTarget = () => pickRoom(rooms, filter());
/** Rooms the filters show, fullest first. */
const shownRooms = () => rooms.filter(r => roomMatches(r, filter()));
/** Humans in public rooms of this size (and mode filter) per map: the map picker's live counts. */
function liveByMap() {
  const counts = new Map<string, number>();
  for (const r of rooms) if (roomMatches(r, { size: perTeam(), mode: modeF, map: '' })) counts.set(r.mapId, (counts.get(r.mapId) ?? 0) + r.humans);
  return counts;
}
/** "6v6 · [S] Sabotage · Ximending": the filters in a few words (only what is set; "Any" when nothing is). */
function rulesText(withSize = true) {
  const parts = [withSize ? sizeOf(size).label : '', modeF ? modeName(modeF) : '', mapF ? mapName(mapF) : ''].filter(Boolean);
  if (!modeF && !mapF) parts.push(t('lobby.any'));
  return parts.join(' · ');
}

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

// ---- Rendering: everything on screen follows the filters, the rooms and the language. ----
let ready = false;
let starting: Action | undefined;
let loadFraction = -1;
let joiningRoom = -1;
const loadingText = () => loadFraction < 0 ? t('lobby.loading') : t('lobby.loadingPct', { n: (loadFraction * 100).toFixed(0) });

function renderFilters() {
  select('sizes', 'size', size);
  select('modes', 'gamemode', modeF);
  select('teams', 'team', team);
  select('skills', 'skill', skill);
  select('botsfills', 'botsfill', botsFill);
  const trigger = $('#map-trigger');
  const m = maps.find(x => x.id === mapF);
  trigger.dataset.theme = m?.theme ?? '';
  trigger.classList.toggle('any', !m);
  trigger.querySelector('b')!.textContent = m ? mapName(m.id) : t('lobby.anyMap');
  const live = liveByMap();
  const n = m ? live.get(m.id) ?? 0 : [...live.values()].reduce((a, b) => a + b, 0);
  trigger.querySelector('small')!.textContent = n ? t('lobby.playing', { n }) : '';
  // Shortcuts: up to three featured maps the filters allow (not the one chosen); the picker has them all.
  const quick = FEATURED.filter(id => id !== mapF && mapOk(id)).slice(0, 3);
  const box = $('#quick-maps');
  const key = `${quick.join()}|${[...live].join()}|${isZh()}`;
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = quick.map(id => {
      const c = live.get(id) ?? 0;
      return `<button type="button" class="qmap" data-pick="${id}" data-theme="${maps.find(x => x.id === id)?.theme ?? ''}">${esc(mapName(id))}${c ? `<small>${c}</small>` : ''}</button>`;
    }).join('');
  }
}

/** PLAY ONLINE and the line under it: where it would put you, or that it opens a room. */
function renderPlay() {
  const label = playBtn.querySelector('.deploy-t')!;
  label.textContent = !ready ? loadingText() : starting === 'play' ? t('lobby.joining') : t('lobby.playOnline');
  $('#play-summary').textContent = ready ? rulesText() : '';
  playBtn.disabled = !ready || !!starting || !online.ok;
  const line = $('#rooms-line');
  line.hidden = !online.ok;
  if (!online.ok) return;
  const target = playTarget();
  const fixed = [modeF ? modeName(modeF) : '', mapF ? mapName(mapF) : ''].filter(Boolean).join(' · ');
  const [state, text] = roomsState === 'connecting' ? ['wait', t('lobby.connecting')]
    : roomsState === 'offline' ? ['off', t('lobby.serverOffline')]
    : target ? ['live', t('lobby.playJoins', { map: mapName(target.mapId), mode: modeName(target.mode), players: players(target.humans, target.size * 2) })]
    : ['live', fixed ? t('lobby.opensFixed', { rules: fixed }) : t('lobby.opensAny')];
  $('#conn').className = `conn ${state}`;
  line.title = roomsState === 'live' ? t('lobby.liveTitle', { db: server.database ?? 'online' }) : '';
  $('#play-hint').textContent = text;
}

/** Live rooms the filters match: fixed-height rows in a box that keeps its size as rooms come and go. */
function renderRooms() {
  const list = $('#rooms');
  const shown = shownRooms();
  const humans = shown.reduce((n, r) => n + r.humans, 0);
  $('#rooms-count').innerHTML = roomsState === 'live' && shown.length ? `<span class="conn live"><i></i>${plural('lobby.roomCount', shown.length)} · ${plural('lobby.playerCount', humans)}</span>` : '';
  // Keep keyboard focus on the same JOIN button across live updates.
  const focused = (document.activeElement as HTMLElement | null)?.closest?.('[data-joinroom]') as HTMLElement | null;
  const focusRoom = focused && list.contains(focused) ? focused.dataset.joinroom : undefined;
  if (!shown.length) {
    const text = !online.ok ? t('lobby.noServer') : roomsState === 'connecting' ? t('lobby.connecting') : roomsState === 'offline' ? t('lobby.serverOffline') : t('lobby.noMatches');
    list.innerHTML = `<div class="empty">${esc(text)}</div>`;
  } else {
    const target = playTarget();
    list.innerHTML = shown.map(r => {
      const m = maps.find(x => x.id === r.mapId);
      const aria = t('lobby.roomAria', { map: mapName(r.mapId), mode: modeName(r.mode), size: sizeLabel(r.size), n: r.humans, max: r.size * 2, status: roomStatus(r) });
      const busy = !ready || !!starting || roomFull(r);
      const lock = r.fixedMap || r.fixedMode ? `<span class="fixed" title="${esc([r.fixedMap ? t('lobby.fixedMap') : '', r.fixedMode ? t('lobby.fixedMode') : ''].filter(Boolean).join(' · '))}">${LOCK}</span>` : '';
      return `<div class="room${target?.room === r.room ? ' target' : ''}" role="listitem" data-room="${r.room}" data-theme="${m?.theme ?? ''}">
        <span class="srv"><b>${esc(mapName(r.mapId))}</b>${lock}</span>
        <span class="mode" title="${esc(modeName(r.mode))}"><span class="mtag">[${MODE_TAGS[r.mode]}]</span><span class="mname"> ${esc(modeName(r.mode))}</span></span>
        <span class="players">${r.humans}/${r.size * 2}</span>
        <span class="state ${r.phase}">${esc(roomStatus(r))}</span>
        <button type="button" class="join" data-joinroom="${r.room}" aria-label="${esc(`${roomFull(r) ? t('common.full') : t('common.join')} · ${aria}`)}"${busy ? ' disabled' : ''}>${starting === 'room' && joiningRoom === r.room ? t('lobby.joining') : roomFull(r) ? t('common.full') : t('common.join')}</button>
      </div>`;
    }).join('');
    if (focusRoom) list.querySelector<HTMLElement>(`[data-joinroom="${focusRoom}"]`)?.focus({ preventScroll: true });
  }
  // What the filters hide: other modes and maps (clear them), or rooms of other sizes (switch size).
  const foot = $('#rooms-foot');
  const sameSize = rooms.filter(r => r.size === perTeam()).length;
  const otherSizes = SIZES.filter(s => s.perTeam !== perTeam()).map(s => [s, rooms.filter(r => r.size === s.perTeam).length] as const).filter(([, n]) => n > 0);
  const parts: string[] = [];
  if (shown.length < rooms.length) parts.push(`<span>${esc(t('lobby.showing', { n: shown.length, m: rooms.length }))}</span>`);
  if (shown.length < sameSize) parts.push(`<button type="button" class="link" data-clear>${esc(t('lobby.clearFilters'))}</button>`);
  else if (otherSizes.length) parts.push(`<span>${esc(t('lobby.otherSizes'))}</span>${otherSizes.map(([s, n]) => `<button type="button" class="link" data-size="${s.id}">${s.label} (${n})</button>`).join('')}`);
  const html = parts.join('<span class="dot" aria-hidden="true">·</span>');
  if (foot.innerHTML !== html) foot.innerHTML = html;
}

/** The backdrop's map: the chosen map, else where PLAY ONLINE would go, else the first map the size plays. */
const shownMap = () => mapF || playTarget()?.mapId || validMaps()[0] || maps[0].id;

function renderShowcase() {
  const box = $('#showcase');
  const id = shownMap();
  const target = playTarget();
  const s = sizeOf(size);
  box.querySelector('h2')!.textContent = mapF || target ? mapName(id) : `${sizeName(s.id)} ${s.label}`;
  const meta = target
    ? `${t('lobby.playOnline')} · ${modeLabel(target.mode)} · ${sizeLabel(target.size)} · ${players(target.humans, target.size * 2)}`
    : `${t('lobby.newRoom')} · ${modeF ? modeLabel(modeF) : '[E] ⇄ [S]'} · ${s.label}${mapF ? (modeF === 'sabotage' || (!modeF && hasSites(mapF)) ? ` · ${plural('lobby.bombSites', loadMap(mapF).def.sabotage?.sites.length ?? 0)}` : '') : ` · ${t('lobby.mapRotation')}`}`;
  box.querySelector('.meta')!.textContent = meta;
}

function renderOthers() {
  const offlineBusy = !ready || !!starting;
  const solo = $<HTMLButtonElement>('#solo-go'), priv = $<HTMLButtonElement>('#private-go'), range = $<HTMLButtonElement>('#go-range'), join = $<HTMLButtonElement>('#join-go');
  solo.disabled = offlineBusy;
  solo.textContent = !ready ? loadingText() : starting === 'solo' ? t('lobby.starting') : t('lobby.startMatch');
  range.disabled = offlineBusy;
  priv.disabled = offlineBusy || !online.ok;
  priv.textContent = starting === 'private' ? t('lobby.joining') : t('lobby.createRoom');
  $<HTMLButtonElement>('#open-private').disabled = !online.ok;
  roomCode.disabled = !online.ok;
  join.disabled = offlineBusy || !online.ok || roomCode.value.length < 4;
  join.textContent = starting === 'code' ? '…' : t('common.join');
  $('#solo-rules').textContent = rulesText();
  $('#private-rules').textContent = rulesText();
}

/** Everything on screen follows the current choices. */
function refresh() {
  renderBrand();
  renderFilters();
  renderPlay();
  renderRooms();
  renderShowcase();
  renderOthers();
  if (openPop?.id === 'map-pop') renderMapGrid();
  showBackdrop();
}

// ---- Filters ----
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
/** A short note in the map row (e.g. why the map went back to Any); it fades after a few seconds. */
function notice(text: string) {
  const el = $('#map-notice');
  el.textContent = text;
  menu.classList.toggle('noticing', !!text);
  clearTimeout(noticeTimer);
  if (text) noticeTimer = setTimeout(() => notice(''), 4500);
}
/** After a size or mode change: a chosen map the new filters cannot host goes back to Any, with a note. */
function checkMap(reason: 'size' | 'mode') {
  if (!mapF || mapOk(mapF)) return;
  const was = mapName(mapF);
  mapF = '';
  notice(reason === 'size' ? t('lobby.mapResetSize', { map: was, size: sizeOf(size).label }) : t('lobby.mapResetMode', { map: was }));
}
function saveFilters() {
  if (benchMode) return;
  store.set('size', size); store.set('lobby.mode', modeF); store.set('lobby.map', mapF);
}
function setSize(id: string) {
  size = sizeOf(id).id;
  checkMap('size');
  saveFilters(); refresh();
}
function setMode(m: string) {
  modeF = m === 'elimination' || m === 'sabotage' ? m : '';
  checkMap('mode');
  saveFilters(); refresh();
}
function setMap(id: string) {
  mapF = id && mapOk(id) ? id : '';
  notice('');
  saveFilters(); refresh();
}

const audio = new Audio();
const onClick = (attr: string, fn: (value: string, el: HTMLElement) => void) => menu.addEventListener('click', e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(`[data-${attr}]`);
  if (!el || !menu.contains(el) || (el as HTMLButtonElement).disabled) return;
  fn(el.dataset[attr.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())]!, el);
  audio.ui();
});
onClick('size', v => setSize(v));
onClick('gamemode', v => setMode(v));
onClick('pick', v => { setMap(v); closePop(); });
onClick('clear', () => { modeF = ''; mapF = ''; notice(''); saveFilters(); refresh(); });
onClick('team', v => { team = v; select('teams', 'team', team); });
onClick('skill', v => { skill = v; select('skills', 'skill', skill); });
onClick('botsfill', v => { botsFill = v; select('botsfills', 'botsfill', botsFill); });
onClick('joinroom', v => run('room', Number(v)));
roomCode.addEventListener('input', () => { roomCode.value = cleanCode(roomCode.value); renderOthers(); });
playBtn.addEventListener('click', () => { audio.ui(); run('play'); });
$('#go-range').addEventListener('click', () => { audio.ui(); run('range'); });
$('#join-go').addEventListener('click', () => { audio.ui(); run('code'); });
$('#solo-go').addEventListener('click', () => { audio.ui(); run('solo'); });
$('#private-go').addEventListener('click', () => { audio.ui(); run('private'); });
$('#rooms').addEventListener('dblclick', e => { const row = (e.target as HTMLElement).closest<HTMLElement>('.room'); if (row) run('room', Number(row.dataset.room)); });

// ---- Popovers: the map picker, Solo and Private room. One open at a time; Esc or a click outside closes. ----
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
  const side = $('.panel').getBoundingClientRect().right + margin;
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
$('#open-private').addEventListener('click', e => { audio.ui(); showPop('private-pop', e.currentTarget as HTMLElement); });
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

/** The map picker: "Any map" and every map the size (and mode) can play, with a plan, region and who is playing. */
const thumbs = new Map<string, HTMLCanvasElement>();
function thumb(id: string) {
  let c = thumbs.get(id);
  if (!c) { c = document.createElement('canvas'); c.width = 168; c.height = 96; drawMapThumb(c, id); thumbs.set(id, c); }
  return c;
}
function renderMapGrid() {
  const grid = $('#map-grid');
  const live = liveByMap();
  const total = [...live.values()].reduce((a, b) => a + b, 0);
  $('#map-pop-sub').textContent = `${t('lobby.mapsFor', { size: sizeOf(size).label })}${modeF ? ` · ${modeName(modeF)}` : ''}`;
  const small = (m: (typeof maps)[number]) => modeF === 'sabotage' || hasSites(m.id) && modeF !== 'elimination'
    ? t(m.sites > 1 ? 'lobby.sitesAB' : m.sites ? 'lobby.siteA' : 'lobby.noSites') : mapRegion(m.id, m.region).split('/')[0].trim();
  const fits = mapsFor(perTeam());
  const cards = maps.filter(m => fits.includes(m.id)).map(m => {
    const ok = mapOk(m.id), n = live.get(m.id) ?? 0;
    return `<button type="button" class="mcard" data-pick="${m.id}" data-theme="${m.theme}" aria-pressed="${m.id === mapF}"${ok ? '' : ` disabled title="${esc(t('lobby.noSites'))}"`}>
      <span class="thumb" data-thumb="${m.id}"></span>
      <b>${esc(mapName(m.id))}</b>
      <small>${esc(ok ? small(m) : t('lobby.noSites'))}</small>
      <span class="live${n ? ' on' : ''}">${n ? `<i></i>${esc(t('lobby.playing', { n }))}` : '&nbsp;'}</span>
    </button>`;
  });
  grid.innerHTML = `<button type="button" class="mcard any" data-pick="" aria-pressed="${!mapF}">
      <span class="thumb any-thumb">${ROTATE}</span><b>${esc(t('lobby.anyMap'))}</b><small>${esc(t('lobby.anyMapSub'))}</small>
      <span class="live${total ? ' on' : ''}">${total ? `<i></i>${esc(t('lobby.playing', { n: total }))}` : '&nbsp;'}</span>
    </button>${cards.join('')}`;
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
  },
});

// Language switch (Settings): the lobby's own text follows at once.
onLang(next => {
  setSuper({ lang: next });
  track('language_changed', { to: next }, { set: { lang: next } });
  applyI18n(menu);
  $('#quick-maps').dataset.key = '';
  if (benchPanel) { benchPanel.remove(); if (benchResult) showBenchResult(benchResult); }
  refresh();
});
const openOptions = (tab: SettingsTab) => { audio.ui(); closePop(false); options.show(false, tab); };
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
idle(() => startAnalytics({ lang: lang(), online_db: online.ok ? server.database ?? '' : '' }));

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

/** Run one way in. */
function run(action: Action, room = -1) {
  if (!ready || starting) return;
  if (modeOf(action) === 'online' && !online.ok) return;
  if (action === 'code' && roomCode.value.length < 4) { roomCode.focus(); return; }
  if (action === 'room' && !rooms.some(r => r.room === room)) return;
  joiningRoom = room;
  void start(action);
}

/** A concrete map and mode for Solo, Practice and private rooms: the filters, with "any" picked at random. */
function resolveRules() {
  if (benchMode) {
    // The performance check is repeatable: a fixed map rather than a random one.
    const id = mapF && mapsFor(perTeam()).includes(mapF) ? mapF : mapsFor(perTeam())[0];
    return { mapId: params.get('map') && maps.some(m => m.id === params.get('map')) ? params.get('map')! : id, mode: 'elimination' as Mode };
  }
  return newRoomRules(filter(), Math.random);
}

async function start(action: Action) {
  const name = callsign.value.trim().slice(0, 16) || t('lobby.fallbackName');
  const mode = modeOf(action);
  if (!benchMode) {
    store.set('name', name); store.set('mode', mode); store.set('team', team); store.set('skill', skill); store.set('botsFill', botsFill);
    saveFilters();
  }
  const kinds: Record<Action, PlayKind> = { play: 'online', room: 'room', solo: 'solo', range: 'practice', private: 'private', code: 'code' };
  track('play_clicked', { kind: kinds[action], size: sizeOf(size).label, mode: modeF, map: mapF }, { set: { name, lang: lang(), quality } });
  starting = action; closePop(false); refresh();
  options.hide();
  status.textContent = '';
  unwatchRooms();
  inMenu = false;
  audio.start();
  if (params.has('audiodebug')) void import('./audio-probe').then(m => m.startAudioProbe(audio));
  audio.stopMusic();
  const teamChoice = team === 'auto' ? undefined : (Number(team) as Team);
  const botSkill = Math.max(0.1, Math.min(0.95, Number(skill) || 0.45));
  const rules = resolveRules();
  // Practice plays any map; the filters only narrow it when they name one.
  const rangeMap = mapF || rules.mapId;
  const how: OnlineEntry = action === 'code' ? { kind: 'code', code: cleanCode(roomCode.value) }
    : action === 'private' ? { kind: 'create', size: perTeam(), mode: rules.mode, mapId: rules.mapId, bots: botsFill === 'on' }
    : action === 'room' ? { kind: 'room', room: joiningRoom }
    : { kind: 'play', size: perTeam(), mode: modeF, mapId: mapF };
  let link: GameLink;
  try {
    link = mode === 'online'
      ? await connectOnline(name, teamChoice, how, s => { status.textContent = s; })
      : mode === 'lab'
        ? new OfflineLink(rangeMap, name, teamChoice, {}, true)
        : new OfflineLink(rules.mapId, name, teamChoice, { ...(rules.mode === 'sabotage' ? SABOTAGE : ELIMINATION), teamSize: perTeam(), botSkill, freeBuy: params.has('freebuy') });
  } catch (error) {
    status.textContent = t('lobby.couldNotJoin', { error: serverError((error as Error).message) });
    track('error_shown', { where: 'join', message: String((error as Error)?.message ?? error).slice(0, 120) });
    starting = undefined; joiningRoom = -1;
    inMenu = !benchMode; menuMusic();
    watchLobbyRooms(); refresh();
    return;
  }
  starting = undefined; joiningRoom = -1;
  status.textContent = '';
  if (backdrop) { renderer.scene.remove(backdrop.group); backdrop = undefined; backdropMap = undefined; }
  const linkMap = link.state()?.mapId ?? rules.mapId;
  launch(link, linkMap);
  joined(link, linkMap);
  menu.hidden = true;
  document.body.classList.remove('menu-open');
  await game?.input.lock()?.catch?.(() => undefined);
}

function launch(link: GameLink, map: string) {
  game = new Game(assets, renderer, link, map, audio, app);
  if (benchMode && !bench) startBench(game);
  game.onMapChange = next => { game?.stop(true); launch(link, next); };
  game.onExit = () => {
    leftMatch('menu');
    game?.stop(); game = undefined;
    track('lobby_view', {});
    document.body.classList.add('menu-open'); menu.hidden = false;
    syncOptions();
    inMenu = !benchMode; menuMusic();
    watchLobbyRooms(); refresh();
  };
}
/** Analytics: we are in a match (once per link; online map rotations keep the same session). */
function joined(link: GameLink, map: string) {
  const state = link.state(), me = state?.soldiers.find(s => s.id === link.myId());
  const config = state?.config;
  const info = link.roomInfo?.();
  matchJoined({
    online: link.mode === 'online', ...(info ? { room: info.code || `public-${info.room}` } : {}), map,
    mode: config?.mode ?? 'elimination', size: config?.practice ? 'practice' : sizeLabel(config?.teamSize ?? perTeam()), team: me?.team === 1 ? 'militia' : 'swat',
  });
  if (link instanceof OnlineLink) link.onDrop = () => leftMatch('disconnect');
}
/** Analytics: the match is over for us (sent once per match). */
function leftMatch(reason: Reason) {
  const link = game?.link, me = link?.state()?.soldiers.find(s => s.id === link.myId());
  matchLeft(reason, { kills: me?.kills ?? 0, deaths: me?.deaths ?? 0 });
}
// Closing the tab mid-match: match_left goes out by beacon.
addEventListener('pagehide', () => leftMatch('close'));

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
  else if (matches('leave', code) && game && !game.input.locked) game.onExit?.();
});
const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
document.addEventListener('keydown', e => {
  // The leave key (M) from the in-game menu (the mouse is free): back to the lobby.
  if (matches('leave', e.code) && game && !game.input.locked && e.target === document.body) game.onExit?.();
  // Fullscreen (F, BeGone's default key).
  if (matches('fullscreen', e.code) && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e)) toggleFullscreen();
  // Esc in the lobby: close the settings dialog, else the open popover.
  if (e.key === 'Escape' && !game && !menu.hidden) {
    if (options.open) { e.preventDefault(); options.close(); return; }
    if (openPop) { e.preventDefault(); closePop(); }
    return;
  }
  // Enter: the code box joins, an open Solo / Private popover starts it, anywhere else PLAY ONLINE.
  if (e.key === 'Enter' && !e.repeat && !game && !menu.hidden && !options.open && !e.isComposing) {
    const target = e.target as HTMLElement;
    if (target === roomCode) { e.preventDefault(); run('code'); return; }
    // Buttons and links keep their own Enter.
    if (target.closest('button, summary, a')) return;
    e.preventDefault();
    if (openPop?.id === 'solo-pop') run('solo');
    else if (openPop?.id === 'private-pop') run('private');
    else if (online.ok) run('play');
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
const startAction = (): Action => benchMode ? 'solo' : params.get('room') ? 'code' : startMode === 'offline' ? 'solo' : startMode === 'lab' ? 'range' : online.ok ? 'play' : 'solo';

async function boot() {
  renderer = new Renderer(app, QUALITY[quality]);
  // Chinese UI: fetch the CJK face with the assets, so the first screens never show a fallback font.
  const fonts = isZh() ? cjkFontReady('繁體中文') : Promise.resolve();
  assets = await loadAssets(f => { loadFraction = f; renderPlay(); renderOthers(); });
  await fonts;
  ready = true;
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
  const startNow = () => start(startAction());
  if (params.get('autostart') || benchMode) void startNow();
  if (import.meta.env.DEV) Object.assign(window, { __lb: { get game() { return game; }, get bench() { return bench; }, renderer, assets, step: stepFrames, start: startNow } });
}

void boot().catch(error => {
  console.error(error);
  track('error_shown', { where: 'boot', message: String((error as Error)?.message ?? error).slice(0, 120) });
  status.textContent = t('lobby.unableToStart', { error: (error as Error).message });
});
