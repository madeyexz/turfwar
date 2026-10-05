import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../../shared/math';

/**
 * The city past a map's backdrop, from its dressing set: the source game's generic buildings, its
 * landmarks (Taipei 101 as a detailed model, the Presidential Office, the North Gate, Taipei Main
 * Station and massing for the rest), its hills and water, and the major roads. Everything here is
 * far away, so it uses a thinner haze than the scene fog (which would hide it), casts no shadows and
 * merges into a handful of draws.
 */
export interface SkylineData {
  buildings: number[];
  landmarks: [string, string, string, number, number, number, number, string][];
  hills: [number, number, number, number, string, string][];
  roads: ['x' | 'z', number, number, number, number, number, string][];
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
  // ---- Landmarks ----
  const lm: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [];
  for (const [id, , , x, z, w, dd, kind] of d.landmarks) {
    const cx = x - ox, cz = z - oz;
    if (id === 'taipei101') { taipei101(group, cx, cz); continue; }
    if (id === 'presidential') { presidentialOffice(lm, glow, cx, cz, w, dd); continue; }
    if (id === 'beimen') { northGate(lm, cx, cz); continue; }
    if (id === 'redhouse' || kind === 'plaza' || kind === 'park' || kind === 'market') continue;
    const h = id === 'main-station' ? 26 : id === 'cks' ? 70 : id === 'grand-hotel' ? 87 : id === 'xinyi-mall' ? 60 : id === 'cityhall' ? 50 : kind === 'police' ? 42 : kind === 'hospital' ? 48 : kind === 'temple' ? 14 : 30;
    const ww = id === 'cks' ? w * 0.5 : w * 0.8, ddd = id === 'cks' ? dd * 0.5 : dd * 0.8;
    if (id === 'cks') lm.push(paint(new THREE.BoxGeometry(ww, h - sink, ddd).translate(cx, sink + (h - sink) / 2, cz).toNonIndexed(), 0xf2f2ee));
    else parts.push(facadeBox(cx - ww / 2, cz - ddd / 2, cx + ww / 2, cz + ddd / 2, sink, h, id === 'main-station' ? 0xb8a890 : 0xc8c4bc));
    // Pitched roofs on the old halls (Main Station, CKS, temples): a four-sided cap.
    if (id === 'main-station' || id === 'cks' || kind === 'temple' || id === 'grand-hotel') {
      const roof = new THREE.ConeGeometry(Math.max(ww, ddd) * 0.72, h * 0.35, 4, 1).rotateY(Math.PI / 4).scale(ww / Math.max(ww, ddd), 1, ddd / Math.max(ww, ddd));
      lm.push(paint(roof.translate(cx, h + h * 0.175, cz).toNonIndexed(), id === 'cks' ? 0x1f4f9e : id === 'grand-hotel' ? 0xc8281e : 0x5a3a2a));
    }
  }
  for (const g of lm) { if (g.getAttribute('uv')) g.deleteAttribute('uv'); }
  const facade = farHaze(new THREE.MeshStandardMaterial({ map: windowsTexture(false), emissiveMap: windowsTexture(true), emissive: 0xffffff, emissiveIntensity: 0.8, vertexColors: true, roughness: 0.9 }));
  if (parts.length) { const m = new THREE.Mesh(mergeGeometries(parts, false)!, facade); m.name = 'skyline:city'; m.receiveShadow = false; group.add(m); }
  if (lm.length) { const m = new THREE.Mesh(mergeGeometries(lm, false)!, farHaze(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }))); m.name = 'skyline:landmarks'; group.add(m); }
  if (glow.length) { const m = new THREE.Mesh(mergeGeometries(glow, false)!, farHaze(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }))); m.name = 'skyline:lights'; group.add(m); }

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
  for (const [axis, at, from, to, hw, , elevated] of d.roads) {
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

/** Square plan with stepped (ruyi) corners: 12 points, half size h, notch n. */
function steppedSquare(h: number, n: number): [number, number][] {
  const q: [number, number][] = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    // Each corner: along one side to the notch, step in, step out along the other side (counter-clockwise).
    const rot = (x: number, z: number): [number, number] => sx * sz > 0 ? [sx * x, sz * z] : [sx * z, sz * x];
    q.push(rot(h, h - n), rot(h - n, h - n), rot(h - n, h));
  }
  return q;
}

/** Side walls between two scaled copies of a plan (bottom half size s0 at y0, top s1 at y1), UVs per metre. */
function frustum(plan: [number, number][], y0: number, y1: number, s0: number, s1: number, cx: number, cz: number, cap = false) {
  const pos: number[] = [], uv: number[] = [];
  let run = 0;
  for (let i = 0; i < plan.length; i++) {
    const [ax, az] = plan[i], [bx, bz] = plan[(i + 1) % plan.length];
    const len = Math.hypot(bx - ax, bz - az) * (s0 + s1) / 2;
    const p = (x: number, z: number, s: number, y: number) => [cx + x * s, y, cz + z * s];
    const A0 = p(ax, az, s0, y0), B0 = p(bx, bz, s0, y0), A1 = p(ax, az, s1, y1), B1 = p(bx, bz, s1, y1);
    const u0 = run / 3.2, u1 = (run + len) / 3.2, v0 = y0 / 4.2, v1 = y1 / 4.2;
    pos.push(...A0, ...B1, ...B0, ...A0, ...A1, ...B1);
    uv.push(u0, v0, u1, v1, u1, v0, u0, v0, u0, v1, u1, v1);
    run += len;
  }
  if (cap) for (let i = 1; i < plan.length - 1; i++) {
    const t = (k: number) => [cx + plan[k][0] * s1, y1, cz + plan[k][1] * s1];
    pos.push(...t(0), ...t(i + 1), ...t(i)); uv.push(0.01, 0.01, 0.01, 0.01, 0.01, 0.01);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Ring band around a plan at height y (the gold eaves of each segment). */
function band(plan: [number, number][], y: number, h: number, s: number, out: number, cx: number, cz: number) {
  return frustum(plan, y, y + h, s + out, s + out, cx, cz);
}

/**
 * Taipei 101 (台北101, 508 m) at the source's site: the mall podium, the tapering base with its
 * ruyi coins, eight flared eight-storey segments (the stacked pagoda / bamboo sections) each lit
 * gold along its eaves, the smaller crown storeys and the spire with its beacon. Dark green glass
 * with lit windows; it stands well outside the map and blocks nothing.
 */
function taipei101(group: THREE.Group, cx: number, cz: number) {
  const plan = steppedSquare(1, 0.16);
  const glass: THREE.BufferGeometry[] = [], gold: THREE.BufferGeometry[] = [], stone: THREE.BufferGeometry[] = [];
  const sink = -0.3;
  // Podium mall (six storeys) to the north of the tower, and its plaza block.
  stone.push(paint(facadeBox(cx - 55, cz - 75, cx + 55, cz - 22, sink, 60, 0x9aa6a0), 0x9aa6a0));
  // Base of the tower: a frustum from 30 m to 24 m half-width over the first 26 storeys.
  glass.push(frustum(plan, sink, 100, 30, 24, cx, cz));
  gold.push(band(plan, 100, 1.6, 24, 0.5, cx, cz));
  // Ruyi coins on the four faces above the base.
  for (const [dx, dz, ry] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]] as const) {
    const coin = new THREE.TorusGeometry(5.5, 1.1, 6, 20).rotateY(ry).translate(cx + dx * 24.6, 92, cz + dz * 24.6);
    gold.push(coin.toNonIndexed());
  }
  // Eight segments of eight storeys (33.6 m), each flaring from 21 m to 26 m half-width.
  const SEG = 33.6;
  for (let k = 0; k < 8; k++) {
    const y0 = 101.6 + k * SEG, y1 = y0 + SEG;
    glass.push(frustum(plan, y0, y1 - 1.4, 20.5, 25.5, cx, cz));
    gold.push(band(plan, y1 - 1.4, 1.4, 25.5, 0.6, cx, cz));
    // Vertical LED lines down the stepped corners.
    for (let i = 1; i < plan.length; i += 3) {
      const [px, pz] = plan[i];
      gold.push(new THREE.CylinderGeometry(0.35, 0.35, SEG - 2, 4).translate(cx + px * 23.2, (y0 + y1) / 2 - 0.7, cz + pz * 23.2).toNonIndexed());
    }
  }
  const top = 101.6 + 8 * SEG;
  // Crown storeys: three steps inward, lit gold.
  let y = top;
  for (const [h, s0, s1] of [[9, 15, 16.5], [8, 12, 13], [7, 9, 9.5], [5, 6, 6]] as const) {
    glass.push(frustum(plan, y, y + h - 1, s0, s1, cx, cz, true));
    gold.push(band(plan, y + h - 1, 1, s1, 0.4, cx, cz));
    y += h;
  }
  // The spire to 508 m.
  stone.push(paint(new THREE.CylinderGeometry(0.6, 2.4, 508 - y, 8).translate(cx, y + (508 - y) / 2, cz).toNonIndexed(), 0xb8bcc0));
  const glassMat = farHaze(new THREE.MeshStandardMaterial({ color: 0x3f6a6a, map: windowsTexture(false), emissiveMap: windowsTexture(true), emissive: 0xfff0d0, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.55 }), 0.00032);
  const goldMat = farHaze(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc45a).multiplyScalar(1.7), toneMapped: false }), 0.00032);
  for (const g of stone) if (g.getAttribute('uv')) g.deleteAttribute('uv');
  const tower = new THREE.Mesh(mergeGeometries(glass, false)!, glassMat); tower.name = 'skyline:taipei101';
  for (const g of gold) { if (g.getAttribute('uv')) g.deleteAttribute('uv'); if (g.getAttribute('normal')) g.deleteAttribute('normal'); }
  const lights = new THREE.Mesh(mergeGeometries(gold, false)!, goldMat); lights.name = 'skyline:taipei101-lights';
  const spire = new THREE.Mesh(mergeGeometries(stone, false)!, farHaze(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }), 0.00032));
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6).translate(cx, 509, cz), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a1a).multiplyScalar(3), toneMapped: false, fog: false }));
  group.add(tower, lights, spire, beacon);
}

// ---- Presidential Office and North Gate ----------------------------------------------------

/**
 * The Presidential Office (總統府): a red-brick block banded in white stone around courtyards, its
 * central tower rising on the east front to about 60 m.
 */
function presidentialOffice(out: THREE.BufferGeometry[], glow: THREE.BufferGeometry[], cx: number, cz: number, w: number, d: number) {
  const brick = 0xa8503c, white = 0xeee8dc;
  const add = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, hex: number) => out.push(paint(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).toNonIndexed(), hex));
  const hw = w * 0.42, hd = d * 0.42;
  // Wings around two courtyards (an 日 plan), 5 storeys.
  add(cx - hw, cz - hd, cx + hw, cz - hd + 12, -0.3, 22, brick);
  add(cx - hw, cz + hd - 12, cx + hw, cz + hd, -0.3, 22, brick);
  add(cx - hw, cz - hd, cx - hw + 12, cz + hd, -0.3, 22, brick);
  add(cx + hw - 14, cz - hd, cx + hw, cz + hd, -0.3, 22, brick);
  add(cx - hw, cz - 6, cx + hw, cz + 6, -0.3, 22, brick);
  for (const y of [6, 13, 21]) for (const [x0, z0, x1, z1] of [[cx - hw, cz - hd, cx + hw, cz + hd]]) {
    add(x0 - 0.3, z0 - 0.3, x1 + 0.3, z0 + 0.3, y, y + 1, white); add(x0 - 0.3, z1 - 0.3, x1 + 0.3, z1 + 0.3, y, y + 1, white);
    add(x0 - 0.3, z0 - 0.3, x0 + 0.3, z1 + 0.3, y, y + 1, white); add(x1 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3, y, y + 1, white);
  }
  // Central tower on the east front.
  const tx = cx + hw - 7;
  add(tx - 8, cz - 8, tx + 8, cz + 8, -0.3, 40, brick);
  for (const y of [22, 30, 39]) add(tx - 8.4, cz - 8.4, tx + 8.4, cz + 8.4, y, y + 1.2, white);
  add(tx - 6, cz - 6, tx + 6, cz + 6, 40, 52, brick);
  add(tx - 6.4, cz - 6.4, tx + 6.4, cz + 6.4, 51, 52.6, white);
  out.push(paint(new THREE.ConeGeometry(5.5, 8, 4).rotateY(Math.PI / 4).translate(tx, 56.6, cz).toNonIndexed(), 0x6a7064));
  glow.push(paint(new THREE.BoxGeometry(0.4, 1.2, 4).translate(tx + 6.05, 46, cz).toNonIndexed(), 0xffe0a0));
  for (const g of [...out, ...glow]) if (g.getAttribute('uv')) g.deleteAttribute('uv');
}

/** The North Gate (北門, 承恩門): a stone gatehouse with its arch and a hipped, two-tier tile roof. */
function northGate(out: THREE.BufferGeometry[], cx: number, cz: number) {
  const stone = 0x9a9488, wall = 0xd8cfc0, roof = 0x3f3a34;
  const add = (g: THREE.BufferGeometry, hex: number) => { const n = g.toNonIndexed(); if (n.getAttribute('uv')) n.deleteAttribute('uv'); out.push(paint(n, hex)); };
  add(new THREE.BoxGeometry(18, 7.5, 12).translate(cx, 3.45, cz), stone);
  add(new THREE.BoxGeometry(4.4, 4.6, 12.2).translate(cx, 2.0, cz), 0x26221e);
  add(new THREE.BoxGeometry(12, 4.5, 7.5).translate(cx, 9.45, cz), wall);
  add(new THREE.ConeGeometry(10, 3.2, 4).rotateY(Math.PI / 4).scale(1, 1, 0.68).translate(cx, 13.3, cz), roof);
  add(new THREE.ConeGeometry(12.5, 1.6, 4).rotateY(Math.PI / 4).scale(1, 1, 0.72).translate(cx, 8.3, cz), roof);
}
