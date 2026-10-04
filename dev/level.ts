// Development-only battlefield preview: /dev/level.html?map=cinder&cam=x,y,z&look=x,y,z&q=medium&solids=rock,glass
import * as THREE from 'three';
import { loadAssets } from '../src/assets';
import { LevelView } from '../src/render/level';
import { THEMES } from '../src/render/materials';
import { QUALITY, Renderer } from '../src/render/renderer';
import { loadMap } from '../shared/maps/index';

const params = new URLSearchParams(location.search);
const info = document.getElementById('info')!;
const assets = await loadAssets(f => { info.textContent = `loading ${(f * 100).toFixed(0)}%`; });
const map = loadMap(params.get('map') ?? 'cinder').def;
const theme = THEMES[map.theme];
const r = new Renderer(document.body, QUALITY[(params.get('q') as 'medium') ?? 'medium']);
r.setTheme(theme, map.sun);
const level = new LevelView(assets, map, theme);
r.scene.add(level.group);
// Overlay collision boxes (by surface, or 'all') to check that visuals match what bullets and bodies hit.
const solids = params.get('solids')?.split(',');
if (solids) for (const s of map.solids) if (solids.includes('all') || solids.includes(s.surface)) {
  r.scene.add(new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(s.minX, s.minY, s.minZ), new THREE.Vector3(s.maxX, s.maxY, s.maxZ)), 0xff00ff));
}
const [cx, cy, cz] = (params.get('cam') ?? '-60,14,40').split(',').map(Number);
const [lx, ly, lz] = (params.get('look') ?? '0,2,0').split(',').map(Number);
r.camera.position.set(cx, cy, cz); r.camera.lookAt(lx, ly, lz);
if (params.get('fov')) { r.camera.fov = Number(params.get('fov')); r.camera.updateProjectionMatrix(); }
let frames = 0; const start = performance.now();
r.renderer.setAnimationLoop(() => {
  const t = (performance.now() - start) / 1000;
  level.update(t); level.reactor?.update(t);
  r.render(t, new THREE.Vector3(), 300);
  if (++frames === 3) (window as any).__ready = 1;
  if (frames % 30 === 0) info.textContent = `${(frames / t).toFixed(1)} fps  calls ${r.renderer.info.render.calls} tris ${r.renderer.info.render.triangles}`;
});
