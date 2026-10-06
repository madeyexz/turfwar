import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Theme } from './materials';
import { ScopePass } from './sights';
import { SkyView } from './sky';

export interface Quality { pixelRatio: number; shadows: number; bloom: boolean }
/** 'test' exists for software-rendered automation (no GPU); it is not a player-facing preset. */
export const QUALITY: Record<'low' | 'medium' | 'high' | 'test', Quality> = {
  low: { pixelRatio: 0.85, shadows: 1024, bloom: false },
  medium: { pixelRatio: 1, shadows: 2048, bloom: true },
  high: { pixelRatio: 1.5, shadows: 2048, bloom: true },
  test: { pixelRatio: 0.5, shadows: 0, bloom: false },
};

/** Owns the WebGL renderer, world scene, first-person overlay scene and post-processing. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** Near plane 0.1 m: the collision radius (0.38 m) keeps it clear of walls, and it doubles depth precision over 0.05. */
  readonly camera = new THREE.PerspectiveCamera(78, 1, 0.1, 4000);
  /** First-person weapon rendered on top with its own projection (never clips into walls). */
  readonly viewScene = new THREE.Scene();
  readonly viewCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  sky?: SkyView;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private sunOffset = new THREE.Vector3(-50, 70, 40);
  /** Picture-in-picture scope view, rendered only while the view model asks for it (a magnified optic raised). */
  private scope = new ScopePass();
  quality: Quality;

  constructor(container: HTMLElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = quality.shadows > 0;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.prepend(this.renderer.domElement);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera, this.sun, this.sun.target, this.hemi);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    // View-model lighting mirrors the world sun.
    const vmSun = new THREE.DirectionalLight(0xffffff, 2.2), vmHemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.1);
    vmSun.name = 'vmSun'; vmHemi.name = 'vmHemi';
    this.viewScene.add(vmSun, vmHemi, this.viewCamera);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const overlay = new RenderPass(this.viewScene, this.viewCamera);
    overlay.clear = false; overlay.clearDepth = true;
    this.composer.addPass(overlay);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.45, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.applyQuality(quality);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  applyQuality(q: Quality) {
    this.quality = q;
    this.sun.castShadow = q.shadows > 0;
    this.sun.shadow.mapSize.set(Math.max(256, q.shadows), Math.max(256, q.shadows));
    this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    this.bloom.enabled = q.bloom;
    this.resize();
  }

  setTheme(theme: Theme, sunDir: { x: number; y: number; z: number }) {
    const dir = new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z).normalize();
    this.sunOffset.copy(dir).multiplyScalar(120);
    this.sun.color.copy(theme.sunColor); this.sun.intensity = theme.sunIntensity;
    this.hemi.color.copy(theme.hemiSky); this.hemi.groundColor.copy(theme.hemiGround); this.hemi.intensity = theme.hemiIntensity;
    this.scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);
    this.renderer.toneMappingExposure = theme.exposure;
    if (this.sky) this.scene.remove(this.sky.mesh);
    this.sky = new SkyView(theme, dir);
    this.scene.add(this.sky.mesh);
    // Image-based lighting from the sky so metals and armor read correctly.
    const envScene = new THREE.Scene();
    envScene.add(new SkyView(theme, dir).mesh);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment?.dispose();
    this.scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = 0.55;
    this.viewScene.environment = this.scene.environment;
    this.viewScene.environmentIntensity = 0.7;
    pmrem.dispose();
    const vmSun = this.viewScene.getObjectByName('vmSun') as THREE.DirectionalLight;
    vmSun.color.copy(theme.sunColor); vmSun.intensity = theme.sunIntensity * 0.7; vmSun.position.copy(dir);
    const vmHemi = this.viewScene.getObjectByName('vmHemi') as THREE.HemisphereLight;
    vmHemi.color.copy(theme.hemiSky); vmHemi.groundColor.copy(theme.hemiGround); vmHemi.intensity = theme.hemiIntensity;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const ratio = Math.min(devicePixelRatio, this.quality.pixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * ratio / 2, h * ratio / 2);
    this.camera.aspect = this.viewCamera.aspect = w / h;
    this.camera.updateProjectionMatrix(); this.viewCamera.updateProjectionMatrix();
  }

  render(time: number) {
    this.renderer.info.reset();
    // Keep the shadow frustum centered on the player, snapped to texels to avoid shimmering.
    const target = this.camera.position;
    const texel = 110 / this.sun.shadow.mapSize.x;
    const sx = Math.round(target.x / texel) * texel, sz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + this.sunOffset.x, this.sunOffset.y, sz + this.sunOffset.z);
    this.sky?.update(time, this.camera);
    this.scope.render(this.renderer, this.scene, this.camera, this.viewCamera);
    this.composer.render();
  }
}
