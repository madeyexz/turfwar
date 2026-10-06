import type { TouchScope } from './touchlayout';

/**
 * Hold fire to aim (touch): one thumb on the fire button raises the sights as well as shooting, so a
 * phone player gets aimed shots without a second finger on Aim. Pure state, so it is tested without a
 * browser; `ui/touchcontrols.ts` feeds it the fire button's presses and releases and writes what it
 * returns (fire, aim) into the held actions every frame.
 *
 * What a hold does depends on the weapon in hand (`HoldAim`):
 * - `press` (automatic and semi-automatic guns but the sniper): the press fires at once from the hip; a
 *   hold past `HOLD_AIM_MS` raises the sights while it keeps firing; the release stops and lowers them.
 *   A quick tap is a hip shot with no delay, which is what a pistol or shotgun wants up close.
 * - `release` (the M110 sniper): pressing does not shoot. A hold past `HOLD_AIM_MS` raises the scope;
 *   dragging the same thumb aims; letting go fires one aimed shot and lowers the scope. A quick tap
 *   (released before the scope starts up) fires from the hip on the release. Firing on the press would
 *   waste the shot from the hip (hip spread 90 against 98 scoped, and a 0.6 s bolt) before the scope is up.
 * - `none`: a plain trigger, as before: the knife, binoculars, a grenade in the throw, a scooter rider
 *   (one hand on the bars: no aiming) and anyone who already toggled Aim on.
 */
export type HoldAim = 'none' | 'press' | 'release';

/** A hold this long (ms) raises the sights; anything shorter is a tap from the hip. */
export const HOLD_AIM_MS = 150;
/** A sniper's release shot waits at most this long (ms) for the weapon to be ready (bolt, switch, reload). */
export const RELEASE_SHOT_MS = 500;

export interface HoldAimCtx {
  scope: TouchScope;
  /** The knife is in hand. */
  melee: boolean;
  /** A scoped precision rifle (fires on release). */
  sniper: boolean;
  /** At a scooter's handlebars: one-handed, no aiming. */
  rider: boolean;
  binoculars: boolean;
  /** A grenade is on its way out of the hand. */
  throwing: boolean;
  /** The Aim button is toggled on: the sights are already up. */
  aimToggled?: boolean;
}

/** What holding fire does right now. Only on foot or in a back seat; never at a wheel. */
export function holdAimMode(c: HoldAimCtx): HoldAim {
  if (c.scope !== 'foot' && c.scope !== 'passenger') return 'none';
  if (c.melee || c.rider || c.binoculars || c.throwing || c.aimToggled) return 'none';
  return c.sniper ? 'release' : 'press';
}

export interface HoldOut { fire: boolean; aim: boolean }
const NOTHING: HoldOut = { fire: false, aim: false };

type State =
  | { k: 'idle' }
  /** A finger is on fire: `mode` and `slot` as they were at the press. */
  | { k: 'held'; at: number; mode: HoldAim; slot: number; framed: boolean }
  /** A tap that came and went between two frames: fire for one frame. */
  | { k: 'pulse' }
  /** The weapon changed under the finger: nothing until it lifts. */
  | { k: 'spent' }
  /** A sniper's release: fire (aimed if the scope was up) until the shot goes or the wait runs out. */
  | { k: 'releasing'; at: number; aim: boolean; slot: number; shots: number };

export class HoldFire {
  private s: State = { k: 'idle' };

  /** Whether a hold (or a release shot) is in progress. */
  get active() { return this.s.k !== 'idle'; }

  /** The fire button went down. `mode` and `slot` are the weapon's now. */
  press(now: number, mode: HoldAim, slot: number) {
    this.s = { k: 'held', at: now, mode, slot, framed: false };
  }

  /** The last finger left the fire button. `shots` counts this player's shots so far. */
  release(now: number, mode: HoldAim, slot: number, shots: number) {
    const s = this.s;
    if (s.k !== 'held') { if (s.k === 'spent') this.s = { k: 'idle' }; return; }
    if (s.slot !== slot) { this.s = { k: 'idle' }; return; }
    if (s.mode === 'release') {
      // Whatever came up since (binoculars, a throw) cancels the shot.
      this.s = mode === 'release' ? { k: 'releasing', at: now, aim: now - s.at >= HOLD_AIM_MS, slot, shots } : { k: 'idle' };
      return;
    }
    // A tap shorter than a frame still fires once.
    this.s = s.framed ? { k: 'idle' } : { k: 'pulse' };
  }

  /** Once per frame: what to hold. `mode` and `slot` are the weapon's now; `shots` counts this player's shots. */
  frame(now: number, mode: HoldAim, slot: number, shots: number): HoldOut {
    const s = this.s;
    switch (s.k) {
      case 'idle': case 'spent': return NOTHING;
      case 'pulse': this.s = { k: 'idle' }; return { fire: true, aim: false };
      case 'releasing':
        if (shots > s.shots || slot !== s.slot || now - s.at > RELEASE_SHOT_MS || mode !== 'release') { this.s = { k: 'idle' }; return NOTHING; }
        return { fire: true, aim: s.aim };
      case 'held': {
        // Switching weapons mid-hold ends it: the new weapon neither fires nor aims until the finger lifts.
        if (slot !== s.slot) { this.s = { k: 'spent' }; return NOTHING; }
        s.framed = true;
        const long = now - s.at >= HOLD_AIM_MS;
        if (s.mode === 'none') return { fire: true, aim: false };
        // The sights drop while something else is up (binoculars, a throw) and come back after.
        const aim = long && mode !== 'none';
        return s.mode === 'press' ? { fire: true, aim } : { fire: false, aim };
      }
    }
  }

  /** Let go of everything (the match paused, the player died, the controls went away). */
  reset() { this.s = { k: 'idle' }; }
}
