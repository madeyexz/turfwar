import * as THREE from 'three';

/**
 * A flame tongue for additive sprites: a white-yellow root narrowing into orange and red at the tip,
 * on a transparent ground. Anchor sprites at the bottom (`center.y = 0`) so they grow up from the floor.
 */
export function flameTexture() {
  const w = 64, h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  // Stacked soft blobs, wide and hot at the root, thin and red at the tip.
  for (let i = 0; i < 9; i++) {
    const f = i / 8, y = h * (0.86 - f * 0.66), r = w * (0.42 - f * 0.3);
    const g = ctx.createRadialGradient(w / 2, y, 0, w / 2, y, r);
    const hot = 1 - f;
    g.addColorStop(0, `rgba(255,${Math.round(150 + hot * 100)},${Math.round(40 + hot * 120)},${0.32 + hot * 0.2})`);
    g.addColorStop(0.6, `rgba(255,${Math.round(70 + hot * 60)},20,${0.12 + hot * 0.08})`);
    g.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let sharedFlame: THREE.CanvasTexture | undefined;
/** One flame texture for every sprite that needs it. */
export const flame = () => (sharedFlame ??= flameTexture());

/** A burning rag: a flickering additive flame sprite (call `flicker` each frame). */
export function ragFlame(size = 0.12) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flame(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sprite.center.set(0.5, 0.1);
  sprite.scale.set(size * 0.6, size, 1);
  sprite.userData.size = size;
  return sprite;
}

export function flicker(sprite: THREE.Sprite, time: number) {
  const size = sprite.userData.size as number, k = 0.85 + Math.sin(time * 31) * 0.1 + Math.sin(time * 17.3) * 0.08;
  sprite.scale.set(size * 0.6 * (2 - k), size * k, 1);
}

/**
 * The 燃燒彈: a green glass bottle with a red label, a rag stuffed in its neck. `lit` adds a burning rag
 * (in flight and in the hand; the store shows it unlit). About 0.25 m tall at scale 1, its base at the origin.
 */
export function molotovModel(scale = 1, lit = false) {
  const group = new THREE.Group();
  // Lathe profile: base, body, shoulder, neck, lip.
  const profile = [[0, 0], [0.03, 0], [0.034, 0.006], [0.034, 0.14], [0.03, 0.16], [0.016, 0.185], [0.012, 0.215], [0.0125, 0.232], [0.0135, 0.236], [0.011, 0.238]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const glass = new THREE.Mesh(new THREE.LatheGeometry(profile, 20),
    new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.82 }));
  // Fuel inside, two thirds up.
  const fuel = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.029, 0.09, 16), new THREE.MeshStandardMaterial({ color: 0xc89a3a, roughness: 0.3, transparent: true, opacity: 0.7 }));
  fuel.position.y = 0.05;
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0345, 0.0345, 0.05, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.7 }));
  label.position.y = 0.085;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.0348, 0.0348, 0.008, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xf2e6c8, roughness: 0.7 }));
  stripe.position.y = 0.085;
  // The rag: a twisted cloth out of the neck, hanging over one side.
  const cloth = new THREE.MeshStandardMaterial({ color: 0xd9cfb8, roughness: 0.95 });
  const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.009, 0.04, 8), cloth);
  plug.position.y = 0.245;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.06, 0.006), cloth);
  tail.position.set(0.016, 0.24, 0); tail.rotation.z = -0.7;
  group.add(glass, fuel, label, stripe, plug, tail);
  group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = true; });
  if (lit) {
    const fire = ragFlame(0.11);
    fire.position.set(0.02, 0.255, 0);
    fire.name = 'rag';
    group.add(fire);
  }
  group.scale.setScalar(scale);
  return group;
}
