import * as THREE from 'three';
import { inject } from '@vercel/analytics';
import { loadMap, mapSummaries } from '../shared/maps/index';
import type { Team } from '../shared/match/state';
import { LOADOUTS, type LoadoutId } from '../shared/weapons';
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
menu.innerHTML = `
  <div class="left">
    <div class="tag">Lawbreaker // Frontline</div>
    <h1>CHANGE THE<br>RULES <em>OF WAR</em></h1>
    <p class="lede">Squad-based sci-fi infantry combat. Capture the outposts, hold the reactor — and when the fight turns, rewrite gravity, time and light with a sentence.</p>
    <label class="field">Callsign<input type="text" id="callsign" maxlength="16" autocomplete="off" spellcheck="false"></label>
    <div class="field"><label class="field">Mode</label><div class="choices" id="modes">
      <button class="choice" data-mode="offline"><b>Solo skirmish</b><small>Bots fill both teams in this tab (50v50 on Meridian). Works fully offline.</small></button>
      <button class="choice" data-mode="online"><b>Online match</b><small id="online-note">Real players via SpacetimeDB; bots fill empty slots.</small></button>
      <button class="choice" data-mode="lab"><b>Law Lab</b><small>No bots, passive sentinels. Experiment with the laws in peace.</small></button>
    </div></div>
    <div class="field"><label class="field">Battlefield</label><div class="choices" id="maps">${maps.map(m => `<button class="choice" data-map="${m.id}"><b>${m.name}</b><small>${m.description}</small></button>`).join('')}</div></div>
    <div class="field"><label class="field">Kit</label><div class="choices" id="loadouts">${Object.entries(LOADOUTS).map(([id, l]) => `<button class="choice" data-loadout="${id}"><b>${l.name}</b><small>${l.role}</small></button>`).join('')}</div></div>
    <div class="field"><label class="field">Faction</label><div class="choices" id="teams" style="grid-template-columns:1fr 1fr 1fr">
      <button class="choice" data-team="auto"><b>Auto</b></button><button class="choice" data-team="0"><b style="color:var(--aegis)">Aegis</b></button><button class="choice" data-team="1"><b style="color:var(--crimson)">Crimson</b></button>
    </div></div>
    <div class="field"><label class="field">Bot difficulty (solo)</label><div class="choices" id="skills" style="grid-template-columns:1fr 1fr 1fr">
      <button class="choice" data-skill="0.25"><b>Recruit</b></button><button class="choice" data-skill="0.45"><b>Veteran</b></button><button class="choice" data-skill="0.75"><b>Elite</b></button>
    </div></div>
    <div class="field"><label class="field">Graphics</label><div class="choices" id="qualities" style="grid-template-columns:1fr 1fr 1fr">
      <button class="choice" data-quality="low"><b>Low</b><small>No bloom, 1k shadows</small></button><button class="choice" data-quality="medium"><b>Medium</b><small>Bloom, 2k shadows</small></button><button class="choice" data-quality="high"><b>High</b><small>1.5× resolution</small></button>
    </div></div>
    <div class="field sliders">
      <label class="field"><span>Mouse sensitivity · <output id="sens-out"></output></span><input type="range" id="sens" min="0.2" max="3" step="0.05"></label>
      <label class="field"><span>Field of view · <output id="fov-out"></output></span><input type="range" id="fov" min="65" max="95" step="1"></label>
      <label class="field"><span>Menu music · <output id="music-out"></output></span><input type="range" id="music" min="0" max="1" step="0.05"></label>
    </div>
    <button class="deploy" id="deploy" disabled>Loading…</button>
    <div class="status" id="status"></div>
    <button class="bench-link" id="bench">Run the ${BENCH_SECONDS}-second performance check</button>
    <div class="controls">
      <span>WASD · Mouse</span><span>Move · look</span><span>LMB · RMB</span><span>Fire · aim down sights</span>
      <span>Shift · Space</span><span>Sprint · jump</span><span>C / Ctrl</span><span>Crouch (while sprinting: slide)</span>
      <span>R · Q / wheel · G</span><span>Reload · swap weapon · grenade</span><span>/ · 1 2 3 4</span><span>Rewrite a law · law presets</span>
      <span>Tab · Esc</span><span>Scoreboard · release mouse</span>
    </div>
    <div class="credits">Characters, weapons, drones and props: CC0 packs by Quaternius. Surface textures: CC0 Poly Haven. Font: Rajdhani (OFL). No proprietary game assets.</div>
  </div>
  <div></div>`;
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
  menu.querySelector('#online-note')!.textContent = online.reason;
  if (mode === 'online') mode = 'offline';
}
select('modes', 'mode', mode); select('maps', 'map', mapId); select('loadouts', 'loadout', loadout); select('teams', 'team', team); select('skills', 'skill', skill); select('qualities', 'quality', quality);
menu.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode!; select('modes', 'mode', mode); }));
menu.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => b.addEventListener('click', () => { mapId = b.dataset.map!; select('maps', 'map', mapId); showBackdrop(); }));
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
  menu.querySelector('#fov-out')!.textContent = `${settings.fov}° vertical · ${horizontal(settings.fov)}° horizontal (16:9)`;
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
      : new OfflineLink(mapId, name, loadout, teamChoice, { botSkill: Math.max(0.1, Math.min(0.95, Number(skill) || 0.45)) }, mode === 'lab');
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
      backdrop?.reactor?.update(now / 1000);
      renderer.render(now / 1000, new THREE.Vector3(), 300);
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
