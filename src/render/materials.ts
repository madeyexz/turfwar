import * as THREE from 'three';
import type { Assets } from '../assets';
import type { ThemeId } from '../../shared/maps/types';

export interface Theme {
  id: ThemeId;
  ground: string; rock: string; dirt: string;
  groundTint: THREE.Color; rockTint: THREE.Color; dirtTint: THREE.Color;
  skyTop: THREE.Color; skyHorizon: THREE.Color; fog: THREE.Color; fogDensity: number;
  sunColor: THREE.Color; sunIntensity: number; hemiSky: THREE.Color; hemiGround: THREE.Color; hemiIntensity: number;
  planet: THREE.Color; exposure: number;
}

export const THEMES: Record<ThemeId, Theme> = {
  desert: {
    id: 'desert', ground: 'sand', rock: 'cliff', dirt: 'dirt',
    groundTint: new THREE.Color(1.08, 0.86, 0.66), rockTint: new THREE.Color(0.95, 0.72, 0.56), dirtTint: new THREE.Color(1.0, 0.82, 0.66),
    skyTop: new THREE.Color(0x3a6f9c), skyHorizon: new THREE.Color(0xe9c39a), fog: new THREE.Color(0xd8b48e), fogDensity: 0.0042,
    sunColor: new THREE.Color(0xffdcb0), sunIntensity: 3.6, hemiSky: new THREE.Color(0xa9c8e8), hemiGround: new THREE.Color(0x8a6447), hemiIntensity: 1.25,
    planet: new THREE.Color(0xd9a27a), exposure: 1.0,
  },
  snow: {
    id: 'snow', ground: 'snow', rock: 'icerock', dirt: 'icerock',
    groundTint: new THREE.Color(0.95, 0.98, 1.05), rockTint: new THREE.Color(0.5, 0.58, 0.7), dirtTint: new THREE.Color(0.72, 0.78, 0.86),
    skyTop: new THREE.Color(0x48688e), skyHorizon: new THREE.Color(0xc9d8e6), fog: new THREE.Color(0xbccbd9), fogDensity: 0.006,
    sunColor: new THREE.Color(0xe8f0ff), sunIntensity: 2.6, hemiSky: new THREE.Color(0xc8dcf0), hemiGround: new THREE.Color(0x7d8a99), hemiIntensity: 1.5,
    planet: new THREE.Color(0xb7c4e8), exposure: 0.92,
  },
  forest: {
    id: 'forest', ground: 'moss', rock: 'lichen', dirt: 'path',
    groundTint: new THREE.Color(0.72, 1.0, 0.55), rockTint: new THREE.Color(0.72, 0.8, 0.74), dirtTint: new THREE.Color(0.9, 0.84, 0.72),
    skyTop: new THREE.Color(0x2f6f86), skyHorizon: new THREE.Color(0xb9d6c9), fog: new THREE.Color(0x9fc0b4), fogDensity: 0.0055,
    sunColor: new THREE.Color(0xfff0d0), sunIntensity: 3.1, hemiSky: new THREE.Color(0xb8e0d8), hemiGround: new THREE.Color(0x4f5f3d), hemiIntensity: 1.35,
    planet: new THREE.Color(0x9fd6c6), exposure: 0.98,
  },
};

/** Terrain: world-space planar ground with triplanar rock on slopes and dirt along a splat channel. */
export function terrainMaterial(assets: Assets, theme: Theme) {
  const t = (name: string) => assets.textures.get(name)!;
  const material = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      tGround: { value: t(`${theme.ground}_diff`) }, tGroundN: { value: t(`${theme.ground}_nor`) },
      tRock: { value: t(`${theme.rock}_diff`) }, tRockN: { value: t(`${theme.rock}_nor`) },
      tDirt: { value: t(`${theme.dirt}_diff`) }, tDirtN: { value: t(`${theme.dirt}_nor`) },
      groundTint: { value: theme.groundTint }, rockTint: { value: theme.rockTint }, dirtTint: { value: theme.dirtTint },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float splat;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vSplat;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);\nvSplat = splat;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tGround; uniform sampler2D tGroundN; uniform sampler2D tRock; uniform sampler2D tRockN; uniform sampler2D tDirt; uniform sampler2D tDirtN;
uniform vec3 groundTint; uniform vec3 rockTint; uniform vec3 dirtTint;
varying vec3 vWPos; varying vec3 vWNormal; varying float vSplat;
vec3 triplanar(sampler2D tex, vec3 p, vec3 w, float s) {
  return texture2D(tex, p.zy / s).rgb * w.x + texture2D(tex, p.xz / s).rgb * w.y + texture2D(tex, p.xy / s).rgb * w.z;
}
vec3 nTriplanar(sampler2D tex, vec3 p, vec3 n, vec3 w, float s) {
  // UDN blend of tangent-space normals for each projection axis.
  vec3 tx = texture2D(tex, p.zy / s).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(tex, p.xz / s).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(tex, p.xy / s).xyz * 2.0 - 1.0;
  vec3 nx = vec3(0.0, tx.y, tx.x) * sign(n.x);
  vec3 ny = vec3(ty.x, 0.0, ty.y) * sign(n.y);
  vec3 nz = vec3(tz.x, tz.y, 0.0) * sign(n.z);
  return normalize(n + (nx * w.x + ny * w.y + nz * w.z) * 0.9);
}
float slopeMix() { return smoothstep(0.86, 0.66, normalize(vWNormal).y); }`)
      .replace('#include <map_fragment>', `
vec3 wn = normalize(vWNormal);
vec3 bw = pow(abs(wn), vec3(5.0)); bw /= dot(bw, vec3(1.0));
float slope = slopeMix();
vec2 guv = vWPos.xz / 7.0;
float macro = texture2D(tGround, vWPos.xz / 97.0).g * 0.55 + texture2D(tDirt, vWPos.xz / 61.0).r * 0.45;
vec3 groundCol = texture2D(tGround, guv).rgb * mix(0.82, 1.18, macro) * groundTint;
vec3 dirtCol = texture2D(tDirt, vWPos.xz / 5.0).rgb * dirtTint;
vec3 rockCol = triplanar(tRock, vWPos, bw, 9.0) * rockTint;
float dirt = clamp(vSplat + (macro - 0.5) * 0.6, 0.0, 1.0);
dirt = smoothstep(0.35, 0.75, dirt);
vec3 col = mix(mix(groundCol, dirtCol, dirt), rockCol, slope);
diffuseColor.rgb *= col;`)
      .replace('#include <normal_fragment_maps>', `
{
  vec3 nG = texture2D(tGroundN, guv).xyz * 2.0 - 1.0;
  vec3 nD = texture2D(tDirtN, vWPos.xz / 5.0).xyz * 2.0 - 1.0;
  vec3 flatN = mix(nG, nD, dirt);
  vec3 groundN = normalize(wn + vec3(flatN.x, 0.0, flatN.y) * 0.8);
  vec3 rockN = nTriplanar(tRockN, vWPos, wn, bw, 9.0);
  vec3 worldN = normalize(mix(groundN, rockN, slope));
  normal = normalize((viewMatrix * vec4(worldN, 0.0)).xyz);
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.95, 0.82, slope);');
  };
  return material;
}

/**
 * Box-mapped PBR material for architecture. UVs are generated in world space by the level
 * builder so textures tile consistently across differently sized blocks.
 */
export function surfaceMaterial(assets: Assets, set: string, opts: { color?: number; roughness?: number; metalness?: number; normalScale?: number; emissive?: number } = {}) {
  const material = new THREE.MeshStandardMaterial({
    map: assets.textures.get(`${set}_diff`), normalMap: assets.textures.get(`${set}_nor`), roughnessMap: assets.textures.get(`${set}_rough`),
    color: opts.color ?? 0xffffff, roughness: opts.roughness ?? 1, metalness: opts.metalness ?? 0,
    normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1), vertexColors: true,
  });
  if (opts.emissive) material.emissive = new THREE.Color(opts.emissive);
  return material;
}

/** Pull the shared trim-sheet material out of a kit piece so procedural blocks can reuse it. */
export function kitMaterial(assets: Assets, model: string): THREE.MeshStandardMaterial | undefined {
  let found: THREE.MeshStandardMaterial | undefined;
  assets.props.get(model)?.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m && !found) found = m; });
  return found;
}

/** Animated hexagonal energy field used for spawn shields. */
export function shieldMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, color: { value: color } },
    vertexShader: 'varying vec3 vP; varying vec2 vUv; void main(){ vUv = uv; vP = (modelMatrix * vec4(position,1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vP,1.); }',
    fragmentShader: `uniform float time; uniform vec3 color; varying vec3 vP; varying vec2 vUv;
      float hex(vec2 p){ p.x *= 1.1547; p.y += mod(floor(p.x), 2.0) * 0.5; p = abs(fract(p) - 0.5); return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0); }
      void main(){
        float h = hex(vec2(vP.z + vP.x, vP.y) * 1.6);
        float edge = smoothstep(0.1, 0.0, h);
        float scan = 0.5 + 0.5 * sin(vP.y * 3.0 - time * 2.5);
        float fade = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
        gl_FragColor = vec4(color * (0.12 + edge * 0.55 + scan * 0.08), (0.12 + edge * 0.5) * fade);
      }`,
  });
}
