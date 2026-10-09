import * as THREE from 'three';
import { SMOKE } from '../../shared/weapons';
import type { Body } from '../../shared/world';
import { MEME_SKINS } from '../game/memeskins';
import { pearlMaterial } from './meme';

/** Soft overlapping puffs per cloud: enough that nothing reads through the middle from any side. */
const PUFFS = 28;
/** Seconds a new cloud takes to billow to full size, and a spent one to thin out after it is gone. */
const GROW = 1.4, CLEAR = 1.2;
/** Tapioca pearls drifting through a 珍奶 cloud (the reskin): looks only, the cloud blocks sight as before. */
const PEARLS = 46;

interface Puff { sprite: THREE.Sprite; base: THREE.Vector3; size: number; spin: number; phase: number }
interface Pearl { base: THREE.Vector3; size: number; phase: number; drift: number }
interface Cloud { group: THREE.Group; puffs: Puff[]; center: THREE.Vector3; born: number; gone: number; seen: number; alpha: number; pearls?: { mesh: THREE.InstancedMesh; list: Pearl[] } }
const pearlMatrix = new THREE.Matrix4(), pearlAt = new THREE.Vector3(), pearlScale = new THREE.Vector3(), pearlTurn = new THREE.Quaternion();

/** A lumpy grey puff: a few offset soft blobs, so overlapping sprites do not read as discs. */
function puffTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const blob = (x: number, y: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.55, `rgba(255,255,255,${a * 0.75})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  };
  blob(64, 64, 60, 0.9);
  for (const [x, y, r] of [[44, 52, 34], [84, 50, 30], [60, 84, 32], [80, 78, 26], [42, 76, 24]]) blob(x, y, r, 0.45);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A fixed pseudo-random sequence per cloud, so a cloud looks the same on every client. */
function seeded(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/**
 * M18 smoke clouds (`smokeCloud` bodies): billboard puffs filling the sphere the rules use to block
 * sight (SMOKE.radius around SMOKE.height above where it landed). With the 珍奶 reskin the puffs are
 * milk tea and tapioca pearls drift through them; the sphere (and so what it hides) is the same. `update` returns how deep the
 * camera sits in smoke (0..1) for the HUD's full-screen fog.
 */
export class SmokeView {
  readonly group = new THREE.Group();
  private clouds = new Map<number, Cloud>();
  private frame = 0;
  private texture = puffTexture();

  sync(bodies: readonly Body[], time: number) {
    this.frame++;
    for (const b of bodies) {
      if (b.kind !== 'smokeCloud') continue;
      let c = this.clouds.get(b.id);
      if (!c) { c = this.create(b, time); this.clouds.set(b.id, c); }
      c.seen = this.frame;
      c.gone = 0;
    }
    for (const c of this.clouds.values()) if (c.seen !== this.frame && !c.gone) c.gone = time;
  }

  /** Animate the clouds; returns how thick the smoke is at `camera` (0 outside, 1 deep inside). */
  update(time: number, camera: THREE.Vector3) {
    let fog = 0;
    for (const [id, c] of this.clouds) {
      const age = time - c.born;
      const grow = Math.min(1, age / GROW), ease = 1 - (1 - grow) ** 3;
      // It thins a little near the end of its time, then clears once the host has removed it.
      const late = Math.max(0, Math.min(1, (age - (SMOKE.duration - 3)) / 3));
      const clear = c.gone ? Math.max(0, 1 - (time - c.gone) / CLEAR) : 1;
      if (c.gone && clear <= 0) { this.dispose(c); this.clouds.delete(id); continue; }
      c.alpha = Math.min(1, grow * 2.5) * (1 - late * 0.3) * clear;
      const spread = 0.35 + 0.65 * ease + Math.min(age, SMOKE.duration) * 0.004;
      for (const p of c.puffs) {
        const s = p.sprite;
        s.position.set(p.base.x * spread, p.base.y * spread + Math.sin(time * 0.4 + p.phase) * 0.12, p.base.z * spread);
        s.scale.setScalar(p.size * (0.5 + 0.5 * ease));
        const m = s.material as THREE.SpriteMaterial;
        m.rotation = p.phase + time * p.spin;
        m.opacity = 0.92 * c.alpha;
      }
      if (c.pearls) {
        const { mesh, list } = c.pearls;
        list.forEach((p, i) => {
          // Each pearl circles slowly about the cloud's axis and bobs, like pearls stirred in the cup.
          const a = time * p.drift + p.phase, cos = Math.cos(a), sin = Math.sin(a);
          pearlAt.set((p.base.x * cos - p.base.z * sin) * spread, p.base.y * spread + Math.sin(time * 0.9 + p.phase) * 0.18, (p.base.x * sin + p.base.z * cos) * spread);
          pearlMatrix.compose(pearlAt, pearlTurn, pearlScale.setScalar(p.size * (0.4 + 0.6 * ease)));
          mesh.setMatrixAt(i, pearlMatrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        (mesh.material as THREE.MeshStandardMaterial).opacity = c.alpha;
      }
      const d = camera.distanceTo(c.center);
      fog = Math.max(fog, Math.max(0, Math.min(1, (SMOKE.radius * spread - d) / 1.6)) * c.alpha);
    }
    return fog;
  }

  clear() {
    for (const c of this.clouds.values()) this.dispose(c);
    this.clouds.clear();
  }

  private dispose(c: Cloud) {
    c.group.removeFromParent();
    for (const p of c.puffs) (p.sprite.material as THREE.Material).dispose();
    if (c.pearls) { c.pearls.mesh.geometry.dispose(); (c.pearls.mesh.material as THREE.Material).dispose(); }
  }

  private create(b: Body, time: number): Cloud {
    const rand = seeded(b.id + 1);
    const center = new THREE.Vector3(b.x, b.y + SMOKE.height, b.z);
    const group = new THREE.Group();
    group.position.copy(center);
    const puffs: Puff[] = [];
    for (let i = 0; i < PUFFS; i++) {
      // Fill the sphere, a little flattened and heavier near the ground like real smoke.
      const u = rand(), theta = rand() * Math.PI * 2, cos = rand() * 2 - 1, sin = Math.sqrt(1 - cos * cos);
      const r = SMOKE.radius * 0.68 * Math.cbrt(i < 6 ? u * 0.25 : u);
      const base = new THREE.Vector3(r * sin * Math.cos(theta), r * cos * 0.8 - 0.2, r * sin * Math.sin(theta));
      const shade = 0.5 + rand() * 0.12 + (base.y > 0 ? 0.06 : 0);
      // Grey smoke, or milk tea (a little creamier towards the top).
      const color = MEME_SKINS ? new THREE.Color().setRGB(0.82 * shade / 0.56, 0.6 * shade / 0.56, 0.4 * shade / 0.56, THREE.SRGBColorSpace) : new THREE.Color(shade, shade * 1.01, shade * 1.03);
      const material = new THREE.SpriteMaterial({ map: this.texture, color, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(material);
      group.add(sprite);
      puffs.push({ sprite, base, size: 3.4 + rand() * 1.6, spin: (rand() - 0.5) * 0.12, phase: rand() * Math.PI * 2 });
    }
    let pearls: Cloud['pearls'];
    if (MEME_SKINS) {
      // Pearls float near the cloud's surface and drift round it, drawn over the puffs so they read from outside.
      const list: Pearl[] = [];
      for (let i = 0; i < PEARLS; i++) {
        const theta = rand() * Math.PI * 2, cos = rand() * 2 - 1, sin = Math.sqrt(1 - cos * cos), r = SMOKE.radius * (0.55 + rand() * 0.5);
        list.push({ base: new THREE.Vector3(r * sin * Math.cos(theta), r * cos * 0.75 - 0.2, r * sin * Math.sin(theta)), size: 0.1 + rand() * 0.05, phase: rand() * Math.PI * 2, drift: (rand() - 0.5) * 0.35 });
      }
      const material = pearlMaterial();
      material.transparent = true; material.opacity = 0;
      const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), material, PEARLS);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      group.add(mesh);
      pearls = { mesh, list };
    }
    this.group.add(group);
    return { group, puffs, center, born: time, gone: 0, seen: this.frame, alpha: 0, pearls };
  }
}
