import * as THREE from 'three';
import { rng } from '../../shared/math';

/** Procedural Midtown materials: window grids, curtain walls, shopfronts and ad screens. */
export function cityMaterials() {
  const facade = new THREE.MeshStandardMaterial({ map: windowTexture(false), roughness: 0.85, metalness: 0.05, vertexColors: true });
  const glass = new THREE.MeshStandardMaterial({ map: windowTexture(true), roughness: 0.18, metalness: 0.55, vertexColors: true });
  const storefront = new THREE.MeshStandardMaterial({ map: storefrontTexture(), emissiveMap: storefrontTexture(true), emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.5, metalness: 0.2, vertexColors: true });
  const vehicle = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.45, vertexColors: true });
  const vehicleGlass = new THREE.MeshStandardMaterial({ color: 0x1a222a, roughness: 0.08, metalness: 0.8, vertexColors: true });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9, vertexColors: true });
  const out: Record<string, THREE.Material> = { facade, facadeGlass: glass, storefront, vehicle, vehicleGlass, tyre };
  AD_TEXTS.forEach((_, i) => {
    out[`ad${i}`] = new THREE.MeshBasicMaterial({ map: adTexture(i), color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: true, vertexColors: true });
  });
  return out;
}

/** Window grid texture spanning 8 m × 7 m of wall: two bays by two floors. */
export const FACADE_PERIOD = { u: 8, v: 7 };

function windowTexture(curtain: boolean) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const r = rng(curtain ? 11 : 7);
  ctx.fillStyle = curtain ? '#c8d2da' : '#f2eee8';
  ctx.fillRect(0, 0, 256, 256);
  if (curtain) {
    // Curtain wall: thin mullions, tall reflective panes with a sky gradient.
    for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) {
      const g = ctx.createLinearGradient(0, j * 64, 0, j * 64 + 64);
      const k = 0.75 + r() * 0.35;
      g.addColorStop(0, `rgb(${120 * k},${150 * k},${175 * k})`); g.addColorStop(1, `rgb(${60 * k},${80 * k},${100 * k})`);
      ctx.fillStyle = g; ctx.fillRect(i * 32 + 2, j * 64 + 3, 28, 58);
    }
  } else {
    // Masonry: punched windows with sills and the odd lit or curtained pane.
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      const x = i * 64 + 14, y = j * 128 + 26;
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x - 4, y + 78, 44, 6);
      const lit = r() < 0.18, k = 0.7 + r() * 0.4;
      ctx.fillStyle = lit ? `rgb(${230 * k},${200 * k},${140 * k})` : `rgb(${40 * k},${52 * k},${64 * k})`;
      ctx.fillRect(x, y, 36, 76);
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, y, 36, 30);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x + 16, y, 4, 76); ctx.fillRect(x, y + 36, 36, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

/** Ground-floor shopfront band (4.6 m tall, 8 m period): glazing, doors, a sign fascia. */
function storefrontTexture(emissive = false) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d')!;
  const r = rng(23);
  ctx.fillStyle = emissive ? '#000' : '#2a2a2c'; ctx.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 2; i++) {
    const x = i * 128;
    const hue = Math.floor(r() * 360);
    ctx.fillStyle = emissive ? `hsl(${hue},90%,55%)` : `hsl(${hue},70%,45%)`;
    ctx.fillRect(x + 6, 8, 116, 20);
    ctx.fillStyle = emissive ? 'rgba(255,220,170,0.35)' : '#3d4a55';
    ctx.fillRect(x + 8, 36, 112, 86);
    if (!emissive) { ctx.fillStyle = '#16191c'; ctx.fillRect(x + 56, 36, 4, 86); ctx.fillRect(x + 8, 76, 112, 3); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Fictional advertising; nothing here is a real brand.
const AD_TEXTS: [string, string, string, string][] = [
  ['LAWBREAKER', 'FRONTLINE // NOW LIVE', '#0b1d3a', '#58b6ff'],
  ['GRAVITY', 'IS OPTIONAL', '#2a0b3a', '#ff5ad1'],
  ['NEON COLA', 'TASTE THE ENTROPY', '#3a0b0b', '#ffd23a'],
  ['C = 10 m/s', 'SLOW LIGHT SALE', '#062a2a', '#3affd2'],
  ['QUANTUM', 'NOODLES 24/7', '#3a1f05', '#ff9a3a'],
  ['REWIND', 'INSURANCE • 3 SEC', '#0d2a0b', '#9aff5a'],
  ['ENTROPY', 'THE MUSICAL', '#1a0526', '#ffef7a'],
  ['ORBITAL', 'SAVINGS BANK', '#06142e', '#ffffff'],
  ['HELIX AIR', 'FLY SIDEWAYS', '#00253f', '#7ad7ff'],
  ['TIME FLIES', 'WHEN YOU MOVE', '#2e0610', '#ff6a5a'],
];

function adTexture(i: number) {
  const [title, sub, bg, accent] = AD_TEXTS[i];
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 512, 256);
  g.addColorStop(0, bg); g.addColorStop(1, '#000');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
  const r = rng(i * 31 + 5);
  ctx.globalAlpha = 0.35; ctx.fillStyle = accent;
  for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(r() * 512, r() * 256, 30 + r() * 90, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = accent; ctx.fillRect(0, 0, 512, 10); ctx.fillRect(0, 246, 512, 10);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff'; ctx.font = '700 92px Rajdhani, system-ui, sans-serif';
  ctx.fillText(title, 256, 104, 480);
  ctx.fillStyle = accent; ctx.font = '600 40px Rajdhani, system-ui, sans-serif';
  ctx.fillText(sub, 256, 184, 470);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}
export const AD_COUNT = AD_TEXTS.length;

/**
 * Building block with world-space window UVs: sides tile the window grid, the roof maps to a
 * plain frame texel. A ground-floor shopfront band is returned separately for blocks at street level.
 */
export function facadeGeometry(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
  const parts: { key: 'body' | 'storefront'; g: THREE.BufferGeometry }[] = [];
  const shop = minY < 0.5 && maxY - minY > 7 ? 4.6 : 0;
  if (shop) parts.push({ key: 'storefront', g: box(minX, minY, minZ, maxX, minY + shop, maxZ, 8, shop) });
  parts.push({ key: 'body', g: box(minX, minY + shop, minZ, maxX, maxY, maxZ, FACADE_PERIOD.u, FACADE_PERIOD.v) });
  return parts;
}

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, pu: number, pv: number) {
  const g = new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ);
  g.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute, n = g.getAttribute('normal') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(n.getY(i)) > 0.5) { uv.setXY(i, 0.02, 0.02); continue; }
    const along = Math.abs(n.getX(i)) > 0.5 ? p.getZ(i) * Math.sign(n.getX(i)) * -1 : p.getX(i) * Math.sign(n.getZ(i));
    uv.setXY(i, along / pu, (p.getY(i) - minY) / pv);
  }
  return g;
}

const VEHICLE_SIZE = { taxi: [4.8, 1.5, 1.9], car: [4.6, 1.45, 1.9], van: [5.4, 2.3, 2.1], bus: [11.5, 3.1, 2.6] } as const;
const CAR_COLOURS = [0x8a1c1c, 0x2b3b52, 0xc9c9c4, 0x1d1f22, 0x5b6b4a, 0x9a9da0];

/** Procedural vehicle: body, glasshouse and tyres in local space (length along +X). */
export function vehicleGeometry(model: keyof typeof VEHICLE_SIZE, x: number, y: number, z: number, rotY: number, seed: number) {
  const [l, h, w] = VEHICLE_SIZE[model];
  const r = rng(seed * 97 + 1);
  const out: { key: 'vehicle' | 'vehicleGlass' | 'tyre'; g: THREE.BufferGeometry }[] = [];
  const colour = model === 'taxi' ? 0xf2b81c : model === 'bus' ? 0xe8ecee : model === 'van' ? 0xd8dadc : CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)];
  const piece = (key: 'vehicle' | 'vehicleGlass' | 'tyre', g: THREE.BufferGeometry, hex = 0xffffff) => {
    const col = new THREE.Color(hex), n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, k) => [col.r, col.g, col.b][k % 3]), 3));
    out.push({ key, g });
  };
  const at = (g: THREE.BufferGeometry, px: number, py: number, pz: number) => { g.translate(px, py, pz); return g; };
  const wheel = model === 'bus' ? 0.5 : 0.36;
  if (model === 'bus') {
    piece('vehicle', at(new THREE.BoxGeometry(l, h - 0.35, w), 0, 0.35 + (h - 0.35) / 2, 0), colour);
    piece('vehicle', at(new THREE.BoxGeometry(l + 0.02, 0.35, w + 0.02), 0, 0.9, 0), 0x1f5aa8);
    piece('vehicleGlass', at(new THREE.BoxGeometry(l - 0.6, 0.95, w + 0.04), 0, 2.15, 0));
  } else {
    const body = model === 'van' ? h - 0.3 : h * 0.5;
    piece('vehicle', at(new THREE.BoxGeometry(l, body, w), 0, 0.3 + body / 2, 0), colour);
    if (model === 'van') piece('vehicleGlass', at(new THREE.BoxGeometry(0.9, 0.7, w - 0.1), l / 2 - 0.5, h - 0.65, 0));
    else {
      const cabin = new THREE.BoxGeometry(l * 0.5, h - 0.3 - body, w * 0.86);
      piece('vehicleGlass', at(cabin, -l * 0.05, 0.3 + body + (h - 0.3 - body) / 2, 0));
      if (model === 'taxi') piece('vehicle', at(new THREE.BoxGeometry(0.7, 0.22, 0.3), -l * 0.05, h + 0.1, 0), 0xffffff);
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const t = new THREE.CylinderGeometry(wheel, wheel, 0.3, 12);
    t.rotateX(Math.PI / 2);
    piece('tyre', at(t, sx * (l / 2 - wheel * 1.6), wheel, sz * (w / 2 - 0.1)));
  }
  // Wrecks sit a little crooked.
  const tilt = (r() - 0.5) * 0.05;
  for (const { g } of out) { g.rotateX(tilt); g.rotateY(rotY); g.translate(x, y, z); }
  return out;
}
