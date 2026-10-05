import { inject } from '@vercel/analytics';
import { loadMap, mapSummaries } from '../shared/maps/index';
import { cleanCode, ROOM_SIZES, sizeLabel } from '../shared/match/rooms';
import { ELIMINATION, SABOTAGE, type Mode, type Team } from '../shared/match/state';
import { loadAssets, type Assets } from './assets';
import { Audio } from './audio';
import { Game } from './game/game';
import { settings } from './game/settings';
import type { GameLink } from './game/link';
import { OfflineLink } from './game/offline';
import { Bench, BENCH_SECONDS, benchReport, type BenchResult } from './game/bench';
import { onlineAvailable, onlineConfig, connectOnline, watchRooms, type OnlineEntry, type PublicRoom } from './net/online';
import { LevelView } from './render/level';
import { THEMES } from './render/materials';
import { QUALITY, Renderer } from './render/renderer';
import { renderTheme, THEME_START } from './theme';
import { SettingsMenu, type GraphicsQuality, type SettingsTab } from './ui/settingsmenu';
import './style.css';
import './menu.css';

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
/**
 * What the lobby is pointed at. Quick Play is the default; every other way in is an inline drawer
 * (or a selected public room) with its own button. Enter runs whichever is in focus.
 */
type Focus = 'quick' | 'create' | 'join' | 'room' | 'bots' | 'range';
/** How the match is reached: the old `mode` / `onlineKind` pair, still what storage and URLs speak. */
const modeOf = (f: Focus) => f === 'bots' ? 'offline' : f === 'range' ? 'lab' : 'online';
const kindOf = (f: Focus) => f === 'create' ? 'create' : f === 'join' ? 'code' : f === 'room' ? 'room' : 'quick';
const MODES: Record<Mode, { tag: string; name: string }> = {
  elimination: { tag: 'E', name: 'Elimination' },
  sabotage: { tag: 'S', name: 'Sabotage' },
};
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const menu = document.createElement('div');
menu.id = 'menu';
const maps = mapSummaries();
const mapName = (id: string) => maps.find(m => m.id === id)?.name ?? id;
const server = onlineConfig();
const online = onlineAvailable();
const vs = (n: number) => `${n}v${n}`;
const choice = (group: string, attr: string, items: [string, string][], label?: string) =>
  `<div class="choices segmented" id="${group}" style="--n:${items.length}"${label ? ` role="group" aria-label="${label}"` : ''}>${items.map(([v, text]) => `<button class="choice" data-${attr}="${v}"><b>${text}</b></button>`).join('')}</div>`;
const sizeChoice = (group: string) =>
  `<div class="choices segmented sizes" id="${group}" style="--n:${SIZES.length}" role="group" aria-label="Room size">${SIZES.map(s => `<button class="choice" data-size="${s.id}"><b>${s.label}</b><small>${s.name}${s.perTeam > 12 ? ' · big map' : ''}</small></button>`).join('')}</div>`;
const modeChoice = (group: string) => choice(group, 'gamemode', Object.entries(MODES).map(([id, m]) => [id, `<span class="mtag">[${m.tag}]</span> ${m.name}`]));
const mapChoice = (group: string) =>
  `<div class="maps" id="${group}">${maps.map(m => `<button class="map" data-map="${m.id}" data-theme="${m.theme}"><b>${m.name}</b><small></small></button>`).join('')}</div>`;
const field = (label: string, body: string) => `<div class="field"><span class="label">${label}</span>${body}</div>`;
const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.84 1.84M7.34 16.66 5.5 18.5M18.5 18.5l-1.84-1.84M7.34 7.34 5.5 5.5"/><circle cx="12" cy="12" r="6.4"/></svg>';

/*
 * Left: only what starts a match (callsign, team, size, Quick Play) and one row of other ways in, each
 * opening its drawer. Right: the live backdrop with the map in view and, when any exist, public rooms.
 * Settings and controls live behind the gear (top right).
 */
menu.innerHTML = `
  <section class="panel">
    <header class="brand">
      <div class="tag">Lawbreaker // Frontline</div>
      <h1>SWAT <em>vs Militia</em></h1>
      <p class="lede">Round-based team combat · first to ten rounds.</p>
    </header>
    <div class="form">
      <div class="who">
        <label class="callsign"><span class="label">Callsign</span><input type="text" id="callsign" maxlength="16" autocomplete="off" spellcheck="false"></label>
        ${choice('teams', 'team', [['auto', 'Auto'], ['0', '<span class="swat">SWAT</span>'], ['1', '<span class="militia">Militia</span>']], 'Team')}
      </div>

      <section class="block" id="online-block" aria-label="Play online">
        ${sizeChoice('sizes-online')}
        <button class="deploy" id="quick" data-act="quick" disabled>Loading…</button>
        <p class="rooms-line" id="rooms-line"><span class="conn" id="conn"><i></i></span><span id="quick-hint"></span></p>
        <p class="unavailable" id="online-off"></p>
      </section>

      <div class="subs" role="group" aria-label="More ways to play">
        <button class="sub" data-toggle="create" aria-expanded="false" aria-controls="drawer-create">Private room</button>
        <button class="sub" data-toggle="join" aria-expanded="false" aria-controls="drawer-join">Join code</button>
        <button class="sub" data-toggle="bots" aria-expanded="false" aria-controls="drawer-bots">Vs bots</button>
        <button class="sub" data-toggle="range" aria-expanded="false" aria-controls="drawer-range">Practice</button>
      </div>
      <div class="drawer" id="drawer-create">
        ${field('Mode', modeChoice('modes-create'))}
        ${field('Map', mapChoice('maps-create'))}
        ${field('Bots', choice('botsfills', 'botsfill', [['on', 'Fill empty slots'], ['off', 'Humans only']]))}
        <button class="go" id="create-go" data-act="create">Create room</button>
        <p class="hint">You get a four-letter code to share. Size: the chip above.</p>
      </div>
      <div class="drawer" id="drawer-join">
        <div class="code-row">
          <input type="text" id="roomcode" maxlength="4" autocomplete="off" spellcheck="false" placeholder="ABCD" aria-label="Room code">
          <button class="go" id="join-go" data-act="join">Join</button>
        </div>
        <p class="hint">The host's code is on their status line (ROOM ABCD) and in their invite link.</p>
      </div>
      <div class="drawer" id="drawer-bots">
        ${field('Mode', modeChoice('modes-bots'))}
        ${field('Size', sizeChoice('sizes-bots'))}
        ${field('Map', mapChoice('maps-bots'))}
        ${field('Bot difficulty', choice('skills', 'skill', [['0.25', 'Recruit'], ['0.45', 'Veteran'], ['0.75', 'Elite']]))}
        <button class="go" id="bots-go" data-act="bots">Start match</button>
        <p class="hint">Your own match, offline: bots fill both teams.</p>
      </div>
      <div class="drawer" id="drawer-range">
        ${field('Map', mapChoice('maps-range'))}
        <button class="go" id="range-go" data-act="range">Enter the range</button>
        <p class="hint">No bots, a free store and no round limit: try every gun and attachment, learn the routes.</p>
      </div>
    </div>
    <div class="status" id="status" role="status"></div>
  </section>
  <section class="stage">
    <div class="showcase" id="showcase">
      <h2></h2>
      <div class="meta"></div>
    </div>
    <div class="browser" id="browser" hidden>
      <div class="browser-head"><b>Public rooms</b><span id="rooms-count"></span></div>
      <div class="browser-rows" id="rooms"></div>
    </div>
  </section>
  <div class="corner">
    <button class="icon-btn" id="open-controls" data-tip="Controls" aria-label="Controls" aria-haspopup="dialog">?</button>
    <button class="icon-btn" id="open-settings" data-tip="Settings" aria-label="Settings" aria-haspopup="dialog">${GEAR}</button>
  </div>`;
app.appendChild(menu);
document.body.classList.add('menu-open');

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => menu.querySelector<T>(sel)!;
const select = (group: string, attr: string, value: string) => menu.querySelectorAll<HTMLButtonElement>(`#${group} [data-${attr}]`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));

// ---- Initial choices: URL flags first, then what this browser remembered. ----
const MODE_ALIASES: Record<string, string> = { solo: 'offline', practice: 'lab' };
let startMode = params.get('mode') ?? store.get('mode', online.ok ? 'online' : 'offline');
startMode = MODE_ALIASES[startMode] ?? startMode;
const storedKind = store.get('onlineKind', 'quick');
let focus: Focus = params.get('room') ? 'join'
  : startMode === 'offline' ? 'bots' : startMode === 'lab' ? 'range'
  : storedKind === 'create' ? 'create' : storedKind === 'code' && params.get('mode') ? 'join' : 'quick';
if (!online.ok && modeOf(focus) === 'online') focus = 'bots';
let mapId = params.get('map') ?? store.get('map', maps[0].id);
if (!maps.some(m => m.id === mapId)) mapId = maps[0].id;
let gameMode = (params.get('game') ?? store.get('gameMode', 'elimination')) as Mode;
if (!MODES[gameMode]) gameMode = 'elimination';
let size: SizeId = sizeOf(params.get('size') ?? store.get('size', 'squad')).id;
let botsFill = store.get('botsFill', 'on');
let team = params.get('team') ?? store.get('team', 'auto');
let skill = params.get('skill') ?? store.get('skill', '0.45');
let quality = (params.get('quality') ?? store.get('quality', 'medium')) as keyof typeof QUALITY;
if (!QUALITY[quality]) quality = 'medium';
/** ?bench: scripted solo run that measures frame times on this device (Elimination, Squad unless ?size). */
const benchMode = params.has('bench');
if (benchMode) { focus = 'bots'; gameMode = 'elimination'; size = sizeOf(params.get('size') ?? 'squad').id; }
const callsign = $<HTMLInputElement>('#callsign');
callsign.value = params.get('name') ?? store.get('name', `Lawbreaker-${Math.floor(Math.random() * 900 + 100)}`);
const roomCode = $<HTMLInputElement>('#roomcode');
roomCode.value = cleanCode(params.get('room') ?? '');
const quickBtn = $<HTMLButtonElement>('#quick');
const status = $('#status');
if (!online.ok) {
  $('#online-block').classList.add('off');
  $('#online-off').textContent = online.reason;
  menu.querySelectorAll<HTMLButtonElement>('#online-block button, [data-toggle="create"], [data-toggle="join"]').forEach(b => { b.disabled = true; });
}

// ---- Public rooms: a live list from the server while the lobby is open. ----
let rooms: PublicRoom[] = [];
let roomsState: 'connecting' | 'live' | 'offline' = 'offline';
let roomId = -1;
let stopRooms: (() => void) | undefined;
let roomsGen = 0;
let roomsRetry: ReturnType<typeof setTimeout> | undefined;
function watchLobbyRooms() {
  unwatchRooms();
  if (!online.ok || benchMode) { renderRooms(); return; }
  const gen = ++roomsGen;
  void watchRooms(list => { if (gen !== roomsGen) return; rooms = list; renderRooms(); refresh(); }, state => {
    if (gen !== roomsGen) return;
    roomsState = state;
    if (state === 'offline') {
      rooms = [];
      // The server may come back: try again while the lobby stays open.
      roomsRetry = setTimeout(() => { if (gen === roomsGen && inMenu) watchLobbyRooms(); }, 5000);
    }
    renderRooms(); refresh();
  }).then(stop => { if (gen === roomsGen) stopRooms = stop; else stop(); }, () => { if (gen === roomsGen) { roomsState = 'offline'; renderRooms(); } });
}
function unwatchRooms() {
  roomsGen++;
  clearTimeout(roomsRetry);
  stopRooms?.(); stopRooms = undefined;
}
const full = (r: PublicRoom) => r.humans >= r.size * 2;
const roomStatus = (r: PublicRoom) => r.phase === 'warmup' ? 'Warm-up' : r.phase === 'ended' ? 'Match over' : `Round ${r.round}`;
/** The room Quick Play would put us in: the fullest public room of our size with a free slot (as the server picks). */
const quickTarget = () => rooms.find(r => r.size === sizeOf(size).perTeam && !full(r));
const selectedRoom = () => rooms.find(r => r.room === roomId);

/** One quiet line under Quick Play: the server state (dot) and where Quick Play would put you. */
function renderLine() {
  const line = $('#rooms-line');
  line.hidden = !online.ok;
  if (!online.ok) return;
  const target = quickTarget();
  const [state, text] = roomsState === 'connecting' ? ['wait', 'Connecting to the match server…']
    : roomsState === 'offline' ? ['off', 'Server offline — Vs bots and Practice still work']
    : target ? ['live', `Quick Play joins ${mapName(target.mapId)} · ${target.humans}/${target.size * 2} players`]
    : rooms.length ? ['live', `No open ${sizeOf(size).label} room — Quick Play opens one`]
    : ['live', 'No public rooms right now — Quick Play opens one'];
  const conn = $('#conn');
  conn.className = `conn ${state}`;
  line.title = roomsState === 'live' ? `Live · ${server.database ?? 'online'} · bots fill empty slots and step aside for players` : '';
  $('#quick-hint').textContent = text;
}

/** Public rooms: a slim card list, shown only while there are rooms. */
function renderRooms() {
  renderLine();
  const list = $('#rooms');
  const browser = $('#browser');
  browser.hidden = !rooms.length;
  menu.classList.toggle('has-rooms', rooms.length > 0);
  if (!rooms.length) { list.innerHTML = ''; return; }
  const humans = rooms.reduce((n, r) => n + r.humans, 0);
  $('#rooms-count').innerHTML = `<span class="conn live"><i></i>${rooms.length} room${rooms.length === 1 ? '' : 's'} · ${humans} player${humans === 1 ? '' : 's'}</span>`;
  list.innerHTML = rooms.map(r => {
    const m = maps.find(x => x.id === r.mapId), md = MODES[r.mode] ?? MODES.elimination;
    return `<div class="room${focus === 'room' && r.room === roomId ? ' selected' : ''}" data-room="${r.room}" data-theme="${m?.theme ?? ''}" tabindex="0" role="button" title="Room ${r.room} · ${roomStatus(r)}" aria-label="${esc(mapName(r.mapId))} ${md.name} ${sizeLabel(r.size)}, ${r.humans} of ${r.size * 2} players, ${roomStatus(r)}">
      <span class="srv"><b>${esc(mapName(r.mapId))}</b><small class="state ${r.phase}">${roomStatus(r)}</small></span>
      <span class="mode" title="${md.name}"><span class="mtag">[${md.tag}]</span><span class="mname"> ${md.name}</span></span>
      <span class="size">${sizeLabel(r.size)}</span>
      <span class="players">${r.humans}/${r.size * 2}</span>
      <button class="join" data-joinroom="${r.room}"${full(r) || !ready || starting ? ' disabled' : ''}>${full(r) ? 'Full' : 'Join'}</button>
    </div>`;
  }).join('');
}

/** Maps the current choice can play: the room size decides big or small maps, Sabotage needs bomb sites. */
const mapFits = (m: (typeof maps)[number]) => focus === 'range'
  || ((sizeOf(size).perTeam > 12) === m.big && (!(focus === 'create' || focus === 'bots') || gameMode !== 'sabotage' || m.sites > 0));
const fitMap = () => { const m = maps.find(x => x.id === mapId); if (!m || !mapFits(m)) mapId = maps.find(mapFits)?.id ?? mapId; };
/** The map the backdrop and showcase present for the current choice. */
const shownMap = () => {
  const id = focus === 'quick' ? quickTarget()?.mapId : focus === 'room' ? selectedRoom()?.mapId : undefined;
  return id && maps.some(m => m.id === id) ? id : mapId;
};

// ---- Buttons: one per way in; labels follow the choices. ----
let ready = false;
let starting = false;
let loading = 'Loading…';
const LABELS: Record<Exclude<Focus, 'room'>, () => string> = {
  quick: () => `Quick Play ${sizeOf(size).label}`,
  create: () => `Create room · ${sizeOf(size).label}`,
  join: () => 'Join',
  bots: () => 'Start match',
  range: () => 'Enter the range',
};
const ACT_BUTTONS: [Exclude<Focus, 'room'>, HTMLButtonElement][] = [
  ['quick', quickBtn], ['create', $<HTMLButtonElement>('#create-go')], ['join', $<HTMLButtonElement>('#join-go')],
  ['bots', $<HTMLButtonElement>('#bots-go')], ['range', $<HTMLButtonElement>('#range-go')],
];
function syncButtons() {
  for (const [f, b] of ACT_BUTTONS) {
    const needsServer = modeOf(f) === 'online';
    b.disabled = !ready || starting || (needsServer && !online.ok) || (f === 'join' && roomCode.value.length < 4);
    b.textContent = !ready ? (f === 'quick' || f === 'bots' || f === 'range' ? loading : LABELS[f]())
      : starting && focus === f ? (needsServer ? 'Joining…' : 'Starting…') : LABELS[f]();
  }
  menu.querySelectorAll<HTMLButtonElement>('#rooms .join').forEach(b => {
    const r = rooms.find(x => x.room === Number(b.dataset.joinroom));
    b.disabled = !ready || starting || !r || full(r);
    b.textContent = starting && focus === 'room' && r?.room === roomId ? 'Joining…' : r && full(r) ? 'Full' : 'Join';
  });
}

/** Everything on screen follows the current choices. */
const refresh = () => {
  if (focus === 'room' && !selectedRoom()) focus = 'quick';
  fitMap();
  const s = sizeOf(size), md = MODES[gameMode];
  for (const g of ['sizes-online', 'sizes-bots']) select(g, 'size', size);
  for (const g of ['modes-create', 'modes-bots']) select(g, 'gamemode', gameMode);
  select('botsfills', 'botsfill', botsFill);
  for (const d of ['create', 'join', 'bots', 'range'] as const) {
    $(`#drawer-${d}`).classList.toggle('open', focus === d);
    $(`[data-toggle="${d}"]`).setAttribute('aria-expanded', String(focus === d));
  }
  menu.classList.toggle('focus-quick', focus === 'quick');
  for (const g of ['maps-create', 'maps-bots', 'maps-range']) {
    menu.querySelectorAll<HTMLButtonElement>(`#${g} [data-map]`).forEach(b => {
      const m = maps.find(x => x.id === b.dataset.map)!;
      b.hidden = !mapFits(m);
      b.setAttribute('aria-pressed', String(m.id === mapId));
      b.querySelector('small')!.textContent = g === 'maps-range' ? (m.big ? 'Big map' : m.region.split('/')[0].trim().toLowerCase())
        : gameMode === 'sabotage' ? (m.sites > 1 ? 'Sites A · B' : 'Site A') : m.region.split('/')[1]?.trim().toLowerCase() ?? '';
    });
  }
  // The showcase: the map in view and one line about what you would play there.
  const target = quickTarget();
  const box = $('#showcase');
  const set = (title: string, meta: string) => { box.querySelector('h2')!.textContent = title; box.querySelector('.meta')!.textContent = meta; };
  const shown = maps.find(x => x.id === shownMap())!;
  const room = focus === 'room' ? selectedRoom() : focus === 'quick' ? target : undefined;
  if (room) {
    const rm = MODES[room.mode] ?? MODES.elimination;
    set(shown.name, `${focus === 'quick' ? 'Quick Play · ' : ''}[${rm.tag}] ${rm.name} · ${sizeLabel(room.size)} · ${room.humans}/${room.size * 2} players`);
  } else if (focus === 'quick') {
    set(`${s.name} ${s.label}`, `Quick Play · [E] ⇄ [S] · map rotation${s.perTeam > 12 ? ' · big maps' : ''}`);
  } else if (focus === 'join') {
    set('Private room', roomCode.value ? `Room ${roomCode.value}` : 'Enter the four-letter code');
  } else if (focus === 'range') {
    set(shown.name, 'Practice range · free store');
  } else {
    set(shown.name, `${focus === 'create' ? 'Private · ' : 'Vs bots · '}[${md.tag}] ${md.name} · ${vs(s.perTeam)}${gameMode === 'sabotage' ? ` · ${shown.sites} bomb site${shown.sites > 1 ? 's' : ''}` : ''}`);
  }
  renderLine();
  menu.querySelectorAll<HTMLElement>('#rooms .room').forEach(r => r.classList.toggle('selected', focus === 'room' && Number(r.dataset.room) === roomId));
  syncButtons();
  showBackdrop();
};
const audio = new Audio();
select('teams', 'team', team); select('skills', 'skill', skill);

/** The open drawer (or picked public room) steps back to Quick Play; offline there is nothing to fall back to. */
const closeDrawer = () => { if (focus === 'quick' || !online.ok) return false; focus = 'quick'; refresh(); return true; };
const onClick = (attr: string, fn: (value: string) => void) => menu.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach(b => b.addEventListener('click', () => { fn(b.dataset[attr]!); audio.ui(); }));
onClick('toggle', v => {
  focus = focus === v ? (online.ok ? 'quick' : focus) : v as Focus;
  refresh();
  if (focus === 'join') roomCode.focus({ preventScroll: true });
  // Bring the whole drawer, its button included, into view.
  if (focus === v) menu.querySelector(`#drawer-${v}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});
onClick('act', v => act(v as Focus));
onClick('gamemode', v => { gameMode = v as Mode; refresh(); });
onClick('size', v => { size = sizeOf(v).id; if (focus === 'room' || focus === 'join') focus = 'quick'; refresh(); });
onClick('botsfill', v => { botsFill = v; refresh(); });
onClick('map', v => { mapId = v; refresh(); });
onClick('team', v => { team = v; select('teams', 'team', team); });
onClick('skill', v => { skill = v; select('skills', 'skill', skill); });
roomCode.addEventListener('input', () => { roomCode.value = cleanCode(roomCode.value); refresh(); });
roomCode.addEventListener('focus', () => { if (focus !== 'join' && online.ok) { focus = 'join'; refresh(); } });

// Public rooms: click a row to preview it, Join (or double-click, or Enter on the row) to play there.
const roomList = $('#rooms');
const roomOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('.room');
roomList.addEventListener('click', e => {
  const row = roomOf(e);
  if (!row) return;
  roomId = Number(row.dataset.room); focus = 'room'; audio.ui();
  if ((e.target as HTMLElement).closest('.join')) void act('room'); else refresh();
});
roomList.addEventListener('dblclick', e => { const row = roomOf(e); if (row) { roomId = Number(row.dataset.room); void act('room'); } });
roomList.addEventListener('keydown', e => {
  const row = roomOf(e);
  if (!row || e.key !== 'Enter' || (e.target as HTMLElement).tagName === 'BUTTON') return;
  e.preventDefault(); e.stopPropagation(); roomId = Number(row.dataset.room); void act('room');
});

// ---- Settings and controls: the gear (and ?) open the shared settings menu in its lobby mode. ----
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
    bench: { label: `Run the ${BENCH_SECONDS}-second performance check`, run: () => { location.search = `?bench&map=${mapId}&quality=${quality}`; } },
    credits: 'Characters, weapons and props: CC0 packs by Quaternius. Gunshots: CC0 Free Firearm Sound Library. Textures: CC0 Poly Haven. Font: Rajdhani (OFL). No proprietary game assets.',
  },
});
const openOptions = (tab: SettingsTab) => { audio.ui(); options.show(false, tab); };
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

/** Run one way in: point the lobby at it, then start. */
function act(f: Focus) {
  if (!ready || starting) return;
  if (modeOf(f) === 'online' && !online.ok) return;
  if (f === 'join' && roomCode.value.length < 4) { focus = 'join'; refresh(); roomCode.focus(); return; }
  if (f === 'room' && !selectedRoom()) { focus = 'quick'; refresh(); return; }
  focus = f;
  void start();
}

async function start() {
  const name = callsign.value.trim().slice(0, 16) || 'Lawbreaker';
  fitMap();
  const mode = modeOf(focus), kind = kindOf(focus);
  if (!benchMode) {
    store.set('name', name); store.set('mode', mode); store.set('map', mapId); store.set('gameMode', gameMode); store.set('size', size);
    store.set('team', team); store.set('skill', skill); store.set('onlineKind', kind === 'room' ? 'quick' : kind); store.set('botsFill', botsFill);
  }
  starting = true; refresh();
  options.hide();
  status.textContent = '';
  unwatchRooms();
  inMenu = false;
  audio.start();
  audio.stopMusic();
  const teamChoice = team === 'auto' ? undefined : (Number(team) as Team);
  const botSkill = Math.max(0.1, Math.min(0.95, Number(skill) || 0.45));
  const how: OnlineEntry = kind === 'code' ? { kind: 'code', code: cleanCode(roomCode.value) }
    : kind === 'create' ? { kind: 'create', size: sizeOf(size).perTeam, mode: gameMode, mapId, bots: botsFill === 'on' }
    : kind === 'room' ? { kind: 'room', room: roomId }
    : { kind: 'quick', size: sizeOf(size).perTeam };
  let link: GameLink;
  try {
    link = mode === 'online'
      ? await connectOnline(name, teamChoice, how, s => { status.textContent = s; })
      : mode === 'lab'
        ? new OfflineLink(mapId, name, teamChoice, {}, true)
        : new OfflineLink(mapId, name, teamChoice, { ...(gameMode === 'sabotage' ? SABOTAGE : ELIMINATION), teamSize: sizeOf(size).perTeam, botSkill, freeBuy: params.has('freebuy') });
  } catch (error) {
    status.textContent = `Could not join: ${(error as Error).message}`;
    starting = false;
    inMenu = !benchMode; menuMusic();
    watchLobbyRooms(); refresh();
    return;
  }
  starting = false;
  status.textContent = '';
  if (backdrop) { renderer.scene.remove(backdrop.group); backdrop = undefined; backdropMap = undefined; }
  const linkMap = link.state()?.mapId ?? mapId;
  launch(link, linkMap);
  menu.hidden = true;
  document.body.classList.remove('menu-open');
  await game?.input.lock()?.catch?.(() => undefined);
}

function launch(link: GameLink, map: string) {
  game = new Game(assets, renderer, link, map, audio, app);
  if (benchMode && !bench) startBench(game);
  game.onMapChange = next => { game?.stop(true); launch(link, next); };
  game.onExit = () => {
    game?.stop(); game = undefined;
    document.body.classList.add('menu-open'); menu.hidden = false;
    syncOptions();
    inMenu = !benchMode; menuMusic();
    watchLobbyRooms(); refresh();
  };
}
const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
/** Enter: the code box joins; anywhere else it runs the choice in focus (Quick Play unless a drawer or room is picked). */
function primary() {
  if (focus === 'quick' && !online.ok) return;
  act(focus);
}
document.addEventListener('keydown', e => {
  if (e.code === 'KeyM' && game && !game.input.locked && e.target === document.body) game.onExit?.();
  // F: fullscreen (BeGone's default key). Entering it can drop pointer lock, so recapture after.
  if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e)) {
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => undefined); return; }
    const relock = !!game?.input.locked;
    void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => {
      if (relock && game && !game.input.locked) void game.input.lock()?.catch?.(() => undefined);
    }, () => undefined);
  }
  // Esc in the lobby: close the settings dialog, else the open drawer (or picked room) back to Quick Play.
  if (e.key === 'Escape' && !game && !menu.hidden) {
    if (options.open) { e.preventDefault(); options.close(); return; }
    const was = focus;
    if (closeDrawer()) {
      e.preventDefault();
      if (was !== 'room') menu.querySelector<HTMLElement>(`[data-toggle="${was}"]`)?.focus({ preventScroll: true });
    }
    return;
  }
  if (e.key === 'Enter' && !e.repeat && !game && !menu.hidden && !options.open && !e.isComposing) {
    const t = e.target as HTMLElement;
    if (t === roomCode) { e.preventDefault(); act('join'); return; }
    // Buttons, toggles and rows keep their own Enter.
    if (t.closest('button, summary, a, .room')) return;
    e.preventDefault(); primary();
  }
});

function startBench(g: Game) {
  bench = new Bench(g, renderer, quality);
  benchBanner = document.createElement('div');
  benchBanner.className = 'bench-banner';
  app.appendChild(benchBanner);
  bench.onDone = result => { benchBanner?.remove(); showBenchResult(result); };
}

function showBenchResult(r: BenchResult) {
  const panel = document.createElement('div');
  panel.className = 'bench-panel';
  panel.innerHTML = `
    <h2>Performance check</h2>
    <div class="verdict ${r.meets60 ? 'ok' : 'bad'}">60 fps target ${r.meets60 ? 'met' : 'not met'} on this device</div>
    <table>${benchReport(r).map(([k]) => `<tr><th>${k}</th><td></td></tr>`).join('')}</table>
    <p>${r.seconds} s of scripted combat after a warm-up. Browsers cap frames at the display refresh rate, so 120 Hz screens can exceed 60. Met means an average of at least 58 fps with 95% of frames within 18.2 ms.</p>
    <div class="actions"><button data-a="copy">Copy results</button><button data-a="again">Run again</button><button data-a="menu">Back to menu</button></div>`;
  // Values go in as text: the GPU string comes from the driver.
  panel.querySelectorAll('td').forEach((td, i) => { td.textContent = benchReport(r)[i][1]; });
  panel.addEventListener('click', e => {
    const a = (e.target as HTMLElement).dataset.a;
    if (a === 'copy') void navigator.clipboard?.writeText(JSON.stringify(r, null, 2)).then(() => { (e.target as HTMLElement).textContent = 'Copied'; }, () => undefined);
    if (a === 'again') location.reload();
    if (a === 'menu') location.href = location.pathname;
  });
  app.appendChild(panel);
  document.body.classList.add('bench-done');
  document.exitPointerLock?.();
}

async function boot() {
  renderer = new Renderer(app, QUALITY[quality]);
  assets = await loadAssets(f => { loading = `Loading ${(f * 100).toFixed(0)}%`; syncButtons(); });
  ready = true;
  refresh();
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
      if (left !== benchLeft && benchBanner) { benchLeft = left; benchBanner.textContent = bench.warming ? 'Performance check · warming up' : `Performance check · ${left} s`; }
    }
    requestAnimationFrame(loop);
  };
  if (!params.has('capture')) requestAnimationFrame(loop);
  let simNow = 0;
  /** Advance n fixed frames (capture mode). Returns once the frames are rendered. */
  const stepFrames = (n: number, render = true) => { for (let i = 0; i < n; i++) { simNow += 1000 / 30; step(1 / 30, simNow, render && i === n - 1); } return n; };
  if (params.get('autostart') || benchMode) void start();
  if (import.meta.env.DEV) Object.assign(window, { __lb: { get game() { return game; }, get bench() { return bench; }, renderer, assets, step: stepFrames, start } });
}

void boot().catch(error => {
  console.error(error);
  status.textContent = `Unable to start: ${(error as Error).message}. A WebGL2 desktop browser is required.`;
});
