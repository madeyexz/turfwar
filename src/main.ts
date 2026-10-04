import * as THREE from 'three';
import { initPhysics, Simulation, STEP, timeFactor } from './physics';
import { ArenaView } from './scene';
import { HUD } from './hud';
import { Player } from './player';
import { maps } from './battlefield';
import { defaultLaws, parseLawCommand } from '../shared/laws';
import { describeLaws } from './commands';
import { connectBackend, recordLaw, recordScore } from './backend';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
document.body.classList.add('title-screen');
app.innerHTML = `
  <header><a class="brand" href="/" aria-label="Lawbreaker home"><span class="brand-icon">◈</span> LAWBREAKER <span class="edition">FRONTLINE</span></a><div class="header-right"><span class="status-dot"></span> SOLO COMBAT <span class="separator">/</span><span id="backend-status">LOCAL SESSION</span><button id="sound" aria-pressed="true">SOUND ON</button><button id="maps-toggle" aria-expanded="false">M / DEPLOYMENT</button></div></header>
  <section class="title-copy"><div class="eyebrow">BOOTS ON THE GROUND. LAWS IN YOUR HANDS.</div><h1>CHANGE THE<br>RULES <em>OF WAR.</em></h1><p>Storm the outpost. Break the orbit.<br>Rewrite gravity, time, and light to take the field.</p><div class="title-quote">THREE BATTLEFIELDS <span>ONE UNFAIR ADVANTAGE</span></div></section>
  <div class="theater-title"><span>ACTIVE THEATER / <b id="world-number">01</b></span><strong id="world-name">CINDER BASIN</strong><p id="map-region">ASHLANDS / FORWARD OPERATING BASE</p></div>
  <button id="enter" class="enter-play" disabled>INITIALIZING…</button>
  <nav id="worlds" aria-label="Deployment maps"><div class="section-label">SELECT YOUR DROP ZONE <span>3 AVAILABLE</span></div>${maps.map((map, i) => `<button data-world="${i}" aria-pressed="${i === 0}" class="map-${i}"><span class="map-preview"><i>0${i + 1}</i><span>◈</span></span><span class="map-info"><small>${['DESERT / FORTIFIED', 'TUNDRA / RELAY', 'FOREST / UPLINK'][i]}</small><b>${map.name}</b><em>${map.description}</em></span><span class="world-arrow">↗</span></button>`).join('')}</nav>
  <div class="compass"><div>N <span>· · · · · · · · · · · · · · · · · · · · · ·</span> E</div><strong id="heading">000°</strong><small id="simulation-state">SIMULATION LIVE</small></div>
  <section class="objective"><small>OPERATION / LAWBREAKER</small><h2>SECURE THE ANOMALY</h2><p id="objective-text">Neutralize or displace the patrol. Hold the reactor.</p><div class="capture-track"><i id="capture-bar"></i></div><span id="capture-label">REACTOR CONTESTED</span></section>
  <aside id="laws"></aside>
  <div class="reticle"><span></span><span></span><i></i></div><div id="hitmarker">×</div>
  <div id="reactor-marker"><b>◇ A</b><small id="distance">48 m</small></div>
  <section class="radar-panel"><div class="radar-heading"><span>TACTICAL SCAN</span><span>N ↑</span></div><canvas id="radar" width="360" height="360" aria-label="Live radar showing player, structures and hostile drones"></canvas><div class="radar-footer"><i></i> VANGUARD <span id="radar-coords">0 : 48</span></div></section>
  <section class="vitals"><small>VANGUARD / FIELD OPERATIVE</small><div class="vital-line"><span>◈ SHIELD</span><b id="shield">100</b></div><div class="bar"><i id="shield-bar"></i></div><div class="vital-line"><span>+ HEALTH</span><b id="health">100</b></div><div class="bar health"><i id="health-bar"></i></div></section>
  <section class="weapon-hud"><small>VX–7 / PULSE CARBINE</small><div><b id="ammo">30</b><span>/ ∞</span></div><p id="weapon-state">AUTO <span>5.56 ENERGY</span></p><div class="score-line"><span id="kills">00</span> KILLS <span id="score">0000</span> XP</div></section>
  <div id="toast" role="status" aria-live="polite"></div><div id="damage-flash"></div>
  <div class="session-tools"><button id="reset">↻ REDEPLOY</button><button id="uniform">↓ UNIFORM GRAVITY</button><span id="fps">— FPS</span></div>
  <div class="mobile-note">A keyboard and mouse are required.<br>Deploy from a desktop browser.</div>
  <footer><div class="controls"><span><kbd>WASD</kbd> Move</span><span><kbd>SHIFT</kbd> Sprint</span><span><kbd>C</kbd> Crouch</span><span><kbd>SPACE</kbd> Jump</span><span><kbd>RMB</kbd> Aim</span><span><kbd>R</kbd> Reload</span><span><kbd>/</kbd> Override</span><span><kbd>ESC</kbd> Menu</span></div><span class="footer-note">YOUR WORLD. YOUR RULES.</span></footer>
`;

async function boot() {
  await initPhysics();
  const sim = new Simulation(), view = new ArenaView(app), player = new Player();
  const keys = new Set<string>();
  let currentMap = 0, playing = false, firing = false, muted = false, audio: AudioContext | undefined;
  let hitTime = 0, won = false;
  const enter = document.querySelector<HTMLButtonElement>('#enter')!;
  function tone(frequency: number, duration: number, gain: number) {
    if (muted || !audio) return;
    const oscillator = audio.createOscillator(), volume = audio.createGain();
    oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(frequency, audio.currentTime); oscillator.frequency.exponentialRampToValueAtTime(frequency * .3, audio.currentTime + duration);
    volume.gain.setValueAtTime(gain, audio.currentTime); volume.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
    oscillator.connect(volume); volume.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + duration);
  }
  function clearInput() { keys.clear(); firing = false; player.aiming = false; }
  const hud = new HUD((value, source) => {
    const command = parseLawCommand(value);
    let message: string | undefined;
    switch (command.kind) {
      case 'gravity': sim.laws.gravity = command.gravity; break;
      case 'time': sim.laws.time = command.time; break;
      case 'lightSpeed': sim.laws.lightSpeed = command.lightSpeed; break;
      case 'rewind': sim.laws.rewind = command.rewind; message = `Rewinding ${sim.startRewind(command.rewind.seconds).toFixed(1)}s. Keep moving.`; break;
    }
    hud.update(sim.laws);
    hud.toast(`${source} / ${message ?? describeLaws(sim.laws)[{ gravity: 0, time: 1, lightSpeed: 2, rewind: 3 }[command.kind]].text}`);
    void recordLaw(command);
  }, clearInput);
  hud.update(sim.laws);
  connectBackend(status => { document.querySelector('#backend-status')!.textContent = status === 'connected' ? 'SPACETIMEDB LIVE' : status === 'connecting' ? 'CONNECTING' : status === 'error' ? 'SYNC UNAVAILABLE' : 'LOCAL SESSION'; });
  enter.disabled = false; enter.innerHTML = 'DEPLOY TO BATTLEFIELD <span>→</span>';
  function selectMap(index: number) {
    currentMap = index; const map = maps[index];
    sim.laws = structuredClone(defaultLaws); sim.setMap(map); view.setMap(map); player.reset(map); clearInput(); won = false;
    if (index === 1) sim.laws.time.mode = 'playerMotion';
    if (index === 2) sim.laws.lightSpeed.c = 10;
    hud.update(sim.laws);
    document.querySelector('#world-number')!.textContent = `0${index + 1}`;
    document.querySelector('#world-name')!.textContent = map.name.toUpperCase();
    document.querySelector('#map-region')!.textContent = map.region;
    document.querySelectorAll<HTMLButtonElement>('[data-world]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.world) === index)));
    document.body.classList.remove('map-open', 'downed');
    document.querySelector('#maps-toggle')!.setAttribute('aria-expanded', 'false');
    enter.innerHTML = playing ? 'RESUME OPERATION <span>→</span>' : 'DEPLOY TO BATTLEFIELD <span>→</span>';
    hud.toast(`${map.name} / New deployment. Secure the reactor.`);
    for (const kind of ['gravity', 'time', 'lightSpeed', 'rewind'] as const) void recordLaw(parseLawCommand({ kind, [kind]: sim.laws[kind] }));
  }
  document.querySelectorAll<HTMLButtonElement>('[data-world]').forEach(b => b.addEventListener('click', () => selectMap(Number(b.dataset.world))));
  function toggleMaps() {
    if (!playing) return;
    document.exitPointerLock(); clearInput(); document.body.classList.toggle('map-open');
    document.querySelector('#maps-toggle')!.setAttribute('aria-expanded', String(document.body.classList.contains('map-open')));
  }
  document.querySelector('#maps-toggle')!.addEventListener('click', toggleMaps);
  document.querySelector('#reset')!.addEventListener('click', () => selectMap(currentMap));
  document.querySelector('#sound')!.addEventListener('click', () => { muted = !muted; document.querySelector('#sound')!.textContent = muted ? 'SOUND OFF' : 'SOUND ON'; document.querySelector('#sound')!.setAttribute('aria-pressed', String(!muted)); });
  document.querySelector('#uniform')!.addEventListener('click', () => {
    sim.laws.gravity = sim.laws.gravity.mode === 'central' ? { mode: 'uniform', strength: 1.5, exponent: 2, direction: { x: 0, y: -1, z: 0 } } : structuredClone(defaultLaws.gravity);
    hud.update(sim.laws); hud.toast(sim.laws.gravity.mode === 'uniform' ? 'Uniform gravity engaged. Projectiles fall in arcs.' : 'Central gravity engaged.');
    void recordLaw({ kind: 'gravity', gravity: sim.laws.gravity });
  });
  function start() {
    if (player.health <= 0) selectMap(currentMap);
    if (!playing) { sim.reset(); player.reset(maps[currentMap]); }
    playing = true; document.body.classList.remove('title-screen', 'map-open'); enter.hidden = true; view.weapon.visible = true;
    audio ??= new AudioContext(); void audio.resume();
    view.renderer.domElement.requestPointerLock()?.catch(() => { enter.hidden = false; hud.toast('Click Resume to enable mouse look.'); });
  }
  enter.addEventListener('click', start);
  document.addEventListener('pointerlockchange', () => {
    clearInput(); document.body.classList.toggle('pointer-locked', !!document.pointerLockElement);
    if (!document.pointerLockElement && playing) { enter.hidden = false; enter.innerHTML = player.health <= 0 ? 'REDEPLOY <span>→</span>' : 'RESUME OPERATION <span>→</span>'; }
  });
  document.addEventListener('mousemove', e => {
    if (document.pointerLockElement) { player.yaw -= e.movementX * (player.aiming ? .0011 : .002); player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch - e.movementY * (player.aiming ? .0011 : .002))); }
  });
  document.addEventListener('keydown', e => {
    if (hud.panel.open) return;
    if (e.code === 'Slash') { e.preventDefault(); hud.open(); return; }
    if (e.code === 'KeyM' && !e.repeat) { toggleMaps(); return; }
    if (/^Digit[1-4]$/.test(e.code) && !e.repeat) { hud.preset(Number(e.code.slice(-1)) - 1); return; }
    if (e.code === 'KeyR') { player.reload(); return; }
    keys.add(e.code); if (e.code === 'Space' || e.code === 'ControlLeft') e.preventDefault();
  });
  document.addEventListener('keyup', e => keys.delete(e.code)); window.addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', clearInput);
  view.renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
  view.renderer.domElement.addEventListener('mousedown', e => {
    if (!document.pointerLockElement) return;
    if (e.button === 0) firing = true; if (e.button === 2) player.aiming = true;
  });
  document.addEventListener('mouseup', e => { if (e.button === 0) firing = false; if (e.button === 2) player.aiming = false; });
  view.renderer.domElement.addEventListener('click', () => { if (!document.pointerLockElement && !document.body.classList.contains('map-open')) start(); });
  sim.onHit = position => { view.burst(position); hitTime = .2; hud.toast('+100 XP / Hostile neutralized'); tone(800, .1, .035); void recordScore(sim.score); };
  sim.onPlayerHit = () => {
    if (player.health <= 0) return;
    player.damage(24); tone(90, .12, .07);
    if (player.health <= 0) { clearInput(); document.exitPointerLock(); document.body.classList.add('downed'); enter.hidden = false; enter.innerHTML = 'REDEPLOY <span>→</span>'; hud.toast('OPERATIVE DOWN / Redeploy to try again.'); }
  };
  const radar = document.querySelector<HTMLCanvasElement>('#radar')!, ctx = radar.getContext('2d')!;
  function drawRadar() {
    const scale = 2; ctx.clearRect(0, 0, 360, 360); ctx.fillStyle = '#122228db'; ctx.fillRect(0, 0, 360, 360);
    ctx.strokeStyle = '#355058'; ctx.lineWidth = 1;
    for (let n = 0; n <= 360; n += 45) { ctx.beginPath(); ctx.moveTo(n, 0); ctx.lineTo(n, 360); ctx.moveTo(0, n); ctx.lineTo(360, n); ctx.stroke(); }
    ctx.fillStyle = '#66797c';
    for (const b of sim.map.structures) ctx.fillRect(180 + (b.x - b.w / 2) * scale, 180 + (b.z - b.d / 2) * scale, b.w * scale, b.d * scale);
    ctx.strokeStyle = '#75e4df'; ctx.beginPath(); ctx.arc(180, 180, 24, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ff735b'; for (const e of sim.entities) if (e.kind === 'drone') { const p = e.body.translation(); ctx.fillRect(177 + p.x * scale, 177 + p.z * scale, 6, 6); }
    ctx.save(); ctx.translate(180 + player.position.x * scale, 180 + player.position.z * scale); ctx.rotate(-player.yaw); ctx.fillStyle = '#94ffff'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-6, 7); ctx.lineTo(6, 7); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  const ui = Object.fromEntries(['ammo', 'health', 'shield', 'shield-bar', 'health-bar', 'score', 'kills', 'weapon-state', 'capture-bar', 'capture-label', 'objective-text', 'distance', 'heading', 'simulation-state', 'fps', 'damage-flash', 'hitmarker', 'reactor-marker', 'radar-coords'].map(id => [id, document.getElementById(id)!]));
  let previous = performance.now(), accumulator = 0, fpsTime = 0, fpsFrames = 0, uiTime = 0;
  function frame(now: number) {
    const elapsed = now - previous, dt = Math.min(elapsed / 1000, .05); previous = now;
    const active = playing && !!document.pointerLockElement && player.health > 0;
    player.update(dt, keys, active);
    view.camera.position.copy(player.position); view.camera.rotation.set(player.pitch + view.recoil * .045, player.yaw, 0);
    if (!playing) { view.camera.position.set(39, 16, 58); view.camera.lookAt(0, 2, -10); }
    if (firing && active && sim.rewindTicks === 0 && sim.entities.filter(e => e.kind === 'shot').length < 48 && player.fire()) {
      const direction = view.camera.getWorldDirection(new THREE.Vector3());
      sim.spawn('shot', player.position.clone().addScaledVector(direction, .65), direction.multiplyScalar(70));
      view.recoil = .07; tone(145, .09, .06);
    }
    accumulator += dt;
    while (accumulator >= STEP) { sim.tick(player.velocity.length(), active ? player.position : undefined); accumulator -= STEP; }
    view.velocity.copy(player.velocity); view.render(sim, dt, playing ? player : undefined);
    hitTime = Math.max(0, hitTime - dt); ui.hitmarker.style.opacity = hitTime > 0 ? '1' : '0';
    ui['damage-flash'].style.opacity = String(Math.max(0, .55 - player.sinceHit));
    document.body.classList.toggle('rewinding', sim.rewindTicks > 0);
    document.body.classList.toggle('aiming', player.aiming);
    if (sim.capture >= 100 && !won) { won = true; hud.toast('SECTOR SECURED / Anomaly control established. Choose another map to redeploy.'); tone(600, .5, .04); }
    uiTime += dt;
    if (uiTime > .08) {
      uiTime = 0; drawRadar();
      ui.ammo.textContent = String(player.ammo).padStart(2, '0'); ui.health.textContent = String(Math.ceil(player.health)); ui.shield.textContent = String(Math.ceil(player.shield));
      ui['health-bar'].style.width = `${player.health}%`; ui['shield-bar'].style.width = `${player.shield}%`;
      ui.score.textContent = String(sim.score).padStart(4, '0'); ui.kills.textContent = String(sim.score / 100).padStart(2, '0');
      ui['weapon-state'].textContent = player.reloadLeft > 0 ? `RELOADING / ${player.reloadLeft.toFixed(1)}s` : player.sprinting ? 'SPRINTING / WEAPON LOWERED' : 'AUTO / UNLIMITED RESERVE';
      ui['capture-bar'].style.width = `${sim.capture}%`; ui['capture-label'].textContent = sim.capture >= 100 ? 'SECTOR SECURED' : `ANOMALY CONTROL / ${Math.floor(sim.capture)}%`;
      const nearby = sim.entities.filter(e => e.kind === 'drone' && Math.hypot(e.body.translation().x, e.body.translation().z) < 18).length;
      ui['objective-text'].textContent = nearby ? `${nearby} hostile patrols near the reactor. Clear or displace them.` : 'Reactor clear. Move within 12 m and hold for 8 seconds.';
      ui.distance.textContent = `${Math.round(Math.hypot(player.position.x, player.position.z))} m`;
      ui.heading.textContent = `${Math.round(((-player.yaw * 180 / Math.PI) % 360 + 360) % 360).toString().padStart(3, '0')}°`;
      ui['radar-coords'].textContent = `${player.position.x.toFixed(0)} : ${player.position.z.toFixed(0)}`;
      ui['simulation-state'].textContent = sim.rewindTicks > 0 ? `REWIND / ${(sim.rewindTicks * STEP).toFixed(1)}s` : timeFactor(sim.laws.time, player.velocity.length()) === 0 ? 'TIME FROZEN' : 'LAWS ACTIVE';
      const point = new THREE.Vector3(0, 5, 0).project(view.camera);
      ui['reactor-marker'].style.display = point.z > 1 || Math.abs(point.x) > .9 || Math.abs(point.y) > .85 ? 'none' : '';
      ui['reactor-marker'].style.left = `${(point.x * .5 + .5) * 100}%`; ui['reactor-marker'].style.top = `${(-point.y * .5 + .5) * 100}%`;
    }
    fpsTime += elapsed; fpsFrames++;
    if (fpsTime >= 1000) { ui.fps.textContent = `${Math.round(fpsFrames * 1000 / fpsTime)} FPS`; fpsFrames = 0; fpsTime = 0; }
    requestAnimationFrame(frame);
  }
  if (import.meta.env.DEV) Object.assign(window, { __lawbreaker: { sim, view, player, keys } });
  requestAnimationFrame(frame);
}
void boot().catch(error => { console.error(error); app.textContent = 'Unable to initialize the battlefield. Enable WebGL2 and reload.'; });
