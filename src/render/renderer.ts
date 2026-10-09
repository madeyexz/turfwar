import { viewHeight, viewWidth } from '../ui/viewport';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { AdaptiveDpr, PHONE_ADAPTIVE_DPR, basePixelRatio } from '../game/adaptivedpr';
import { setMaterialQuality, type Theme } from './materials';
import { ScopePass } from './sights';
import { SkyView } from './sky';

/**
 * A graphics preset. Phones default to `low`, which follows messenger.abeto.co's budget: a sharp
 * but adaptive resolution, one plain-PCF shadow over a small area around the player, no bloom and
 * no extra lights.
 */
export interface Quality {
  /** Pixel ratio cap: a number, or 'phone' (Messenger's: up to 1.15 on screens of ratio 2 or less, 1.5 above). */
  pixelRatio: number | 'phone';
  /** Scale the pixel ratio by frame rate while a match is played (game/adaptivedpr.ts). */
  adaptive: boolean;
  /** Sun shadow map size; 0 = no shadows. */
  shadows: number;
  /** Half the side of the square the sun's shadow covers (m); its centre is `shadowAhead` m in front of the camera. */
  shadowRange: number;
  shadowAhead: number;
  /** PCF soft shadows (wider filter) or plain PCF. */
  softShadows: boolean;
  /** Draw the shadow map every other frame. */
  halfRateShadows: boolean;
  /** Meshes smaller than this (bounding radius, m) cast no shadow. */
  minCaster: number;
  /** Also no shadows from the big merged clutter (hedges, lot detail, street props). */
  leanCasters: boolean;
  bloom: boolean;
  /** Muzzle-flash point lights and the flashlight attachment's spot light. */
  dynamicLights: boolean;
  /** Level surfaces without roughness maps, ground without normal maps (render/materials.ts). */
  cheapMaterials: boolean;
}
const SHARP: Omit<Quality, 'pixelRatio'> = { adaptive: true, shadows: 2048, shadowRange: 40, shadowAhead: 15, softShadows: true, halfRateShadows: false, minCaster: 0.2, leanCasters: false, bloom: true, dynamicLights: true, cheapMaterials: false };
/** 'test' exists for software-rendered automation (no GPU); it is not a player-facing preset. */
export const QUALITY: Record<'low' | 'medium' | 'high' | 'test', Quality> = {
  low: { pixelRatio: 'phone', adaptive: true, shadows: 1024, shadowRange: 22, shadowAhead: 10, softShadows: false, halfRateShadows: true, minCaster: 1.2, leanCasters: true, bloom: false, dynamicLights: false, cheapMaterials: true },
  medium: { ...SHARP, pixelRatio: 1 },
  high: { ...SHARP, pixelRatio: 1.5 },
  test: { ...SHARP, pixelRatio: 0.5, adaptive: false, shadows: 0, bloom: false, dynamicLights: false },
};

/** Merged clutter that casts no shadow on lean presets (mesh names from level.ts, dressing.ts and lotdetail.ts). */
const LEAN_CASTERS = /^(level:hedge|lots:|street:props)/;
const sphere = new THREE.Sphere();

/**
 * Which meshes under `root` cast sun shadows on preset `q`: those built to cast one, less the small
 * ones (bounding radius under `q.minCaster`; for instanced props, one instance's) and, on lean
 * presets, the merged clutter. It works on whatever the level builders made, and again after a
 * change of preset (the builder's choice is kept in `userData.shadowWanted`). Skinned soldiers are
 * left alone: their level of detail owns their shadows.
 */
export function limitShadowCasters(root: THREE.Object3D, q: Pick<Quality, 'minCaster' | 'leanCasters'>) {
  root.updateWorldMatrix(true, true);
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    const data = mesh.userData;
    if (data.shadowWanted === undefined) data.shadowWanted = mesh.castShadow;
    if (!data.shadowWanted) return;
    const geometry = mesh.geometry;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    // A batch of small parts (src/render/batch.ts) counts by its parts' size, not the whole batch's.
    const radius = (data.casterRadius as number | undefined) ?? sphere.copy(geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld).radius;
    mesh.castShadow = radius >= q.minCaster && !(q.leanCasters && LEAN_CASTERS.test(mesh.name));
  });
}

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
  /**
   * The flashlight attachment's light, on the world camera: one for every view model (only one is
   * shown at a time). It is in the scene only on presets with dynamic lights, so the light count,
   * and with it every lit shader, stays the same all match.
   */
  readonly torch = new THREE.SpotLight(0xfff1dc, 0, 45, 0.36, 0.55, 1.4);
  /** Resolution scale by frame rate, while a match is played. */
  adaptive = new AdaptiveDpr();
  sky?: SkyView;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private sunOffset = new THREE.Vector3(-50, 70, 40);
  /** Picture-in-picture scope view, rendered only while the view model asks for it (a magnified optic raised). */
  private scope = new ScopePass();
  /** Groups whose shadow casters follow the preset (limitShadowCasters), looked at again now and then for new meshes. */
  private shadowRoots = new Set<THREE.Object3D>();
  private qualityListeners = new Set<(q: Quality) => void>();
  private frames = 0;
  private lastFrameAt = 0;
  quality: Quality;

  constructor(container: HTMLElement, quality: Quality) {
    this.quality = quality;
    // Everything is drawn into the composer's own target first, so the canvas needs no multisampling,
    // depth or stencil buffer of its own (the scope view and the shadow map have their own targets too).
    this.renderer = new THREE.WebGLRenderer({ antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = quality.shadows > 0;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.type = quality.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    container.prepend(this.renderer.domElement);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera, this.sun, this.sun.target, this.hemi);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    this.torch.position.set(0.12, -0.12, 0);
    this.torch.target.position.set(0.05, -0.1, -10);
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
    if (q !== this.quality) this.adaptive = new AdaptiveDpr(q.pixelRatio === 'phone' ? PHONE_ADAPTIVE_DPR : {});
    this.quality = q;
    setMaterialQuality(q.cheapMaterials);
    this.sun.castShadow = q.shadows > 0;
    this.sun.shadow.mapSize.set(Math.max(256, q.shadows), Math.max(256, q.shadows));
    this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -q.shadowRange; sc.right = sc.top = q.shadowRange;
    sc.updateProjectionMatrix();
    const sm = this.renderer.shadowMap;
    sm.autoUpdate = true;
    const type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (sm.type !== type) {
      // The filter is compiled into every lit shader, and three.js does not notice the change by itself.
      sm.type = type;
      for (const scene of [this.scene, this.viewScene]) scene.traverse(o => {
        const material = (o as THREE.Mesh).material;
        if (material) for (const m of Array.isArray(material) ? material : [material]) m.needsUpdate = true;
      });
    }
    if (q.dynamicLights) this.camera.add(this.torch, this.torch.target);
    else { this.torch.removeFromParent(); this.torch.target.removeFromParent(); }
    this.bloom.enabled = q.bloom;
    for (const root of this.shadowRoots) limitShadowCasters(root, q);
    for (const f of this.qualityListeners) f(q);
    this.resize();
  }

  /** Follow the preset, now and on every change (returns the unsubscribe). */
  onQuality(f: (q: Quality) => void) {
    this.qualityListeners.add(f);
    f(this.quality);
    return () => { this.qualityListeners.delete(f); };
  }

  /** Let `root`'s shadow casters follow the preset (limitShadowCasters), meshes added to it later included. */
  limitShadows(root: THREE.Object3D) {
    this.shadowRoots.add(root);
    limitShadowCasters(root, this.quality);
    return () => { this.shadowRoots.delete(root); };
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

  /** The pixel ratio drawn at: the preset's cap for this screen, times the adaptive scale. */
  pixelRatio() {
    const q = this.quality;
    return Math.round(basePixelRatio(q.pixelRatio, devicePixelRatio) * (q.adaptive ? this.adaptive.multiplier : 1) * 100) / 100;
  }

  resize() {
    // Sideways play: the game's own width and height (ui/viewport.ts), not the upright window's.
    const w = viewWidth(), h = viewHeight();
    const ratio = this.pixelRatio();
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * ratio / 2, h * ratio / 2);
    this.camera.aspect = this.viewCamera.aspect = w / h;
    this.camera.updateProjectionMatrix(); this.viewCamera.updateProjectionMatrix();
  }

  /**
   * Shaders and textures for everything in the scenes, ahead of first sight. Three.js compiles a shader
   * and uploads a texture the first time something is drawn, so a camera that jumps across the map (death,
   * to the killer's eyes) stalled for hundreds of ms on phones. Shaders compile in the background where the
   * browser can (KHR_parallel_shader_compile); textures go up two a frame, so warming never stalls either.
   */
  warm() {
    const r = this.renderer;
    for (const [scene, camera] of [[this.scene, this.camera], [this.viewScene, this.viewCamera]] as const) r.compileAsync(scene, camera).catch(() => undefined);
    const textures = new Set<THREE.Texture>();
    for (const scene of [this.scene, this.viewScene]) scene.traverse(o => {
      const material = (o as THREE.Mesh).material;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        for (const value of Object.values(m)) if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
      }
    });
    const queue = [...textures];
    const upload = () => {
      for (let i = 0; i < 2 && queue.length; i++) r.initTexture(queue.pop()!);
      if (queue.length) requestAnimationFrame(upload);
    };
    requestAnimationFrame(upload);
  }

  /**
   * The current view as a picture (the share card's backdrop): rendered again and copied at once,
   * while the drawing buffer still holds the frame.
   */
  snapshot(maxWidth = 1280) {
    this.draw(this.lastTime);
    const src = this.renderer.domElement;
    const scale = Math.min(1, maxWidth / src.width);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(src.width * scale)); out.height = Math.max(1, Math.round(src.height * scale));
    out.getContext('2d')!.drawImage(src, 0, 0, out.width, out.height);
    return out;
  }
  private lastTime = 0;

  /**
   * One frame. `playing`: a match is under way (not loading, not a menu): only those frames tune the
   * adaptive resolution.
   */
  render(time: number, playing = false) {
    const now = performance.now(), dt = this.lastFrameAt ? (now - this.lastFrameAt) / 1000 : 0;
    this.lastFrameAt = now;
    if (this.quality.adaptive && this.adaptive.frame(dt, playing)) this.resize();
    // New meshes (a vehicle, a crate) follow the preset's shadow casters within a second.
    if (++this.frames % 60 === 0) for (const root of this.shadowRoots) limitShadowCasters(root, this.quality);
    this.draw(time);
  }

  private shadowCentre = new THREE.Vector3();
  private lightX = new THREE.Vector3();
  private lightY = new THREE.Vector3();
  private lightZ = new THREE.Vector3();

  private draw(time: number) {
    this.lastTime = time;
    this.renderer.info.reset();
    this.placeShadow();
    const sm = this.renderer.shadowMap;
    if (this.quality.halfRateShadows) { sm.autoUpdate = false; sm.needsUpdate = this.frames % 2 === 0; }
    this.sky?.update(time, this.camera);
    this.scope.render(this.renderer, this.scene, this.camera, this.viewCamera);
    this.composer.render();
  }

  /**
   * Centre the sun's shadow a little ahead of the camera (most of what is seen is in front), snapped
   * to whole shadow-map texels across the light's view so its edges never shimmer as the player moves.
   */
  private placeShadow() {
    const q = this.quality, c = this.shadowCentre;
    this.camera.getWorldDirection(c);
    const flat = Math.hypot(c.x, c.z) || 1;
    c.set(c.x / flat * q.shadowAhead, 0, c.z / flat * q.shadowAhead).add(this.camera.getWorldPosition(this.lightX));
    // The light camera's axes (Object3D.lookAt from sun towards target, up +Y).
    const z = this.lightZ.copy(this.sunOffset).normalize();
    const x = this.lightX.set(0, 1, 0).cross(z).normalize(), y = this.lightY.copy(z).cross(x);
    const texel = 2 * q.shadowRange / this.sun.shadow.mapSize.x;
    const u = Math.round(c.dot(x) / texel) * texel, v = Math.round(c.dot(y) / texel) * texel, w = c.dot(z);
    c.copy(x).multiplyScalar(u).addScaledVector(y, v).addScaledVector(z, w);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).add(this.sunOffset);
  }
}
