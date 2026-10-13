import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Assets } from '../assets';
import { SoldierView } from '../render/soldier';
import { KNIFE_SKINS, LOOKS, type Skin } from '../../shared/skins';
import { chooseSkin, mySkin, onSkinChange } from '../game/skins';
import { escapeHtml, knifeName, lookName, onLang, t } from './i18n';
import './skins.css';

const icon = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;

/**
 * The lobby's 外觀 dialog: pick the knife skin and the Militia character (shared/skins.ts), with a live
 * preview of a SWAT and a Militia soldier holding the pick and swinging it now and then. The preview
 * has its own small WebGL renderer, made when the dialog opens and released when it closes.
 */
export class SkinPanel {
  readonly root = document.createElement('div');
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  private views: SoldierView[] = [];
  private shown = '';
  private frame = 0;
  private last = 0;
  private time = 0;
  private sinceSwing = 0;
  private returnFocus: HTMLElement | null = null;
  onClose?: () => void;

  constructor(parent: HTMLElement, private assets: () => Assets | undefined) {
    this.root.className = 'lb-settings lobby skins-dialog';
    this.root.hidden = true;
    this.build();
    parent.appendChild(this.root);
    this.root.addEventListener('click', e => {
      if (e.target === this.root) return this.close();
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!btn) return;
      if (btn.dataset.act === 'close') return this.close();
      const skin = mySkin();
      if (btn.dataset.knife) chooseSkin({ ...skin, knife: btn.dataset.knife as Skin['knife'] });
      if (btn.dataset.look) chooseSkin({ ...skin, look: btn.dataset.look as Skin['look'] });
    });
    this.root.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    onSkinChange(() => { this.refresh(); this.swing(); });
    onLang(() => { this.build(); this.refresh(); });
    this.scene.background = new THREE.Color(0x0b151b);
    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x3a3226, 1.4));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshStandardMaterial({ color: 0x1b2a31, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.camera.position.set(0, 1.2, 4.8);
    this.camera.lookAt(0, 0.98, 0);
  }

  get open() { return !this.root.hidden; }

  show() {
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    this.refresh();
    this.attach();
    this.last = performance.now();
    const loop = () => { if (this.open) { this.render(); this.frame = requestAnimationFrame(loop); } };
    this.frame = requestAnimationFrame(loop);
    this.root.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }

  close() {
    if (!this.open) return;
    this.root.hidden = true;
    cancelAnimationFrame(this.frame);
    for (const v of this.views) { v.dispose(); v.gun.removeFromParent(); }
    this.views = []; this.shown = '';
    this.release();
    this.returnFocus?.focus({ preventScroll: true });
    this.onClose?.();
  }

  /** A renderer on the dialog's canvas (made on opening). */
  private attach() {
    if (this.renderer) return;
    const canvas = this.root.querySelector<HTMLCanvasElement>('canvas')!;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  }

  /**
   * Give the GPU context back. A canvas whose context was lost cannot get a new one (the browser draws
   * its broken-graphics mark there instead), so the next opening draws on a fresh canvas.
   */
  private release() {
    const renderer = this.renderer;
    if (!renderer) return;
    this.renderer = undefined;
    this.scene.environment?.dispose(); this.scene.environment = null;
    renderer.dispose(); renderer.forceContextLoss();
    const canvas = renderer.domElement;
    if (canvas.isConnected) canvas.replaceWith(document.createElement('canvas'));
  }

  private build() {
    // A new language rebuilds the markup, canvas included: an open preview moves to the new canvas.
    const live = this.open;
    this.release();
    const knives = KNIFE_SKINS.map(k => `<button type="button" class="knife-pick" data-knife="${k}"><i class="mark ${k}"></i><b>${escapeHtml(knifeName(k))}</b><small>${escapeHtml(t(`skin.k.${k}Sub`))}</small></button>`).join('');
    const looks = LOOKS.map(l => `<button type="button" data-look="${l}">${escapeHtml(lookName(l))}</button>`).join('');
    this.root.innerHTML = `
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="skins-title">
        <header>
          <h2 id="skins-title">${escapeHtml(t('skin.title'))}</h2>
          <button type="button" class="close" data-act="close" aria-label="${escapeHtml(t('set.close'))}" title="${escapeHtml(t('set.closeEsc'))}">${icon('<path d="M6 6l12 12M18 6L6 18" fill="none"/>')}</button>
        </header>
        <div class="skins">
          <div class="stage"><canvas></canvas></div>
          <div class="picks">
            <h3>${escapeHtml(t('skin.knife'))}</h3>
            <div class="knives">${knives}</div>
            <p class="row-note">${escapeHtml(t('skin.cosmetic'))}</p>
            <h3>${escapeHtml(t('skin.look'))}</h3>
            <div class="seg looks">${looks}</div>
            <p class="row-note">${escapeHtml(t('skin.lookNote'))}</p>
            <button type="button" class="done" data-act="close">${escapeHtml(t('skin.done'))}</button>
          </div>
        </div>
      </div>`;
    if (live) this.attach();
  }

  private refresh() {
    const skin = mySkin();
    this.root.querySelectorAll<HTMLButtonElement>('[data-knife]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.knife === skin.knife)); b.classList.toggle('on', b.dataset.knife === skin.knife); });
    this.root.querySelectorAll<HTMLButtonElement>('[data-look]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.look === skin.look)); b.classList.toggle('on', b.dataset.look === skin.look); });
  }

  /** Both preview soldiers swing their knife skin (on a new pick, and every few seconds). */
  private swing() { for (const v of this.views) v.shoot(); this.sinceSwing = 0; }

  private render() {
    const renderer = this.renderer, assets = this.assets();
    if (!renderer || !assets) return;
    const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now; this.time += dt; this.sinceSwing += dt;
    const skin = mySkin(), key = `${skin.knife}|${skin.look}`;
    if (key !== this.shown) {
      // A new look needs new characters; a new knife is swapped in the hands.
      if (this.shown.split('|')[1] !== skin.look) {
        for (const v of this.views) { v.dispose(); v.gun.removeFromParent(); }
        this.views = [0, 1].map(team => { const v = new SoldierView(assets, team, skin); this.scene.add(v.root, v.gun); return v; });
      }
      for (const v of this.views) v.setKnifeSkin(skin.knife);
      this.shown = key;
    }
    if (this.sinceSwing > 2.4) this.swing();
    const canvas = renderer.domElement, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * devicePixelRatio) || canvas.height !== Math.round(h * devicePixelRatio)) {
      renderer.setPixelRatio(devicePixelRatio); renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }
    this.views.forEach((v, i) => {
      // Facing the camera (yaw π), turned a little so the weapon in the right hand shows, swaying slowly.
      const yaw = Math.PI + (i ? 0.55 : -0.25) + Math.sin(this.time * 0.6 + i) * 0.25;
      v.update(dt, {
        x: (i - 0.5) * 1.05, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw, pitch: -0.05, crouch: 0, grounded: true, sprint: false, ads: false,
        slide: false, alive: true, weapon: 'knife', reloading: 0, firing: false,
      });
    });
    renderer.render(this.scene, this.camera);
  }
}
