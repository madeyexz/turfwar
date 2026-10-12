import { describe, expect, it } from 'vitest';
import { wrapAngle } from '../../shared/math';
import { RIDER_TWIST, riderTwist } from '../../shared/vehicles';
import { bodyFacing } from './soldier';

describe('scooter riders stay on the bike', () => {
  it('a rider faces the bike whatever the aim does (the camera swinging round used to turn the whole body)', () => {
    for (const heading of [0, 1.57, -2.9]) {
      for (let k = 0; k <= 126; k++) {
        const aim = heading + k * 0.05; // the camera swung a full turn round the bike
        expect(bodyFacing({ yaw: aim, hips: heading })).toBe(heading);
        // Only the upper body turns toward the aim, and never far.
        expect(Math.abs(riderTwist(aim, heading))).toBeLessThanOrEqual(RIDER_TWIST);
      }
    }
    expect(RIDER_TWIST).toBeLessThanOrEqual(0.5);
  });

  it('a soldier on foot faces the aim', () => {
    expect(bodyFacing({ yaw: 2.3 })).toBe(2.3);
    expect(wrapAngle(bodyFacing({ yaw: -3 }) + 3)).toBe(0);
  });
});
