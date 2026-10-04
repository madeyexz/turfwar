/** Keyboard/mouse state with pointer lock. Game logic reads intents, not raw events. */
export class Input {
  readonly keys = new Set<string>();
  fire = false;
  aim = false;
  /** Edge-triggered actions consumed once per frame. */
  private pressed = new Set<string>();
  lookX = 0;
  lookY = 0;
  wheel = 0;
  sensitivity = 1;
  enabled = true;

  constructor(private canvas: HTMLElement) {
    document.addEventListener('keydown', e => {
      if (!this.enabled || isTyping(e)) return;
      if (['Space', 'Tab', 'ControlLeft', 'KeyC', 'Slash', 'Quote'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', e => { this.keys.delete(e.code); });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.lookX += e.movementX; this.lookY += e.movementY;
    });
    canvas.addEventListener('mousedown', e => {
      if (!this.locked) return;
      if (e.button === 0) { this.fire = true; this.pressed.add('Mouse0'); }
      if (e.button === 2) this.aim = true;
      if (e.button === 1) this.pressed.add('Mouse1');
    });
    document.addEventListener('mouseup', e => { if (e.button === 0) this.fire = false; if (e.button === 2) this.aim = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('wheel', e => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => this.clear());
    document.addEventListener('pointerlockchange', () => { if (!this.locked) { this.fire = false; this.aim = false; } });
  }

  /** Dev-only: ?debuginput lets automated browsers drive input without pointer lock. */
  static readonly debug = import.meta.env.DEV && new URLSearchParams(location.search).has('debuginput');
  get locked() { return Input.debug || document.pointerLockElement === this.canvas; }
  down(code: string) { return this.keys.has(code); }
  /** True once per physical press. */
  take(code: string) { const had = this.pressed.has(code); this.pressed.delete(code); return had; }
  consumeLook() { const x = this.lookX, y = this.lookY; this.lookX = this.lookY = 0; return { x, y }; }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
  endFrame() { this.pressed.clear(); }

  /**
   * Dev/test autopilot: frame-based scripted input so automated runs are deterministic even
   * when a software renderer draws only a few frames per second.
   */
  private script: { frames: number; keys?: string[]; press?: string[]; fire?: boolean; aim?: boolean; look?: [number, number] }[] = [];
  autopilot(steps: typeof this.script) { this.script.push(...steps); }
  get scripted() { return this.script.length > 0; }
  /** Apply the current scripted step; call once at the start of each frame. */
  beginFrame() {
    const step = this.script[0];
    if (!step) return;
    this.keys.clear();
    for (const k of step.keys ?? []) this.keys.add(k);
    if (step.press) { for (const k of step.press) this.pressed.add(k); step.press = undefined; }
    this.fire = !!step.fire; this.aim = !!step.aim;
    if (step.look) { this.lookX += step.look[0]; this.lookY += step.look[1]; }
    if (--step.frames <= 0) { this.script.shift(); if (!this.script.length) { this.keys.clear(); this.fire = false; this.aim = false; } }
  }
  clear() { this.keys.clear(); this.pressed.clear(); this.fire = false; this.aim = false; this.lookX = this.lookY = 0; }
  lock() { return this.canvas.requestPointerLock?.(); }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
