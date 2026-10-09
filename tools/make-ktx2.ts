/**
 * GPU-compressed copies of the big textures: the surface sets (public/assets/tex/*.webp) and the
 * Taipei district atlas become KTX2 (Basis Universal) files that the game transcodes to the GPU's
 * own format (ASTC, ETC2, BC7…) instead of unpacking to raw RGBA: a 1024² texture costs the GPU
 * 0.7–1.4 MB instead of 5.3 MB. The .webp files stay the source and the fallback.
 *
 *   public/assets/tex/<set>_<kind>.ktx2       1024², for Medium and High
 *   public/assets/tex/low/<set>_<kind>.ktx2   512², for Low (phones' default)
 *   public/assets/taipei-atlas.ktx2           4096×2048 (stretched from 4096×1664; UVs are relative)
 *   public/assets/low/taipei-atlas.ktx2       2048×1024
 *
 * Colour and roughness are ETC1S (small files, 4 bpp on phones); normal maps are UASTC + Zstandard
 * on Low (the codec that keeps normals clean) and ETC1S tuned for normals at 1024 (a quarter of
 * UASTC's download for the desktop set, where the extra pixels hide its blocks). Every file has
 * mipmaps and is stored bottom-up (`-y_flip`), as WebGL samples it, so it lines up with the .webp.
 * Sizes are powers of two, which every compressed format accepts at every mip level.
 *
 * It also copies three's Basis transcoder (node_modules/three/examples/jsm/libs/basis) into
 * public/assets/basis, so it is versioned and cached like any asset; re-run after updating three.
 *
 * Needs `basisu` from Basis Universal 2.x (its -quality and -effort options; tested with 2.50, `brew install basis_universal`).
 * Run: bun tools/make-ktx2.ts [name …]   (names: a set like `brick`, or `atlas`; none = everything)
 */
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const ASSETS = join(ROOT, 'public/assets');
const SETS = ['concrete', 'metalplate', 'container', 'brick', 'planks', 'corrugated', 'plaster', 'cobble', 'moss', 'asphalt', 'sidewalk', 'floortile', 'facadetile',
  'sand', 'cliff', 'dirt', 'snow', 'icerock', 'lichen', 'path'];

const ETC1S = ['-etc1s', '-quality', '100', '-effort', '5'];
const UASTC_NORMAL = ['-uastc', '-quality', '70', '-effort', '4', '-normal_map', '-mip_renorm'];
const ETC1S_NORMAL = [...ETC1S, '-normal_map', '-mip_renorm'];

interface Job { name: string; src: string; out: string; width: number; height: number; args: string[] }
const jobs: Job[] = [];
for (const set of SETS) for (const kind of ['diff', 'nor', 'rough'] as const) {
  const src = join(ASSETS, `tex/${set}_${kind}.webp`);
  const codec = (low: boolean) => kind === 'nor' ? (low ? UASTC_NORMAL : ETC1S_NORMAL) : kind === 'rough' ? [...ETC1S, '-linear'] : [...ETC1S, '-srgb'];
  jobs.push({ name: set, src, out: join(ASSETS, `tex/${set}_${kind}.ktx2`), width: 1024, height: 1024, args: codec(false) });
  jobs.push({ name: set, src, out: join(ASSETS, `tex/low/${set}_${kind}.ktx2`), width: 512, height: 512, args: codec(true) });
}
// The atlas keeps its alpha (the district's glow cards use it) and must not wrap when it is mipmapped.
for (const [out, width, height] of [['taipei-atlas.ktx2', 4096, 2048], ['low/taipei-atlas.ktx2', 2048, 1024]] as const) {
  jobs.push({ name: 'atlas', src: join(ASSETS, 'taipei-atlas.webp'), out: join(ASSETS, out), width, height, args: [...ETC1S, '-srgb', '-mip_clamp'] });
}

if (spawnSync('basisu', ['-version']).status !== 0) {
  console.error('basisu not found: install Basis Universal (`brew install basis_universal`, or build https://github.com/BinomialLLC/basis_universal).');
  process.exit(1);
}
const only = process.argv.slice(2);
const todo = jobs.filter(j => !only.length || only.includes(j.name));
const tmp = mkdtempSync(join(tmpdir(), 'make-ktx2-'));

async function run(job: Job, i: number) {
  // basisu reads PNG, not WebP: resize (Lanczos) into a temporary PNG first.
  const png = join(tmp, `${i}.png`);
  await sharp(job.src).resize(job.width, job.height, { fit: 'fill' }).png().toFile(png);
  mkdirSync(dirname(job.out), { recursive: true });
  const proc = Bun.spawn(['basisu', ...job.args, '-mipmap', '-y_flip', '-ktx2', png, '-output_file', job.out], { stdout: 'pipe', stderr: 'pipe' });
  if (await proc.exited !== 0) throw new Error(`basisu failed on ${job.out}:\n${await new Response(proc.stdout).text()}\n${await new Response(proc.stderr).text()}`);
  console.log(`${job.out.slice(ASSETS.length + 1)}  ${job.width}×${job.height}  ${(statSync(job.out).size / 1024).toFixed(0)} KB`);
}

// basisu threads itself; a few files at once keeps every core busy through the single-threaded parts.
let next = 0;
await Promise.all(Array.from({ length: 3 }, async () => { while (next < todo.length) { const i = next++; await run(todo[i], i); } }));
rmSync(tmp, { recursive: true, force: true });

const basis = join(ROOT, 'node_modules/three/examples/jsm/libs/basis');
mkdirSync(join(ASSETS, 'basis'), { recursive: true });
for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) copyFileSync(join(basis, f), join(ASSETS, 'basis', f));
console.log('copied the Basis transcoder to public/assets/basis');
