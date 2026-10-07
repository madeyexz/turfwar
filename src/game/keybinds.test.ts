import { afterEach, describe, expect, it } from 'vitest';
import {
  ACTIONS, ACTION_IDS, MAX_KEYS, RESERVED, VERSION, allConflicts, conflicts, defaultBindings, isDefault, keyLabel,
  overlaps, parse, problemWith, rebind, removeKey, resetAction, serialize, setLayout, type ActionId, type Bindings,
} from './keybinds';

const ok = (r: ReturnType<typeof rebind>) => { if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`); return r.bindings; };

describe('default key map', () => {
  const b = defaultBindings();

  it('binds every action, within the key limit, to keys it may use', () => {
    for (const a of ACTION_IDS) {
      expect(b[a].length, a).toBeGreaterThan(0);
      expect(b[a].length, a).toBeLessThanOrEqual(MAX_KEYS);
      expect(new Set(b[a]).size, a).toBe(b[a].length);
      for (const code of b[a]) expect(problemWith(a, code), `${a} ${code}`).toBeUndefined();
    }
  });

  it('has no clash inside a context', () => {
    expect(allConflicts(b)).toEqual([]);
  });

  it('shares keys between walking and driving only by design (separate contexts)', () => {
    const shared = new Map<string, ActionId[]>();
    for (const a of ACTION_IDS) for (const c of b[a]) shared.set(c, [...(shared.get(c) ?? []), a]);
    const multi = Object.fromEntries([...shared].filter(([, as]) => as.length > 1).map(([c, as]) => [c, as.sort()]));
    expect(multi).toEqual({
      KeyW: ['forward', 'throttle'], KeyS: ['back', 'brake'], KeyA: ['left', 'steerLeft'], KeyD: ['right', 'steerRight'],
      Space: ['climb', 'handbrake', 'jump'], KeyC: ['crouch', 'descend'], ControlLeft: ['crouch', 'descend'],
      KeyE: ['exitVehicle', 'storeNextTab', 'use'], KeyQ: ['lastWeapon', 'storePrevTab'],
    });
    for (const as of Object.values(multi)) for (const x of as) for (const y of as) if (x !== y) expect(overlaps(x, y), `${x} ${y}`).toBe(false);
  });

  it('keeps the game\'s old keys', () => {
    expect(b.forward).toEqual(['KeyW']); expect(b.jump).toEqual(['Space']); expect(b.crouch).toEqual(['KeyC', 'ControlLeft']);
    expect(b.sprint).toEqual(['ShiftLeft', 'ShiftRight']); expect(b.fire).toEqual(['Mouse0']); expect(b.aim).toEqual(['Mouse2']);
    expect(b.grenade).toEqual(['Digit4', 'KeyG']); expect(b.nextWeapon).toEqual(['WheelDown']); expect(b.store).toEqual(['KeyB']);
    expect(b.menu).toEqual(['KeyP']); expect(b.fullscreen).toEqual(['KeyF']); expect(b.leave).toEqual(['KeyM']);
  });

  it('numbers the weapons like the loadout: 1 primary, 2 secondary, 3 knife', () => {
    expect(b.primary).toEqual(['Digit1']); expect(b.secondary).toEqual(['Digit2']); expect(b.knife).toEqual(['Digit3']);
    expect(allConflicts(b)).toEqual([]);
  });

  it('reserves Esc everywhere, and the store\'s and menu\'s own keys there', () => {
    for (const a of ACTION_IDS) expect(problemWith(a, 'Escape'), a).toBe('escape');
    expect(RESERVED.MetaLeft).toBe('os');
    expect(problemWith('jump', 'CapsLock')).toBe('capslock');
    expect(problemWith('store', 'Digit5')).toBe('store');
    expect(problemWith('storeNextTab', 'Space')).toBe('store');
    expect(problemWith('reload', 'Digit5')).toBeUndefined();
    expect(problemWith('menu', 'Mouse0')).toBe('menu');
    expect(problemWith('jump', 'WheelUp')).toBe('wheel');
    expect(problemWith('fullscreen', 'WheelUp')).toBe('wheel');
    expect(problemWith('reload', 'WheelUp')).toBeUndefined();
    expect(problemWith('jump', 'Mouse3')).toBeUndefined();
    expect(problemWith('jump', 'not a key!')).toBe('invalid');
  });
});

describe('rebinding', () => {
  it('rebinds a free key', () => {
    const b = ok(rebind(defaultBindings(), 'reload', 0, 'KeyH'));
    expect(b.reload).toEqual(['KeyH']);
    expect(isDefault(b, 'reload')).toBe(false);
    expect(allConflicts(b)).toEqual([]);
  });

  it('adds and removes a second key', () => {
    let b = ok(rebind(defaultBindings(), 'reload', 1, 'Mouse3'));
    expect(b.reload).toEqual(['KeyR', 'Mouse3']);
    b = removeKey(b, 'reload', 1);
    expect(b.reload).toEqual(['KeyR']);
    // The primary always stays.
    expect(removeKey(b, 'reload', 0).reload).toEqual(['KeyR']);
  });

  it('lets a vehicle action take a walking key without a clash', () => {
    const b = ok(rebind(defaultBindings(), 'vehicleView', 0, 'KeyZ'));
    expect(b.vehicleView).toEqual(['KeyZ']);
    expect(b.binoculars).toEqual(['KeyZ']);
  });

  it('reports a clash in the same context and offers a swap', () => {
    const before = defaultBindings();
    const r = rebind(before, 'reload', 0, 'KeyT');
    expect(r.kind).toBe('conflict');
    if (r.kind !== 'conflict') return;
    expect(r.with).toEqual(['teamChat']);
    expect(r.gives).toBe('KeyR');
    expect(r.swap!.reload).toEqual(['KeyT']);
    expect(r.swap!.teamChat).toEqual(['KeyR']);
    expect(allConflicts(r.swap!)).toEqual([]);
    // Nothing changed until the swap is kept.
    expect(before.reload).toEqual(['KeyR']);
  });

  it('swaps with every clashing action at once', () => {
    // E is "use" on foot and "get out" in vehicles; the store key works everywhere, so it clashes with both.
    const r = rebind(defaultBindings(), 'store', 0, 'KeyE');
    if (r.kind !== 'conflict') throw new Error('expected a clash');
    expect(r.with.sort()).toEqual(['exitVehicle', 'storeNextTab', 'use']);
    expect(r.swap!.use).toEqual(['KeyB']); expect(r.swap!.exitVehicle).toEqual(['KeyB']); expect(r.swap!.storeNextTab).toEqual(['KeyB']);
    expect(allConflicts(r.swap!)).toEqual([]);
  });

  it('never strands an action: a clash with no key to give back offers no swap', () => {
    const r = rebind(defaultBindings(), 'crouch', 1, 'Space'); // replacing L-Ctrl gives jump L-Ctrl
    if (r.kind !== 'conflict') throw new Error('expected a clash');
    expect(r.swap!.jump).toEqual(['ControlLeft']);
    // Adding a second key that is another action's only key: that action would be left with nothing.
    let b = removeKey(defaultBindings(), 'crouch', 1);
    const added = rebind(b, 'crouch', 1, 'Space');
    if (added.kind !== 'conflict') throw new Error('expected a clash');
    expect(added.swap).toBeUndefined();
    expect(added.why).toBe('stranded');
    // Jump to the menu key: the menu cannot take Space back (the menu keeps Space, and drivers use it).
    const menu = rebind(defaultBindings(), 'jump', 0, 'KeyP');
    if (menu.kind !== 'conflict') throw new Error('expected a clash');
    expect(menu.swap).toBeUndefined();
    expect(menu.why).toBe('clash');
    // …but taking one of two keys is fine: the other action keeps its other key.
    b = defaultBindings();
    const sprint = rebind(removeKey(b, 'reload', 1), 'reload', 1, 'ShiftRight');
    if (sprint.kind !== 'conflict') throw new Error('expected a clash');
    expect(sprint.swap!.sprint).toEqual(['ShiftLeft']);
    expect(sprint.swap!.reload).toEqual(['KeyR', 'ShiftRight']);
  });

  it('refuses reserved keys and the wheel for held actions', () => {
    expect(rebind(defaultBindings(), 'jump', 0, 'Escape')).toEqual({ kind: 'problem', problem: 'escape' });
    expect(rebind(defaultBindings(), 'forward', 0, 'WheelUp')).toEqual({ kind: 'problem', problem: 'wheel' });
    // Single presses may use the wheel (here it clashes with the previous-weapon wheel, which is fine to report).
    expect(rebind(defaultBindings(), 'grenade', 0, 'WheelUp').kind).toBe('conflict');
    expect(ok(rebind(removeKey(defaultBindings(), 'grenade', 1), 'lastWeapon', 0, 'Mouse4')).lastWeapon).toEqual(['Mouse4']);
  });

  it('moves a key between an action\'s own slots', () => {
    const b = ok(rebind(defaultBindings(), 'crouch', 0, 'ControlLeft'));
    expect(b.crouch).toEqual(['ControlLeft', 'KeyC']);
    expect(ok(rebind(defaultBindings(), 'jump', 1, 'Space')).jump).toEqual(['Space']);
  });
});

describe('reset', () => {
  it('resets one action and gives a clashing action the key it gave up', () => {
    let b = ok(rebind(defaultBindings(), 'reload', 0, 'KeyH'));
    b = ok(rebind(b, 'teamChat', 0, 'KeyR'));
    const r = resetAction(b, 'reload');
    expect(r.reload).toEqual(['KeyR']);
    expect(r.teamChat).toEqual(['KeyH']);
    expect(allConflicts(r)).toEqual([]);
  });

  it('puts a second default key back', () => {
    const b = removeKey(defaultBindings(), 'grenade', 1);
    expect(resetAction(b, 'grenade').grenade).toEqual(['Digit4', 'KeyG']);
  });

  it('resets everything', () => {
    const b = defaultBindings();
    for (const a of ACTION_IDS) expect(isDefault(b, a), a).toBe(true);
  });
});

describe('saving', () => {
  it('saves only what the player changed, versioned', () => {
    const b = ok(rebind(defaultBindings(), 'reload', 0, 'KeyH'));
    expect(JSON.parse(serialize(b))).toEqual({ v: VERSION, keys: { reload: ['KeyH'] } });
    expect(parse(serialize(b))).toEqual(b);
  });

  it('falls back to the defaults on missing or broken data', () => {
    for (const raw of [null, '', '{', '"x"', '[]', '{"v":1}', '{"v":1,"keys":3}']) expect(parse(raw), String(raw)).toEqual(defaultBindings());
  });

  it('drops unknown actions, invalid and reserved keys', () => {
    const b = parse(JSON.stringify({ v: 1, keys: { reload: ['Escape', 'KeyH', 'KeyH', 7, 'KeyJ', 'KeyK'], dance: ['KeyL'], jump: ['Escape'] } }));
    expect(b.reload).toEqual(['KeyH', 'KeyJ']);
    expect(b.jump).toEqual(['Space']);
    expect('dance' in b).toBe(false);
  });

  it('merges a changed default for actions the player left alone', () => {
    const saved = serialize(ok(rebind(defaultBindings(), 'reload', 0, 'KeyH')));
    // A later version changes the binoculars' default from Z to N.
    const next: Bindings = { ...defaultBindings(), binoculars: ['KeyN'] };
    const b = parse(saved, next);
    expect(b.reload).toEqual(['KeyH']);
    expect(b.binoculars).toEqual(['KeyN']);
  });

  it('lets a saved key win over a new default that would clash with it', () => {
    const saved = serialize(ok(rebind(defaultBindings(), 'reload', 0, 'KeyN')));
    const next: Bindings = { ...defaultBindings(), binoculars: ['KeyN', 'KeyZ'] };
    const b = parse(saved, next);
    expect(b.reload).toEqual(['KeyN']);
    expect(b.binoculars).toEqual(['KeyZ']);
    expect(allConflicts(b)).toEqual([]);
  });

  it('runs migrations from older versions', () => {
    // A hypothetical v1 → v2 step that renamed "oldReload" to "reload": saves from v1 run it.
    const migrations = [(keys: Record<string, unknown>) => ({ ...keys, reload: keys.oldReload })];
    const b = parse(JSON.stringify({ v: 1, keys: { oldReload: ['KeyH'] } }), defaultBindings(), migrations);
    expect(b.reload).toEqual(['KeyH']);
    // Already at the last version: no migration runs.
    expect(parse(JSON.stringify({ v: 2, keys: { oldReload: ['KeyH'] } }), defaultBindings(), migrations).reload).toEqual(['KeyR']);
  });
});

describe('labels', () => {
  afterEach(() => setLayout(undefined));

  it('names keys, mouse buttons and the wheel', () => {
    expect(keyLabel('KeyQ')).toBe('Q');
    expect(keyLabel('Digit4')).toBe('4');
    expect(keyLabel('Space')).toBe('Space');
    expect(keyLabel('ShiftLeft')).toBe('L-Shift');
    expect(keyLabel('ControlLeft')).toBe('L-Ctrl');
    expect(keyLabel('Mouse0')).toBe('LMB');
    expect(keyLabel('Mouse3')).toBe('Mouse 4');
    expect(keyLabel('WheelUp')).toBe('Wheel ↑');
    expect(keyLabel('WheelDown')).toBe('Wheel ↓');
    expect(keyLabel('Numpad7')).toBe('Num 7');
    expect(keyLabel('Mouse2', { Mouse2: '右鍵' })).toBe('右鍵');
  });

  it('follows the keyboard layout for letters and punctuation', () => {
    // AZERTY: the key in QWERTY's Q position prints A; its digit row keeps the digit.
    setLayout(new Map([['KeyQ', 'a'], ['KeyW', 'z'], ['Digit1', '&'], ['Semicolon', 'm']]));
    expect(keyLabel('KeyQ')).toBe('A');
    expect(keyLabel('KeyW')).toBe('Z');
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('Semicolon')).toBe('M');
    expect(keyLabel('KeyE')).toBe('E');
  });
});

describe('contexts', () => {
  it('reads weapons on foot, on a scooter and in the back seat, but not in the helicopter', () => {
    expect(ACTIONS.fire.scopes).toEqual(['foot', 'car', 'passenger']);
    expect(overlaps('jump', 'handbrake')).toBe(false);
    expect(overlaps('reload', 'vehicleView')).toBe(true);
    expect(conflicts(defaultBindings(), 'vehicleView', 'KeyR')).toEqual(['reload']);
  });
});
