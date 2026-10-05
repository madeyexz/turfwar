import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { applyOptics } from './render/optics';
import { addProceduralGuns } from './render/procguns';

/** Runtime asset registry. All models are CC0 (see public/assets/LICENSE.txt). */
export interface Assets {
  weapons: Map<string, THREE.Object3D>;
  props: Map<string, THREE.Object3D>;
  soldier: GLTF;
  clips: Map<string, THREE.AnimationClip>;
  textures: Map<string, THREE.Texture>;
}

const BASE = import.meta.env.BASE_URL + 'assets/';
const TEXTURE_SETS = ['sand', 'cliff', 'dirt', 'snow', 'icerock', 'moss', 'lichen', 'path', 'concrete', 'metalplate', 'container', 'brick', 'planks', 'corrugated', 'plaster', 'cobble', 'asphalt', 'sidewalk', 'floortile', 'facadetile'];

export async function loadAssets(onProgress: (fraction: number) => void): Promise<Assets> {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress(loaded / total);
  const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  const texLoader = new THREE.TextureLoader(manager);
  const gltf = (name: string) => loader.loadAsync(BASE + name);
  const textures = new Map<string, THREE.Texture>();
  const texturePromises = TEXTURE_SETS.flatMap(set => (['diff', 'nor', 'rough'] as const).map(async kind => {
    const tex = await texLoader.loadAsync(`${BASE}tex/${set}_${kind}.webp`);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    if (kind === 'diff') tex.colorSpace = THREE.SRGBColorSpace;
    textures.set(`${set}_${kind}`, tex);
  }));
  const [weapons, props, soldier, anims, imported] = await Promise.all([
    gltf('weapons.glb'), gltf('props.glb'), gltf('soldier.glb'), gltf('anims.glb'), gltf('guns.glb'), ...texturePromises,
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
