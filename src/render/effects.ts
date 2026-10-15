import * as THREE from 'three';
import type { KnifeSkin } from '../../shared/skins';
import { CJK_STACK, cjkFontReady } from '../ui/fonts';

interface Particle { mesh: THREE.Mesh | THREE.Sprite; velocity: THREE.Vector3; life: number; maxLife: number; gravity: number; grow: number; fade: boolean; alpha: number }
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

/** A comic starburst: jagged spikes filled with `fill`, outlined in `stroke`. */
function burstTexture(fill: string, stroke: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, r = i % 2 ? 30 + (i * 7 % 5) * 2 : 52 + (i * 13 % 7) * 1.5;
    ctx.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.lineJoin = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = stroke; ctx.stroke();
  ctx.fillStyle = fill; ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

/** A thin bright ring (a shockwave seen face-on). */
function ringTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath(); ctx.arc(64, 64, 54, 0, Math.PI * 2);
  ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke();
  return new THREE.CanvasTexture(canvas);
}

/** A comic sound word (啪!) in heavy type: `fill` inside a thick `stroke`. */
function wordTexture(word: string, fill: string, stroke: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const draw = () => {
    ctx.clearRect(0, 0, 256, 128);
    ctx.font = `900 96px ${CJK_STACK}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 16; ctx.strokeStyle = stroke; ctx.strokeText(word, 128, 68);
    ctx.fillStyle = fill; ctx.fillText(word, 128, 68);
  };
  draw();
  const texture = new THREE.CanvasTexture(canvas);
  // Drawn in the bundled Noto Sans TC once it has loaded (a fallback face until then).
  void cjkFontReady(word).then(() => { draw(); texture.needsUpdate = true; });
  return texture;
}

/** How each knife skin's blow looks where it lands: burst colours, the sound word, and what flies off. */
const MELEE_LOOK: Record<KnifeSkin, { fill: string; stroke: string; word?: string; bits: number; bit: number; additive: boolean; dust: number }> = {
  slipper: { fill: '#ffffff', stroke: '#2f6fe0', word: '啪!', bits: 9, bit: 0xffffff, additive: true, dust: 0 },
  gold: { fill: '#ffe066', stroke: '#b86a00', word: '啪!', bits: 14, bit: 0xffc83a, additive: true, dust: 0 },
  broom: { fill: '#f6dc8c', stroke: '#6b4416', word: '碰!', bits: 14, bit: 0xd8b058, additive: false, dust: 4 },
  knife: { fill: '#ffd0b8', stroke: '#b3261e', bits: 8, bit: 0xff7a4a, additive: true, dust: 0 },
};

/** A sprite that pops in (overshooting its size), holds, drifts up and fades: bursts, rings and sound words. */
interface Pop { sprite: THREE.Sprite; life: number; maxLife: number; size: number; end: number; rise: number }
const easeOutBack = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

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
  private pops: Pop[] = [];
  private meleeTex = new Map<string, THREE.Texture>();

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
   * A knife skin's blow landing at `at`, seen from `eye`: a comic starburst and shockwave ring, the
   * skin's sound word (啪! for a slipper, 碰! for the broom) popping out, and what flies off it
   * (white flecks, gold glitter, broom straw and dust, the knife's sparks). `onTop` draws the burst
   * over everything (the striker's own blow, which lands right in front of them).
   */
  meleeHit(at: THREE.Vector3, eye: THREE.Vector3, skin: KnifeSkin, onTop = false, kill = false) {
    const look = MELEE_LOOK[skin];
    const toEye = eye.clone().sub(at), distance = toEye.length();
    toEye.normalize();
    // Out in front of the body it hit, and never so close it fills the screen.
    const spot = at.clone().addScaledVector(toEye, Math.min(0.35, distance * 0.3));
    const scale = Math.max(0.6, Math.min(1.4, spot.distanceTo(eye) / 1.6)) * (kill ? 1.3 : 1);
    const tex = (key: string, make: () => THREE.Texture) => { let t = this.meleeTex.get(key); if (!t) this.meleeTex.set(key, t = make()); return t; };
    const pop = (map: THREE.Texture, size: number, end: number, life: number, rise = 0, color = 0xffffff, aspect = 1, lift = 0) => {
      const m = new THREE.SpriteMaterial({ map, color, transparent: true, depthWrite: false, depthTest: !onTop });
      m.rotation = (Math.random() - 0.5) * 0.5;
      const sprite = new THREE.Sprite(m);
      sprite.position.copy(spot); sprite.position.y += lift * scale; sprite.renderOrder = onTop ? 10 : 0;
      sprite.userData.aspect = aspect;
      this.group.add(sprite);
      this.pops.push({ sprite, life, maxLife: life, size: size * scale, end: end * scale, rise });
    };
    pop(tex('ring', ringTexture), 0.15, 1.1, 0.2);
    pop(tex(`burst-${skin}`, () => burstTexture(look.fill, look.stroke)), 0.62, 0.7, 0.13);
    // The word pops above the burst, clear of the crosshair.
    if (look.word) pop(tex(`word-${skin}`, () => wordTexture(look.word!, look.fill, look.stroke)), 0.4, 0.46, 0.6, 0.6, 0xffffff, 2, 0.3);
    for (let i = 0; i < look.bits; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(look.bit).multiplyScalar(look.additive ? 1.6 : 1), transparent: true, depthWrite: false, depthTest: !onTop, blending: look.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
      const m = new THREE.Mesh(this.sparkGeo, mat);
      // Mostly flung back toward the striker and out to the sides; straw falls, flecks and sparks fly.
      const v = new THREE.Vector3().randomDirection().multiplyScalar(3 + Math.random() * 4).addScaledVector(toEye, 2.5);
      m.position.copy(spot); m.lookAt(spot.clone().add(v)); m.renderOrder = onTop ? 10 : 0;
      if (skin === 'broom') m.scale.set(0.45, 0.45, 1.3); else m.scale.set(0.4, 0.4, 0.8);
      this.add(m, v, 0.25 + Math.random() * (skin === 'broom' ? 0.35 : 0.15), skin === 'broom' ? 9 : 6, 0, true);
    }
    for (let i = 0; i < look.dust; i++) {
      const d = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smoke, color: 0xc9b48a, transparent: true, depthWrite: false, opacity: 0.6 }));
      d.position.copy(spot); d.scale.setScalar(0.3 * scale);
      this.add(d, new THREE.Vector3().randomDirection().multiplyScalar(0.8).addScaledVector(toEye, 0.6), 0.6 + Math.random() * 0.3, -0.3, 2.4, true, 0.8);
    }
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: skin === 'gold' ? 0xffd060 : 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: !onTop }));
    g.position.copy(spot); g.scale.setScalar(0.7 * scale); g.renderOrder = onTop ? 10 : 0;
    this.add(g, new THREE.Vector3(), 0.09, 0, 3, true);
  }

  explosion(at: THREE.Vector3, scale = 1) {
    this.flash(at, 0xffa050, 60 * scale, 0.35, 22);
    const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xffb060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    fire.position.copy(at); fire.scale.setScalar(1.5 * scale);
    this.add(fire, new THREE.Vector3(), 0.35, 0, 14 * scale, true);
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smoke, color: i < 4 ? 0xff9a50 : 0x8a8070, transparent: true, depthWrite: false, opacity: 0.8 }));
      s.position.copy(at); s.scale.setScalar(0.8 * scale);
      const v = new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8).multiplyScalar(scale);
      this.add(s, v, 0.9 + Math.random() * 0.9, -1, 4 * scale, true);
    }
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc070).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const v = new THREE.Vector3((Math.random() - 0.5) * 22, Math.random() * 14, (Math.random() - 0.5) * 22);
      m.position.copy(at); m.lookAt(at.clone().add(v)); m.scale.setScalar(2);
      this.add(m, v, 0.5 + Math.random() * 0.5, 16, 0, true);
    }
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

  private add(mesh: THREE.Mesh | THREE.Sprite, velocity: THREE.Vector3, life: number, gravity: number, grow: number, fade: boolean, alpha = 1) {
    this.group.add(mesh);
    this.particles.push({ mesh, velocity, life, maxLife: life, gravity, grow, fade, alpha });
    if (this.particles.length > 400) { const old = this.particles.shift()!; this.dispose(old.mesh); }
  }

  private dispose(mesh: THREE.Mesh | THREE.Sprite) {
    mesh.removeFromParent();
    (mesh.material as THREE.Material).dispose();
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.dispose(p.mesh); this.particles.splice(i, 1); continue; }
      p.velocity.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      if (p.grow) p.mesh.scale.multiplyScalar(1 + p.grow * dt);
      if (p.fade) (p.mesh.material as THREE.Material & { opacity: number }).opacity = Math.min(1, p.life / p.maxLife * 1.5) * ((p.mesh as THREE.Sprite).isSprite ? 0.8 : 1) * p.alpha;
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.life -= dt;
      if (p.life <= 0) { this.dispose(p.sprite); this.pops.splice(i, 1); continue; }
      const u = 1 - p.life / p.maxLife;
      const size = u < 0.3 ? p.size * 0.4 + (p.end - p.size * 0.4) * easeOutBack(u / 0.3) : p.end;
      p.sprite.scale.set(size * p.sprite.userData.aspect, size, 1);
      p.sprite.position.y += p.rise * dt;
      p.sprite.material.opacity = u > 0.55 ? 1 - (u - 0.55) / 0.45 : 1;
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
