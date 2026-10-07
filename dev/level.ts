// Development-only battlefield preview: /dev/level.html?map=cinder&cam=x,y,z&look=x,y,z&q=medium&solids=rock,glass&bomb=armed|arming&site=0
// &crate=0 / &siteview=0 point the camera at a crate or a bomb site; &cut=6 clips everything above y=6 (roofs off);
// &fov=50 narrows the lens; &shot=480x270 makes a still for the map picker (see below).
import * as THREE from 'three';
import { loadAssets } from '../src/assets';
import { BombSitesView } from '../src/render/bombsite';
import { LevelView } from '../src/render/level';
import { CratesView } from '../src/render/pickups';
import { THEMES } from '../src/render/materials';
import { QUALITY, Renderer } from '../src/render/renderer';
import { loadMap } from '../shared/maps/index';
import type { BombState } from '../shared/match/state';

const params = new URLSearchParams(location.search);
const info = document.getElementById('info')!;
const assets = await loadAssets(f => { info.textContent = `loading ${(f * 100).toFixed(0)}%`; });
const map = loadMap(params.get('map') ?? 'cinder').def;
const theme = THEMES[map.theme];
const r = new Renderer(document.body, QUALITY[(params.get('q') as 'medium') ?? 'medium']);
r.setTheme(theme, map.sun);
const level = new LevelView(assets, map, theme);
r.scene.add(level.group);
(window as any).__scene = r.scene;
const crates = new CratesView(assets, map.pickups);
const sites = new BombSitesView(map);
r.scene.add(crates.group, sites.group);
const bombParam = params.get('bomb');
const bomb: BombState = { site: bombParam ? Number(params.get('site') ?? 0) : -1, armed: bombParam === 'armed', progress: bombParam === 'arming' ? 0.5 : 0, by: bombParam === 'arming' ? 1 : -1 };
// Overlay collision boxes (by surface, or 'all') to check that visuals match what bullets and bodies hit.
const solids = params.get('solids')?.split(',');
if (solids) for (const s of map.solids) if (solids.includes('all') || solids.includes(s.surface)) {
  r.scene.add(new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(s.minX, s.minY, s.minZ), new THREE.Vector3(s.maxX, s.maxY, s.maxZ)), 0xff00ff));
}
const [cx, cy, cz] = (params.get('cam') ?? '-60,14,40').split(',').map(Number);
const [lx, ly, lz] = (params.get('look') ?? '0,2,0').split(',').map(Number);
r.camera.position.set(cx, cy, cz); r.camera.lookAt(lx, ly, lz);
const focus = params.has('crate') ? map.pickups?.[Number(params.get('crate'))] : params.has('siteview') ? map.points.find(p => p.id === map.sabotage?.sites[Number(params.get('siteview'))]) : undefined;
const near = params.has('crate') ? 0.5 : 1;
if (focus) { r.camera.position.set(focus.x + 2.2 * near, focus.y + 1.8 * near, focus.z + 2.6 * near); r.camera.lookAt(focus.x, focus.y + 0.3, focus.z); }
if (params.get('fov')) { r.camera.fov = Number(params.get('fov')); r.camera.updateProjectionMatrix(); }
if (params.get('cut')) r.renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), Number(params.get('cut')))];
// &shot=480x270: a still for the lobby's map picker (scripts/mapshots.ts). No overlay; once the level
// is dressed and has rendered a while, the frame is cropped to that aspect and scaled down into a 2D
// canvas, `window.__shot`, which the script encodes and saves.
const shot = params.get('shot')?.split('x').map(Number);
if (shot) info.style.display = 'none';
let shotAt = -1;
/** The WebGL frame just rendered, centre-cropped to w:h and halved step by step down to w×h (sharper than one big step). */
function still(src: HTMLCanvasElement, w: number, h: number) {
  let sw = src.width, sh = Math.round(sw * h / w);
  if (sh > src.height) { sh = src.height; sw = Math.round(sh * w / h); }
  let from: CanvasImageSource = src, fx = (src.width - sw) / 2, fy = (src.height - sh) / 2;
  while (sw / 2 >= w * 1.5) {
    const half = document.createElement('canvas');
    half.width = Math.round(sw / 2); half.height = Math.round(sh / 2);
    const c = half.getContext('2d')!;
    c.imageSmoothingQuality = 'high';
    c.drawImage(from, fx, fy, sw, sh, 0, 0, half.width, half.height);
    from = half; fx = 0; fy = 0; sw = half.width; sh = half.height;
  }
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const c = out.getContext('2d')!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(from, fx, fy, sw, sh, 0, 0, w, h);
  return out;
}
let frames = 0, dressed = false; const start = performance.now();
void level.ready.then(() => { dressed = true; });
r.renderer.setAnimationLoop(() => {
  const t = (performance.now() - start) / 1000;
  level.update(t);
  crates.update(t);
  sites.update(t, bomb, true);
  r.render(t);
  // (Read back in the same frame it was drawn: the drawing buffer is not kept.)
  if (shot && dressed && !(window as any).__shot) {
    if (shotAt < 0) shotAt = frames + 45;
    else if (frames >= shotAt) (window as any).__shot = still(r.renderer.domElement, shot[0], shot[1]);
  }
  if (++frames >= 3 && dressed) (window as any).__ready = 1;
  if (frames % 30 === 0) info.textContent = `${(frames / t).toFixed(1)} fps  calls ${r.renderer.info.render.calls} tris ${r.renderer.info.render.triangles}`;
});
