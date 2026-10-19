import * as THREE from 'three';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { assetUrl } from '../assetUrl';

/**
 * Texture loading and the texture budget. The big image textures (the surface sets)
 * come as KTX2 files (tools/make-ktx2.ts) that a worker transcodes to whatever compressed format
 * the GPU takes (ASTC, ETC2, BC7…), so a 1024² texture costs 0.7–1.4 MB of video memory instead
 * of 5.3 MB as raw RGBA. The Low preset (phones' default) loads the half-size copies in `low/`,
 * shrinks the models' own textures to 512 px and caps the sign atlas at 2048×1024 and anisotropic
 * filtering at 4×. The .webp originals stay as the fallback when KTX2 is unavailable (no
 * WebAssembly, ?ktx2=0) or a file fails.
 */

let low = false;
/**
 * A first load that takes the half-size `low/` copies even above Low (CrazyGames: a smaller download before
 * the first match), until sharpenTextures swaps the preset's own in. The textures it filled with Low copies.
 */
let lowFirst = false;
const softened = new Set<THREE.Texture>();
/** The KTX2 loader (its code loads on demand, beside the first textures), while KTX2 is on. */
let ktx2: Promise<KTX2Loader> | undefined;

/**
 * How much texture this device gets: the largest generated atlas (the signs' canvas), the longest
 * side of a model's own textures and the anisotropy cap.
 */
export const textureBudget = () => ({ low, atlas: low ? { width: 2048, height: 1024 } : { width: 4096, height: 4096 }, modelSize: low ? 512 : 4096, anisotropy: low ? 4 : 8 });

/**
 * Shrink the textures models bring in their GLB (soldier, guns, the trim sheets) to the budget's
 * size, once, before they are first drawn: on Low a 1024² map costs a quarter of its 5.3 MB.
 */
export function fitModelTextures(root: THREE.Object3D) {
  const max = textureBudget().modelSize, done = new Set<THREE.Source>();
  root.traverse(o => {
    const material = (o as THREE.Mesh).material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) for (const value of Object.values(m)) {
      const t = value as THREE.Texture | null;
      if (!t?.isTexture || (t as THREE.CompressedTexture).isCompressedTexture || done.has(t.source)) continue;
      done.add(t.source);
      const image = t.image as ImageBitmap | HTMLImageElement | undefined;
      if (!image?.width || Math.max(image.width, image.height) <= max) continue;
      const k = max / Math.max(image.width, image.height), canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * k); canvas.height = Math.round(image.height * k);
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      if ('close' in image) image.close();
      t.source.data = canvas; t.source.needsUpdate = true;
    }
  });
}

/** A model texture's stand-in in its GLB: tools/make-model-textures.ts leaves a 1×1 image there, the real one is in assets/modeltex/. */
const isStandIn = (t: THREE.Texture) => {
  const image = t.image as { width?: number } | undefined;
  return !!t.name && !!image?.width && image.width <= 4 && !(t as THREE.CompressedTexture).isCompressedTexture;
};
/** The model textures by name, each loaded once for every model that uses it (weapons.glb and props.glb share a set). */
const modelTextures = new Map<string, { texture: THREE.Texture; ready: Promise<THREE.Texture> }>();

/**
 * Put the real textures into models whose GLB holds stand-ins (soldier, weapons, props): from
 * assets/modeltex/<name>.ktx2 (512 px under low/ on Low) transcoded to the GPU's own format, or
 * the .webp original when KTX2 is off (then fitModelTextures shrinks it to the budget). Each keeps
 * the stand-in's name, sampler, colour space and UV channel. Resolves once all have arrived.
 */
export async function loadModelTextures(roots: THREE.Object3D[], manager?: THREE.LoadingManager) {
  const waits: Promise<unknown>[] = [];
  for (const root of roots) root.traverse(o => {
    const material = (o as THREE.Mesh).material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) for (const [slot, value] of Object.entries(m)) {
      const standIn = value as THREE.Texture | null;
      if (!standIn?.isTexture || !isStandIn(standIn)) continue;
      let entry = modelTextures.get(standIn.name);
      if (!entry) {
        entry = loadTexture(`assets/modeltex/${standIn.name}.webp`, { srgb: standIn.colorSpace === THREE.SRGBColorSpace, anisotropy: standIn.anisotropy, manager, flipY: false });
        const t = entry.texture;
        t.name = standIn.name;
        t.wrapS = standIn.wrapS; t.wrapT = standIn.wrapT; t.channel = standIn.channel;
        modelTextures.set(standIn.name, entry);
      }
      (m as unknown as Record<string, THREE.Texture>)[slot] = entry.texture;
      standIn.dispose();
      waits.push(entry.ready.catch(() => undefined));
    }
  });
  await Promise.all(waits);
  for (const root of roots) fitModelTextures(root);
}

/**
 * Set up texture loading for this renderer and quality preset (once, before the first texture
 * loads; the preset's textures stay until the page reloads). Without a renderer (tools, tests)
 * textures load from the .webp files.
 */
export function initTextures(renderer: THREE.WebGLRenderer | undefined, quality: string, opts: { lowFirst?: boolean } = {}) {
  low = quality === 'low' || quality === 'test';
  lowFirst = !low && !!opts.lowFirst; softened.clear();
  void ktx2?.then(l => l.dispose(), () => undefined); ktx2 = undefined;
  const off = typeof location !== 'undefined' && new URLSearchParams(location.search).get('ktx2') === '0';
  if (!renderer || off || typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') return;
  // The transcoder (public/assets/basis, copied from three by tools/make-ktx2.ts) is asked for with its content version.
  const manager = new THREE.LoadingManager();
  const dir = `${import.meta.env.BASE_URL}assets/basis/`;
  manager.setURLModifier(url => url.startsWith(dir) ? assetUrl(`assets/basis/${url.slice(dir.length)}`) : url);
  ktx2 = import('three/examples/jsm/loaders/KTX2Loader.js').then(m => new m.KTX2Loader(manager).setTranscoderPath(dir).detectSupport(renderer));
}

/** The KTX2 copy of a public/ image (`assets/tex/brick_diff.webp` → `assets/tex/low/brick_diff.ktx2` on Low). */
const ktx2Path = (webp: string, small = low) => {
  const slash = webp.lastIndexOf('/') + 1;
  return `${webp.slice(0, slash)}${small ? 'low/' : ''}${webp.slice(slash).replace(/\.webp$/, '.ktx2')}`;
};

/**
 * An image texture from public/ (`path` names the .webp original), returned at once and filled in
 * when it arrives: `ready` resolves then (and rejects if neither the KTX2 copy nor the .webp loads).
 * `manager` sees the load start and end (the loading bar).
 */
export function loadTexture(path: string, opts: { srgb?: boolean; repeat?: boolean; anisotropy?: number; manager?: THREE.LoadingManager; flipY?: boolean } = {}) {
  const loader = ktx2;
  // `flipY: false` (glTF's convention, the model textures): the image's top row is v = 0, and its KTX2 copy is stored as is.
  const flip = opts.flipY ?? true;
  // A compressed texture cannot later become an image one (or back), so the kind is chosen now.
  const texture: THREE.Texture = loader ? new THREE.CompressedTexture([], 0, 0) : new THREE.Texture();
  if (!loader) texture.flipY = flip;
  if (opts.repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.min(opts.anisotropy ?? 8, textureBudget().anisotropy);
  if (opts.srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.src = path;
  const url = assetUrl(path);
  opts.manager?.itemStart(url);
  const ready = (async () => {
    if (loader) {
      const soft = lowFirst;
      try {
        fillCompressed(texture, await (await loader).loadAsync(assetUrl(ktx2Path(path, low || soft))));
        // A Low copy that arrives after the swap began is swapped by itself.
        if (soft) { if (lowFirst) softened.add(texture); else void sharpen(texture); }
        return;
      } catch (error) { console.warn('KTX2 texture failed, using', path, error); }
      fillPixels(texture, await new THREE.ImageLoader().loadAsync(url), flip);
    } else {
      texture.image = await new THREE.ImageLoader().loadAsync(url);
      texture.needsUpdate = true;
    }
  })();
  ready.then(() => opts.manager?.itemEnd(url), () => { opts.manager?.itemError(url); opts.manager?.itemEnd(url); });
  return { texture, ready: ready.then(() => texture) };
}

/**
 * Swap the Low copies of a low-first load for the preset's own, one file at a time in the background (each
 * texture keeps its Low copy if its file fails); textures loaded from now on come at full size at once.
 */
export async function sharpenTextures() {
  if (!lowFirst) return;
  lowFirst = false;
  const waiting = [...softened]; softened.clear();
  for (const texture of waiting) await sharpen(texture);
}

async function sharpen(texture: THREE.Texture) {
  const loader = ktx2;
  if (!loader) return;
  try {
    const full = await (await loader).loadAsync(assetUrl(ktx2Path(texture.userData.src as string, false)));
    // The GPU copy has the old size (and immutable storage): free it, the next draw makes a new one.
    texture.dispose();
    fillCompressed(texture, full);
  } catch (error) { console.warn('Sharper texture failed, keeping the small one', texture.userData.src, error); }
}

/** Move a transcoded texture's levels into the texture handed out earlier (keeping its wrapping, filtering and colour space). */
function fillCompressed(target: THREE.Texture, loaded: THREE.Texture) {
  const t = loaded as THREE.CompressedTexture, out = target as THREE.CompressedTexture;
  out.image = t.image; out.mipmaps = t.mipmaps;
  out.format = t.format; out.type = t.type;
  out.minFilter = t.minFilter; out.magFilter = t.magFilter;
  out.generateMipmaps = false;
  out.userData.compressed = true;
  out.needsUpdate = true;
}

/** The .webp fallback for a texture that is already compressed-kind: its pixels as uncompressed RGBA, mipmapped by the GPU. */
function fillPixels(target: THREE.Texture, image: HTMLImageElement, flip: boolean) {
  const { width, height } = image, canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  // Compressed textures are not flipped on upload: flip here, as the KTX2 files are (all but the models').
  if (flip) { c.translate(0, height); c.scale(1, -1); }
  c.drawImage(image, 0, 0);
  const out = target as THREE.CompressedTexture;
  out.image = { width, height } as never;
  out.mipmaps = [{ data: new Uint8Array(c.getImageData(0, 0, width, height).data.buffer), width, height }] as never;
  // RGBA in a compressed texture's levels is uploaded as plain pixels (three's own KTX2 fallback does the same).
  out.format = THREE.RGBAFormat as never; out.type = THREE.UnsignedByteType;
  out.minFilter = THREE.LinearMipmapLinearFilter; out.magFilter = THREE.LinearFilter;
  out.generateMipmaps = true;
  out.needsUpdate = true;
}
