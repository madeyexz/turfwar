import * as THREE from 'three';
import type { PickupDef } from '../../shared/maps/types';
import { WEAPONS } from '../../shared/weapons';
import type { Assets } from '../assets';

const COLORS = { weapon: 0xffc35a, ammo: 0x9cf08a, armor: 0x58b6ff };

/**
 * Map pickups: a weapon floats and turns over a glowing ring; ammo crates and armor cells sit on
 * theirs. Each one hides while taken and reappears when the host says it is back.
 */
export class PickupsView {
  readonly group = new THREE.Group();
  private items: { root: THREE.Group; spin: THREE.Object3D; def: PickupDef; baseY: number }[] = [];

  constructor(assets: Assets, pickups: PickupDef[] = []) {
    for (const def of pickups) {
      const root = new THREE.Group();
      root.position.set(def.x, def.y, def.z);
      const kind = def.item === 'ammo' ? 'ammo' : def.item === 'armor' ? 'armor' : 'weapon';
      const color = COLORS[kind];
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 6, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.04;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.03;
      root.add(ring, disc);
      let spin: THREE.Object3D;
      if (kind === 'weapon') {
        const model = assets.weapons.get(WEAPONS[def.item as keyof typeof WEAPONS]?.model ?? '');
        spin = model ? model.clone() : new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.08), new THREE.MeshStandardMaterial({ color }));
        spin.scale.multiplyScalar(1.5);
        spin.position.y = 0.95;
      } else if (kind === 'ammo') {
        spin = new THREE.Group();
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.32, 0.38), new THREE.MeshStandardMaterial({ color: 0x39432c, roughness: 0.8, metalness: 0.2 }));
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.06, 0.4), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 1.6 }));
        spin.add(crate, band);
        spin.position.y = 0.45;
      } else {
        spin = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0x0b1a2a, emissive: color, emissiveIntensity: 1.4, metalness: 0.6, roughness: 0.3 }));
        spin.position.y = 0.55;
      }
      spin.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      root.add(spin);
      this.group.add(root);
      this.items.push({ root, spin, def, baseY: spin.position.y });
    }
  }

  update(time: number, left: number[]) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      it.root.visible = (left[i] ?? 0) <= 0;
      if (!it.root.visible) continue;
      it.spin.rotation.y = time * 1.4 + i;
      it.spin.position.y = it.baseY + Math.sin(time * 2.2 + i) * 0.05;
    }
  }

  /** Nearest lying weapon pickup within `reach` of (x, z), for the E prompt. */
  nearestWeapon(x: number, y: number, z: number, reach: number, left: number[]) {
    let best = -1, bestD = reach;
    this.items.forEach((it, i) => {
      if (it.def.item === 'ammo' || it.def.item === 'armor' || (left[i] ?? 0) > 0 || Math.abs(it.def.y - y) > 2) return;
      const d = Math.hypot(it.def.x - x, it.def.z - z);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }
}
