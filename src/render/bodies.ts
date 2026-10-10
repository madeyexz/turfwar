import * as THREE from 'three';
import type { Assets } from '../assets';
import type { Body } from '../../shared/world';
import { InterpBuffer } from './interp';

interface View {
  object: THREE.Object3D; buffer: InterpBuffer<{ x: number; y: number; z: number }>; trail: Trail; light?: THREE.Mesh; seen: number;
  /** A thrown 藍白拖: its model spins inside `object`; once it lies still, `ring` marks it for picking up. */
  slipper?: { spin: THREE.Object3D; ring: THREE.Mesh; still: number; last: THREE.Vector3 };
}

/** Fading trail of recent positions, so a thrown grenade reads in flight. */
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

/**
 * Renders thrown M67 frags (blinking fuse light), M18 smoke canisters and 藍白拖 with a trail; popped
 * clouds are SmokeView's. A slipper lying still gets a pulsing ring so it can be found and picked up.
 */
export class BodiesView {
  readonly group = new THREE.Group();
  private views = new Map<number, View>();
  private frame = 0;

  constructor(private assets: Assets) {}

  sync(bodies: Body[], t: number) {
    this.frame++;
    for (const b of bodies) {
      if (b.kind === 'smokeCloud') continue;
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
      if (v.slipper) { this.updateSlipper(v, v.slipper, dt, time); continue; }
      v.object.rotation.x += dt * 9;
      if (v.light) v.light.visible = Math.sin(time * 18) > 0;
      v.trail.push(v.object.position);
    }
  }

  private updateSlipper(v: View, s: NonNullable<View['slipper']>, dt: number, time: number) {
    const moved = v.object.position.distanceTo(s.last);
    s.last.copy(v.object.position);
    s.still = moved < 0.002 ? s.still + dt : 0;
    const resting = s.still > 0.25;
    if (!resting) {
      // In flight it spins flat like a thrown frisbee, wobbling a little.
      s.spin.rotation.y += dt * 22;
      s.spin.rotation.x = Math.sin(time * 9) * 0.25;
      v.trail.push(v.object.position);
    } else {
      s.spin.rotation.x *= Math.exp(-dt * 10);
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      s.ring.scale.setScalar(1 + pulse * 0.25);
      (s.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + pulse * 0.4;
    }
    s.ring.visible = resting;
    v.trail.line.visible = !resting;
  }

  private create(b: Body): View {
    if (b.kind === 'slipper') {
      // The 藍白拖 (or the knife, with the reskin off) lying flat, its middle on the pivot.
      const model = this.assets.weapons.get('Gun_Knife')!.clone();
      model.scale.setScalar(1.35);
      model.rotation.x = -Math.PI / 2;
      model.position.set(0.095 * 1.35, -0.005, 0);
      const spin = new THREE.Group();
      spin.add(model);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6fb4ff).multiplyScalar(2), transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.04;
      ring.visible = false;
      const object = new THREE.Group();
      object.add(spin, ring);
      const trail = new Trail(new THREE.Color(0x8cc4ff).multiplyScalar(0.7), 40);
      object.position.set(b.x, b.y, b.z);
      this.group.add(object, trail.line);
      return { object, buffer: new InterpBuffer(), trail, seen: this.frame, slipper: { spin, ring, still: 0, last: new THREE.Vector3(b.x, b.y, b.z) } };
    }
    if (b.kind === 'smoke') {
      // An olive canister with a pale band (the M18's look), tumbling, with a grey trail.
      const object = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0x4d5a3a, roughness: 0.75 }));
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.0335, 0.03, 10), new THREE.MeshStandardMaterial({ color: 0xd8d4c4, roughness: 0.8 }));
      band.position.y = 0.035;
      object.add(band);
      const trail = new Trail(new THREE.Color(0xc8ccd0).multiplyScalar(0.35), 40);
      object.position.set(b.x, b.y, b.z);
      this.group.add(object, trail.line);
      return { object, buffer: new InterpBuffer(), trail, seen: this.frame };
    }
    const object = this.assets.weapons.get('Prop_Grenade')!.clone();
    object.scale.setScalar(1.1);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4020).multiplyScalar(4) }));
    light.position.y = 0.12;
    object.add(light);
    const trail = new Trail(new THREE.Color(0xffb070).multiplyScalar(0.6), 40);
    object.position.set(b.x, b.y, b.z);
    this.group.add(object, trail.line);
    return { object, buffer: new InterpBuffer(), trail, light, seen: this.frame };
  }
}
