import * as THREE from 'three';
import { settings, type ReticleColor, type ReticleStyle } from '../game/settings';

/**
 * First-person sight pictures. Red dots and holographic sights draw their reticle on the window glass,
 * projected at infinity along the sight axis (parallax-free: it sits on the aim point wherever the eye
 * is, and only shows while looking through the window). Magnified optics show the world through the
 * ocular lens: a second camera renders the view along the lens axis into a small render target
 * (picture-in-picture), drawn on the lens with exit-pupil shadow, lens shading and an etched reticle.
 */
export type SightKind = 'dot' | 'holo' | 'acog' | 'x4' | 'x6';
/** Sighting surface of a fitted optic, in the optic mesh's local space (lens facing +X, barrel along -X). */
export interface Sight {
  kind: SightKind;
  center: THREE.Vector3;
  /** Lens radius, or the window's half width (z) and half height (y). */
  radius: number; half?: [number, number];
}

/** Illuminated reticle colours (linear HDR-ready; the shaders scale them past the bloom threshold). */
export const RETICLE_RGB: Record<ReticleColor, THREE.Color> = {
  red: new THREE.Color(1, 0.012, 0.008), green: new THREE.Color(0.22, 1, 0.16),
  amber: new THREE.Color(1, 0.42, 0.03), white: new THREE.Color(1, 0.96, 0.9),
};
/** CSS for the same colours (full-screen eyepiece overlay). */
export const RETICLE_CSS: Record<ReticleColor, string> = { red: '#ff3a24', green: '#4dff3a', amber: '#ffa21e', white: '#f4f1ea' };
const STYLE: Record<Exclude<ReticleStyle, 'stock'>, number> = { dot: 0, circle: 1, chevron: 2, cross: 3 };
const KIND: Record<'acog' | 'x4' | 'x6', number> = { acog: 0, x4: 1, x6: 2 };

const SDF = /* glsl */ `
  float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
  float fill(float d, float w, float aa) { return 1.0 - smoothstep(w - aa, w + aa, d); }
`;

const scratch = { v: new THREE.Vector3(), d: new THREE.Vector3(), vp: new THREE.Vector4(), m: new THREE.Matrix4() };

/** Red dot / holo window: lightly coated glass with an emissive reticle projected at infinity. */
export function windowMaterial(mesh: THREE.Mesh, sight: Sight) {
  const [hz, hy] = sight.half ?? [sight.radius, sight.radius];
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide, toneMapped: false,
    uniforms: {
      uAim: { value: new THREE.Vector2() }, uScale: { value: 720 }, uColor: { value: new THREE.Color() }, uStyle: { value: 0 },
      uTint: { value: new THREE.Color(sight.kind === 'holo' ? 0x6b8fb0 : 0xa4805a) }, uCenter: { value: sight.center.clone() },
      uHalf: { value: new THREE.Vector2(hz, hy) }, uRound: { value: sight.half ? 0 : 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocal; varying vec3 vNormalV; varying vec3 vView;
      void main() {
        vLocal = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = mv.xyz; vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec2 uAim; uniform float uScale; uniform vec3 uColor; uniform int uStyle; uniform vec3 uTint;
      uniform vec3 uCenter; uniform vec2 uHalf; uniform float uRound;
      varying vec3 vLocal; varying vec3 vNormalV; varying vec3 vView;
      ${SDF}
      void main() {
        // Reticle in viewport-height units around the projected aim point (at infinity along the sight axis).
        vec2 p = (gl_FragCoord.xy - uAim) / uScale;
        float aa = 0.8 / uScale, d = length(p), ret = 0.0;
        if (uStyle == 0) ret = fill(d, 0.0042, aa);
        else if (uStyle == 1) {
          ret = max(fill(d, 0.0024, aa), fill(abs(d - 0.044), 0.0014, aa));
          // Short ticks inside the ring at 3, 6 and 9 o'clock.
          ret = max(ret, fill(min(min(seg(p, vec2(0.0, -0.043), vec2(0.0, -0.034)), seg(p, vec2(0.043, 0.0), vec2(0.036, 0.0))), seg(p, vec2(-0.043, 0.0), vec2(-0.036, 0.0))), 0.0011, aa));
        } else if (uStyle == 2) {
          float s = min(seg(p, vec2(0.0), vec2(-0.017, -0.015)), seg(p, vec2(0.0), vec2(0.017, -0.015)));
          ret = fill(s, 0.0013, aa);
        } else {
          float s = min(min(seg(p, vec2(0.007, 0.0), vec2(0.028, 0.0)), seg(p, vec2(-0.007, 0.0), vec2(-0.028, 0.0))),
                        min(seg(p, vec2(0.0, 0.007), vec2(0.0, 0.028)), seg(p, vec2(0.0, -0.007), vec2(0.0, -0.028))));
          ret = max(fill(s, 0.001, aa), fill(d, 0.0017, aa));
        }
        // LED bloom: a soft halo round the dot (drawn here so the reticle keeps its hue instead of blowing out to white).
        float halo = exp(-d * d / 0.00005) * 0.45;
        // Glass: a faint coating tint, darker at the frame, a soft diagonal sheen and a fresnel edge.
        vec2 q = (vLocal.zy - uCenter.zy) / uHalf;
        float e = uRound > 0.5 ? length(q) : max(abs(q.x), abs(q.y));
        float edge = smoothstep(0.7, 1.0, e);
        float sheen = smoothstep(0.28, 0.0, abs(q.x * 0.55 + q.y - 0.45)) * 0.05 + smoothstep(0.12, 0.0, abs(q.x * 0.55 + q.y + 0.1)) * 0.025;
        float fres = pow(1.0 - abs(dot(normalize(-vView), vNormalV)), 3.0) * 0.25;
        float a = 0.025 + edge * 0.1 + sheen + fres;
        vec3 glass = uTint * (0.02 + edge * 0.06) + vec3(sheen + fres * 0.5) * 0.6;
        // Premultiplied: the reticle covers what is behind it (crisp and saturated on bright skies), the halo adds light.
        vec3 col = glass * (1.0 - ret) + uColor * (ret * 1.35 + halo * 0.8);
        gl_FragColor = vec4(col, clamp(a * (1.0 - ret) + ret + halo * 0.25, 0.0, 1.0));
      }`,
  });
  mesh.material = material;
  mesh.renderOrder = 4;
  const u = material.uniforms;
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const vp = renderer.getCurrentViewport(scratch.vp);
    const at = scratch.v.copy(sight.center).applyMatrix4(mesh.matrixWorld);
    at.addScaledVector(scratch.d.set(-1, 0, 0).transformDirection(mesh.matrixWorld), 1000).project(camera);
    u.uAim.value.set(vp.x + (at.x * 0.5 + 0.5) * vp.z, vp.y + (at.y * 0.5 + 0.5) * vp.w);
    u.uScale.value = vp.w;
    u.uColor.value.copy(RETICLE_RGB[settings.reticleColor]);
    u.uStyle.value = settings.reticleStyle === 'stock' ? (sight.kind === 'holo' ? 1 : 0) : STYLE[settings.reticleStyle];
  };
  return material;
}

let blank: THREE.Texture | undefined;
const blankTexture = () => blank ??= Object.assign(new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1), { needsUpdate: true });

/** Ocular lens of a magnified optic: the picture-in-picture view with exit-pupil shadow, lens shading and the etched reticle. */
export function lensMaterial(mesh: THREE.Mesh, sight: Sight) {
  const material = new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: {
      map: { value: blankTexture() }, uActive: { value: 0 }, uEye: { value: new THREE.Vector2() }, uCenter: { value: sight.center.clone() },
      uRadius: { value: sight.radius }, uColor: { value: new THREE.Color() }, uKind: { value: KIND[sight.kind as 'acog'] ?? 0 },
      uTint: { value: new THREE.Color(sight.kind === 'acog' ? 0x4a7a5c : 0x3f6f86) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      void main() { vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float uActive; uniform vec2 uEye; uniform vec3 uCenter; uniform float uRadius;
      uniform vec3 uColor; uniform int uKind; uniform vec3 uTint;
      varying vec3 vLocal;
      ${SDF}
      void main() {
        // Lens coordinates: x right, y up, radius 1 at the lens rim.
        vec2 p = vec2(-(vLocal.z - uCenter.z), vLocal.y - uCenter.y) / uRadius;
        float r = length(p);
        float aa = max(fwidth(p.x), fwidth(p.y)) * 0.9;
        vec3 img = vec3(0.0);
        if (uActive > 0.001) {
          // Mild barrel distortion and lateral colour toward the rim.
          vec2 q = p * (1.0 - 0.05 * r * r);
          float ca = 0.012 * r * r;
          img = vec3(texture2D(map, q * (1.0 + ca) * 0.5 + 0.5).r, texture2D(map, q * 0.5 + 0.5).g, texture2D(map, q * (1.0 - ca) * 0.5 + 0.5).b);
        }
        // Exit pupil: the image shrinks to a shadowed circle that slides opposite the eye's offset from the axis.
        float pupil = 1.0 - smoothstep(0.86, 1.02, length(p + uEye * 1.5));
        float shade = (1.0 - 0.3 * r * r) * pupil;
        float black = 0.0, lit = 0.0;
        if (uKind == 0) {
          // ACOG: illuminated chevron on the aim point, bullet-drop stadia below, fine horizontal wires at the sides.
          float chev = min(seg(p, vec2(0.0, -0.004), vec2(-0.085, -0.095)), seg(p, vec2(0.0, -0.004), vec2(0.085, -0.095)));
          lit = fill(chev, 0.012, aa);
          float b = seg(p, vec2(0.0, -0.12), vec2(0.0, -0.62));
          b = min(b, seg(p, vec2(-0.085, -0.2), vec2(0.085, -0.2)));
          b = min(b, seg(p, vec2(-0.065, -0.29), vec2(0.065, -0.29)));
          b = min(b, seg(p, vec2(-0.05, -0.38), vec2(0.05, -0.38)));
          b = min(b, seg(p, vec2(-0.04, -0.46), vec2(0.04, -0.46)));
          b = min(b, seg(p, vec2(-0.032, -0.54), vec2(0.032, -0.54)));
          black = max(fill(b, 0.0045, aa), fill(chev, 0.019, aa) * (1.0 - lit));
          black = max(black, fill(min(seg(p, vec2(0.32, 0.0), vec2(1.2, 0.0)), seg(p, vec2(-0.32, 0.0), vec2(-1.2, 0.0))), 0.006, aa));
        } else if (uKind == 1) {
          // Pistol scope: duplex posts and a lit centre dot.
          float thin = min(seg(p, vec2(-0.45, 0.0), vec2(0.45, 0.0)), seg(p, vec2(0.0, -0.45), vec2(0.0, 0.45)));
          float thick = min(min(seg(p, vec2(0.45, 0.0), vec2(1.2, 0.0)), seg(p, vec2(-0.45, 0.0), vec2(-1.2, 0.0))), min(seg(p, vec2(0.0, -0.45), vec2(0.0, -1.2)), seg(p, vec2(0.0, 0.45), vec2(0.0, 1.2))));
          black = max(fill(thin, 0.004, aa), fill(thick, 0.028, aa));
          lit = fill(r, 0.016, aa);
        } else {
          // Sniper: mil-dot duplex with a lit centre dot.
          float thin = min(seg(p, vec2(-0.6, 0.0), vec2(0.6, 0.0)), seg(p, vec2(0.0, -0.6), vec2(0.0, 0.6)));
          float thick = min(min(seg(p, vec2(0.6, 0.0), vec2(1.2, 0.0)), seg(p, vec2(-0.6, 0.0), vec2(-1.2, 0.0))), min(seg(p, vec2(0.0, -0.6), vec2(0.0, -1.2)), seg(p, vec2(0.0, 0.6), vec2(0.0, 1.2))));
          black = max(fill(thin, 0.0032, aa), fill(thick, 0.026, aa));
          for (int i = 1; i <= 5; i++) {
            float m = float(i) * 0.1;
            float dots = min(min(length(p - vec2(m, 0.0)), length(p + vec2(m, 0.0))), min(length(p - vec2(0.0, m)), length(p + vec2(0.0, m))));
            black = max(black, fill(dots, 0.011, aa));
          }
          lit = fill(r, 0.011, aa);
          black *= 1.0 - fill(r, 0.012, aa);
        }
        float glow = uKind == 0 ? 0.0 : exp(-r * r / 0.0012) * 0.35;
        vec3 col = img * shade * (1.0 - black) * (1.0 - lit) + uColor * (lit * 1.3 + glow) * uActive;
        // At the hip: dark coated glass with a soft reflection.
        float sheen = smoothstep(0.35, 0.0, abs(p.x * 0.6 + p.y - 0.35)) * 0.06;
        vec3 coated = uTint * (0.025 + 0.18 * r * r * r) + vec3(sheen) + uColor * lit * 0.6;
        col = mix(coated, col, uActive);
        col *= smoothstep(1.0, 0.965, r);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  mesh.material = material;
  const u = material.uniforms;
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    // The eye's offset from the lens axis (in lens radii) slides the exit-pupil shadow.
    const eye = scratch.v.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(scratch.m.copy(mesh.matrixWorld).invert());
    u.uEye.value.set(-(eye.z - sight.center.z), eye.y - sight.center.y).divideScalar(sight.radius);
    u.uColor.value.copy(RETICLE_RGB[settings.reticleColor]);
  };
  return material;
}

/** A magnified optic asking to be rendered this frame (made by the view model, consumed by the renderer). */
export interface ScopeRequest {
  lens: THREE.Mesh; sight: Sight;
  /** tan of half the optic's true field of view: what the full viewport height would show at its magnification. */
  tanHalf: number;
  /** Render-target edge cap in pixels. */
  size: number;
}
let pending: ScopeRequest | undefined;
export const requestScope = (r: ScopeRequest) => { pending = r; };

/**
 * Picture-in-picture pass: renders the world along the lens axis into a square target sized to the lens
 * on screen, before the main frame. Shadow maps are reused (no shadow re-render), and the target exists
 * only while a magnified optic is raised.
 */
export class ScopePass {
  readonly camera = new THREE.PerspectiveCamera(10, 1, 0.05, 1200);
  private target?: THREE.WebGLRenderTarget;
  private idle = 0;
  private v = new THREE.Vector3(); private w = new THREE.Vector3(); private q = new THREE.Quaternion();

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, viewCamera: THREE.PerspectiveCamera) {
    const req = pending;
    pending = undefined;
    if (!req) {
      // Free the target a few seconds after the scope comes down.
      if (this.target && ++this.idle > 240) { this.target.dispose(); this.target = undefined; }
      return;
    }
    this.idle = 0;
    const { lens, sight } = req;
    lens.updateWorldMatrix(true, false);
    viewCamera.updateMatrixWorld();
    // Lens radius on screen (NDC, 1 = half the viewport height).
    const c = this.v.copy(sight.center).applyMatrix4(lens.matrixWorld).project(viewCamera);
    const e = this.w.copy(sight.center).setY(sight.center.y + sight.radius).applyMatrix4(lens.matrixWorld).project(viewCamera);
    const rNdc = Math.hypot((e.x - c.x) * viewCamera.aspect, e.y - c.y);
    if (!(rNdc > 0.01)) return;
    const height = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    const size = Math.max(256, Math.min(req.size, Math.ceil(rNdc * height / 128) * 128));
    if (!this.target) this.target = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, samples: req.size > 512 ? 4 : 0 });
    else if (this.target.width !== size) this.target.setSize(size, size);
    // Same scale as the full-screen eyepiece: the lens radius shows rNdc of the optic's field of view.
    const cam = this.camera;
    cam.fov = 2 * Math.atan(rNdc * req.tanHalf) * 180 / Math.PI;
    cam.near = camera.near; cam.far = camera.far;
    cam.updateProjectionMatrix();
    // Look along the lens axis: the gun's direction in the view-model scene, turned into the world by the camera.
    camera.updateMatrixWorld();
    camera.getWorldPosition(cam.position);
    const worldQ = camera.getWorldQuaternion(this.q);
    const dir = this.v.set(-1, 0, 0).transformDirection(lens.matrixWorld).applyQuaternion(worldQ);
    cam.up.set(0, 1, 0).transformDirection(lens.matrixWorld).applyQuaternion(worldQ);
    cam.lookAt(this.w.copy(cam.position).add(dir));
    const before = renderer.getRenderTarget(), autoShadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(before);
    renderer.shadowMap.autoUpdate = autoShadows;
    (lens.material as THREE.ShaderMaterial).uniforms.map.value = this.target.texture;
  }
}
