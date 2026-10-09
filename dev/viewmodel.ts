// Development-only first-person weapon preview:
// /dev/viewmodel.html?weapon=m4a1&att=acog,laser&ads=0&sprint=0&reload=0&team=0&slash=0.4&use=1&center&inspect[=first]&closeup&side&night
//   &zoom=1 (sniper second magnification) &scope=pip|overlay &color=red|green|amber|white &style=stock|dot|circle|chevron|cross &detail=high|low
// Keys: 1–8 weapon · O optic · S suppressor · L laser · T torch · N counter · M mag · K pad · A ammo · X clear · F fire · R reload · Space aim · U use · Z zoom level
import * as THREE from 'three';
import { loadAssets } from '../src/assets';
import { LocalPlayer } from '../src/game/player';
import { isMagnified, settings, type OpticDetail, type ReticleColor, type ReticleStyle, type ScopeMode } from '../src/game/settings';
import { THEMES } from '../src/render/materials';
import { fitAttachments } from '../src/render/optics';
import { QUALITY, Renderer } from '../src/render/renderer';
import { ViewModel } from '../src/render/viewmodel';
import { WEAPONS, weaponStats, type WeaponId } from '../shared/weapons';
import { KEYS, describe, gearKey, parseAttachments } from './gear';

const params = new URLSearchParams(location.search);
if (params.get('scope')) settings.scopeMode = params.get('scope') as ScopeMode;
if (params.get('color')) settings.reticleColor = params.get('color') as ReticleColor;
if (params.get('style')) settings.reticleStyle = params.get('style') as ReticleStyle;
if (params.get('detail')) settings.opticDetail = params.get('detail') as OpticDetail;
const info = document.getElementById('info')!;
const assets = await loadAssets(f => { info.textContent = `loading ${(f * 100).toFixed(0)}%`; });
const r = new Renderer(document.body, QUALITY.medium);
r.setTheme(THEMES.desert, { x: -0.55, y: 0.62, z: 0.36 });
// ?night dims the world so the flashlight and laser read.
if (params.has('night')) { r.sun.intensity = 0.05; r.hemi.intensity = 0.06; r.scene.environmentIntensity = 0.05; }
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0xb09878 }));
ground.rotation.x = -Math.PI / 2; r.scene.add(ground);
const wall = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 0.3), new THREE.MeshStandardMaterial({ color: 0x9a8f80 }));
wall.position.set(0, 2, -9); r.scene.add(wall);
// Distant targets: a soldier-sized post with a head at 25 m, 60 m and 120 m (sight pictures and magnification).
for (const [x, z, c] of [[-1.5, -25, 0xb03a2e], [2.5, -60, 0x2e5fb0], [-4, -120, 0x3a8a3a]] as const) {
  const m = new THREE.MeshStandardMaterial({ color: c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.3), m); body.position.set(x, 0.7, z); r.scene.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), m); head.position.set(x, 1.6, z); r.scene.add(head);
}
wall.position.y = 0.5; wall.scale.y = 0.25;
r.camera.position.set(0, 1.62, 0);
let weapon = (params.get('weapon') ?? 'mp5') as WeaponId;
if (!WEAPONS[weapon]) weapon = 'mp5';
let att = parseAttachments(weapon, params.get('att'));
const p = new LocalPlayer();
p.alive = true;
Object.defineProperty(p, 'weapon', { get: () => weaponStats(weapon, att) });
p.ads = Number(params.get('ads') ?? 0);
p.sprinting = params.get('sprint') === '1';
p.using = params.get('use') === '1';
p.zoomLevel = params.get('zoom') === '1' ? 1 : 0;
if (p.sprinting) { p.m.vx = 8; }
const reload = Number(params.get('reload') ?? 0);
if (reload) { p.reloadTotal = 2; p.reloadLeft = 2 * (1 - reload); }
const vm = new ViewModel(assets, Number(params.get('team') ?? 0));
vm.setWeapon(weapon, att, true);
// ?inspect: a close 3/4 product shot of the gun with its attachments (as soldiers show it).
let inspect: THREE.Object3D | undefined;
if (params.has('inspect')) {
  inspect = assets.weapons.get(WEAPONS[weapon].model)!.clone();
  r.scene.add(inspect);
  inspect.position.set(0, 1.5, -1);
  inspect.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inspect);
  // ?inspect=first shows the first-person build (full optic detail); ?closeup frames just the optic.
  const fitted = fitAttachments(assets.weapons, weapon, att, params.get('inspect') === 'first' ? 'first' : 'third').group;
  inspect.add(fitted);
  inspect.updateMatrixWorld(true);
  const optic = fitted.children.find(o => o.name.startsWith('Optic_'));
  if (params.has('closeup') && optic) box.setFromObject(optic);
  const centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
  r.camera.position.copy(centre).add(params.has('side') ? new THREE.Vector3(0, 0, size * 1.05) : new THREE.Vector3(0.1, 0.08, 0.15 + size * 0.95));
  r.camera.lookAt(centre); r.camera.fov = 35; r.camera.updateProjectionMatrix();
}
// ?center marks the screen centre, where the sight line must sit when aiming.
if (params.has('center')) {
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:#0f0;box-shadow:0 0 0 1px #000;z-index:9';
  document.body.appendChild(dot);
}
if (!inspect) r.viewCamera.add(vm.root);
(window as any).__vm = vm;
const show = () => { info.textContent = `${describe(weapon, att)}  overlay ${vm.overlay ?? '-'}  scope ${settings.scopeMode}  zoom ${p.zoomLevel + 1}\n${KEYS} · F fire · R reload · Space aim · U use · Z zoom`; };
show();
let adsTarget = p.ads;
addEventListener('keydown', e => {
  const next = gearKey(e, weapon, att);
  if (next) { weapon = next.weapon; att = next.att; vm.setWeapon(weapon, att); show(); return; }
  if (e.key === 'f') vm.fire();
  if (e.key === 'r') { p.reloadTotal = p.reloadLeft = weapon === 'knife' ? 0 : 2; }
  if (e.key === ' ') adsTarget = adsTarget ? 0 : 1;
  if (e.key === 'u') p.using = !p.using;
  if (e.key === 'z') { p.zoomLevel = p.zoomLevel ? 0 : 1; show(); }
});
const slash = params.get('slash');
let frames = 0;
r.renderer.setAnimationLoop(() => {
  const dt = 1 / 60;
  if (slash !== null) (vm as any).slashT = Number(slash) - dt / 0.32;
  if (!params.has('ads')) p.ads += Math.sign(adsTarget - p.ads) * Math.min(Math.abs(adsTarget - p.ads), dt * 5);
  if (reload) p.reloadLeft = 2 * (1 - reload); else p.reloadLeft = Math.max(0, p.reloadLeft - dt);
  // The view-model camera widens for open sights and narrows for magnified optics, as in the game.
  r.viewCamera.fov = 58 - p.ads * (isMagnified(p.weapon) ? 12 : -4); r.viewCamera.updateProjectionMatrix();
  // The world camera zooms like the game's (settings FOV towards the weapon's aim FOV).
  if (!inspect) { r.camera.fov = settings.fov + (p.aimFov - settings.fov) * p.ads; r.camera.updateProjectionMatrix(); }
  vm.update(dt, p, { x: 0, y: 0 });
  if (!inspect) r.torch.intensity = vm.torch;
  r.render(frames / 60);
  if (++frames === 40) (window as any).__ready = 1;
});
