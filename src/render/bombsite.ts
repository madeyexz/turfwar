import * as THREE from 'three';
import type { MapDef } from '../../shared/maps/types';
import type { BombState } from '../../shared/match/state';
import { glowPool } from './pickups';

const SITE = 0xff7a2a, ARMED = 0xff2a1a;
/** Seconds from arming to detonation (BeGone's 40 s bomb clock), for the blink rate. */
const FUSE = 40;

/** Big stencilled site letter painted on the floor. */
function letterTexture(letter: string) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#fff'; g.lineWidth = 10;
  g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff'; g.font = '700 190px Rajdhani, "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 128, 140);
  return new THREE.CanvasTexture(c);
}

/** Vertical fade for the light curtain around a site (bright at the floor). */
let curtain: THREE.Texture | undefined;
function curtainTexture() {
  if (curtain) return curtain;
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const g = c.getContext('2d')!, grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 64);
  return curtain = new THREE.CanvasTexture(c);
}

/** The armed device: a charge pack with a keypad, wired detonator and a blinking red light. */
function bombModel() {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const block = new THREE.MeshStandardMaterial({ color: 0xc9b98a, roughness: 0.85 }), tape = new THREE.MeshStandardMaterial({ color: 0x2b2d2a, roughness: 0.9 });
  const box = new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.5, metalness: 0.5 });
  for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.11, 0.07, 0.3), block, (i - 1) * 0.115, 0.035, 0);
  for (const z of [-0.09, 0.09]) add(new THREE.BoxGeometry(0.37, 0.075, 0.03), tape, 0, 0.037, z);
  add(new THREE.BoxGeometry(0.16, 0.05, 0.12), box, 0, 0.095, 0.02);
  add(new THREE.PlaneGeometry(0.1, 0.04).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 0.5) }), -0.01, 0.1205, 0.04);
  for (const [x, c] of [[-0.1, 0xd0352a], [0.1, 0x2a6ad0], [0.0, 0xd0b02a]] as [number, number][]) {
    const wire = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.005, 5, 12, Math.PI), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    wire.position.set(x * 0.6, 0.08, -0.06); wire.rotation.y = Math.PI / 2 + x * 3; g.add(wire);
  }
  const led = add(new THREE.SphereGeometry(0.014, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.4, 0.2) }), 0.055, 0.125, -0.02);
  led.castShadow = false;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowPool(), color: ARMED, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  halo.position.copy(led.position); halo.scale.setScalar(0.7);
  g.add(halo);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowPool(), color: ARMED, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.position.y = 0.025; pool.renderOrder = 1;
  g.add(pool);
  return { group: g, blink: [led, halo, pool] as THREE.Object3D[] };
}

interface Site { root: THREE.Group; letter: THREE.MeshBasicMaterial; sign: THREE.SpriteMaterial; ring: THREE.MeshBasicMaterial; curtain: THREE.MeshBasicMaterial; pool: THREE.MeshBasicMaterial; bomb: ReturnType<typeof bombModel> }

/** Nearest spot to (x, z) at floor height y that no solid occupies (props often stand on a site's centre). */
function freeSpot(map: MapDef, x: number, y: number, z: number) {
  const blocked = (px: number, pz: number) => map.solids.some(s => px > s.minX - 0.35 && px < s.maxX + 0.35 && pz > s.minZ - 0.35 && pz < s.maxZ + 0.35 && y + 0.2 > s.minY && y + 0.2 < s.maxY);
  for (const r of [0, 0.8, 1.6, 2.4, 3.2]) for (let i = 0; i < (r ? 12 : 1); i++) {
    const a = i / 12 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (!blocked(px, pz)) return { x: px - x, z: pz - z };
  }
  return { x: 0, z: 0 };
}

/**
 * Sabotage bomb sites: a big letter on the floor inside a ring and curtain of light at each of the
 * map's sites; once armed, the device sits on its site blinking red, faster as the clock runs out,
 * and the other site goes dark.
 */
export class BombSitesView {
  readonly group = new THREE.Group();
  private sites: Site[] = [];
  private armedAt = -1;

  constructor(map: MapDef) {
    for (const id of map.sabotage?.sites ?? []) {
      const p = map.points.find(q => q.id === id);
      if (!p) continue;
      const r = Math.max(2.5, Math.min(p.radius, 5));
      const root = new THREE.Group();
      root.position.set(p.x, p.y, p.z);
      const glow = (opacity: number) => new THREE.MeshBasicMaterial({ color: SITE, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const letter = Object.assign(glow(0.75), { map: letterTexture(id) });
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.1, r * 1.1).rotateX(-Math.PI / 2), letter);
      decal.position.y = 0.04;
      const ring = glow(0.9);
      const band = new THREE.Mesh(new THREE.RingGeometry(r - 0.08, r, 64).rotateX(-Math.PI / 2), ring);
      band.position.y = 0.035;
      const wall = Object.assign(glow(0.22), { map: curtainTexture() });
      const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.6, 48, 1, true), wall);
      cylinder.position.y = 0.8;
      const pool = Object.assign(glow(0.18), { map: glowPool() });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(r * 2.4, r * 2.4).rotateX(-Math.PI / 2), pool);
      floor.position.y = 0.03;
      for (const m of [decal, band, cylinder, floor]) m.renderOrder = 1;
      // A floating letter keeps the site readable when props cover the floor marking.
      const sign = new THREE.SpriteMaterial({ map: letter.map, color: SITE, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
      const billboard = new THREE.Sprite(sign);
      billboard.scale.setScalar(0.9); billboard.position.y = 2.6;
      const bomb = bombModel();
      const spot = freeSpot(map, p.x, p.y, p.z);
      bomb.group.visible = false;
      bomb.group.position.set(spot.x, 0, spot.z); bomb.group.rotation.y = 0.5; bomb.group.scale.setScalar(1.4);
      root.add(floor, decal, band, cylinder, billboard, bomb.group);
      this.group.add(root);
      this.sites.push({ root, letter, sign, ring, curtain: wall, pool, bomb });
    }
  }

  update(time: number, bomb: BombState, active: boolean) {
    this.group.visible = active && this.sites.length > 0;
    if (!this.group.visible) return;
    if (bomb.armed && this.armedAt < 0) this.armedAt = time;
    if (!bomb.armed) this.armedAt = -1;
    // Blink faster as the fuse burns: about 1 Hz at arming, 8 Hz at the end.
    const left = bomb.armed ? Math.max(0, 1 - (time - this.armedAt) / FUSE) : 1;
    const rate = 1 + (1 - left) ** 2 * 7;
    this.sites.forEach((s, i) => {
      const armedHere = bomb.armed && bomb.site === i, inert = bomb.armed && !armedHere, working = bomb.by >= 0 && bomb.site === i;
      const pulse = 0.5 + 0.5 * Math.sin(time * (working ? 10 : 2.4));
      const color = armedHere ? ARMED : SITE;
      for (const m of [s.letter, s.sign, s.ring, s.curtain, s.pool]) m.color.setHex(color);
      const dim = inert ? 0.15 : 1;
      s.letter.opacity = 0.75 * dim; s.sign.opacity = (armedHere ? 0.5 + pulse * 0.5 : 0.8) * dim; s.ring.opacity = (0.6 + pulse * 0.4) * dim; s.curtain.opacity = (armedHere ? 0.3 : 0.16 + pulse * 0.08) * dim; s.pool.opacity = (armedHere ? 0.3 : 0.16) * dim;
      // The device appears while being armed (light off) and blinks once armed.
      s.bomb.group.visible = armedHere || (working && !bomb.armed);
      const on = armedHere && (time * rate) % 1 < 0.35;
      for (const o of s.bomb.blink) o.visible = on;
    });
  }
}
