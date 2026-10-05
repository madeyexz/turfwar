import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Decor } from '../../shared/maps/types';
import { rng } from '../../shared/math';
import { buildSkyline, type SkylineData } from './skyline';

/**
 * Dressing sets (street furniture and skylines) and model instances. A set is plain data the
 * renderer imports on demand, so neither the server nor the other maps carry it:
 *   primitives  painted boxes and cylinders (one draw), lit boxes (one draw), sign plates on a
 *               canvas atlas (one draw) and ground paint (one draw);
 *   models      instanced meshes per model, from public/assets/taipei-props.json (the source game's
 *               own scooter, YouBike, tree, plant and signal-head meshes) or built here (cars);
 *   skyline     the city, landmarks and hills past the map (./skyline.ts).
 */
export interface StreetData {
  boxes: number[]; glows: number[]; cyls: number[];
  plates: [number, number, number, number, number, number, string][];
  marks: number[];
  models: Record<string, number[]>;
}
/** A district mesh from the source game (GLB in source coordinates) and the atlas it maps. */
interface DistrictData { mesh: string; atlas: string }
interface DressingSet { street?: StreetData; skyline?: SkylineData; district?: DistrictData }

const SETS: Record<string, () => Promise<DressingSet>> = {
  taipei: async () => {
    const [s, k] = await Promise.all([import('../../shared/maps/taipei-street'), import('../../shared/maps/taipei-skyline')]);
    return {
      street: { boxes: s.STREET_BOXES, glows: s.STREET_GLOWS, cyls: s.STREET_CYLS, plates: s.STREET_PLATES, marks: s.STREET_MARKS, models: s.STREET_MODELS },
      skyline: { buildings: k.FAR_BUILDINGS, landmarks: k.FAR_LANDMARKS, hills: k.FAR_HILLS, roads: k.FAR_ROADS, ground: k.FAR_GROUND, heights: k.FAR_HEIGHTS },
      district: { mesh: 'taipei-district.glb', atlas: 'taipei-atlas.webp' },
    };
  },
};

type Dressing = Extract<Decor, { kind: 'dressing' }>;
type Instances = Extract<Decor, { kind: 'instances' }>;
const STRIDE = 8;

/** Build every dressing set and model instance of a map into `group` (asynchronously: sets and meshes load on demand). */
export async function addDressing(group: THREE.Group, decor: Decor[]) {
  const sets = decor.filter((d): d is Dressing => d.kind === 'dressing');
  const instances = decor.filter((d): d is Instances => d.kind === 'instances');
  if (!sets.length && !instances.length) return;
  const models = await loadModels();
  for (const d of sets) {
    const set = await SETS[d.set]?.();
    if (!set) { console.warn('unknown dressing set', d.set); continue; }
    const cut = cutTest(d.cut ?? []);
    if (set.district) group.add(await districtGroup(set.district, d.x, d.z, cut));
    if (set.street) group.add(streetGroup(cutStreet(set.street, d.x, d.z, cut), d.x, d.z, models));
    if (set.skyline) group.add(buildSkyline(set.skyline, d.x, d.z));
  }
  const byModel = new Map<string, number[]>();
  for (const d of instances) byModel.set(d.model, [...(byModel.get(d.model) ?? []), ...d.data]);
  for (const [model, data] of byModel) for (const m of instanced(model, data, 0, 0, models)) group.add(m);
}

/** Point test against cut boxes (minX, minY, minZ, maxX, maxY, maxZ, map coordinates). */
type Cut = (x: number, y: number, z: number) => boolean;
function cutTest(c: number[]): Cut {
  return (x, y, z) => {
    for (let i = 0; i < c.length; i += 6) if (x > c[i] && x < c[i + 3] && y > c[i + 1] && y < c[i + 4] && z > c[i + 2] && z < c[i + 5]) return true;
    return false;
  };
}

/** The street set without what stands in the cut boxes. */
function cutStreet(s: StreetData, ox: number, oz: number, cut: Cut): StreetData {
  const keep = (list: number[], stride: number, at: (r: number[]) => [number, number, number]) => {
    const out: number[] = [];
    for (let i = 0; i < list.length; i += stride) { const r = list.slice(i, i + stride), [x, y, z] = at(r); if (!cut(x - ox, y, z - oz)) out.push(...r); }
    return out;
  };
  const p3 = (r: number[]): [number, number, number] => [r[0], r[1] + 0.1, r[2]];
  return {
    boxes: keep(s.boxes, 8, p3), glows: keep(s.glows, 8, p3),
    cyls: keep(s.cyls, 8, r => [(r[0] + r[3]) / 2, Math.min(r[1], r[4]) + 0.1, (r[2] + r[5]) / 2]),
    plates: s.plates.filter(p => !cut(p[0] - ox, p[1], p[2] - oz)),
    marks: keep(s.marks, 9, r => [r[0], r[1] + 0.05, r[2]]),
    models: Object.fromEntries(Object.entries(s.models).map(([k, v]) => [k, keep(v, STRIDE, p3)])),
  };
}

// ---- District -----------------------------------------------------------------------------

/**
 * The source's own district meshes over its own atlas. Its light flags (_fx: amount, mode, the
 * atlas offset of a night version, extra) light windows, neon and screens: the night version (or
 * the texel itself) is added as emission. The light pools (L) are additive glows on the ground.
 */
async function districtGroup(d: DistrictData, ox: number, oz: number, cut: Cut) {
  const base = import.meta.env.BASE_URL + 'assets/';
  const [gltf, atlas] = await Promise.all([
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(base + d.mesh),
    new THREE.TextureLoader().loadAsync(base + d.atlas),
  ]);
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 8;
  const solid = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.8, metalness: 0.05 });
  solid.onBeforeCompile = s => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 _fx;\nvarying vec4 vFx;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFx = _fx;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vFx;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vFx.x > 0.0) totalEmissiveRadiance += texture2D(map, vMapUv + vec2(vFx.z, 0.0)).rgb * vColor.rgb * min(vFx.x, 2.0) * 0.9;`);
  };
  solid.customProgramCacheKey = () => 'taipei-district';
  const glow = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const group = new THREE.Group();
  group.name = 'dressing:district';
  gltf.scene.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pools = mesh.parent?.name === 'L' || mesh.name === 'L';
    mesh.material = pools ? glow : solid;
    dropCut(mesh.geometry, ox, oz, cut);
    mesh.castShadow = !pools; mesh.receiveShadow = !pools;
    mesh.name = `district:${mesh.name}`;
  });
  gltf.scene.position.set(-ox, 0, -oz);
  group.add(gltf.scene);
  return group;
}

/** Drop the triangles whose centre lies in a cut box. */
function dropCut(g: THREE.BufferGeometry, ox: number, oz: number, cut: Cut) {
  const index = g.getIndex(), p = g.getAttribute('position');
  if (!index) return;
  const kept: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    const x = (p.getX(a) + p.getX(b) + p.getX(c)) / 3 - ox, y = (p.getY(a) + p.getY(b) + p.getY(c)) / 3, z = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3 - oz;
    if (!cut(x, y, z)) kept.push(a, b, c);
  }
  if (kept.length < index.count) g.setIndex(kept);
}

// ---- Primitives ----------------------------------------------------------------------------

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed();
const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 7, 1).translate(0, 0.5, 0).toNonIndexed();
const UP = new THREE.Vector3(0, 1, 0);

function colored(g: THREE.BufferGeometry, hex: number, k = 1) {
  const c = new THREE.Color(hex).multiplyScalar(k), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Oriented boxes (x, y bottom, z, w, h, d, heading, colour) and cylinders (x0, y0, z0, x1, y1, z1, r, colour) as one geometry. */
function primitives(boxes: number[], cyls: number[], ox: number, oz: number, k = 1) {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < boxes.length; i += 8) {
    const [x, y, z, w, h, d, heading, color] = boxes.slice(i, i + 8);
    m.compose(p.set(x - ox, y, z - oz), q.setFromEuler(e.set(0, -heading, 0)), s.set(w, h, d));
    parts.push(colored(UNIT_BOX.clone().applyMatrix4(m), color, k));
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < cyls.length; i += 8) {
    const [x0, y0, z0, x1, y1, z1, r, color] = cyls.slice(i, i + 8);
    a.set(x0 - ox, y0, z0 - oz); b.set(x1 - ox, y1, z1 - oz);
    const dir = b.clone().sub(a), len = dir.length();
    if (len < 1e-3) continue;
    m.compose(a, q.setFromUnitVectors(UP, dir.divideScalar(len)), s.set(r, len, r));
    parts.push(colored(UNIT_CYL.clone().applyMatrix4(m), color, k));
  }
  for (const g of parts) g.deleteAttribute('uv');
  return parts.length ? mergeGeometries(parts, false) : null;
}

let propMaterial: THREE.MeshStandardMaterial | undefined;
const propMat = () => (propMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 }));
let lampMaterial: THREE.MeshBasicMaterial | undefined;
/** Lamp heads and LEDs: unlit colour pushed past 1 so the bloom picks them up. */
const lampMat = () => (lampMaterial ??= new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));

function streetGroup(s: StreetData, ox: number, oz: number, models: Models | null) {
  const group = new THREE.Group();
  group.name = 'dressing:street';
  const body = primitives(s.boxes, s.cyls, ox, oz);
  if (body) {
    const mesh = new THREE.Mesh(body, propMat());
    mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'street:props';
    group.add(mesh);
  }
  const glow = primitives(s.glows, [], ox, oz, 1.6);
  if (glow) { const mesh = new THREE.Mesh(glow, lampMat()); mesh.name = 'street:lamps'; group.add(mesh); }
  if (s.plates.length) group.add(plateMesh(s.plates, ox, oz));
  if (s.marks.length) group.add(markMesh(s.marks, ox, oz));
  for (const [model, data] of Object.entries(s.models)) for (const m of instanced(model, data, ox, oz, models)) group.add(m);
  return group;
}

/** Ground paint: tree-pit grates, manhole covers, bay lines and road-works patches. */
function markMesh(marks: number[], ox: number, oz: number) {
  const pos: number[] = [], col: number[] = [], c = new THREE.Color();
  for (let i = 0; i < marks.length; i += 9) {
    const [x, y, z, dx, dz, ha, hb, kind, color] = marks.slice(i, i + 9);
    c.setHex(kind === 1 ? 0x3c3a36 : kind === 2 ? 0x55585a : color);
    const rx = -dz, rz = dx, cx = x - ox, cz = z - oz, yy = y + 0.006;
    const corner = (sa: number, sb: number) => { pos.push(cx + dx * ha * sa + rx * hb * sb, yy, cz + dz * ha * sa + rz * hb * sb); col.push(c.r, c.g, c.b); };
    corner(-1, -1); corner(1, 1); corner(1, -1); corner(-1, -1); corner(-1, 1); corner(1, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // Wind each quad upward whatever its direction.
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i + 1) - p.getX(i), az = p.getZ(i + 1) - p.getZ(i), bx = p.getX(i + 2) - p.getX(i), bz = p.getZ(i + 2) - p.getZ(i);
    if (az * bx - ax * bz < 0) { const t = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)]; p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, t[0], t[1], t[2]); }
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  mesh.receiveShadow = true; mesh.name = 'street:marks';
  return mesh;
}

// ---- Sign plates ---------------------------------------------------------------------------

const PLATE_FONT = `'PingFang TC','Noto Sans TC','Microsoft JhengHei','Heiti TC',sans-serif`;

/** Sign art drawn into a cell: traffic signs, banners, bus and YouBike boards, street-name plates, ads. */
function drawPlate(c: CanvasRenderingContext2D, key: string, x: number, y: number, w: number, h: number) {
  c.save(); c.translate(x, y); c.beginPath(); c.rect(0, 0, w, h); c.clip();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const text = (t: string, tx: number, ty: number, size: number, color: string, maxW = w * 0.9) => {
    c.fillStyle = color; c.font = `900 ${size}px ${PLATE_FONT}`;
    const m = c.measureText(t).width;
    if (m > maxW) c.font = `900 ${Math.floor(size * maxW / m)}px ${PLATE_FONT}`;
    c.fillText(t, tx, ty);
  };
  const disc = (fill: string, ring: string) => {
    c.fillStyle = '#d8d8d8'; c.fillRect(0, 0, w, h);
    c.beginPath(); c.arc(w / 2, h / 2, w * 0.47, 0, Math.PI * 2); c.fillStyle = ring; c.fill();
    c.beginPath(); c.arc(w / 2, h / 2, w * 0.37, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
  };
  if (key.startsWith('street:')) {
    const [zh, sec, en] = key.slice(7).split('|');
    c.fillStyle = '#1b5aa6'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#ffffff'; c.lineWidth = 3; c.strokeRect(4, 4, w - 8, h - 8);
    text(zh + (sec ? ` ${sec}` : ''), w / 2, h * 0.38, h * 0.42, '#ffffff');
    text(en, w / 2, h * 0.76, h * 0.22, '#ffffff');
  } else if (key === 'noStopping' || key === 'noParking') {
    disc('#1f57b8', '#d81e1e');
    c.strokeStyle = '#d81e1e'; c.lineWidth = w * 0.09;
    c.beginPath(); c.moveTo(w * 0.24, h * 0.24); c.lineTo(w * 0.76, h * 0.76);
    if (key === 'noStopping') { c.moveTo(w * 0.76, h * 0.24); c.lineTo(w * 0.24, h * 0.76); }
    c.stroke();
  } else if (key.startsWith('speed')) {
    disc('#ffffff', '#d81e1e');
    text(key.slice(5), w / 2, h * 0.53, h * 0.42, '#111111');
  } else if (key.startsWith('banner')) {
    const a = key === 'bannerA';
    c.fillStyle = a ? '#c8141e' : '#1d6fb8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffd24a'; c.fillRect(0, 0, w, h * 0.05); c.fillRect(0, h * 0.95, w, h * 0.05);
    const chars = [...(a ? '西門町' : '徒步區')];
    chars.forEach((ch, i) => text(ch, w / 2, h * (0.2 + i * 0.22), w * 0.62, '#ffffff'));
    text(a ? 'XIMENDING' : 'WALK', w / 2, h * 0.88, w * 0.16, '#ffd24a');
  } else if (key === 'busBoard') {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1f4fa0'; c.fillRect(0, 0, w, h * 0.22);
    text('公車站', w / 2, h * 0.11, h * 0.14, '#ffffff');
    ['234', '218', '307', '651', '綠1'].forEach((n, i) => { c.fillStyle = i % 2 ? '#e8eef8' : '#ffffff'; c.fillRect(0, h * (0.26 + i * 0.14), w, h * 0.13); text(n, w / 2, h * (0.325 + i * 0.14), h * 0.1, '#1f4fa0'); });
  } else if (key.startsWith('ledBoard')) {
    c.fillStyle = '#0c0c0c'; c.fillRect(0, 0, w, h);
    text(key === 'ledBoardA' ? '234 即將進站' : '307 約 3 分', w / 2, h / 2, h * 0.55, '#ff8a1a');
  } else if (key === 'gogo') {
    c.fillStyle = '#1a1a1a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#58d68d'; c.fillRect(0, h * 0.78, w, h * 0.06);
    text('GoStation', w / 2, h * 0.4, h * 0.22, '#58d68d');
  } else if (key === 'bikeLogo' || key === 'bikeKiosk') {
    c.fillStyle = key === 'bikeLogo' ? '#ffb000' : '#f4f4f4'; c.fillRect(0, 0, w, h);
    text('YouBike', w / 2, h * 0.42, h * 0.2, key === 'bikeLogo' ? '#ffffff' : '#ff8a00');
    text('微笑單車 2.0', w / 2, h * 0.68, h * 0.12, key === 'bikeLogo' ? '#ffffff' : '#555555');
  } else if (key.startsWith('ad')) {
    const n = Number(key.slice(2)) || 0;
    const looks: [string, string, string, string][] = [
      ['#e94b77', '#ffffff', '珍珠奶茶', 'BUBBLE TEA'], ['#1d9bd1', '#ffffff', '夏日特賣', 'SUMMER SALE'], ['#ffcc00', '#c8141e', '臺北國際電玩展', 'GAME SHOW'],
      ['#2c2c54', '#ffd24a', '西門町音樂祭', 'LIVE'], ['#3fae49', '#ffffff', '悠遊卡', 'EASYCARD'], ['#7a3fb0', '#ffffff', '新片上映', 'NOW SHOWING'],
    ];
    const [bg, fg, a, b] = looks[n % looks.length];
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, bg); g.addColorStop(1, '#111111');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    text(a, w / 2, h * 0.36, w * 0.17, fg); text(b, w / 2, h * 0.56, w * 0.1, fg);
  } else {
    c.fillStyle = '#c8c8c8'; c.fillRect(0, 0, w, h);
  }
  c.restore();
}

function plateMesh(plates: StreetData['plates'], ox: number, oz: number) {
  const keys = [...new Set(plates.map(p => p[6]))];
  const CELL_W = 256, CELL_H = 128, cols = 8, rows = Math.ceil(keys.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * cols; canvas.height = THREE.MathUtils.ceilPowerOfTwo(CELL_H * rows);
  const c = canvas.getContext('2d')!;
  // Tall art (banners, boards) is drawn into the cell at its own aspect, centred.
  const cell = new Map<string, [number, number, number, number]>();
  keys.forEach((key, i) => {
    const sample = plates.find(p => p[6] === key)!, aspect = sample[3] / sample[4];
    const w = aspect >= CELL_W / CELL_H ? CELL_W : Math.round(CELL_H * aspect), h = aspect >= CELL_W / CELL_H ? Math.round(CELL_W / aspect) : CELL_H;
    const x = (i % cols) * CELL_W + (CELL_W - w) / 2, y = Math.floor(i / cols) * CELL_H + (CELL_H - h) / 2;
    drawPlate(c, key, x, y, w, h);
    cell.set(key, [x / canvas.width, 1 - (y + h) / canvas.height, (x + w) / canvas.width, 1 - y / canvas.height]);
  });
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (const [x, y, z, w, h, heading, key] of plates) {
    const [u0, v0, u1, v1] = cell.get(key)!;
    // Local +z face and its mirror, each reading left to right from its own side.
    for (const side of [1, -1]) {
      const nx = Math.sin(-heading) * side, nz = Math.cos(-heading) * side, rx = Math.cos(-heading) * side, rz = -Math.sin(-heading) * side;
      const cx = x - ox + nx * 0.004, cz = z - oz + nz * 0.004;
      const corner = (sx: number, sy: number) => { pos.push(cx + rx * w / 2 * sx, y + h / 2 * sy, cz + rz * w / 2 * sx); nor.push(nx, 0, nz); uv.push(sx < 0 ? u0 : u1, sy < 0 ? v0 : v1); };
      corner(-1, -1); corner(1, -1); corner(1, 1); corner(-1, -1); corner(1, 1); corner(-1, 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.5 }));
  mesh.name = 'street:plates';
  return mesh;
}

// ---- Models --------------------------------------------------------------------------------

interface ModelData { position: number[]; normal?: number[]; uv?: number[]; color?: number[]; tag?: number[]; top?: number[] }
type Models = Record<string, ModelData>;
let modelsPromise: Promise<Models | null> | undefined;
function loadModels() {
  return modelsPromise ??= fetch(import.meta.env.BASE_URL + 'assets/taipei-props.json')
    .then(r => r.json()).then(j => j.models as Models)
    .catch(e => { console.warn('prop models unavailable', e); return null; });
}

/** A model's geometry, optionally keeping only the triangles whose first vertex passes `keep`. */
function modelGeometry(d: ModelData, keep?: (vertex: number) => boolean) {
  const g = new THREE.BufferGeometry(), n = d.position.length / 3, idx: number[] = [];
  for (let i = 0; i < n; i += 3) if (!keep || keep(i)) idx.push(i, i + 1, i + 2);
  const take = (a: number[] | undefined, size: number) => a && new THREE.Float32BufferAttribute(idx.flatMap(i => a.slice(i * size, i * size + size)), size);
  g.setAttribute('position', take(d.position, 3)!);
  if (d.normal) g.setAttribute('normal', take(d.normal, 3)!); else g.computeVertexNormals();
  if (d.uv) g.setAttribute('uv', take(d.uv, 2)!);
  if (d.color) g.setAttribute('color', take(d.color, 3)!);
  if (d.top) g.setAttribute('aTop', take(d.top, 1)!);
  return g;
}

/** Instance transform as the source places its props (rotation.y = -heading, roll about z). */
function place(mesh: THREE.InstancedMesh, i: number, row: number[], ox: number, oz: number, sy = 1) {
  const [x, y, z, heading, scale, roll] = row;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x - ox, y, z - oz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -heading, roll, 'YXZ')), new THREE.Vector3(scale, scale * sy, scale));
  mesh.setMatrixAt(i, m);
}

function rows(data: number[]) { const r: number[][] = []; for (let i = 0; i < data.length; i += STRIDE) r.push(data.slice(i, i + STRIDE)); return r; }

function instancedMesh(geometry: THREE.BufferGeometry, material: THREE.Material, list: number[][], ox: number, oz: number, opts: { color?: (row: number[]) => number; shadow?: boolean; sy?: (row: number[]) => number; name: string }) {
  const mesh = new THREE.InstancedMesh(geometry, material, list.length);
  const c = new THREE.Color();
  list.forEach((row, i) => {
    place(mesh, i, row, ox, oz, opts.sy?.(row) ?? 1);
    if (opts.color) mesh.setColorAt(i, c.setHex(opts.color(row)));
  });
  mesh.castShadow = opts.shadow ?? true; mesh.receiveShadow = true; mesh.name = opts.name;
  mesh.computeBoundingSphere();
  return mesh;
}

function instanced(model: string, data: number[], ox: number, oz: number, models: Models | null): THREE.Object3D[] {
  const list = rows(data);
  if (!list.length) return [];
  if (model === 'car' || model === 'taxi') return [instancedMesh(carGeometry(model === 'taxi'), propMat(), list, ox, oz, { color: r => r[6], name: `model:${model}` })];
  const d = models?.[model];
  if (!d) return [];
  if (model === 'scooter') return scooters(d, list, ox, oz);
  if (model.startsWith('signal')) return signals(d, list, ox, oz, model === 'signal:ped');
  if (model.startsWith('tree') || model.startsWith('plant')) {
    // The source varies each tree's height a little by its position.
    const sy = (r: number[]) => model.startsWith('tree') ? 0.92 + ((((r[0] * 7.13 + r[2] * 3.7) % 1) + 1) % 1) * 0.16 : 1;
    const mesh = instancedMesh(modelGeometry(d), foliageMat(), list, ox + 0, oz, { color: r => r[6], sy, name: `model:${model}` });
    const bloom = new Float32Array(list.length * 4);
    list.forEach((r, i) => { const v = r[7] >>> 0; bloom.set([((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, (v >>> 24) / 255], i * 4); });
    mesh.geometry.setAttribute('aBloom', new THREE.InstancedBufferAttribute(bloom, 4));
    return [mesh];
  }
  return [instancedMesh(modelGeometry(d), propMat(), list, ox, oz, { color: r => r[6], name: `model:${model}` })];
}

/**
 * Parked scooters: the paint tints the body; a seeded roll (the source's own hash) gives about a
 * third a top box and some a pink or green delivery box.
 */
function scooters(d: ModelData, list: number[][], ox: number, oz: number) {
  const tag = (v: number) => d.tag ? d.tag[v * 3] : 0;
  const roll = (r: number[]) => { const v = Math.sin(r[7] * 91.7 + 1.3) * 43758.5453123; return v - Math.floor(v); };
  const out: THREE.Object3D[] = [instancedMesh(modelGeometry(d, v => tag(v) === 0), propMat(), list, ox, oz, { color: r => r[6], name: 'model:scooter' })];
  const top = list.filter(r => roll(r) < 0.3), box = list.filter(r => roll(r) >= 0.3 && roll(r) < 0.45);
  if (top.length) out.push(instancedMesh(modelGeometry(d, v => tag(v) === 1), propMat(), top, ox, oz, { name: 'model:scooter-topbox' }));
  if (box.length) out.push(instancedMesh(modelGeometry(d, v => tag(v) === 2), propMat(), box, ox, oz, { color: r => (roll(r) >= 0.4 ? 0x07150a : 0xffffff), name: 'model:scooter-box' }));
  return out;
}

let lampDisc: THREE.Texture | undefined;
/** Signal lamp faces: a disc (left half) for the round lamps, a solid panel (right half) for countdown and walk lights. */
function lampTexture() {
  if (lampDisc) return lampDisc;
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#fff'; c.beginPath(); c.arc(32, 32, 28, 0, Math.PI * 2); c.fill();
  c.fillRect(66, 4, 58, 56);
  lampDisc = new THREE.CanvasTexture(canvas);
  return lampDisc;
}

/**
 * Signal heads in two phases (the extra column): heads on one road axis show green and the other
 * red, and the walk lights the opposite, as at a real junction.
 */
function signals(d: ModelData, list: number[][], ox: number, oz: number, ped: boolean) {
  const lamp = (v: number) => (d.tag ? d.tag[v * 3 + 2] : 0);
  const housing = modelGeometry(d, v => lamp(v) === 0);
  const out: THREE.Object3D[] = [instancedMesh(housing, propMat(), list, ox, oz, { name: 'model:signal' })];
  for (const phase of [0, 1]) {
    const group = list.filter(r => r[7] === phase);
    if (!group.length) continue;
    const g = modelGeometry(d, v => lamp(v) > 0), n = g.getAttribute('position').count, col = new Float32Array(n * 3), uv = g.getAttribute('uv') as THREE.BufferAttribute;
    // Lamp numbers per vertex (the kept triangles are the lamps only).
    const kept: number[] = [];
    for (let i = 0; i < d.position.length / 3; i += 3) if (lamp(i) > 0) kept.push(lamp(i), lamp(i), lamp(i));
    for (let i = 0; i < n; i++) {
      const L = kept[i], round = L <= 4;
      const lit = ped ? (phase ? L === 7 : L === 6) : (phase ? L === 3 : L === 1);
      const base = L === 1 || L === 6 ? [1, 0.03, 0.01] : L === 2 ? [1, 0.36, 0] : L === 5 ? [1, 0.4, 0.05] : [0, 0.85, 0.42];
      const k = lit ? 3.2 : 0.05;
      col.set(base.map(v => v * k), i * 3);
      uv.setX(i, (round ? 0 : 0.5) + uv.getX(i) * 0.5);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.push(instancedMesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, map: lampTexture(), alphaTest: 0.5, toneMapped: false }), group, ox, oz, { shadow: false, name: 'model:signal-lamps' }));
  }
  return out;
}

let foliage: THREE.MeshStandardMaterial | undefined;
/**
 * Leaf cards over the source's leaf texture (its leaf-cluster atlas, redrawn here), tinted per
 * tree, with the blossom of rain trees laid over the crown tops.
 */
function foliageMat() {
  if (foliage) return foliage;
  foliage = new THREE.MeshStandardMaterial({ vertexColors: true, map: leafTexture(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85 });
  foliage.onBeforeCompile = s => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTop;\nattribute vec4 aBloom;\nvarying vec4 vBloom;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvBloom = vec4(aBloom.rgb, aBloom.a * aTop);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vBloom;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vBloom.rgb * 0.75, clamp(vBloom.a, 0.0, 0.85));');
  };
  foliage.customProgramCacheKey = () => 'dressing-foliage';
  return foliage;
}

/** The source's leaf atlas: a white corner for trunks and branches, and a disc of leaves with transparent gaps. */
function leafTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d')!, r = rng(7855);
  c.clearRect(0, 0, 256, 256);
  c.fillStyle = '#fff'; c.fillRect(0, 0, 32, 32);
  for (let layer = 0; layer < 3; layer++) {
    const count = layer === 0 ? 170 : layer === 1 ? 260 : 150, reach = layer === 0 ? 70 : layer === 1 ? 98 : 108;
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * reach, x = 134 + Math.cos(a) * d, y = 134 + Math.sin(a) * d * 0.92;
      if (x < 40 && y < 40) continue;
      const len = 11 + r() * 8, wid = len * (0.38 + r() * 0.12);
      const light = (1 - (y - 20) / 256) * 0.5 + (1 - (x - 20) / 256) * 0.25;
      const k = (layer === 0 ? 0.55 : layer === 1 ? 0.8 : 1) * (0.75 + light * 0.5) * (0.85 + r() * 0.27), jitter = r() * 20 - 10;
      c.save(); c.translate(x, y); c.rotate(r() * Math.PI * 2);
      c.fillStyle = `rgb(${Math.round((112 + jitter) * k)},${Math.round((166 + jitter * 0.5) * k)},${Math.round((70 - jitter * 0.3) * k)})`;
      c.beginPath(); c.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = `rgba(255,255,230,${0.12 + light * 0.1})`; c.lineWidth = 1;
      c.beginPath(); c.moveTo(-len * 0.4, 0); c.lineTo(len * 0.4, 0); c.stroke();
      c.restore();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// ---- Cars ----------------------------------------------------------------------------------

const carCache = new Map<boolean, THREE.BufferGeometry>();
/**
 * A parked sedan facing +z (local), 1.8 × 1.45 × 4.5 m: white body panels take the instance
 * colour; glass, tyres, bumpers and lights keep theirs. Taxis add the roof sign.
 */
function carGeometry(taxi: boolean) {
  const cached = carCache.get(taxi);
  if (cached) return cached;
  const parts: THREE.BufferGeometry[] = [];
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, bevel = 0) => {
    const g = (bevel ? new THREE.BoxGeometry(w, h, d, 1, 1, 1) : new THREE.BoxGeometry(w, h, d)).toNonIndexed();
    g.translate(x, y + h / 2, z); g.deleteAttribute('uv');
    parts.push(colored(g, color));
  };
  const body = 0xffffff, glass = 0x1d2630, dark = 0x1a1a1c, trim = 0x9a9a9a;
  add(1.78, 0.62, 4.45, 0, 0.28, 0, body);                   // lower body
  add(1.8, 0.16, 4.5, 0, 0.26, 0, dark);                     // bumper line
  add(1.58, 0.5, 2.25, 0, 0.9, -0.2, glass);                 // glasshouse
  add(1.5, 0.08, 2.05, 0, 1.4, -0.25, body);                 // roof
  add(0.08, 0.46, 0.08, 0.76, 0.9, 0.85, body); add(0.08, 0.46, 0.08, -0.76, 0.9, 0.85, body);    // A-pillars
  add(0.08, 0.46, 0.08, 0.76, 0.9, -1.25, body); add(0.08, 0.46, 0.08, -0.76, 0.9, -1.25, body);  // C-pillars
  for (const [x, z] of [[0.8, 1.38], [-0.8, 1.38], [0.8, -1.4], [-0.8, -1.4]]) {
    const w = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12).rotateZ(Math.PI / 2).translate(x, 0.33, z).toNonIndexed();
    w.deleteAttribute('uv'); parts.push(colored(w, dark));
    const hub = new THREE.CylinderGeometry(0.18, 0.18, 0.25, 8).rotateZ(Math.PI / 2).translate(x, 0.33, z).toNonIndexed();
    hub.deleteAttribute('uv'); parts.push(colored(hub, trim));
  }
  add(0.36, 0.12, 0.04, 0.6, 0.66, 2.23, 0xfff4d8); add(0.36, 0.12, 0.04, -0.6, 0.66, 2.23, 0xfff4d8);   // headlights
  add(0.4, 0.12, 0.04, 0.6, 0.68, -2.24, 0xb01010); add(0.4, 0.12, 0.04, -0.6, 0.68, -2.24, 0xb01010);  // tail lights
  add(0.5, 0.12, 0.03, 0, 0.42, 2.25, 0xf2f2f2); add(0.5, 0.12, 0.03, 0, 0.42, -2.26, 0xf2f2f2);        // plates
  if (taxi) {
    add(0.62, 0.2, 0.28, 0, 1.48, -0.2, 0xffffff);
    add(0.64, 0.06, 0.3, 0, 1.68, -0.2, 0x1c1c1c);
    add(1.79, 0.08, 4.46, 0, 0.62, 0, 0x202020);            // the checker line of Taipei taxis, simplified
  }
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  carCache.set(taxi, g);
  return g;
}
