import { ACTIONS, type ActionDef, type ActionId, type Scope } from './keybinds';
import { readEnv, touchEnabled, type TouchPref } from './device';

/**
 * On-screen touch controls: what each control does (it drives an action of the key map, so the game
 * never knows where input came from), where it sits by default, when it is shown, and the player's
 * own layout (moved, resized, hidden, custom slots, opacity, left-handed), saved per browser under
 * `lawbreaker.touch`.
 *
 * Positions are the centre of a control as fractions of the safe area (notches excluded), measured
 * for a right-handed player; the left-handed preset mirrors them. Sizes scale a base diameter.
 */

export type ControlId =
  | 'fire' | 'aim' | 'jump' | 'crouch' | 'reload' | 'use' | 'zoom' | 'binoculars'
  | 'knife' | 'secondary' | 'primary' | 'grenade'
  | 'handbrake' | 'climb' | 'descend' | 'view' | 'exit'
  | 'spectate' | 'menu' | 'scoreboard' | 'chat' | 'store'
  | 'custom1' | 'custom2';
/** Every placed thing: the controls and the movement stick's resting spot. */
export type PlaceId = ControlId | 'stick';

/**
 * `hold`: the action is held while a finger is on the control (fire, use, handbrake).
 * `tap`: one press per tap (reload, a weapon slot). `toggle`: a tap holds the action, the next lets it go (aim, crouch).
 */
export type ControlKind = 'hold' | 'tap' | 'toggle';

export interface ControlDef {
  action: ActionId;
  kind: ControlKind;
  /** Default centre (fractions of the safe area, right-handed) and diameter in CSS pixels at phone size. */
  x: number; y: number; size: number;
  /** Small round buttons in the top row (menu, scoreboard…). */
  small?: boolean;
  /** A slot whose action the player chooses (hidden until they show it). */
  custom?: boolean;
}

/** Every control. `chat` opens the quick-chat sheet (and the keyboard) instead of pressing its key. */
export const CONTROLS: Record<ControlId, ControlDef> = {
  fire: { action: 'fire', kind: 'hold', x: 0.875, y: 0.62, size: 88 },
  aim: { action: 'aim', kind: 'toggle', x: 0.745, y: 0.8, size: 60 },
  jump: { action: 'jump', kind: 'hold', x: 0.955, y: 0.37, size: 56 },
  crouch: { action: 'crouch', kind: 'toggle', x: 0.955, y: 0.86, size: 52 },
  reload: { action: 'reload', kind: 'tap', x: 0.775, y: 0.44, size: 52 },
  use: { action: 'use', kind: 'hold', x: 0.64, y: 0.55, size: 68 },
  zoom: { action: 'nextWeapon', kind: 'tap', x: 0.655, y: 0.8, size: 46 },
  binoculars: { action: 'binoculars', kind: 'tap', x: 0.875, y: 0.2, size: 44 },
  knife: { action: 'knife', kind: 'tap', x: 0.355, y: 0.91, size: 46 },
  secondary: { action: 'secondary', kind: 'tap', x: 0.435, y: 0.91, size: 46 },
  primary: { action: 'primary', kind: 'tap', x: 0.515, y: 0.91, size: 46 },
  grenade: { action: 'grenade', kind: 'tap', x: 0.595, y: 0.91, size: 46 },
  handbrake: { action: 'handbrake', kind: 'hold', x: 0.745, y: 0.8, size: 68 },
  climb: { action: 'climb', kind: 'hold', x: 0.875, y: 0.45, size: 68 },
  descend: { action: 'descend', kind: 'hold', x: 0.875, y: 0.8, size: 68 },
  view: { action: 'vehicleView', kind: 'tap', x: 0.955, y: 0.2, size: 44 },
  exit: { action: 'exitVehicle', kind: 'tap', x: 0.64, y: 0.55, size: 58 },
  spectate: { action: 'aim', kind: 'tap', x: 0.875, y: 0.62, size: 68 },
  menu: { action: 'menu', kind: 'tap', x: 0.03, y: 0.075, size: 40, small: true },
  scoreboard: { action: 'scoreboard', kind: 'toggle', x: 0.085, y: 0.075, size: 40, small: true },
  chat: { action: 'chat', kind: 'tap', x: 0.14, y: 0.075, size: 40, small: true },
  store: { action: 'store', kind: 'tap', x: 0.195, y: 0.075, size: 40, small: true },
  custom1: { action: 'lastWeapon', kind: 'tap', x: 0.655, y: 0.3, size: 48, custom: true },
  custom2: { action: 'fire', kind: 'hold', x: 0.12, y: 0.36, size: 64, custom: true },
};
export const CONTROL_IDS = Object.keys(CONTROLS) as ControlId[];
export const PLACE_IDS: readonly PlaceId[] = [...CONTROL_IDS, 'stick'];

/** The movement stick: resting spot (shown faintly) and ring diameter. It floats to wherever the thumb lands in its half. */
export const STICK = { x: 0.15, y: 0.68, size: 120 };
/** Past this fraction of the ring's radius the stick sprints (on foot, pushing forward). */
export const SPRINT_PUSH = 1.25;
/** Below this fraction of the radius the stick does nothing. */
export const DEAD_ZONE = 0.14;

/** Actions a custom slot may take: everything a finger can sensibly press (the stick moves; chat and fullscreen have their own buttons). */
export const CUSTOM_ACTIONS: readonly ActionId[] = [
  'fire', 'aim', 'reload', 'use', 'jump', 'crouch', 'sprint', 'knife', 'secondary', 'primary', 'grenade', 'lastWeapon',
  'nextWeapon', 'prevWeapon', 'binoculars', 'handbrake', 'climb', 'descend', 'vehicleView', 'exitVehicle', 'scoreboard', 'store',
];

// ---- What a control does -------------------------------------------------------------------------

/** The action a control drives and how (a custom slot takes its chosen action, held if the action is). */
export function controlAction(id: ControlId, layout?: TouchLayout): { action: ActionId; kind: ControlKind } {
  const def = CONTROLS[id];
  if (!def.custom) return { action: def.action, kind: def.kind };
  const action = layout?.controls[id].action ?? def.action;
  return { action, kind: (ACTIONS[action] as ActionDef).hold ? 'hold' : 'tap' };
}

/** Where the player is, for the controls: on foot, at a car's or scooter's wheel, flying, in a back seat, dead, or none at all (store, menu, chat, match over). */
export type TouchScope = 'foot' | 'car' | 'heli' | 'passenger' | 'dead' | 'none';

/**
 * The stick to actions, as analog amounts 0..1. `x` right, `y` down, as fractions of the ring's
 * radius (a thumb past the ring reads above 1). On foot it walks (and sprints past `SPRINT_PUSH`,
 * pushing mostly forward); at the wheel it is throttle / brake and steering; the helicopter flies
 * forward, back and sideways with it.
 */
export function stickActions(scope: TouchScope, x: number, y: number): Partial<Record<ActionId, number>> {
  const push = Math.hypot(x, y);
  if (push < DEAD_ZONE || (scope !== 'foot' && scope !== 'car' && scope !== 'heli')) return {};
  // Rescale past the dead zone so the edge of the ring is full deflection.
  const k = Math.min(1, (push - DEAD_ZONE) / (1 - DEAD_ZONE)) / push;
  const ax = x * k, ay = y * k;
  const out: Partial<Record<ActionId, number>> = {};
  const put = (a: ActionId, v: number) => { if (v > 0.001) out[a] = Math.min(1, v); };
  if (scope === 'foot') {
    put('forward', -ay); put('back', ay); put('left', -ax); put('right', ax);
    if (push >= SPRINT_PUSH && -y > Math.abs(x)) out.sprint = 1;
  } else {
    put('throttle', -ay); put('brake', ay); put('steerLeft', -ax); put('steerRight', ax);
  }
  return out;
}

// ---- When a control is shown ---------------------------------------------------------------------

export interface TouchContext {
  scope: TouchScope;
  /** At a scooter's handlebars: the rider shoots one-handed. */
  scooter?: boolean;
  /** Something in reach to use: a vehicle, an ammo crate, the bomb site (arm or disarm). */
  use?: boolean;
  /** The knife is in hand: nothing to aim or reload. */
  melee?: boolean;
  /** A sniper scope is up: the zoom button steps its magnification. */
  scoped?: boolean;
  /** Someone alive to watch while dead. */
  canSpectate?: boolean;
}

const KEYB_SCOPE: Record<Exclude<TouchScope, 'none' | 'dead'>, Scope> = { foot: 'foot', car: 'car', heli: 'heli', passenger: 'passenger' };

/** The controls that matter right now (before the player's hidden ones are taken out). */
export function contextControls(ctx: TouchContext): Set<ControlId> {
  const out = new Set<ControlId>();
  if (ctx.scope === 'none') return out;
  const add = (...ids: ControlId[]) => { for (const id of ids) out.add(id); };
  add('menu', 'scoreboard', 'chat', 'store');
  const weapons = () => { add('fire', 'secondary', 'primary'); if (!ctx.melee) add('reload'); };
  switch (ctx.scope) {
    case 'foot':
      weapons(); add('jump', 'crouch', 'knife', 'grenade', 'binoculars');
      if (!ctx.melee) add('aim');
      if (ctx.use) add('use');
      if (ctx.scoped) add('zoom');
      break;
    case 'car':
      add('handbrake', 'view', 'exit');
      // A scooter rider fires one-handed: pistol or SMG, no aiming, knife or grenade.
      if (ctx.scooter) weapons();
      break;
    case 'heli': add('climb', 'descend', 'view', 'exit'); break;
    case 'passenger':
      weapons(); add('knife', 'grenade', 'binoculars', 'exit');
      if (!ctx.melee) add('aim');
      if (ctx.scoped) add('zoom');
      break;
    case 'dead': if (ctx.canSpectate) add('spectate'); break;
  }
  return out;
}

/** The controls to draw: those that matter now, minus the ones the player hid, plus custom slots whose action works here. */
export function visibleControls(ctx: TouchContext, layout: TouchLayout): Set<ControlId> {
  const out = contextControls(ctx);
  for (const id of CONTROL_IDS) {
    const place = layout.controls[id];
    if (CONTROLS[id].custom) {
      const scope = ctx.scope === 'none' || ctx.scope === 'dead' ? undefined : KEYB_SCOPE[ctx.scope];
      const { action } = controlAction(id, layout);
      if (!place.hidden && scope && (ACTIONS[action].scopes as readonly Scope[]).includes(scope)) out.add(id);
    } else if (place.hidden) out.delete(id);
  }
  return out;
}

/** Whether the movement stick works here. */
export const stickShown = (scope: TouchScope) => scope === 'foot' || scope === 'car' || scope === 'heli';

// ---- The player's layout -------------------------------------------------------------------------

export interface Place { x: number; y: number; size: number; hidden: boolean; action?: ActionId }
export interface TouchLayout {
  /** Opacity of the controls at rest (pressed ones light up fully). */
  opacity: number;
  /** Mirror everything: the stick on the right, fire on the left. */
  leftHanded: boolean;
  controls: Record<PlaceId, Place>;
}

export const SIZE_RANGE = [0.6, 1.8] as const;
export const OPACITY_RANGE = [0.2, 1] as const;
const DEFAULT_OPACITY = 0.55;

export function defaultLayout(): TouchLayout {
  const controls = Object.fromEntries(CONTROL_IDS.map(id => {
    const d = CONTROLS[id];
    return [id, { x: d.x, y: d.y, size: 1, hidden: !!d.custom, ...(d.custom ? { action: d.action } : {}) }];
  })) as Record<PlaceId, Place>;
  controls.stick = { x: STICK.x, y: STICK.y, size: 1, hidden: false };
  return { opacity: DEFAULT_OPACITY, leftHanded: false, controls };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const cloneLayout = (l: TouchLayout): TouchLayout => ({ ...l, controls: Object.fromEntries(PLACE_IDS.map(id => [id, { ...l.controls[id] }])) as Record<PlaceId, Place> });

/** Where a control is drawn: its centre and size, mirrored for a left-handed player. */
export function placeOf(layout: TouchLayout, id: PlaceId): Place {
  const p = layout.controls[id];
  return layout.leftHanded ? { ...p, x: 1 - p.x } : { ...p };
}

/** Move a control to a centre as drawn (the stored position stays right-handed). */
export function moveTo(layout: TouchLayout, id: PlaceId, x: number, y: number): TouchLayout {
  const next = cloneLayout(layout);
  const cx = clamp(x, 0.02, 0.98), cy = clamp(y, 0.03, 0.97);
  next.controls[id] = { ...next.controls[id], x: layout.leftHanded ? 1 - cx : cx, y: cy };
  return next;
}

/** Change one control's size, visibility or (custom slots) action. */
export function edit(layout: TouchLayout, id: PlaceId, change: Partial<Pick<Place, 'size' | 'hidden' | 'action'>>): TouchLayout {
  const next = cloneLayout(layout);
  const p = { ...next.controls[id] };
  if (change.size !== undefined && num(change.size)) p.size = clamp(change.size, SIZE_RANGE[0], SIZE_RANGE[1]);
  // The stick cannot be hidden: without it nobody could move.
  if (change.hidden !== undefined && id !== 'stick') p.hidden = change.hidden;
  if (change.action && id !== 'stick' && CONTROLS[id].custom && CUSTOM_ACTIONS.includes(change.action)) p.action = change.action;
  next.controls[id] = p;
  return next;
}

export function withOptions(layout: TouchLayout, change: Partial<Pick<TouchLayout, 'opacity' | 'leftHanded'>>): TouchLayout {
  const next = cloneLayout(layout);
  if (change.opacity !== undefined) next.opacity = clamp(change.opacity, OPACITY_RANGE[0], OPACITY_RANGE[1]);
  if (change.leftHanded !== undefined) next.leftHanded = change.leftHanded;
  return next;
}

// ---- Saving --------------------------------------------------------------------------------------

export const TOUCH_STORAGE_KEY = 'lawbreaker.touch';
/**
 * Saved format version. Only what differs from the defaults is saved
 * (`{ v, opacity?, leftHanded?, controls: { id: { x?, y?, size?, hidden?, action? } } }`), so a later
 * change to a default position reaches everyone who left that control alone. A future version that
 * renames or splits controls adds a step to `TOUCH_MIGRATIONS` (from version `i + 1` to `i + 2`).
 */
export const TOUCH_VERSION = 1;
type Saved = Record<string, unknown>;
const TOUCH_MIGRATIONS: ((data: Saved) => Saved)[] = [];

const same = (a: number, b: number) => Math.abs(a - b) < 1e-4;

export function serializeLayout(layout: TouchLayout, defaults: TouchLayout = defaultLayout()): string {
  const controls: Record<string, Partial<Place>> = {};
  for (const id of PLACE_IDS) {
    const p = layout.controls[id], d = defaults.controls[id], diff: Partial<Place> = {};
    if (!same(p.x, d.x)) diff.x = Math.round(p.x * 1e4) / 1e4;
    if (!same(p.y, d.y)) diff.y = Math.round(p.y * 1e4) / 1e4;
    if (!same(p.size, d.size)) diff.size = Math.round(p.size * 100) / 100;
    if (p.hidden !== d.hidden) diff.hidden = p.hidden;
    if (p.action !== d.action && p.action) diff.action = p.action;
    if (Object.keys(diff).length) controls[id] = diff;
  }
  const out: Saved = { v: TOUCH_VERSION, controls };
  if (!same(layout.opacity, defaults.opacity)) out.opacity = Math.round(layout.opacity * 100) / 100;
  if (layout.leftHanded !== defaults.leftHanded) out.leftHanded = layout.leftHanded;
  return JSON.stringify(out);
}

/**
 * A saved layout on top of the current defaults. Unknown controls and bad values are dropped,
 * positions and sizes are clamped into range, and older versions are migrated first.
 */
export function parseLayout(raw: string | null | undefined, defaults: TouchLayout = defaultLayout(), migrations = TOUCH_MIGRATIONS): TouchLayout {
  const out = cloneLayout(defaults);
  if (!raw) return out;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return out; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  let saved = data as Saved;
  const from = num(saved.v) && Number.isInteger(saved.v) && saved.v > 0 ? saved.v : 1;
  if (from > TOUCH_VERSION + migrations.length) return out; // written by a newer build: keep the defaults rather than guess
  for (let i = from - 1; i < migrations.length; i++) saved = migrations[i](saved);
  if (num(saved.opacity)) out.opacity = clamp(saved.opacity, OPACITY_RANGE[0], OPACITY_RANGE[1]);
  if (typeof saved.leftHanded === 'boolean') out.leftHanded = saved.leftHanded;
  const controls = saved.controls;
  if (!controls || typeof controls !== 'object') return out;
  for (const [id, value] of Object.entries(controls as Saved)) {
    if (!(PLACE_IDS as readonly string[]).includes(id) || !value || typeof value !== 'object') continue;
    const v = value as Partial<Record<keyof Place, unknown>>, p = out.controls[id as PlaceId];
    if (num(v.x)) p.x = clamp(v.x, 0.02, 0.98);
    if (num(v.y)) p.y = clamp(v.y, 0.03, 0.97);
    if (num(v.size)) p.size = clamp(v.size, SIZE_RANGE[0], SIZE_RANGE[1]);
    if (typeof v.hidden === 'boolean' && id !== 'stick') p.hidden = v.hidden;
    if (typeof v.action === 'string' && id !== 'stick' && CONTROLS[id as ControlId].custom && (CUSTOM_ACTIONS as readonly string[]).includes(v.action)) p.action = v.action as ActionId;
  }
  return out;
}

// ---- The live layout and touch preferences ---------------------------------------------------------

const storage = (): Storage | undefined => { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } };
const read = (key: string) => { try { return storage()?.getItem(key) ?? null; } catch { return null; } };
const write = (key: string, value: string) => { try { storage()?.setItem(key, value); } catch { /* storage disabled */ } };

let current = parseLayout(read(TOUCH_STORAGE_KEY));
const listeners = new Set<() => void>();
const notify = () => { for (const f of listeners) f(); };

/** The layout in force (do not mutate; use `setTouchLayout`). */
export const touchLayout = (): Readonly<TouchLayout> => current;
/** Apply (everywhere, at once) and save. */
export function setTouchLayout(layout: TouchLayout) {
  current = cloneLayout(layout);
  write(TOUCH_STORAGE_KEY, serializeLayout(current));
  notify();
}

/** Touch controls on, off or following the device (`lawbreaker.touchMode`). */
export function touchPref(): TouchPref {
  const v = read('lawbreaker.touchMode');
  return v === 'on' || v === 'off' ? v : 'auto';
}
export function setTouchPref(pref: TouchPref) { write('lawbreaker.touchMode', pref); notify(); }

/** Whether this browser plays with touch controls now: `?touch=1|0`, then the preference, then the device. */
export function touchActive() {
  let flag: string | null = null;
  try { flag = new URLSearchParams(location.search).get('touch'); } catch { /* no location (tests) */ }
  return touchEnabled(touchPref(), readEnv(), flag);
}

/**
 * Look speed for a dragging finger (`lawbreaker.touchSens`), a multiple of the base finger speed
 * (`TOUCH_LOOK_DEG_PER_PX` degrees per CSS pixel; CSS pixels are about the same physical size on
 * every phone, so a given thumb movement turns the same amount whatever the screen).
 *
 * The default is 2.00×: 0.40° per pixel, so a swipe across the whole screen of the smallest phone we
 * play on (iPhone SE, 667 px landscape) turns about 270°, and about 340° on an iPhone 14 (844 px):
 * half the screen turns you round. The earlier defaults (1.00×, then 1.35×: 180° on the SE) still felt
 * dull to look around with, and 4× was not enough headroom, so the range now reaches 8×. Only the
 * default moved: a value the player saved (any speed, even 1.00×) is kept as it is. Aiming scales this
 * by the zoom like the mouse (`Player.lookScale`).
 */
export const TOUCH_SENS_RANGE = [0.3, 8] as const;
export const TOUCH_SENS_DEFAULT = 2;
/** How much a finger outruns the mouse at 1.00× (per CSS pixel against per mouse count). */
export const TOUCH_LOOK_SCALE = 1.6;
/** Degrees turned per CSS pixel of drag at 1.00× (the mouse's 0.0022 rad per count × `TOUCH_LOOK_SCALE`). */
export const TOUCH_LOOK_DEG_PER_PX = 0.0022 * TOUCH_LOOK_SCALE * 180 / Math.PI;
const TOUCH_SENS_KEY = 'lawbreaker.touchSens';
/** A saved finger speed, clamped into range; the default when nothing (or nothing readable) was saved. */
export function parseTouchSensitivity(raw: string | null | undefined): number {
  const v = raw == null || raw.trim() === '' ? NaN : Number(raw);
  return num(v) && v > 0 ? clamp(v, TOUCH_SENS_RANGE[0], TOUCH_SENS_RANGE[1]) : TOUCH_SENS_DEFAULT;
}
export function touchSensitivity() { return parseTouchSensitivity(read(TOUCH_SENS_KEY)); }
export function setTouchSensitivity(v: number) { write(TOUCH_SENS_KEY, String(clamp(v, TOUCH_SENS_RANGE[0], TOUCH_SENS_RANGE[1]))); notify(); }

/**
 * The look speed slider runs on a log scale over `TOUCH_SENS_STEPS` positions: each step is the same
 * proportional change, so the slow end keeps fine steps and the fast end its room (the default sits a
 * little right of the middle). Positions read back to two decimals, and snap to the default near it.
 */
export const TOUCH_SENS_STEPS = 1000;
const SENS_SPAN = Math.log(TOUCH_SENS_RANGE[1] / TOUCH_SENS_RANGE[0]);
export function touchSensToSlider(v: number) {
  return Math.round(Math.log(clamp(v, TOUCH_SENS_RANGE[0], TOUCH_SENS_RANGE[1]) / TOUCH_SENS_RANGE[0]) / SENS_SPAN * TOUCH_SENS_STEPS);
}
export function touchSensFromSlider(position: number) {
  const v = TOUCH_SENS_RANGE[0] * Math.exp(clamp(position, 0, TOUCH_SENS_STEPS) / TOUCH_SENS_STEPS * SENS_SPAN);
  if (Math.abs(v / TOUCH_SENS_DEFAULT - 1) < 0.02) return TOUCH_SENS_DEFAULT;
  return clamp(Math.round(v * 100) / 100, TOUCH_SENS_RANGE[0], TOUCH_SENS_RANGE[1]);
}

/**
 * Hold fire to aim (`lawbreaker.touchAutoAim`, on unless switched off): holding the fire button
 * raises the sights as it shoots (`holdfire.ts`). The Aim button still toggles them by itself.
 */
export function touchAutoAim() { return read('lawbreaker.touchAutoAim') !== '0'; }
export function setTouchAutoAim(on: boolean) { write('lawbreaker.touchAutoAim', on ? '1' : '0'); notify(); }

/** Called when the layout or a touch preference changes. Returns an unsubscribe. */
export function onTouchLayout(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
