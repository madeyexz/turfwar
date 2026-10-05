import { OPTIC_DETAILS, RETICLE_COLORS, RETICLE_STYLES, SCOPE_MODES, settings, type OpticDetail, type ReticleColor, type ReticleStyle, type ScopeMode } from '../game/settings';
import { RETICLE_CSS } from '../render/sights';
import type { CrosshairStyle } from './hud';
import './settingsmenu.css';

/** Saved like the lobby saves it (`lawbreaker.<key>`); storage may be disabled. */
const save = (key: string, value: string) => { try { localStorage.setItem(`lawbreaker.${key}`, value); } catch { /* storage disabled */ } };
const load = (key: string, fallback: string) => { try { return localStorage.getItem(`lawbreaker.${key}`) ?? fallback; } catch { return fallback; } };

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface SettingsActions {
  /** In-game only: the Resume button (and Esc / P). */
  resume?(): void;
  /** In-game only: the Leave match button. */
  leave?(): void;
  /** Applied live: mouse sensitivity, crosshair, graphics preset, effects volume. */
  sensitivity(value: number): void;
  crosshair(style: CrosshairStyle): void;
  quality(q: GraphicsQuality): void;
  volume(value: number): void;
}

/** Lobby mode: a "Settings" dialog with a Controls tab and the options only the lobby has. */
export interface LobbySettings {
  /** Current values the lobby owns (it may hold a ?quality override that is not saved). */
  current(): { volume: number; music: number; quality: GraphicsQuality };
  /** Menu music volume, applied live (saved as `lawbreaker.music` here). */
  music(value: number): void;
  /** Effects volume slider released: play a sample at the new level. */
  previewVolume?(): void;
  /** The performance-check link. */
  bench: { label: string; run(): void };
  /** Asset attribution line. */
  credits: string;
  /** After the dialog closes (button, Esc or a click on the backdrop). */
  onClose?(): void;
}

export interface SettingsOptions { lobby?: LobbySettings }
export type SettingsTab = 'options' | 'controls';

const CROSSHAIRS: Record<CrosshairStyle, string> = {
  classic: '<path d="M12 2.5v6M12 15.5v6M2.5 12h6M15.5 12h6"/><circle cx="12" cy="12" r="1.3"/>',
  dot: '<circle cx="12" cy="12" r="2.4"/>',
  circle: '<circle cx="12" cy="12" r="7" fill="none"/><circle cx="12" cy="12" r="1.3"/>',
  t: '<path d="M12 15.5v6M2.5 12h6M15.5 12h6"/><circle cx="12" cy="12" r="1.3"/>',
};
/** Red dot / holo reticle icons ('stock': each sight's own). */
const RETICLES: Record<ReticleStyle, string> = {
  stock: '<circle cx="12" cy="12" r="1.8"/><path d="M4 8.5V4h4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5" fill="none"/>',
  dot: '<circle cx="12" cy="12" r="2.6"/>',
  circle: '<circle cx="12" cy="12" r="8" fill="none"/><circle cx="12" cy="12" r="1.5"/>',
  chevron: '<path d="M5 16.5l7-8 7 8" fill="none" stroke-linejoin="round"/>',
  cross: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/><circle cx="12" cy="12" r="1.3"/>',
};
/** Keys shown on the Controls tab: [keys, what they do]. */
const CONTROLS: [string[], string][] = [
  [['W', 'A', 'S', 'D'], 'Move'],
  [['Mouse'], 'Look'],
  [['LMB'], 'Fire'],
  [['RMB'], 'Aim (zoom)'],
  [['Shift'], 'Sprint (stamina)'],
  [['Space'], 'Jump (stamina)'],
  [['C', 'Ctrl'], 'Crouch'],
  [['1', '2', '3'], 'Knife · secondary · primary'],
  [['4', 'G'], 'Grenade'],
  [['Q', 'Wheel'], 'Last weapon · cycle'],
  [['R'], 'Reload'],
  [['E'], 'Use (bomb, ammo crate)'],
  [['B'], 'Store'],
  [['Z'], 'Binoculars'],
  [['Enter', 'T'], 'Chat · team chat'],
  [['Tab'], 'Scoreboard'],
  [['Esc', 'P'], 'Menu (settings)'],
  [['F'], 'Fullscreen'],
  [['M'], 'Back to the lobby (from the menu)'],
];

const icon = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const choice = <T extends string>(id: string, values: readonly T[], label: (v: T) => string, title?: (v: T) => string) =>
  `<div class="seg" data-group="${id}">${values.map(v => `<button type="button" data-${id}="${v}"${title ? ` title="${title(v)}"` : ''}>${label(v)}</button>`).join('')}</div>`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const percent = (v: number) => v > 0 ? `${Math.round(v * 100)}%` : 'Off';
/** Vertical FOV (what three.js uses) with its 16:9 horizontal equivalent, which players usually quote. */
const horizontal = (v: number) => Math.round(2 * Math.atan(Math.tan(v * Math.PI / 360) * 16 / 9) * 180 / Math.PI);
let uid = 0;

/**
 * In-game menu (Esc or P): resume, the settings that matter mid-match (sensitivity, aim sensitivity,
 * field of view, volume, crosshair, scope view, reticle, graphics) and leave match. Solo pauses while
 * it is open; online the match keeps going.
 *
 * With `options.lobby` it is the lobby's Settings dialog instead: no Resume / Leave, a close button
 * (Esc and a click on the backdrop close it too), menu music, optic detail, the performance check,
 * credits, and a Controls tab with the key list.
 */
export class SettingsMenu {
  readonly root = document.createElement('div');
  private readonly lobby?: LobbySettings;
  private returnFocus: HTMLElement | null = null;
  private volume = Number(load('volume', '0.8'));
  private music = 0;

  constructor(parent: HTMLElement, private actions: SettingsActions, options: SettingsOptions = {}) {
    const lobby = this.lobby = options.lobby;
    const id = `settings-${++uid}`;
    this.root.id = lobby ? 'lobby-settings' : 'ingame-menu';
    this.root.className = `lb-settings${lobby ? ' lobby' : ''}`;
    this.root.hidden = true;
    const slider = (key: string, label: string, min: number, max: number, step: number) =>
      `<label>${label} <output data-out="${key}"></output><input type="range" data-in="${key}" min="${min}" max="${max}" step="${step}"></label>`;
    const options_ = `
      <div class="sliders">
        ${slider('sens', 'Mouse sensitivity', 0.2, 3, 0.05)}
        ${slider('ads', 'Aim sensitivity', 0.5, 1.5, 0.05).replace('<label>', '<label title="1.00 = matched: aiming scales your mouse by the zoom you look through, so moves feel the same scoped and unscoped. Lower = slower when aiming.">')}
        ${slider('fov', 'Field of view', 65, 95, 1)}
        ${slider('vol', 'Effects volume', 0, 1, 0.05)}
        ${lobby ? slider('music', 'Menu music', 0, 1, 0.05) : ''}
      </div>
      <div class="rows">
        <div class="row"><span>Crosshair</span>${choice('crosshair', ['classic', 'dot', 'circle', 't'] as const, v => `${icon(CROSSHAIRS[v])}${v === 't' ? 'T' : cap(v)}`)}</div>
        <div class="row"><span>Scope view</span>${choice('scope', SCOPE_MODES, v => v === 'pip' ? 'Through the lens' : 'Full-screen',
          v => v === 'pip' ? 'Magnified optics show the zoom through the lens; the view around it stays wide' : 'Magnified optics fill the screen with a black eyepiece')}</div>
        <div class="row"><span>Reticle colour</span>${choice('rcolor', RETICLE_COLORS, v => `<i class="swatch" style="--c:${RETICLE_CSS[v]}"></i>${cap(v)}`)}</div>
        <div class="row"><span>Red dot &amp; holo reticle</span>${choice('rstyle', RETICLE_STYLES, v => `${icon(RETICLES[v])}${cap(v)}`,
          v => v === 'stock' ? 'Each sight\'s own: dot for the red dot, circle-dot for the holo' : cap(v))}</div>
        ${lobby ? `<div class="row"><span>Optic detail</span>${choice('optic', OPTIC_DETAILS, cap, v => v === 'high' ? 'Smoothest optic models, sharper scope view' : 'Lighter optic models and scope view')}</div>` : ''}
        <div class="row"><span>Graphics</span>${choice('quality', ['low', 'medium', 'high'] as const, cap,
          v => v === 'low' ? 'No bloom, 1k shadows' : v === 'medium' ? 'Bloom, 2k shadows' : '1.5× resolution')}</div>
      </div>`;
    this.root.innerHTML = lobby ? `
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
        <header>
          <h2 id="${id}-title" data-k="title">Settings</h2>
          <div class="tabs" role="tablist" aria-label="Settings sections">
            <button type="button" role="tab" id="${id}-tab-options" data-tab="options" aria-controls="${id}-options">Options</button>
            <button type="button" role="tab" id="${id}-tab-controls" data-tab="controls" aria-controls="${id}-controls">Controls</button>
          </div>
          <button type="button" class="close" data-act="close" aria-label="Close settings" title="Close (Esc)">${icon('<path d="M6 6l12 12M18 6L6 18" fill="none"/>')}</button>
        </header>
        <div class="pane grid" role="tabpanel" id="${id}-options" data-pane="options" aria-labelledby="${id}-tab-options">
          ${options_}
          <div class="extras">
            <button type="button" class="bench-link" data-act="bench">${lobby.bench.label}</button>
            <p class="credits">${lobby.credits}</p>
          </div>
        </div>
        <div class="pane" role="tabpanel" id="${id}-controls" data-pane="controls" aria-labelledby="${id}-tab-controls" hidden>
          <dl class="keys">${CONTROLS.map(([keys, what]) => `<div><dt>${keys.map(k => `<kbd>${k}</kbd>`).join('')}</dt><dd>${what}</dd></div>`).join('')}</dl>
        </div>
      </div>` : `
      <div class="panel">
        <header><h2 data-k="title">Paused</h2><span class="hint"><kbd>Esc</kbd> / <kbd>P</kbd> resume · <kbd>F</kbd> fullscreen</span></header>
        <button type="button" class="resume" data-act="resume">Resume</button>
        <div class="grid">${options_}</div>
        <footer><button type="button" class="leave" data-act="leave">Leave match</button></footer>
      </div>`;
    parent.appendChild(this.root);
    const input = (k: string) => this.root.querySelector<HTMLInputElement>(`[data-in="${k}"]`)!;
    const value = (e: Event) => Number((e.target as HTMLInputElement).value);
    input('sens').addEventListener('input', e => { const v = value(e); settings.sensitivity = v; save('sensitivity', String(v)); this.actions.sensitivity(v); this.refresh(); });
    input('ads').addEventListener('input', e => { settings.adsSensitivity = value(e); save('adsSensitivity', String(settings.adsSensitivity)); this.refresh(); });
    input('fov').addEventListener('input', e => { settings.fov = value(e); save('fov', String(settings.fov)); this.refresh(); });
    input('vol').addEventListener('input', e => { const v = value(e); save('volume', String(v)); this.actions.volume(v); this.volume = v; this.refresh(); });
    if (lobby) {
      input('vol').addEventListener('change', () => lobby.previewVolume?.());
      input('music').addEventListener('input', e => { const v = value(e); save('music', String(v)); lobby.music(v); this.music = v; this.refresh(); });
    }
    this.root.addEventListener('click', e => {
      // Lobby: a click on the dimmed backdrop (outside the panel) closes the dialog.
      if (lobby && e.target === this.root) return this.close();
      const t = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'resume') return this.actions.resume?.();
      if (act === 'leave') return this.actions.leave?.();
      if (act === 'close') return this.close();
      if (act === 'bench') return lobby?.bench.run();
      const d = t.dataset;
      if (d.tab) return this.tab(d.tab as SettingsTab);
      if (d.crosshair) { save('crosshair', d.crosshair); this.actions.crosshair(d.crosshair as CrosshairStyle); }
      if (d.scope) { settings.scopeMode = d.scope as ScopeMode; save('scopeMode', d.scope); }
      if (d.rcolor) { settings.reticleColor = d.rcolor as ReticleColor; save('reticleColor', d.rcolor); }
      if (d.rstyle) { settings.reticleStyle = d.rstyle as ReticleStyle; save('reticleStyle', d.rstyle); }
      if (d.optic) { settings.opticDetail = d.optic as OpticDetail; save('opticDetail', d.optic); }
      if (d.quality) { save('quality', d.quality); this.quality = d.quality as GraphicsQuality; this.actions.quality(d.quality as GraphicsQuality); }
      this.refresh();
    });
    // Keep keys typed into the menu from reaching the game (or the lobby's own shortcuts).
    this.root.addEventListener('keydown', e => {
      e.stopPropagation();
      if (lobby) {
        if (e.key === 'Escape') { e.preventDefault(); this.close(); }
        else if (e.key === 'Tab') this.trapFocus(e);
        else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (e.target as HTMLElement).dataset.tab) {
          e.preventDefault(); this.tab(this.current === 'options' ? 'controls' : 'options', true);
        }
        return;
      }
      if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); this.actions.resume?.(); }
    });
  }

  private current: SettingsTab = 'options';
  private quality: GraphicsQuality = load('quality', 'medium') as GraphicsQuality;
  get open() { return !this.root.hidden; }

  /** In-game: `solo` picks the title. Lobby: `tab` picks the section to open on. */
  show(solo = false, tab: SettingsTab = 'options') {
    if (this.lobby) {
      const now = this.lobby.current();
      this.volume = now.volume; this.music = now.music; this.quality = now.quality;
      this.tab(tab);
      if (this.open) return;
      this.returnFocus = document.activeElement as HTMLElement | null;
      this.root.hidden = false;
      this.refresh();
      this.root.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (this.open) return;
    this.root.querySelector('[data-k="title"]')!.textContent = solo ? 'Paused' : 'Menu — the match continues';
    this.root.hidden = false;
    this.refresh();
  }
  hide() { this.root.hidden = true; }
  /** Lobby: close and give focus back to whatever opened the dialog. */
  close() {
    if (!this.open) return;
    this.hide();
    this.returnFocus?.focus?.({ preventScroll: true });
    this.returnFocus = null;
    this.lobby?.onClose?.();
  }

  /** Lobby: show one section (Options or Controls). */
  tab(which: SettingsTab, focus = false) {
    if (!this.lobby) return;
    this.current = which;
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => {
      const on = b.dataset.tab === which;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    this.root.querySelectorAll<HTMLElement>('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== which; });
  }

  /** Keeps Tab inside the open dialog. */
  private trapFocus(e: KeyboardEvent) {
    const items = Array.from(this.root.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.closest('[hidden]') && (el as HTMLButtonElement).tabIndex >= 0);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /** Re-reads every control from `settings` and storage (also after another screen changed them). */
  refresh() {
    const set = (k: string, v: string) => { const el = this.root.querySelector<HTMLInputElement>(`[data-in="${k}"]`); if (el) el.value = v; };
    const out = (k: string, v: string) => { const el = this.root.querySelector(`[data-out="${k}"]`); if (el) el.textContent = v; };
    set('sens', String(settings.sensitivity)); out('sens', `${settings.sensitivity.toFixed(2)}×`);
    set('ads', String(settings.adsSensitivity)); out('ads', `${settings.adsSensitivity.toFixed(2)}×${settings.adsSensitivity === 1 ? ' · matched' : ''}`);
    set('fov', String(settings.fov)); out('fov', this.lobby ? `${settings.fov}° · ${horizontal(settings.fov)}° horizontal` : `${settings.fov}°`);
    set('vol', String(this.volume)); out('vol', this.lobby ? percent(this.volume) : `${Math.round(this.volume * 100)}%`);
    if (this.lobby) { this.music = clamp01(this.music); set('music', String(this.music)); out('music', percent(this.music)); }
    const pick = (group: string, value: string) => this.root.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] button`).forEach(b => {
      const on = b.dataset[group] === value;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    pick('crosshair', load('crosshair', 'classic')); pick('scope', settings.scopeMode); pick('rcolor', settings.reticleColor);
    pick('rstyle', settings.reticleStyle); pick('optic', settings.opticDetail);
    pick('quality', this.lobby ? this.quality : load('quality', 'medium'));
  }

  dispose() { this.root.remove(); }
}
