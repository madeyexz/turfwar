import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { assetUrl } from './assetUrl';
import { MEME_SKINS } from './game/memeskins';
import { slipperModel } from './render/meme';
import { applyOptics } from './render/optics';
import { addProceduralGuns } from './render/procguns';

/** Runtime asset registry. All models are CC0 (see public/assets/LICENSE.txt). */
export interface Assets {
  weapons: Map<string, THREE.Object3D>;
  props: Map<string, THREE.Object3D>;
  soldier: GLTF;
  clips: Map<string, THREE.AnimationClip>;
  textures: TextureSets;
}

/** Surface sets every map builds with (src/render/level.ts): loaded with the models. */
const SHARED_SETS = ['concrete', 'metalplate', 'container', 'brick', 'planks', 'corrugated', 'plaster', 'cobble', 'moss', 'asphalt', 'sidewalk', 'floortile', 'facadetile'];
/** Ground sets only some maps' terrain uses (their theme's ground, rock and dirt): loaded with the first map that needs them. */
const GROUND_SETS = ['sand', 'cliff', 'dirt', 'snow', 'icerock', 'lichen', 'path'];
const KINDS = ['diff', 'nor', 'rough'] as const;

/** The surface textures (`<set>_<diff|nor|rough>`), each set loaded once, when first wanted. */
export class TextureSets {
  private textures = new Map<string, THREE.Texture>();
  private sets = new Map<string, Promise<void>>();
  constructor(private loader: THREE.TextureLoader) {}

  /** Load these sets; resolves once all their textures are in (a set that fails just stays blank). */
  load(sets: readonly string[]) { return Promise.all(sets.map(set => this.loadSet(set).catch(() => undefined))).then(() => undefined); }

  /** A texture by name. One whose set has not been loaded starts loading now and shows when it arrives. */
  get(name: string) {
    const set = name.slice(0, name.lastIndexOf('_'));
    if (!this.textures.has(name) && (SHARED_SETS.includes(set) || GROUND_SETS.includes(set))) void this.loadSet(set).catch(() => undefined);
    return this.textures.get(name);
  }

  private loadSet(set: string) {
    let loading = this.sets.get(set);
    if (!loading) {
      loading = Promise.all(KINDS.map(kind => new Promise<void>((resolve, reject) => {
        const tex = this.loader.load(assetUrl(`assets/tex/${set}_${kind}.webp`), () => resolve(), undefined, reject);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 8;
        if (kind === 'diff') tex.colorSpace = THREE.SRGBColorSpace;
        this.textures.set(`${set}_${kind}`, tex);
      }))).then(() => undefined);
      this.sets.set(set, loading);
    }
    return loading;
  }
}

/** The ground sets a map's terrain uses (its theme's ground, rock and dirt). */
export const groundSets = (theme: { ground: string; rock: string; dirt: string }) => [...new Set([theme.ground, theme.rock, theme.dirt])];

export async function loadAssets(onProgress: (fraction: number) => void): Promise<Assets> {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress(loaded / total);
  const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  const textures = new TextureSets(new THREE.TextureLoader(manager));
  const gltf = (name: string) => loader.loadAsync(assetUrl(`assets/${name}`));
  const [weapons, props, soldier, anims, imported] = await Promise.all([
    gltf('weapons.glb'), gltf('props.glb'), gltf('soldier.glb'), gltf('anims.glb'), gltf('guns.glb'), textures.load(SHARED_SETS),
  ]) as GLTF[];
  const named = (g: GLTF) => {
    const map = new Map<string, THREE.Object3D>();
    for (const child of g.scene.children) {
      child.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      map.set(child.name, child);
    }
    return map;
  };
  const guns = named(weapons);
  for (const [name, gun] of named(imported)) guns.set(name, gun);
  addProceduralGuns(guns);
  applyOptics(guns);
  // The 藍白拖 reskin: every view of the knife (first person, soldiers, the store) shows the slipper.
  if (MEME_SKINS) guns.set('Gun_Knife', slipperModel());
  return {
    weapons: guns, props: named(props), soldier,
    clips: new Map(anims.animations.map(c => [c.name, c])),
    textures,
  };
}

/** Bounding box of a model in its own space, cached per object. */
const boxCache = new WeakMap<THREE.Object3D, THREE.Box3>();
export function modelBox(o: THREE.Object3D) {
  let box = boxCache.get(o);
  if (!box) { o.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(o); boxCache.set(o, box); }
  return box;
}
