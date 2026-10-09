// Development-only vehicle preview (the drivable cars, taxis, scooters and helicopter, src/render/vehicles.ts).
// Studio: /dev/vehicles.html?show=car:0,car:1,scooter:2,heli:3&spacing=6&focus=0&angle=front|rear|side|top&dist=6
//   &wrecked=1 (charred hulks) &rotor=1 (rotor spinning) &seats=1 (seat feet markers) &boxes=1 (solid blocks)
// In the street: /dev/vehicles.html?map=taipei&focus=3&angle=front&dist=7 (every vehicle at its map spot;
//   focus is the spot index). &cam=x,y,z&look=x,y,z place the camera by hand.
// window.__stats lists each shown vehicle's meshes (draw calls), shadow casters and triangles.
import * as THREE from 'three';
import { loadAssets } from '../src/assets';
import { LevelView } from '../src/render/level';
import { THEMES } from '../src/render/materials';
import { QUALITY, Renderer } from '../src/render/renderer';
import { VehiclesView } from '../src/render/vehicles';
import { loadMap } from '../shared/maps/index';
import { VEHICLES, createVehicle, forwardOf, localToWorld, type Vehicle, type VehicleKind, type VehicleSpot } from '../shared/vehicles';

const params = new URLSearchParams(location.search);
const info = document.getElementById('info')!;
const mapId = params.get('map');
const map = loadMap(mapId ?? 'taipei').def;
const theme = THEMES[map.theme];
const r = new Renderer(document.body, QUALITY[(params.get('q') as 'medium') ?? 'high']);
r.setTheme(theme, map.sun);
r.camera.fov = Number(params.get('fov') ?? 40); r.camera.updateProjectionMatrix();
let ready: Promise<unknown> = Promise.resolve();

let spots: VehicleSpot[];
if (mapId) {
  const assets = await loadAssets(f => { info.textContent = `loading ${(f * 100).toFixed(0)}%`; });
  const level = new LevelView(assets, map, theme);
  r.scene.add(level.group);
  ready = level.ready;
  spots = map.vehicles ?? [];
} else {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x8a8c8e, roughness: 0.92 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; r.scene.add(ground);
  const spacing = Number(params.get('spacing') ?? 8);
  const shown = (params.get('show') ?? 'car:0,car:1,scooter:2,heli:3').split(',');
  spots = shown.map((s, i) => ({ kind: s.split(':')[0] as VehicleKind, x: (i - (shown.length - 1) / 2) * spacing, y: 0, z: 0, yaw: Number(params.get('yaw') ?? 0) }));
}
// Vehicle ids pick the look (taxi or sedan colour, scooter colour): in the studio `car:3` is id 3 (ids must differ).
const ids = mapId ? spots.map((_, i) => i) : (params.get('show') ?? 'car:0,car:1,scooter:2,heli:3').split(',').map(s => Number(s.split(':')[1] ?? 0));
const vehicles: Vehicle[] = spots.map((spot, i) => ({ ...createVehicle(ids[i], spot), wrecked: params.get('wrecked') === '1', rotor: Number(params.get('rotor') ?? 0) }));
const view = new VehiclesView();
r.scene.add(view.group);
view.sync(vehicles, 0);
view.update(0, 0);

if (params.get('seats') || params.get('boxes')) for (const v of vehicles) {
  const spec = VEHICLES[v.kind];
  if (params.get('seats')) for (const s of spec.seats) {
    const p = localToWorld(v, s), dot = new THREE.Mesh(new THREE.SphereGeometry(0.06), new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false }));
    dot.position.set(p.x, p.y, p.z); r.scene.add(dot);
  }
  if (params.get('boxes')) for (const b of spec.blocks) {
    const helper = new THREE.Mesh(new THREE.BoxGeometry(b.w * 2, b.h, b.l * 2), new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true }));
    const f = forwardOf(v.yaw);
    helper.position.set(v.x + f.x * b.c, v.y + b.y0 + b.h / 2, v.z + f.z * b.c); helper.rotation.y = v.yaw; r.scene.add(helper);
  }
}

// Camera: by hand, or around the focused vehicle from an angle (front = 3/4 front-left, rear = 3/4 rear-right).
const focus = params.has('focus') ? vehicles[Number(params.get('focus'))] : undefined;
if (focus) {
  const size = { car: 6.5, scooter: 3.2, heli: 10.5 }[focus.kind] * Number(params.get('dist') ?? 1);
  const height = { car: 1.0, scooter: 0.6, heli: 2.0 }[focus.kind];
  const angle = params.get('angle') ?? 'front';
  const [fwd, side, up] = ({ front: [0.75, -0.62, 0.38], rear: [-0.72, 0.65, 0.4], side: [0, -1, 0.2], top: [0.4, -0.4, 1.2], low: [0.8, -0.5, 0.08] } as Record<string, number[]>)[angle];
  const at = localToWorld(focus, { x: side * size, y: height + up * size, z: fwd * size });
  r.camera.position.set(at.x, at.y, at.z);
  r.camera.lookAt(focus.x, focus.y + height * 0.8, focus.z);
} else {
  const [cx, cy, cz] = (params.get('cam') ?? '10,7,16').split(',').map(Number);
  const [lx, ly, lz] = (params.get('look') ?? '0,1,0').split(',').map(Number);
  r.camera.position.set(cx, cy, cz); r.camera.lookAt(lx, ly, lz);
}
if (params.get('cam') && focus) { const [cx, cy, cz] = params.get('cam')!.split(',').map(Number); r.camera.position.set(focus.x + cx, focus.y + cy, focus.z + cz); }

// What each vehicle costs: its meshes are its draw calls (plus one each in the shadow pass for casters).
const stats = view.group.children.map((root, i) => {
  let meshes = 0, casters = 0, tris = 0;
  root.traverseVisible(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++; if (m.castShadow) casters++;
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  const { x, y, z } = vehicles[i];
  return { kind: vehicles[i].kind, id: vehicles[i].id, meshes, casters, tris: Math.round(tris), at: [x, y, z].map(n => Math.round(n * 10) / 10) };
});
(window as unknown as { __stats: unknown }).__stats = stats;
const statText = stats.filter((s, i) => !mapId || i === Number(params.get('focus') ?? -1)).map(s => `${s.kind}:${s.id} meshes ${s.meshes} casters ${s.casters} tris ${s.tris}`).join('\n');

if (params.get('clean')) info.style.display = 'none';
let frames = 0, dressed = false; const start = performance.now();
void ready.then(() => { dressed = true; });
r.renderer.setAnimationLoop(() => {
  const t = (performance.now() - start) / 1000;
  view.update(1 / 60, t);
  r.render(t);
  if (++frames >= 20 && dressed) (window as unknown as { __ready: number }).__ready = 1;
  if (frames % 30 === 0 && !params.get('clean')) info.textContent = `calls ${r.renderer.info.render.calls} tris ${r.renderer.info.render.triangles}\n${statText}`;
});
