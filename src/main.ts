import * as THREE from 'three';
import { inject } from '@vercel/analytics';
import { loadMap, mapSummaries } from '../shared/maps/index';
import type { Team } from '../shared/match/state';
import { LOADOUTS, WEAPONS, type LoadoutId } from '../shared/weapons';
import { loadAssets, type Assets } from './assets';
import { Audio } from './audio';
import { Game } from './game/game';
import { settings } from './game/settings';
import type { GameLink } from './game/link';
import { OfflineLink } from './game/offline';
import { Bench, BENCH_SECONDS, benchReport, type BenchResult } from './game/bench';
import { onlineAvailable, connectOnline } from './net/online';
import { LevelView } from './render/level';
import { THEMES } from './render/materials';
import { QUALITY, Renderer } from './render/renderer';
import { renderTheme, THEME_START } from './theme';
import './style.css';
import './menu.css';

inject();

const app = document.querySelector<HTMLDivElement>('#app')!;
const params = new URLSearchParams(location.search);
const store = {
  get: (k: string, d: string) => { try { return localStorage.getItem(`lawbreaker.${k}`) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`lawbreaker.${k}`, v); } catch { /* storage disabled */ } },
};

const menu = document.createElement('div');
menu.id = 'menu';
const maps = mapSummaries();
const sizeLabel = (m: (typeof maps)[number]) => `${m.teamSize}v${m.teamSize} · ${m.flags} flags`;
menu.innerHTML = `
  <section class="panel">
    <header class="brand">
      <div class="tag">Lawbreaker // Frontline</div>
      <h1><span>Hold the line.</span><em>Take the city.</em></h1>
      <p class="lede">Earn credits for every kill and capture, buy your gun, grab power weapons off the map and take the flags.</p>
    </header>
    <div class="form">
      <label class="field"><span class="label">Callsign</span><input type="text" id="callsign" maxlength="16" autocomplete="off" spellcheck="false"></label>
      <div class="field"><span class="label">Mode</span><div class="choices modes" id="modes">
        <button class="choice" data-mode="offline"><b>Solo</b><small>Bots on both teams. Works offline.</small></button>
        <button class="choice" data-mode="online"><b>Online</b><small id="online-note">Real players; bots fill the gaps.</small></button>
        <button class="choice" data-mode="lab"><b>Practice</b><small>No bots. Every gun is free.</small></button>
      </div></div>
      <div class="field"><span class="label">Kit</span><div class="choices kits" id="loadouts">${Object.entries(LOADOUTS).map(([id, l]) => `<button class="choice" data-loadout="${id}"><b>${l.name}</b><small>${l.weapons.map(w => WEAPONS[w].short).join(' · ')}</small></button>`).join('')}</div></div>
      <div class="row">
        <div class="field"><span class="label">Faction</span><div class="choices segmented" id="teams">
          <button class="choice" data-team="auto"><b>Auto</b></button><button class="choice" data-team="0"><b class="aegis">Aegis</b></button><button class="choice" data-team="1"><b class="crimson">Crimson</b></button>
        </div></div>
        <div class="field"><span class="label">Bots</span><div class="choices segmented" id="skills">
          <button class="choice" data-skill="0.25"><b>Recruit</b></button><button class="choice" data-skill="0.45"><b>Veteran</b></button><button class="choice" data-skill="0.75"><b>Elite</b></button>
        </div></div>
      </div>
      <details class="settings">
        <summary>Settings &amp; controls</summary>
        <div class="field"><span class="label">Graphics</span><div class="choices segmented" id="qualities">
          <button class="choice" data-quality="low" title="No bloom, 1k shadows"><b>Low</b></button><button class="choice" data-quality="medium" title="Bloom, 2k shadows"><b>Medium</b></button><button class="choice" data-quality="high" title="1.5× resolution"><b>High</b></button>
        </div></div>
        <div class="sliders">
          <label class="field"><span class="label">Mouse sensitivity <output id="sens-out"></output></span><input type="range" id="sens" min="0.2" max="3" step="0.05"></label>
          <label class="field"><span class="label">Field of view <output id="fov-out"></output></span><input type="range" id="fov" min="65" max="95" step="1"></label>
          <label class="field"><span class="label">Menu music <output id="music-out"></output></span><input type="range" id="music" min="0" max="1" step="0.05"></label>
        </div>
        <dl class="controls">
          <dt>WASD · Mouse</dt><dd>Move · look</dd><dt>LMB · RMB</dt><dd>Fire · aim down sights</dd>
          <dt>Shift · Space</dt><dd>Sprint · jump</dd><dt>C / Ctrl</dt><dd>Crouch (slide while sprinting)</dd>
          <dt>R · Q · G</dt><dd>Reload · swap weapon · grenade</dd><dt>B · E</dt><dd>Buy menu · pick up weapon</dd>
          <dt>Tab · Esc</dt><dd>Scoreboard · release mouse</dd>
        </dl>
        <button class="bench-link" id="bench">Run the ${BENCH_SECONDS}-second performance check</button>
        <p class="credits">Characters, weapons and props: CC0 packs by Quaternius. Textures: CC0 Poly Haven. Font: Rajdhani (OFL). No proprietary game assets.</p>
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
      <p class="online-only">Online matches follow the server's map rotation.</p>
    </div>
    <div class="maps" id="maps">${maps.map(m => `<button class="map" data-map="${m.id}" data-theme="${m.theme}"><b>${m.name}</b><small>${sizeLabel(m)}</small></button>`).join('')}</div>
  </section>`;
app.appendChild(menu);
document.body.classList.add('menu-open');

const select = (group: string, attr: string, value: string) => menu.querySelectorAll<HTMLButtonElement>(`#${group} [data-${attr}]`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
let mode = params.get('mode') ?? store.get('mode', 'offline');
let mapId = params.get('map') ?? store.get('map', maps[0].id);
if (!maps.some(m => m.id === mapId)) mapId = maps[0].id;
let loadout = store.get('loadout', 'assault') as LoadoutId;
let team = params.get('team') ?? store.get('team', 'auto');
let skill = params.get('skill') ?? store.get('skill', '0.45');
let quality = (params.get('quality') ?? store.get('quality', 'medium')) as keyof typeof QUALITY;
if (!QUALITY[quality]) quality = 'medium';
/** ?bench: scripted solo run that measures frame times on this device. */
const benchMode = params.has('bench');
if (benchMode) mode = 'offline';
const callsign = menu.querySelector<HTMLInputElement>('#callsign')!;
callsign.value = params.get('name') ?? store.get('name', `Lawbreaker-${Math.floor(Math.random() * 900 + 100)}`);
const online = onlineAvailable();
if (!online.ok) {
  (menu.querySelector('[data-mode="online"]') as HTMLButtonElement).disabled = true;
  const note = menu.querySelector<HTMLElement>('#online-note')!;
  note.textContent = 'Not set up in this build.';
  note.parentElement!.title = online.reason;
  if (mode === 'online') mode = 'offline';
}
const showcase = () => {
  const m = maps.find(x => x.id === mapId)!;
  const box = menu.querySelector<HTMLElement>('#showcase')!;
  box.querySelector('.region')!.textContent = m.region;
  box.querySelector('h2')!.textContent = m.name;
  box.querySelector('.meta')!.textContent = sizeLabel(m);
  box.querySelector('.about')!.textContent = m.description;
  menu.classList.toggle('mode-online', mode === 'online');
};
select('modes', 'mode', mode); select('maps', 'map', mapId); select('loadouts', 'loadout', loadout); select('teams', 'team', team); select('skills', 'skill', skill); select('qualities', 'quality', quality);
showcase();
menu.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode!; select('modes', 'mode', mode); showcase(); }));
menu.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => b.addEventListener('click', () => { mapId = b.dataset.map!; select('maps', 'map', mapId); showcase(); showBackdrop(); }));
menu.querySelectorAll<HTMLButtonElement>('[data-loadout]').forEach(b => b.addEventListener('click', () => { loadout = b.dataset.loadout as LoadoutId; select('loadouts', 'loadout', loadout); }));
menu.querySelectorAll<HTMLButtonElement>('[data-team]').forEach(b => b.addEventListener('click', () => { team = b.dataset.team!; select('teams', 'team', team); }));
menu.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach(b => b.addEventListener('click', () => { skill = b.dataset.skill!; select('skills', 'skill', skill); }));
menu.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach(b => b.addEventListener('click', () => {
  quality = b.dataset.quality as keyof typeof QUALITY; select('qualities', 'quality', quality); store.set('quality', quality);
  renderer?.applyQuality(QUALITY[quality]);
}));
const sens = menu.querySelector<HTMLInputElement>('#sens')!, fov = menu.querySelector<HTMLInputElement>('#fov')!, music = menu.querySelector<HTMLInputElement>('#music')!;
settings.sensitivity = Math.max(0.2, Math.min(3, Number(store.get('sensitivity', '1')) || 1));
settings.fov = Math.max(65, Math.min(95, Number(store.get('fov', '78')) || 78));
sens.value = String(settings.sensitivity); fov.value = String(settings.fov);
const audio = new Audio();
audio.musicVolume = Math.max(0, Math.min(1, Number(store.get('music', '0.6')) || 0));
music.value = String(audio.musicVolume);
/** Vertical FOV (what three.js uses) with its 16:9 horizontal equivalent, which players usually quote. */
const horizontal = (v: number) => Math.round(2 * Math.atan(Math.tan(v * Math.PI / 360) * 16 / 9) * 180 / Math.PI);
const showSettings = () => {
  menu.querySelector('#sens-out')!.textContent = `${settings.sensitivity.toFixed(2)}×`;
  menu.querySelector('#fov-out')!.textContent = `${settings.fov}° · ${horizontal(settings.fov)}° horizontal`;
  menu.querySelector('#music-out')!.textContent = audio.musicVolume > 0 ? `${Math.round(audio.musicVolume * 100)}%` : 'Off';
};
showSettings();
sens.addEventListener('input', () => { settings.sensitivity = Number(sens.value); store.set('sensitivity', sens.value); showSettings(); });
fov.addEventListener('input', () => { settings.fov = Number(fov.value); store.set('fov', fov.value); showSettings(); });
music.addEventListener('input', () => { audio.setMusicVolume(Number(music.value)); store.set('music', music.value); showSettings(); });
menu.querySelector('#bench')!.addEventListener('click', () => { location.search = `?bench&map=${mapId}&quality=${quality}`; });
const deploy = menu.querySelector<HTMLButtonElement>('#deploy')!;
const status = menu.querySelector<HTMLElement>('#status')!;

let assets: Assets;
let renderer: Renderer;
let game: Game | undefined;
let backdrop: LevelView | undefined;
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
  if (!assets || game) return;
  if (backdrop) renderer.scene.remove(backdrop.group);
  const def = loadMap(mapId).def;
  renderer.setTheme(THEMES[def.theme], def.sun);
  backdrop = new LevelView(assets, def, THEMES[def.theme]);
  renderer.scene.add(backdrop.group);
}

async function start() {
  const name = callsign.value.trim().slice(0, 16) || 'Lawbreaker';
  if (!benchMode) { store.set('name', name); store.set('mode', mode); store.set('map', mapId); store.set('loadout', loadout); store.set('team', team); store.set('skill', skill); }
  deploy.disabled = true; deploy.textContent = 'Deploying…';
  inMenu = false;
  audio.start();
  audio.stopMusic();
  const teamChoice = team === 'auto' ? undefined : (Number(team) as Team);
  let link: GameLink;
  try {
    link = mode === 'online'
      ? await connectOnline(name, loadout, teamChoice, s => { status.textContent = s; })
      : new OfflineLink(mapId, name, loadout, teamChoice, { botSkill: Math.max(0.1, Math.min(0.95, Number(skill) || 0.45)), freeBuy: params.has('freebuy') }, mode === 'lab');
  } catch (error) {
    status.textContent = `Could not deploy: ${(error as Error).message}`;
    deploy.disabled = false; deploy.textContent = 'Deploy';
    inMenu = !benchMode; menuMusic();
    return;
  }
  if (backdrop) { renderer.scene.remove(backdrop.group); backdrop = undefined; }
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
    deploy.disabled = false; deploy.textContent = 'Deploy';
    showBackdrop();
    inMenu = !benchMode; menuMusic();
  };
}
deploy.addEventListener('click', () => void start());
document.addEventListener('keydown', e => {
  if (e.code === 'Escape' && game && !game.input.locked) { /* pointer already released; HUD stays */ }
  if (e.code === 'KeyM' && game && !game.input.locked && e.target === document.body) game.onExit?.();
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
    <table>${benchReport(r).map(([k, v]) => `<tr><th>${k}</th><td></td></tr>`).join('')}</table>
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
  deploy.disabled = false; deploy.textContent = 'Deploy';
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
