import * as THREE from 'three';
import type { Assets } from '../assets';
import type { Body } from '../../shared/world';
import { InterpBuffer } from './interp';

interface View { object: THREE.Object3D; buffer: InterpBuffer<{ x: number; y: number; z: number }>; trail: Trail; kind: Body['kind']; light?: THREE.Mesh; seen: number }

/** Fading trail of recent positions, so a thrown grenade or launched charge reads in flight. */
class Trail {
  readonly line: THREE.Line;
  private points: THREE.Vector3[] = [];
  constructor(private color: THREE.Color, private max = 60) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.line.frustumCulled = false;
  }
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

/** Renders thrown and launched objects: grenades and graviton charges. */
export class BodiesView {
  readonly group = new THREE.Group();
  private views = new Map<number, View>();
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
      v.buffer.push(t, { x: b.x, y: b.y, z: b.z });
      v.seen = this.frame;
    }
    for (const [id, v] of this.views) {
      if (v.seen !== this.frame) { v.object.removeFromParent(); v.trail.line.removeFromParent(); this.views.delete(id); }
    }
  }

  update(dt: number, renderTime: number, time: number) {
    for (const v of this.views.values()) {
      const p = v.buffer.sample(renderTime);
      if (!p) continue;
      v.object.position.set(p.x, p.y, p.z);
      if (v.kind === 'grenade') {
        v.object.rotation.x += dt * 9;
        if (v.light) v.light.visible = Math.sin(time * 18) > 0;
      } else {
        v.object.scale.setScalar(1 + Math.sin(time * 30) * 0.18);
        v.object.rotation.y += dt * 8;
      }
      v.trail.push(v.object.position);
    }
  }

  private create(b: Body): View {
    let object: THREE.Object3D, trail: Trail, light: THREE.Mesh | undefined;
    if (b.kind === 'grenade') {
      object = this.assets.weapons.get('Prop_Grenade')!.clone();
      object.scale.setScalar(1.1);
      light = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4020).multiplyScalar(4) }));
      light.position.y = 0.12;
      object.add(light);
      trail = new Trail(new THREE.Color(0xffb070).multiplyScalar(0.6), 40);
    } else {
      // Graviton charge: a violet core inside a spinning ring.
      object = new THREE.Mesh(this.chargeGeo, this.chargeMat);
      const ring = new THREE.Mesh(this.chargeRingGeo, this.chargeMat);
      ring.rotation.x = Math.PI / 2.6;
      object.add(ring);
      trail = new Trail(new THREE.Color(0xa77bff).multiplyScalar(1.2), 70);
    }
    object.position.set(b.x, b.y, b.z);
    this.group.add(object, trail.line);
    return { object, buffer: new InterpBuffer(), trail, kind: b.kind, light, seen: this.frame };
  }
}
