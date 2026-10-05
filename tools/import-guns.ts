/**
 * Converts guns from Quaternius' CC0 "Ultimate Gun Pack" (OBJ + MTL, flat colours) into
 * public/assets/guns.glb, one named root per gun, in the same model space as weapons.glb:
 * barrel along -X, +Y up, metres, origin at the shooting hand's grip.
 *
 * The source pack is not committed. Download it (CC0 1.0) from
 * https://opengameart.org/content/low-poly-guns-pack (ultimate_gun_pack_by_quaternius.zip, also on
 * https://quaternius.itch.io/50-lowpoly-guns), extract it into GUN_SRC, then run:
 *   bun tools/import-guns.ts            # writes public/assets/guns.glb
 *   bun tools/import-guns.ts --preview <dir>   # side views with a 5 cm grid, for placing grips
 */
import { Document, NodeIO, type Material } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.env.GUN_SRC ?? '/tmp/guns-src', 'ultimate/Ultimate Gun Pack - July 2019/OBJ');
const OUT = join(import.meta.dir, '../public/assets');

/**
 * name: runtime node name; file: source OBJ; length: metres from stock to muzzle (matched to the
 * stylized scale of weapons.glb: pistol ≈ 0.44, rifle ≈ 1.06, sniper ≈ 1.7); grip: where the
 * shooting hand's grip sits (metres, model space with the pack's own origin), moved to the origin.
 */
export const GUNS = [
  { name: 'Gun_Hornet', file: 'Pistol_4', length: 0.4, grip: [0, 0] },
  { name: 'Gun_Warden', file: 'Pistol_6', length: 0.52, grip: [0, 0] },
  { name: 'Gun_Wasp', file: 'SubmachineGun_1', length: 0.55, grip: [0, 0] },
  { name: 'Gun_Viper', file: 'SubmachineGun_5', length: 0.72, grip: [0, 0] },
  { name: 'Gun_Reaper', file: 'Shotgun_SawedOff', length: 0.78, grip: [0, 0] },
  { name: 'Gun_Thunder', file: 'Shotgun_1', length: 1.12, grip: [0, 0] },
  { name: 'Gun_Brawler', file: 'AssaultRifle_5', length: 1.08, grip: [0, 0] },
  { name: 'Gun_Kestrel', file: 'Bullpup_2', length: 0.92, grip: [0, 0] },
  { name: 'Gun_Marksman', file: 'AssaultRifle2_2', length: 1.1, grip: [0, 0] },
  { name: 'Gun_Swift', file: 'SniperRifle_4', length: 1.55, grip: [0, 0] },
  { name: 'Gun_Longbow', file: 'SniperRifle_3', length: 1.72, grip: [0, 0] },
  { name: 'Gun_Hammer', file: 'Bullpup_3', length: 1.08, grip: [0, 0] },
] as const;

interface Obj { positions: number[][]; normals: number[][]; groups: Map<string, [number, number][][]>; colors: Map<string, number[]> }

function parseObj(file: string): Obj {
  const positions: number[][] = [], normals: number[][] = [], groups = new Map<string, [number, number][][]>();
  let current = 'default';
  for (const line of readFileSync(join(SRC, `${file}.obj`), 'utf8').split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') positions.push(p.slice(1, 4).map(Number));
    else if (p[0] === 'vn') normals.push(p.slice(1, 4).map(Number));
    else if (p[0] === 'usemtl') current = p[1];
    else if (p[0] === 'f') {
      const corners = p.slice(1).map(c => { const [v, , n] = c.split('/'); return [Number(v) - 1, Number(n) - 1] as [number, number]; });
      if (!groups.has(current)) groups.set(current, []);
      groups.get(current)!.push(corners);
    }
  }
  const colors = new Map<string, number[]>();
  let mtl = '';
  for (const line of readFileSync(join(SRC, `${file}.mtl`), 'utf8').split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'newmtl') mtl = p[1];
    else if (p[0] === 'Kd') colors.set(mtl, p.slice(1, 4).map(Number));
  }
  return { positions, normals, groups, colors };
}

/** Pack units → model space: flip the barrel from +X to -X (180° about Y), scale, grip at origin. */
function transform(gun: (typeof GUNS)[number], obj: Obj) {
  let minX = Infinity, maxX = -Infinity;
  for (const [x] of obj.positions) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  const s = gun.length / (maxX - minX);
  const [gx, gy] = gun.grip;
  return {
    point: ([x, y, z]: number[]) => [-x * s - gx, y * s - gy, -z * s],
    normal: ([x, y, z]: number[]) => [-x, y, -z],
  };
}

/** Material look from the pack's material names (colours are kept, slightly lifted for our lighting). */
function look(name: string, kd: number[]) {
  const lower = name.toLowerCase();
  const lift = (c: number) => Math.min(1, c * 1.6 + 0.012);
  const color = [...kd.map(lift), 1];
  if (lower.includes('glass')) return { color: [0.1, 0.28, 0.32, 1], metal: 0.2, rough: 0.15, emissive: [0.02, 0.09, 0.1] };
  if (lower.includes('wood')) return { color, metal: 0, rough: 0.8 };
  if (lower.includes('metal')) return { color, metal: 0.65, rough: 0.42 };
  if (lower.includes('black')) return { color, metal: 0.25, rough: 0.6 };
  return { color, metal: 0.15, rough: 0.7 };
}

async function build() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  const materials = new Map<string, Material>();
  for (const gun of GUNS) {
    const obj = parseObj(gun.file);
    const { point, normal } = transform(gun, obj);
    const mesh = doc.createMesh(gun.name);
    for (const [mtl, faces] of obj.groups) {
      const key = `${mtl}:${obj.colors.get(mtl)?.join(',')}`;
      let material = materials.get(key);
      if (!material) {
        const l = look(mtl, obj.colors.get(mtl) ?? [0.05, 0.05, 0.05]);
        material = doc.createMaterial(mtl).setBaseColorFactor(l.color as [number, number, number, number]).setMetallicFactor(l.metal).setRoughnessFactor(l.rough);
        if (l.emissive) material.setEmissiveFactor(l.emissive as [number, number, number]);
        materials.set(key, material);
      }
      const pos: number[] = [], nor: number[] = [];
      for (const face of faces) for (let i = 1; i + 1 < face.length; i++) {
        // The 180° turn keeps handedness, so the winding order is unchanged.
        for (const [v, n] of [face[0], face[i], face[i + 1]]) {
          pos.push(...point(obj.positions[v]));
          nor.push(...normal(obj.normals[n] ?? [0, 1, 0]));
        }
      }
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
        .setMaterial(material);
      mesh.addPrimitive(prim);
    }
    // Mesh on a child: quantization puts its dequantize transform on that node, keeping the root clean.
    scene.addChild(doc.createNode(gun.name).addChild(doc.createNode(`${gun.name}_Mesh`).setMesh(mesh)));
  }
  doc.getRoot().setDefaultScene(scene);
  await doc.transform(weld(), dedup(), prune());
  return doc;
}

const previewAt = process.argv.indexOf('--preview');
if (previewAt > 0) {
  // Side views (looking from +Z) in model space: origin cross = grip, grid every 5 cm, labels every 10 cm.
  const dir = process.argv[previewAt + 1];
  mkdirSync(dir, { recursive: true });
  for (const gun of GUNS) {
    const obj = parseObj(gun.file);
    const { point } = transform(gun, obj);
    const tris: { pts: number[][]; z: number; color: string }[] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [mtl, faces] of obj.groups) {
      const c = look(mtl, obj.colors.get(mtl) ?? [0.05, 0.05, 0.05]).color;
      for (const face of faces) {
        const pts = face.map(([v]) => point(obj.positions[v]));
        for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
        const z = pts.reduce((a, p) => a + p[2], 0) / pts.length;
        const shade = (k: number) => Math.round(Math.min(1, Math.pow(k, 1 / 2.2) * 1.4) * 255);
        tris.push({ pts, z, color: `rgb(${shade(c[0])},${shade(c[1])},${shade(c[2])})` });
      }
    }
    tris.sort((a, b) => a.z - b.z);
    const px = 900, pad = 0.06;
    const k = px / (maxX - minX + pad * 2), w = px, h = Math.ceil((maxY - minY + pad * 2) * k);
    const X = (x: number) => (x - minX + pad) * k, Y = (y: number) => (maxY + pad - y) * k;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#f4f4f4"/>`;
    for (let g = Math.ceil((minX - pad) / 0.05) * 0.05; g < maxX + pad; g += 0.05) svg += `<line x1="${X(g)}" y1="0" x2="${X(g)}" y2="${h}" stroke="${Math.abs(g / 0.1 - Math.round(g / 0.1)) < 0.01 ? '#bbb' : '#e2e2e2'}"/>`;
    for (let g = Math.ceil((minY - pad) / 0.05) * 0.05; g < maxY + pad; g += 0.05) svg += `<line x1="0" y1="${Y(g)}" x2="${w}" y2="${Y(g)}" stroke="${Math.abs(g / 0.1 - Math.round(g / 0.1)) < 0.01 ? '#bbb' : '#e2e2e2'}"/>`;
    for (const t of tris) svg += `<polygon points="${t.pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" fill="${t.color}" stroke="${t.color}" stroke-width="0.5"/>`;
    for (let g = Math.ceil((minX - pad) / 0.1) * 0.1; g < maxX + pad; g += 0.1) svg += `<text x="${X(g) + 2}" y="12" font-size="11" fill="#c00">${g.toFixed(1)}</text>`;
    for (let g = Math.ceil((minY - pad) / 0.1) * 0.1; g < maxY + pad; g += 0.1) svg += `<text x="2" y="${Y(g) - 2}" font-size="11" fill="#06c">${g.toFixed(1)}</text>`;
    svg += `<line x1="${X(0) - 10}" y1="${Y(0)}" x2="${X(0) + 10}" y2="${Y(0)}" stroke="#f0f" stroke-width="2"/><line x1="${X(0)}" y1="${Y(0) - 10}" x2="${X(0)}" y2="${Y(0) + 10}" stroke="#f0f" stroke-width="2"/>`;
    svg += `<text x="${w - 200}" y="${h - 6}" font-size="13">${gun.name} x[${minX.toFixed(2)},${maxX.toFixed(2)}] y[${minY.toFixed(2)},${maxY.toFixed(2)}]</text></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(join(dir, `${gun.name}.png`));
  }
  console.log('previews in', dir);
} else {
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await build();
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = join(OUT, 'guns.glb');
  await io.write(out, doc);
  console.log('wrote', out, `${(readFileSync(out).length / 1024).toFixed(0)} KB`);
}
