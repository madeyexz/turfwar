/**
 * Key bindings: every action a player can bind, its default keys, where it is read, and the
 * player's own choices (saved per browser under `lawbreaker.keys`).
 *
 * Bindings are physical key codes (`KeyboardEvent.code`), so an action stays on the same key
 * whatever the layout (AZERTY, Dvorak…); the label shown for a key comes from the layout when the
 * browser can tell us (`navigator.keyboard.getLayoutMap()`). Mouse buttons are `Mouse0`…`Mouse4`
 * (left, middle, right, back, forward) and the wheel is `WheelUp` / `WheelDown`.
 *
 * Each action is read in one or more scopes. Two actions may share a key only when their scopes do
 * not overlap: W walks forward on foot and accelerates a car, Space jumps, holds a car's handbrake
 * and lifts the helicopter. On a scooter the rider is in the `car` scope but also shoots, so the
 * weapon actions are read there too.
 *
 * Client-only: the server never sees keys.
 */

/** `KeyboardEvent.code`, `Mouse0`–`Mouse4`, or `WheelUp` / `WheelDown`. */
export type InputCode = string;
/**
 * Where an action is read. `foot`: walking. `car`: at the wheel of a car or a scooter (a scooter
 * rider also shoots). `heli`: flying. `passenger`: in a vehicle's back seat (shoots, looks).
 * `store`: the store is open. `menu`: the in-game menu is open (the mouse is released).
 */
export type Scope = 'foot' | 'car' | 'heli' | 'passenger' | 'store' | 'menu';
export type ActionGroup = 'movement' | 'combat' | 'equipment' | 'vehicles' | 'interface';

export interface ActionDef {
  group: ActionGroup;
  scopes: readonly Scope[];
  /** Default keys, the first one shown in hints (at most `MAX_KEYS`). */
  keys: readonly InputCode[];
  /** Read while held (moving, firing, holding E on the bomb): the wheel, which only clicks, cannot drive it. */
  hold?: boolean;
  /** Not on the wheel either (fullscreen needs a real press; the menu's wheel scrolls it). */
  wheel?: false;
}

const FOOT = ['foot'] as const;
/** Weapons: on foot, a scooter rider (one-handed) and a passenger. */
const ARMED = ['foot', 'car', 'passenger'] as const;
const DRIVE = ['car', 'heli'] as const;
const SEATED = ['car', 'heli', 'passenger'] as const;
const MATCH = ['foot', 'car', 'heli', 'passenger'] as const;

/** Every bindable action, in the order the Controls tab lists them. */
export const ACTIONS = {
  forward: { group: 'movement', scopes: FOOT, keys: ['KeyW'], hold: true },
  back: { group: 'movement', scopes: FOOT, keys: ['KeyS'], hold: true },
  left: { group: 'movement', scopes: FOOT, keys: ['KeyA'], hold: true },
  right: { group: 'movement', scopes: FOOT, keys: ['KeyD'], hold: true },
  jump: { group: 'movement', scopes: FOOT, keys: ['Space'], hold: true },
  crouch: { group: 'movement', scopes: FOOT, keys: ['KeyC', 'ControlLeft'], hold: true },
  sprint: { group: 'movement', scopes: FOOT, keys: ['ShiftLeft', 'ShiftRight'], hold: true },

  fire: { group: 'combat', scopes: ARMED, keys: ['Mouse0'], hold: true },
  aim: { group: 'combat', scopes: ARMED, keys: ['Mouse2'], hold: true },
  reload: { group: 'combat', scopes: ARMED, keys: ['KeyR'] },
  /** Arm or disarm the bomb (held), the ammo crate, get into a vehicle. */
  use: { group: 'combat', scopes: FOOT, keys: ['KeyE'], hold: true },

  knife: { group: 'equipment', scopes: ARMED, keys: ['Digit1'] },
  secondary: { group: 'equipment', scopes: ARMED, keys: ['Digit2'] },
  primary: { group: 'equipment', scopes: ARMED, keys: ['Digit3'] },
  grenade: { group: 'equipment', scopes: ARMED, keys: ['Digit4', 'KeyG'] },
  lastWeapon: { group: 'equipment', scopes: ARMED, keys: ['KeyQ'] },
  /** Also steps a sniper scope's zoom while scoped. */
  nextWeapon: { group: 'equipment', scopes: ARMED, keys: ['WheelDown'] },
  prevWeapon: { group: 'equipment', scopes: ARMED, keys: ['WheelUp'] },
  binoculars: { group: 'equipment', scopes: ['foot', 'passenger'], keys: ['KeyZ'] },

  /** Accelerate; the helicopter flies forward. */
  throttle: { group: 'vehicles', scopes: DRIVE, keys: ['KeyW'], hold: true },
  /** Brake and reverse; the helicopter flies back. */
  brake: { group: 'vehicles', scopes: DRIVE, keys: ['KeyS'], hold: true },
  /** Steer; the helicopter strafes. */
  steerLeft: { group: 'vehicles', scopes: DRIVE, keys: ['KeyA'], hold: true },
  steerRight: { group: 'vehicles', scopes: DRIVE, keys: ['KeyD'], hold: true },
  handbrake: { group: 'vehicles', scopes: ['car'], keys: ['Space'], hold: true },
  climb: { group: 'vehicles', scopes: ['heli'], keys: ['Space'], hold: true },
  descend: { group: 'vehicles', scopes: ['heli'], keys: ['KeyC', 'ControlLeft'], hold: true },
  vehicleView: { group: 'vehicles', scopes: DRIVE, keys: ['KeyV'] },
  exitVehicle: { group: 'vehicles', scopes: SEATED, keys: ['KeyE'] },

  store: { group: 'interface', scopes: [...MATCH, 'store'], keys: ['KeyB'] },
  storePrevTab: { group: 'interface', scopes: ['store'], keys: ['KeyQ'] },
  storeNextTab: { group: 'interface', scopes: ['store'], keys: ['KeyE'] },
  scoreboard: { group: 'interface', scopes: MATCH, keys: ['Tab'], hold: true },
  chat: { group: 'interface', scopes: MATCH, keys: ['Enter'] },
  teamChat: { group: 'interface', scopes: MATCH, keys: ['KeyT'] },
  /** Opens the menu (releases the mouse) and closes it again; Esc always does both too. */
  menu: { group: 'interface', scopes: [...MATCH, 'menu'], keys: ['KeyP'] },
  fullscreen: { group: 'interface', scopes: [...MATCH, 'store', 'menu'], keys: ['KeyF'], wheel: false },
  /** Back to the lobby, from the menu. */
  leave: { group: 'interface', scopes: ['menu'], keys: ['KeyM'], wheel: false },
} as const satisfies Record<string, ActionDef>;

export type ActionId = keyof typeof ACTIONS;
export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];
export const GROUPS: readonly ActionGroup[] = ['movement', 'combat', 'equipment', 'vehicles', 'interface'];
/** A primary key and one alternate per action. */
export const MAX_KEYS = 2;
const def = (a: ActionId): ActionDef => ACTIONS[a];

/** Keys bound to each action, the first shown in hints. */
export type Bindings = Record<ActionId, InputCode[]>;

/**
 * Why a key cannot be bound. `escape`: Esc always opens and closes the menu (and cancels a rebind;
 * browsers also release the mouse on it). `os`: Cmd / Windows keys belong to the system and their
 * key-up is unreliable. `capslock`: it toggles instead of being held (macOS reports no key-up while
 * it is on). `store` / `menu`: keys (and the left button) that work the open store or menu cannot
 * drive an action that also works there. `wheel`: the wheel only clicks, so it cannot be held (nor
 * open fullscreen, which needs a real press).
 */
export type Problem = 'escape' | 'os' | 'capslock' | 'store' | 'menu' | 'wheel' | 'invalid';

export const RESERVED: Readonly<Record<string, Problem>> = {
  Escape: 'escape', MetaLeft: 'os', MetaRight: 'os', OSLeft: 'os', OSRight: 'os', ContextMenu: 'os', CapsLock: 'capslock',
};
const range = (prefix: string, n = 10) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
/** Keys an open screen keeps for itself: the store's clicks, arrows, digits, Enter and Space; the menu's clicks, Tab, Enter and Space. */
export const SCOPE_RESERVED: Partial<Record<Scope, readonly InputCode[]>> = {
  store: ['Mouse0', 'Enter', 'NumpadEnter', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ...range('Digit'), ...range('Numpad')],
  menu: ['Mouse0', 'Tab', 'Enter', 'NumpadEnter', 'Space'],
};

export const isMouse = (code: InputCode) => /^Mouse[0-4]$/.test(code);
export const isWheel = (code: InputCode) => code === 'WheelUp' || code === 'WheelDown';
const validCode = (code: unknown): code is InputCode => typeof code === 'string' && /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(code);

/** Whether `code` may be bound to `action` at all (conflicts with other actions aside). */
export function problemWith(action: ActionId, code: InputCode): Problem | undefined {
  if (!validCode(code)) return 'invalid';
  const reserved = RESERVED[code];
  if (reserved) return reserved;
  for (const s of def(action).scopes) if (SCOPE_RESERVED[s]?.includes(code)) return s as 'store' | 'menu';
  if (isWheel(code) && (def(action).hold || def(action).wheel === false)) return 'wheel';
  return undefined;
}

export const defaultBindings = (): Bindings =>
  Object.fromEntries(ACTION_IDS.map(a => [a, [...def(a).keys]])) as unknown as Bindings;
const DEFAULTS = defaultBindings();
const clone = (b: Bindings): Bindings => Object.fromEntries(ACTION_IDS.map(a => [a, [...b[a]]])) as unknown as Bindings;
const same = (x: readonly InputCode[], y: readonly InputCode[]) => x.length === y.length && x.every((c, i) => c === y[i]);
export const isDefault = (b: Bindings, a: ActionId, defaults: Bindings = DEFAULTS) => same(b[a], defaults[a]);

/** Two actions are read in a common scope, so they may not share a key. */
export const overlaps = (a: ActionId, b: ActionId) => def(a).scopes.some(s => def(b).scopes.includes(s));

/** Other actions read alongside `action` that are bound to `code`. */
export function conflicts(b: Bindings, action: ActionId, code: InputCode): ActionId[] {
  return ACTION_IDS.filter(x => x !== action && overlaps(action, x) && b[x].includes(code));
}

/** Every pair of actions read in a common scope that share a key. */
export function allConflicts(b: Bindings): { a: ActionId; b: ActionId; code: InputCode }[] {
  const out: { a: ActionId; b: ActionId; code: InputCode }[] = [];
  ACTION_IDS.forEach((x, i) => {
    for (const y of ACTION_IDS.slice(i + 1)) {
      if (!overlaps(x, y)) continue;
      for (const code of b[x]) if (b[y].includes(code)) out.push({ a: x, b: y, code });
    }
  });
  return out;
}
const conflictKey = (c: { a: ActionId; b: ActionId; code: InputCode }) => `${c.a}|${c.b}|${c.code}`;

export type Rebind =
  | { kind: 'ok'; bindings: Bindings }
  | { kind: 'problem'; problem: Problem }
  /**
   * `code` is taken: `swap` gives the others this action's old key, when that leaves every action
   * bound and adds no clash. Without a swap, `why` says what stops it: another action would be left
   * with no key (`stranded`), or this action's old key clashes or is reserved where it would go (`clash`).
   */
  | { kind: 'conflict'; with: ActionId[]; swap?: Bindings; gives?: InputCode; why?: 'stranded' | 'clash' };

/** Put `code` in `action`'s key `slot` (0 primary, 1 alternate). Nothing changes until the caller keeps a result. */
export function rebind(b: Bindings, action: ActionId, slot: number, code: InputCode): Rebind {
  const problem = problemWith(action, code);
  if (problem) return { kind: 'problem', problem };
  const next = clone(b);
  const keys = next[action];
  slot = Math.max(0, Math.min(MAX_KEYS - 1, Math.min(slot, keys.length)));
  const old = keys[slot] as InputCode | undefined;
  const own = keys.indexOf(code);
  if (own === slot) return { kind: 'ok', bindings: next };
  if (own >= 0) {
    // Already this action's other key: the two trade places (or it moves up to the primary).
    // An alternate that is already the primary: nothing to add.
    if (old !== undefined) { keys[own] = old; keys[slot] = code; }
    return { kind: 'ok', bindings: next };
  }
  keys[slot] = code;
  const clash = conflicts(b, action, code);
  if (!clash.length) return { kind: 'ok', bindings: next };
  // Swap: each clashing action takes this action's old key in place of `code` (or just loses it).
  for (const x of clash) {
    const xs = next[x], i = xs.indexOf(code);
    if (old !== undefined && !xs.includes(old)) xs[i] = old; else xs.splice(i, 1);
  }
  const before = new Set(allConflicts(b).map(conflictKey));
  if (!clash.every(x => next[x].length > 0)) return { kind: 'conflict', with: clash, gives: old, why: 'stranded' };
  const fits = clash.every(x => next[x].every(c => !problemWith(x, c))) && allConflicts(next).every(c => before.has(conflictKey(c)));
  return fits ? { kind: 'conflict', with: clash, swap: next, gives: old } : { kind: 'conflict', with: clash, gives: old, why: 'clash' };
}

/** Drop an alternate key (the primary always stays). */
export function removeKey(b: Bindings, action: ActionId, slot: number): Bindings {
  const next = clone(b);
  if (slot > 0 && next[action].length > 1) next[action].splice(slot, 1);
  return next;
}

/**
 * Back to the default keys. Another action holding one of them takes a key this action gives up
 * (or one of its own defaults) when that is free for it, else just loses it; a default that would
 * leave another action with no key at all is skipped, so nothing is ever left unbound.
 */
export function resetAction(b: Bindings, action: ActionId, defaults: Bindings = DEFAULTS): Bindings {
  const want = defaults[action];
  const freed = b[action].filter(c => !want.includes(c));
  let next = clone(b);
  next[action] = [];
  for (const code of want) {
    const trial = clone(next);
    trial[action].push(code);
    let ok = true;
    for (const x of conflicts(trial, action, code)) {
      const i = trial[x].indexOf(code);
      const fits = (c: InputCode) => !trial[x].includes(c) && !problemWith(x, c) && conflicts(trial, x, c).length === 0;
      const gift = [...freed, ...defaults[x]].find(fits);
      if (gift !== undefined) trial[x][i] = gift; else trial[x].splice(i, 1);
      if (!trial[x].length) { ok = false; break; }
    }
    if (ok) next = trial;
  }
  return next[action].length ? next : clone(b);
}

// ---- Saving ------------------------------------------------------------------------------------

export const STORAGE_KEY = 'lawbreaker.keys';
/**
 * Saved format version. Only the actions the player changed are saved (`{ v, keys: { action: codes } }`),
 * so a later change to a default reaches everyone who left that action alone. A future version that
 * renames or splits actions adds a step to `MIGRATIONS` (from version `i + 1` to `i + 2`).
 */
export const VERSION = 1;
const MIGRATIONS: ((keys: Record<string, unknown>) => Record<string, unknown>)[] = [];

export function serialize(b: Bindings, defaults: Bindings = DEFAULTS): string {
  const keys: Partial<Bindings> = {};
  for (const a of ACTION_IDS) if (!same(b[a], defaults[a])) keys[a] = b[a];
  return JSON.stringify({ v: VERSION, keys });
}

/**
 * Saved overrides on top of the current defaults. Unknown actions, invalid or reserved keys are
 * dropped; an override wins over a default it now clashes with (that action keeps its other keys,
 * or the override is dropped when nothing would be left).
 */
export function parse(raw: string | null | undefined, defaults: Bindings = DEFAULTS, migrations = MIGRATIONS): Bindings {
  const out = clone(defaults);
  if (!raw) return out;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return out; }
  if (!data || typeof data !== 'object') return out;
  const { v, keys } = data as { v?: unknown; keys?: unknown };
  if (!keys || typeof keys !== 'object') return out;
  let saved = keys as Record<string, unknown>;
  const from = typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 1;
  for (let i = from - 1; i < migrations.length; i++) saved = migrations[i](saved);
  const overridden = new Set<ActionId>();
  for (const [a, codes] of Object.entries(saved)) {
    if (!(a in ACTIONS) || !Array.isArray(codes)) continue;
    const action = a as ActionId;
    const ok = [...new Set(codes.filter((c): c is InputCode => validCode(c) && !problemWith(action, c)))].slice(0, MAX_KEYS);
    if (!ok.length) continue;
    out[action] = ok;
    overridden.add(action);
  }
  // Clashes: two overrides clash only if they were saved that way (keep the first); an override
  // against a default takes the key from the default.
  for (const c of allConflicts(out)) {
    const [keep, lose] = overridden.has(c.a) && !overridden.has(c.b) ? [c.a, c.b] : overridden.has(c.b) && !overridden.has(c.a) ? [c.b, c.a] : [c.a, c.b];
    if (!out[keep].includes(c.code) || !out[lose].includes(c.code)) continue;
    const left = out[lose].filter(x => x !== c.code);
    if (left.length) out[lose] = left;
    else if (overridden.has(keep)) { out[keep] = [...defaults[keep]]; overridden.delete(keep); }
  }
  return out;
}

// ---- The live bindings -------------------------------------------------------------------------

const storage = (): Storage | undefined => { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } };
const read = () => { try { return storage()?.getItem(STORAGE_KEY); } catch { return null; } };
let current: Bindings = parse(read());
const listeners = new Set<() => void>();
const notify = () => { for (const f of listeners) f(); };

/** The bindings in force (do not mutate; use `setBindings`). */
export const bindings = (): Readonly<Bindings> => current;
/** Keys bound to `action`, primary first. */
export const binding = (action: ActionId): readonly InputCode[] => current[action];
/** Whether `code` triggers `action`. */
export const matches = (action: ActionId, code: InputCode) => current[action].includes(code);
/** Every code bound to some action (the game keeps the browser's default off them). */
export const boundCodes = () => new Set(ACTION_IDS.flatMap(a => current[a]));

/** Apply (immediately, everywhere) and save. */
export function setBindings(b: Bindings) {
  current = clone(b);
  try { storage()?.setItem(STORAGE_KEY, serialize(current)); } catch { /* storage disabled */ }
  notify();
}
/** Called whenever bindings (or the keyboard layout's labels) change. Returns an unsubscribe. */
export function onBindings(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

// ---- Labels ------------------------------------------------------------------------------------

let layout: ReadonlyMap<string, string> | undefined;
/** Reads the keyboard layout's labels where the browser offers them (Chromium), then refreshes every label. */
export async function loadLayout() {
  try {
    const kb = (globalThis.navigator as { keyboard?: { getLayoutMap?(): Promise<ReadonlyMap<string, string>>; addEventListener?(t: string, f: () => void): void } } | undefined)?.keyboard;
    if (!kb?.getLayoutMap) return;
    layout = await kb.getLayoutMap();
    notify();
    kb.addEventListener?.('layoutchange', () => { void kb.getLayoutMap!().then(m => { layout = m; notify(); }); });
  } catch { /* not allowed (e.g. in an iframe): friendly names */ }
}
/** For tests: labels from a given layout map (or none). */
export function setLayout(map: ReadonlyMap<string, string> | undefined) { layout = map; }

const NAMES: Record<string, string> = {
  Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt', AltRight: 'R-Alt', Enter: 'Enter', NumpadEnter: 'Num Enter', Tab: 'Tab', Backspace: 'Backspace', Escape: 'Esc',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End',
  PageUp: 'PgUp', PageDown: 'PgDn', CapsLock: 'Caps', NumLock: 'Num Lock', ScrollLock: 'Scroll Lock', Pause: 'Pause', PrintScreen: 'PrtSc',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', IntlBackslash: '\\', Semicolon: ';', Quote: "'",
  Backquote: '`', Comma: ',', Period: '.', Slash: '/',
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', WheelUp: 'Wheel ↑', WheelDown: 'Wheel ↓',
};
/** Keys whose printed label follows the layout (letters and punctuation; digits keep their digit). */
const PRINTED = /^(Key[A-Z]|Minus|Equal|Bracket(Left|Right)|Backslash|IntlBackslash|Semicolon|Quote|Backquote|Comma|Period|Slash)$/;

/**
 * A short label for a key: the layout's own character for letters and punctuation when known
 * ("A" on QWERTY's KeyQ under AZERTY), else a friendly name ("Space", "L-Shift", "Mouse 4", "Wheel ↑").
 * `names` overrides the built-in names (translated mouse and wheel names).
 */
export function keyLabel(code: InputCode, names: Partial<Record<string, string>> = {}): string {
  const own = names[code];
  if (own) return own;
  if (PRINTED.test(code)) {
    const printed = layout?.get(code);
    if (printed && printed.trim()) return printed.toUpperCase();
  }
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^(?:Digit)(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `Num ${m[1]}`;
  return NAMES[code] ?? code;
}
