import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { puffTexture } from './smoke';

/**
 * The National Day flyover (國慶空中分列式): five AT-5 勇鷹 trainers of the 雷虎小組 in a wedge, trailing
 * the flag's colours in smoke (red outside, white, blue from the lead). Cosmetic and client-only, behind
 * a development switch for now (game.ts ?flyover, dev/flyover.html for the trailer shot).
 *
 * Everything is a function of time along one straight, level pass, so any frame can be drawn on its own
 * (the trailer renders frame by frame) and two clients at the same time see the same sky.
 */

type V3 = { x: number; y: number; z: number };

/** One pass: where the lead jet is at t = 0, its velocity, and when the smoke is on (seconds). */
export interface FlyoverPath {
  start: V3;
  velocity: V3;
  smokeOn: number;
  smokeOff: number;
}

export type SmokeColor = 'red' | 'white' | 'blue';

/**
 * The wedge, in metres from the lead: `side` to its right, `back` behind it. The lead trails blue,
 * its wingmen white and the outside pair red, so the five ribbons read red, white, blue, white, red.
 */
export const FORMATION: readonly { side: number; back: number; color: SmokeColor }[] = [
  { side: 0, back: 0, color: 'blue' },
  { side: -7, back: 6, color: 'white' },
  { side: 7, back: 6, color: 'white' },
  { side: -14, back: 12, color: 'red' },
  { side: 14, back: 12, color: 'red' },
];

const COLORS: Record<SmokeColor, number> = { red: 0xec4058, white: 0xf4f4f6, blue: 0x3368d4 };

/** Smoke puffs per second per jet, and how long one lasts (s). */
export const PUFF_RATE = 80;
export const PUFF_LIFE = 18;
/** Where the smoke leaves a jet: behind the nozzles (m behind its centre). */
const NOZZLE = 6.9;
/** The air's drift (m/s): the trail spreads downwind and sinks a little as it cools. */
const WIND = { x: 1.2, y: -0.35, z: 0.6 };

/** Unit forward and right (level, y up) of a pass. */
export function axes(path: FlyoverPath) {
  const v = path.velocity, speed = Math.hypot(v.x, v.y, v.z) || 1;
  const fwd = { x: v.x / speed, y: v.y / speed, z: v.z / speed };
  const flat = Math.hypot(fwd.x, fwd.z) || 1;
  // Right of a heading on the ground plane (forward × up).
  const right = { x: -fwd.z / flat, y: 0, z: fwd.x / flat };
  return { fwd, right, speed };
}

/** Jet `j`'s centre at time t. */
export function jetAt(path: FlyoverPath, j: number, t: number, out: V3 = { x: 0, y: 0, z: 0 }): V3 {
  const { fwd, right } = axes(path), f = FORMATION[j];
  out.x = path.start.x + path.velocity.x * t + right.x * f.side - fwd.x * f.back;
  out.y = path.start.y + path.velocity.y * t;
  out.z = path.start.z + path.velocity.z * t + right.z * f.side - fwd.z * f.back;
  return out;
}

/** A fixed pseudo-random number in [0, 1) for puff k of jet j (the same on every frame and client). */
export function puffRandom(k: number, j: number, salt: number) {
  let h = Math.imul(k | 0, 0x9e3779b1) ^ Math.imul(j + 1, 0x85ebca77) ^ Math.imul(salt + 7, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface Puff { x: number; y: number; z: number; size: number; alpha: number; shade: number }

/**
 * Puff k of jet j (left by the jet at time k / PUFF_RATE) as seen at time t: where it has drifted to,
 * how big it has billowed and how opaque it still is. Alpha 0 when it does not exist (not yet left,
 * smoke off then, or faded away).
 */
export function puffAt(path: FlyoverPath, j: number, k: number, t: number, out: Puff): Puff {
  const born = k / PUFF_RATE, age = t - born;
  if (age < 0 || age > PUFF_LIFE || born < path.smokeOn || born > path.smokeOff) { out.alpha = 0; out.size = 0; return out; }
  const { fwd } = axes(path);
  jetAt(path, j, born, out);
  // Billowing: the puff swells fast at first, then slowly, and wanders off the line as it does (a little:
  // each jet's ribbon stays its own colour for most of its length).
  const grow = 1 - Math.exp(-age / 3);
  const wander = 0.4 + 2.6 * grow;
  const u = puffRandom(k, j, 1) * 2 - 1, v = puffRandom(k, j, 2) * 2 - 1, w = puffRandom(k, j, 3) * 2 - 1;
  out.x += -fwd.x * NOZZLE + WIND.x * age + u * wander;
  out.y += -0.4 + WIND.y * age + v * wander * 0.7;
  out.z += -fwd.z * NOZZLE + WIND.z * age + w * wander;
  out.size = (3.2 + 10 * grow) * (0.8 + 0.4 * puffRandom(k, j, 4));
  const fadeIn = Math.min(1, age / 0.08);
  const fadeOut = 1 - smooth(PUFF_LIFE * 0.45, PUFF_LIFE, age);
  out.alpha = 0.9 * fadeIn * fadeOut;
  out.shade = 0.92 + 0.12 * puffRandom(k, j, 5);
  return out;
}

const smooth = (a: number, b: number, x: number) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

/**
 * An AT-5 勇鷹 (AIDC T-5 Brave Eagle), low-poly, nose along +x: a twin-engine trainer about 13 m long
 * and 10.5 m across, with a tandem bubble canopy, mid-set trapezoid wings with leading-edge root
 * extensions, all-moving tailplanes, one fin and two nozzles side by side.
 */
export function brave(): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number) => { g.translate(x, y, z); parts.push(g.index ? g.toNonIndexed() : g); };
  // Fuselage: the nose cone, the cockpit section, and the wide twin-engine body behind it.
  const nose = new THREE.ConeGeometry(0.55, 3.2, 10); nose.rotateZ(-Math.PI / 2); add(nose, 5.0, 0.1, 0);
  const front = new THREE.CylinderGeometry(0.62, 0.7, 3.4, 10); front.rotateZ(Math.PI / 2); add(front, 1.7, 0.08, 0);
  const engines = new THREE.BoxGeometry(6.4, 1.15, 1.9); add(engines, -3.0, 0, 0);
  for (const s of [-1, 1]) {
    const intake = new THREE.BoxGeometry(1.8, 0.75, 0.55); add(intake, 0.6, -0.15, s * 0.95);
    const nozzle = new THREE.CylinderGeometry(0.42, 0.36, 0.7, 10); nozzle.rotateZ(Math.PI / 2); add(nozzle, -6.45, 0, s * 0.5);
  }
  // Flat surfaces from planforms (x forward, z out to the right), extruded thin and laid flat.
  const plate = (pts: [number, number][], thick: number, y: number, mirror: boolean) => {
    for (const s of mirror ? [-1, 1] : [1]) {
      const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, s * z)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
      g.rotateX(Math.PI / 2); // the shape's y (span) becomes z; extrusion goes down
      add(g, 0, y + thick / 2, 0);
    }
  };
  // Wings (swept leading edge, straight trailing edge) and the root extensions running up to the cockpit.
  plate([[0.9, 0.9], [-1.6, 5.25], [-2.8, 5.25], [-2.9, 0.9]], 0.16, 0, true);
  plate([[3.4, 0.62], [0.9, 1.25], [0.9, 0.62]], 0.1, 0.05, true);
  // Tailplanes.
  plate([[-4.6, 0.9], [-6.0, 2.45], [-6.9, 2.45], [-6.9, 0.9]], 0.1, 0, true);
  // The fin: a planform in x/y, extruded across.
  const fin = new THREE.Shape([[-3.6, 0], [-5.9, 2.7], [-6.9, 2.7], [-6.9, 0]].map(([x, y]) => new THREE.Vector2(x, y)));
  const finG = new THREE.ExtrudeGeometry(fin, { depth: 0.14, bevelEnabled: false }); add(finG, 0, 0.5, -0.07);
  const body = mergeGeometries(parts.map(p => { p.deleteAttribute('uv'); return p; }))!;
  body.computeVertexNormals();
  // Tandem canopy: a long, low bubble over the cockpit.
  const glass = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  glass.scale(1.9, 0.62, 0.5); glass.translate(2.3, 0.62, 0);
  return { body, glass };
}

/** Instanced billboard puffs: one draw call for every puff of every trail. */
function smokeMaterial(texture: THREE.Texture) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { map: { value: texture }, haze: { value: new THREE.Color() }, hazeDensity: { value: 0 } },
    vertexShader: `
      attribute vec3 iPos; attribute float iSize; attribute float iAlpha; attribute vec3 iColor; attribute float iSpin;
      varying vec2 vUv; varying float vAlpha; varying vec3 vColor; varying float vDist; varying float vUp;
      void main() {
        vUv = uv; vAlpha = iAlpha; vColor = iColor;
        vec4 view = modelViewMatrix * vec4(iPos, 1.0);
        float c = cos(iSpin), s = sin(iSpin);
        vec2 corner = (uv - 0.5) * iSize;
        vec2 turned = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
        view.xy += turned;
        // Height within the puff on screen (0 bottom, 1 top), whatever way the texture is turned.
        vUp = 0.5 + turned.y / max(iSize, 0.001);
        vDist = -view.z;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform vec3 haze; uniform float hazeDensity;
      varying vec2 vUv; varying float vAlpha; varying vec3 vColor; varying float vDist; varying float vUp;
      void main() {
        float a = texture2D(map, vUv).a * vAlpha;
        if (a < 0.01) discard;
        // Lit from the sky above: the top of each puff a little brighter than its underside.
        vec3 col = vColor * mix(0.74, 1.08, clamp(vUp, 0.0, 1.0));
        float h = 1.0 - exp(-pow(hazeDensity * vDist, 2.0));
        gl_FragColor = vec4(mix(col, haze, h), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * The order the trails draw in. Puffs draw in instance order without sorting, so each jet gets a run of
 * instances, the outside pair's red first and the lead's blue last, on top, as the middle ribbon reads in
 * the sky; within a run only same-coloured puffs overlap, so their order never shows.
 */
const DRAW_ORDER = [3, 4, 1, 2, 0];

/** The jets and their smoke for one pass; call update(t) with the pass's time every frame. */
export class Flyover {
  readonly group = new THREE.Group();
  private jets: THREE.Group[] = [];
  private mesh: THREE.Mesh;
  private puffs: number;
  private slots: number;
  private pos: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private material: THREE.ShaderMaterial;
  private scratch: Puff = { x: 0, y: 0, z: 0, size: 0, alpha: 0, shade: 1 };
  /** Extra fade over everything (0..1), e.g. while a repeating pass wraps round. */
  opacity = 1;

  constructor(public path: FlyoverPath) {
    const { body, glass } = brave();
    const paint = new THREE.MeshStandardMaterial({ color: 0x8e98a6, metalness: 0.35, roughness: 0.45, fog: false });
    const canopy = new THREE.MeshStandardMaterial({ color: 0x1a2430, metalness: 0.6, roughness: 0.15, fog: false });
    for (let j = 0; j < FORMATION.length; j++) {
      const jet = new THREE.Group();
      jet.add(new THREE.Mesh(body, paint), new THREE.Mesh(glass, canopy));
      this.jets.push(jet); this.group.add(jet);
    }
    const slots = this.slots = Math.ceil(PUFF_LIFE * PUFF_RATE) + 1;
    this.puffs = slots * FORMATION.length;
    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geometry.index = quad.index; geometry.setAttribute('position', quad.getAttribute('position')); geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.pos = new Float32Array(this.puffs * 3); this.size = new Float32Array(this.puffs); this.alpha = new Float32Array(this.puffs);
    const color = new Float32Array(this.puffs * 3), spin = new Float32Array(this.puffs);
    const c = new THREE.Color();
    for (let i = 0; i < this.puffs; i++) {
      c.setHex(COLORS[FORMATION[DRAW_ORDER[Math.floor(i / slots)]].color]).toArray(color, i * 3);
      spin[i] = i * 2.399;
    }
    const dyn = (a: Float32Array, n: number) => new THREE.InstancedBufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('iPos', dyn(this.pos, 3)); geometry.setAttribute('iSize', dyn(this.size, 1)); geometry.setAttribute('iAlpha', dyn(this.alpha, 1));
    geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(color, 3)); geometry.setAttribute('iSpin', new THREE.InstancedBufferAttribute(spin, 1));
    geometry.instanceCount = this.puffs;
    this.material = smokeMaterial(puffTexture());
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.group.add(this.mesh);
  }

  /**
   * Haze over the trail with distance: the scene's fog colour at a fraction of its density (fog is a
   * ground haze; the sky is clearer, and at full density a trail 500 m up would vanish).
   */
  setHaze(color: THREE.Color, density: number) {
    this.material.uniforms.haze.value.copy(color);
    this.material.uniforms.hazeDensity.value = density;
  }

  /** Place the jets and every puff for pass time t (seconds). */
  update(t: number) {
    const { fwd } = axes(this.path), p = { x: 0, y: 0, z: 0 };
    for (let j = 0; j < this.jets.length; j++) {
      const jet = this.jets[j];
      jetAt(this.path, j, t, p);
      jet.position.set(p.x, p.y, p.z);
      // Nose (+x) along the heading, level.
      jet.rotation.set(0, Math.atan2(-fwd.z, fwd.x), Math.asin(Math.max(-1, Math.min(1, fwd.y))));
      jet.visible = this.opacity > 0.01;
    }
    // A ring of slots per jet: puff k keeps slot k mod slots all its life, so its turn (iSpin) holds still.
    const newest = Math.floor(t * PUFF_RATE), slots = this.slots, puff = this.scratch;
    for (let i = 0; i < this.puffs; i++) {
      const j = DRAW_ORDER[Math.floor(i / slots)], slot = i % slots;
      const k = newest - ((newest - slot) % slots + slots) % slots;
      puffAt(this.path, j, k, t, puff);
      this.pos[i * 3] = puff.x; this.pos[i * 3 + 1] = puff.y; this.pos[i * 3 + 2] = puff.z;
      this.size[i] = puff.size; this.alpha[i] = puff.alpha * this.opacity;
    }
    const g = this.mesh.geometry;
    for (const name of ['iPos', 'iSize', 'iAlpha']) (g.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose(); this.material.uniforms.map.value.dispose(); this.material.dispose();
    const first = this.jets[0]?.children as THREE.Mesh[] | undefined;
    for (const m of first ?? []) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.group.removeFromParent();
  }
}

/**
 * A pass over a battlefield for development play (?flyover): straight over its centre at `altitude`,
 * on a heading across the map, the lead overhead at t = 0 and the smoke on for the whole run.
 */
export function overheadPass(altitude = 220, heading = 0.32): FlyoverPath {
  const speed = 110;
  return { start: { x: 0, y: altitude, z: 0 }, velocity: { x: Math.cos(heading) * speed, y: 0, z: Math.sin(heading) * speed }, smokeOn: -40, smokeOff: 40 };
}
