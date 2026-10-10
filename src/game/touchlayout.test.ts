import { describe, expect, it, vi } from 'vitest';
import { ACTIONS, type Scope } from './keybinds';
import {
  CONTROLS, CONTROL_IDS, CUSTOM_ACTIONS, DEAD_ZONE, PLACE_IDS, SIZE_RANGE, SPRINT_PUSH, TOUCH_LOOK_DEG_PER_PX, TOUCH_SENS_DEFAULT, TOUCH_SENS_RANGE, TOUCH_SENS_STEPS, TOUCH_VERSION,
  contextControls, controlAction, defaultLayout, edit, moveTo, parseLayout, parseTouchSensitivity, placeOf, serializeLayout, setTouchAutoAim, setTouchSensitivity,
  stickActions, stickShown, touchAutoAim, touchSensFromSlider, touchSensToSlider, touchSensitivity, visibleControls, withOptions, type ControlId, type TouchContext,
} from './touchlayout';

const ids = (s: Set<ControlId>) => [...s].sort();

describe('touch controls drive the key map', () => {
  it('every control presses an action that exists, read where the control is shown', () => {
    for (const id of CONTROL_IDS) expect(ACTIONS[controlAction(id).action], id).toBeDefined();
    const scopes: [TouchContext, Scope][] = [[{ scope: 'foot', use: true, scoped: true }, 'foot'], [{ scope: 'car', scooter: true }, 'car'], [{ scope: 'heli' }, 'heli'], [{ scope: 'passenger', scoped: true }, 'passenger']];
    for (const [ctx, scope] of scopes) {
      for (const id of contextControls(ctx)) {
        if (id === 'chat' || id === 'menu') continue; // they work everywhere in a match
        const { action } = controlAction(id);
        expect((ACTIONS[action].scopes as readonly Scope[]).includes(scope), `${id} → ${action} in ${scope}`).toBe(true);
      }
    }
  });

  it('holds what is held on a keyboard, taps what is pressed, toggles aim', () => {
    expect(controlAction('fire')).toEqual({ action: 'fire', kind: 'hold' });
    expect(controlAction('use')).toEqual({ action: 'use', kind: 'hold' });
    expect(controlAction('reload')).toEqual({ action: 'reload', kind: 'tap' });
    expect(controlAction('aim')).toEqual({ action: 'aim', kind: 'toggle' });
    expect(controlAction('crouch')).toEqual({ action: 'crouch', kind: 'hold' });
    expect(controlAction('grenade')).toEqual({ action: 'grenade', kind: 'tap' });
    expect(controlAction('handbrake')).toEqual({ action: 'handbrake', kind: 'hold' });
    expect(controlAction('exit')).toEqual({ action: 'exitVehicle', kind: 'tap' });
    expect(controlAction('zoom').action).toBe('nextWeapon');
    // Spectating: "next" is the aim key, as RMB is on a computer.
    expect(controlAction('spectate')).toEqual({ action: 'aim', kind: 'tap' });
  });

  it('custom slots take the chosen action, held or tapped as that action is', () => {
    let l = edit(defaultLayout(), 'custom1', { action: 'sprint' });
    expect(controlAction('custom1', l)).toEqual({ action: 'sprint', kind: 'hold' });
    l = edit(l, 'custom1', { action: 'lastWeapon' });
    expect(controlAction('custom1', l)).toEqual({ action: 'lastWeapon', kind: 'tap' });
    // Movement is the stick's, and keys only the store uses are not offered.
    expect(CUSTOM_ACTIONS).not.toContain('forward');
    expect(CUSTOM_ACTIONS).not.toContain('storeNextTab');
    expect(controlAction('custom1', edit(l, 'custom1', { action: 'forward' })).action).toBe('lastWeapon');
  });
});

describe('the stick', () => {
  it('walks in proportion past a dead zone, and sprints only pushed past the ring and forward', () => {
    expect(stickActions('foot', 0.05, -0.05)).toEqual({});
    const half = stickActions('foot', 0, -0.57);
    expect(half.forward).toBeCloseTo((0.57 - DEAD_ZONE) / (1 - DEAD_ZONE), 5);
    expect(half.back).toBeUndefined();
    expect(half.sprint).toBeUndefined();
    expect(stickActions('foot', 0, -1).forward).toBeCloseTo(1, 5);
    expect(stickActions('foot', 0, -SPRINT_PUSH).sprint).toBe(1);
    expect(stickActions('foot', SPRINT_PUSH, 0).sprint).toBeUndefined();
    expect(stickActions('foot', 0, SPRINT_PUSH).sprint).toBeUndefined();
    const diag = stickActions('foot', 0.7, 0.7);
    expect(diag.right).toBeGreaterThan(0.6);
    expect(diag.back).toBeGreaterThan(0.6);
    expect(diag.left ?? 0).toBe(0);
  });

  it('is throttle, brake and steering in a car and flies the helicopter', () => {
    const car = stickActions('car', -0.5, -1);
    expect(car.throttle).toBeGreaterThan(0.8);
    expect(car.steerLeft).toBeGreaterThan(0.4);
    expect(car.forward).toBeUndefined();
    expect(stickActions('heli', 0, 1).brake).toBeCloseTo(1, 5);
    expect(stickActions('passenger', 0, -1)).toEqual({});
    expect(stickActions('dead', 0, -1)).toEqual({});
    expect(stickShown('foot') && stickShown('car') && stickShown('heli')).toBe(true);
    expect(stickShown('passenger') || stickShown('dead') || stickShown('none')).toBe(false);
  });
});

describe('only the controls that matter are shown', () => {
  const layout = defaultLayout();
  it('on foot: weapons and movement; Use only near something; zoom only scoped; no aim with the knife', () => {
    const foot = visibleControls({ scope: 'foot' }, layout);
    for (const id of ['fire', 'aim', 'jump', 'crouch', 'reload', 'knife', 'secondary', 'primary', 'grenade', 'binoculars', 'menu', 'scoreboard', 'chat', 'store'] as const) expect(foot.has(id), id).toBe(true);
    for (const id of ['use', 'zoom', 'handbrake', 'climb', 'exit', 'spectate', 'custom1', 'custom2'] as const) expect(foot.has(id), id).toBe(false);
    expect(visibleControls({ scope: 'foot', use: true }, layout).has('use')).toBe(true);
    expect(visibleControls({ scope: 'foot', scoped: true }, layout).has('zoom')).toBe(true);
    const knife = visibleControls({ scope: 'foot', melee: true }, layout);
    expect(knife.has('aim') || knife.has('reload')).toBe(false);
  });

  it('vehicle controls replace the on-foot ones while seated', () => {
    expect(ids(contextControls({ scope: 'car' }))).toEqual(['chat', 'exit', 'handbrake', 'menu', 'scoreboard', 'store', 'view']);
    const scooter = contextControls({ scope: 'car', scooter: true });
    expect(scooter.has('fire') && scooter.has('reload') && scooter.has('secondary') && scooter.has('primary')).toBe(true);
    // One hand on the bars: no aiming down sights, knife, grenade or jumping.
    for (const id of ['aim', 'knife', 'grenade', 'jump', 'crouch'] as const) expect(scooter.has(id), id).toBe(false);
    expect(ids(contextControls({ scope: 'heli' }))).toEqual(['chat', 'climb', 'descend', 'exit', 'menu', 'scoreboard', 'store', 'view']);
    const passenger = contextControls({ scope: 'passenger' });
    expect(passenger.has('fire') && passenger.has('aim') && passenger.has('exit')).toBe(true);
    expect(passenger.has('jump') || passenger.has('handbrake')).toBe(false);
  });

  it('dead: the next-player button when someone is left; nothing while the store, menu or chat is open', () => {
    expect(contextControls({ scope: 'dead', canSpectate: true }).has('spectate')).toBe(true);
    expect(contextControls({ scope: 'dead' }).has('spectate')).toBe(false);
    expect(contextControls({ scope: 'dead' }).has('fire')).toBe(false);
    expect(visibleControls({ scope: 'none' }, layout).size).toBe(0);
  });

  it('hidden controls stay hidden; custom slots show where their action works', () => {
    let l = edit(layout, 'binoculars', { hidden: true });
    expect(visibleControls({ scope: 'foot' }, l).has('binoculars')).toBe(false);
    l = edit(edit(l, 'custom1', { hidden: false }), 'custom1', { action: 'handbrake' });
    expect(visibleControls({ scope: 'foot' }, l).has('custom1')).toBe(false);
    expect(visibleControls({ scope: 'car' }, l).has('custom1')).toBe(true);
    expect(visibleControls({ scope: 'dead', canSpectate: true }, l).has('custom1')).toBe(false);
  });
});

describe('the touch layout', () => {
  it('defaults: every control on screen, custom slots hidden', () => {
    const l = defaultLayout();
    for (const id of PLACE_IDS) {
      const p = l.controls[id];
      expect(p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1, id).toBe(true);
      expect(p.hidden, id).toBe(id === 'custom1' || id === 'custom2');
    }
    expect(serializeLayout(l)).toBe(JSON.stringify({ v: TOUCH_VERSION, controls: {} }));
  });

  it('saves only changes and reads them back', () => {
    let l = moveTo(defaultLayout(), 'fire', 0.7, 0.5);
    l = edit(l, 'jump', { size: 1.4 });
    l = edit(l, 'binoculars', { hidden: true });
    l = edit(edit(l, 'custom2', { hidden: false }), 'custom2', { action: 'grenade' });
    l = withOptions(l, { opacity: 0.8, leftHanded: true });
    const raw = serializeLayout(l);
    expect(JSON.parse(raw)).toEqual({
      v: TOUCH_VERSION, opacity: 0.8, leftHanded: true,
      controls: { fire: { x: 0.7, y: 0.5 }, jump: { size: 1.4 }, binoculars: { hidden: true }, custom2: { hidden: false, action: 'grenade' } },
    });
    expect(parseLayout(raw)).toEqual(l);
  });

  it('a later change to a default reaches players who left that control alone', () => {
    const raw = serializeLayout(moveTo(defaultLayout(), 'fire', 0.7, 0.5));
    const newDefaults = moveTo(defaultLayout(), 'jump', 0.9, 0.3);
    const l = parseLayout(raw, newDefaults);
    expect([l.controls.fire.x, l.controls.fire.y]).toEqual([0.7, 0.5]);
    expect([l.controls.jump.x, l.controls.jump.y]).toEqual([0.9, 0.3]);
  });

  it('drops junk and clamps out-of-range values', () => {
    const d = defaultLayout();
    for (const raw of [null, '', 'not json', '[]', '42', '{"v":1}', '{"controls":7}']) expect(parseLayout(raw), String(raw)).toEqual(d);
    const l = parseLayout(JSON.stringify({ v: 1, opacity: 9, controls: {
      fire: { x: -3, y: 4, size: 99 }, nope: { x: 0.5 }, jump: { size: 'big', hidden: 'yes' }, stick: { hidden: true }, aim: { action: 'fire' }, custom1: { action: 'leave' },
    } }));
    expect(l.opacity).toBe(1);
    expect(l.controls.fire.x).toBeGreaterThan(0);
    expect(l.controls.fire.y).toBeLessThan(1);
    expect(l.controls.fire.size).toBe(SIZE_RANGE[1]);
    expect(l.controls.jump).toEqual(d.controls.jump);
    expect(l.controls.stick.hidden).toBe(false);
    expect(l.controls.aim.action).toBeUndefined();
    expect(l.controls.custom1.action).toBe(CONTROLS.custom1.action);
  });

  it('migrates older versions and ignores newer ones', () => {
    // A future v2 might rename a control; its migration step runs on v1 data.
    const v1 = JSON.stringify({ v: 1, controls: { oldFire: { x: 0.6 } } });
    const rename = (data: Record<string, unknown>) => {
      const controls = { ...(data.controls as Record<string, unknown>) };
      controls.fire = controls.oldFire; delete controls.oldFire;
      return { ...data, v: 2, controls };
    };
    expect(parseLayout(v1, defaultLayout(), [rename]).controls.fire.x).toBe(0.6);
    expect(parseLayout(v1).controls.fire.x).toBe(CONTROLS.fire.x);
    expect(parseLayout(JSON.stringify({ v: TOUCH_VERSION + 5, controls: { fire: { x: 0.2 } } }))).toEqual(defaultLayout());
  });

  it('the left-handed preset mirrors what is drawn and keeps moves consistent', () => {
    const lefty = withOptions(defaultLayout(), { leftHanded: true });
    expect(placeOf(lefty, 'fire').x).toBeCloseTo(1 - CONTROLS.fire.x, 6);
    expect(placeOf(lefty, 'stick').x).toBeGreaterThan(0.5);
    // Dragging fire to x = 0.2 on screen while left-handed stores the right-handed spot 0.8 …
    const moved = moveTo(lefty, 'fire', 0.2, 0.5);
    expect(moved.controls.fire.x).toBeCloseTo(0.8, 6);
    expect(placeOf(moved, 'fire').x).toBeCloseTo(0.2, 6);
    // … so switching back puts it on the other side.
    expect(placeOf(withOptions(moved, { leftHanded: false }), 'fire').x).toBeCloseTo(0.8, 6);
  });

  it('sizes stay in range and the stick cannot be hidden', () => {
    const l = defaultLayout();
    expect(edit(l, 'fire', { size: 5 }).controls.fire.size).toBe(SIZE_RANGE[1]);
    expect(edit(l, 'fire', { size: 0.1 }).controls.fire.size).toBe(SIZE_RANGE[0]);
    expect(edit(l, 'stick', { hidden: true }).controls.stick.hidden).toBe(false);
    expect(moveTo(l, 'fire', 2, -1).controls.fire.x).toBeLessThan(1);
    // Editing returns a new layout: the old one is untouched.
    edit(l, 'fire', { size: 1.5 });
    expect(l.controls.fire.size).toBe(1);
  });
});

describe('finger look speed', () => {
  /** A swipe across a whole landscape screen this wide, in degrees, at a touch speed. */
  const swipe = (width: number, sens: number) => width * TOUCH_LOOK_DEG_PER_PX * sens;

  it('the default turns about 270° across the smallest phone, faster than the old defaults', () => {
    expect(swipe(667, TOUCH_SENS_DEFAULT)).toBeGreaterThan(260);
    expect(swipe(667, TOUCH_SENS_DEFAULT)).toBeLessThan(280);
    expect(swipe(844, TOUCH_SENS_DEFAULT)).toBeCloseTo(340.5, 0);
    // The old defaults: 1.00× (135° across an iPhone SE, 170° across an iPhone 14) and 1.35× (180°).
    expect(swipe(667, 1)).toBeCloseTo(134.5, 0);
    expect(swipe(844, 1)).toBeCloseTo(170.2, 0);
    expect(swipe(667, 1.35)).toBeCloseTo(181.6, 0);
    // The range keeps room on both sides of the default: 4× faster, nearly 7× slower.
    expect(TOUCH_SENS_RANGE[1] / TOUCH_SENS_DEFAULT).toBeGreaterThanOrEqual(4);
    expect(TOUCH_SENS_DEFAULT / TOUCH_SENS_RANGE[0]).toBeGreaterThan(6);
  });

  it('the slider is logarithmic: the ends, the default a little right of centre, and its old values', () => {
    expect(touchSensToSlider(TOUCH_SENS_RANGE[0])).toBe(0);
    expect(touchSensToSlider(TOUCH_SENS_RANGE[1])).toBe(TOUCH_SENS_STEPS);
    expect(touchSensFromSlider(0)).toBe(TOUCH_SENS_RANGE[0]);
    expect(touchSensFromSlider(TOUCH_SENS_STEPS)).toBe(TOUCH_SENS_RANGE[1]);
    const middle = touchSensToSlider(TOUCH_SENS_DEFAULT) / TOUCH_SENS_STEPS;
    expect(middle).toBeGreaterThan(0.5);
    expect(middle).toBeLessThan(0.65);
    expect(touchSensFromSlider(touchSensToSlider(TOUCH_SENS_DEFAULT))).toBe(TOUCH_SENS_DEFAULT);
    // Near the default snaps to it; saved speeds (the old defaults, the old maximum) survive a round trip.
    expect(touchSensFromSlider(touchSensToSlider(TOUCH_SENS_DEFAULT) + 4)).toBe(TOUCH_SENS_DEFAULT);
    for (const v of [0.5, 1, 1.35, 3, 4, 6]) expect(Math.abs(touchSensFromSlider(touchSensToSlider(v)) / v - 1)).toBeLessThan(0.005);
    // Every step moves the same proportion, and the speed only ever rises along the track.
    let last = 0;
    for (let p = 0; p <= TOUCH_SENS_STEPS; p += 10) { const v = touchSensFromSlider(p); expect(v).toBeGreaterThanOrEqual(last); last = v; }
    // Out-of-range positions and speeds are clamped.
    expect(touchSensFromSlider(-5)).toBe(TOUCH_SENS_RANGE[0]);
    expect(touchSensFromSlider(5000)).toBe(TOUCH_SENS_RANGE[1]);
    expect(touchSensToSlider(50)).toBe(TOUCH_SENS_STEPS);
  });

  it('nothing saved reads the new default; a saved speed is kept, even the old default', () => {
    expect(parseTouchSensitivity(null)).toBe(TOUCH_SENS_DEFAULT);
    expect(parseTouchSensitivity(undefined)).toBe(TOUCH_SENS_DEFAULT);
    expect(parseTouchSensitivity('')).toBe(TOUCH_SENS_DEFAULT);
    expect(parseTouchSensitivity('fast')).toBe(TOUCH_SENS_DEFAULT);
    expect(parseTouchSensitivity('0')).toBe(TOUCH_SENS_DEFAULT);
    expect(parseTouchSensitivity('-2')).toBe(TOUCH_SENS_DEFAULT);
    expect(parseTouchSensitivity('1')).toBe(1);
    expect(parseTouchSensitivity('0.65')).toBe(0.65);
    expect(parseTouchSensitivity('3')).toBe(3);
    // Out of range is clamped, not dropped.
    expect(parseTouchSensitivity('0.1')).toBe(TOUCH_SENS_RANGE[0]);
    expect(parseTouchSensitivity('9')).toBe(TOUCH_SENS_RANGE[1]);
  });

  it('reads the saved value, saves only what the player sets, and keeps hold-to-aim on by default', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } });
    try {
      expect(touchSensitivity()).toBe(TOUCH_SENS_DEFAULT);
      // Reading the default saves nothing, so a later change of default reaches this player too.
      expect(data.size).toBe(0);
      data.set('lawbreaker.touchSens', '1');
      expect(touchSensitivity()).toBe(1);
      setTouchSensitivity(2.2);
      expect(data.get('lawbreaker.touchSens')).toBe('2.2');
      expect(touchSensitivity()).toBe(2.2);
      expect(touchAutoAim()).toBe(true);
      setTouchAutoAim(false);
      expect(touchAutoAim()).toBe(false);
      setTouchAutoAim(true);
      expect(touchAutoAim()).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
});
