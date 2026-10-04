import RAPIER from '@dimforge/rapier3d-compat';
import { defaultLaws, type Laws } from '../shared/laws';
import { groundHeight, maps, segmentBox, terrainData, type BattleMap } from './battlefield';

export const STEP = 1 / 120;
export type Vec = { x: number; y: number; z: number };
export type BodyKind = 'drone' | 'shot' | 'debris' | 'hostileShot';
export interface Entity { id: number; kind: BodyKind; body: RAPIER.RigidBody; age: number }
interface Snapshot { score: number; enemyTimer: number; capture: number; bodies: { id: number; kind: BodyKind; age: number; position: Vec; velocity: Vec }[] }
const HISTORY_CAPACITY = 1201;

export function timeFactor(time: Laws['time'], playerSpeed: number) {
  return time.scale * (time.mode === 'playerMotion' ? Math.min(1, Math.max(0, playerSpeed) / 6) : 1);
}

export function segmentDistance(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / (dx * dx + dy * dy + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy, p.z - a.z - t * dz);
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
  map = maps[0];
  staticBodies: RAPIER.RigidBody[] = [];
  enemyTimer = 0;
  capture = 0;
  onHit: ((position: Vec) => void) | undefined;
  onPlayerHit: (() => void) | undefined;

  constructor() {
    this.world.integrationParameters.numSolverIterations = 16;
    this.setMap(maps[0]);
  }

  setMap(map: BattleMap) {
    this.map = map;
    for (const body of this.staticBodies) this.world.removeRigidBody(body);
    this.staticBodies = [];
    const data = terrainData(map);
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(data.vertices, data.indices), ground); this.staticBodies.push(ground);
    for (const b of map.structures) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(b.x, -3.25 + b.h / 2, b.z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2), body); this.staticBodies.push(body);
    }
    this.reset();
  }

  spawn(kind: BodyKind, position: Vec, velocity: Vec): Entity {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z).setLinvel(velocity.x, velocity.y, velocity.z)
      .setCanSleep(false).setCcdEnabled(kind === 'shot' || kind === 'hostileShot').lockRotations());
    this.world.createCollider(RAPIER.ColliderDesc.ball(kind === 'drone' ? 0.5 : 0.09)
      .setDensity(1).setRestitution(0.5).setSensor(kind === 'shot' || kind === 'hostileShot'), body);
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
    this.score = 0; this.enemyTimer = 0; this.capture = 0;
    this.history.fill(undefined); this.historyHead = 0; this.historyLength = 0; this.rewindTicks = 0;
    this.save();
  }

  save() {
    this.history[this.historyHead] = {
      score: this.score, enemyTimer: this.enemyTimer, capture: this.capture,
      bodies: this.entities.map(e => ({ id: e.id, kind: e.kind, age: e.age, position: { ...e.body.translation() }, velocity: { ...e.body.linvel() } })),
    };
    this.historyHead = (this.historyHead + 1) % HISTORY_CAPACITY;
    this.historyLength = Math.min(HISTORY_CAPACITY, this.historyLength + 1);
  }

  startRewind(seconds: number) {
    this.rewindTicks = Math.min(Math.round(Math.max(0, seconds) / STEP), this.historyLength - 1);
    return this.rewindTicks * STEP;
  }

  tick(playerSpeed: number, target?: Vec) {
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
      this.score = snapshot.score; this.enemyTimer = snapshot.enemyTimer; this.capture = snapshot.capture;
      return;
    }
    const dt = STEP * timeFactor(this.laws.time, playerSpeed);
    if (dt > 0) {
      if (target) {
        this.enemyTimer += dt;
        if (this.enemyTimer >= .8) {
          this.enemyTimer = 0;
          const drone = this.entities.filter(e => e.kind === 'drone').find(e => {
            const p = e.body.translation();
            return Math.hypot(p.x - target.x, p.z - target.z) < 65 && !this.map.structures.some(b => segmentBox(p, target, b));
          });
          if (drone && this.entities.filter(e => e.kind === 'hostileShot').length < 24) {
            const p = drone.body.translation(), d = { x: target.x - p.x, y: target.y - .5 - p.y, z: target.z - p.z };
            const length = Math.hypot(d.x, d.y, d.z) || 1;
            this.spawn('hostileShot', p, { x: d.x / length * 26, y: d.y / length * 26, z: d.z / length * 26 });
          }
        }
        const contested = this.entities.some(e => e.kind === 'drone' && Math.hypot(e.body.translation().x, e.body.translation().z) < 18);
        if (Math.hypot(target.x, target.z) < 12 && !contested) this.capture = Math.min(100, this.capture + dt * 12.5);
      }
      this.step(dt, target);
    }
    this.save();
  }

  step(dt = STEP, target?: Vec) {
    this.world.timestep = dt;
    const oldPositions = new Map(this.entities.filter(e => e.kind === 'shot' || e.kind === 'hostileShot').map(e => [e.id, { ...e.body.translation() }]));
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
    for (const shot of this.entities.filter(e => e.kind === 'shot' || e.kind === 'hostileShot')) {
      const p = shot.body.translation();
      const old = oldPositions.get(shot.id)!;
      if (p.y < groundHeight(p.x, p.z, this.map) || this.map.structures.some(b => segmentBox(old, p, b))) { this.remove(shot); continue; }
      const hit = shot.kind === 'shot' ? this.entities.find(e => e.kind === 'drone' && segmentDistance(e.body.translation(), old, p) < .75) : undefined;
      if (hit) { const position = { ...hit.body.translation() }; this.remove(hit); this.remove(shot); this.score += 100; this.onHit?.(position); }
      else if (shot.kind === 'hostileShot' && target && segmentDistance({ x: target.x, y: target.y - .5, z: target.z }, old, p) < .65) { this.remove(shot); this.onPlayerHit?.(); }
      else if (shot.age > 6) this.remove(shot);
    }
  }
}

export async function initPhysics() { await RAPIER.init(); }
