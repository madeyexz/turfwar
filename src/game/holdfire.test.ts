import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CollisionWorld, type Heightfield } from '../../shared/collision';
import { HOLD_AIM_MS, HoldFire, RELEASE_SHOT_MS, holdAimMode, type HoldAimCtx } from './holdfire';
import type { Input } from './input';
import { LocalPlayer } from './player';
import { settings } from './settings';
import { TOUCH_LOOK_SCALE } from './touchlayout';

const foot: HoldAimCtx = { scope: 'foot', melee: false, sniper: false, rider: false, binoculars: false, throwing: false };
const out = (fire: boolean, aim: boolean) => ({ fire, aim });

describe('what holding fire does with the weapon in hand', () => {
  it('raises the sights with guns on foot and in a back seat; snipers fire on release', () => {
    expect(holdAimMode(foot)).toBe('press');
    expect(holdAimMode({ ...foot, scope: 'passenger' })).toBe('press');
    expect(holdAimMode({ ...foot, sniper: true })).toBe('release');
  });

  it('is a plain trigger for the knife, binoculars, a throw, a toggled Aim and at any wheel', () => {
    expect(holdAimMode({ ...foot, melee: true })).toBe('none');
    expect(holdAimMode({ ...foot, binoculars: true })).toBe('none');
    expect(holdAimMode({ ...foot, throwing: true })).toBe('none');
    expect(holdAimMode({ ...foot, aimToggled: true })).toBe('none');
    // A scooter rider shoots one-handed: no aiming (the player refuses it too).
    expect(holdAimMode({ ...foot, scope: 'car', rider: true })).toBe('none');
    expect(holdAimMode({ ...foot, scope: 'car' })).toBe('none');
    expect(holdAimMode({ ...foot, scope: 'heli' })).toBe('none');
    expect(holdAimMode({ ...foot, scope: 'dead' })).toBe('none');
    expect(holdAimMode({ ...foot, scope: 'none' })).toBe('none');
  });
});

describe('hold fire to aim (guns: fire on press)', () => {
  it('a tap fires from the hip at once and never raises the sights', () => {
    const h = new HoldFire();
    h.press(0, 'press', 0);
    expect(h.frame(16, 'press', 0, 0)).toEqual(out(true, false));
    expect(h.frame(100, 'press', 0, 1)).toEqual(out(true, false));
    h.release(110, 'press', 0, 1);
    expect(h.frame(120, 'press', 0, 1)).toEqual(out(false, false));
    expect(h.active).toBe(false);
  });

  it('a tap between two frames still fires once', () => {
    const h = new HoldFire();
    h.press(0, 'press', 0);
    h.release(10, 'press', 0, 0);
    expect(h.frame(16, 'press', 0, 0)).toEqual(out(true, false));
    expect(h.frame(33, 'press', 0, 1)).toEqual(out(false, false));
  });

  it('a hold keeps firing, raises the sights after the hold time, and the release lowers them', () => {
    const h = new HoldFire();
    h.press(0, 'press', 0);
    expect(h.frame(HOLD_AIM_MS - 1, 'press', 0, 2)).toEqual(out(true, false));
    expect(h.frame(HOLD_AIM_MS, 'press', 0, 3)).toEqual(out(true, true));
    expect(h.frame(900, 'press', 0, 9)).toEqual(out(true, true));
    h.release(950, 'press', 0, 9);
    expect(h.frame(960, 'press', 0, 9)).toEqual(out(false, false));
  });

  it('switching weapons mid-hold stops both until the finger lifts', () => {
    const h = new HoldFire();
    h.press(0, 'press', 0);
    expect(h.frame(300, 'press', 0, 4)).toEqual(out(true, true));
    expect(h.frame(316, 'press', 1, 4)).toEqual(out(false, false));
    expect(h.frame(600, 'press', 1, 4)).toEqual(out(false, false));
    h.release(700, 'press', 1, 4);
    expect(h.frame(716, 'press', 1, 4)).toEqual(out(false, false));
    // The next press works as usual.
    h.press(800, 'press', 1);
    expect(h.frame(816, 'press', 1, 4)).toEqual(out(true, false));
  });

  it('a grenade or binoculars mid-hold drop the sights, which come back after', () => {
    const h = new HoldFire();
    h.press(0, 'press', 0);
    expect(h.frame(200, 'press', 0, 2)).toEqual(out(true, true));
    expect(h.frame(216, 'none', 0, 2)).toEqual(out(true, false));
    expect(h.frame(600, 'press', 0, 2)).toEqual(out(true, true));
  });

  it('the knife (and the scooter, binoculars…) is a plain trigger: fire while held, no aim', () => {
    const h = new HoldFire();
    h.press(0, 'none', 2);
    expect(h.frame(16, 'none', 2, 0)).toEqual(out(true, false));
    expect(h.frame(1000, 'none', 2, 0)).toEqual(out(true, false));
    h.release(1100, 'none', 2, 0);
    expect(h.frame(1116, 'none', 2, 0)).toEqual(out(false, false));
  });
});

describe('hold fire to aim (sniper: fire on release)', () => {
  it('holding raises the scope without shooting; the release fires one aimed shot, then lowers it', () => {
    const h = new HoldFire();
    h.press(0, 'release', 0);
    expect(h.frame(50, 'release', 0, 0)).toEqual(out(false, false));
    expect(h.frame(HOLD_AIM_MS + 50, 'release', 0, 0)).toEqual(out(false, true));
    h.release(700, 'release', 0, 0);
    expect(h.frame(716, 'release', 0, 0)).toEqual(out(true, true));
    // The shot went off: let go of both.
    expect(h.frame(733, 'release', 0, 1)).toEqual(out(false, false));
    expect(h.active).toBe(false);
  });

  it('the release shot waits for the bolt, but not forever', () => {
    const h = new HoldFire();
    h.press(0, 'release', 0);
    h.release(400, 'release', 0, 3);
    expect(h.frame(416, 'release', 0, 3)).toEqual(out(true, true));
    expect(h.frame(400 + RELEASE_SHOT_MS, 'release', 0, 3)).toEqual(out(true, true));
    expect(h.frame(401 + RELEASE_SHOT_MS, 'release', 0, 3)).toEqual(out(false, false));
  });

  it('a quick tap fires from the hip on the release', () => {
    const h = new HoldFire();
    h.press(0, 'release', 0);
    expect(h.frame(16, 'release', 0, 0)).toEqual(out(false, false));
    h.release(80, 'release', 0, 0);
    expect(h.frame(96, 'release', 0, 0)).toEqual(out(true, false));
    expect(h.frame(112, 'release', 0, 1)).toEqual(out(false, false));
  });

  it('switching weapons mid-hold cancels the shot', () => {
    const h = new HoldFire();
    h.press(0, 'release', 0);
    expect(h.frame(300, 'release', 0, 0)).toEqual(out(false, true));
    expect(h.frame(316, 'press', 1, 0)).toEqual(out(false, false));
    h.release(400, 'press', 1, 0);
    expect(h.frame(416, 'press', 1, 0)).toEqual(out(false, false));
  });

  it('letting go while the binoculars are up or a grenade is out does not shoot', () => {
    const h = new HoldFire();
    h.press(0, 'release', 0);
    h.release(300, 'none', 0, 0);
    expect(h.frame(316, 'none', 0, 0)).toEqual(out(false, false));
    expect(h.frame(332, 'release', 0, 0)).toEqual(out(false, false));
  });

  it('reset lets go of a hold and a pending shot', () => {
    const h = new HoldFire();
    h.press(0, 'release', 0);
    h.release(300, 'release', 0, 0);
    h.reset();
    expect(h.frame(316, 'release', 0, 0)).toEqual(out(false, false));
  });
});

describe('finger look while aiming', () => {
  const flat: Heightfield = { x0: -100, z0: -100, spacing: 4, n: 51, heights: new Float32Array(51 * 51) };
  const world = new CollisionWorld([], [], flat, { minX: -90, maxX: 90, minZ: -90, maxZ: 90 });
  // Input reads the page's URL as it loads (the dev-only ?debuginput flag).
  let proto: typeof Input.prototype;
  beforeAll(async () => { vi.stubGlobal('location', { search: '' }); proto = (await import('./input')).Input.prototype; });
  /** A touch-driven input without the DOM: Input's own look maths, nothing held but (maybe) aim. */
  const fakeInput = (aim: boolean, mouseSens: number) => {
    const i = { lookX: 0, lookY: 0, sensitivity: mouseSens, down: (a: string) => aim && a === 'aim', amount: () => 0, take: () => false, fire: false, aim };
    return Object.assign(i, { touchLook: proto.touchLook, consumeLook: proto.consumeLook }) as unknown as Input;
  };
  /** Yaw turned by a 100 px drag at 1.00× touch speed, with the sights fully up (or not). */
  const turn = (weapon: 'mp5' | 'm110', aimed: boolean, mouseSens = 1) => {
    const p = new LocalPlayer();
    p.alive = true;
    p.weapons = [weapon, 'm9a1'];
    p.ads = aimed ? 1 : 0;
    const input = fakeInput(aimed, mouseSens);
    input.touchLook(100, 0, TOUCH_LOOK_SCALE);
    const before = p.yaw;
    p.update(1e-4, input, world, true, true);
    return before - p.yaw;
  };

  it('a drag turns the same whatever the mouse sensitivity', () => {
    expect(turn('mp5', false, 0.5)).toBeCloseTo(turn('mp5', false, 2), 9);
    expect(turn('mp5', false)).toBeCloseTo(100 * 0.0022 * TOUCH_LOOK_SCALE, 9);
  });

  it('scales with the zoom like the mouse (zoom-matched), scoped snipers the most', () => {
    const DEG = Math.PI / 180, hip = turn('m110', false);
    const p = new LocalPlayer(); p.weapons = ['m110', 'm9a1']; p.ads = 1;
    const matched = Math.tan(p.sightFov * DEG / 2) / Math.tan(settings.fov * DEG / 2);
    expect(turn('m110', true) / hip).toBeCloseTo(matched * settings.adsSensitivity, 3);
    expect(turn('m110', true)).toBeLessThan(turn('mp5', true));
    expect(turn('mp5', true)).toBeLessThan(turn('mp5', false));
  });
});
