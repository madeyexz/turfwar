import { toView, viewHeight, viewRect, viewWidth } from './viewport';
import { HoldFire, type HoldAim } from '../game/holdfire';
import type { Input } from '../game/input';
import type { ActionId } from '../game/keybinds';
import {
  CONTROLS, CONTROL_IDS, SPRINT_PUSH, STICK, TOUCH_LOOK_SCALE, controlAction, onTouchLayout, placeOf, stickActions, stickShown, touchAutoAim, touchLayout,
  touchSensitivity, visibleControls, type ControlId, type PlaceId, type TouchContext, type TouchLayout,
} from '../game/touchlayout';
import { onLang, t, type Key } from './i18n';
import './touch.css';

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

/** Icons for the controls that have one (the rest show their label only). */
export const ICONS: Partial<Record<PlaceId, string>> = {
  fire: svg('<circle cx="12" cy="12" r="7" fill="none"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.6" class="f"/>'),
  aim: svg('<circle cx="12" cy="12" r="8.5" fill="none"/><circle cx="12" cy="12" r="3.5" fill="none"/><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4"/>'),
  jump: svg('<path d="M5 15l7-7 7 7" fill="none"/><path d="M5 20h14"/>'),
  crouch: svg('<path d="M5 9l7 7 7-7" fill="none"/><path d="M5 4h14"/>'),
  reload: svg('<path d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4.5h-4.5" fill="none"/>'),
  zoom: svg('<circle cx="10.5" cy="10.5" r="6" fill="none"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5"/>'),
  binoculars: svg('<circle cx="7" cy="15" r="4" fill="none"/><circle cx="17" cy="15" r="4" fill="none"/><path d="M7 11V6h3v5M17 11V6h-3v5M10 13h4" fill="none"/>'),
  grenade: svg('<ellipse cx="12" cy="14" rx="6" ry="7" fill="none"/><path d="M10 7V4h4v3M14 5h4" fill="none"/>'),
  smoke: svg('<rect x="6" y="10" width="7" height="11" rx="1.2" fill="none"/><path d="M8 10V7.5h3V10" fill="none"/><path d="M13.5 8.5a2.6 2.6 0 0 1 4.6-1.7 2.4 2.4 0 1 1 .9 4.6H15" fill="none"/>'),
  drink: svg('<path d="M7 8h10l-1.3 12.2a1 1 0 0 1-1 .8H9.3a1 1 0 0 1-1-.8z" fill="none"/><path d="M6 8h12M13 8l2.5-6" fill="none"/><circle cx="10" cy="18" r="1"/><circle cx="13" cy="17" r="1"/><circle cx="11.5" cy="15" r="1"/>'),
  handbrake: svg('<path d="M7 20V4h5.5a4.5 4.5 0 0 1 0 9H7" fill="none"/>'),
  climb: svg('<path d="M12 20V5M6 11l6-6 6 6" fill="none"/>'),
  descend: svg('<path d="M12 4v15M6 13l6 6 6-6" fill="none"/>'),
  view: svg('<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" fill="none"/><circle cx="12" cy="12" r="2.6" fill="none"/>'),
  exit: svg('<path d="M14 4H6v16h8M10 12h11M17 8l4 4-4 4" fill="none"/>'),
  spectate: svg('<path d="M8 5l7 7-7 7" fill="none"/><path d="M16 5v14"/>'),
  menu: svg('<path d="M9 5v14M15 5v14"/>'),
  scoreboard: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  chat: svg('<path d="M4 5h16v11H10l-5 4v-4H4z" fill="none"/>'),
  store: svg('<path d="M4 6h2l2 10h10l2-7H7.5" fill="none"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="16.5" cy="19.5" r="1.3"/>'),
  stick: svg('<circle cx="12" cy="12" r="9" fill="none"/><circle cx="12" cy="12" r="4"/>'),
};

/** A control's name in the current language (custom slots name their action). */
export function controlName(id: PlaceId, layout?: TouchLayout): string {
  if (id === 'custom1' || id === 'custom2') return `${t(`tc.${id}`)} · ${t(`act.${controlAction(id, layout).action}` as Key)}`;
  return t(`tc.${id}` as Key);
}

/** Short text on a button: weapon slots show the gun, custom slots their action. */
function shortLabel(id: ControlId, layout: TouchLayout): string {
  if (CONTROLS[id].custom) {
    const action = controlAction(id, layout).action;
    const own = CONTROL_IDS.find(c => !CONTROLS[c].custom && CONTROLS[c].action === action && c !== 'spectate');
    // An action without a button of its own: its Controls-tab name, without the notes ("Sprint (stamina)" → "Sprint").
    return own ? t(`tc.${own}` as Key) : t(`act.${action}` as Key).split(/\s*[(（·]/)[0];
  }
  return t(`tc.${id}` as Key);
}

/** The markup of one control at its place (shared with the layout editor). */
export function controlHtml(id: PlaceId, layout: TouchLayout, extraClass = '') {
  const p = placeOf(layout, id);
  const d = id === 'stick' ? STICK.size : CONTROLS[id].size;
  const small = id !== 'stick' && CONTROLS[id].small;
  const label = id === 'stick' ? '' : `<span class="tc-l">${esc(shortLabel(id, layout))}</span>`;
  const icon = ICONS[id] ?? (id !== 'stick' && CONTROLS[id].custom ? ICONS[controlAction(id, layout).action as PlaceId] ?? '' : '');
  const style = `left:${(p.x * 100).toFixed(2)}%;top:${(p.y * 100).toFixed(2)}%;--d:${(d * p.size).toFixed(1)}`;
  return `<div class="tc-btn${small ? ' small' : ''}${icon ? '' : ' text'} ${extraClass}" data-c="${id}" style="${style}">${icon}${label}</div>`;
}

/** Information the buttons show besides the context: weapon names, which is in hand, grenades, what Use does. */
export interface TouchInfo {
  slot: number;
  weapons: [string, string];
  grenades: number;
  /** M18 smoke grenades carried. */
  smokes?: number;
  /** 珍奶 carried. */
  bobas?: number;
  /** What the Use button does here. */
  use?: 'vehicle' | 'crate' | 'arm' | 'disarm';
  /** The store is worth a look: buy time in base, or a free store. */
  storeHot?: boolean;
  reloading?: boolean;
  /** What holding fire does with the weapon in hand (`holdfire.ts`); `none` when absent. */
  holdAim?: HoldAim;
  /** This player's shots so far (a sniper's release shot waits for the next one). */
  shots?: number;
}

export interface TouchHooks {
  /** Open the typing chat box (and the on-screen keyboard) — called inside the tap, as iOS requires. */
  typeChat(team: boolean): void;
  /** Send a quick-chat line. */
  say(text: string, team: boolean): void;
}

type Finger =
  | { role: 'stick'; ox: number; oy: number; x: number; y: number }
  | { role: 'look'; x: number; y: number }
  | { role: 'button'; id: ControlId; x: number; y: number; look: boolean };

const QUICK = ['qc.backup', 'qc.spotted', 'qc.goA', 'qc.goB', 'qc.defend', 'qc.niceShot', 'qc.thanks', 'qc.gg'] as const;

/**
 * On-screen controls for phones and tablets. The left part of the screen is a floating stick
 * (it appears where the thumb lands; past its ring you sprint), the rest is a look pad, and the
 * buttons press the same actions as keys (`Input.touchHeld` / `touchPress`), so the game reads one
 * action map whatever the device. Only the buttons that matter in the current context are shown
 * (`visibleControls`); the player's layout (`touchlayout.ts`) places, sizes and hides them.
 */
export class TouchControls {
  readonly root = document.createElement('div');
  private readonly stick = document.createElement('div');
  private readonly sheet = document.createElement('div');
  private fingers = new Map<number, Finger>();
  /** Hold buttons under a finger, toggled buttons, and holds tapped since the last frame (a quick tap still counts for one frame). */
  private held = new Set<ControlId>();
  private toggled = new Set<ControlId>();
  private pulsed = new Set<ControlId>();
  /** Hold fire to aim: the fire control driving it (fire, or a custom slot set to fire) while a finger is on it. */
  private readonly hold = new HoldFire();
  private holdId?: ControlId;
  private stickVec = { x: 0, y: 0 };
  private ctx: TouchContext = { scope: 'none' };
  private shownKey = '';
  private infoKey = '';
  private lastSlot = -1;
  private sheetTeam = false;
  private buttons = new Map<ControlId, HTMLElement>();
  private readonly stops: (() => void)[] = [];
  private scale = 1;

  constructor(parent: HTMLElement, private input: Input, private hooks: TouchHooks) {
    this.root.id = 'touch';
    this.root.className = 'touch-layer';
    this.stick.className = 'tc-stick';
    this.stick.innerHTML = '<i class="ring"></i><i class="knob"></i>';
    this.sheet.className = 'tc-sheet';
    this.sheet.hidden = true;
    this.build();
    parent.append(this.root, this.sheet);
    const opts = { passive: false } as const;
    this.root.addEventListener('pointerdown', e => this.down(e), opts);
    this.root.addEventListener('pointermove', e => this.move(e), opts);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.root.addEventListener(type, e => this.up(e));
    // No mouse events or click after a tap: the store or menu a button opens must not take that click.
    this.root.addEventListener('touchstart', e => e.preventDefault(), opts);
    // Long presses must not open the context menu or select text.
    for (const el of [this.root, this.sheet]) el.addEventListener('contextmenu', e => e.preventDefault());
    this.sheet.addEventListener('click', e => this.sheetClick(e));
    const resize = () => this.measure();
    addEventListener('resize', resize);
    this.stops.push(() => removeEventListener('resize', resize));
    this.stops.push(onTouchLayout(() => this.build()), onLang(() => { this.build(); if (!this.sheet.hidden) this.openSheet(); }));
    this.measure();
  }

  /** Bigger screens get bigger buttons (a tablet's thumb reach is wider), within reason. */
  private measure() {
    const r = viewRect(this.root.getBoundingClientRect());
    const short = Math.min(r.width || viewWidth(), r.height || viewHeight());
    this.scale = Math.max(0.85, Math.min(1.5, short / 390));
    this.root.style.setProperty('--tcs', this.scale.toFixed(3));
    this.sheet.style.setProperty('--tcs', this.scale.toFixed(3));
  }

  private build() {
    const layout = touchLayout();
    this.root.style.setProperty('--op', String(layout.opacity));
    this.root.classList.toggle('lefty', layout.leftHanded);
    // The HUD swaps sides with the controls (vitals go right, the kill feed left).
    document.body.classList.toggle('tc-lefty', layout.leftHanded);
    this.root.innerHTML = CONTROL_IDS.map(id => controlHtml(id, layout)).join('');
    this.root.prepend(this.stick);
    const rest = placeOf(layout, 'stick');
    this.stick.style.setProperty('--d', String(STICK.size * rest.size));
    this.restStick();
    this.buttons.clear();
    this.root.querySelectorAll<HTMLElement>('[data-c]').forEach(el => this.buttons.set(el.dataset.c as ControlId, el));
    this.shownKey = ''; this.infoKey = '';
    this.update(this.ctx, this.info);
  }

  private info: TouchInfo = { slot: 0, weapons: ['', ''], grenades: 0 };

  /** Called every frame by the game before it reads input: shows the right buttons and writes the held actions. */
  update(ctx: TouchContext, info: TouchInfo) {
    const was = this.ctx;
    this.ctx = ctx; this.info = info;
    if (ctx.scope === 'none' && !this.sheet.hidden && was.scope !== 'none') this.closeSheet();
    // Aim lets go whenever the context changes, the weapon changes or a reload starts (as releasing the button would).
    if (ctx.scope !== was.scope || info.slot !== this.lastSlot || info.reloading || ctx.melee) this.toggled.delete('aim');
    this.lastSlot = info.slot;
    const layout = touchLayout();
    const shown = visibleControls(ctx, layout);
    const key = [...shown].join() + (stickShown(ctx.scope) ? '|s' : '');
    if (key !== this.shownKey) {
      this.shownKey = key;
      for (const [id, el] of this.buttons) el.hidden = !shown.has(id);
      this.root.classList.toggle('off', ctx.scope === 'none');
      this.root.classList.toggle('nostick', !stickShown(ctx.scope));
      // Controls that went away let go of what they held.
      for (const id of [...this.held, ...this.toggled]) if (!shown.has(id) && id !== 'scoreboard') { this.held.delete(id); this.toggled.delete(id); }
      for (const [pid, f] of this.fingers) if (f.role === 'button' && !shown.has(f.id)) this.fingers.delete(pid);
      if (this.holdId && !shown.has(this.holdId)) { this.hold.reset(); this.holdId = undefined; }
      if (!stickShown(ctx.scope)) this.releaseStick();
    }
    if (ctx.scope === 'none' || ctx.scope === 'dead') { this.hold.reset(); this.holdId = undefined; }
    const ikey = `${info.slot}|${info.weapons}|${info.grenades}|${info.smokes}|${info.bobas}|${info.use}|${info.storeHot}`;
    if (ikey !== this.infoKey) {
      this.infoKey = ikey;
      const label = (id: ControlId, text: string) => { const l = this.buttons.get(id)?.querySelector('.tc-l'); if (l) l.textContent = text; };
      label('primary', info.weapons[0]); label('secondary', info.weapons[1]);
      label('grenade', `×${info.grenades}`); label('smoke', `×${info.smokes ?? 0}`); label('drink', `×${info.bobas ?? 0}`);
      label('use', t(info.use ? `tc.use.${info.use}` : 'tc.use'));
      this.buttons.get('primary')?.classList.toggle('on', info.slot === 0);
      this.buttons.get('secondary')?.classList.toggle('on', info.slot === 1);
      this.buttons.get('knife')?.classList.toggle('on', info.slot === 2);
      this.buttons.get('grenade')?.classList.toggle('empty', info.grenades <= 0);
      this.buttons.get('smoke')?.classList.toggle('empty', !info.smokes);
      this.buttons.get('drink')?.classList.toggle('empty', !info.bobas);
      this.buttons.get('store')?.classList.toggle('hot', !!info.storeHot);
    }
    for (const [id, el] of this.buttons) el.classList.toggle('active', this.held.has(id) || this.toggled.has(id) || this.fingerOn(id));
    this.sync();
  }

  private fingerOn(id: ControlId) { for (const f of this.fingers.values()) if (f.role === 'button' && f.id === id) return true; return false; }

  /** What holding fire does now: nothing extra once Aim is toggled on (the sights are already up). */
  private holdMode(): HoldAim { return this.toggled.has('aim') ? 'none' : this.info.holdAim ?? 'none'; }

  /** Writes what the controls hold into the input for this frame. */
  private sync() {
    const held = this.input.touchHeld;
    held.clear();
    if (this.ctx.scope === 'none') { this.pulsed.clear(); return; }
    for (const [a, v] of Object.entries(stickActions(this.ctx.scope, this.stickVec.x, this.stickVec.y))) held.set(a as ActionId, v);
    const layout = touchLayout();
    for (const id of new Set([...this.held, ...this.toggled, ...this.pulsed])) held.set(controlAction(id, layout).action, 1);
    this.pulsed.clear();
    const hold = this.hold.frame(performance.now(), this.holdMode(), this.info.slot, this.info.shots ?? 0);
    if (hold.fire) held.set('fire', 1);
    if (hold.aim) held.set('aim', 1);
  }

  // ---- Fingers ---------------------------------------------------------------------------------

  private down(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (this.ctx.scope === 'none') return;
    try { this.root.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
    const id = btn?.dataset.c as ControlId | undefined;
    if (id && !btn!.hidden) return this.press(e, id);
    const r = viewRect(this.root.getBoundingClientRect()), p = toView(e.clientX, e.clientY);
    const fx = (p.x - r.left) / r.width, fy = (p.y - r.top) / r.height;
    const lefty = touchLayout().leftHanded;
    const inStickHalf = lefty ? fx > 0.55 : fx < 0.45;
    if (stickShown(this.ctx.scope) && inStickHalf && fy > 0.18 && ![...this.fingers.values()].some(f => f.role === 'stick')) {
      this.fingers.set(e.pointerId, { role: 'stick', ox: p.x, oy: p.y, x: p.x, y: p.y });
      this.placeStick(p.x, p.y);
      return;
    }
    this.fingers.set(e.pointerId, { role: 'look', x: p.x, y: p.y });
  }

  private press(e: PointerEvent, id: ControlId) {
    const layout = touchLayout();
    const { action, kind } = controlAction(id, layout);
    // Holding fire and dragging aims at the same time (the fire button doubles as a look pad).
    const p = toView(e.clientX, e.clientY);
    this.fingers.set(e.pointerId, { role: 'button', id, x: p.x, y: p.y, look: action === 'fire' || action === 'aim' });
    navigator.vibrate?.(8);
    if (id === 'chat') { this.openSheet(); return; }
    // Hold fire to aim: the hold decides when to shoot and when to raise the sights (a second fire control adds nothing).
    if (action === 'fire' && kind === 'hold' && touchAutoAim()) {
      if (!this.holdId) { this.holdId = id; this.hold.press(performance.now(), this.holdMode(), this.info.slot); }
    }
    // A held control is also a press, as a key is: Use gets in a vehicle on the press and arms the bomb while held.
    else if (kind === 'hold') { this.held.add(id); this.pulsed.add(id); this.input.touchPress(action); }
    else if (kind === 'toggle') { if (this.toggled.has(id)) this.toggled.delete(id); else this.toggled.add(id); }
    else this.input.touchPress(action);
    this.buttons.get(id)?.classList.add('active');
  }

  private move(e: PointerEvent) {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    e.preventDefault();
    const p = toView(e.clientX, e.clientY);
    if (f.role === 'stick') {
      f.x = p.x; f.y = p.y;
      this.dragStick(f);
      return;
    }
    if (f.role === 'button' && !f.look) return;
    const dx = p.x - f.x, dy = p.y - f.y;
    f.x = p.x; f.y = p.y;
    this.input.touchLook(dx, dy, TOUCH_LOOK_SCALE * touchSensitivity());
  }

  private up(e: PointerEvent) {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    this.fingers.delete(e.pointerId);
    if (f.role === 'stick') this.releaseStick();
    else if (f.role === 'button' && !this.fingerOn(f.id)) {
      if (f.id === this.holdId) {
        this.hold.release(performance.now(), this.holdMode(), this.info.slot, this.info.shots ?? 0);
        this.holdId = undefined;
      }
      this.held.delete(f.id);
      this.buttons.get(f.id)?.classList.toggle('active', this.toggled.has(f.id));
    }
  }

  // ---- The stick -------------------------------------------------------------------------------

  private radius() { return STICK.size * placeOf(touchLayout(), 'stick').size * this.scale / 2; }

  /** The stick's ring appears under the thumb (kept fully on screen). */
  private placeStick(x: number, y: number) {
    const r = viewRect(this.root.getBoundingClientRect()), rad = this.radius();
    const cx = Math.max(r.left + rad, Math.min(r.right - rad, x)), cy = Math.max(r.top + rad, Math.min(r.bottom - rad, y));
    const f = [...this.fingers.values()].find(g => g.role === 'stick') as Extract<Finger, { role: 'stick' }> | undefined;
    if (f) { f.ox = cx; f.oy = cy; }
    this.stick.style.left = `${cx - r.left}px`; this.stick.style.top = `${cy - r.top}px`;
    this.stick.classList.add('live');
    this.dragStick(f);
  }

  private dragStick(f?: Extract<Finger, { role: 'stick' }>) {
    if (!f) return;
    const rad = this.radius();
    let dx = f.x - f.ox, dy = f.y - f.oy;
    this.stickVec = { x: dx / rad, y: dy / rad };
    const push = Math.hypot(this.stickVec.x, this.stickVec.y);
    // The knob stops a little past the ring (the sprint zone).
    const max = rad * SPRINT_PUSH * 1.08, len = Math.hypot(dx, dy);
    if (len > max) { dx *= max / len; dy *= max / len; }
    (this.stick.lastElementChild as HTMLElement).style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`;
    this.stick.classList.toggle('sprint', this.ctx.scope === 'foot' && push >= SPRINT_PUSH && -this.stickVec.y > Math.abs(this.stickVec.x));
  }

  private releaseStick() {
    for (const [id, f] of this.fingers) if (f.role === 'stick') this.fingers.delete(id);
    this.stickVec = { x: 0, y: 0 };
    this.restStick();
  }

  /** Back to its resting spot, faint. */
  private restStick() {
    const p = placeOf(touchLayout(), 'stick');
    this.stick.classList.remove('live', 'sprint');
    this.stick.style.left = `${(p.x * 100).toFixed(2)}%`; this.stick.style.top = `${(p.y * 100).toFixed(2)}%`;
    (this.stick.lastElementChild as HTMLElement).style.transform = '';
  }

  // ---- Quick chat ------------------------------------------------------------------------------

  /** When the sheet opened: the click the browser sends after the opening tap must not close it again. */
  private sheetAt = 0;
  private openSheet() {
    if (this.sheet.hidden) this.sheetAt = performance.now();
    this.sheet.hidden = false;
    this.sheet.innerHTML = `<div class="tc-sheet-panel" role="dialog" aria-label="${esc(t('qc.title'))}">
      <header><b>${esc(t('qc.title'))}</b><div class="seg"><button type="button" data-team="0" class="${this.sheetTeam ? '' : 'on'}">${esc(t('qc.all'))}</button><button type="button" data-team="1" class="${this.sheetTeam ? 'on' : ''}">${esc(t('qc.team'))}</button></div><button type="button" class="x" data-close aria-label="${esc(t('qc.close'))}">✕</button></header>
      <div class="lines">${QUICK.map(k => `<button type="button" data-say="${k}">${esc(t(k))}</button>`).join('')}</div>
      <button type="button" class="type" data-type>${esc(t('qc.type'))}</button>
    </div>`;
  }
  private closeSheet() { this.sheet.hidden = true; this.sheet.innerHTML = ''; }
  private sheetClick(e: MouseEvent) {
    const el = e.target as HTMLElement;
    if (performance.now() - this.sheetAt < 350) return;
    if (el === this.sheet || el.closest('[data-close]')) return this.closeSheet();
    const team = el.closest<HTMLElement>('[data-team]')?.dataset.team;
    if (team !== undefined) { this.sheetTeam = team === '1'; return this.openSheet(); }
    const say = el.closest<HTMLElement>('[data-say]')?.dataset.say as Key | undefined;
    if (say) { this.hooks.say(t(say), this.sheetTeam); return this.closeSheet(); }
    if (el.closest('[data-type]')) { const team = this.sheetTeam; this.closeSheet(); this.hooks.typeChat(team); }
  }

  /** Let go of everything (the match paused or ended). */
  reset() {
    this.fingers.clear(); this.held.clear(); this.pulsed.clear();
    this.toggled.delete('aim');
    this.hold.reset(); this.holdId = undefined;
    this.releaseStick();
    this.input.touchHeld.clear();
  }

  dispose() {
    for (const f of this.stops) f();
    this.reset();
    this.root.remove(); this.sheet.remove();
    document.body.classList.remove('tc-lefty');
  }
}
