import * as THREE from 'three';
import type { CollisionWorld } from '../../shared/collision';
import { localToWorld, skidOf, type Vehicle, type VehicleKind } from '../../shared/vehicles';
import type { Effects } from './effects';

/** Rear tyres per kind, in the vehicle's local frame (x right, z forward), and the mark's width. */
const TYRES: Partial<Record<VehicleKind, { x: number; z: number }[]>> = {
  car: [{ x: -0.82, z: -1.36 }, { x: 0.82, z: -1.36 }],
  scooter: [{ x: 0, z: -0.62 }],
};
const WIDTH: Partial<Record<VehicleKind, number>> = { car: 0.24, scooter: 0.11 };
/** Ring of mark segments (old marks are overwritten), and how far a tyre travels per segment. */
const SEGMENTS = 1600, SEGMENT_LENGTH = 0.35;

type Pose = Pick<Vehicle, 'kind' | 'x' | 'y' | 'z' | 'yaw' | 'vx' | 'vz' | 'grounded'>;

/**
 * Tyre skid effects: dark rubber marks laid on the road behind sliding (or handbraked) tyres, and
 * white smoke puffing off them. Skid strength comes from the shared `skidOf`, so remote drifts
 * (from interpolated poses) mark the road like our own.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private positions: Float32Array;
  private colors: Float32Array;
  private next = 0;
  /** Last mark point per vehicle tyre (key id * 4 + tyre), cleared when the tyre grips again. */
  private last = new Map<number, THREE.Vector3>();
  private smokeDebt = new Map<number, number>();
  private side = new THREE.Vector3();

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(SEGMENTS * 4 * 3);
    this.colors = new Float32Array(SEGMENTS * 4 * 4);
    const index = new Uint32Array(SEGMENTS * 6);
    for (let i = 0; i < SEGMENTS; i++) index.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /**
   * Lay marks and smoke for every grounded car and scooter this frame. Returns each vehicle's skid
   * (0..1) for the tyre-screech voices. `braking` marks the one we drive while its handbrake is held.
   */
  update(dt: number, vehicles: { id: number; pose: Pose; braking?: boolean }[], world: CollisionWorld, effects: Effects) {
    const skids = new Map<number, number>();
    let dirty = false;
    for (const { id, pose, braking } of vehicles) {
      const tyres = TYRES[pose.kind];
      if (!tyres) continue;
      const skid = skidOf(pose, braking);
      skids.set(id, skid);
      for (let k = 0; k < tyres.length; k++) {
        const key = id * 4 + k;
        if (skid < 0.12) { this.last.delete(key); continue; }
        const p = localToWorld(pose, { x: tyres[k].x, y: 0, z: tyres[k].z });
        const floor = world.groundHeight(p.x, p.z, pose.y + 0.4, 0.15, 0.8);
        if (pose.y - floor > 0.35) { this.last.delete(key); continue; } // in the air: no rubber on the road
        // The body rests on the highest floor under it: a tyre over a seam or gully still marks at that height.
        const at = new THREE.Vector3(p.x, Math.max(floor, pose.y) + 0.025, p.z);
        const prev = this.last.get(key);
        if (!prev) { this.last.set(key, at); continue; }
        if (prev.distanceTo(at) < SEGMENT_LENGTH) continue;
        this.segment(prev, at, WIDTH[pose.kind]!, Math.min(0.85, 0.35 + skid * 0.55));
        this.last.set(key, at);
        dirty = true;
      }
      // Smoke off the tyres, thicker the harder they slide.
      if (skid > 0.25) {
        const debt = (this.smokeDebt.get(id) ?? 0) + dt * 22 * skid * tyres.length;
        let puffs = Math.floor(debt);
        this.smokeDebt.set(id, debt - puffs);
        for (; puffs > 0; puffs--) {
          const t = tyres[puffs % tyres.length];
          const p = localToWorld(pose, { x: t.x, y: 0.25, z: t.z });
          effects.tyreSmoke(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(pose.vx * 0.25, 0, pose.vz * 0.25), skid, pose.kind === 'scooter' ? 0.6 : 1);
        }
      }
    }
    for (const key of this.last.keys()) if (!skids.has(Math.floor(key / 4))) this.last.delete(key);
    if (dirty) {
      const geo = this.mesh.geometry;
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    }
    return skids;
  }

  private segment(a: THREE.Vector3, b: THREE.Vector3, width: number, alpha: number) {
    const i = this.next;
    this.next = (this.next + 1) % SEGMENTS;
    this.side.set(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(width / 2);
    const s = this.side;
    this.positions.set([a.x - s.x, a.y, a.z - s.z, a.x + s.x, a.y, a.z + s.z, b.x - s.x, b.y, b.z - s.z, b.x + s.x, b.y, b.z + s.z], i * 12);
    for (let v = 0; v < 4; v++) this.colors.set([0.02, 0.02, 0.02, alpha], i * 16 + v * 4);
  }

  /** New map or round: wipe the road clean. */
  clear() {
    this.colors.fill(0);
    this.mesh.geometry.attributes.color.needsUpdate = true;
    this.last.clear();
  }

  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
