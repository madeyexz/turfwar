import * as THREE from 'three';
import type { MapDef } from '../../shared/maps/types';
import { LIGHT_MAX, bakeInput, type BakeResult } from './bake';
import type { Theme } from './materials';

/** The share of the sky's light a place that sees no sky still gets (rooms stay readable). */
const FLOOR = 0.25;

function volume(data: Uint8Array, w: number, h: number, d: number) {
  const t = new THREE.Data3DTexture(data, w, h, d);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

/** One set for every material: only one level is on screen at a time. `bakeMix` 0 draws as if nothing was baked. */
const uniforms = {
  bakeMap: { value: volume(new Uint8Array([0, 0, 0, 255]), 1, 1, 1) },
  bakeMin: { value: new THREE.Vector3() },
  bakeInvSize: { value: new THREE.Vector3(1, 1, 1) },
  bakeMix: { value: 0 },
};
export const bakeMix = uniforms.bakeMix;

/** Counts levels, so the light of a level that is gone is dropped when it arrives late. */
let level = 0;

/** A new level: nothing baked until its own light arrives. */
export function clearBake() { level++; uniforms.bakeMix.value = 0; }

/** Work the map's light out in a worker and hand it to the materials (still at `bakeMix` 0: the level fades it in). */
export function loadBake(map: MapDef, theme: Theme): Promise<BakeResult> {
  const sun = theme.sunColor.clone().multiplyScalar(theme.sunIntensity);
  const mine = level;
  return new Promise<BakeResult>((resolve, reject) => {
    const worker = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<BakeResult>) => {
      worker.terminate();
      if (mine !== level) { reject(new Error('level gone')); return; }
      const r = e.data, old = uniforms.bakeMap.value;
      uniforms.bakeMap.value = volume(r.data, r.size[0], r.size[1], r.size[2]);
      old.dispose();
      uniforms.bakeMin.value.fromArray(r.min);
      uniforms.bakeInvSize.value.set(1 / r.extent[0], 1 / r.extent[1], 1 / r.extent[2]);
      resolve(r);
    };
    worker.onerror = e => { worker.terminate(); reject(new Error(e.message)); };
    worker.postMessage(bakeInput(map, [sun.r, sun.g, sun.b]));
  });
}

/**
 * Make every lit material under `root` read the baked light: the sky's light (diffuse and reflected)
 * is cut to the share of sky the place sees, and the stored light of bounced sun and lamps is added.
 * The place is read half a cell off the surface, along its normal, so a wall takes the light of the
 * street it faces. Call once the level's meshes are merged: a material with its own shader no longer
 * merges with its look-alikes (batch.ts).
 */
export function applyBake(root: THREE.Object3D) {
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!(m as THREE.MeshStandardMaterial).isMeshStandardMaterial || m.userData.baked) continue;
      m.userData.baked = true;
      const before = m.onBeforeCompile, key = m.customProgramCacheKey;
      m.onBeforeCompile = (s, r) => {
        before.call(m, s, r);
        Object.assign(s.uniforms, uniforms);
        s.vertexShader = s.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBakeWorld;')
          .replace('#include <project_vertex>', `#include <project_vertex>
          {
            vec4 bakeP = vec4(transformed, 1.0);
            #ifdef USE_BATCHING
              bakeP = batchingMatrix * bakeP;
            #endif
            #ifdef USE_INSTANCING
              bakeP = instanceMatrix * bakeP;
            #endif
            vBakeWorld = (modelMatrix * bakeP).xyz;
          }`);
        s.fragmentShader = s.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform highp sampler3D bakeMap;\nuniform vec3 bakeMin;\nuniform vec3 bakeInvSize;\nuniform float bakeMix;\nvarying vec3 vBakeWorld;')
          .replace('#include <aomap_fragment>', `#include <aomap_fragment>
          {
            vec3 bakeN = inverseTransformDirection(normal, viewMatrix);
            vec4 baked = texture(bakeMap, (vBakeWorld + bakeN * 1.1 - bakeMin) * bakeInvSize);
            float bakeSky = mix(1.0, ${FLOOR.toFixed(2)} + ${(1 - FLOOR).toFixed(2)} * baked.a, bakeMix);
            reflectedLight.indirectDiffuse *= bakeSky;
            reflectedLight.indirectSpecular *= bakeSky;
            reflectedLight.indirectDiffuse += material.diffuseColor * baked.rgb * baked.rgb * (${LIGHT_MAX.toFixed(1)} * RECIPROCAL_PI * bakeMix);
          }`);
      };
      m.customProgramCacheKey = () => `${key.call(m)}|bake`;
      m.needsUpdate = true;
    }
  });
}
