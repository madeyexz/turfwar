/**
 * Converts the CC0 "Ultimate Modular Men" pack by Quaternius into the compact runtime bundles
 * `public/assets/soldiers.glb` (the characters) and `public/assets/soldier-anims.glb` (their clips).
 *
 * The source pack is not committed. Download it from https://quaternius.com/packs/ultimatemodularcharacters.html
 * (Google Drive folder), keep the "Individual Characters/glTF" folder at MODULAR_SRC, then run:
 * `bun tools/import-modular.ts`.
 *
 * Each character's bones are renamed to the names the soldier renderer uses (the UE-style names of
 * the Universal Base Characters rig: pelvis, spine_01..03, upperarm_l, hand_r, index_01_l ...), so the
 * axis-agnostic IK in src/render/rig.ts drives them unchanged. The separate body, head, legs and
 * feet meshes are merged into one skinned mesh with the material colours baked as vertex colours:
 * one draw call per soldier.
 */
import { Document, NodeIO, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, meshopt, prune, resample, unpartition, weld, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.env.MODULAR_SRC ?? '/tmp/modmen/dl/Individual Characters/glTF';
const OUT = join(import.meta.dir, '../public/assets');
mkdirSync(OUT, { recursive: true });
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
void EXTMeshoptCompression;

/** SWAT side first; the rest are the Militia's irregulars (picked by variant). */
const CHARACTERS = ['Swat', 'Adventurer', 'Farmer', 'Punk', 'Worker', 'Casual_2', 'Casual_Hoodie'];

const BONES: Record<string, string> = {
  Root: 'pelvis', Abdomen: 'spine_01', Torso: 'spine_02', Chest: 'spine_03', Neck: 'neck_01',
  'PT.L': 'pt_l', 'PT.R': 'pt_r',
};
/** `Index2.L` -> `index_02_l`, `UpperArm.R` -> `upperarm_r` ... */
function rename(name: string) {
  if (BONES[name]) return BONES[name];
  const m = /^(.+?)\.(L|R)$/.exec(name);
  if (!m) return name;
  const side = m[2].toLowerCase();
  const base = ({ Shoulder: 'clavicle', UpperArm: 'upperarm', LowerArm: 'lowerarm', Wrist: 'hand', UpperLeg: 'thigh', LowerLeg: 'calf', Foot: 'foot' } as Record<string, string>)[m[1]];
  if (base) return `${base}_${side}`;
  const f = /^(Index|Middle|Ring|Pinky|Thumb)(\d)$/.exec(m[1]);
  if (f) return `${f[1].toLowerCase()}_0${f[2]}_${side}`;
  return name;
}

/**
 * The pack's SWAT is nearly black (linear 0.02-0.1) and vanishes in shade; lift it to the navy of the
 * SWAT side (the classic soldier's 0x2c3b58 plate carrier and 0x283550 trousers, linear RGB).
 */
const SWAT_COLORS: Record<string, [number, number, number]> = {
  Swat: [0.034, 0.055, 0.115], Swat_Black: [0.016, 0.022, 0.04], Grey: [0.05, 0.062, 0.09], Black: [0.012, 0.014, 0.02], DarkBrown: [0.03, 0.025, 0.02],
};

/** Merge every skinned mesh of a character into one primitive with the material colours as COLOR_0. */
function mergeMeshes(doc: Document, recolor: Record<string, [number, number, number]> = {}) {
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const skin = root.listSkins()[0];
  const nodes = root.listNodes().filter(n => n.getMesh());
  const pos: number[] = [], nor: number[] = [], col: number[] = [], jnt: number[] = [], wgt: number[] = [], idx: number[] = [];
  let base = 0;
  for (const node of nodes) {
    for (const prim of node.getMesh()!.listPrimitives()) {
      const P = prim.getAttribute('POSITION')!, N = prim.getAttribute('NORMAL')!, J = prim.getAttribute('JOINTS_0')!, W = prim.getAttribute('WEIGHTS_0')!;
      const material = prim.getMaterial()!;
      const color = recolor[material.getName()] ?? material.getBaseColorFactor();
      const t = [0, 0, 0, 0];
      for (let i = 0; i < P.getCount(); i++) {
        pos.push(...P.getElement(i, t).slice(0, 3)); nor.push(...N.getElement(i, t).slice(0, 3));
        col.push(color[0], color[1], color[2]);
        jnt.push(...J.getElement(i, t)); wgt.push(...W.getElement(i, t));
      }
      const I = prim.getIndices()!;
      for (let i = 0; i < I.getCount(); i++) idx.push(base + I.getScalar(i));
      base += P.getCount();
    }
  }
  const acc = (type: 'VEC3' | 'VEC4' | 'SCALAR', array: Float32Array | Uint16Array | Uint32Array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const material = doc.createMaterial('soldier').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.84).setMetallicFactor(0.04);
  const prim = doc.createPrimitive().setMaterial(material)
    .setAttribute('POSITION', acc('VEC3', new Float32Array(pos))).setAttribute('NORMAL', acc('VEC3', new Float32Array(nor)))
    .setAttribute('COLOR_0', acc('VEC3', new Float32Array(col)))
    .setAttribute('JOINTS_0', acc('VEC4', new Uint16Array(jnt))).setAttribute('WEIGHTS_0', acc('VEC4', new Float32Array(wgt)))
    .setIndices(acc('SCALAR', new Uint32Array(idx)));
  const mesh = doc.createMesh('Soldier').addPrimitive(prim);
  const parent = nodes[0].getParentNode()!;
  for (const n of nodes) n.dispose();
  parent.addChild(doc.createNode('Soldier').setMesh(mesh).setSkin(skin));
}

const docs: { name: string; doc: Document }[] = [];
let clips: Document | undefined;
for (const name of CHARACTERS) {
  const file = join(SRC, `${name}.gltf`);
  if (!existsSync(file)) throw new Error(`Missing ${file}; download the pack first (see the header)`);
  const doc = await io.read(file);
  for (const node of doc.getRoot().listNodes()) if (node.getName() === 'Pistol') node.dispose();
  mergeMeshes(doc, name === 'Swat' ? SWAT_COLORS : {});
  if (name === CHARACTERS[0]) clips = await buildClips(doc);
  for (const a of doc.getRoot().listAnimations()) { for (const c of a.listChannels()) c.dispose(); for (const s of a.listSamplers()) s.dispose(); a.dispose(); }
  for (const node of doc.getRoot().listNodes()) node.setName(rename(node.getName()));
  await doc.transform(prune());
  docs.push({ name, doc });
}

/** The clips on a bare copy of the (renamed) bone hierarchy, as anims.glb does for the base rig. */
async function buildClips(src: Document) {
  const out = new Document();
  const buffer = out.createBuffer();
  const scene = out.createScene('Scene');
  const bones = new Map<string, Node>();
  const copy = (n: Node): Node => {
    const c = out.createNode(rename(n.getName())).setTranslation(n.getTranslation()).setRotation(n.getRotation()).setScale(n.getScale());
    bones.set(n.getName(), c);
    for (const k of n.listChildren()) if (!k.getMesh()) c.addChild(copy(k));
    return c;
  };
  const rootBone = src.getRoot().listNodes().find(n => n.getName() === 'Root')!;
  scene.addChild(copy(rootBone));
  for (const anim of src.getRoot().listAnimations()) {
    const clip = out.createAnimation(anim.getName());
    for (const channel of anim.listChannels()) {
      const bone = channel.getTargetNode()?.getName() ?? '', path = channel.getTargetPath();
      // Fingers are posed procedurally on the grip; scale never changes.
      if (/^(Index|Middle|Ring|Pinky|Thumb)\d/.test(bone) || path === 'scale') continue;
      const target = bones.get(bone), sampler = channel.getSampler();
      if (!target || !sampler) continue;
      const input = out.createAccessor().setType('SCALAR').setArray(sampler.getInput()!.getArray()!.slice()).setBuffer(buffer);
      const output = out.createAccessor().setType(sampler.getOutput()!.getType()).setArray(sampler.getOutput()!.getArray()!.slice()).setBuffer(buffer);
      const s = out.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(sampler.getInterpolation());
      clip.addSampler(s).addChannel(out.createAnimationChannel().setTargetNode(target).setTargetPath(path!).setSampler(s));
    }
  }
  await out.transform(resample({ tolerance: 2e-4 }), prune({ keepLeaves: true }), dedup());
  return out;
}

// ---- Characters: one named root per model ---------------------------------------------------
{
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('Scene');
  for (const { name, doc: src } of docs) {
    const map = mergeDocuments(doc, src);
    const srcScene = src.getRoot().getDefaultScene() ?? src.getRoot().listScenes()[0];
    const root = doc.createNode(name);
    for (const child of srcScene.listChildren()) root.addChild(map.get(child) as Node);
    scene.addChild(root);
  }
  for (const s of doc.getRoot().listScenes()) if (s !== scene) s.dispose();
  doc.getRoot().setDefaultScene(scene);
  await doc.transform(unpartition(), weld(), quantize({ quantizeColor: 8, quantizeWeight: 8, quantizePosition: 14, quantizeNormal: 10 }), dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(join(OUT, 'soldiers.glb'), doc);
  console.log('wrote soldiers.glb');
}
{
  await clips!.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(join(OUT, 'soldier-anims.glb'), clips!);
  console.log('wrote soldier-anims.glb', clips!.getRoot().listAnimations().length, 'clips');
}
