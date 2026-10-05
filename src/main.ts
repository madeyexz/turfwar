import { inject } from '@vercel/analytics';
import { loadMap, mapSummaries } from '../shared/maps/index';
import { ROOM_SIZES } from '../shared/match/rooms';
import { ELIMINATION, ONLINE_CONFIG, SABOTAGE, type Mode, type Team } from '../shared/match/state';
import { loadAssets, type Assets } from './assets';
import { Audio } from './audio';
import { Game } from './game/game';
import { OPTIC_DETAILS, RETICLE_COLORS, RETICLE_STYLES, SCOPE_MODES, settings, type OpticDetail, type ReticleColor, type ReticleStyle, type ScopeMode } from './game/settings';
import type { GameLink } from './game/link';
import { OfflineLink } from './game/offline';
import { Bench, BENCH_SECONDS, benchReport, type BenchResult } from './game/bench';
import { onlineAvailable, onlineConfig, connectOnline } from './net/online';
import { LevelView } from './render/level';
import { THEMES } from './render/materials';
import { QUALITY, Renderer } from './render/renderer';
import { RETICLE_CSS } from './render/sights';
import { renderTheme, THEME_START } from './theme';
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
/** Online: Quick Play into a public room, open a private room, or join one by its code. */
type OnlineKind = 'quick' | 'create' | 'code';
const ONLINE_KINDS: [OnlineKind, string, string][] = [
  ['quick', 'Quick Play', 'Fullest public room of your size'],
  ['create', 'Private room', 'Your map, mode and size; share the code'],
  ['code', 'Join by code', 'A friend\'s private room'],
];
const MODES: Record<Mode, { tag: string; name: string; blurb: string }> = {
  elimination: { tag: 'E', name: 'Elimination', blurb: 'Wipe out the other team. One life per round.' },
  sabotage: { tag: 'S', name: 'Sabotage', blurb: 'Militia arms the bomb at a site; SWAT defends.' },
};
const CROSSHAIRS = {
  classic: '<path d="M12 2.5v6M12 15.5v6M2.5 12h6M15.5 12h6"/><circle cx="12" cy="12" r="1.3"/>',
  dot: '<circle cx="12" cy="12" r="2.4"/>',
  circle: '<circle cx="12" cy="12" r="7" fill="none"/><circle cx="12" cy="12" r="1.3"/>',
  t: '<path d="M12 15.5v6M2.5 12h6M15.5 12h6"/><circle cx="12" cy="12" r="1.3"/>',
} as const;
type Crosshair = keyof typeof CROSSHAIRS;
/** Red dot / holo reticle icons ('stock': each sight's own). */
const RETICLES: Record<ReticleStyle, string> = {
  stock: '<circle cx="12" cy="12" r="1.8"/><path d="M4 8.5V4h4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5" fill="none"/>',
  dot: '<circle cx="12" cy="12" r="2.6"/>',
  circle: '<circle cx="12" cy="12" r="8" fill="none"/><circle cx="12" cy="12" r="1.5"/>',
  chevron: '<path d="M5 16.5l7-8 7 8" fill="none" stroke-linejoin="round"/>',
  cross: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/><circle cx="12" cy="12" r="1.3"/>',
};
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const menu = document.createElement('div');
menu.id = 'menu';
const maps = mapSummaries();
const server = onlineConfig();
const online = onlineAvailable();
const vs = (n: number) => `${n}v${n}`;
const choice = (group: string, attr: string, items: [string, string][]) =>
  `<div class="choices segmented" id="${group}" style="--n:${items.length}">${items.map(([v, label]) => `<button class="choice" data-${attr}="${v}"><b>${label}</b></button>`).join('')}</div>`;
menu.innerHTML = `
  <section class="panel">
    <header class="brand">
      <div class="tag">Lawbreaker // Frontline</div>
      <h1><span>SWAT</span><em>vs Militia</em></h1>
      <p class="lede">Round-based team combat. One life a round, cash for every kill, guns and attachments from the store in your base. First team to ten rounds wins.</p>
    </header>
    <div class="form">
      <label class="field"><span class="label">Callsign</span><input type="text" id="callsign" maxlength="16" autocomplete="off" spellcheck="false"></label>
      <div class="field"><span class="label">Play</span><div class="choices modes" id="modes">
        <button class="choice" data-mode="offline"><b>Solo</b><small>Your server. Bots fill free slots.</small></button>
        <button class="choice" data-mode="online"><b>Online</b><small id="online-note">The live server with other players.</small></button>
        <button class="choice" data-mode="lab"><b>Practice</b><small>The range: no bots, free store.</small></button>
      </div></div>
      <div class="field online-only" id="online-kind-field"><span class="label">Online</span><div class="choices" id="onlinekinds">${ONLINE_KINDS.map(([id, name, blurb]) => `<button class="choice" data-onlinekind="${id}"><b>${name}</b><small>${blurb}</small></button>`).join('')}</div></div>
      <label class="field" id="code-field"><span class="label">Room code</span><input type="text" id="roomcode" maxlength="4" autocomplete="off" spellcheck="false" placeholder="ABCD" style="text-transform:uppercase;letter-spacing:.3em"></label>
      <div class="field" id="gamemode-field"><span class="label">Game mode</span><div class="choices" id="gamemodes">${Object.entries(MODES).map(([id, m]) => `<button class="choice" data-gamemode="${id}"><b><span class="mtag">[${m.tag}]</span> ${m.name}</b><small>${m.blurb}</small></button>`).join('')}</div></div>
      <div class="field" id="size-field"><span class="label">Room size</span><div class="choices sizes" id="sizes" style="--n:3">${SIZES.map(s => `<button class="choice" data-size="${s.id}"><b>${s.label}</b><small>${s.name}${s.perTeam > 12 ? ' · big map' : ''}</small></button>`).join('')}</div></div>
      <div class="online-only server-card" id="server-card">
        <div class="server-name"><span class="live"></span><b id="server-name"></b></div>
        <dl id="server-facts"></dl>
      </div>
      <p class="lab-only note">The practice range runs on the selected map with the whole store free and no round limit. Shoot at walls, try every attachment and learn the routes.</p>
      <div class="row">
        <div class="field"><span class="label">Team</span>${choice('teams', 'team', [['auto', 'Auto'], ['0', '<span class="swat">SWAT</span>'], ['1', '<span class="militia">Militia</span>']])}</div>
        <div class="field solo-only"><span class="label">Bots</span>${choice('skills', 'skill', [['0.25', 'Recruit'], ['0.45', 'Veteran'], ['0.75', 'Elite']])}</div>
        <div class="field" id="botsfill-field"><span class="label">Bots</span>${choice('botsfills', 'botsfill', [['on', 'Fill slots'], ['off', 'Humans only']])}</div>
      </div>
      <details class="settings">
        <summary>Options &amp; controls</summary>
        <div class="settings-body">
        <div class="field"><span class="label">Graphics</span><div class="choices segmented" id="qualities">
          <button class="choice" data-quality="low" title="No bloom, 1k shadows"><b>Low</b></button><button class="choice" data-quality="medium" title="Bloom, 2k shadows"><b>Medium</b></button><button class="choice" data-quality="high" title="1.5× resolution"><b>High</b></button>
        </div></div>
        <div class="field"><span class="label">Crosshair</span><div class="choices segmented crosshairs" id="crosshairs" style="--n:4">${Object.entries(CROSSHAIRS).map(([id, svg]) => `<button class="choice" data-crosshair="${id}" title="${id === 't' ? 'T' : id[0].toUpperCase() + id.slice(1)}"><svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg><b>${id === 't' ? 'T' : id}</b></button>`).join('')}</div></div>
        <div class="field"><span class="label">Scope view</span><div class="choices segmented" id="scopemodes" style="--n:2"><button class="choice" data-scopemode="pip" title="Magnified optics show the zoom through the lens; the view around it stays wide"><b>Through the lens</b></button><button class="choice" data-scopemode="overlay" title="Magnified optics fill the screen with a black eyepiece"><b>Full-screen</b></button></div></div>
        <div class="field"><span class="label">Reticle colour</span><div class="choices segmented" id="reticlecolors" style="--n:4">${RETICLE_COLORS.map(c => `<button class="choice" data-reticlecolor="${c}"><b><i style="display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%;vertical-align:1px;background:${RETICLE_CSS[c]};box-shadow:0 0 5px ${RETICLE_CSS[c]}"></i>${cap(c)}</b></button>`).join('')}</div></div>
        <div class="field"><span class="label">Red dot &amp; holo reticle</span><div class="choices segmented crosshairs" id="reticlestyles" style="--n:5">${RETICLE_STYLES.map(id => `<button class="choice" data-reticlestyle="${id}" title="${id === 'stock' ? 'Each sight\'s own: dot for the red dot, circle-dot for the holo' : cap(id)}"><svg viewBox="0 0 24 24" aria-hidden="true">${RETICLES[id]}</svg><b>${id}</b></button>`).join('')}</div></div>
        <div class="field"><span class="label">Optic detail</span><div class="choices segmented" id="opticdetails" style="--n:2"><button class="choice" data-opticdetail="high" title="Smoothest optic models, sharper scope view"><b>High</b></button><button class="choice" data-opticdetail="low" title="Lighter optic models and scope view"><b>Low</b></button></div></div>
        <div class="sliders">
          <label class="field"><span class="label">Mouse sensitivity <output id="sens-out"></output></span><input type="range" id="sens" min="0.2" max="3" step="0.05"></label>
          <label class="field"><span class="label">Field of view <output id="fov-out"></output></span><input type="range" id="fov" min="65" max="95" step="1"></label>
          <label class="field"><span class="label">Effects volume <output id="volume-out"></output></span><input type="range" id="volume" min="0" max="1" step="0.05"></label>
          <label class="field"><span class="label">Menu music <output id="music-out"></output></span><input type="range" id="music" min="0" max="1" step="0.05"></label>
        </div>
        <dl class="controls">
          <dt>WASD · Mouse</dt><dd>Move · look</dd>
          <dt>LMB · RMB</dt><dd>Fire · accuracy (zoom)</dd>
          <dt>Shift · Space</dt><dd>Sprint · jump (both cost stamina)</dd>
          <dt>C / Ctrl</dt><dd>Crouch</dd>
          <dt>1 · 2 · 3</dt><dd>Knife · secondary · primary</dd>
          <dt>4 / G</dt><dd>M67 grenade</dd>
          <dt>Q / Wheel</dt><dd>Cycle weapons</dd>
          <dt>R · E</dt><dd>Reload · use (bomb, ammo crate)</dd>
          <dt>Z · B</dt><dd>Binoculars · store</dd>
          <dt>Enter · T</dt><dd>Chat · team chat</dd>
          <dt>Tab · F</dt><dd>Scoreboard · fullscreen</dd>
          <dt>V</dt><dd>Camera view (reserved)</dd>
          <dt>Esc · M</dt><dd>Release mouse · back to the lobby</dd>
        </dl>
        <button class="bench-link" id="bench">Run the ${BENCH_SECONDS}-second performance check</button>
        <p class="credits">Characters, weapons and props: CC0 packs by Quaternius. Gunshots: CC0 Free Firearm Sound Library. Textures: CC0 Poly Haven. Font: Rajdhani (OFL). No proprietary game assets.</p>
        </div>
      </details>
    </div>
    <footer class="launch">
      <button class="deploy" id="deploy" disabled>Loading…</button>
      <div class="status" id="status"></div>
    </footer>
  </section>
  <section class="stage">
    <div class="showcase" id="showcase">
      <div class="region"></div>
      <h2></h2>
      <div class="meta"></div>
      <p class="about"></p>
    </div>
    <div class="browser">
      <div class="browser-head"><b>Server browser</b><span id="browser-count"></span></div>
      <div class="browser-cols"><span>Server</span><span>Mode</span><span>Players</span><span>Ping</span></div>
      <div class="browser-rows" id="servers">
        ${maps.map(m => `<button class="server" data-map="${m.id}" data-theme="${m.theme}"><span class="srv"><b>${m.name}</b><small></small></span><span class="mode"></span><span class="players"></span><span class="ping"></span></button>`).join('')}
        <button class="server online-row" data-server="online"><span class="srv"><b></b><small></small></span><span class="mode"></span><span class="players"></span><span class="ping">Online</span></button>
      </div>
    </div>
  </section>`;
app.appendChild(menu);
document.body.classList.add('menu-open');

const select = (group: string, attr: string, value: string) => menu.querySelectorAll<HTMLButtonElement>(`#${group} [data-${attr}]`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
const MODE_ALIASES: Record<string, string> = { solo: 'offline', practice: 'lab' };
let mode = params.get('mode') ?? store.get('mode', 'offline');
mode = MODE_ALIASES[mode] ?? mode;
if (!['offline', 'online', 'lab'].includes(mode)) mode = 'offline';
let mapId = params.get('map') ?? store.get('map', maps[0].id);
if (!maps.some(m => m.id === mapId)) mapId = maps[0].id;
let gameMode = (params.get('game') ?? store.get('gameMode', 'elimination')) as Mode;
if (!MODES[gameMode]) gameMode = 'elimination';
let size: SizeId = sizeOf(params.get('size') ?? store.get('size', 'squad')).id;
let onlineKind: OnlineKind = params.get('room') ? 'code' : (store.get('onlineKind', 'quick') as OnlineKind);
if (!ONLINE_KINDS.some(([id]) => id === onlineKind)) onlineKind = 'quick';
let botsFill = store.get('botsFill', 'on');
let team = params.get('team') ?? store.get('team', 'auto');
let skill = params.get('skill') ?? store.get('skill', '0.45');
let crosshair = store.get('crosshair', 'classic') as Crosshair;
if (!(crosshair in CROSSHAIRS)) crosshair = 'classic';
let quality = (params.get('quality') ?? store.get('quality', 'medium')) as keyof typeof QUALITY;
if (!QUALITY[quality]) quality = 'medium';
/** ?bench: scripted solo run that measures frame times on this device (Elimination, Large unless ?size). */
const benchMode = params.has('bench');
if (benchMode) { mode = 'offline'; gameMode = 'elimination'; size = sizeOf(params.get('size') ?? 'squad').id; }
const callsign = menu.querySelector<HTMLInputElement>('#callsign')!;
callsign.value = params.get('name') ?? store.get('name', `Lawbreaker-${Math.floor(Math.random() * 900 + 100)}`);
menu.querySelector('#server-name')!.textContent = server.database ?? 'No server';
menu.querySelector('.online-row .srv b')!.textContent = server.database ?? 'No server configured';
if (!online.ok) {
  (menu.querySelector('[data-mode="online"]') as HTMLButtonElement).disabled = true;
  const note = menu.querySelector<HTMLElement>('#online-note')!;
  note.textContent = 'Not set up in this build.';
  note.parentElement!.title = online.reason;
  if (mode === 'online') mode = 'offline';
}

const sabotageReady = (id: string) => (maps.find(m => m.id === id)?.sites ?? 0) > 0;
/** Sabotage needs bomb sites: keep the selection on a map that has them. */
/** Maps the current choice can play: the room size decides big or small maps, Sabotage needs bomb sites. */
const choosingMap = () => mode !== 'online' || onlineKind === 'create';
const mapFits = (m: (typeof maps)[number]) => mode === 'lab' || ((sizeOf(size).perTeam > 12) === m.big && (gameMode !== 'sabotage' || m.sites > 0));
const fitMap = () => { const m = maps.find(x => x.id === mapId); if (!m || !mapFits(m)) mapId = maps.find(mapFits)?.id ?? mapId; };
const deployLabel = () => mode === 'lab' ? 'Enter the range' : mode !== 'online' ? 'Start match'
  : onlineKind === 'quick' ? `Quick Play ${sizeOf(size).label}` : onlineKind === 'create' ? 'Create room' : 'Join room';
const roomCode = menu.querySelector<HTMLInputElement>('#roomcode')!;
roomCode.value = (params.get('room') ?? '').toUpperCase().slice(0, 4);
const display = (id: string, on: boolean) => { menu.querySelector<HTMLElement>(`#${id}`)!.style.display = on ? '' : 'none'; };

/** Server-browser rows and the showcase follow the current choices. */
const refresh = () => {
  fitMap();
  const m = maps.find(x => x.id === mapId)!, s = sizeOf(size), md = MODES[gameMode];
  menu.classList.remove('mode-offline', 'mode-online', 'mode-lab');
  menu.classList.add(`mode-${mode}`);
  select('modes', 'mode', mode); select('gamemodes', 'gamemode', gameMode); select('sizes', 'size', size);
  select('onlinekinds', 'onlinekind', onlineKind); select('botsfills', 'botsfill', botsFill);
  const online = mode === 'online';
  display('gamemode-field', mode === 'offline' || (online && onlineKind === 'create'));
  display('size-field', mode === 'offline' || (online && onlineKind !== 'code'));
  display('code-field', online && onlineKind === 'code');
  display('botsfill-field', online && onlineKind === 'create');
  display('server-card', online && onlineKind !== 'create');
  const facts = onlineKind === 'quick'
    ? [['Room', `${s.name} · ${s.label} · bots hold empty slots`], ['Rotation', `New map every match${s.perTeam > 12 ? ' (big maps)' : ''}, alternating Elimination and Sabotage`], ['Rules', `First to ${ONLINE_CONFIG.roundsToWin} rounds · server-authoritative damage and cash`]]
    : [['Room', 'Private · the host chose map, mode and size'], ['Code', 'Four letters, shown in-game on the status line'], ['Rules', `First to ${ONLINE_CONFIG.roundsToWin} rounds`]];
  menu.querySelector('#server-facts')!.innerHTML = facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  let shown = 0;
  menu.querySelectorAll<HTMLButtonElement>('#servers [data-map]').forEach(row => {
    const r = maps.find(x => x.id === row.dataset.map)!;
    row.hidden = !choosingMap() || !mapFits(r);
    if (!row.hidden) shown++;
    row.setAttribute('aria-pressed', String(r.id === mapId));
    row.querySelector('.srv small')!.textContent = mode === 'lab' ? 'Practice range' : `${s.label}${gameMode === 'sabotage' ? ` · ${r.sites > 1 ? 'sites A B' : 'site A'}` : ''}${online ? ' · private' : ''}`;
    row.querySelector('.mode')!.textContent = mode === 'lab' ? 'Range' : `[${md.tag}] ${md.name}`;
    row.querySelector('.players')!.textContent = mode === 'lab' ? '1 / 1' : `1 / ${s.perTeam * 2}`;
    row.querySelector('.ping')!.textContent = online ? 'Online' : 'Local';
  });
  const onlineRow = menu.querySelector<HTMLButtonElement>('.online-row')!;
  onlineRow.hidden = choosingMap();
  onlineRow.setAttribute('aria-pressed', 'true');
  onlineRow.querySelector('.srv small')!.textContent = onlineKind === 'quick' ? 'Map and mode rotate every match' : 'Private room';
  onlineRow.querySelector('.mode')!.textContent = onlineKind === 'quick' ? '[E] ⇄ [S]' : 'Host\'s choice';
  onlineRow.querySelector('.players')!.textContent = onlineKind === 'quick' ? `${s.label}` : roomCode.value || '····';
  menu.querySelector('#browser-count')!.textContent = online ? (choosingMap() ? `${shown} maps` : '1 server') : `${shown} ${mode === 'lab' ? 'ranges' : 'local servers'}`;

  const box = menu.querySelector<HTMLElement>('#showcase')!;
  if (online && onlineKind !== 'create') {
    box.querySelector('.region')!.textContent = `Online · ${server.database ?? 'not configured'}`;
    box.querySelector('h2')!.textContent = onlineKind === 'quick' ? `Quick Play ${s.label}` : 'Join a private room';
    box.querySelector('.meta')!.textContent = onlineKind === 'quick' ? `${s.name} · [E] ⇄ [S]${s.perTeam > 12 ? ' · big maps' : ''}` : 'Enter the four-letter code';
    box.querySelector('.about')!.textContent = onlineKind === 'quick'
      ? 'You join the fullest public room of this size, or open a new one. Every match moves on to the next map and alternates Elimination and Sabotage; bots hold the empty slots and step aside for players.'
      : 'Ask the host for the code shown on their status line (ROOM ABCD), or open their invite link.';
  } else {
    box.querySelector('.region')!.textContent = m.region;
    box.querySelector('h2')!.textContent = m.name;
    box.querySelector('.meta')!.textContent = mode === 'lab' ? 'Practice range · free store' : `[${md.tag}] ${md.name} · ${s.name} ${vs(s.perTeam)}${gameMode === 'sabotage' ? ` · ${m.sites} bomb site${m.sites > 1 ? 's' : ''}` : ''}`;
    box.querySelector('.about')!.textContent = m.description;
  }
  if (!deploy.disabled) deploy.textContent = deployLabel();
};
select('teams', 'team', team); select('skills', 'skill', skill); select('qualities', 'quality', quality); select('crosshairs', 'crosshair', crosshair);
/** Sight options live in `settings` (read from storage there); the buttons write them back. */
const selectSights = () => {
  select('scopemodes', 'scopemode', settings.scopeMode); select('reticlecolors', 'reticlecolor', settings.reticleColor);
  select('reticlestyles', 'reticlestyle', settings.reticleStyle); select('opticdetails', 'opticdetail', settings.opticDetail);
};
selectSights();
const deploy = menu.querySelector<HTMLButtonElement>('#deploy')!;
const status = menu.querySelector<HTMLElement>('#status')!;
refresh();

const onClick = (attr: string, fn: (value: string) => void) => menu.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach(b => b.addEventListener('click', () => { fn(b.dataset[attr]!); audio.ui(); }));
onClick('mode', v => { mode = v; status.textContent = mode === 'online' ? online.reason : ''; refresh(); showBackdrop(); });
onClick('gamemode', v => { gameMode = v as Mode; refresh(); showBackdrop(); });
onClick('size', v => { size = sizeOf(v).id; refresh(); showBackdrop(); });
onClick('onlinekind', v => { onlineKind = v as OnlineKind; refresh(); showBackdrop(); });
onClick('botsfill', v => { botsFill = v; refresh(); });
roomCode.addEventListener('input', () => { roomCode.value = roomCode.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); refresh(); });
onClick('map', v => { mapId = v; refresh(); showBackdrop(); });
onClick('team', v => { team = v; select('teams', 'team', team); });
onClick('skill', v => { skill = v; select('skills', 'skill', skill); });
onClick('crosshair', v => { crosshair = v as Crosshair; select('crosshairs', 'crosshair', crosshair); store.set('crosshair', crosshair); });
onClick('scopemode', v => { if (SCOPE_MODES.includes(v as ScopeMode)) { settings.scopeMode = v as ScopeMode; store.set('scopeMode', v); selectSights(); } });
onClick('reticlecolor', v => { if (RETICLE_COLORS.includes(v as ReticleColor)) { settings.reticleColor = v as ReticleColor; store.set('reticleColor', v); selectSights(); } });
onClick('reticlestyle', v => { if (RETICLE_STYLES.includes(v as ReticleStyle)) { settings.reticleStyle = v as ReticleStyle; store.set('reticleStyle', v); selectSights(); } });
onClick('opticdetail', v => { if (OPTIC_DETAILS.includes(v as OpticDetail)) { settings.opticDetail = v as OpticDetail; store.set('opticDetail', v); selectSights(); } });
onClick('quality', v => {
  quality = v as keyof typeof QUALITY; select('qualities', 'quality', quality); store.set('quality', quality);
  renderer?.applyQuality(QUALITY[quality]);
});
// Server browser: double-click a row to join it, like the real thing.
menu.querySelectorAll<HTMLButtonElement>('#servers .server').forEach(b => b.addEventListener('dblclick', () => { if (!deploy.disabled) void start(); }));

const sens = menu.querySelector<HTMLInputElement>('#sens')!, fov = menu.querySelector<HTMLInputElement>('#fov')!;
const volume = menu.querySelector<HTMLInputElement>('#volume')!, music = menu.querySelector<HTMLInputElement>('#music')!;
const clamp01 = (v: string) => Math.max(0, Math.min(1, Number(v) || 0));
settings.sensitivity = Math.max(0.2, Math.min(3, Number(store.get('sensitivity', '1')) || 1));
settings.fov = Math.max(65, Math.min(95, Number(store.get('fov', '78')) || 78));
sens.value = String(settings.sensitivity); fov.value = String(settings.fov);
const audio = new Audio();
audio.volume = clamp01(store.get('volume', '0.8'));
audio.musicVolume = clamp01(store.get('music', '0.6'));
volume.value = String(audio.volume); music.value = String(audio.musicVolume);
/** Vertical FOV (what three.js uses) with its 16:9 horizontal equivalent, which players usually quote. */
const horizontal = (v: number) => Math.round(2 * Math.atan(Math.tan(v * Math.PI / 360) * 16 / 9) * 180 / Math.PI);
const percent = (v: number) => v > 0 ? `${Math.round(v * 100)}%` : 'Off';
const showSettings = () => {
  menu.querySelector('#sens-out')!.textContent = `${settings.sensitivity.toFixed(2)}×`;
  menu.querySelector('#fov-out')!.textContent = `${settings.fov}° · ${horizontal(settings.fov)}° horizontal`;
  menu.querySelector('#volume-out')!.textContent = percent(audio.volume);
  menu.querySelector('#music-out')!.textContent = percent(audio.musicVolume);
};
showSettings();
sens.addEventListener('input', () => { settings.sensitivity = Number(sens.value); store.set('sensitivity', sens.value); showSettings(); });
fov.addEventListener('input', () => { settings.fov = Number(fov.value); store.set('fov', fov.value); showSettings(); });
volume.addEventListener('input', () => { audio.setVolume(Number(volume.value)); store.set('volume', volume.value); showSettings(); });
volume.addEventListener('change', () => audio.cash());
music.addEventListener('input', () => { audio.setMusicVolume(Number(music.value)); store.set('music', music.value); showSettings(); });
menu.querySelector('#bench')!.addEventListener('click', () => { location.search = `?bench&map=${mapId}&quality=${quality}`; });

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

/** Loops the menu theme once the player has interacted (browsers block audio before a gesture). */
function menuMusic() {
  if (!inMenu || !gestured || !theme) return;
  audio.start();
  void theme.then(buffer => { if (inMenu) audio.playMusic(buffer, THEME_START); }, () => undefined);
}
for (const type of ['pointerdown', 'keydown'] as const) document.addEventListener(type, () => { gestured = true; menuMusic(); });

function showBackdrop() {
  if (!assets || game || backdropMap === mapId) return;
  if (backdrop) renderer.scene.remove(backdrop.group);
  const def = loadMap(mapId).def;
  renderer.setTheme(THEMES[def.theme], def.sun);
  backdrop = new LevelView(assets, def, THEMES[def.theme]);
  backdropMap = mapId;
  renderer.scene.add(backdrop.group);
}

async function start() {
  const name = callsign.value.trim().slice(0, 16) || 'Lawbreaker';
  fitMap();
  if (!benchMode) { store.set('name', name); store.set('mode', mode); store.set('map', mapId); store.set('gameMode', gameMode); store.set('size', size); store.set('team', team); store.set('skill', skill); store.set('onlineKind', onlineKind); store.set('botsFill', botsFill); }
  deploy.disabled = true; deploy.textContent = mode === 'online' ? 'Joining…' : 'Starting…';
  inMenu = false;
  audio.start();
  audio.stopMusic();
  const teamChoice = team === 'auto' ? undefined : (Number(team) as Team);
  const botSkill = Math.max(0.1, Math.min(0.95, Number(skill) || 0.45));
  let link: GameLink;
  try {
    link = mode === 'online'
      ? await connectOnline(name, teamChoice, onlineKind === 'code' ? { kind: 'code', code: roomCode.value }
        : onlineKind === 'create' ? { kind: 'create', size: sizeOf(size).perTeam, mode: gameMode, mapId, bots: botsFill === 'on' }
        : { kind: 'quick', size: sizeOf(size).perTeam }, s => { status.textContent = s; })
      : mode === 'lab'
        ? new OfflineLink(mapId, name, teamChoice, {}, true)
        : new OfflineLink(mapId, name, teamChoice, { ...(gameMode === 'sabotage' ? SABOTAGE : ELIMINATION), teamSize: sizeOf(size).perTeam, botSkill, freeBuy: params.has('freebuy') });
  } catch (error) {
    status.textContent = `Could not join: ${(error as Error).message}`;
    deploy.disabled = false; deploy.textContent = deployLabel();
    inMenu = !benchMode; menuMusic();
    return;
  }
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
    deploy.disabled = false; deploy.textContent = deployLabel();
    showBackdrop();
    inMenu = !benchMode; menuMusic();
  };
}
deploy.addEventListener('click', () => void start());
const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
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
  assets = await loadAssets(f => { deploy.textContent = `Loading ${(f * 100).toFixed(0)}%`; });
  showBackdrop();
  deploy.disabled = false; deploy.textContent = deployLabel();
  status.textContent = mode === 'online' ? online.reason : '';
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
