import * as THREE from 'three';
import type { KnifeSkin } from '../../shared/skins';

interface Particle extends Motion { mesh: THREE.Mesh | THREE.Sprite; velocity: THREE.Vector3; life: number; maxLife: number; gravity: number; grow: number; fade: boolean; alpha: number }
/** What the blast's particles add to the plain ones: all optional, so the small effects stay as they were. */
interface Motion {
  /** Seconds before the particle appears and starts to move. */
  delay?: number;
  /** Fraction of its velocity lost each second (air drag): a blast starts fast and stalls. */
  drag?: number;
  /** Size (m) from, to, and how fast it gets there (1/s); in place of `grow`. */
  size?: [from: number, to: number, rate: number];
  /** Seconds to fade in. */
  fadeIn?: number;
  /** Colours over its life, first to last. */
  ramp?: THREE.Color[];
  /** Turn of a sprite (rad/s), or tumble of a mesh. */
  spin?: number;
  /** Height (m) it bounces on. */
  floor?: number;
}
interface Tracer { mesh: THREE.Mesh; from: THREE.Vector3; dir: THREE.Vector3; total: number; head: number; speed: number; length: number }
interface Light { light: THREE.PointLight; life: number; maxLife: number; intensity: number }

function radialTexture(inner: string, outer: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/** A lumpy cloud: soft blobs round a core, so smoke and fire have a billowing edge and not a disc's. */
function puffTexture(seed: number) {
  const size = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  let k = seed;
  const rnd = () => { k = (k * 1664525 + 1013904223) >>> 0; return k / 4294967296; };
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * size * 0.3, r = size * (0.1 + rnd() * 0.1);
    const x = size / 2 + Math.cos(a) * d, y = size / 2 + Math.sin(a) * d;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = 190 + Math.floor(rnd() * 65);
    g.addColorStop(0, `rgba(${v},${v},${v},0.62)`); g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/** The pressure wave seen on the ground: a thin bright ring. */
function ringTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.62, 'rgba(255,255,255,0)'); g.addColorStop(0.86, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/** The burn a blast leaves on the ground: a black core with streaks thrown outward. */
function scorchTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(6,5,4,0.95)'); g.addColorStop(0.4, 'rgba(10,9,8,0.88)'); g.addColorStop(0.75, 'rgba(20,17,14,0.5)'); g.addColorStop(1, 'rgba(20,17,14,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  let k = 7;
  const rnd = () => { k = (k * 1664525 + 1013904223) >>> 0; return k / 4294967296; };
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 44; i++) {
    const a = rnd() * Math.PI * 2, r0 = 26 + rnd() * 20, r1 = 64;
    ctx.strokeStyle = `rgba(0,0,0,${0.2 + rnd() * 0.4})`; ctx.lineWidth = 1 + rnd() * 5;
    ctx.beginPath(); ctx.moveTo(64 + Math.cos(a) * r0, 64 + Math.sin(a) * r0); ctx.lineTo(64 + Math.cos(a) * r1, 64 + Math.sin(a) * r1); ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

const FIRE = [new THREE.Color(1.5, 1.05, 0.5), new THREE.Color(1.5, 0.6, 0.14), new THREE.Color(0.8, 0.2, 0.04), new THREE.Color(0.08, 0.05, 0.03)];
const DEBRIS = [0x2a2622, 0x4a443c, 0x6a6258, 0x3a2e26];

/** What flies off where each knife skin's blow lands: a puff of dust from the clothes; broom straw; the knife's sparks. */
const MELEE_DEBRIS: Record<KnifeSkin, { bits: number; bit: number; straw: boolean; dust: number }> = {
  slipper: { bits: 0, bit: 0, straw: false, dust: 3 },
  gold: { bits: 4, bit: 0xffc83a, straw: false, dust: 3 },
  broom: { bits: 10, bit: 0xd8b058, straw: true, dust: 4 },
  knife: { bits: 6, bit: 0xff7a4a, straw: false, dust: 0 },
};

/** Pooled combat effects: tracers, sparks, dust, energy hits, explosions and bullet marks. */
export class Effects {
  readonly group = new THREE.Group();
  private particles: Particle[] = [];
  private tracers: Tracer[] = [];
  private lights: Light[] = [];
  private decals: THREE.Mesh[] = [];
  private glow = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  private smoke = radialTexture('rgba(200,190,175,0.7)', 'rgba(200,190,175,0)');
  private tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  private sparkGeo = new THREE.BoxGeometry(0.02, 0.02, 0.12);
  private decalGeo = new THREE.CircleGeometry(0.06, 10);
  private decalMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  private lightPool: THREE.PointLight[] = [];
  private puffs = [puffTexture(11), puffTexture(47)];
  private ring = ringTexture();
  private scorch = scorchTexture();
  private flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private chunkGeo = new THREE.BoxGeometry(0.16, 0.1, 0.22);
  private scorches: THREE.Mesh[] = [];
  /** Share of the blast's particles drawn: the `low` preset draws half. */
  detail = 1;
  /** Colour of smoke in this map's light (the sky's fill light on grey smoke). */
  haze = new THREE.Color(0x8a8378);

  constructor() {
    // A small fixed pool of point lights avoids shader recompiles from changing light counts.
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffc070, 0, 8, 2);
      this.group.add(l); this.lightPool.push(l);
    }
  }

  /**
   * A bullet tracer: a short glowing streak flying from the muzzle to the hit at `velocity` (m/s,
   * the gun's muzzle velocity). Real speeds cross a whole map in a few frames, so the streak flies at
   * a scaled-down but still fast speed with a length that reads as motion blur.
   */
  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xffe2a0, width = 1, velocity = 800) {
    const total = from.distanceTo(to);
    if (total < 0.5) return;
    const speed = Math.max(240, Math.min(560, velocity * 0.6)), length = Math.min(total, Math.max(1.6, speed * 0.011));
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(this.tracerGeo, mat);
    mesh.position.copy(from); mesh.lookAt(to);
    mesh.scale.set(width, width, 0.001);
    this.group.add(mesh);
    // Start a little out of the barrel so the first frame already shows the streak.
    this.tracers.push({ mesh, from: from.clone(), dir: to.clone().sub(from).normalize(), total, head: Math.min(total, length * 0.6), speed, length });
  }

  /**
   * Muzzle flashes light the world (the preset's dynamic lights) or not: the pool is in the scene, or
   * none of it is. Three point lights cost every lit pixel, lit or dark, so phones go without.
   */
  dynamicLights(on: boolean) {
    for (const l of this.lightPool) { if (on) this.group.add(l); else l.removeFromParent(); }
  }

  flash(at: THREE.Vector3, color = 0xffc070, intensity = 6, life = 0.06, distance = 9) {
    const light = this.lightPool.find(l => l.parent && !this.lights.some(x => x.light === l));
    if (!light) return;
    light.color.set(color); light.position.copy(at); light.distance = distance;
    this.lights.push({ light, life, maxLife: life, intensity });
  }

  impact(at: THREE.Vector3, normal: THREE.Vector3, surface: string | undefined, decal = true, eye?: THREE.Vector3) {
    // Point-blank impacts would fill the screen; keep just the mark.
    const near = !!eye && eye.distanceTo(at) < 1.6;
    const energy = surface === 'energy';
    const metal = surface === 'metal' || surface === 'glass';
    const dust = surface === 'dirt' || surface === 'rock' || surface === 'concrete' || !surface;
    const count = near ? 0 : metal ? 7 : 4;
    for (let i = 0; i < count; i++) {
      const color = energy ? 0x7ff6ff : metal ? 0xffd27a : 0xffb36a;
      const m = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const v = normal.clone().multiplyScalar(2 + Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5));
      m.position.copy(at); m.lookAt(at.clone().add(v));
      this.add(m, v, 0.18 + Math.random() * 0.15, 14, 0, true);
    }
    if (dust && !near) {
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smoke, transparent: true, depthWrite: false, opacity: 0.55 }));
        s.position.copy(at).addScaledVector(normal, 0.1); s.scale.setScalar(0.25);
        this.add(s, normal.clone().multiplyScalar(0.8 + Math.random()).add(new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.5, (Math.random() - 0.5))), 0.7 + Math.random() * 0.4, -0.5, 2.2, true);
      }
    }
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: energy ? 0x7ff6ff : 0xffc27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.position.copy(at); g.scale.setScalar(0.35);
    this.add(g, new THREE.Vector3(), 0.06, 0, 1, true);
    if (decal && !energy) {
      const d = new THREE.Mesh(this.decalGeo, this.decalMat);
      d.position.copy(at).addScaledVector(normal, 0.01);
      d.lookAt(at.clone().add(normal));
      this.group.add(d); this.decals.push(d);
      if (this.decals.length > 120) this.decals.shift()!.removeFromParent();
    }
  }

  /** Erase every bullet hole (each round starts on clean walls). */
  clearDecals() {
    for (const d of this.decals) d.removeFromParent();
    this.decals.length = 0;
    for (const d of this.scorches) this.dispose(d);
    this.scorches.length = 0;
  }

  /** Energy splash when shots hit a soldier's shield or body. */
  hitSpark(at: THREE.Vector3, shield: boolean) {
    const color = shield ? 0x6fd8ff : 0xff7a4a;
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6);
      m.position.copy(at); m.lookAt(at.clone().add(v));
      this.add(m, v, 0.2, 10, 0, true);
    }
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.position.copy(at); g.scale.setScalar(0.5);
    this.add(g, new THREE.Vector3(), 0.08, 0, 2, true);
  }

  /**
   * A knife skin's blow landing at `at`, seen from `eye`: a soft puff of dust knocked out of the
   * clothes, broom straw breaking off, a glint of gold, the knife's sparks. Small and physical: the
   * blow itself reads through the swing, the hit-stop and the target's reaction.
   */
  meleeHit(at: THREE.Vector3, eye: THREE.Vector3, skin: KnifeSkin) {
    const look = MELEE_DEBRIS[skin];
    const toEye = eye.clone().sub(at).normalize();
    for (let i = 0; i < look.bits; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(look.bit).multiplyScalar(look.straw ? 1 : 1.6), transparent: true, depthWrite: false, blending: look.straw ? THREE.NormalBlending : THREE.AdditiveBlending });
      const m = new THREE.Mesh(this.sparkGeo, mat);
      const v = new THREE.Vector3().randomDirection().multiplyScalar(1.5 + Math.random() * 2.5).addScaledVector(toEye, 1.2);
      m.position.copy(at); m.lookAt(at.clone().add(v));
      m.scale.set(0.35, 0.35, look.straw ? 1.1 : 0.6);
      this.add(m, v, 0.25 + Math.random() * (look.straw ? 0.35 : 0.12), look.straw ? 9 : 4, 0, true);
    }
    for (let i = 0; i < look.dust; i++) {
      const d = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smoke, color: look.straw ? 0xc9b48a : 0xd8d2c8, transparent: true, depthWrite: false, opacity: 0.5 }));
      d.position.copy(at).addScaledVector(toEye, 0.08); d.scale.setScalar(0.12);
      this.add(d, new THREE.Vector3().randomDirection().multiplyScalar(0.5).addScaledVector(toEye, 0.4), 0.45 + Math.random() * 0.25, -0.2, 2.6, true, 0.45);
    }
  }

  /**
   * A blast at `at` over ground at height `ground`: a flash, a fireball that cools to black, smoke that
   * billows and rises, sparks and debris that bounce, and near the ground a pressure ring, a dust skirt
   * and a burn mark. Big blasts (a car, the bomb) leave a smoke column standing for some seconds.
   */
  explosion(at: THREE.Vector3, scale = 1, ground = at.y) {
    const n = (count: number) => Math.max(1, Math.round(count * this.detail));
    const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
    const low = at.y - ground < 2.5 * scale;
    this.flash(at, 0xffa050, 60 * scale, 0.5, 22);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: new THREE.Color(4, 3.6, 2.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.position.copy(at); core.scale.setScalar(2 * scale);
    this.add(core, new THREE.Vector3(), 0.12, 0, 14, true);
    for (let i = 0; i < n(9); i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(rand(2, 7) * scale);
      v.y = Math.abs(v.y) * 0.9 + scale;
      const s = this.puff(true);
      s.position.copy(at).addScaledVector(v, 0.03);
      this.add(s, v, rand(0.55, 1), -2, 0, true, 1, { drag: 4, size: [1.2 * scale, rand(3, 4.6) * scale, 6], ramp: FIRE, spin: rand(-1, 1) });
    }
    const smoke = [new THREE.Color(0x2e2620), this.haze.clone().multiplyScalar(0.55), this.haze];
    for (let i = 0; i < n(11); i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(rand(1.5, 5) * scale);
      v.y = Math.abs(v.y) + 0.8 * scale;
      const s = this.puff(false);
      s.position.copy(at);
      this.add(s, v, rand(2.6, 4.6), -3, 0, true, 1.1, { delay: rand(0.04, 0.16), drag: 2.2, size: [1.4 * scale, rand(4, 6) * scale, 2.2], fadeIn: 0.12, ramp: smoke, spin: rand(-0.4, 0.4) });
    }
    for (let i = 0; i < n(18); i++) {
      const m = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc070).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const v = new THREE.Vector3((Math.random() - 0.5) * 24, Math.random() * 15, (Math.random() - 0.5) * 24);
      m.position.copy(at); m.lookAt(at.clone().add(v)); m.scale.setScalar(2);
      this.add(m, v, rand(0.5, 1), 16, 0, true);
    }
    for (let i = 0; i < n(12); i++) {
      const m = new THREE.Mesh(this.chunkGeo, new THREE.MeshBasicMaterial({ color: DEBRIS[i % DEBRIS.length], transparent: true }));
      const v = new THREE.Vector3().randomDirection().multiplyScalar(rand(3, 9) * Math.sqrt(scale));
      v.y = Math.abs(v.y) + rand(2, 6);
      m.position.copy(at); m.rotation.set(rand(0, 6), rand(0, 6), 0); m.scale.setScalar(rand(0.4, 1.2) * Math.sqrt(scale));
      this.add(m, v, rand(2.2, 3.5), 18, 0, true, 1, { floor: ground + 0.05, spin: rand(-12, 12) });
    }
    if (scale >= 1.5) for (let i = 0; i < n(7); i++) {
      // The column that stands after a big blast: late puffs from the seat of the fire.
      const s = this.puff(false);
      s.position.set(at.x + rand(-0.8, 0.8) * scale, ground + rand(0.3, 1.2), at.z + rand(-0.8, 0.8) * scale);
      this.add(s, new THREE.Vector3(rand(-0.4, 0.4), rand(1.5, 3), rand(-0.4, 0.4)), rand(3.5, 5.5), -1.2, 0, true, 0.7,
        { delay: rand(0.3, 2.4), drag: 0.6, size: [1.2 * scale, 3.4 * scale, 0.7], fadeIn: 0.3, ramp: [smoke[1], this.haze], spin: rand(-0.3, 0.3) });
    }
    if (!low) return;
    const ring = new THREE.Mesh(this.flat, new THREE.MeshBasicMaterial({ map: this.ring, color: new THREE.Color(1.6, 1.3, 0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(at.x, ground + 0.08, at.z);
    this.add(ring, new THREE.Vector3(), 0.32, 0, 0, true, 0.4, { size: [1.5 * scale, 14 * scale, 8] });
    const dust = this.haze.clone().lerp(new THREE.Color(0xd8ccb8), 0.5);
    for (let i = 0; i < n(8); i++) {
      const a = (i + Math.random()) / n(8) * Math.PI * 2, speed = rand(7, 11) * scale;
      const s = this.puff(false);
      s.material.color.copy(dust);
      s.position.set(at.x, ground + 0.35, at.z);
      this.add(s, new THREE.Vector3(Math.cos(a) * speed, 0.3, Math.sin(a) * speed), rand(1.1, 1.8), 0, 0, true, 0.5, { drag: 3.5, size: [0.6 * scale, 2.4 * scale, 3], fadeIn: 0.05, spin: rand(-0.5, 0.5) });
    }
    const mark = new THREE.Mesh(this.flat, new THREE.MeshBasicMaterial({ map: this.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    mark.position.set(at.x, ground + 0.03, at.z); mark.rotation.y = rand(0, 6.28); mark.scale.setScalar(4.4 * scale);
    this.group.add(mark); this.scorches.push(mark);
    if (this.scorches.length > 10) this.dispose(this.scorches.shift()!);
  }

  /** The dust of a falling building: it pours out of `box` along the ground while the walls come down, then hangs over the rubble. */
  dust(box: THREE.Box3, seconds = 2.5) {
    const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
    const centre = box.getCenter(new THREE.Vector3()), top = Math.min(box.max.y, box.min.y + 7);
    const pale = this.haze.clone().lerp(new THREE.Color(0xcfc4b0), 0.6);
    const count = Math.max(1, Math.round(34 * this.detail));
    for (let i = 0; i < count; i++) {
      const s = this.puff(false);
      s.position.set(rand(box.min.x, box.max.x), rand(box.min.y + 0.5, top), rand(box.min.z, box.max.z));
      const out = new THREE.Vector3(s.position.x - centre.x, 0, s.position.z - centre.z).normalize().multiplyScalar(rand(2, 7));
      out.y = rand(0.3, 1.6);
      this.add(s, out, rand(4, 7), -0.4, 0, true, 0.8, { delay: rand(0, seconds), drag: 1.1, size: [1.6, rand(5, 8.5), 0.8], fadeIn: 0.35, ramp: [pale, pale.clone().multiplyScalar(0.85)], spin: rand(-0.25, 0.25) });
    }
  }

  private puff(fire: boolean) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffs[Math.random() < 0.5 ? 0 : 1], transparent: true, depthWrite: false, rotation: Math.random() * 6.28, blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending }));
  }

  /** A puff of white tyre smoke off a sliding wheel; it drifts with the car a little, rises and spreads. */
  tyreSmoke(at: THREE.Vector3, carry: THREE.Vector3, strength: number, scale = 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smoke, color: 0xe8e6e2, transparent: true, depthWrite: false, opacity: 0.5 * strength }));
    s.position.set(at.x + (Math.random() - 0.5) * 0.3, at.y, at.z + (Math.random() - 0.5) * 0.3);
    s.scale.setScalar(0.5 * scale);
    const v = carry.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2));
    this.add(s, v, 0.9 + Math.random() * 0.7, -0.4, 1.6, true, 0.25 + 0.35 * strength);
  }

  /** Team-coloured implosion when a soldier respawns (and a violet one for graviton blasts). */
  burst(at: THREE.Vector3, color = 0x8ff6ff) {
    this.flash(at, color, 25, 0.25, 14);
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const v = new THREE.Vector3().randomDirection().multiplyScalar(6 + Math.random() * 6);
      m.position.copy(at); m.lookAt(at.clone().add(v)); m.scale.setScalar(1.5);
      this.add(m, v, 0.5, 6, 0, true);
    }
  }

  private add(mesh: THREE.Mesh | THREE.Sprite, velocity: THREE.Vector3, life: number, gravity: number, grow: number, fade: boolean, alpha = 1, motion?: Motion) {
    this.group.add(mesh);
    if (motion?.delay) mesh.visible = false;
    if (motion?.size) mesh.scale.setScalar(motion.size[0]);
    if (motion?.ramp) (mesh.material as THREE.SpriteMaterial).color.copy(motion.ramp[0]);
    this.particles.push({ mesh, velocity, life, maxLife: life, gravity, grow, fade, alpha, ...motion });
    if (this.particles.length > 400) { const old = this.particles.shift()!; this.dispose(old.mesh); }
  }

  private dispose(mesh: THREE.Mesh | THREE.Sprite) {
    mesh.removeFromParent();
    (mesh.material as THREE.Material).dispose();
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (p.delay) {
        p.delay -= dt;
        if (p.delay > 0) continue;
        p.delay = 0; p.mesh.visible = true;
      }
      p.life -= dt;
      if (p.life <= 0) { this.dispose(p.mesh); this.particles.splice(i, 1); continue; }
      const age = p.maxLife - p.life, sprite = (p.mesh as THREE.Sprite).isSprite, material = p.mesh.material as THREE.SpriteMaterial;
      if (p.drag) p.velocity.multiplyScalar(Math.exp(-p.drag * dt));
      p.velocity.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      if (p.floor !== undefined && p.mesh.position.y < p.floor) {
        // Debris lands, bounces lower each time and comes to rest.
        p.mesh.position.y = p.floor;
        p.velocity.set(p.velocity.x * 0.6, -p.velocity.y * 0.35, p.velocity.z * 0.6);
        if (p.velocity.y < 0.8) { p.velocity.set(0, 0, 0); p.gravity = 0; p.spin = 0; }
      }
      if (p.size) p.mesh.scale.setScalar(p.size[1] + (p.size[0] - p.size[1]) * Math.exp(-p.size[2] * age));
      else if (p.grow) p.mesh.scale.multiplyScalar(1 + p.grow * dt);
      if (p.spin) {
        if (sprite) material.rotation += p.spin * dt;
        else { p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.z += p.spin * 0.7 * dt; }
      }
      if (p.ramp) {
        const f = Math.min(0.999, age / p.maxLife) * (p.ramp.length - 1), k = Math.floor(f);
        material.color.lerpColors(p.ramp[k], p.ramp[k + 1], f - k);
      }
      if (p.fade) material.opacity = Math.min(1, p.life / p.maxLife * 1.5) * (sprite ? 0.8 : 1) * p.alpha * (p.fadeIn ? Math.min(1, age / p.fadeIn) : 1);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.head = Math.min(t.total, t.head + t.speed * dt);
      if (t.head >= t.total) t.length -= t.speed * dt;
      const tail = Math.max(0, t.head - Math.max(0, t.length));
      if (t.length <= 0) { this.dispose(t.mesh); this.tracers.splice(i, 1); continue; }
      t.mesh.position.copy(t.from).addScaledVector(t.dir, tail);
      t.mesh.scale.z = Math.max(0.001, t.head - tail);
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.life -= dt;
      l.light.intensity = Math.max(0, l.life / l.maxLife) * l.intensity;
      if (l.life <= 0) { l.light.intensity = 0; this.lights.splice(i, 1); }
    }
  }
}
