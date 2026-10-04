import * as THREE from 'three';

interface Particle { mesh: THREE.Mesh | THREE.Sprite; velocity: THREE.Vector3; life: number; maxLife: number; gravity: number; grow: number; fade: boolean }
interface Tracer { mesh: THREE.Mesh; life: number; maxLife: number }
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

  constructor() {
    // A small fixed pool of point lights avoids shader recompiles from changing light counts.
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffc070, 0, 8, 2);
      this.group.add(l); this.lightPool.push(l);
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xffe2a0, width = 1) {
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(this.tracerGeo, mat);
    mesh.position.copy(from); mesh.lookAt(to);
    mesh.scale.set(width, width, len);
    this.group.add(mesh);
    this.tracers.push({ mesh, life: 0.07, maxLife: 0.07 });
  }

  flash(at: THREE.Vector3, color = 0xffc070, intensity = 6, life = 0.06, distance = 9) {
    const light = this.lightPool.find(l => !this.lights.some(x => x.light === l));
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

  /** Blue implosion when a drone is destroyed or a lawbreaker respawns. */
  burst(at: THREE.Vector3, color = 0x8ff6ff) {
    this.flash(at, color, 25, 0.25, 14);
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const v = new THREE.Vector3().randomDirection().multiplyScalar(6 + Math.random() * 6);
      m.position.copy(at); m.lookAt(at.clone().add(v)); m.scale.setScalar(1.5);
      this.add(m, v, 0.5, 6, 0, true);
    }
  }

  private add(mesh: THREE.Mesh | THREE.Sprite, velocity: THREE.Vector3, life: number, gravity: number, grow: number, fade: boolean) {
    this.group.add(mesh);
    this.particles.push({ mesh, velocity, life, maxLife: life, gravity, grow, fade });
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
      if (p.fade) (p.mesh.material as THREE.Material & { opacity: number }).opacity = Math.min(1, p.life / p.maxLife * 1.5) * ((p.mesh as THREE.Sprite).isSprite ? 0.8 : 1);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) { this.dispose(t.mesh); this.tracers.splice(i, 1); continue; }
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = t.life / t.maxLife;
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.life -= dt;
      l.light.intensity = Math.max(0, l.life / l.maxLife) * l.intensity;
      if (l.life <= 0) { l.light.intensity = 0; this.lights.splice(i, 1); }
    }
  }
}
