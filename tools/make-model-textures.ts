/**
 * The models' own textures (soldier.glb, weapons.glb, props.glb: the kit's trim sheets, gun and prop
 * batches and the first-person arms) as GPU-compressed KTX2, like the surface sets (tools/make-ktx2.ts).
 * Inside a GLB they were WebP that the browser unpacks to raw RGBA: on Low each 512² map cost 1.4 MB of
 * video memory, about 40 MB for the set; as ETC1S it is 0.2–0.4 MB.
 *
 * Each GLB texture moves out to public/assets/modeltex/:
 *
 *   modeltex/<name>.webp        the original (the fallback when KTX2 is off)
 *   modeltex/<name>.ktx2        1024², for Medium and High
 *   modeltex/low/<name>.ktx2    512², for Low (phones' default)
 *
 * and the GLB keeps a 1×1 stand-in under the same name (its material, sampler and slot stay as they
 * were); src/render/textures.ts loadModelTextures puts the real one in at load. A texture two GLBs share
 * (T_Props_Batch2_*: weapons.glb and props.glb) is one file and one GPU copy. Unlike the surface sets the
 * files are not flipped (glTF's top row is v = 0). Colour maps are sRGB ETC1S, normal maps ETC1S tuned for
 * normals, the packed occlusion/roughness/metalness maps linear ETC1S.
 *
 * Idempotent: a GLB that already holds stand-ins is left alone and its KTX2 files are made from the .webp
 * in modeltex/. Re-run after tools/import-assets.ts or tools/import-guns.ts writes new GLBs.
 * Needs `basisu` 2.x (see tools/make-ktx2.ts).
 * Run: bun tools/make-model-textures.ts
 */
import { type Material, type Texture, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compressLossless } from './compress-models';

const ASSETS = join(import.meta.dir, '../public/assets');
const OUT = join(ASSETS, 'modeltex');
const MODELS = ['soldier', 'weapons', 'props'];

const ETC1S = ['-etc1s', '-quality', '100', '-effort', '5'];
type Kind = 'color' | 'normal' | 'data';
const ARGS: Record<Kind, string[]> = { color: [...ETC1S, '-srgb'], normal: [...ETC1S, '-normal_map', '-mip_renorm'], data: [...ETC1S, '-linear'] };
/** The stand-in's one pixel: neutral for its kind, should the real texture ever fail to load. */
const STAND_IN: Record<Kind, { r: number; g: number; b: number }> = { color: { r: 200, g: 200, b: 200 }, normal: { r: 128, g: 128, b: 255 }, data: { r: 255, g: 200, b: 0 } };

if (spawnSync('basisu', ['-version']).status !== 0) {
  console.error('basisu not found: install Basis Universal 2.x (see tools/make-ktx2.ts).');
  process.exit(1);
}
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
mkdirSync(join(OUT, 'low'), { recursive: true });

/** How a texture is sampled: by the material slots that use it. */
function kindOf(texture: Texture): Kind {
  const materials = texture.listParents().filter((p): p is Material => p.propertyType === 'Material');
  if (materials.some(m => m.getNormalTexture() === texture)) return 'normal';
  if (materials.some(m => m.getBaseColorTexture() === texture || m.getEmissiveTexture() === texture)) return 'color';
  return 'data';
}

const textures = new Map<string, Kind>();
for (const model of MODELS) {
  const file = join(ASSETS, `${model}.glb`), before = statSync(file).size;
  const doc = await io.read(file);
  let moved = 0;
  for (const texture of doc.getRoot().listTextures()) {
    const name = texture.getName(), image = texture.getImage();
    if (!name || !image) throw new Error(`${model}.glb: a texture without a name or image`);
    const kind = kindOf(texture);
    if (textures.has(name) && textures.get(name) !== kind) throw new Error(`${name}: used as ${textures.get(name)} and ${kind}`);
    textures.set(name, kind);
    const { width = 0 } = await sharp(Buffer.from(image)).metadata();
    if (width <= 4) continue;
    // The original moves out (a texture shared by two GLBs must be the same image in both).
    const webp = join(OUT, `${name}.webp`);
    const bytes = texture.getMimeType() === 'image/webp' ? Buffer.from(image) : await sharp(Buffer.from(image)).webp({ lossless: true }).toBuffer();
    if (existsSync(webp) && !readFileSync(webp).equals(bytes)) throw new Error(`${name}: differs from modeltex/${name}.webp`);
    writeFileSync(webp, bytes);
    const pixel = await sharp({ create: { width: 1, height: 1, channels: 3, background: STAND_IN[kind] } }).webp({ lossless: true }).toBuffer();
    texture.setImage(new Uint8Array(pixel)).setMimeType('image/webp');
    moved++;
  }
  if (moved) {
    await compressLossless(doc);
    await io.write(file, doc);
  }
  console.log(`${model}.glb  ${moved} textures moved out  ${(before / 1024).toFixed(0)} KB → ${(statSync(file).size / 1024).toFixed(0)} KB`);
}

const tmp = mkdtempSync(join(tmpdir(), 'model-ktx2-'));
const jobs = [...textures].flatMap(([name, kind]) => [
  { name, kind, size: 1024, out: join(OUT, `${name}.ktx2`) },
  { name, kind, size: 512, out: join(OUT, `low/${name}.ktx2`) },
]);
let next = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (next < jobs.length) {
    const job = jobs[next++], png = join(tmp, `${next}.png`);
    await sharp(join(OUT, `${job.name}.webp`)).resize(job.size, job.size, { fit: 'fill' }).png().toFile(png);
    const proc = Bun.spawn(['basisu', ...ARGS[job.kind], '-mipmap', '-ktx2', png, '-output_file', job.out], { stdout: 'pipe', stderr: 'pipe' });
    if (await proc.exited !== 0) throw new Error(`basisu failed on ${job.out}:\n${await new Response(proc.stdout).text()}\n${await new Response(proc.stderr).text()}`);
    console.log(`modeltex/${job.out.slice(OUT.length + 1)}  ${job.size}²  ${job.kind}  ${(statSync(job.out).size / 1024).toFixed(0)} KB`);
  }
}));
rmSync(tmp, { recursive: true, force: true });
