// Development-only soldier pose sheet: /dev/soldier.html?weapon=m4a1&att=holo,flashlight&only=idle&cam=x,y,z&look=x,y,z&marks
// Two rows (SWAT front, Militia behind). Keys: 1–8 weapon · O optic · T tactical · M mod · A ammo · X clear · F fire/stab
import * as THREE from 'three';
import { loadAssets } from '../src/assets';
import { THEMES } from '../src/render/materials';
import { QUALITY, Renderer } from '../src/render/renderer';
import { SoldierView, type SoldierPose } from '../src/render/soldier';
import { WEAPONS, type WeaponId } from '../shared/weapons';
import { KEYS, describe, gearKey, parseAttachments } from './gear';

const params = new URLSearchParams(location.search);
const info = document.getElementById('info')!;
const assets = await loadAssets(f => { info.textContent = `loading ${(f * 100).toFixed(0)}%`; });
const r = new Renderer(document.body, QUALITY.medium);
r.setTheme(THEMES.desert, { x: -0.55, y: 0.62, z: 0.36 });
r.scene.fog = null;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x9c8a74 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; r.scene.add(ground);
let weapon = (params.get('weapon') ?? 'm4a1') as WeaponId;
if (!WEAPONS[weapon]) weapon = 'm4a1';
let att = parseAttachments(weapon, params.get('att'));
const base: SoldierPose = { x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, crouch: 0, grounded: true, sprint: false, ads: false, slide: false, alive: true, weapon, reloading: 0, firing: false };
const poses: [string, Partial<SoldierPose>][] = [
  ['idle', {}], ['aim up', { pitch: 0.6 }], ['jog', { vz: -5 }], ['sprint', { vz: -8.6, sprint: true }],
  ['crouch', { crouch: 1 }], ['pistol', { weapon: 'm9a1' }], ['knife', { weapon: 'knife' }], ['using', { using: true }], ['dead', { alive: false }],
];
const rows = [0, 1].map(team => poses.map(() => { const v = new SoldierView(assets, team); r.scene.add(v.root, v.gun); return v; }));
(window as any).__views = rows;
const facing = Number(params.get('yaw') ?? 0.5);
const [cx, cy, cz] = (params.get('cam') ?? '0,2.2,-9.5').split(',').map(Number);
const [lx, ly, lz] = (params.get('look') ?? '0,0.9,1').split(',').map(Number);
r.camera.position.set(cx, cy, cz); r.camera.lookAt(lx, ly, lz);
const only = params.get('only');
const marks = ['#ff0', '#f0f', '#0ff', '#f00', '#0f0'].map(c => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.025), new THREE.MeshBasicMaterial({ color: c, depthTest: false })); m.renderOrder = 99; r.scene.add(m); return m; });
const show = () => { info.textContent = `${describe(weapon, att)}\n${poses.map(p => p[0]).join('  ')}\n${KEYS} · F fire/stab`; };
show();
addEventListener('keydown', e => {
  const next = gearKey(e, weapon, att);
  if (next) { weapon = next.weapon; att = next.att; base.weapon = weapon; show(); }
  if (e.key === 'f') for (const row of rows) for (const v of row) v.shoot();
});
// ?stab=<seconds>: stab every n seconds, so screenshots catch the knife mid-thrust.
const stabEvery = Number(params.get('stab') ?? 0);
let t = 0, frames = 0;
r.renderer.setAnimationLoop(() => {
  const dt = 1 / 60; t += dt;
  if (stabEvery && frames % Math.round(stabEvery * 60) === 0) for (const row of rows) row[6].shoot();
  rows.forEach((row, team) => poses.forEach(([name, pose], i) => {
    const visible = !only || only === name;
    row[i].root.visible = visible;
    const x = only ? (team - 0.5) * 1.6 : (i - (poses.length - 1) / 2) * 1.3;
    const z = only ? 0 : team * 2.2;
    const p = { ...base, ...pose, x, z, yaw: facing };
    if (visible) row[i].update(dt, { ...p, attachments: p.weapon === weapon ? att : {} });
    else row[i].gun.visible = false;
  }));
  const dv = rows[0].find(v => v.root.visible && v.debug);
  if (dv?.debug && params.has('marks')) {
    marks[0].position.copy(dv.debug.chest); marks[1].position.copy(dv.debug.grip); marks[2].position.copy(dv.debug.fore);
    dv.root.traverse(o => { if (o.name === 'hand_r') o.getWorldPosition(marks[3].position); if (o.name === 'hand_l') o.getWorldPosition(marks[4].position); });
  } else marks.forEach(m => m.visible = false);
  r.render(t);
  if (++frames === 40) (window as any).__ready = 1;
});
