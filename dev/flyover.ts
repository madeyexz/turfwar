// Development-only: the National Day flyover (src/render/flyover.ts) over Liberty Square on the memorial
// map, as seen from the plaza facing the gate, with a crowd, the flagpole and the lawn's flags.
// /dev/flyover.html?live=1 plays it; without `live` nothing moves until window.__fly.frame(t) draws the
// frame at pass time t (the trailer renders it frame by frame). &sky=overcast greys the sky over;
// &crowd=0 empties the plaza; &alt=250 sets the jets' height; &cam=x,y,z &yaw=deg &pitch=deg &fov=44.3;
// &hills=1 keeps the map's generic mountain ring (Liberty Square has trees and the city behind the gate).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadAssets } from '../src/assets';
import { Flyover, type FlyoverPath } from '../src/render/flyover';
import { LevelView } from '../src/render/level';
import { THEMES, type Theme } from '../src/render/materials';
import { QUALITY, Renderer } from '../src/render/renderer';
import { loadMap } from '../shared/maps/index';
import { rng } from '../shared/math';

const params = new URLSearchParams(location.search);
const info = document.getElementById('info')!;
const num = (k: string, d: number) => Number(params.get(k) ?? d);
// No bloom: it is daytime, and the plaza's lamp standards would glare.
const r = new Renderer(document.body, { ...QUALITY.high, pixelRatio: 1, adaptive: false, bloom: false });
const assets = await loadAssets(f => { info.textContent = `loading ${(f * 100).toFixed(0)}%`; }, { renderer: r.renderer, quality: 'high' });
const map = loadMap('memorial').def;
const overcast = params.get('sky') === 'overcast';
const theme: Theme = overcast ? {
  ...THEMES.memorial,
  skyTop: new THREE.Color(0x8e9aa8), skyHorizon: new THREE.Color(0xd2d6da), fog: new THREE.Color(0xc2c8ce), fogDensity: 0.0011,
  sunColor: new THREE.Color(0xfff2e2), sunIntensity: 1.5, hemiSky: new THREE.Color(0xe2e8ee), hemiGround: new THREE.Color(0x8c887e), hemiIntensity: 2.3, exposure: 1.02,
} : THEMES.memorial;
// Overcast: a high, soft sun, and the sky dome swapped for a cloud deck.
r.setTheme(theme, overcast ? { x: -0.3, y: 0.9, z: 0.3 } : map.sun);
if (overcast) r.sky!.mesh.material = cloudDeck();
const level = new LevelView(assets, map, theme);
r.scene.add(level.group);
if (params.get('hills') !== '1') level.group.getObjectByName('horizon')?.removeFromParent();
r.scene.add(treeLine());

// Camera: a phone held up high at the edge of the hall's top platform, over the grand staircase, looking
// west over the crowd down Liberty Square to the gate (a 1.5x lens, as the reference was filmed).
const [cx, cy, cz] = (params.get('cam') ?? '-20,16.5,0').split(',').map(Number);
r.camera.position.set(cx, cy, cz);
r.camera.rotation.set(THREE.MathUtils.degToRad(num('pitch', 7.41)), Math.PI / 2 - THREE.MathUtils.degToRad(num('yaw', 0.55)), 0);
r.camera.fov = num('fov', 44.3); r.camera.updateProjectionMatrix();
r.camera.updateMatrixWorld();

// The pass: aimed so the formation crosses where it does in the reference clip (render-space screen
// points, before the push-in): lower left at t = 0 to upper right at 2.633 s, level at `alt` metres.
const alt = num('alt', 250);
// Aimed through the upright (9:16) view whatever the window's shape, so the 16:9 framing sees the same pass.
const aim = r.camera.clone(); aim.aspect = 9 / 16; aim.fov = num('aimfov', 44.3);
aim.rotation.set(THREE.MathUtils.degToRad(num('aimpitch', 7.41)), Math.PI / 2 - THREE.MathUtils.degToRad(num('yaw', 0.55)), 0, 'YXZ');
aim.updateProjectionMatrix(); aim.updateMatrixWorld();
const at = (sx: number, sy: number) => {
  const ndc = new THREE.Vector3(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(aim);
  const dir = ndc.sub(aim.position).normalize();
  return aim.position.clone().addScaledVector(dir, (alt - aim.position.y) / dir.y);
};
const p0 = at(num('sx0', 0.296), num('sy0', 0.357)), p1 = at(num('sx1', 0.677), num('sy1', 0.231)), span = num('span', 2.633);
const path: FlyoverPath = { start: p0, velocity: p1.clone().sub(p0).divideScalar(span), smokeOn: -40, smokeOff: 40 };
const flyover = new Flyover(path);
flyover.setHaze(theme.fog, theme.fogDensity * num('haze', 0.2));
r.scene.add(flyover.group);

// The flagpole in front of the gate and its flag; a row of flags along the south lawn.
const flagTexture = rocFlag();
const flags: { mesh: THREE.Mesh; base: Float32Array; w: number; phase: number }[] = [];
function flagpole(x: number, z: number, height: number, flagW: number, radius: number) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius, height, 10), new THREE.MeshStandardMaterial({ color: 0xd8d8d4, metalness: 0.5, roughness: 0.35 }));
  pole.position.set(x, height / 2, z); r.scene.add(pole);
  const geo = new THREE.PlaneGeometry(flagW, flagW * 2 / 3, 16, 6);
  geo.translate(flagW / 2, 0, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: flagTexture, side: THREE.DoubleSide, roughness: 0.8 }));
  // Flying south (left, seen from the plaza) on the breeze.
  mesh.position.set(x, height - flagW / 3 - 0.1, z + radius * 0.6); mesh.rotation.y = -Math.PI / 2;
  r.scene.add(mesh);
  flags.push({ mesh, base: (geo.getAttribute('position').array as Float32Array).slice(), w: flagW, phase: x * 0.37 + z * 0.11 });
}
flagpole(-180, -7.85, 37.9, 3.2, 0.36);
for (let x = -95; x >= -195; x -= 6) flagpole(x, 14 + (x + 95) * 0.03, 4.5, 2, 0.06);

if (params.get('crowd') !== '0') r.scene.add(crowd());

let dressed = false;
void level.ready.then(() => { dressed = true; });

function frame(t: number) {
  flyover.update(t);
  for (const f of flags) {
    const pos = f.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = f.base[i * 3], y = f.base[i * 3 + 1], k = x / f.w;
      pos.setZ(i, Math.sin(x * 2.4 - t * 6.5 + f.phase) * 0.16 * f.w * k + Math.sin(y * 3 + x * 1.3 - t * 4.1) * 0.03 * f.w * k);
    }
    pos.needsUpdate = true; f.mesh.geometry.computeVertexNormals();
  }
  level.update(t);
  r.render(t);
}

info.style.display = 'none';
Object.assign(window, { __fly: { frame, path, ready: () => dressed, camera: r.camera, flyover } });
if (params.get('live')) {
  const start = performance.now() / 1000 - num('from', -1);
  r.renderer.setAnimationLoop(() => frame(performance.now() / 1000 - start));
} else {
  // Draw once now, and again when the level has its trees and street dressing.
  frame(num('t', 0));
  void level.ready.then(() => frame(num('t', 0)));
}

/** Trees beyond the gate, the way Liberty Square is ringed by them, with the city's towers rising behind. */
function treeLine() {
  const group = new THREE.Group();
  const rand = rng(77);
  const blobs: THREE.BufferGeometry[] = [], blocks: THREE.BufferGeometry[] = [];
  for (let z = -150; z <= 150; z += 5) for (let row = 0; row < 3; row++) {
    const s = 6 + rand() * 6, x = -350 - row * 14 - rand() * 10;
    const g = new THREE.IcosahedronGeometry(1, 1); g.scale(s, s * (1.1 + rand() * 0.5), s); g.translate(x, s * 1.2 + rand() * 3, z + rand() * 4);
    blobs.push(g);
  }
  for (const [x, z, w, h] of [[-470, -95, 26, 70], [-520, -40, 30, 52], [-480, 60, 22, 44], [-560, 20, 34, 62], [-450, 118, 20, 38], [-600, -120, 40, 80]]) {
    const g = new THREE.BoxGeometry(w, h, w * 0.8); g.translate(x, h / 2, z); blocks.push(g);
  }
  const trees = new THREE.Mesh(mergeGeometries(blobs)!, new THREE.MeshLambertMaterial({ color: 0x3e5a36, flatShading: true }));
  const towers = new THREE.Mesh(mergeGeometries(blocks)!, new THREE.MeshLambertMaterial({ color: 0xc8c8c4 }));
  group.add(trees, towers);
  return group;
}

/** The Republic of China flag: red field, blue canton, white sun with twelve rays. */
function rocFlag() {
  const c = document.createElement('canvas');
  c.width = 600; c.height = 400;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fe0000'; g.fillRect(0, 0, 600, 400);
  g.fillStyle = '#000095'; g.fillRect(0, 0, 300, 200);
  const cx = 150, cy = 100;
  g.fillStyle = '#ffffff'; g.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? 40 : 75;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
  g.fillStyle = '#000095'; g.beginPath(); g.arc(cx, cy, 39.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, 34, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

/** A grey overcast deck: layered noise, brighter where the cloud is thin, darker underneath the thick. */
function cloudDeck() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { time: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `
      varying vec3 vDir;
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        // Project onto a cloud deck overhead: far clouds crowd towards the horizon.
        vec2 uv = d.xz / (h + 0.12) * 3.0;
        float n = fbm(uv + vec2(0.0, 3.0));
        float thick = smoothstep(0.4, 0.64, n);
        vec3 light = vec3(0.7, 0.72, 0.76), dark = vec3(0.34, 0.38, 0.45), haze = vec3(0.74, 0.76, 0.79);
        vec3 col = mix(light, dark, thick * 0.85);
        col = mix(col, vec3(0.84, 0.85, 0.87), (1.0 - smoothstep(0.25, 0.5, n)) * 0.5);
        col = mix(haze, col, smoothstep(0.0, 0.14, h));
        col *= 1.0 - 0.12 * smoothstep(0.2, 0.8, h);
        col = mix(col, haze * 0.92, smoothstep(0.0, -0.15, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * People filling the plaza in front of the camera, facing the gate and the sky: low-poly figures in
 * instanced batches (clothes, trousers, heads), some holding a phone up to film the pass.
 */
function crowd() {
  const group = new THREE.Group();
  const rand = rng(1010);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, d); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g;
  };
  // Facing -z in local space (three.js forward); arms at the sides, or the right one raised with a phone.
  const torso = box(0.44, 0.62, 0.26, 0, 1.16, 0);
  const armsDown = [box(0.11, 0.6, 0.13, -0.29, 1.15, 0), box(0.11, 0.6, 0.13, 0.29, 1.15, 0)];
  const armsUp = [box(0.11, 0.6, 0.13, -0.29, 1.15, 0), box(0.11, 0.58, 0.13, 0.3, 1.72, -0.12, 0.25)];
  const shirtDown = mergeGeometries([torso.clone(), ...armsDown])!, shirtUp = mergeGeometries([torso, ...armsUp])!;
  const legs = mergeGeometries([box(0.15, 0.86, 0.2, -0.1, 0.43, 0), box(0.15, 0.86, 0.2, 0.1, 0.43, 0)])!;
  const head = box(0.21, 0.25, 0.23, 0, 1.6, 0);
  const hair = box(0.23, 0.1, 0.25, 0, 1.73, 0.01);
  const phone = box(0.08, 0.15, 0.02, 0.34, 2.02, -0.22);
  const people: { x: number; z: number; yaw: number; s: number; up: boolean }[] = [];
  // Denser near the front of the gate, thinning towards the camera's feet; the axis stays a little clearer.
  for (let i = 0; i < 30000 && people.length < 6500 * num('crowdw', 46) / 46; i++) {
    const x = -54 - rand() * 268, z = (rand() * 2 - 1) * num('crowdw', 46);
    if (Math.abs(z) < 2.2 && rand() < 0.5) continue;
    // Thinner near the camera (people spread out at the back of a crowd) and round the flagpole.
    if (rand() > 0.3 + 0.7 * Math.min(1, (-75 - x) / 130)) continue;
    if (Math.hypot(x + 180, z + 7.85) < 4) continue;
    people.push({ x, z, yaw: (rand() - 0.5) * 1.6, s: 0.9 + rand() * 0.2, up: rand() < 0.22 });
  }
  const SHIRTS = [0xf4f4f0, 0xf0f0ec, 0x1c1c20, 0x2a2e3a, 0xc8242c, 0xe8e0d0, 0x8aa8c8, 0x4a6a8a, 0xd8c070, 0x6a7a5a, 0xb8b8b4, 0xe85a6a];
  const PANTS = [0x22263a, 0x1a1a1e, 0x3a4250, 0x8a7a62, 0x5a5e66, 0x2c3c58];
  const SKIN = [0xe8c4a4, 0xdcb090, 0xd4a684, 0xf0d0b4];
  const HAIR = [0x141210, 0x1e1a16, 0x2a2420, 0x3a3028];
  const lambert = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
  const batch = (geo: THREE.BufferGeometry, who: typeof people, colors: number[], pick: (i: number) => number) => {
    const mesh = new THREE.InstancedMesh(geo, lambert(), who.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    who.forEach((p, i) => {
      // Faces west (-x): local -z turned to -x, give or take.
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 + p.yaw);
      m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setHex(colors[pick(i) % colors.length]));
    });
    mesh.frustumCulled = false;
    group.add(mesh);
  };
  const idx = people.map(() => Math.floor(rand() * 1000));
  const down = people.filter(p => !p.up), up = people.filter(p => p.up);
  batch(shirtDown, down, SHIRTS, i => idx[i]);
  batch(shirtUp, up, SHIRTS, i => idx[i + 7]);
  batch(legs, people, PANTS, i => idx[i] >> 3);
  batch(head, people, SKIN, i => idx[i] >> 5);
  batch(hair, people, HAIR, i => idx[i] >> 2);
  batch(phone, up, [0x101418], () => 0);
  return group;
}
