import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Assets } from '../assets';
import { GUN_FIT, fitAttachments } from '../render/optics';
import { ATTACHMENT_SLOTS, WEAPONS, type AttachmentCategory, type Attachments, type WeaponId } from '../../shared/weapons';
import { applyI18n, t } from './i18n';

/** What the store's preview shows: a weapon with a set of attachments (one slot called out), or the M67. */
export type PreviewItem =
  | { kind: 'weapon'; id: WeaponId; attachments: Attachments; focus?: AttachmentCategory; label?: string }
  | { kind: 'grenade'; he: boolean };

const key = (item: PreviewItem) => item.kind === 'grenade' ? `grenade|${item.he}` : `${item.id}|${ATTACHMENT_SLOTS.map(c => item.attachments[c] ?? '').join('|')}`;

/** Model-space point (barrel -X, up +Y, origin at the grip) where an attachment slot sits on `id`. */
function slotAnchor(id: WeaponId, slot: AttachmentCategory, muzzle: THREE.Vector3) {
  const f = GUN_FIT[id];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  switch (slot) {
    case 'optic': return v(f.optic, f.irons + 0.025, 0);
    case 'muzzle': return muzzle.clone();
    case 'laser': case 'light': return v(f.rail[0], f.rail[1], f.rail[2]);
    case 'counter': return v(f.mag[0] + 0.07, f.irons - (f.kind === 'pistol' ? 0.06 : 0.075), f.kind === 'pistol' ? 0.017 : 0.027);
    case 'magazine': case 'ammo': return v(f.clip.at[0], f.clip.at[1] - 0.02, f.clip.at[2]);
    case 'stock': return f.butt ? v(f.butt[0], f.butt[1], 0) : v(f.grip[0] + 0.05, f.grip[1] - 0.03, 0);
  }
}

/** Soft elliptical contact shadow (drawn once). */
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.5, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Milliseconds closed after which the preview's renderer is released. */
const RELEASE_AFTER = 20_000;

interface Built { object: THREE.Object3D; size: THREE.Vector3; anchor?: THREE.Object3D; muzzle?: THREE.Vector3 }

/**
 * Live 3D preview for the store: a studio turntable of the selected weapon wearing the attachments
 * it would have (so a hovered or selected attachment is tried on before buying), or the M67. It has
 * its own WebGL renderer, created when the store opens and paused when it closes (then released after
 * a while), so it costs nothing during play. Drag to turn it, scroll to zoom.
 */
export class StorePreview {
  readonly el: HTMLElement;
  private canvas?: HTMLCanvasElement;
  private callout: HTMLElement;
  private renderer?: THREE.WebGLRenderer;
  private env?: THREE.Texture;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(22, 1, 0.01, 50);
  private turntable = new THREE.Group();
  private holder = new THREE.Group();
  private shadow: THREE.Mesh;
  private built = new Map<string, Built>();
  private current?: Built;
  private item?: PreviewItem;
  private raf = 0;
  private releaseTimer?: ReturnType<typeof setTimeout>;
  private last = 0;
  private yaw = 0.3;
  private tilt = 0;
  private zoom = 1;
  private idle = 0;
  private sway = 0;
  private drag?: { x: number; y: number };
  private resize = new ResizeObserver(() => this.fitView());

  constructor(private assets?: Assets) {
    this.el = document.createElement('div');
    this.el.className = 'preview';
    this.callout = document.createElement('div');
    this.callout.className = 'callout';
    this.callout.innerHTML = '<span></span>';
    this.callout.hidden = true;
    if (!assets) {
      this.el.classList.add('empty');
      this.el.innerHTML = `<p data-i18n="store.previewOff">${t('store.previewOff')}</p>`;
    } else {
      this.el.innerHTML = `<span class="hint" data-i18n="store.previewHint">${t('store.previewHint')}</span>`;
      this.el.appendChild(this.callout);
    }
    this.scene.add(this.turntable);
    this.turntable.add(this.holder);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.turntable.add(this.shadow);
    // Studio lights: warm key from above-front, cool rim from behind, soft fill from the sky.
    const key = new THREE.DirectionalLight(0xfff0dc, 2.4); key.position.set(1.5, 2.6, 2.2);
    const rim = new THREE.DirectionalLight(0xbfe6ff, 2.2); rim.position.set(-2.2, 1.2, -2.4);
    const fill = new THREE.DirectionalLight(0xdfeeff, 0.6); fill.position.set(-2, -0.6, 1.5);
    this.scene.add(key, rim, fill, new THREE.HemisphereLight(0xe8f4ff, 0x20282c, 0.55));
    this.el.addEventListener('pointerdown', e => {
      if (!this.renderer) return;
      this.drag = { x: e.clientX, y: e.clientY };
      this.el.setPointerCapture(e.pointerId);
      this.el.classList.add('dragging');
    });
    this.el.addEventListener('pointermove', e => {
      if (!this.drag) return;
      this.yaw += (e.clientX - this.drag.x) * 0.012;
      this.tilt = Math.max(-0.45, Math.min(0.6, this.tilt + (e.clientY - this.drag.y) * 0.006));
      this.drag = { x: e.clientX, y: e.clientY };
      this.idle = 0;
    });
    const end = () => { this.drag = undefined; this.idle = 0; this.el.classList.remove('dragging'); };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('wheel', e => {
      if (!this.renderer) return;
      e.preventDefault();
      this.zoom = Math.max(0.65, Math.min(1.8, this.zoom * Math.exp(-e.deltaY * 0.0012)));
    }, { passive: false });
  }

  /** Start the turntable (store opened), creating the renderer if it was released. */
  start() {
    clearTimeout(this.releaseTimer);
    if (!this.assets) return;
    if (!this.renderer) this.create();
    this.resize.observe(this.el);
    this.fitView();
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    const loop = (now: number) => {
      // Removed from the page while open (the match ended): release the GL context.
      if (!this.el.isConnected) { this.stop(); return this.release(); }
      this.raf = requestAnimationFrame(loop);
      this.frame(Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
    };
    this.raf = requestAnimationFrame(loop);
  }

  /**
   * Pause (store closed): nothing renders during play. The renderer is kept for a quick reopen and
   * released after a while closed, so a long stretch of play holds no extra GL context.
   */
  stop() {
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.drag = undefined;
    this.el.classList.remove('dragging');
    clearTimeout(this.releaseTimer);
    if (this.renderer) this.releaseTimer = setTimeout(() => this.release(), RELEASE_AFTER);
  }

  /** Free the renderer and its GL context now (stop() schedules this; call it when the store is torn down). */
  release() {
    clearTimeout(this.releaseTimer);
    if (!this.renderer) return;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer = undefined;
    this.env?.dispose(); this.env = undefined;
    this.canvas?.remove(); this.canvas = undefined;
  }

  private create() {
    this.canvas = document.createElement('canvas');
    this.el.prepend(this.canvas);
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.3;
    r.setClearColor(0x000000, 0);
    const pmrem = new THREE.PMREMGenerator(r);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 1.1;
    this.renderer = r;
  }

  /** Language changed: the hint text (the callout follows the next `show`). */
  relabel() { applyI18n(this.el); }

  /** Show `item` (the same item keeps its angle; a new weapon swings in from the default angle). */
  show(item: PreviewItem) {
    if (!this.assets) return;
    const k = key(item);
    const prev = this.item;
    this.item = item;
    const newModel = !prev || prev.kind !== item.kind || (prev.kind === 'weapon' && item.kind === 'weapon' && prev.id !== item.id);
    let b = this.built.get(k);
    if (!b) { b = this.build(item); this.built.set(k, b); }
    if (b !== this.current) {
      if (this.current) this.holder.remove(this.current.object);
      this.holder.add(b.object);
      this.current = b;
    }
    // Callout on the slot being shopped for.
    if (item.kind === 'weapon' && item.focus) {
      const anchor = b.anchor ?? new THREE.Object3D();
      anchor.position.copy(slotAnchor(item.id, item.focus, b.muzzle ?? new THREE.Vector3()));
      if (!b.anchor) { b.anchor = anchor; b.object.children[0].add(anchor); }
      this.callout.firstElementChild!.textContent = item.label ?? item.focus;
      this.callout.hidden = false;
    } else this.callout.hidden = true;
    if (newModel) { this.yaw = 0.3; this.tilt = 0; this.zoom = 1; this.idle = 0; this.fitView(); }
  }

  private build(item: PreviewItem): Built {
    const weapons = this.assets!.weapons;
    const object = new THREE.Group();
    const model = weapons.get(item.kind === 'grenade' ? 'Prop_Grenade' : WEAPONS[item.id].model)!.clone();
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    // Frame by the bare item so trying attachments on never rescales the view.
    const box = new THREE.Box3().setFromObject(model);
    // Leave room for a suppressor in front of the muzzle.
    if (item.kind === 'weapon' && item.id !== 'knife') { const f = GUN_FIT[item.id]; box.expandByPoint(new THREE.Vector3(f.muzzle[0] - 0.23 * f.bore, f.muzzle[1], 0)); }
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    let muzzle: THREE.Vector3 | undefined;
    if (item.kind === 'grenade') {
      if (item.he) {
        // High Explosive: a red band with a yellow stencil ring around the body.
        const r = Math.min(size.x, size.z) * 0.54;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(r, r, size.y * 0.14, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5, side: THREE.DoubleSide }));
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, size.y * 0.035, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xe8c23a, roughness: 0.5, side: THREE.DoubleSide }));
        band.position.copy(centre); ring.position.copy(centre).y += size.y * 0.09;
        model.add(band, ring);
      }
    } else {
      const fit = fitAttachments(weapons, item.id, item.attachments, 'third');
      model.add(fit.group);
      muzzle = fit.muzzle;
    }
    model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    model.position.set(-centre.x, -centre.y, -centre.z);
    object.add(model);
    // Normalise: a long gun spans one unit; pistols and the grenade read larger than life.
    const longest = Math.max(size.x, size.y, size.z);
    const target = item.kind === 'grenade' ? 0.42 : WEAPONS[item.id].class === 'pistol' ? 0.62 : 1;
    object.scale.setScalar(target / longest);
    return { object, size: size.clone().multiplyScalar(target / longest), muzzle };
  }

  /** Camera distance that keeps the item in frame at any turntable angle. */
  private fitView() {
    if (!this.renderer || !this.canvas) return;
    const w = Math.max(1, this.el.clientWidth), h = Math.max(1, this.el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const s = this.current?.size ?? new THREE.Vector3(1, 0.3, 0.1);
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const span = Math.hypot(s.x, s.z);
    const dist = Math.max(span / 0.8 / (2 * t * this.camera.aspect), s.y / 0.6 / (2 * t)) + span * 0.3;
    this.camera.userData.dist = dist;
    this.camera.updateProjectionMatrix();
    this.shadow.scale.set(s.x * 1.25, Math.max(s.z, s.x * 0.28) * 1.6, 1);
    this.shadow.position.y = -s.y * 0.62;
  }

  private frame(dt: number) {
    const r = this.renderer;
    if (!r) return;
    this.idle += dt;
    // Slow turntable; it waits a moment after you let go.
    if (!this.drag && this.idle > 1.6) {
      if (this.item?.kind === 'weapon' && this.item.focus) {
        // Shopping for an attachment: sway around a three-quarter view so its slot stays in sight.
        this.sway += dt * 0.5;
        const target = 0.38 + Math.sin(this.sway) * 0.38;
        const diff = Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw));
        this.yaw += diff * (1 - Math.exp(-dt * 2.5));
      } else this.yaw += dt * (0.14 + 0.42 * Math.abs(Math.sin(this.yaw))); // dwells on the side views
    }
    if (!this.drag && this.idle > 1.6) this.tilt *= Math.exp(-dt * 1.5);
    this.turntable.rotation.set(this.tilt, this.yaw, 0, 'XYZ');
    const dist = (this.camera.userData.dist as number ?? 2) / this.zoom;
    this.camera.position.set(0, dist * 0.2, dist);
    this.camera.lookAt(0, -0.02, 0);
    this.holder.position.y = Math.sin(performance.now() / 1000 * 1.1) * 0.006;
    r.render(this.scene, this.camera);
    // Callout follows its slot on the turning gun.
    const anchor = this.current?.anchor;
    if (!this.callout.hidden && anchor && anchor.parent) {
      const p = anchor.getWorldPosition(new THREE.Vector3()).project(this.camera);
      const w = this.el.clientWidth, h = this.el.clientHeight;
      this.callout.style.transform = `translate(${((p.x + 1) / 2 * w).toFixed(1)}px, ${((1 - p.y) / 2 * h).toFixed(1)}px)`;
      // The label leans away from the nearer edge.
      this.callout.classList.toggle('flip', p.x > 0.35);
    }
  }
}
