import { describe, expect, it } from 'vitest';
import { wrapAngle } from '../../shared/math';
import { RIDER_TWIST, riderTwist } from '../../shared/vehicles';
import { bodyFacing, riderPitch, stanceBlade } from './soldier';

describe('scooter riders stay on the bike', () => {
  it('a rider faces the bike whatever the aim does (the camera swinging round used to turn the whole body)', () => {
    for (const heading of [0, 1.57, -2.9]) {
      for (let k = 0; k <= 126; k++) {
        const aim = heading + k * 0.05; // the camera swung a full turn round the bike
        expect(bodyFacing({ yaw: aim, hips: heading })).toBe(heading);
        // Only the head turns toward the aim, and never far.
        expect(Math.abs(riderTwist(aim, heading))).toBeLessThanOrEqual(RIDER_TWIST);
      }
    }
    expect(RIDER_TWIST).toBeLessThanOrEqual(0.5);
  });

  it('a rider sits square to the bike: no bladed shooting turn, whatever the weapon', () => {
    for (const pistol of [true, false]) expect(stanceBlade({ sprint: false, hips: 1 }, pistol)).toBe(0);
    expect(stanceBlade({ sprint: false }, false)).toBeLessThan(0); // on foot the support shoulder still leads
  });

  it('a rider stays upright: the bend for the aim is capped, however steep the aim (a close wall or car used to fold the rider over)', () => {
    expect(riderPitch({ pitch: -1.2, hips: 0 })).toBe(-0.25);
    expect(riderPitch({ pitch: 0.9, hips: 0 })).toBe(0.25);
    expect(riderPitch({ pitch: -0.2, hips: 0 })).toBe(-0.2);
    expect(riderPitch({ pitch: -1.2 })).toBe(-1.2); // on foot the full aim pitch
  });

  it('a soldier on foot faces the aim', () => {
    expect(bodyFacing({ yaw: 2.3 })).toBe(2.3);
    expect(wrapAngle(bodyFacing({ yaw: -3 }) + 3)).toBe(0);
  });
});
