import RAPIER from '@dimforge/rapier3d-compat';

export const STEP = 1 / 120;
export type Vec = { x: number; y: number; z: number };
export type BodyKind = 'drone' | 'shot' | 'debris';
export interface Entity { id: number; kind: BodyKind; body: RAPIER.RigidBody; age: number }

export class Simulation {
  world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  entities: Entity[] = [];
  nextId = 0;
  score = 0;
  onHit: (() => void) | undefined;

  constructor() {
    const floor = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -3.5, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(25, 0.25, 25), floor);
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
      this.spawn('drone', { x: Math.cos(angle) * 7, y: 1 + Math.sin(angle) * 2, z: Math.sin(angle) * 7 }, { x: 0, y: 0, z: 0 });
    }
    this.score = 0;
  }

  step(dt = STEP) {
    this.world.timestep = dt;
    for (const entity of this.entities) {
      entity.body.resetForces(true);
      entity.body.addForce({ x: 0, y: -1.5 * entity.body.mass(), z: 0 }, true);
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
