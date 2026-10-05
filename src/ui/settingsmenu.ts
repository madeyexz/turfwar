import { RETICLE_COLORS, RETICLE_STYLES, SCOPE_MODES, settings, type ReticleColor, type ReticleStyle, type ScopeMode } from '../game/settings';
import type { CrosshairStyle } from './hud';
import './settingsmenu.css';

/** Saved like the lobby saves it (`lawbreaker.<key>`); storage may be disabled. */
const save = (key: string, value: string) => { try { localStorage.setItem(`lawbreaker.${key}`, value); } catch { /* storage disabled */ } };
const load = (key: string, fallback: string) => { try { return localStorage.getItem(`lawbreaker.${key}`) ?? fallback; } catch { return fallback; } };

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface SettingsActions {
  resume(): void;
  leave(): void;
  /** Applied live: mouse sensitivity, crosshair, graphics preset, effects volume. */
  sensitivity(value: number): void;
  crosshair(style: CrosshairStyle): void;
  quality(q: GraphicsQuality): void;
  volume(value: number): void;
}

const choice = <T extends string>(id: string, values: readonly T[], label: (v: T) => string) =>
  `<div class="seg" data-group="${id}">${values.map(v => `<button type="button" data-${id}="${v}">${label(v)}</button>`).join('')}</div>`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * In-game menu (Esc or P): resume, the settings that matter mid-match (sensitivity, aim sensitivity,
 * field of view, volume, crosshair, scope view, reticle, graphics) and leave match. Solo pauses while
 * it is open; online the match keeps going.
 */
export class SettingsMenu {
  readonly root = document.createElement('div');
  constructor(parent: HTMLElement, private actions: SettingsActions) {
    this.root.id = 'ingame-menu';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="panel">
        <header><h2 data-k="title">Paused</h2><span class="hint"><kbd>Esc</kbd> / <kbd>P</kbd> resume · <kbd>F</kbd> fullscreen</span></header>
        <button type="button" class="resume" data-act="resume">Resume</button>
        <div class="grid">
          <label>Mouse sensitivity <output data-out="sens"></output><input type="range" data-in="sens" min="0.2" max="3" step="0.05"></label>
          <label>Aim sensitivity <output data-out="ads"></output><input type="range" data-in="ads" min="0.5" max="1.5" step="0.05"></label>
          <label>Field of view <output data-out="fov"></output><input type="range" data-in="fov" min="65" max="95" step="1"></label>
          <label>Effects volume <output data-out="vol"></output><input type="range" data-in="vol" min="0" max="1" step="0.05"></label>
          <div class="row"><span>Crosshair</span>${choice('crosshair', ['classic', 'dot', 'circle', 't'] as const, v => v === 't' ? 'T' : cap(v))}</div>
          <div class="row"><span>Scope view</span>${choice('scope', SCOPE_MODES, v => v === 'pip' ? 'Through the lens' : 'Full-screen')}</div>
          <div class="row"><span>Reticle colour</span>${choice('rcolor', RETICLE_COLORS, cap)}</div>
          <div class="row"><span>Red dot &amp; holo reticle</span>${choice('rstyle', RETICLE_STYLES, cap)}</div>
          <div class="row"><span>Graphics</span>${choice('quality', ['low', 'medium', 'high'] as const, cap)}</div>
        </div>
        <footer><button type="button" class="leave" data-act="leave">Leave match</button></footer>
      </div>`;
    parent.appendChild(this.root);
    const input = (k: string) => this.root.querySelector<HTMLInputElement>(`[data-in="${k}"]`)!;
    input('sens').addEventListener('input', e => { const v = Number((e.target as HTMLInputElement).value); settings.sensitivity = v; save('sensitivity', String(v)); this.actions.sensitivity(v); this.refresh(); });
    input('ads').addEventListener('input', e => { settings.adsSensitivity = Number((e.target as HTMLInputElement).value); save('adsSensitivity', String(settings.adsSensitivity)); this.refresh(); });
    input('fov').addEventListener('input', e => { settings.fov = Number((e.target as HTMLInputElement).value); save('fov', String(settings.fov)); this.refresh(); });
    input('vol').addEventListener('input', e => { const v = Number((e.target as HTMLInputElement).value); save('volume', String(v)); this.actions.volume(v); this.volume = v; this.refresh(); });
    this.root.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'resume') return this.actions.resume();
      if (act === 'leave') return this.actions.leave();
      const d = t.dataset;
      if (d.crosshair) { save('crosshair', d.crosshair); this.actions.crosshair(d.crosshair as CrosshairStyle); }
      if (d.scope) { settings.scopeMode = d.scope as ScopeMode; save('scopeMode', d.scope); }
      if (d.rcolor) { settings.reticleColor = d.rcolor as ReticleColor; save('reticleColor', d.rcolor); }
      if (d.rstyle) { settings.reticleStyle = d.rstyle as ReticleStyle; save('reticleStyle', d.rstyle); }
      if (d.quality) { save('quality', d.quality); this.actions.quality(d.quality as GraphicsQuality); }
      this.refresh();
    });
    // Keep keys typed into the menu from reaching the game.
    this.root.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); this.actions.resume(); }
    });
  }

  private volume = Number(load('volume', '0.8'));
  get open() { return !this.root.hidden; }

  show(solo: boolean) {
    if (this.open) return;
    this.root.querySelector('[data-k="title"]')!.textContent = solo ? 'Paused' : 'Menu — the match continues';
    this.root.hidden = false;
    this.refresh();
  }
  hide() { this.root.hidden = true; }

  private refresh() {
    const set = (k: string, v: string) => { this.root.querySelector<HTMLInputElement>(`[data-in="${k}"]`)!.value = v; };
    const out = (k: string, v: string) => { this.root.querySelector(`[data-out="${k}"]`)!.textContent = v; };
    set('sens', String(settings.sensitivity)); out('sens', `${settings.sensitivity.toFixed(2)}×`);
    set('ads', String(settings.adsSensitivity)); out('ads', `${settings.adsSensitivity.toFixed(2)}×${settings.adsSensitivity === 1 ? ' · matched' : ''}`);
    set('fov', String(settings.fov)); out('fov', `${settings.fov}°`);
    set('vol', String(this.volume)); out('vol', `${Math.round(this.volume * 100)}%`);
    const pick = (group: string, value: string) => this.root.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] button`).forEach(b => b.classList.toggle('on', b.dataset[group] === value));
    pick('crosshair', load('crosshair', 'classic')); pick('scope', settings.scopeMode); pick('rcolor', settings.reticleColor);
    pick('rstyle', settings.reticleStyle); pick('quality', load('quality', 'medium'));
  }

  dispose() { this.root.remove(); }
}
