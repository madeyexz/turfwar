import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { assetUrl } from './assetUrl';
import { CREW } from './game/crew';
import type { KnifeSkin } from '../shared/skins';
import { broomModel, slipperModel } from './render/meme';
import { applyOptics } from './render/optics';
import { addProceduralGuns } from './render/procguns';
import { initTextures, loadModelTextures, loadTexture } from './render/textures';

/** Runtime asset registry. All models are CC0 (see public/assets/LICENSE.txt). */
export interface Assets {
  weapons: Map<string, THREE.Object3D>;
  props: Map<string, THREE.Object3D>;
  /** The Universal Base Characters soldier: the classic third-person soldier (`?soldiers=classic`) and, always, the first-person arms. */
  soldier: GLTF;
  /** The clips of whichever soldiers are drawn (src/game/crew.ts). */
  clips: Map<string, THREE.AnimationClip>;
  /** The Modular Men crew (the default): one named root per character. */
  crew?: THREE.Object3D;
  textures: TextureSets;
}

/** Surface sets every map builds with (src/render/level.ts): loaded with the models. */
const SHARED_SETS = ['concrete', 'metalplate', 'container', 'brick', 'planks', 'corrugated', 'plaster', 'cobble', 'moss', 'asphalt', 'sidewalk', 'floortile', 'facadetile'];
/** Ground sets only some maps' terrain uses (their theme's ground, rock and dirt): loaded with the first map that needs them. */
const GROUND_SETS = ['sand', 'cliff', 'dirt', 'snow', 'icerock', 'lichen', 'path'];
const KINDS = ['diff', 'nor', 'rough'] as const;

/**
 * The surface textures (`<set>_<diff|nor|rough>`), each set loaded once, when first wanted: KTX2
 * (GPU-compressed, half size on Low) or the WebP originals, see src/render/textures.ts.
 */
export class TextureSets {
  private textures = new Map<string, THREE.Texture>();
  private sets = new Map<string, Promise<void>>();
  constructor(private manager?: THREE.LoadingManager) {}

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
      loading = Promise.all(KINDS.map(kind => {
        const { texture, ready } = loadTexture(`assets/tex/${set}_${kind}.webp`, { srgb: kind === 'diff', repeat: true, manager: this.manager });
        this.textures.set(`${set}_${kind}`, texture);
        return ready;
      })).then(() => undefined);
      this.sets.set(set, loading);
    }
    return loading;
  }
}

/** The ground sets a map's terrain uses (its theme's ground, rock and dirt). */
export const groundSets = (theme: { ground: string; rock: string; dirt: string }) => [...new Set([theme.ground, theme.rock, theme.dirt])];

/**
 * Load the models, animations and shared surface textures. `gpu` (the renderer and the quality preset's
 * name) lets textures come GPU-compressed and sized for the preset; without it they load as WebP.
 * `onFileError` hears each file that failed to load (its URL).
 */
export async function loadAssets(onProgress: (fraction: number) => void, gpu?: { renderer: THREE.WebGLRenderer; quality: string; lowFirst?: boolean }, onFileError?: (url: string) => void): Promise<Assets> {
  initTextures(gpu?.renderer, gpu?.quality ?? 'medium', { lowFirst: gpu?.lowFirst });
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress(loaded / total);
  if (onFileError) manager.onError = onFileError;
  const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  const textures = new TextureSets(manager);
  const gltf = (name: string) => loader.loadAsync(assetUrl(`assets/${name}`));
  const [weapons, props, soldier, anims, imported, crew] = await Promise.all([
    gltf('weapons.glb'), gltf('props.glb'), gltf('soldier.glb'), gltf(CREW ? 'soldier-anims.glb' : 'anims.glb'), gltf('guns.glb'), CREW ? gltf('soldiers.glb') : undefined, textures.load(SHARED_SETS),
  ]) as GLTF[];
  // The GLBs hold 1×1 stand-ins for their textures (the real ones load here, GPU-compressed where the browser can).
  await loadModelTextures([weapons, props, soldier, imported].map(g => g.scene), manager);
  if (crew) restoreBoneNames(crew.scene);
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
  // The knife skins (shared/skins.ts): each view picks its soldier's (knifeModel).
  guns.set(KNIFE_MODELS.slipper, slipperModel());
  guns.set(KNIFE_MODELS.gold, slipperModel(true));
  guns.set(KNIFE_MODELS.broom, broomModel());
  return {
    weapons: guns, props: named(props), soldier, crew: crew?.scene,
    clips: new Map(anims.animations.map(c => [c.name, c])),
    textures,
  };
}

/** The weapons-map model of each knife skin ('Gun_Knife' is the pack's own knife). */
export const KNIFE_MODELS: Record<KnifeSkin, string> = { knife: 'Gun_Knife', slipper: 'Knife_Slipper', gold: 'Knife_GoldSlipper', broom: 'Knife_Broom' };
/** The model a weapon is drawn with: the knife's follows the skin. */
export const weaponModel = (model: string, knife: KnifeSkin) => (model === 'Gun_Knife' ? KNIFE_MODELS[knife] : model);

/**
 * GLTFLoader makes node names unique across a file (`Head`, `Head_1` ...), but every character of
 * soldiers.glb has the same bone names (and shares the clips, which bind by name): put them back.
 */
function restoreBoneNames(scene: THREE.Object3D) {
  const first = scene.children[0], known = new Set<string>();
  first.traverse(o => known.add(o.name));
  for (const character of scene.children.slice(1)) {
    character.traverse(o => { const base = o.name.replace(/_\d+$/, ''); if (!known.has(o.name) && known.has(base)) o.name = base; });
  }
}

/** Bounding box of a model in its own space, cached per object. */
const boxCache = new WeakMap<THREE.Object3D, THREE.Box3>();
export function modelBox(o: THREE.Object3D) {
  let box = boxCache.get(o);
  if (!box) { o.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(o); boxCache.set(o, box); }
  return box;
}
