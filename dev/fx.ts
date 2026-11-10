// Development-only preview of blasts and the bomb's collapse: /dev/fx.html?map=taipei&cam=x,y,z&look=x,y,z&q=high
// &bake=0 shows the level without its baked light. From the console (or a capture script):
//   __fx.cam(x, y, z, lx, ly, lz)   move the camera
//   __fx.explode(x, y, z, scale)    a blast over the ground below that point (scale 1 grenade, 1.8 car, 2.5 bomb)
//   __fx.bomb(site)                 the bomb's blast and the collapse at a Sabotage site
//   __fx.restore()                  a new round: the buildings stand again, the marks are gone
// &manual=1 stops the clock for frame-by-frame captures: __fx.advance(seconds) moves it on.
import * as THREE from 'three';
import { loadAssets } from '../src/assets';
import { bakeMix } from '../src/render/baked';
import { Effects } from '../src/render/effects';
import { LevelView } from '../src/render/level';
import { THEMES } from '../src/render/materials';
import { QUALITY, Renderer } from '../src/render/renderer';
import { loadMap } from '../shared/maps/index';

const params = new URLSearchParams(location.search);
const info = document.getElementById('info')!;
const quality = (params.get('q') as 'medium') ?? 'high';
const r = new Renderer(document.body, QUALITY[quality]);
const assets = await loadAssets(f => { info.textContent = `loading ${(f * 100).toFixed(0)}%`; }, { renderer: r.renderer, quality });
const loaded = loadMap(params.get('map') ?? 'taipei'), map = loaded.def;
const theme = THEMES[map.theme];
r.setTheme(theme, map.sun);
const level = new LevelView(assets, map, theme);
const effects = new Effects();
effects.detail = quality === 'low' ? 0.5 : 1;
effects.haze.copy(theme.fog);
r.scene.add(level.group, effects.group);
const [cx, cy, cz] = (params.get('cam') ?? '-4,2.2,-24').split(',').map(Number);
const [lx, ly, lz] = (params.get('look') ?? '-17,3,-36').split(',').map(Number);
r.camera.position.set(cx, cy, cz); r.camera.lookAt(lx, ly, lz);

const groundBelow = (x: number, y: number, z: number) => loaded.world.raycast({ x, y: y + 0.3, z }, { x: 0, y: -1, z: 0 }, 8)?.point.y ?? y;
const fx = {
  cam(x: number, y: number, z: number, tx: number, ty: number, tz: number) { r.camera.position.set(x, y, z); r.camera.lookAt(tx, ty, tz); },
  explode(x: number, y: number, z: number, scale = 1) { effects.explosion(new THREE.Vector3(x, y, z), scale, groundBelow(x, y, z)); },
  bomb(site: number) {
    const p = map.points.find(q => q.id === map.sabotage?.sites[site]);
    if (!p) return;
    const box = level.collapse(site, p);
    if (box) effects.dust(box);
    fx.explode(p.x, p.y + 0.5, p.z, 2.5);
  },
  restore() { level.restore(); effects.clearDecals(); },
  /** Manual clock: run the effects on by `seconds` in 60 Hz steps and draw one frame. */
  advance(seconds: number) {
    for (let left = seconds; left > 1e-6; left -= 1 / 60) { const dt = Math.min(1 / 60, left); clock += dt; level.update(clock); effects.update(dt); }
    r.render(clock);
  },
};
const manual = params.has('manual');
let clock = 0;
(window as any).__fx = fx;
(window as any).__scene = r.scene;

let frames = 0, last = performance.now(); const start = last;
let dressed = false;
if (quality === 'low' || params.get('bake') === '0') void level.ready.then(() => { dressed = true; });
else void level.bake().then(() => { bakeMix.value = 1; dressed = true; info.title = `bake ${level.buildStats.bakeMs} ms`; (window as any).__bake = level.buildStats.bakeMs; });
r.renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000), t = (now - start) / 1000;
  last = now;
  // (The manual clock draws only when asked, once the level stands: a software renderer needs seconds for a frame.)
  if (manual && dressed && frames > 6) { (window as any).__ready = 1; return; }
  if (!manual) { clock += dt; level.update(clock); effects.update(dt); }
  r.render(clock);
  if (++frames >= 3 && dressed) (window as any).__ready = 1;
  if (frames % 30 === 0) info.textContent = `${(frames / t).toFixed(1)} fps  calls ${r.renderer.info.render.calls} tris ${r.renderer.info.render.triangles}`;
});
