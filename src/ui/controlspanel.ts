import {
  ACTIONS, ACTION_IDS, GROUPS, MAX_KEYS, allConflicts, bindings, defaultBindings, isDefault, onBindings, rebind, removeKey,
  resetAction, setBindings, type ActionId, type Bindings, type InputCode, type Problem, type Rebind,
} from '../game/keybinds';
import { onLang, t, type Key } from './i18n';
import { codeLabel, kbdCode } from './keys';

const escape = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const RESET_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4" fill="none"/></svg>';
const name = (a: ActionId) => t(`act.${a}` as Key);
const names = (list: ActionId[]) => list.map(name).join(' / ');
const keysOf = (codes: readonly InputCode[]) => codes.map(codeLabel).join(' / ');

/** A keyboard-and-mouse device; on touch-only screens the list is shown read-only. */
const touchOnly = () => {
  try { return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches; } catch { return false; }
};

/**
 * The Controls tab: every action grouped (Movement, Combat, Equipment, Vehicles, Interface) with its
 * key and an optional second key, a Reset per row and Reset all. Click a key cap, then press a key,
 * mouse button or the wheel; Esc cancels. A key already used where the action is read is reported
 * inline with Swap or Cancel. Changes apply at once (`setBindings`) and are saved.
 *
 * While it listens for a key it takes every key, button and wheel event first (window, capture
 * phase), so nothing reaches the game, the menu's own shortcuts or the lobby.
 */
export class ControlsPanel {
  readonly el = document.createElement('div');
  private readonly readOnly = touchOnly();
  private capture?: { action: ActionId; slot: number; at: number; problem?: string };
  private pending?: { action: ActionId; slot: number; code: InputCode; result: Extract<Rebind, { kind: 'conflict' }> };
  /** Swallow the release and click that follow a captured mouse button, so they do not press a button again. */
  private quietUntil = 0;
  /** Swallow the key-up that follows a captured key (Space would click the focused button on key-up). */
  private keyQuietUntil = 0;
  private readonly stops: (() => void)[] = [];

  constructor() {
    this.el.className = 'kb';
    this.render();
    this.stops.push(onBindings(() => this.render()), onLang(() => this.render()));
    this.el.addEventListener('click', e => this.click(e));
    const opts = { capture: true } as const;
    const on = <K extends keyof WindowEventMap>(type: K, f: (e: WindowEventMap[K]) => void, o: AddEventListenerOptions = opts) => {
      addEventListener(type, f as EventListener, o);
      this.stops.push(() => removeEventListener(type, f as EventListener, o));
    };
    on('keydown', e => this.onKey(e));
    on('keyup', e => { if (this.capture || performance.now() < this.keyQuietUntil) { e.preventDefault(); e.stopImmediatePropagation(); } });
    on('mousedown', e => this.onMouse(e));
    for (const type of ['mouseup', 'click', 'auxclick', 'contextmenu'] as const) on(type, e => this.swallow(e));
    on('wheel', e => this.onWheel(e), { capture: true, passive: false });
  }

  get capturing() { return !!this.capture; }

  /** Stop listening and drop any open prompt (the menu closed or the tab changed). */
  cancel() {
    if (!this.capture && !this.pending) return;
    const at = this.capture ?? this.pending;
    this.capture = undefined; this.pending = undefined;
    this.render(at && { action: at.action, slot: at.slot });
  }

  dispose() { for (const f of this.stops) f(); this.el.remove(); }

  // ---- Listening for a key ---------------------------------------------------------------------

  private onKey(e: KeyboardEvent) {
    if (!this.capture) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat || e.isComposing) return;
    if (e.code === 'Escape') return this.cancel();
    if (!e.code || e.code === 'Unidentified') return;
    this.offer(e.code, false);
  }

  private onMouse(e: MouseEvent) {
    if (!this.capture) return;
    // The prompt's own Cancel / Remove buttons stay clickable.
    if (e.button === 0 && (e.target as HTMLElement | null)?.closest?.('[data-kb-ui]')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    // A double click on the cap must not bind the left button by accident.
    if (e.button === 0 && performance.now() - this.capture.at < 300) return;
    if (e.button > 4) return;
    this.offer(`Mouse${e.button}`, true);
  }

  private onWheel(e: WheelEvent) {
    if (!this.capture || !e.deltaY) return;
    e.preventDefault(); e.stopImmediatePropagation();
    this.offer(e.deltaY > 0 ? 'WheelDown' : 'WheelUp', false);
  }

  private swallow(e: Event) {
    if (e.type === 'click' && (e.target as HTMLElement | null)?.closest?.('[data-kb-ui]') && !(performance.now() < this.quietUntil)) return;
    if (this.capture || performance.now() < this.quietUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
  }

  /** A key, button or wheel click arrived while listening. */
  private offer(code: InputCode, mouse: boolean) {
    const { action, slot } = this.capture!;
    const r = rebind(bindings() as Bindings, action, slot, code);
    if (r.kind === 'problem') {
      this.capture!.problem = this.problemText(r.problem, action, code);
      return this.render({ action, slot });
    }
    if (mouse) this.quietUntil = performance.now() + 400; else this.keyQuietUntil = performance.now() + 1000;
    this.capture = undefined;
    if (r.kind === 'ok') return this.apply(r.bindings, { action, slot });
    this.pending = { action, slot, code, result: r };
    this.render();
    this.el.querySelector<HTMLElement>(r.swap ? '[data-kb-swap]' : '[data-kb-cancel]')?.focus({ preventScroll: true });
  }

  private apply(b: Bindings, focus?: { action: ActionId; slot: number }) {
    setBindings(b); // re-renders through onBindings
    this.render(focus);
  }

  private problemText(p: Problem, action: ActionId, code: InputCode) {
    return t(`kb.p.${p}` as Key, { key: codeLabel(code), action: name(action) });
  }

  private click(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!btn || this.readOnly) return;
    const d = btn.dataset;
    const b = bindings() as Bindings;
    if (d.kbCap) {
      const action = d.kbCap as ActionId, slot = Number(d.slot);
      this.pending = undefined;
      this.capture = { action, slot, at: performance.now() };
      this.render({ action, slot });
      return;
    }
    if (d.kbReset) return this.apply(resetAction(b, d.kbReset as ActionId), { action: d.kbReset as ActionId, slot: 0 });
    if (d.kbResetAll !== undefined) { this.capture = undefined; this.pending = undefined; setBindings(defaultBindings()); return; }
    if (d.kbSwap !== undefined && this.pending?.result.swap) {
      const { action, slot, result } = this.pending;
      this.pending = undefined;
      return this.apply(result.swap!, { action, slot });
    }
    if (d.kbRemove !== undefined && this.capture) {
      const { action, slot } = this.capture;
      this.capture = undefined;
      return this.apply(removeKey(b, action, slot), { action, slot: 0 });
    }
    if (d.kbCancel !== undefined) this.cancel();
  }

  // ---- Markup ----------------------------------------------------------------------------------

  /** Redraws the list; `focus` puts the keyboard focus back on a cap. */
  private render(focus?: { action: ActionId; slot: number }) {
    const b = bindings() as Bindings;
    const clashes = new Map<string, ActionId[]>();
    for (const c of allConflicts(b)) {
      for (const [x, y] of [[c.a, c.b], [c.b, c.a]] as const) clashes.set(`${x}|${c.code}`, [...(clashes.get(`${x}|${c.code}`) ?? []), y]);
    }
    const ro = this.readOnly;
    const cap = (a: ActionId, slot: number) => {
      const code = b[a][slot] as InputCode | undefined;
      const listening = this.capture?.action === a && this.capture.slot === slot;
      const clash = code ? clashes.get(`${a}|${code}`) : undefined;
      const label = listening ? t('kb.press') : code ? codeLabel(code) : '+';
      const cls = `kb-cap${listening ? ' capturing' : ''}${code ? '' : ' empty'}${clash ? ' clash' : ''}`;
      const title = clash ? t('kb.clash', { others: names(clash) }) : code ? t('kb.change', { action: name(a) }) : t('kb.add', { action: name(a) });
      if (ro) return code ? `<span class="${cls}">${escape(label)}</span>` : '<span class="kb-cap empty" aria-hidden="true"></span>';
      // A second key can be added only once the first exists (always true: every action has one).
      return `<button type="button" class="${cls}" data-kb-cap="${a}" data-slot="${slot}" title="${escape(title)}" aria-label="${escape(`${name(a)}: ${code ? codeLabel(code) : t('kb.add', { action: name(a) })}`)}"${listening ? ' aria-pressed="true"' : ''}>${escape(label)}</button>`;
    };
    const row = (a: ActionId) => {
      const caps = Array.from({ length: MAX_KEYS }, (_, i) => cap(a, i)).join('');
      const dflt = isDefault(b, a);
      const reset = ro ? '' : `<button type="button" class="kb-reset" data-kb-reset="${a}"${dflt ? ' disabled' : ''} title="${escape(t('kb.resetTip', { action: name(a), keys: keysOf(ACTIONS[a].keys) }))}" aria-label="${escape(t('kb.resetTip', { action: name(a), keys: keysOf(ACTIONS[a].keys) }))}">${RESET_ICON}</button>`;
      return `<div class="kb-row${dflt ? '' : ' changed'}" data-row="${a}"><span class="kb-name">${escape(name(a))}</span>${caps}${reset}</div>${this.message(a)}`;
    };
    const look = `<div class="kb-row fixed"><span class="kb-name">${escape(t('act.look'))}</span><span class="kb-cap fixed">${escape(t('key.mouse'))}</span></div>`;
    const groups = GROUPS.map(g => {
      const rows = ACTION_IDS.filter(a => ACTIONS[a].group === g).map(row);
      return `<section class="kb-group" aria-label="${escape(t(`grp.${g}` as Key))}"><h3>${escape(t(`grp.${g}` as Key))}</h3>${g === 'combat' ? look : ''}${rows.join('')}</section>`;
    }).join('');
    const top = ro
      ? `<div class="kb-top"><p>${escape(t('kb.readonly'))}</p></div>`
      : `<div class="kb-top"><p>${escape(t('kb.intro'))}</p><button type="button" class="kb-btn" data-kb-reset-all>${escape(t('kb.resetAll'))}</button></div>`;
    this.el.innerHTML = `${top}${groups}<p class="kb-note">${escape(t('kb.reserved'))}</p>`;
    const target = this.capture ?? focus;
    if (target) this.el.querySelector<HTMLElement>(`[data-kb-cap="${target.action}"][data-slot="${target.slot}"]`)?.focus({ preventScroll: !this.capture });
    if (this.capture) this.el.querySelector('.capturing')?.scrollIntoView?.({ block: 'nearest' });
  }

  /** The inline line under a row: listening, a key that cannot be used, or a clash to swap or cancel. */
  private message(a: ActionId) {
    const c = this.capture, p = this.pending;
    if (c?.action === a) {
      const remove = c.slot > 0 && (bindings() as Bindings)[a][c.slot]
        ? `<button type="button" class="kb-btn" data-kb-ui data-kb-remove>${escape(t('kb.remove'))}</button>` : '';
      const problem = c.problem ? `<span class="kb-problem" role="alert">${escape(c.problem)}</span>` : '';
      return `<div class="kb-msg${c.problem ? ' warn' : ''}" role="status"><span>${escape(t('kb.pressFor', { action: name(a) }))} · ${kbdCode('Escape')} ${escape(t('kb.escCancels'))}</span>${problem}${remove}<button type="button" class="kb-btn" data-kb-ui data-kb-cancel>${escape(t('kb.cancel'))}</button></div>`;
    }
    if (p?.action === a) {
      const key = codeLabel(p.code), others = names(p.result.with);
      const then = !p.result.swap ? (p.result.why === 'clash' && p.result.gives ? t('kb.noSwap', { others, key: codeLabel(p.result.gives) }) : t('kb.stranded', { others }))
        : p.result.gives ? t('kb.swapGives', { others, key: codeLabel(p.result.gives) }) : t('kb.swapLoses', { others });
      const swap = p.result.swap ? `<button type="button" class="kb-btn primary" data-kb-ui data-kb-swap>${escape(t('kb.swap'))}</button>` : '';
      return `<div class="kb-msg warn" role="alert"><span>${escape(t('kb.taken', { key, others }))} ${escape(then)}</span>${swap}<button type="button" class="kb-btn" data-kb-ui data-kb-cancel>${escape(t('kb.cancel'))}</button></div>`;
    }
    return '';
  }
}
