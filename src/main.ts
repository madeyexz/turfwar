import * as THREE from 'three';
import { initPhysics, Simulation, STEP } from './physics';
import { ArenaView } from './scene';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header><a class="brand" href="/" aria-label="Lawbreaker home"><span class="brand-icon">◉</span> LAWBREAKER<span class="edition">EXPERIMENT 001</span></a><div class="header-right"><span class="status-dot"></span> PHYSICS PLAYGROUND <span class="separator">/</span> <span id="backend-status">LOCAL SESSION</span></div></header>
  <div class="topline"><span>OBSERVATORY <b>01</b> <span class="muted">/ THE NEWTONIAN WORLD</span></span><span><i class="live-dot"></i> SIMULATION LIVE</span></div>
  <aside id="laws"><div class="section-label">THE LAWS OF THIS WORLD <span>↗</span></div><div class="law"><span class="law-icon">↓</span><div><small>01 / GRAVITY</small><p id="gravity-label">Gravity pulls everything down.</p><code id="gravity-value">g = 1.5 m/s²</code></div></div></aside>
  <div class="reticle"><span></span><span></span></div>
  <div class="planet-label"><span class="tiny-cross">+</span><div>KEPLER–01<small>CENTRAL MASS / 80 μ</small></div></div>
  <div class="score-panel"><small>TARGETS HIT</small><div><span id="hits">00</span><span class="score-slash">/</span><span id="target-count">08</span></div><p><span id="score">0000</span> <span class="muted">PTS</span></p></div>
  <div id="toast" role="status" aria-live="polite"></div>
  <button id="enter" class="enter-play">ENTER THE ARENA <span>↗</span></button>
  <footer><div class="controls"><span><kbd>W A S D</kbd> Move</span><span><kbd>MOUSE</kbd> Look / shoot</span><span><kbd>SPACE</kbd> Jump</span><span><kbd>ESC</kbd> Release cursor</span></div><span class="footer-note">NOTHING IS SET IN STONE.</span></footer>
`;

async function boot() {
  await initPhysics();
  const sim = new Simulation();
  const view = new ArenaView(app);
  const keys = new Set<string>();
  let playing = false;
  let yaw = 0, pitch = -0.12, jumpVelocity = 0;
  const player = new THREE.Vector3(0, 2.3, 19);
  const enter = document.querySelector<HTMLButtonElement>('#enter')!;
  function start() {
    playing = true; enter.hidden = true;
    view.renderer.domElement.requestPointerLock()?.catch(() => toast('Click the arena to enable mouse look.'));
  }
  enter.addEventListener('click', start);
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && playing) { enter.hidden = false; enter.innerHTML = 'RESUME EXPLORING <span>↗</span>'; }
  });
  document.addEventListener('mousemove', e => {
    if (document.pointerLockElement) { yaw -= e.movementX * 0.002; pitch = Math.max(-1.3, Math.min(1.3, pitch - e.movementY * 0.002)); }
  });
  document.addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
  document.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  view.renderer.domElement.addEventListener('click', () => {
    if (!document.pointerLockElement) { start(); return; }
    const direction = view.camera.getWorldDirection(new THREE.Vector3());
    const position = player.clone().addScaledVector(direction, 0.6);
    sim.spawn('shot', position, direction.multiplyScalar(24));
  });
  sim.onHit = () => { toast('+100 / Target neutralized'); };
  function toast(text: string) {
    const node = document.querySelector<HTMLElement>('#toast')!; node.textContent = text; node.classList.add('visible');
    setTimeout(() => node.classList.remove('visible'), 3200);
  }
  let previous = performance.now(), accumulator = 0;
  function frame(now: number) {
    const dt = Math.min((now - previous) / 1000, 0.05); previous = now;
    if (playing && document.pointerLockElement) {
      const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
      const right = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
      const movement = new THREE.Vector3(right, 0, -forward).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      player.addScaledVector(movement, dt * 6);
      player.x = Math.max(-19, Math.min(19, player.x)); player.z = Math.max(-19, Math.min(23, player.z));
      if (keys.has('Space') && player.y <= 2.3) jumpVelocity = 5;
      jumpVelocity -= 12 * dt; player.y = Math.max(2.3, player.y + jumpVelocity * dt);
    }
    view.camera.position.copy(player); view.camera.rotation.set(pitch, yaw, 0);
    accumulator += dt;
    while (accumulator >= STEP) { sim.step(); accumulator -= STEP; }
    view.render(sim);
    document.querySelector('#score')!.textContent = String(sim.score).padStart(4, '0');
    document.querySelector('#hits')!.textContent = String(sim.score / 100).padStart(2, '0');
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
void boot().catch(error => { app.innerHTML = `<div class="fatal">Unable to start the arena. Enable WebGL2 and reload.<br>${error instanceof Error ? error.message : 'Initialization failed'}</div>`; });
