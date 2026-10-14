import * as THREE from 'three';
import type { CollisionWorld } from '../../shared/collision';
import { PATCH_RADIUS, firePatches, inFire } from '../../shared/match/fire';
import type { Vec3 } from '../../shared/math';
import { MOLOTOV } from '../../shared/weapons';
import type { Body } from '../../shared/world';
import type { EngineVoice } from '../audio';
import { flame } from './molotov';
import { puffTexture } from './smoke';

/** Flame tongues per patch, rising sparks and smoke puffs per fire. */
const TONGUES = 4, SPARKS = 12, PUFFS = 7;
/** Seconds a fire takes to spread to full size, and to die away once the host has removed it. */
const SPREAD = 0.35, OUT = 0.6;

interface Tongue { sprite: THREE.Sprite; base: THREE.Vector3; size: number; phase: number; speed: number }
interface Blaze {
  group: THREE.Group; patches: Vec3[]; tongues: Tongue[]; sparks: Tongue[]; puffs: Tongue[]; glow: THREE.Mesh[];
  center: THREE.Vector3; born: number; gone: number; seen: number; level: number; voice?: EngineVoice;
}

/** Soft orange light on the floor under the flames (additive). */
function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,170,60,0.9)'); g.addColorStop(0.45, 'rgba(255,90,20,0.45)'); g.addColorStop(1, 'rgba(255,40,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A fixed pseudo-random sequence per fire, so a fire looks the same on every client. */
function seeded(seed: number) {
  let s = (seed * 2246822519) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/**
 * 燃燒彈 fires (`fire` bodies): licking flame tongues over the same floor patches the host burns with
 * (firePatches), a glow under them, sparks and dark smoke rising, and a crackling roar. `update` returns
 * how hot it is where we stand (1 in the flames, less beside them) for the HUD's burn vignette.
 */
export class FireView {
  readonly group = new THREE.Group();
  private blazes = new Map<number, Blaze>();
  private frame = 0;
  private flame = flame();
  private glowTex = glowTexture();
  private smokeTex = puffTexture();
  private glowGeo = new THREE.CircleGeometry(PATCH_RADIUS * 1.7, 20).rotateX(-Math.PI / 2);

  constructor(private voice: () => EngineVoice | undefined = () => undefined) {}

  sync(bodies: readonly Body[], time: number, world: CollisionWorld) {
    this.frame++;
    for (const b of bodies) {
      if (b.kind !== 'fire') continue;
      let f = this.blazes.get(b.id);
      if (!f) { f = this.create(b, time, world); this.blazes.set(b.id, f); }
      f.seen = this.frame;
      f.gone = 0;
    }
    for (const f of this.blazes.values()) if (f.seen !== this.frame && !f.gone) f.gone = time;
  }

  /** Animate the fires; returns the heat at `feet` (1 standing in flames, 0.3 right beside them, else 0). */
  update(time: number, listener?: { pos: Vec3; yaw: number }, feet?: Vec3) {
    let heat = 0;
    for (const [id, f] of this.blazes) {
      const age = time - f.born;
      const grow = Math.min(1, age / SPREAD), ease = 1 - (1 - grow) ** 2;
      // It dies down over its last second, then goes out once the host has removed it.
      const late = Math.max(0, Math.min(1, (MOLOTOV.duration - age) / 1.2));
      const out = f.gone ? Math.max(0, 1 - (time - f.gone) / OUT) : 1;
      if (f.gone && out <= 0) { this.remove(id, f); continue; }
      const level = f.level = ease * Math.max(0.25, late) * out;
      for (const t of f.tongues) {
        // Each tongue licks up and dies away over and over, out of step with its neighbours.
        const cycle = (time * t.speed + t.phase) % 1, life = Math.sin(cycle * Math.PI);
        const s = t.sprite, h = t.size * level * (0.55 + 0.6 * life);
        s.position.set(t.base.x * (0.6 + 0.4 * ease), t.base.y + cycle * 0.12, t.base.z * (0.6 + 0.4 * ease));
        s.scale.set(h * 0.7, h, 1);
        (s.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.35 + life) * level;
      }
      for (const t of f.sparks) {
        const cycle = (time * t.speed + t.phase) % 1;
        t.sprite.position.set(t.base.x + Math.sin(time * 3 + t.phase * 9) * 0.15, t.base.y + cycle * 2.6, t.base.z + Math.cos(time * 2.6 + t.phase * 7) * 0.15);
        t.sprite.scale.setScalar(t.size * (1 - cycle));
        (t.sprite.material as THREE.SpriteMaterial).opacity = (1 - cycle) * level;
      }
      for (const t of f.puffs) {
        const cycle = (time * t.speed + t.phase) % 1;
        t.sprite.position.set(t.base.x + cycle * 0.6, 0.8 + cycle * 3.6, t.base.z + cycle * 0.3);
        t.sprite.scale.setScalar(t.size * (0.6 + cycle * 1.4));
        (t.sprite.material as THREE.SpriteMaterial).opacity = 0.32 * Math.sin(cycle * Math.PI) * level;
      }
      for (const g of f.glow) (g.material as THREE.MeshBasicMaterial).opacity = 0.5 * level * (0.85 + 0.15 * Math.sin(time * 13 + g.id));
      f.voice ??= this.voice();
      f.voice?.set(level, listener, f.center);
      if (feet && level > 0.3) {
        if (inFire(f.patches, feet)) heat = Math.max(heat, level);
        else if (inFire(f.patches, feet, 1)) heat = Math.max(heat, 0.3 * level);
      }
    }
    return heat;
  }

  clear() {
    for (const [id, f] of this.blazes) this.remove(id, f);
  }

  private remove(id: number, f: Blaze) {
    f.group.removeFromParent();
    f.group.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; m?.dispose(); });
    f.voice?.stop();
    this.blazes.delete(id);
  }

  private create(b: Body, time: number, world: CollisionWorld): Blaze {
    const rand = seeded(b.id + 7);
    const patches = firePatches(world, b);
    const center = new THREE.Vector3(b.x, b.y, b.z);
    const group = new THREE.Group();
    group.position.copy(center);
    const tongues: Tongue[] = [], sparks: Tongue[] = [], puffs: Tongue[] = [], glow: THREE.Mesh[] = [];
    const sprite = (map: THREE.Texture, additive: boolean, color = 0xffffff) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, transparent: true, depthWrite: false, opacity: 0, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      group.add(s);
      return s;
    };
    for (const p of patches) {
      const local = new THREE.Vector3(p.x - b.x, p.y - b.y, p.z - b.z);
      const g = new THREE.Mesh(this.glowGeo, new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 }));
      g.position.set(local.x, local.y + 0.03, local.z);
      group.add(g); glow.push(g);
      for (let i = 0; i < TONGUES; i++) {
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * PATCH_RADIUS * 0.85;
        // Half the tongues glow (additive), half are solid orange, so the fire keeps its colour on a bright street.
        const s = sprite(this.flame, i % 2 === 0, i % 2 === 0 ? 0xffffff : 0xff8a2a);
        s.center.set(0.5, 0.05);
        (s.material as THREE.SpriteMaterial).rotation = (rand() - 0.5) * 0.25;
        // Taller near the middle of the fire, shorter at its edges.
        const middle = 1 - Math.min(1, local.length() / MOLOTOV.radius);
        tongues.push({ sprite: s, base: new THREE.Vector3(local.x + Math.cos(a) * r, local.y, local.z + Math.sin(a) * r), size: 0.65 + rand() * 0.5 + middle * 0.75, phase: rand(), speed: 1.3 + rand() * 1.2 });
      }
    }
    for (let i = 0; i < SPARKS; i++) {
      const p = patches[Math.floor(rand() * patches.length)];
      const s = sprite(this.flame, true, 0xffd28a);
      sparks.push({ sprite: s, base: new THREE.Vector3(p.x - b.x, p.y - b.y + 0.3, p.z - b.z), size: 0.06 + rand() * 0.05, phase: rand(), speed: 0.5 + rand() * 0.5 });
    }
    for (let i = 0; i < PUFFS; i++) {
      const s = sprite(this.smokeTex, false, 0x2b2724);
      puffs.push({ sprite: s, base: new THREE.Vector3((rand() - 0.5) * 1.6, 0, (rand() - 0.5) * 1.6), size: 1.6 + rand() * 1.2, phase: i / PUFFS, speed: 0.22 + rand() * 0.08 });
    }
    this.group.add(group);
    return { group, patches, tongues, sparks, puffs, glow, center, born: time, gone: 0, seen: this.frame, level: 0 };
  }
}
