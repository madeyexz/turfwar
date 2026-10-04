import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../assets';
import type { Body } from '../../shared/world';
import { InterpBuffer } from './interp';

const TEAM_GLOW = [new THREE.Color(0x58b6ff), new THREE.Color(0xff5a4a), new THREE.Color(0xc0ff7a)];

interface View { object: THREE.Object3D; buffer: InterpBuffer<{ x: number; y: number; z: number }>; mixer?: THREE.AnimationMixer; trail?: Trail; kind: Body['kind']; team: number; light?: THREE.Mesh; seen: number }

/** Trail of recent positions so orbits (and their breaking) are readable. */
class Trail {
  readonly line: THREE.Line;
  private points: THREE.Vector3[] = [];
  constructor(color: THREE.Color, private max = 90) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.line.frustumCulled = false;
    this.color = color;
  }
  color: THREE.Color;
  push(p: THREE.Vector3) {
    const last = this.points[this.points.length - 1];
    if (last && last.distanceToSquared(p) < 0.04) return;
    this.points.push(p.clone());
    if (this.points.length > this.max) this.points.shift();
    const pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute, col = this.line.geometry.getAttribute('color') as THREE.BufferAttribute;
    this.points.forEach((q, i) => {
      pos.setXYZ(i, q.x, q.y, q.z);
      const f = (i / this.points.length) ** 1.5;
      col.setXYZ(i, this.color.r * f, this.color.g * f, this.color.b * f);
    });
    pos.needsUpdate = col.needsUpdate = true;
    this.line.geometry.setDrawRange(0, this.points.length);
  }
}

/** Renders lawful-world bodies: sentinel drones, grenades, graviton charges, plasma bolts and anomaly shards. */
export class BodiesView {
  readonly group = new THREE.Group();
  private views = new Map<number, View>();
  private boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a3a).multiplyScalar(3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  private boltGeo = new THREE.CapsuleGeometry(0.07, 0.5, 4, 8).rotateX(Math.PI / 2);
  private shardGeo = new THREE.OctahedronGeometry(0.3, 0).scale(0.6, 1.4, 0.6);
  private shardMat = new THREE.MeshStandardMaterial({ color: 0x0c1e24, emissive: 0x6ff0ff, emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.25 });
  private chargeGeo = new THREE.IcosahedronGeometry(0.13, 1);
  private chargeRingGeo = new THREE.TorusGeometry(0.24, 0.02, 6, 24);
  private chargeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb48cff).multiplyScalar(3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  private frame = 0;

  constructor(private assets: Assets) {}

  sync(bodies: Body[], t: number) {
    this.frame++;
    for (const b of bodies) {
      let v = this.views.get(b.id);
      if (!v) { v = this.create(b); this.views.set(b.id, v); }
      if (v.team !== b.team) this.recolor(v, b.team);
      v.buffer.push(t, { x: b.x, y: b.y, z: b.z });
      v.seen = this.frame;
    }
    for (const [id, v] of this.views) {
      if (v.seen !== this.frame) { v.object.removeFromParent(); v.trail?.line.removeFromParent(); this.views.delete(id); }
    }
  }

  update(dt: number, renderTime: number, time: number) {
    for (const v of this.views.values()) {
      const p = v.buffer.sample(renderTime);
      if (!p) continue;
      const prev = v.object.position.clone();
      v.object.position.set(p.x, p.y, p.z);
      v.mixer?.update(dt);
      if (v.kind === 'drone') {
        // Face the direction of travel; bob the eye light.
        const vel = v.object.position.clone().sub(prev);
        if (vel.lengthSq() > 1e-6) v.object.rotation.y = Math.atan2(vel.x, vel.z);
      } else if (v.kind === 'debris') {
        v.object.rotation.y += dt * 1.2; v.object.rotation.x += dt * 0.7;
      } else if (v.kind === 'grenade') {
        v.object.rotation.x += dt * 9;
        if (v.light) v.light.visible = Math.sin(time * 18) > 0;
      } else if (v.kind === 'charge') {
        const pulse = 1 + Math.sin(time * 30) * 0.18;
        v.object.scale.setScalar(pulse);
        v.object.rotation.y += dt * 8;
      } else if (v.kind === 'bolt') {
        const vel = v.object.position.clone().sub(prev);
        if (vel.lengthSq() > 1e-8) v.object.lookAt(v.object.position.clone().add(vel));
      }
      v.trail?.push(v.object.position);
    }
  }

  /** Current rendered positions of drones (for client-side hit tests). */
  drones() { return [...this.views.entries()].filter(([, v]) => v.kind === 'drone').map(([id, v]) => ({ id, position: v.object.position, team: v.team })); }
  position(id: number) { return this.views.get(id)?.object.position; }

  private create(b: Body): View {
    let object: THREE.Object3D, mixer: THREE.AnimationMixer | undefined, trail: Trail | undefined, light: THREE.Mesh | undefined;
    switch (b.kind) {
      case 'drone': {
        object = new THREE.Group();
        const model = SkeletonUtils.clone(this.assets.drone.scene);
        model.scale.setScalar(1.0);
        model.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; (o as THREE.Mesh).frustumCulled = false; } });
        object.add(model);
        mixer = new THREE.AnimationMixer(model);
        const clip = THREE.AnimationClip.findByName(this.assets.drone.animations, 'Idle') ?? this.assets.drone.animations[0];
        if (clip) mixer.clipAction(clip).play();
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: TEAM_GLOW[2].clone().multiplyScalar(3) }));
        glow.position.set(0, 0.1, 0.42); glow.name = 'glow';
        object.add(glow);
        trail = new Trail(TEAM_GLOW[2].clone().multiplyScalar(1.4), 120);
        break;
      }
      case 'grenade': {
        object = this.assets.weapons.get('Prop_Grenade')!.clone();
        object.scale.setScalar(1.1);
        light = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4020).multiplyScalar(4) }));
        light.position.y = 0.12;
        object.add(light);
        trail = new Trail(new THREE.Color(0xffb070).multiplyScalar(0.6), 40);
        break;
      }
      case 'bolt': {
        object = new THREE.Mesh(this.boltGeo, this.boltMat);
        break;
      }
      case 'charge': {
        // Graviton charge: a violet core inside a spinning ring, trailing its (law-bent) path.
        object = new THREE.Mesh(this.chargeGeo, this.chargeMat);
        const ring = new THREE.Mesh(this.chargeRingGeo, this.chargeMat);
        ring.rotation.x = Math.PI / 2.6;
        object.add(ring);
        trail = new Trail(new THREE.Color(0xa77bff).multiplyScalar(1.2), 70);
        break;
      }
      default: {
        object = new THREE.Mesh(this.shardGeo, this.shardMat);
        object.castShadow = true;
        trail = new Trail(new THREE.Color(0x6ff0ff).multiplyScalar(0.8), 140);
      }
    }
    object.position.set(b.x, b.y, b.z);
    this.group.add(object);
    if (trail) this.group.add(trail.line);
    const view: View = { object, buffer: new InterpBuffer(), mixer, trail, kind: b.kind, team: -2, light, seen: this.frame };
    this.recolor(view, b.team);
    return view;
  }

  private recolor(v: View, team: number) {
    v.team = team;
    if (v.kind === 'bolt') {
      const c = team === 0 ? 0x58b6ff : team === 1 ? 0xff5a4a : 0xc8ff6a;
      (v.object as THREE.Mesh).material = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    }
    if (v.kind !== 'drone') return;
    const color = TEAM_GLOW[team < 0 ? 2 : team];
    const glow = v.object.getObjectByName('glow') as THREE.Mesh;
    (glow.material as THREE.MeshBasicMaterial).color.copy(color).multiplyScalar(3);
    if (v.trail) v.trail.color = color.clone().multiplyScalar(1.4);
  }
}
