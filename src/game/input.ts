import { binding, boundCodes, onBindings, type ActionId, type InputCode } from './keybinds';

/**
 * Keyboard/mouse state with pointer lock, and touch. Game logic reads actions (`down('jump')`,
 * `take('reload')`, `amount('forward')`) through the player's key bindings (`keybinds.ts`), never raw
 * key codes. Mouse buttons are held codes like keys (`Mouse0`…`Mouse4`), wheel clicks are presses
 * (`WheelUp` / `WheelDown`). On-screen touch controls (`ui/touchcontrols.ts`) drive the same actions:
 * `touchHeld` (with analog amounts from the stick), `touchPress` and look deltas.
 */
export class Input {
  /** Held codes (keys and mouse buttons). */
  readonly keys = new Set<InputCode>();
  /** Actions held by a script (the ?bench run), whatever they are bound to. */
  readonly forced = new Set<ActionId>();
  /** Edge-triggered codes consumed once per frame. */
  private pressed = new Set<InputCode>();
  lookX = 0;
  lookY = 0;
  sensitivity = 1;
  enabled = true;
  /** Actions held by touch controls, with an amount (the stick is analog; buttons hold 1). Rewritten by the controls every frame. */
  touchHeld = new Map<ActionId, number>();
  /** Actions tapped on touch controls since the last frame. */
  private touchPressed = new Set<ActionId>();
  /**
   * Touch play: there is no pointer lock, so "locked" means playing rather than paused in the menu.
   * `release()` pauses (the menu opens), `lock()` resumes.
   */
  touch = false;
  private touchPaused = false;
  /** Codes the browser's own behaviour is kept off (scrolling on Space, focus on Tab, quick find…). */
  private claimed = new Set<InputCode>();

  /** Removes every listener this instance registered (a new Input is created per match). */
  private readonly abort = new AbortController();

  constructor(private canvas: HTMLElement) {
    const signal = this.abort.signal;
    const claim = () => { this.claimed = new Set([...boundCodes(), 'Space', 'Tab', 'Slash', 'Quote']); this.claimed.delete('Escape'); };
    claim();
    const stop = onBindings(claim);
    signal.addEventListener('abort', stop);
    document.addEventListener('keydown', e => {
      if (!this.enabled || isTyping(e)) return;
      if (this.claimed.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    }, { signal });
    document.addEventListener('keyup', e => { this.keys.delete(e.code); }, { signal });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.lookX += e.movementX; this.lookY += e.movementY;
    }, { signal });
    canvas.addEventListener('mousedown', e => {
      if (!this.locked || e.button > 4) return;
      // Back / forward buttons would navigate the page.
      if (e.button >= 3) e.preventDefault();
      const code = `Mouse${e.button}`;
      this.keys.add(code); this.pressed.add(code);
    }, { signal });
    document.addEventListener('mouseup', e => {
      if (e.button >= 3 && this.locked) e.preventDefault();
      this.keys.delete(`Mouse${e.button}`);
    }, { signal });
    canvas.addEventListener('contextmenu', e => e.preventDefault(), { signal });
    document.addEventListener('wheel', e => {
      if (this.locked && e.deltaY) this.pressed.add(e.deltaY > 0 ? 'WheelDown' : 'WheelUp');
    }, { passive: true, signal });
    window.addEventListener('blur', () => this.clear(), { signal });
    // A phone switching apps pauses (the menu is up on return), as Esc does on a computer.
    document.addEventListener('visibilitychange', () => { this.clear(); if (this.touch && document.hidden) this.touchPaused = true; }, { signal });
    document.addEventListener('pointerlockchange', () => { if (!this.locked) this.releaseMouse(); }, { signal });
    // Clicking the view (re)captures the mouse.
    canvas.addEventListener('click', () => { if (!this.locked && this.canRelock()) void this.lock(); }, { signal });
  }
  /** Set by the game: whether a click on the view should capture the mouse (not while a dialog is open). */
  canRelock = () => true;
  dispose() { this.abort.abort(); this.clear(); }

  /** Dev-only: ?debuginput lets automated browsers drive input without pointer lock. */
  static readonly debug = import.meta.env.DEV && new URLSearchParams(location.search).has('debuginput');
  /** Set while a script (the ?bench run) drives the player, so input counts without pointer lock. */
  driven = false;
  get locked() { return Input.debug || this.driven || (this.touch ? !this.touchPaused : document.pointerLockElement === this.canvas); }

  /** Whether `action` is held: any of its keys or mouse buttons, or a touch control. */
  down(action: ActionId) {
    if (this.forced.has(action) || (this.touchHeld.get(action) ?? 0) > 0) return true;
    for (const c of binding(action)) if (this.keys.has(c)) return true;
    return false;
  }
  /** How far `action` is held, 0..1: a key is all or nothing, the touch stick anything between. */
  amount(action: ActionId) {
    const touch = this.touchHeld.get(action) ?? 0;
    if (touch >= 1 || this.forced.has(action)) return 1;
    for (const c of binding(action)) if (this.keys.has(c)) return 1;
    return touch;
  }
  /** True once per physical press of any of `action`'s keys (or a wheel click, or a tap on a touch control). */
  take(action: ActionId) {
    let had = this.touchPressed.delete(action);
    for (const c of binding(action)) if (this.pressed.delete(c)) had = true;
    return had;
  }
  /** A tap on a touch control: `take(action)` sees it once. */
  touchPress(action: ActionId) { this.touchPressed.add(action); }
  /** A finger dragged to look, in CSS pixels, at the touch look speed (`scale`) relative to the mouse's. */
  touchLook(dx: number, dy: number, scale: number) {
    const s = scale / Math.max(0.05, this.sensitivity);
    this.lookX += dx * s; this.lookY += dy * s;
  }
  /** A press of one fixed key (Esc, which is never rebound). */
  takeCode(code: InputCode) { return this.pressed.delete(code); }
  /** Held fire / aim (mouse buttons by default). */
  get fire() { return this.down('fire'); }
  get aim() { return this.down('aim'); }
  consumeLook() { const x = this.lookX, y = this.lookY; this.lookX = this.lookY = 0; return { x, y }; }
  endFrame() { this.pressed.clear(); this.touchPressed.clear(); }

  /**
   * Dev/test autopilot: frame-based scripted input so automated runs are deterministic even
   * when a software renderer draws only a few frames per second. `keys` / `press` are raw codes
   * (read through the bindings like real keys); `fire` / `aim` hold those actions.
   */
  private script: { frames: number; keys?: string[]; press?: string[]; fire?: boolean; aim?: boolean; look?: [number, number] }[] = [];
  autopilot(steps: typeof this.script) { this.script.push(...steps); }
  get scripted() { return this.script.length > 0; }
  /** Apply the current scripted step; call once at the start of each frame. */
  private wasScripted = false;
  beginFrame() {
    const step = this.script[0];
    if (!step) {
      // Release scripted keys one frame after the script ends so its last step still applies.
      if (this.wasScripted) { this.keys.clear(); this.forced.clear(); this.wasScripted = false; }
      return;
    }
    this.wasScripted = true;
    this.keys.clear(); this.forced.clear();
    for (const k of step.keys ?? []) this.keys.add(k);
    if (step.press) { for (const k of step.press) this.pressed.add(k); step.press = undefined; }
    if (step.fire) this.forced.add('fire');
    if (step.aim) this.forced.add('aim');
    if (step.look) { this.lookX += step.look[0]; this.lookY += step.look[1]; }
    if (--step.frames <= 0) this.script.shift();
  }
  /** The mouse was released: no button stays held. */
  private releaseMouse() { for (const c of [...this.keys]) if (c.startsWith('Mouse')) this.keys.delete(c); }
  clear() { this.keys.clear(); this.pressed.clear(); this.forced.clear(); this.touchHeld.clear(); this.touchPressed.clear(); this.lookX = this.lookY = 0; }
  /** Capture the mouse (touch: resume play). */
  lock(): Promise<void> | undefined {
    if (this.touch) { this.touchPaused = false; return Promise.resolve(); }
    return this.canvas.requestPointerLock?.();
  }
  /** Free the mouse (touch: pause, which opens the menu like Esc). */
  release() {
    if (this.touch) this.touchPaused = true;
    else document.exitPointerLock?.();
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
