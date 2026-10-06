import {
  CONTROLS, CUSTOM_ACTIONS, OPACITY_RANGE, SIZE_RANGE, contextControls, defaultLayout, edit, moveTo, placeOf, setTouchLayout, touchLayout, withOptions,
  type ControlId, type PlaceId, type TouchLayout,
} from '../game/touchlayout';
import type { ActionId } from '../game/keybinds';
import { controlHtml, controlName } from './touchcontrols';
import { t, type Key } from './i18n';
import './touch.css';

/** The editor shows one context's controls at a time, so buttons that share a spot in different contexts don't pile up. */
type EditContext = 'foot' | 'car' | 'heli' | 'dead';
const CONTEXTS: readonly EditContext[] = ['foot', 'car', 'heli', 'dead'];
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function placesIn(ctx: EditContext): PlaceId[] {
  const ids = [...contextControls(ctx === 'dead' ? { scope: 'dead', canSpectate: true } : { scope: ctx, use: true, scoped: true, scooter: true })];
  const out: PlaceId[] = [...ids, 'custom1', 'custom2'];
  if (ctx !== 'dead') out.push('stick');
  return out;
}

let open: TouchEditor | undefined;

/** Opens the touch layout editor over whatever is on screen (the lobby's settings or the in-game menu). */
export function openTouchEditor(onClose?: () => void) {
  if (open) return;
  open = new TouchEditor(() => { open = undefined; onClose?.(); });
}

/**
 * Edit touch layout: drag a control to move it, pinch (or the slider) to resize it, hide or show it,
 * choose what a custom slot does, set the opacity, swap to the left-handed preset or reset. Every
 * change is saved at once (`setTouchLayout`) and live controls follow.
 */
class TouchEditor {
  private readonly root = document.createElement('div');
  private readonly stage = document.createElement('div');
  private readonly bar = document.createElement('div');
  private layout: TouchLayout = touchLayout() as TouchLayout;
  private ctx: EditContext = 'foot';
  private sel?: PlaceId;
  private low = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag?: { pointer: number; id: PlaceId; dx: number; dy: number; moved: boolean };
  private pinch?: { dist: number; size: number };
  /** A finger came down on empty space: deselect when it lifts, unless a second finger made it a pinch. */
  private clearOnUp = false;

  constructor(private onClose: () => void) {
    this.root.className = 'tc-editor';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', t('te.title'));
    this.stage.className = 'tc-edit-stage';
    this.bar.className = 'tc-edit-bar';
    this.root.append(this.stage, this.bar);
    document.body.appendChild(this.root);
    document.body.classList.add('tc-editing');
    this.stage.addEventListener('pointerdown', e => this.down(e));
    this.stage.addEventListener('pointermove', e => this.move(e));
    for (const type of ['pointerup', 'pointercancel'] as const) this.stage.addEventListener(type, e => this.up(e));
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    this.bar.addEventListener('click', e => this.barClick(e));
    this.bar.addEventListener('input', e => this.barInput(e));
    this.bar.addEventListener('change', e => this.barInput(e));
    // Keys typed here stay here (the menu behind would take Esc).
    this.root.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); this.close(); } });
    this.render();
  }

  private close() {
    this.root.remove();
    document.body.classList.remove('tc-editing');
    this.onClose();
  }

  private save(next: TouchLayout) { this.layout = next; setTouchLayout(next); }

  private render() {
    const shown = placesIn(this.ctx);
    const scale = Math.max(0.85, Math.min(1.5, Math.min(innerWidth, innerHeight) / 390));
    this.stage.style.setProperty('--op', String(this.layout.opacity));
    this.stage.style.setProperty('--tcs', scale.toFixed(3));
    this.stage.innerHTML = shown.map(id => controlHtml(id, this.layout, `${this.layout.controls[id].hidden ? 'hid' : ''}${id === this.sel ? ' sel' : ''}`)).join('');
    this.renderBar();
  }

  private renderBar() {
    const l = this.layout, sel = this.sel, p = sel ? l.controls[sel] : undefined;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const custom = sel && sel !== 'stick' && CONTROLS[sel].custom;
    const selected = sel && p ? `
      <span class="name">${esc(controlName(sel, l))}</span>
      <label>${esc(t('te.size'))}<input type="range" data-in="size" min="${SIZE_RANGE[0]}" max="${SIZE_RANGE[1]}" step="0.05" value="${p.size}"><output>${pct(p.size)}</output></label>
      ${sel === 'stick' ? '' : `<button type="button" data-act="hide" class="${p.hidden ? 'on' : ''}">${esc(t(p.hidden ? 'te.show' : 'te.hide'))}</button>`}
      ${custom ? `<label>${esc(t('te.action'))}<select data-in="action">${CUSTOM_ACTIONS.map(a => `<option value="${a}"${a === (p.action ?? CONTROLS[sel as ControlId].action) ? ' selected' : ''}>${esc(t(`act.${a}` as Key))}</option>`).join('')}</select></label>` : ''}`
      : `<span class="hint">${esc(t('te.hint'))}</span>`;
    this.bar.classList.toggle('low', this.low);
    this.bar.innerHTML = `
      <div class="row">
        <select data-in="ctx" aria-label="${esc(t('te.ctxLabel'))}">${CONTEXTS.map(c => `<option value="${c}"${c === this.ctx ? ' selected' : ''}>${esc(t(`te.ctx.${c}`))}</option>`).join('')}</select>
        <label>${esc(t('te.opacity'))}<input type="range" data-in="opacity" min="${OPACITY_RANGE[0]}" max="${OPACITY_RANGE[1]}" step="0.05" value="${l.opacity}"><output>${pct(l.opacity)}</output></label>
        <button type="button" data-act="lefty" class="${l.leftHanded ? 'on' : ''}" aria-pressed="${l.leftHanded}">${esc(t('te.left'))}</button>
        <button type="button" data-act="reset">${esc(t('te.reset'))}</button>
        <button type="button" data-act="flip" aria-label="${esc(t('te.flip'))}" title="${esc(t('te.flip'))}">⇅</button>
        <button type="button" data-act="done" class="done">${esc(t('te.done'))}</button>
      </div>
      <div class="row">${selected}</div>`;
  }

  private barClick(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    switch (b.dataset.act) {
      case 'done': return this.close();
      case 'flip': this.low = !this.low; return this.renderBar();
      case 'lefty': this.save(withOptions(this.layout, { leftHanded: !this.layout.leftHanded })); return this.render();
      case 'reset': this.save(defaultLayout()); this.sel = undefined; return this.render();
      case 'hide': if (this.sel) { this.save(edit(this.layout, this.sel, { hidden: !this.layout.controls[this.sel].hidden })); this.render(); } return;
    }
  }

  private barInput(e: Event) {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const k = el.dataset.in;
    if (k === 'ctx' && e.type === 'change') {
      this.ctx = el.value as EditContext;
      if (this.sel && !placesIn(this.ctx).includes(this.sel)) this.sel = undefined;
      this.render();
    } else if (k === 'opacity') {
      this.layout = withOptions(this.layout, { opacity: Number(el.value) });
      this.stage.style.setProperty('--op', String(this.layout.opacity));
      (el.nextElementSibling as HTMLElement).textContent = `${Math.round(this.layout.opacity * 100)}%`;
      if (e.type === 'change') this.save(this.layout);
    } else if (k === 'size' && this.sel) {
      this.layout = edit(this.layout, this.sel, { size: Number(el.value) });
      (el.nextElementSibling as HTMLElement).textContent = `${Math.round(this.layout.controls[this.sel].size * 100)}%`;
      this.restyle(this.sel);
      if (e.type === 'change') this.save(this.layout);
    } else if (k === 'action' && this.sel && e.type === 'change') {
      this.save(edit(this.layout, this.sel, { action: el.value as ActionId }));
      this.render();
    }
  }

  /** Moves and sizes one control's element without redrawing everything (dragging, pinching). */
  private restyle(id: PlaceId) {
    const el = this.stage.querySelector<HTMLElement>(`[data-c="${id}"]`);
    if (!el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = controlHtml(id, this.layout);
    el.setAttribute('style', (tmp.firstElementChild as HTMLElement).getAttribute('style') ?? '');
  }

  private select(id: PlaceId | undefined) {
    this.sel = id;
    if (id) this.low = placeOf(this.layout, id).y < 0.5;
    this.stage.querySelectorAll<HTMLElement>('[data-c]').forEach(el => el.classList.toggle('sel', el.dataset.c === id));
    this.renderBar();
  }

  // ---- Dragging and pinching ---------------------------------------------------------------------

  private down(e: PointerEvent) {
    e.preventDefault();
    try { this.stage.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2 && this.sel) {
      // A second finger: pinch the selected control.
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), size: this.layout.controls[this.sel].size };
      this.drag = undefined; this.clearOnUp = false;
      return;
    }
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c as PlaceId | undefined;
    if (!id) { this.clearOnUp = this.pointers.size === 1; return; }
    const r = this.stage.getBoundingClientRect(), p = placeOf(this.layout, id);
    this.drag = { pointer: e.pointerId, id, dx: r.left + p.x * r.width - e.clientX, dy: r.top + p.y * r.height - e.clientY, moved: false };
    if (id !== this.sel) this.select(id);
  }

  private move(e: PointerEvent) {
    const pt = this.pointers.get(e.pointerId);
    if (!pt) return;
    pt.x = e.clientX; pt.y = e.clientY;
    if (this.pinch && this.sel && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const size = this.pinch.size * Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.dist;
      this.layout = edit(this.layout, this.sel, { size });
      this.restyle(this.sel);
      const out = this.bar.querySelector<HTMLInputElement>('[data-in="size"]');
      if (out) { out.value = String(this.layout.controls[this.sel].size); (out.nextElementSibling as HTMLElement).textContent = `${Math.round(this.layout.controls[this.sel].size * 100)}%`; }
      return;
    }
    const d = this.drag;
    if (!d || d.pointer !== e.pointerId) return;
    const r = this.stage.getBoundingClientRect();
    d.moved = true;
    this.layout = moveTo(this.layout, d.id, (e.clientX + d.dx - r.left) / r.width, (e.clientY + d.dy - r.top) / r.height);
    this.restyle(d.id);
  }

  private up(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.clearOnUp && !this.pointers.size) { this.clearOnUp = false; this.select(undefined); }
    if (this.pinch && this.pointers.size < 2) { this.pinch = undefined; this.save(this.layout); }
    if (this.drag?.pointer === e.pointerId) {
      if (this.drag.moved) { this.save(this.layout); this.select(this.drag.id); }
      this.drag = undefined;
    }
  }
}
