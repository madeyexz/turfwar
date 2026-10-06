import * as THREE from 'three';
import type { PickupDef } from '../../shared/maps/types';
import type { Assets } from '../assets';
import { UI_STACK } from '../ui/fonts';

/** Stencilled side of the ammo box (yellow military lettering on transparent). */
function stencil(lines: [string, number][], w = 256, h = 128) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e3cf6a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let y = h * 0.16;
  for (const [text, size] of lines) { g.font = `700 ${size}px ${UI_STACK}`; y += size * 0.55; g.fillText(text, w / 2, y); y += size * 0.55; }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

/** Soft radial glow texture for fake light pools on the floor. */
let pool: THREE.Texture | undefined;
export function glowPool() {
  if (pool) return pool;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return pool = new THREE.CanvasTexture(c);
}

let template: THREE.Group | undefined;
/** Military ammunition box: olive steel body, lid with seal, rope handles, latches, stencils and a small work lamp. */
function ammoBox() {
  if (template) return template;
  const g = new THREE.Group();
  const olive = new THREE.MeshStandardMaterial({ color: 0x5a6340, roughness: 0.78, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x343a24, roughness: 0.8, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8f86, roughness: 0.45, metalness: 0.8 });
  const rope = new THREE.MeshStandardMaterial({ color: 0x2a2a24, roughness: 0.95 });
  const W = 0.68, H = 0.38, D = 0.4;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  add(new THREE.BoxGeometry(W, H, D), olive, 0, H / 2, 0);
  add(new THREE.BoxGeometry(W + 0.02, 0.07, D + 0.02), dark, 0, H + 0.02, 0);
  add(new THREE.BoxGeometry(W + 0.025, 0.025, D + 0.025), dark, 0, 0.0125, 0);
  // Ribs, latches and hinge.
  for (const x of [-W / 2 + 0.12, W / 2 - 0.12]) add(new THREE.BoxGeometry(0.03, H, D + 0.012), dark, x, H / 2, 0);
  for (const x of [-0.2, 0.2]) { add(new THREE.BoxGeometry(0.06, 0.09, 0.02), steel, x, H - 0.02, D / 2 + 0.012); add(new THREE.BoxGeometry(0.03, 0.03, 0.026), steel, x, H - 0.07, D / 2 + 0.012); }
  add(new THREE.CylinderGeometry(0.012, 0.012, W - 0.1, 8).rotateZ(Math.PI / 2), steel, 0, H + 0.01, -D / 2 - 0.01);
  for (const s of [-1, 1]) {
    const handle = add(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), rope, s * (W / 2 + 0.012), H * 0.7, 0);
    handle.rotation.set(0, Math.PI / 2, Math.PI);
    add(new THREE.BoxGeometry(0.02, 0.04, 0.17), dark, s * (W / 2 + 0.006), H * 0.7, 0);
  }
  // Stencils on the front, back and lid.
  const side = new THREE.MeshBasicMaterial({ map: stencil([['AMMUNITION', 40], ['5.56 MM · 7.62 MM · 12 GA', 22], ['LOT 4-17  ▲ RESTOCK', 20]]), transparent: true, depthWrite: false, toneMapped: false, color: 0xbfae5a });
  for (const s of [1, -1]) { const p = add(new THREE.PlaneGeometry(W * 0.62, H * 0.62), side, 0, H * 0.46, s * (D / 2 + 0.002)); p.rotation.y = s > 0 ? 0 : Math.PI; p.castShadow = false; }
  const lid = add(new THREE.PlaneGeometry(W * 0.6, D * 0.6), new THREE.MeshBasicMaterial({ map: stencil([['AMMO', 72], ['E · USE', 26]], 256, 192), transparent: true, depthWrite: false, toneMapped: false, color: 0xbfae5a }), 0, H + 0.056, 0);
  lid.rotation.x = -Math.PI / 2; lid.castShadow = false;
  // Work lamp clipped to the lid: a glowing lens and a warm pool of light on the floor.
  add(new THREE.BoxGeometry(0.06, 0.05, 0.05), dark, W / 2 - 0.06, H + 0.08, -D / 2 + 0.06);
  const lens = add(new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 1.3) }), W / 2 - 0.06, H + 0.11, -D / 2 + 0.06);
  lens.castShadow = false;
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: glowPool(), color: 0xffc777, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.02; glow.name = 'pool'; glow.renderOrder = 1;
  g.add(glow);
  return template = g;
}

/**
 * Ammo crates (E restocks the held weapon; the first use each round costs $300). Each sits on
 * the map where its pickup is defined, with a soft lamp glow so it is easy to find.
 */
export class CratesView {
  readonly group = new THREE.Group();
  private crates: { def: PickupDef; pool: THREE.Mesh }[] = [];

  constructor(_assets: Assets, pickups: PickupDef[] = []) {
    pickups.forEach((def, i) => {
      const box = ammoBox().clone();
      box.position.set(def.x, def.y, def.z);
      box.rotation.y = i % 2 ? Math.PI / 2 : 0;
      const pool = box.getObjectByName('pool') as THREE.Mesh;
      pool.material = (pool.material as THREE.Material).clone();
      this.group.add(box);
      this.crates.push({ def, pool });
    });
  }

  update(time: number) {
    this.crates.forEach((c, i) => { (c.pool.material as THREE.MeshBasicMaterial).opacity = 0.36 + Math.sin(time * 2 + i) * 0.05; });
  }

  /** Index of the nearest crate within `reach` of (x, z) and about the same floor, or -1. */
  nearest(x: number, y: number, z: number, reach: number) {
    let best = -1, bestD = reach;
    this.crates.forEach((c, i) => {
      if (Math.abs(c.def.y - y) > 2) return;
      const d = Math.hypot(c.def.x - x, c.def.z - z);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }
}
