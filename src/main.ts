import * as THREE from 'three';
import { initPhysics, Simulation, STEP, timeFactor } from './physics';
import { ArenaView } from './scene';
import { HUD } from './hud';
import { defaultLaws, parseLawCommand } from '../shared/laws';
import { describeLaws } from './commands';
import { connectBackend, recordLaw, recordScore } from './backend';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
document.body.classList.add('title-screen');
app.innerHTML = `
  <header><a class="brand" href="/" aria-label="Lawbreaker home"><span class="brand-icon">◉</span> LAWBREAKER<span class="edition">EXPERIMENT 001</span></a><div class="header-right"><span class="status-dot"></span> PHYSICS PLAYGROUND <span class="separator">/</span> <span id="backend-status">LOCAL SESSION</span></div></header>
  <div class="topline"><span>OBSERVATORY <b id="world-number">01</b> <span class="muted" id="world-name">/ THE NEWTONIAN WORLD</span></span><span><i class="live-dot"></i> <span id="simulation-state">SIMULATION LIVE</span></span></div>
  <aside id="laws"><div class="section-label">THE LAWS OF THIS WORLD <span>↗</span></div><div class="law"><span class="law-icon">◎</span><div><small>01 / GRAVITY</small><p id="gravity-label">Gravity follows the inverse square of distance.</p><code id="gravity-value">F ∝ 1/r²</code></div></div></aside>
  <div class="reticle"><span></span><span></span></div>
  <div class="planet-label"><span class="tiny-cross">+</span><div>KEPLER–01<small>CENTRAL MASS / 80 μ</small></div></div>
  <div class="score-panel"><small>TARGETS HIT</small><div><span id="hits">00</span><span class="score-slash">/</span><span id="target-count">08</span></div><p><span id="score">0000</span> <span class="muted">PTS</span></p></div>
  <div id="toast" role="status" aria-live="polite"></div>
  <section class="title-copy"><div class="eyebrow">A FIRST-PERSON PHYSICS PLAYGROUND</div><h1>The universe<br>has rules.<br><em>Not anymore.</em></h1><p>One arena. Infinite possibilities.<br>Change the laws of physics with a sentence.</p><div class="title-quote">INSPIRED BY <span>EINSTEIN’S DREAMS</span></div></section>
  <button id="enter" class="enter-play" disabled>INITIALIZING PHYSICS…</button>
  <nav id="worlds" aria-label="Choose a world"><div class="section-label">THREE WORLDS. DIFFERENT RULES.</div><button data-world="0" aria-pressed="true"><span class="world-icon">◎</span><span><small>01 / THE CLASSICAL WORLD</small><b>Newton’s garden</b><em>Stable orbits. A familiar universe.</em></span><span class="world-arrow">↗</span></button><button data-world="1" aria-pressed="false"><span class="world-icon">◷</span><span><small>02 / THE STILL WORLD</small><b>A moment, forever</b><em>Stand still, and so does time.</em></span><span class="world-arrow">↗</span></button><button data-world="2" aria-pressed="false"><span class="world-icon">☼</span><span><small>03 / THE SLOW-LIGHT WORLD</small><b>Chasing the light</b><em>Walk at the edge of relativity.</em></span><span class="world-arrow">↗</span></button></nav>
  <div class="session-tools"><button id="reset" title="Reset targets and current world (R)">↻ <span>RESET WORLD</span></button><button id="uniform" title="Switch between uniform and central gravity">↓ <span>UNIFORM GRAVITY</span></button><span id="fps">— FPS</span></div>
  <div class="mobile-note">Designed for a keyboard and mouse.<br>Open on a desktop to enter the arena.</div>
  <footer><div class="controls"><span><kbd>W A S D</kbd> Move</span><span><kbd>MOUSE</kbd> Look / shoot</span><span><kbd>SPACE</kbd> Jump</span><span><kbd>ESC</kbd> Release cursor</span></div><span class="footer-note">NOTHING IS SET IN STONE.</span></footer>
`;

async function boot() {
  await initPhysics();
  const sim = new Simulation();
  const view = new ArenaView(app);
  const keys = new Set<string>();
  let currentWorld = 0;
  const hud = new HUD((value, source) => {
    const command = parseLawCommand(value);
    let message: string | undefined;
    switch (command.kind) {
      case 'gravity': sim.laws.gravity = command.gravity; break;
      case 'time': sim.laws.time = command.time; break;
      case 'lightSpeed': sim.laws.lightSpeed = command.lightSpeed; break;
      case 'rewind': sim.laws.rewind = command.rewind; message = `Rewinding ${sim.startRewind(command.rewind.seconds).toFixed(1)} seconds. You stay in control.`; break;
    }
    const index = { gravity: 0, time: 1, lightSpeed: 2, rewind: 3 }[command.kind];
    hud.update(sim.laws); hud.toast(`${source} / ${message ?? describeLaws(sim.laws)[index].text}`);
    document.querySelector('#world-name')!.textContent = '/ YOUR REWRITTEN WORLD';
    document.querySelector('#uniform span')!.textContent = sim.laws.gravity.mode === 'uniform' ? 'CENTRAL GRAVITY' : 'UNIFORM GRAVITY';
    void recordLaw(command);
  }, () => keys.clear());
  hud.update(sim.laws);
  connectBackend(status => { document.querySelector('#backend-status')!.textContent = status === 'connected' ? 'SPACETIMEDB LIVE' : status === 'connecting' ? 'CONNECTING' : status === 'error' ? 'SYNC UNAVAILABLE' : 'LOCAL SESSION'; });
  let playing = false;
  let yaw = 0, pitch = -0.12, jumpVelocity = 0;
  const player = new THREE.Vector3(0, 2.3, 19);
  const enter = document.querySelector<HTMLButtonElement>('#enter')!;
  enter.disabled = false; enter.innerHTML = 'ENTER THE ARENA <span>↗</span>';
  function selectWorld(index: number) {
    currentWorld = index;
    sim.laws = structuredClone(defaultLaws);
    if (index === 1) sim.laws.time.mode = 'playerMotion';
    if (index === 2) sim.laws.lightSpeed.c = 10;
    sim.reset(); keys.clear(); player.set(0, 2.3, 19); yaw = 0; pitch = -0.12; jumpVelocity = 0;
    hud.update(sim.laws);
    document.querySelector('#world-number')!.textContent = `0${index + 1}`;
    document.querySelector('#world-name')!.textContent = `/ ${['THE NEWTONIAN WORLD', 'THE STILL WORLD', 'THE SLOW-LIGHT WORLD'][index]}`;
    document.querySelectorAll<HTMLButtonElement>('[data-world]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.world) === index)));
    document.querySelector('#uniform span')!.textContent = 'UNIFORM GRAVITY';
    hud.toast(['Stable orbits restored. Make yourself at home.', 'Time is waiting for you. Move to set it free.', 'Light is slow. Move forward and backward to see the shift.'][index]);
    for (const kind of ['gravity', 'time', 'lightSpeed', 'rewind'] as const) void recordLaw(parseLawCommand({ kind, [kind]: sim.laws[kind] }));
  }
  document.querySelectorAll<HTMLButtonElement>('[data-world]').forEach(button => button.addEventListener('click', () => selectWorld(Number(button.dataset.world))));
  document.querySelector('#reset')!.addEventListener('click', () => selectWorld(currentWorld));
  document.querySelector('#uniform')!.addEventListener('click', () => {
    sim.laws.gravity = sim.laws.gravity.mode === 'central' ? { mode: 'uniform', strength: 1.5, exponent: 2, direction: { x: 0, y: -1, z: 0 } } : structuredClone(defaultLaws.gravity);
    hud.update(sim.laws); hud.toast(sim.laws.gravity.mode === 'uniform' ? 'Gravity now pulls down. Projectiles fall in arcs.' : 'Central gravity restored. Press R to reset the orbits.');
    document.querySelector('#uniform span')!.textContent = sim.laws.gravity.mode === 'uniform' ? 'CENTRAL GRAVITY' : 'UNIFORM GRAVITY';
    void recordLaw({ kind: 'gravity', gravity: sim.laws.gravity });
  });
  function start() {
    if (!playing) { sim.reset(); document.body.classList.remove('title-screen'); }
    playing = true; enter.hidden = true; view.weapon.visible = true;
    view.renderer.domElement.requestPointerLock()?.catch(() => hud.toast('Click the arena to enable mouse look.'));
  }
  enter.addEventListener('click', start);
  document.addEventListener('pointerlockchange', () => {
    keys.clear();
    document.body.classList.toggle('pointer-locked', !!document.pointerLockElement);
    if (!document.pointerLockElement && playing) { enter.hidden = false; enter.innerHTML = 'RESUME EXPLORING <span>↗</span>'; }
  });
  document.addEventListener('mousemove', e => {
    if (document.pointerLockElement) { yaw -= e.movementX * 0.002; pitch = Math.max(-1.3, Math.min(1.3, pitch - e.movementY * 0.002)); }
  });
  document.addEventListener('keydown', e => {
    if (hud.panel.open) return;
    if (e.code === 'Slash') { e.preventDefault(); hud.open(); return; }
    if (/^Digit[1-4]$/.test(e.code) && !e.repeat) { hud.preset(Number(e.code.slice(-1)) - 1); return; }
    if (e.code === 'KeyR' && !e.repeat) { selectWorld(currentWorld); return; }
    keys.add(e.code); if (e.code === 'Space') e.preventDefault();
  });
  document.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  view.renderer.domElement.addEventListener('click', () => {
    if (!document.pointerLockElement) { start(); return; }
    if (sim.rewindTicks > 0 || sim.entities.filter(e => e.kind === 'shot').length >= 48) return;
    const direction = view.camera.getWorldDirection(new THREE.Vector3());
    const position = player.clone().addScaledVector(direction, 0.6);
    sim.spawn('shot', position, direction.multiplyScalar(24));
    view.recoil = 0.08;
  });
  sim.onHit = () => { hud.toast('+100 / Target neutralized'); void recordScore(sim.score); };
  let previous = performance.now(), accumulator = 0, fpsTime = 0, fpsFrames = 0;
  function frame(now: number) {
    const elapsed = now - previous;
    const dt = Math.min(elapsed / 1000, 0.05); previous = now;
    const oldPosition = player.clone();
    if (playing && document.pointerLockElement) {
      const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
      const right = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
      const movement = new THREE.Vector3(right, 0, -forward).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      player.addScaledVector(movement, dt * 6);
      const radius = Math.hypot(player.x, player.z);
      if (radius > 22) { player.x *= 22 / radius; player.z *= 22 / radius; }
      const planetDistance = player.length();
      if (planetDistance < 3.1) player.multiplyScalar(3.1 / planetDistance);
      if (keys.has('Space') && player.y <= 2.3) jumpVelocity = 5;
      jumpVelocity -= 12 * dt; player.y = Math.max(2.3, player.y + jumpVelocity * dt);
    }
    const playerSpeed = dt > 0 ? player.distanceTo(oldPosition) / dt : 0;
    view.velocity.copy(player).sub(oldPosition).divideScalar(dt || 1);
    view.camera.position.copy(player); view.camera.rotation.set(pitch, yaw, 0);
    if (!playing) view.camera.position.x = -6;
    accumulator += dt;
    while (accumulator >= STEP) { sim.tick(playerSpeed); accumulator -= STEP; }
    view.render(sim);
    document.querySelector('#simulation-state')!.textContent = sim.rewindTicks > 0 ? `REWINDING / ${(sim.rewindTicks * STEP).toFixed(1)}s` : timeFactor(sim.laws.time, playerSpeed) === 0 ? 'TIME FROZEN / MOVE TO ADVANCE' : 'SIMULATION LIVE';
    document.body.classList.toggle('rewinding', sim.rewindTicks > 0);
    document.querySelector('#score')!.textContent = String(sim.score).padStart(4, '0');
    document.querySelector('#hits')!.textContent = String(sim.score / 100).padStart(2, '0');
    fpsTime += elapsed; fpsFrames++;
    if (fpsTime >= 1000) { document.querySelector('#fps')!.textContent = `${Math.round(fpsFrames * 1000 / fpsTime)} FPS`; fpsFrames = 0; fpsTime = 0; }
    requestAnimationFrame(frame);
  }
  // Development-only inspection for repeatable browser checks. Excluded from production.
  if (import.meta.env.DEV) Object.assign(window, { __lawbreaker: { sim, view, player, keys } });
  requestAnimationFrame(frame);
}
void boot().catch(error => { app.innerHTML = `<div class="fatal">Unable to start the arena. Enable WebGL2 and reload.<br>${error instanceof Error ? error.message : 'Initialization failed'}</div>`; });
