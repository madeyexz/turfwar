import RAPIER from '@dimforge/rapier3d-compat';
import { defaultLaws, type Laws } from '../shared/laws';

export const STEP = 1 / 120;
export type Vec = { x: number; y: number; z: number };
export type BodyKind = 'drone' | 'shot' | 'debris';
export interface Entity { id: number; kind: BodyKind; body: RAPIER.RigidBody; age: number }
interface Snapshot { score: number; bodies: { id: number; kind: BodyKind; age: number; position: Vec; velocity: Vec }[] }
const HISTORY_CAPACITY = 1201;

export function timeFactor(time: Laws['time'], playerSpeed: number) {
  return time.scale * (time.mode === 'playerMotion' ? Math.min(1, Math.max(0, playerSpeed) / 6) : 1);
}

export function gravityAt(p: Vec, gravity: Laws['gravity']): Vec {
  if (gravity.mode === 'uniform') {
    const d = gravity.direction;
    const length = Math.hypot(d.x, d.y, d.z) || 1;
    return { x: d.x / length * gravity.strength, y: d.y / length * gravity.strength, z: d.z / length * gravity.strength };
  }
  const r = Math.hypot(p.x, p.y, p.z);
  // The softened core prevents the point-mass singularity from destabilizing Rapier.
  const factor = -gravity.strength / Math.max(r, 1.5) ** (gravity.exponent + 1);
  return { x: p.x * factor, y: p.y * factor, z: p.z * factor };
}

export class Simulation {
  world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  laws: Laws = structuredClone(defaultLaws);
  entities: Entity[] = [];
  nextId = 0;
  score = 0;
  history: (Snapshot | undefined)[] = new Array(HISTORY_CAPACITY);
  historyHead = 0;
  historyLength = 0;
  rewindTicks = 0;
  onHit: (() => void) | undefined;

  constructor() {
    this.world.integrationParameters.numSolverIterations = 16;
    const floor = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -3.5, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(0.25, 24), floor);
    this.reset();
  }

  spawn(kind: BodyKind, position: Vec, velocity: Vec): Entity {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z).setLinvel(velocity.x, velocity.y, velocity.z)
      .setCanSleep(false).setCcdEnabled(kind === 'shot').lockRotations());
    this.world.createCollider(RAPIER.ColliderDesc.ball(kind === 'drone' ? 0.5 : 0.09)
      .setDensity(1).setRestitution(0.5).setSensor(kind === 'shot'), body);
    const entity = { id: this.nextId++, kind, body, age: 0 };
    this.entities.push(entity);
    return entity;
  }

  remove(entity: Entity) {
    this.world.removeRigidBody(entity.body);
    this.entities.splice(this.entities.indexOf(entity), 1);
  }

  reset() {
    for (const entity of [...this.entities]) this.remove(entity);
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const radius = 6 + (i % 3) * 1.1;
      const speed = Math.sqrt(80 / radius);
      const tilt = 0.25;
      this.spawn('drone', { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * Math.sin(tilt), z: Math.sin(angle) * radius * Math.cos(tilt) },
        { x: -Math.sin(angle) * speed, y: Math.cos(angle) * speed * Math.sin(tilt), z: Math.cos(angle) * speed * Math.cos(tilt) });
    }
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5;
      this.spawn('debris', { x: Math.cos(angle) * 10, y: 0, z: Math.sin(angle) * 10 }, { x: -Math.sin(angle) * 2.8, y: 0, z: Math.cos(angle) * 2.8 });
    }
    this.score = 0;
    this.history.fill(undefined); this.historyHead = 0; this.historyLength = 0; this.rewindTicks = 0;
    this.save();
  }

  save() {
    this.history[this.historyHead] = {
      score: this.score,
      bodies: this.entities.map(e => ({ id: e.id, kind: e.kind, age: e.age, position: { ...e.body.translation() }, velocity: { ...e.body.linvel() } })),
    };
    this.historyHead = (this.historyHead + 1) % HISTORY_CAPACITY;
    this.historyLength = Math.min(HISTORY_CAPACITY, this.historyLength + 1);
  }

  startRewind(seconds: number) {
    this.rewindTicks = Math.min(Math.round(Math.max(0, seconds) / STEP), this.historyLength - 1);
    return this.rewindTicks * STEP;
  }

  tick(playerSpeed: number) {
    if (this.rewindTicks > 0) {
      this.historyHead = (this.historyHead - 1 + HISTORY_CAPACITY) % HISTORY_CAPACITY;
      this.history[this.historyHead] = undefined;
      this.historyLength--; this.rewindTicks--;
      const snapshot = this.history[(this.historyHead - 1 + HISTORY_CAPACITY) % HISTORY_CAPACITY]!;
      const ids = new Set(snapshot.bodies.map(b => b.id));
      for (const entity of [...this.entities]) if (!ids.has(entity.id)) this.remove(entity);
      for (const saved of snapshot.bodies) {
        let entity = this.entities.find(e => e.id === saved.id);
        if (!entity) { entity = this.spawn(saved.kind, saved.position, saved.velocity); entity.id = saved.id; }
        entity.age = saved.age;
        entity.body.setTranslation(saved.position, true);
        entity.body.setLinvel(saved.velocity, true);
        entity.body.resetForces(true);
      }
      this.score = snapshot.score;
      return;
    }
    const dt = STEP * timeFactor(this.laws.time, playerSpeed);
    if (dt > 0) this.step(dt);
    this.save();
  }

  step(dt = STEP) {
    this.world.timestep = dt;
    for (const entity of this.entities) {
      entity.body.resetForces(true);
      const p = entity.body.translation(), v = entity.body.linvel();
      // Midpoint force sampling avoids energy drift from holding the old force
      // across Rapier's internal solver substeps.
      const a = gravityAt({ x: p.x + v.x * dt / 2, y: p.y + v.y * dt / 2, z: p.z + v.z * dt / 2 }, this.laws.gravity);
      const mass = entity.body.mass();
      entity.body.addForce({ x: a.x * mass, y: a.y * mass, z: a.z * mass }, true);
      entity.age += dt;
    }
    this.world.step();
    for (const shot of this.entities.filter(e => e.kind === 'shot')) {
      const p = shot.body.translation();
      const hit = this.entities.find(e => e.kind === 'drone' && Math.hypot(
        e.body.translation().x - p.x, e.body.translation().y - p.y, e.body.translation().z - p.z) < 0.75);
      if (hit) { this.remove(hit); this.remove(shot); this.score += 100; this.onHit?.(); }
      else if (shot.age > 6) this.remove(shot);
    }
  }
}

export async function initPhysics() { await RAPIER.init(); }
