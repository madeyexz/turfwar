import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { initTextures, loadModelTextures, textureBudget } from './textures';

it('puts one real texture in for every stand-in of a name, keeping its sampler, colour space and glTF orientation', async () => {
  const standIn = (name: string, srgb = false) => {
    const t = new THREE.Texture({ width: 1, height: 1 } as unknown as HTMLImageElement);
    t.name = name; t.flipY = false; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.MirroredRepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  // Two GLBs that share a set (weapons.glb and props.glb: T_Props_Batch2_*), each with its own stand-ins.
  const a = new THREE.MeshStandardMaterial({ map: standIn('T_Props_Batch2_BaseColor', true), normalMap: standIn('T_Props_Batch2_Normal') });
  const orm = standIn('T_Props_Batch2_ORM');
  const b = new THREE.MeshStandardMaterial({ map: standIn('T_Props_Batch2_BaseColor', true), roughnessMap: orm, metalnessMap: orm });
  // A texture that is not a stand-in (a real image) stays.
  const own = new THREE.Texture({ width: 64, height: 64 } as unknown as HTMLImageElement); own.name = 'Own';
  const c = new THREE.MeshStandardMaterial({ map: own });
  const root = (m: THREE.Material) => new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), m));
  await loadModelTextures([root(a), root(b), root(c)]);

  expect(a.map).toBe(b.map);
  expect(b.roughnessMap).toBe(b.metalnessMap);
  expect(c.map).toBe(own);
  const map = a.map!;
  expect(map.name).toBe('T_Props_Batch2_BaseColor');
  expect(map.userData.src).toBe('assets/modeltex/T_Props_Batch2_BaseColor.webp');
  expect(map.colorSpace).toBe(THREE.SRGBColorSpace);
  expect(a.normalMap!.colorSpace).not.toBe(THREE.SRGBColorSpace);
  expect([map.flipY, map.wrapS, map.wrapT]).toEqual([false, THREE.RepeatWrapping, THREE.MirroredRepeatWrapping]);
});

it('halves the sign atlas only on Low with ?signs=1024', () => {
  vi.stubGlobal('location', { search: '?signs=1024' });
  try {
    initTextures(undefined, 'low');
    expect(textureBudget().atlas).toEqual({ width: 1024, height: 512 });
    initTextures(undefined, 'medium');
    expect(textureBudget().atlas).toEqual({ width: 4096, height: 4096 });
    vi.stubGlobal('location', { search: '' });
    initTextures(undefined, 'low');
    expect(textureBudget().atlas).toEqual({ width: 2048, height: 1024 });
  } finally { vi.unstubAllGlobals(); }
});
