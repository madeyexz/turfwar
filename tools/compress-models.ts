/**
 * Shrinks the runtime models in public/assets without changing how anything that is drawn looks:
 *
 * - props.glb keeps only the props the maps place (PROPS; `b.prop` / `b.solidProp` in shared/maps) and
 *   the kit pieces that carry the trim-sheet materials the level's procedural walls borrow
 *   (TRIM_CARRIERS; `trimMaterial` in src/render/level.ts). The rest of the kit was never placed.
 * - props.glb, weapons.glb and soldier.glb get EXT_meshopt_compression without quantization or
 *   filters, and keep their vertex order: the decoded geometry is the same float data as before, so
 *   code that merges or reads it (soldier.ts, dressing.ts) sees no change. Unused accessors are dropped.
 *
 * Runtime GLBs are not gzip/brotli-compressed by the host, so this is what comes down the wire
 * (the first match's download: docs/ARCHITECTURE.md, "First download"). src/models.test.ts checks every placed prop is still here.
 *
 * Run: bun tools/compress-models.ts   (idempotent; tools/import-assets.ts applies the same steps)
 */
import { type Document, type Node, NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { join } from 'node:path';

/** The props the maps place. Add a model here (and re-run) before a map uses it. */
export const PROPS = ['Prop_Crate', 'Prop_Crate_Large', 'Prop_Crate_Tarp', 'Prop_Crate_Tarp_Large', 'Prop_Barrel1', 'Prop_Barrel2_Closed',
  'Prop_Chest', 'Prop_SatelliteDish', 'Kit_Prop_Computer'];
/** The smallest kit pieces whose materials hold T_Trim_01/02/03_BaseColor (the procedural walls' trim sheets). */
export const TRIM_CARRIERS = ['Kit_Column_Astra', 'Kit_Prop_Fan_Small', 'Prop_Locker'];

/** Drop every top-level model of props.glb that is not placed or carrying a trim sheet, and what only it used. */
export async function slimProps(doc: Document) {
  const keep = new Set([...PROPS, ...TRIM_CARRIERS]);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const drop: Node[] = [];
  for (const root of scene.listChildren()) if (!keep.has(root.getName())) root.traverse(n => { drop.push(n); });
  for (const n of drop) n.dispose();
  for (const anim of doc.getRoot().listAnimations()) {
    for (const channel of anim.listChannels()) if (!channel.getTargetNode()) channel.dispose();
    if (!anim.listChannels().length) anim.dispose();
  }
  // Kept models stay whole (empty helper nodes, attributes, solid textures); only orphans go.
  await doc.transform(prune({ keepLeaves: true, keepAttributes: true, keepIndices: true, keepSolidTextures: true, keepExtras: true }));
}

/** Lossless meshopt compression: no quantization, no filters, no reordering. */
export async function compressLossless(doc: Document) {
  await doc.transform(prune({ propertyTypes: [PropertyType.ACCESSOR] }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
}

if (import.meta.main) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const dir = join(import.meta.dir, '../public/assets');
  for (const name of ['props', 'weapons', 'soldier']) {
    const file = join(dir, `${name}.glb`), before = Bun.file(file).size;
    const doc = await io.read(file);
    if (name === 'props') await slimProps(doc);
    await compressLossless(doc);
    await io.write(file, doc);
    console.log(`${name}.glb  ${(before / 1024).toFixed(0)} KB → ${(Bun.file(file).size / 1024).toFixed(0)} KB`);
  }
}
