/**
 * Converts the CC0 Quaternius packs into the compact runtime bundles in public/assets.
 *
 * The source packs are not committed. Download the free "Standard" versions from
 * https://quaternius.com (Sci-Fi Essentials Kit, Modular Sci-Fi MegaKit, Universal Base
 * Characters, Universal Animation Library 1 and 2), extract each zip into ASSET_SRC/<folder>
 * (essentials, megakit, basechars, ual1, ual2), then run: bun tools/import-assets.ts
 */
import { Document, NodeIO, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, meshopt, prune, resample, textureCompress, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.env.ASSET_SRC ?? '/tmp/claude-1000/itch';
const OUT = join(import.meta.dir, '../public/assets');
mkdirSync(OUT, { recursive: true });
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const ESS = join(SRC, 'essentials/glTF');
const KIT = join(SRC, 'megakit/Modular SciFi MegaKit[Standard]/glTF');
const UAL1 = join(SRC, 'ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb');
const UAL2 = join(SRC, 'ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb');
const HERO = join(SRC, 'basechars/Universal Base Characters[Standard]/Base Characters/Godot - UE');

// MegaKit glTF files reference textures as siblings while the pack ships them in ../Textures.
for (const dir of readdirSync(KIT)) {
  for (const tex of readdirSync(join(KIT, '../Textures'))) {
    if (!existsSync(join(KIT, dir, tex))) copyFileSync(join(KIT, '../Textures', tex), join(KIT, dir, tex));
  }
}

function findKit(name: string) {
  for (const dir of readdirSync(KIT)) if (existsSync(join(KIT, dir, `${name}.gltf`))) return join(KIT, dir, `${name}.gltf`);
  throw new Error(`Missing kit piece ${name}`);
}

/** Merge several single-model files into one document with one named root per model. */
async function bundle(files: { path: string; name: string }[]) {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('Scene');
  for (const file of files) {
    const src = await io.read(file.path);
    const map = mergeDocuments(doc, src);
    const srcScene = src.getRoot().getDefaultScene() ?? src.getRoot().listScenes()[0];
    const root = doc.createNode(file.name);
    for (const child of srcScene.listChildren()) root.addChild(map.get(child) as Node);
    scene.addChild(root);
  }
  for (const s of doc.getRoot().listScenes()) if (s !== scene) s.dispose();
  doc.getRoot().setDefaultScene(scene);
  await doc.transform(unpartition());
  return doc;
}

async function finish(doc: Document, file: string, size: number, compress = false) {
  await doc.transform(
    dedup(), prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 82 }),
  );
  if (compress) await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(join(OUT, file), doc);
  console.log('wrote', file);
}

// ---- Weapons ---------------------------------------------------------------------------
{
  const names = ['Gun_Rifle', 'Gun_Sniper', 'Gun_Pistol', 'Gun_Revolver', 'Gun_SMG_Ammo', 'Gun_Sniper_Ammo', 'Prop_Grenade'];
  const doc = await bundle(names.map(n => ({ path: join(ESS, `${n}.gltf`), name: n })));
  await finish(doc, 'weapons.glb', 1024);
}

// ---- Props -----------------------------------------------------------------------------
{
  const ess = ['Prop_Crate', 'Prop_Crate_Large', 'Prop_Crate_Tarp', 'Prop_Crate_Tarp_Large', 'Prop_Barrel1', 'Prop_Barrel2_Closed',
    'Prop_Barrel2_Open', 'Prop_Ammo', 'Prop_Ammo_Closed', 'Prop_HealthPack', 'Prop_HealthPack_Tube', 'Prop_SatelliteDish', 'Prop_Chest',
    'Prop_Locker', 'Prop_Mine'];
  const kit = ['Prop_Computer', 'Prop_AccessPoint', 'Prop_Barrel_Large', 'Prop_Crate3', 'Prop_Crate4', 'Prop_Light_Floor', 'Prop_Light_Small',
    'Prop_Light_Wide', 'Prop_Vent_Big', 'Prop_Fan_Small', 'Prop_PipeHolder', 'Prop_Cable_1', 'Prop_Cable_3', 'Prop_Rail_2', 'Prop_Rail_3',
    'Prop_Rail_4', 'Column_Astra', 'Column_Round', 'Column_Simple', 'Column_Pipes', 'Column_Hollow', 'Platform_Stairs_2', 'Platform_Stairs_4',
    'Platform_Stairs_4Wide', 'Platform_Ramp_4', 'Platform_Ramp_4Wide', 'Platform_Rails_4', 'Door_Frame_Square', 'Door_Frame_A',
    'Platform_Round1', 'Decal_Logo', 'Decal_Sign', 'Decal_Line_Straight', 'Decal_A', 'Decal_XSign', 'Decal_Dashes',
    'WallAstra_Straight', 'WallAstra_Straight_Window', 'WallBand_Straight', 'WallWindow_Straight', 'TopCables_Straight', 'ShortWall_Metal2_Straight'];
  const doc = await bundle([
    ...ess.map(n => ({ path: join(ESS, `${n}.gltf`), name: n })),
    ...kit.map(n => ({ path: findKit(n), name: `Kit_${n}` })),
  ]);
  await finish(doc, 'props.glb', 1024);
}

// ---- Sentinel drone (animated) -----------------------------------------------------------
{
  const doc = await io.read(join(ESS, 'Enemy_EyeDrone.gltf'));
  await finish(doc, 'drone.glb', 1024);
}

// ---- Soldier body ------------------------------------------------------------------------
{
  // The pack references two textures under slightly different names; provide aliases.
  for (const [from, to] of [['T_Hair_1_Normal.png', 'T_Hair_1_Normal_png.png'], ['T_Eye_Normal.png', 'T_Eye_Normal_png.png']])
    if (!existsSync(join(HERO, to))) copyFileSync(join(HERO, from), join(HERO, to));
  const doc = await io.read(join(HERO, 'Superhero_Male_FullBody.gltf'));
  // Keep only the body mesh; eyes and brows sit under the helmet.
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (mesh && mesh.getName() !== 'Sphere.005_Retopology.004') { node.setMesh(null); }
  }
  await finish(doc, 'soldier.glb', 1024);
}

// ---- Animation library: selected clips on the shared UE-style skeleton ------------------
{
  const wanted: [string, string[]][] = [
    [UAL1, ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Jump_Start', 'Jump_Loop',
      'Jump_Land', 'Death01', 'Hit_Chest', 'Hit_Head', 'Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Aim_Down',
      'Pistol_Reload', 'Pistol_Shoot', 'Roll', 'Dance_Loop']],
    [UAL2, ['Slide_Start', 'Slide_Loop', 'Slide_Exit', 'OverhandThrow', 'Hit_Knockback', 'Yes']],
  ];
  // Build a fresh document holding only the bone hierarchy and the copied clips.
  const out = new Document();
  const buffer = out.createBuffer();
  const scene = out.createScene('Scene');
  const first = await io.read(UAL1);
  const bones = new Map<string, Node>();
  const copyNode = (src: Node): Node => {
    const n = out.createNode(src.getName()).setTranslation(src.getTranslation()).setRotation(src.getRotation()).setScale(src.getScale());
    bones.set(src.getName(), n);
    for (const c of src.listChildren()) n.addChild(copyNode(c));
    return n;
  };
  for (const root of first.getRoot().getDefaultScene()!.listChildren()) scene.addChild(copyNode(root));
  for (const [file, names] of wanted) {
    const src = file === UAL1 ? first : await io.read(file);
    for (const anim of src.getRoot().listAnimations()) {
      if (!names.includes(anim.getName())) continue;
      const clip = out.createAnimation(anim.getName());
      for (const channel of anim.listChannels()) {
        const path = channel.getTargetPath(), bone = channel.getTargetNode()?.getName() ?? '';
        // Bones only rotate (hips also translate); fingers are posed procedurally on the grip.
        const finger = /^(index|middle|pinky|ring|thumb)_/.test(bone) || bone.includes('leaf');
        if (finger || path === 'scale' || (path === 'translation' && bone !== 'pelvis' && bone !== 'root')) continue;
        const target = bones.get(bone);
        const sampler = channel.getSampler();
        if (!target || !sampler) continue;
        const input = out.createAccessor().setType('SCALAR').setArray(sampler.getInput()!.getArray()!.slice()).setBuffer(buffer);
        const output = out.createAccessor().setType(sampler.getOutput()!.getType()).setArray(sampler.getOutput()!.getArray()!.slice()).setBuffer(buffer);
        const s2 = out.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(sampler.getInterpolation());
        clip.addSampler(s2).addChannel(out.createAnimationChannel().setTargetNode(target).setTargetPath(path!).setSampler(s2));
      }
    }
  }
  await out.transform(resample({ tolerance: 2e-4 }), prune({ keepLeaves: true }), dedup());
  await out.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(join(OUT, 'anims.glb'), out);
  console.log('wrote anims.glb', out.getRoot().listAnimations().length, 'clips');
}

writeFileSync(join(OUT, 'LICENSE.txt'), `All models, textures and animations in this folder were converted from CC0 1.0 packs by Quaternius
(https://quaternius.com): Sci-Fi Essentials Kit, Modular Sci-Fi MegaKit, Universal Base Characters,
Universal Animation Library and Universal Animation Library 2 (free Standard editions).
CC0 1.0 Universal Public Domain Dedication: https://creativecommons.org/publicdomain/zero/1.0/
Converted with tools/import-assets.ts (textures resized to WebP; animations meshopt-compressed).
`);
