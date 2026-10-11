import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../../shared/math';
import { TOWER, towerLofts, towerNeedle } from '../../shared/maps/tower101';

/**
 * The city past a map, from its dressing set (./cityscape.ts): generic buildings, Taipei 101 as a
 * detailed model, the hills and water on the ground, and the major avenues. Everything here is far
 * away, so it uses a thinner haze than the scene fog (which would hide it), casts no shadows and
 * merges into a handful of draws.
 */
export interface SkylineData {
  /** Flat rows of x0, z0, x1, z1, roof height, facade tint. */
  buildings: number[];
  /** Taipei 101 is the only landmark; its foot is at x, z. */
  landmarks: { id: string; x: number; z: number }[];
  roads: { axis: 'x' | 'z'; at: number; from: number; to: number; hw: number; elevated: boolean }[];
  ground: { x0: number; z0: number; spacing: number; n: number; waterLevel: number };
  heights: number[];
}

/** Haze over distance for the far layer: exp² fog with its own density, in the scene's fog colour. */
function farHaze<T extends THREE.Material>(m: T, density = 0.00042): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    prev?.call(m, s, r);
    s.fragmentShader = s.fragmentShader.replace('#include <fog_fragment>', `#ifdef USE_FOG
      float farFog = 1.0 - exp(- ${density.toFixed(6)} * ${density.toFixed(6)} * vFogDepth * vFogDepth);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, farFog);
    #endif`);
  };
  m.customProgramCacheKey = () => `far-haze-${density}-${m.type}`;
  return m;
}

function paint(g: THREE.BufferGeometry, hex: number) {
  const c = new THREE.Color(hex), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Facade sheet for the far city: a window grid, about a third of the windows lit. */
function windowsTexture(lit: boolean) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d')!, r = rng(lit ? 31 : 37);
  c.fillStyle = lit ? '#000' : '#d8d4cc'; c.fillRect(0, 0, 256, 256);
  for (let fy = 0; fy < 8; fy++) for (let bx = 0; bx < 8; bx++) {
    const x = bx * 32 + 6, y = fy * 32 + 8, on = r() < 0.32;
    if (lit) { if (on) { c.fillStyle = r() < 0.7 ? '#ffd89a' : '#d8ecff'; c.fillRect(x, y, 20, 15); } continue; }
    c.fillStyle = '#2a323c'; c.fillRect(x, y, 20, 15);
    if (on) { c.fillStyle = 'rgba(255,214,150,0.45)'; c.fillRect(x, y, 20, 15); }
  }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Box with world-scaled facade UVs (one window per 3.2 m bay and floor) and no bottom. */
function facadeBox(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, hex: number) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute, n = g.getAttribute('normal') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(n.getY(i)) > 0.5) { uv.setXY(i, 0.01, 0.01); continue; }
    const along = Math.abs(n.getX(i)) > 0.5 ? p.getZ(i) : p.getX(i);
    uv.setXY(i, along / 25.6, (p.getY(i) - y0) / 25.6);
  }
  return paint(g, hex);
}

export function buildSkyline(d: SkylineData, ox: number, oz: number) {
  const group = new THREE.Group();
  group.name = 'dressing:skyline';
  const sink = -0.3; // under the map's own ground, which covers the near field

  // ---- Generic buildings ----
  const parts: THREE.BufferGeometry[] = [];
  const tint = new THREE.Color();
  for (let i = 0; i < d.buildings.length; i += 6) {
    const [x0, z0, x1, z1, top, hex] = d.buildings.slice(i, i + 6);
    tint.setHex(hex).lerp(new THREE.Color(0xd8d4cc), 0.25);
    parts.push(facadeBox(x0 - ox, z0 - oz, x1 - ox, z1 - oz, sink, top, tint.getHex()));
  }
  // ---- Taipei 101 ----
  for (const l of d.landmarks) if (l.id === 'taipei101') taipei101(group, l.x - ox, l.z - oz);
  const facade = farHaze(new THREE.MeshStandardMaterial({ map: windowsTexture(false), emissiveMap: windowsTexture(true), emissive: 0xffffff, emissiveIntensity: 0.8, vertexColors: true, roughness: 0.9 }));
  if (parts.length) { const m = new THREE.Mesh(mergeGeometries(parts, false)!, facade); m.name = 'skyline:city'; m.receiveShadow = false; group.add(m); }

  // ---- Ground, hills and water ----
  const { x0, z0, spacing, n, waterLevel } = d.ground;
  const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), idx: number[] = [];
  const c = new THREE.Color(), city = new THREE.Color(0x56575a), hill = new THREE.Color(0x3c5a34), high = new THREE.Color(0x2c4430);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, h = d.heights[k];
    pos.set([x0 + i * spacing - ox, h + sink, z0 + j * spacing - oz], k * 3);
    if (h < 0) c.set(0x4a4a40); else if (h < 2) c.copy(city); else c.copy(hill).lerp(high, Math.min(1, h / 500));
    col.set([c.r, c.g, c.b], k * 3);
    if (i < n - 1 && j < n - 1) idx.push(k, k + n, k + 1, k + 1, k + n, k + n + 1);
  }
  const ground = new THREE.BufferGeometry();
  ground.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  ground.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ground.setIndex(idx); ground.computeVertexNormals();
  const gm = new THREE.Mesh(ground, farHaze(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })));
  gm.name = 'skyline:ground'; group.add(gm);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(n * spacing, n * spacing).rotateX(-Math.PI / 2).translate(x0 + n * spacing / 2 - ox, waterLevel + sink, z0 + n * spacing / 2 - oz),
    farHaze(new THREE.MeshStandardMaterial({ color: 0x34505e, roughness: 0.15, metalness: 0.4 })));
  water.name = 'skyline:water'; group.add(water);
  // Major roads as dark strips on the city ground.
  const road: THREE.BufferGeometry[] = [];
  for (const { axis, at, from, to, hw, elevated } of d.roads) {
    if (hw < 4) continue;
    const a = Math.max(from, -3000), b = Math.min(to, 3000), len = b - a, mid = (a + b) / 2;
    const g = axis === 'x' ? new THREE.PlaneGeometry(len, hw * 2).rotateX(-Math.PI / 2).translate(mid - ox, sink + 0.08, at - oz) : new THREE.PlaneGeometry(hw * 2, len).rotateX(-Math.PI / 2).translate(at - ox, sink + 0.08, mid - oz);
    road.push(paint(g.toNonIndexed(), elevated ? 0x404044 : 0x2e2f33));
  }
  if (road.length) {
    for (const g of road) g.deleteAttribute('uv');
    const m = new THREE.Mesh(mergeGeometries(road, false)!, farHaze(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
    m.name = 'skyline:roads'; group.add(m);
  }
  group.traverse(o => { o.castShadow = false; o.frustumCulled = true; });
  return group;
}

// ---- Taipei 101 ----------------------------------------------------------------------------

/** A notched square's outline (each corner stepped in twice by n), 12 points, half-size h. */
function steppedSquare(h: number, n: number): [number, number][] {
  const q: [number, number][] = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const rot = (x: number, z: number): [number, number] => sx * sz > 0 ? [sx * x, sz * z] : [sx * z, sz * x];
    q.push(rot(h, h - n), rot(h - n, h - n), rot(h - n, h));
  }
  return q;
}

/** Side walls between the outline at y0 (half-size h0, step n0) and at y1 (h1, n1), UVs per metre. */
function loftWalls(cx: number, cz: number, y0: number, y1: number, h0: number, n0: number, h1: number, n1: number, cap = false) {
  const lo = steppedSquare(h0, n0), hi = steppedSquare(h1, n1), pos: number[] = [], uv: number[] = [];
  let run = 0;
  for (let i = 0; i < lo.length; i++) {
    const j = (i + 1) % lo.length;
    const A0 = [cx + lo[i][0], y0, cz + lo[i][1]], B0 = [cx + lo[j][0], y0, cz + lo[j][1]];
    const A1 = [cx + hi[i][0], y1, cz + hi[i][1]], B1 = [cx + hi[j][0], y1, cz + hi[j][1]];
    const len = Math.hypot(lo[j][0] - lo[i][0], lo[j][1] - lo[i][1]);
    const u0 = run / 3.2, u1 = (run + len) / 3.2, v0 = y0 / 4.2, v1 = y1 / 4.2;
    pos.push(...A0, ...B1, ...B0, ...A0, ...A1, ...B1);
    uv.push(u0, v0, u1, v1, u1, v0, u0, v0, u0, v1, u1, v1);
    run += len;
  }
  if (cap) for (let i = 1; i < hi.length - 1; i++) {
    const t = (k: number) => [cx + hi[k][0], y1, cz + hi[k][1]];
    pos.push(...t(0), ...t(i + 1), ...t(i)); uv.push(0.01, 0.01, 0.01, 0.01, 0.01, 0.01);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Taipei 101 (台北101, 508 m) from the shared outline (shared/maps/tower101.ts): the tapering base,
 * eight flared modules each lit gold along its eave, the stepped crown and the needle with its
 * beacon. Dark green glass with lit windows; it stands well outside the map and blocks nothing.
 */
function taipei101(group: THREE.Group, cx: number, cz: number) {
  const glass: THREE.BufferGeometry[] = [], gold: THREE.BufferGeometry[] = [], needle: THREE.BufferGeometry[] = [];
  const sink = -0.3;
  for (const [y0, y1, h0, n0, h1, n1, , glow] of towerLofts()) {
    if (y1 - y0 < 0.05) continue;
    const walls = loftWalls(cx, cz, Math.max(y0, sink), y1, h0, n0, h1, n1, y1 === TOWER.crownTop);
    (glow >= 2.5 ? gold : glass).push(walls);
  }
  // Vertical lines of light down the stepped corners of the modules.
  for (let k = 0; k < TOWER.segCount; k++) {
    const y0 = TOWER.baseTop + k * TOWER.segH;
    for (let i = 1; i < 12; i += 3) {
      const [px, pz] = steppedSquare(1, 0.16)[i];
      gold.push(new THREE.CylinderGeometry(0.35, 0.35, TOWER.segH - 4, 4).translate(cx + px * 23.6, y0 + (TOWER.segH - 2) / 2, cz + pz * 23.6).toNonIndexed());
    }
  }
  for (const [r0, r1, y0, y1, color, glow] of towerNeedle()) {
    const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, 8).translate(cx, (y0 + y1) / 2, cz).toNonIndexed();
    if (glow >= 2.5) gold.push(g); else needle.push(paint(g, color));
  }
  const glassMat = farHaze(new THREE.MeshStandardMaterial({ color: 0x3f6a6a, map: windowsTexture(false), emissiveMap: windowsTexture(true), emissive: 0xfff0d0, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.55 }), 0.00032);
  const goldMat = farHaze(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc45a).multiplyScalar(1.7), toneMapped: false }), 0.00032);
  for (const g of needle) if (g.getAttribute('uv')) g.deleteAttribute('uv');
  const tower = new THREE.Mesh(mergeGeometries(glass, false)!, glassMat); tower.name = 'skyline:taipei101';
  for (const g of gold) { if (g.getAttribute('uv')) g.deleteAttribute('uv'); if (g.getAttribute('normal')) g.deleteAttribute('normal'); }
  const lights = new THREE.Mesh(mergeGeometries(gold, false)!, goldMat); lights.name = 'skyline:taipei101-lights';
  const spire = new THREE.Mesh(mergeGeometries(needle, false)!, farHaze(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }), 0.00032));
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6).translate(cx, 509, cz), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a1a).multiplyScalar(3), toneMapped: false, fog: false }));
  group.add(tower, lights, spire, beacon);
}
