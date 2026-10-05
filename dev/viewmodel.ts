// Development-only first-person weapon preview: /dev/viewmodel.html?weapon=carbine&ads=0&sprint=0&reload=0
import * as THREE from 'three';
import { loadAssets } from '../src/assets';
import { LocalPlayer } from '../src/game/player';
import { THEMES } from '../src/render/materials';
import { QUALITY, Renderer } from '../src/render/renderer';
import { ViewModel } from '../src/render/viewmodel';
import { WEAPONS, type LoadoutId, type WeaponId } from '../shared/weapons';

const params = new URLSearchParams(location.search);
const info = document.getElementById('info')!;
const assets = await loadAssets(f => { info.textContent = `loading ${(f * 100).toFixed(0)}%`; });
const r = new Renderer(document.body, QUALITY.medium);
r.setTheme(THEMES.desert, { x: -0.55, y: 0.62, z: 0.36 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0xb09878 }));
ground.rotation.x = -Math.PI / 2; r.scene.add(ground);
r.camera.position.set(0, 1.62, 0);
const p = new LocalPlayer();
p.alive = true;
p.loadout = (params.get('loadout') ?? 'assault') as LoadoutId;
p.slot = Number(params.get('slot') ?? 0) as 0 | 1;
// ?weapon=<id> previews any gun, not only the kits' guns.
const only = params.get('weapon') as WeaponId | null;
if (only && WEAPONS[only]) Object.defineProperty(p, 'weapon', { get: () => WEAPONS[only] });
p.ads = Number(params.get('ads') ?? 0);
p.sprinting = params.get('sprint') === '1';
if (p.sprinting) { p.m.vx = 8; }
const reload = Number(params.get('reload') ?? 0);
if (reload) { p.reloadTotal = 2; p.reloadLeft = 2 * (1 - reload); }
const vm = new ViewModel(assets, Number(params.get('team') ?? 0));
// Sight line through the mounted optic (model space), for checking ADS alignment.
if (only) info.textContent = `sight line ${assets.weapons.get(WEAPONS[only].model)!.userData.sightLine?.toFixed(3) ?? 'rig'}`;
// ?center marks the screen centre, where the optic window must sit when aiming.
if (params.has('center')) {
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:#0f0;box-shadow:0 0 0 1px #000;z-index:9';
  document.body.appendChild(dot);
}
r.viewCamera.add(vm.root);
(window as any).__vm = vm;
r.viewCamera.fov = 58 - p.ads * 10; r.viewCamera.updateProjectionMatrix();
let frames = 0;
r.renderer.setAnimationLoop(() => {
  vm.update(1 / 60, p, { x: 0, y: 0 });
  if (p.reloadLeft > 0) p.reloadLeft = 2 * (1 - reload);
  r.render(frames / 60);
  if (++frames === 40) (window as any).__ready = 1;
});
