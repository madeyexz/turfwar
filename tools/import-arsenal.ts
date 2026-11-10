/**
 * Builds public/assets/arsenal.glb: the store's guns and the knife as textured PBR models, one named
 * root per weapon, in the game's gun space (barrel along -X, +Y up, metres, origin at the shooting
 * hand's grip; src/render/optics.ts GUN_FIT holds each gun's hand, muzzle and rail points).
 *
 * Sources (all CC0 1.0, not committed; extract each archive into its own directory under ARSENAL_SRC):
 *   stein/  "Free Classic Weapons Pack" by Stein Games, https://steingames.itch.io/free-classic-weapons-pack
 *           (WeaponsPack/<gun>/SKM_<gun>.fbx with T_<gun>_C / _N / _RMAO.png)
 *   guns/   "Guns & Explosives" from https://www.3dmodelscc0.com (Guns&Explosives/<gun>/<gun>.fbx with
 *           _Base_Color / _Normal / _Roughness / _Metallic.png)
 *   melee/  "Melee Weapons Pack #1" from https://www.3dmodelscc0.com (MeleeWeaponsPack#1/Combat_Knife)
 * FBX files are read through FBX2glTF (https://github.com/facebookincubator/FBX2glTF; path in FBX2GLTF).
 *
 * No CC0 scan-quality MP7, M110, M249, M1014 or M9A1 exists: those names are drawn with the nearest
 * model the packs have (see GUNS). The names and numbers in shared/weapons.ts stay BeGone's.
 *
 * Each gun gets three 1024² textures (base colour, OpenGL normal, occlusion/roughness/metalness).
 * Afterwards run `bun tools/make-model-textures.ts`: it moves them out to assets/modeltex as KTX2.
 *
 *   ARSENAL_SRC=/path FBX2GLTF=/path/FBX2glTF bun tools/import-arsenal.ts [--embed <file>]
 *   (--embed writes the GLB with full textures to <file> instead, to look at in /dev/viewer.html)
 */
import { Document, NodeIO, type Material, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, meshopt, prune, simplify, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = process.env.ARSENAL_SRC ?? '/tmp/arsenal-src';
const FBX2GLTF = process.env.FBX2GLTF ?? 'FBX2glTF';
const OUT = join(import.meta.dir, '../public/assets');
const SIZE = 1024;

const stein = (gun: string, fbx = gun) => ({
  fbx: `stein/WeaponsPack/${gun}/SKM_${fbx}.fbx`,
  tex: { color: `stein/WeaponsPack/${gun}/T_${gun}_C.png`, normal: `stein/WeaponsPack/${gun}/T_${gun}_N.png`, rmao: `stein/WeaponsPack/${gun}/T_${gun}_RMAO.png` },
  // Made for Unreal: green points down.
  directX: true,
});
const cc0 = (dir: string, gun: string, directX: boolean, pack = 'guns/Guns&Explosives') => ({
  fbx: `${pack}/${dir}/${gun}.fbx`,
  tex: { color: `${pack}/${dir}/${gun}_Base_Color.png`, normal: `${pack}/${dir}/${gun}_Normal${directX ? '_DirectX' : ''}.png`, rough: `${pack}/${dir}/${gun}_Roughness.png`, metal: `${pack}/${dir}/${gun}_Metallic.png` },
  directX,
});

interface Spec {
  name: string; fbx: string; directX: boolean;
  tex: { color: string; normal: string; rmao?: string; rough?: string; metal?: string };
  /** Metres from butt to muzzle (the game's stylized scale, as tools/import-guns.ts: pistol 0.36, rifle 1.02). */
  length: number;
  /** The source's barrel direction along its Z axis (`along: 'y'`: a blade along its Y axis). */
  forward: 1 | -1; along?: 'y';
  /** Where the shooting hand's grip sits, in output space before it moves to the origin (read off /dev/viewer.html?grid). */
  grip: [number, number];
  /** Source nodes left out (a built-in scope: optics are fitted attachments). */
  drop?: string[];
  /** Triangle budget (meshoptimizer simplification); soldiers carry these too. */
  tris?: number;
}
export const GUNS: Spec[] = [
  { name: 'Gun_MP5', ...stein('MP5'), length: 0.74, forward: 1, grip: [0, 0], tris: 7000 },
  // MP7 stand-in: the pack's MAC-10, a machine pistol of the same size.
  { name: 'Gun_MP7', ...stein('Mac10'), length: 0.4, forward: 1, grip: [0, 0], tris: 7000 },
  { name: 'Gun_M4A1', ...cc0('M4A1', 'M4A1', false), length: 1.02, forward: -1, grip: [0.115, -0.1] },
  // M110 stand-in: the pack's M14, a 7.62 mm semi-automatic marksman rifle.
  { name: 'Gun_M110', ...stein('M14'), length: 1.25, forward: 1, grip: [0.01, -0.025], tris: 7000 },
  // M249 stand-in: the pack's AK, fitted as a light machine gun (src/render/procguns.ts adds the box and bipod).
  { name: 'Gun_M249', ...stein('AK47'), length: 1.1, forward: 1, grip: [0, -0.01], tris: 7000 },
  // M1014 stand-in: the pack's pump shotgun.
  { name: 'Gun_M1014', ...cc0('Shotgun', 'Shotgun', true), length: 1.06, forward: -1, grip: [0.44, -0.04] },
  // M9A1 stand-in: the pack's M1911.
  { name: 'Gun_M9A1', ...stein('1911'), tex: { ...stein('1911').tex, normal: 'stein/WeaponsPack/1911/T_1991_N.png' /* the pack's own spelling */ }, length: 0.3, forward: 1, grip: [0.015, -0.01], tris: 6000 },
  { name: 'Gun_Knife', ...cc0('Combat_Knife', 'Combat_Knife', false, 'melee/MeleeWeaponsPack#1'), length: 0.34, forward: 1, along: 'y', grip: [0.075, 0] },
];

type M4 = ArrayLike<number>;
const mul = (a: M4, b: M4) => { const o = new Array<number>(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const point = (m: M4, [x, y, z]: number[]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const dir = (m: M4, [x, y, z]: number[]) => [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];

/** What a source material becomes: the gun's textured surface, cartridge brass, or glowing sight dots. */
const roleOf = (material: string) => /BULLETS/i.test(material) ? 'brass' : /GlowSight/i.test(material) ? 'glow' : 'main';

interface Soup { pos: number[]; nor: number[]; uv: number[] }

/** The source's triangles in its own world space (skins posed at rest), by material role. */
async function readSource(io: NodeIO, spec: Spec, tmp: string) {
  const base = join(tmp, spec.name);
  const run = spawnSync(FBX2GLTF, ['-b', '-i', join(SRC, spec.fbx), '-o', base]);
  if (run.status !== 0) throw new Error(`FBX2glTF failed on ${spec.fbx}: ${run.error ?? run.stderr}`);
  const doc = await io.read(`${base}.glb`);
  const soups = new Map<string, Soup>();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || spec.drop?.includes(node.getName())) continue;
    const skin = node.getSkin();
    const joints = skin?.listJoints().map((j: Node, i) => mul(j.getWorldMatrix(), skin.getInverseBindMatrices()!.getElement(i, new Array<number>(16))));
    const world = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const role = roleOf(prim.getMaterial()?.getName() ?? '');
      let soup = soups.get(role);
      if (!soup) soups.set(role, soup = { pos: [], nor: [], uv: [] });
      const P = prim.getAttribute('POSITION')!, N = prim.getAttribute('NORMAL'), T = prim.getAttribute('TEXCOORD_0');
      const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0'), I = prim.getIndices();
      const count = I ? I.getCount() : P.getCount();
      for (let i = 0; i < count; i++) {
        const v = I ? I.getScalar(i) : i;
        const p = P.getElement(v, [0, 0, 0]), n = N ? N.getElement(v, [0, 0, 0]) : [0, 1, 0];
        let op = [0, 0, 0], on = [0, 0, 0];
        if (joints && J && W) {
          const j = J.getElement(v, [0, 0, 0, 0]), w = W.getElement(v, [0, 0, 0, 0]);
          for (let k = 0; k < 4; k++) if (w[k] > 0) {
            const a = point(joints[j[k]], p), b = dir(joints[j[k]], n);
            for (let c = 0; c < 3; c++) { op[c] += a[c] * w[k]; on[c] += b[c] * w[k]; }
          }
        } else { op = point(world, p); on = dir(world, n); }
        soup.pos.push(...op); soup.nor.push(...on);
        const uv = T ? T.getElement(v, [0, 0]) : [0, 0];
        soup.uv.push(uv[0], uv[1]);
        // The packs' UVs sit in other tiles of the repeating texture (v from -3 to -2): bring each triangle to the first.
        if (i % 3 === 2) {
          const at = soup.uv.length - 6;
          for (let c = 0; c < 2; c++) { const shift = Math.floor(Math.min(soup.uv[at + c], soup.uv[at + 2 + c], soup.uv[at + 4 + c]) + 1e-6); for (let k = 0; k < 3; k++) soup.uv[at + k * 2 + c] -= shift; }
        }
      }
    }
  }
  return soups;
}

const image = (path: string) => sharp(join(SRC, path)).resize(SIZE, SIZE, { fit: 'fill' });
const channel = async (path: string | undefined, index: number) => path && existsSync(join(SRC, path))
  ? (await image(path).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => { const o = Buffer.alloc(SIZE * SIZE); for (let i = 0; i < o.length; i++) o[i] = data[i * info.channels + Math.min(index, info.channels - 1)]; return o; }))
  : undefined;

/** Base colour, OpenGL normal map and glTF's packed occlusion (R) / roughness (G) / metalness (B). */
async function textures(spec: Spec) {
  const webp = (s: sharp.Sharp, quality = 90) => s.webp({ quality, effort: 5 }).toBuffer();
  const color = await webp(image(spec.tex.color).removeAlpha());
  const n = await image(spec.tex.normal).removeAlpha().raw().toBuffer();
  if (spec.directX) for (let i = 1; i < n.length; i += 3) n[i] = 255 - n[i];
  const normal = await webp(sharp(n, { raw: { width: SIZE, height: SIZE, channels: 3 } }), 95);
  // Stein packs roughness, metalness and occlusion in R, G, B; the other packs have one file each and no occlusion.
  const rough = await channel(spec.tex.rmao ?? spec.tex.rough, 0);
  const metal = await channel(spec.tex.rmao ?? spec.tex.metal, spec.tex.rmao ? 1 : 0);
  const ao = spec.tex.rmao ? await channel(spec.tex.rmao, 2) : undefined;
  const orm = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) { orm[i * 3] = ao ? ao[i] : 255; orm[i * 3 + 1] = rough ? rough[i] : 140; orm[i * 3 + 2] = metal ? metal[i] : 0; }
  return { color, normal, orm: await webp(sharp(orm, { raw: { width: SIZE, height: SIZE, channels: 3 } })) };
}

/** One gun as its own document (so its simplification touches nothing else). */
async function buildGun(io: NodeIO, spec: Spec, tmp: string) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const brass = doc.createMaterial('Brass').setBaseColorFactor([0.5, 0.35, 0.13, 1]).setMetallicFactor(0.8).setRoughnessFactor(0.55);
  const glow = doc.createMaterial('SightGlow').setBaseColorFactor([0.1, 0.5, 0.15, 1]).setEmissiveFactor([0.2, 1, 0.3]).setRoughnessFactor(0.6).setMetallicFactor(0);
  const soups = await readSource(io, spec, tmp);
  // Source (Y up, barrel along ±Z; a blade along ±Y) → gun space (barrel -X): a quarter turn, then scale, then the grip to the origin.
  const f = spec.forward;
  const turn = spec.along === 'y' ? ([x, y, z]: number[]) => [-f * y, f * x, z] : ([x, y, z]: number[]) => [-f * z, y, f * x];
  let min = Infinity, max = -Infinity;
  for (const s of soups.values()) for (let i = 0; i < s.pos.length; i += 3) { const x = turn(s.pos.slice(i, i + 3))[0]; min = Math.min(min, x); max = Math.max(max, x); }
  const k = spec.length / (max - min);
  const t = await textures(spec);
  const tex = (kind: string, bytes: Buffer) => doc.createTexture(`T_${spec.name.slice(4)}_${kind}`).setImage(new Uint8Array(bytes)).setMimeType('image/webp');
  const orm = tex('ORM', t.orm);
  const main = doc.createMaterial(spec.name.slice(4))
    .setBaseColorTexture(tex('BaseColor', t.color)).setNormalTexture(tex('Normal', t.normal))
    .setMetallicRoughnessTexture(orm).setMetallicFactor(1).setRoughnessFactor(1);
  if (spec.tex.rmao) main.setOcclusionTexture(orm);
  const materials: Record<string, Material> = { main, brass, glow };
  const mesh = doc.createMesh(spec.name);
  for (const [role, s] of soups) {
    const pos = new Float32Array(s.pos.length), nor = new Float32Array(s.nor.length);
    for (let i = 0; i < s.pos.length; i += 3) {
      const p = turn(s.pos.slice(i, i + 3)), n = turn(s.nor.slice(i, i + 3)), l = Math.hypot(n[0], n[1], n[2]) || 1;
      pos[i] = p[0] * k - spec.grip[0]; pos[i + 1] = p[1] * k - spec.grip[1]; pos[i + 2] = p[2] * k;
      nor[i] = n[0] / l; nor[i + 1] = n[1] / l; nor[i + 2] = n[2] / l;
    }
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buffer))
      .setMaterial(materials[role]);
    if (role === 'main') prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(s.uv)).setBuffer(buffer));
    mesh.addPrimitive(prim);
  }
  // Mesh on a child: quantization puts its dequantize transform on that node, keeping the root clean.
  doc.createScene('Scene').addChild(doc.createNode(spec.name).addChild(doc.createNode(`${spec.name}_Mesh`).setMesh(mesh)));
  await doc.transform(weld());
  const count = () => doc.getRoot().listMeshes().flatMap(m => m.listPrimitives()).reduce((a, p) => a + p.getIndices()!.getCount() / 3, 0);
  const before = count();
  if (spec.tris && before > spec.tris) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: spec.tris / before, error: 0.002 }));
  console.log(spec.name, `${before} → ${count()} triangles`, `scale ${k.toFixed(3)}`);
  return doc;
}

async function build(io: NodeIO) {
  const tmp = mkdtempSync(join(tmpdir(), 'arsenal-'));
  const doc = new Document();
  const scene = doc.createScene('Scene');
  for (const spec of GUNS) mergeDocuments(doc, await buildGun(io, spec, tmp));
  rmSync(tmp, { recursive: true, force: true });
  // Every gun arrived with its own scene and buffer: one of each.
  for (const other of doc.getRoot().listScenes()) if (other !== scene) { for (const node of other.listChildren()) scene.addChild(node); other.dispose(); }
  doc.getRoot().setDefaultScene(scene);
  await doc.transform(unpartition(), dedup(), prune());
  return doc;
}

await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await build(io);
const embedAt = process.argv.indexOf('--embed');
if (embedAt < 0) await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const out = embedAt > 0 ? process.argv[embedAt + 1] : join(OUT, 'arsenal.glb');
await io.write(out, doc);
console.log('wrote', out, `${(readFileSync(out).length / 1024).toFixed(0)} KB`);
