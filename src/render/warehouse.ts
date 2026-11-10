import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { warehouse } from '../../shared/maps/warehouse';
import { assetUrl } from '../assetUrl';
import { halo, lightShaft } from './alley';
import { mergeStatic, staticMeshes } from './batch';
import type { LevelMaterials } from './dressing';
import { textureBudget } from './textures';

/**
 * The Warehouse above the Low preset (the 'warehouse' dressing set): photoscanned CC0 Poly Haven
 * surfaces and models (public/assets/warehouse, packed by tools/fetch-scans.ts) in place of the plain
 * ones. The hall and its collision are shared/maps/warehouse.ts and src/render/level.ts as before:
 * the floor, walls and decks take the scanned textures, each crate box becomes a stack of scanned
 * ammunition crates that fills it exactly, and a scanned lamp hangs where each light is.
 */

const DIR = 'assets/warehouse';
/** The crates of a stack: this long (along the box's long side), deep and high at most (m). */
const LONG = 1.5, DEEP = 0.75, HIGH = 0.5;
/** Sheets of lit dust under one roof light. */
const SHEETS = 4;

function surface(material: THREE.Material | undefined, name: string, o: { color: number; metal?: boolean; normal?: number; env?: number }) {
  const m = material as THREE.MeshStandardMaterial | undefined;
  if (!m) return;
  const loader = new THREE.TextureLoader(), anisotropy = textureBudget().anisotropy;
  const load = (kind: string) => {
    const t = loader.load(assetUrl(`${DIR}/${name}_${kind}.webp`));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy;
    if (kind === 'diff') t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const arm = load('arm');
  m.map = load('diff'); m.normalMap = load('nor'); m.roughnessMap = arm; m.aoMap = arm;
  m.metalnessMap = o.metal ? arm : null;
  m.color.setHex(o.color); m.roughness = 1; m.metalness = o.metal ? 1 : 0;
  m.normalScale.setScalar(o.normal ?? 1);
  m.envMapIntensity = o.env ?? 1;
  m.needsUpdate = true;
}

const hash = (n: number) => { const s = Math.sin(n * 127.1 + 31.7) * 43758.5453; return s - Math.floor(s); };

export async function buildWarehouse(materials: LevelMaterials): Promise<THREE.Object3D> {
  const hall = new THREE.Group();
  hall.name = 'dressing:warehouse';
  if (textureBudget().low) return hall;

  surface(materials.steel, 'floor', { color: 0x9c9c9c, env: 0.8 });
  // Painted sheet: the paint, not the iron under it, is what the light meets.
  surface(materials.roof, 'wall', { color: 0xe6e9ec });
  surface(materials.floor, 'deck', { color: 0xc8ccd0, metal: true });
  // Girders, columns and rails: worn green paint (the girders carry their own tint over it).
  surface(materials.paint, 'girder', { color: 0xffffff, env: 0.6 });
  surface(materials.steelDark, 'girder', { color: 0x8f989c, env: 0.6 });

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), anisotropy = textureBudget().anisotropy;
  const [crate, lamp, power, extinguisher, redBarrel, blueBarrel, truck] = (await Promise.all(['wooden_military_crate', 'hanging_industrial_lamp', 'power_box_01', 'korean_fire_extinguisher_01', 'Barrel_01', 'barrel_03', 'hand_truck'].map(id => loader.loadAsync(assetUrl(`${DIR}/${id}.glb`))))).map(g => g.scene);
  for (const scene of [crate, lamp, power, extinguisher, redBarrel, blueBarrel, truck]) {
    scene.updateMatrixWorld(true);
    scene.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m) for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap]) if (t) t.anisotropy = anisotropy;
    });
  }
  const def = warehouse();

  // ---- Crates: every crate box of the map, filled with scanned crates ----
  {
    const parts: THREE.BufferGeometry[] = [];
    let material: THREE.Material | undefined;
    crate.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      material ??= mesh.material as THREE.Material;
      parts.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
    });
    const geometry = mergeGeometries(parts, false)!;
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!, size = bb.getSize(new THREE.Vector3());
    geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);

    const boxes = def.decor.flatMap(d => d.kind === 'block' && d.style === 'crate' ? [{ s: def.solids[d.solid], color: d.color }] : []);
    const casters: THREE.BufferGeometry[] = [];
    // Bare wood under the lamps is orange: the crates take less of the room's light than the scan gives them.
    (material as THREE.MeshStandardMaterial).envMapIntensity = 0.4;
    // The team boxes are painted: the wood keeps its grain and stencils but gives up its own colour to the paint.
    const painted = (material as THREE.MeshStandardMaterial).clone();
    painted.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', 'diffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))) * 2.2;\n#include <color_fragment>');
    };
    painted.customProgramCacheKey = () => 'warehouse-painted';
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3(), scale = new THREE.Vector3();
    boxes.forEach(({ s, color }, i) => {
      const w = s.maxX - s.minX, h = s.maxY - s.minY, d = s.maxZ - s.minZ, cx = (s.minX + s.maxX) / 2, cz = (s.minZ + s.maxZ) / 2;
      const layers = Math.max(1, Math.ceil(h / HIGH - 0.2)), square = Math.abs(w - d) < 0.01;
      const placed: { m: THREE.Matrix4; c: THREE.Color }[] = [];
      for (let k = 0; k < layers; k++) {
        // Square stacks turn layer by layer, as on a pallet.
        const turned = square ? hash(i * 7 + k * 3) < 0.5 : d > w;
        const long = turned ? d : w, short = turned ? w : d;
        const nl = Math.max(1, Math.round(long / LONG)), nd = Math.max(1, Math.round(short / DEEP));
        for (let a = 0; a < nl; a++) for (let b = 0; b < nd; b++) {
          const r = hash(i * 31 + k * 17 + a * 5 + b), l = (a + 0.5) / nl - 0.5, t = (b + 0.5) / nd - 0.5;
          // In the stack's own space: its middle at the foot of the box.
          at.set(turned ? t * short : l * long, k * h / layers, turned ? l * long : t * short);
          q.setFromAxisAngle(up, (turned ? Math.PI / 2 : 0) + (r < 0.5 ? Math.PI : 0) + (hash(r * 91) - 0.5) * 0.02);
          scale.set(long / nl / size.x, h / layers / size.y, short / nd / size.z).multiplyScalar(0.992);
          // Some stacks are of crates painted olive.
          const c = new THREE.Color(color ?? (hash(i * 13.7 + 5) < 0.5 ? 0xa8b684 : 0xd8d5c8));
          if (color !== undefined) c.multiplyScalar(1.8);
          placed.push({ m: new THREE.Matrix4().compose(at, q, scale), c: c.multiplyScalar(0.82 + 0.26 * hash(r * 57 + 3)) });
        }
      }
      // One mesh a stack: the renderer leaves out the stacks it does not see and draws the near ones first,
      // which hide the far ones (one mesh for the hall drew every crate of it, in no order).
      const stack = new THREE.InstancedMesh(geometry, color === undefined ? material! : painted, placed.length);
      placed.forEach((p, j) => { stack.setMatrixAt(j, p.m); stack.setColorAt(j, p.c); });
      stack.position.set(cx, s.minY, cz);
      stack.name = 'warehouse:crates';
      stack.receiveShadow = true; stack.castShadow = false;
      stack.computeBoundingSphere();
      hall.add(stack);
      // What casts the stack's shadow: its box, a little smaller than the crates.
      casters.push(new THREE.BoxGeometry(w - 0.06, h - 0.03, d - 0.06).translate(cx, s.minY + h / 2, cz));
    });
    // The boxes are drawn by the shadow pass alone (its proxies read the triangles; a camera draws none of them).
    const shadow = new THREE.Mesh(mergeGeometries(casters, false)!, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    shadow.geometry.setDrawRange(0, 0);
    shadow.name = 'warehouse:crate-shadows'; shadow.castShadow = true;
    hall.add(shadow);
  }

  // ---- Lamps: one hangs from the roof truss over each light of the map ----
  {
    const warm = 0xffe8cc, glare = new THREE.Group();
    lamp.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && /glass/.test(m.name)) { m.emissive.set(warm); m.emissiveIntensity = 9; m.emissiveMap = null; }
    });
    for (const d of def.decor) {
      if (d.kind !== 'light') continue;
      const l = lamp.clone(true), top = d.y + 0.5, mouth = top - 1.34 * 1.5;
      l.position.set(d.x, top, d.z); l.scale.setScalar(1.5);
      l.traverse(o => { (o as THREE.Mesh).castShadow = false; });
      // Every light costs every lit pixel: the lamps over the bays and the maze light the hall, the others only glow.
      if (Math.abs(d.x) !== 16) {
        const spot = new THREE.SpotLight(warm, 220, 14, 1.0, 0.8, 1.8);
        spot.position.set(d.x, mouth, d.z); spot.target.position.set(d.x, 0, d.z);
        hall.add(spot, spot.target);
      }
      const h = halo(warm, 1.7, 1.1); h.position.set(d.x, mouth - 0.05, d.z);
      const s = lightShaft(warm, 0.22, mouth, 3.4); s.position.set(d.x, mouth, d.z);
      hall.add(l); glare.add(h, s);
    }
    hall.add(glare);
  }

  // ---- On the long walls: switchboards between the columns, a fire extinguisher at the foot of two of them ----
  {
    const still = new THREE.Group();
    for (const turn of [0, Math.PI]) {
      const side = new THREE.Group();
      side.rotation.y = turn;
      const put = (model: THREE.Object3D, x: number, y: number, z: number, scale = 1, rotY = 0) => {
        const c = model.clone(true);
        c.position.set(x, y, z); c.scale.setScalar(scale); c.rotation.y = rotY;
        c.traverse(o => { (o as THREE.Mesh).castShadow = false; (o as THREE.Mesh).receiveShadow = true; });
        side.add(c);
      };
      for (const x of [-20, -4, 12]) put(power, x, 1.5, -15.5 + 0.075, 1.6);
      for (const x of [-15.45, -7.45]) put(extinguisher, x, 0, -15.35);
      // Drums and a hand truck against the wall, clear of the lanes between the stacks.
      [-12.9, -12.2, -11.55, 4.9, 5.6].forEach((x, i) => put(i % 3 === 1 ? redBarrel : blueBarrel, x, 0, -15.14 + (i % 2) * 0.04, 1, i * 2.1));
      put(truck, -18.6, 0, -15.36, 1, 0.12);
      still.add(side);
    }
    hall.add(still);
    mergeStatic(still, staticMeshes(still), { name: 'warehouse' });
  }

  // ---- Sun through the roof lights: bars of lit dust from each gap down to the floor ----
  {
    const sun = new THREE.Vector3(def.sun.x, def.sun.y, def.sun.z).normalize(), roof = 9.8, fall = roof / sun.y;
    const dx = -sun.x * fall, dz = -sun.z * fall, x0 = -27.5, x1 = 27.5;
    const position: number[] = [], uv: number[] = [], index: number[] = [];
    const gaps = def.decor.flatMap(d => d.kind === 'block' && d.style === 'roof' ? [def.solids[d.solid]] : []).filter(s => s.minY >= roof - 0.01)
      .sort((a, b) => a.minZ - b.minZ).flatMap((s, i, all) => i ? [[all[i - 1].maxZ, s.minZ]] : []).filter(([a, b]) => b - a > 0.5);
    for (const [za, zb] of gaps) for (let k = 0; k < SHEETS; k++) {
      const z = za + (zb - za) * (k + 0.5) / SHEETS, n = position.length / 3;
      position.push(x0, roof, z, x1, roof, z, x0 + dx, 0, z + dz, x1 + dx, 0, z + dz);
      uv.push(0, 0, 1, 0, 0, 1, 1, 1);
      index.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    const time = { value: 0 };
    const beams = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time, tint: { value: new THREE.Color(0xfff0d6).multiplyScalar(0.022) } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV;\nvoid main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform float time; uniform vec3 tint; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
float hash(float p) { return fract(sin(p * 127.1) * 43758.5453); }
float noise(float p) { float i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
void main() {
  // Streaks along the beam that drift, strongest under the roof; a sheet seen on edge is not seen.
  float streak = 0.55 + 0.3 * noise(vUv.x * 46.0 + time * 0.05) + 0.15 * noise(vUv.x * 150.0 - time * 0.08);
  float ends = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x) * smoothstep(1.0, 0.9, vUv.y);
  float facing = smoothstep(0.03, 0.4, abs(dot(normalize(vN), normalize(vV))));
  gl_FragColor = vec4(tint * streak * ends * facing * mix(1.0, 0.55, vUv.y), 1.0);
}`,
    }));
    beams.name = 'warehouse:beams'; beams.renderOrder = 3; beams.frustumCulled = false;
    beams.onBeforeRender = () => { time.value = performance.now() / 1000; };
    hall.add(beams);
  }

  // ---- Worn yellow lines on the floor, between each bay and the stacks ----
  {
    const c = document.createElement('canvas'); c.width = 512; c.height = 16;
    const ctx = c.getContext('2d')!, img = ctx.createImageData(512, 16);
    for (let i = 0; i < 512 * 16; i++) {
      const x = i % 512, y = Math.floor(i / 512), worn = hash(Math.floor(x / 5) * 3.1 + Math.floor(y / 3) * 7.7) * 0.6 + hash(i * 0.37) * 0.4;
      img.data.set([255, 255, 255, worn > 0.3 ? 255 * Math.min(1, (worn - 0.3) * 3) : 0], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    const worn = new THREE.CanvasTexture(c);
    worn.wrapS = THREE.RepeatWrapping; worn.repeat.set(5, 1);
    const paint = new THREE.MeshStandardMaterial({ color: 0xc99a1c, roughness: 0.7, alphaMap: worn, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    paint.name = 'warehouse_paint';
    for (const x of [-17.6, 17.6]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(30.4, 0.14).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), paint);
      line.position.set(x, 0.004, 0); line.receiveShadow = true; line.name = 'warehouse:line';
      hall.add(line);
    }
  }
  return hall;
}
