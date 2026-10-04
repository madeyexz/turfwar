// Development-only soldier pose sheet: /dev/soldier.html?cam=x,y,z&look=x,y,z
import * as THREE from 'three';
import { loadAssets } from '../src/assets';
import { THEMES } from '../src/render/materials';
import { QUALITY, Renderer } from '../src/render/renderer';
import { SoldierView, type SoldierPose } from '../src/render/soldier';

const params = new URLSearchParams(location.search);
const info = document.getElementById('info')!;
const assets = await loadAssets(f => { info.textContent = `loading ${(f * 100).toFixed(0)}%`; });
const r = new Renderer(document.body, QUALITY.medium);
r.setTheme(THEMES.desert, { x: -0.55, y: 0.62, z: 0.36 });
r.scene.fog = null;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x9c8a74 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; r.scene.add(ground);
const base: SoldierPose = { x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, crouch: 0, grounded: true, sprint: false, ads: false, slide: false, alive: true, weapon: 'carbine', reloading: 0, firing: false };
const poses: [string, Partial<SoldierPose>, number][] = [
  ['idle', {}, 0], ['aim up', { pitch: 0.6 }, 0], ['jog', { vz: -5 }, 0], ['strafe', { vx: 5 }, 0], ['sprint', { vz: -8.6, sprint: true }, 0],
  ['crouch', { crouch: 1 }, 1], ['pistol', { weapon: 'sidearm' }, 0], ['back', { vz: 4 }, 0], ['dead', { alive: false }, 0],
];
const views = poses.map(([, , team], i) => { const v = new SoldierView(assets, team, i === 6 ? 'assault' : i === 7 ? 'recon' : 'assault'); r.scene.add(v.root, v.gun); return v; });
(window as any).__views = views;
const facing = Number(params.get('yaw') ?? 0.5);
const [cx, cy, cz] = (params.get('cam') ?? '0,1.6,-7.5').split(',').map(Number);
const [lx, ly, lz] = (params.get('look') ?? '0,1,0').split(',').map(Number);
r.camera.position.set(cx, cy, cz); r.camera.lookAt(lx, ly, lz);
const only = params.get('only');
let t = 0, frames = 0;
r.renderer.setAnimationLoop(() => {
  const dt = 1 / 60; t += dt;
  poses.forEach(([name, pose], i) => {
    const visible = !only || only === name;
    views[i].root.visible = visible;
    const x = only ? 0 : (i - (poses.length - 1) / 2) * 1.4;
    if (visible) views[i].update(dt, { ...base, ...pose, x, yaw: Math.PI + facing });
    else views[i].gun.visible = false;
  });
  r.render(t, new THREE.Vector3(), 300);
  if (++frames === 40) (window as any).__ready = 1;
});
info.textContent = poses.map(p => p[0]).join('  ');
