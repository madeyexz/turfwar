// Development-only soldier parade: /dev/roster.html (add ?soldiers=classic for the old soldier, ?capture to hold the clock).
// Every model runs a circle on open ground through each locomotion state while the camera orbits; the caption
// names the state. `window.__frame(n)` steps n frames of 1/24 s and returns a JPEG data URL under `?capture`.
import * as THREE from 'three';
import { loadAssets } from '../src/assets';
import { THEMES } from '../src/render/materials';
import { QUALITY, Renderer } from '../src/render/renderer';
import { SoldierView, type SoldierPose } from '../src/render/soldier';
import type { WeaponId } from '../shared/weapons';

const FPS = 24;
const params = new URLSearchParams(location.search);
const info = document.getElementById('info')!;
const assets = await loadAssets(f => { info.textContent = `loading ${(f * 100).toFixed(0)}%`; });
const r = new Renderer(document.body, QUALITY.medium);
r.setTheme(THEMES.desert, { x: -0.55, y: 0.62, z: 0.36 });
r.scene.fog = null;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x9c8a74 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; r.scene.add(ground);

const WEAPONS_BY_SLOT: WeaponId[] = ['m4a1', 'mp5', 'm1014', 'm110', 'm9a1', 'mp7', 'm249', 'm4a1', 'mp5'];
// Teams alternate so the SWAT operators sit between the six Militia irregulars.
const TEAMS = [0, 1, 1, 0, 1, 1, 0, 1, 1];
const views = TEAMS.map((team, i) => {
  const view = new SoldierView(assets, team);
  r.scene.add(view.root, view.gun);
  return { view, weapon: WEAPONS_BY_SLOT[i], pose: { x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, crouch: 0, grounded: true, sprint: false, ads: false, slide: false, alive: true, weapon: WEAPONS_BY_SLOT[i], reloading: 0, firing: false } as SoldierPose, shot: 0 };
});

/** Each phase: seconds, name, speed around the circle (m/s), facing ('go' = along the path, 'in' = toward the centre), crouch, sprint, firing, dies. */
const phases = [
  { len: 3, name: 'walk', speed: 1.6, face: 'go', crouch: 0, sprint: false },
  { len: 4, name: 'jog', speed: 4.4, face: 'go', crouch: 0, sprint: false },
  { len: 3.5, name: 'sprint', speed: 7.4, face: 'go', crouch: 0, sprint: true },
  { len: 4, name: 'strafe (aiming at the centre)', speed: 3.4, face: 'in', crouch: 0, sprint: false },
  { len: 3.5, name: 'crouch walk', speed: 1.7, face: 'go', crouch: 1, sprint: false },
  { len: 3.5, name: 'firing', speed: 0, face: 'in', crouch: 0, sprint: false, fire: true },
  { len: 3.5, name: 'down', speed: 0, face: 'in', crouch: 0, sprint: false, dead: true },
];
const total = phases.reduce((n, p) => n + p.len, 0);
const R = 5.2;
let t = 0, angle = 0;
const label = document.createElement('div');
label.style.cssText = 'position:fixed;left:24px;bottom:22px;color:#fff;font:600 26px Rajdhani,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;text-shadow:0 2px 6px #000';
document.body.append(label);

function phaseAt(time: number) {
  let s = 0;
  for (const p of phases) { if (time < s + p.len) return p; s += p.len; }
  return phases[phases.length - 1];
}

function advance() {
  const dt = 1 / FPS;
  const ph = phaseAt(t);
  const omega = ph.speed / R;
  angle += omega * dt;
  views.forEach((v, i) => {
    const a = angle + (i / views.length) * Math.PI * 2;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    const dx = -Math.sin(a), dz = Math.cos(a);
    const p = v.pose;
    p.x = x; p.z = z; p.vx = dx * ph.speed; p.vz = dz * ph.speed;
    const toCentre = Math.atan2(x, z), along = Math.atan2(-dx, -dz);
    p.yaw = ph.face === 'in' ? toCentre : along;
    p.sprint = ph.sprint; p.crouch += (ph.crouch - p.crouch) * Math.min(1, dt * 8);
    p.alive = !ph.dead; p.firing = !!ph.fire;
    if (ph.fire && t - v.shot > 0.16 + (i % 3) * 0.03) { v.shot = t; v.view.shoot(); }
    v.view.update(dt, p);
  });
  label.textContent = ph.name;
  t += dt;
}
function draw() {
  const a = 0.5 + t * 0.14;
  const radius = Number(params.get('r') ?? 13.5), height = Number(params.get('h') ?? 3.4);
  r.camera.position.set(Math.sin(a) * radius, height, Math.cos(a) * radius);
  r.camera.lookAt(0, Number(params.get('ly') ?? 1.0), 0);
  r.camera.fov = 44; r.camera.updateProjectionMatrix();
  r.render(t);
}
info.textContent = '';
(window as any).__views = views;
if (params.has('capture')) {
  const w = window as unknown as { __frame: (n?: number) => string; __t: () => number };
  const out = document.createElement('canvas');
  w.__frame = (n = 1) => {
    for (let i = 0; i < n; i++) advance();
    draw();
    // The caption is drawn into the capture (the DOM label is not part of the WebGL canvas).
    const src = r.renderer.domElement;
    out.width = src.width; out.height = src.height;
    const c = out.getContext('2d')!;
    c.drawImage(src, 0, 0);
    c.font = `600 ${Math.round(src.height * 0.055)}px Rajdhani, system-ui, sans-serif`;
    c.fillStyle = '#fff'; c.shadowColor = '#000'; c.shadowBlur = 8; c.shadowOffsetY = 2;
    c.fillText(label.textContent!.toUpperCase(), src.width * 0.025, src.height * 0.94);
    return out.toDataURL('image/jpeg', 0.92);
  };
  w.__t = () => t;
  (window as any).__ready = 1;
} else {
  const clock = new THREE.Clock();
  let owed = 0;
  r.renderer.setAnimationLoop(() => {
    owed += Math.min(clock.getDelta(), 0.25);
    while (owed >= 1 / FPS && t < total) { owed -= 1 / FPS; advance(); }
    draw();
  });
}
