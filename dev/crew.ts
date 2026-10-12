// Development-only scripted skirmish for the soldier models: /dev/crew.html?map=taipei&classic (the old soldier: ?soldiers=classic)
// Two squads run, strafe, crouch, trade fire and fall in an alley while the camera cuts between shots. It plays in real time;
// `?capture` holds the clock instead and exposes `window.__frame(n)`, which steps n frames of 1/30 s and returns a JPEG
// data URL, so a recording is frame-perfect even on a software renderer.
import * as THREE from 'three';
import { loadAssets } from '../src/assets';
import { LevelView } from '../src/render/level';
import { THEMES } from '../src/render/materials';
import { QUALITY, Renderer } from '../src/render/renderer';
import { SoldierView, type SoldierPose } from '../src/render/soldier';
import { loadMap } from '../shared/maps/index';
import type { WeaponId } from '../shared/weapons';

const FPS = 24;
const params = new URLSearchParams(location.search);
const info = document.getElementById('info')!;
const r = new Renderer(document.body, QUALITY.medium);
const assets = await loadAssets(f => { info.textContent = `loading ${(f * 100).toFixed(0)}%`; }, { renderer: r.renderer, quality: 'medium' });
const map = loadMap(params.get('map') ?? 'taipei').def;
const theme = THEMES[map.theme];
r.setTheme(theme, map.sun);
const level = new LevelView(assets, map, theme);
r.scene.add(level.group);
await level.ready;
info.textContent = '';

/** One scripted soldier: waypoints (x, z, speed in m/s, stance) walked in order, aiming at `aim`. */
interface Leg { x: number; z: number; speed?: number; stance?: 'crouch' | 'sprint' | 'stand'; wait?: number }
interface Actor { team: number; weapon: WeaponId; start: [number, number]; aim: (t: number) => [number, number]; legs: Leg[]; shoots?: [number, number][]; dies?: number; delay?: number }
const S = 4.4;
const actors: Actor[] = [
  // SWAT file jogs north up the alley (+z), then spreads and takes cover while Militia come south.
  { team: 0, weapon: 'm4a1', start: [-1.0, -14], delay: 0, aim: () => [0, 20], legs: [{ x: -1.0, z: -3, speed: S }, { x: -1.6, z: 1, speed: 3, stance: 'crouch' }], shoots: [[9, 12], [13, 16]] },
  { team: 0, weapon: 'mp5', start: [1.0, -15.5], delay: 0.3, aim: () => [0, 20], legs: [{ x: 1.0, z: -4, speed: S }, { x: 1.7, z: -0.5, speed: 5.5, stance: 'sprint' }, { x: 1.4, z: 0.5, speed: 2 }], shoots: [[9, 13], [15, 17]], dies: 18.5 },
  { team: 0, weapon: 'm1014', start: [-1.0, -17], delay: 0.6, aim: () => [0, 20], legs: [{ x: -0.2, z: -6, speed: S }, { x: -0.4, z: -3, speed: 3.5 }], shoots: [[10, 11.5], [14, 15]] },
  { team: 0, weapon: 'm9a1', start: [1.0, -18.5], delay: 0.9, aim: () => [0, 20], legs: [{ x: 1.0, z: -8, speed: S }, { x: 1.3, z: -4, speed: 6, stance: 'sprint' }], shoots: [[11, 12.5]] },
  { team: 1, weapon: 'm4a1', start: [-1.2, 17], delay: 3, aim: () => [0, -20], legs: [{ x: -1.2, z: 9, speed: 3.2 }, { x: -1.9, z: 5, speed: 4.4 }, { x: -1.0, z: 3.5, speed: 2, stance: 'crouch' }], shoots: [[8, 11], [12.5, 15]], dies: 20 },
  { team: 1, weapon: 'mp5', start: [1.2, 18.5], delay: 3.4, aim: () => [0, -20], legs: [{ x: 1.2, z: 10, speed: 3.2 }, { x: 0.6, z: 6, speed: 7, stance: 'sprint' }, { x: 1.8, z: 3, speed: 3 }], shoots: [[8.5, 11], [13, 16]], dies: 19 },
  { team: 1, weapon: 'm1014', start: [0, 20], delay: 3.8, aim: () => [0, -20], legs: [{ x: 0, z: 11, speed: 3.2 }, { x: -0.5, z: 8, speed: 2.4, stance: 'crouch' }], shoots: [[9, 11], [13, 14.5], [16, 17.5]], dies: 21.5 },
  { team: 1, weapon: 'm9a1', start: [1.0, 21.5], delay: 4.2, aim: () => [0, -20], legs: [{ x: 1.0, z: 12, speed: 3.2 }, { x: 1.4, z: 9, speed: 5 }], shoots: [[9.5, 11.5]], dies: 17 },
];

interface Live { a: Actor; view: SoldierView; x: number; z: number; leg: number; wait: number; pose: SoldierPose; shot: number }
const live: Live[] = actors.map(a => {
  const view = new SoldierView(assets, a.team);
  r.scene.add(view.root, view.gun);
  const pose: SoldierPose = { x: a.start[0], y: 0, z: a.start[1], vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, crouch: 0, grounded: true, sprint: false, ads: false, slide: false, alive: true, weapon: a.weapon, reloading: 0, firing: false };
  return { a, view, x: a.start[0], z: a.start[1], leg: 0, wait: 0, pose, shot: 0 };
});

function step(l: Live, t: number, dt: number) {
  const { a, pose } = l;
  const alive = !(a.dies && t >= a.dies);
  let vx = 0, vz = 0, stance: Leg['stance'] = 'stand';
  if (alive && t >= (a.delay ?? 0) && l.leg < a.legs.length) {
    const g = a.legs[l.leg], dx = g.x - l.x, dz = g.z - l.z, d = Math.hypot(dx, dz), sp = g.speed ?? 3;
    stance = g.stance;
    if (d < sp * dt) { l.x = g.x; l.z = g.z; l.leg++; } else { vx = dx / d * sp; vz = dz / d * sp; l.x += vx * dt; l.z += vz * dt; }
  } else if (alive && l.leg > 0) stance = a.legs[l.leg - 1].stance === 'crouch' ? 'crouch' : 'stand';
  const [ax, az] = a.aim(t);
  const yaw = Math.atan2(-(ax - l.x), -(az - l.z));
  const firing = alive && !!a.shoots?.some(([s, e]) => t >= s && t < e);
  pose.x = l.x; pose.z = l.z; pose.vx = vx; pose.vz = vz; pose.yaw = yaw; pose.pitch = 0;
  pose.alive = alive; pose.sprint = stance === 'sprint'; pose.firing = firing;
  const crouchTarget = stance === 'crouch' ? 1 : 0;
  pose.crouch += (crouchTarget - pose.crouch) * Math.min(1, dt * 8);
  if (firing && t - l.shot > 0.14) { l.shot = t; l.view.shoot(); }
  l.view.update(dt, pose);
}

// Camera shots: [from, to, position(t), look(t)] in seconds, positions in the alley (x within about ±2.2).
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const at = (i: number) => live[i].pose;
const eye = new THREE.Vector3(), look = new THREE.Vector3();
type Shot = [number, number, (k: number, t: number) => [number[], number[]]];
const shots: Shot[] = [
  // 1 Trailing the SWAT file: behind and beside the point man.
  [0, 5, () => [[at(0).x + 2.4, 1.9, at(0).z - 5.5], [at(0).x - 0.3, 1.2, at(0).z + 2]]],
  // 2 Front three-quarter as the stack runs toward us.
  [5, 9, (k) => [[at(1).x - 1.6, 1.5, at(1).z + 5.5], [at(1).x, 1.15, at(1).z]]],
  // 3 High and wide: both squads in the alley.
  [9, 13, (k) => [[lerp(-2.5, 2.5, k), 4.6, -13], [0, 1, 4]]],
  // 4 Over the crouched SWAT point man's shoulder at the Militia.
  [13, 17, () => [[at(0).x + 1.3, 1.7, at(0).z - 3.4], [at(4).x, 1.1, at(4).z]]],
  // 5 Orbit the Militia shotgun and the fall of the others.
  [17, 22.5, (k) => { const c = at(6); const ang = 2.3 + k * 1.5; return [[c.x + Math.sin(ang) * 3.6, 1.7, c.z + Math.cos(ang) * 3.6], [c.x, 0.95, c.z]]; }],
];
const total = 22.5;

let t = 0;
function render() {
  for (const l of live) step(l, t, 1 / FPS);
  draw();
  t += 1 / FPS;
}
function draw() {
  const shot = shots.find(s => t >= s[0] && t < s[1]) ?? shots[shots.length - 1];
  const [p, q] = shot[2]((t - shot[0]) / (shot[1] - shot[0]), t);
  r.camera.position.set(p[0], p[1], p[2]); r.camera.lookAt(q[0], q[1], q[2]);
  r.camera.fov = 50; r.camera.updateProjectionMatrix();
  r.render(t);
}
if (params.has('capture')) {
  const w = window as unknown as { __frame: (n?: number) => string; __t: () => number };
  w.__frame = (n = 1) => { for (let i = 0; i < n - 1; i++) { for (const l of live) step(l, t, 1 / FPS); t += 1 / FPS; } render(); return r.renderer.domElement.toDataURL('image/jpeg', 0.92); };
  w.__t = () => t;
  (window as any).__ready = 1;
} else {
  const clock = new THREE.Clock();
  let owed = 0;
  r.renderer.setAnimationLoop(() => {
    owed += Math.min(clock.getDelta(), 0.25);
    if (owed >= 1 / FPS && t < total) { while (owed >= 1 / FPS && t < total) { owed -= 1 / FPS; for (const l of live) step(l, t, 1 / FPS); t += 1 / FPS; } }
    draw();
  });
}
