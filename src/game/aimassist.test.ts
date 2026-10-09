import { describe, expect, it } from 'vitest';
import { ASSIST, aimAssist, anglesTo } from './aimassist';

const eye = { x: 0, y: 1.6, z: 0 };
// Straight ahead is −z at yaw 0.
const ahead = (deg: number, dist = 20) => ({ x: -Math.sin(deg * Math.PI / 180) * dist, y: 1.6, z: -Math.cos(deg * Math.PI / 180) * dist });

describe('touch aim assist', () => {
  it('measures angles in the game convention', () => {
    const a = anglesTo(eye, ahead(10));
    expect(a.yaw).toBeCloseTo(10 * Math.PI / 180, 5);
    expect(a.pitch).toBeCloseTo(0, 5);
  });

  it('does nothing without a target near the crosshair', () => {
    expect(aimAssist({ eye, yaw: 0, pitch: 0, targets: [], firing: true, dt: 1 / 60 })).toEqual({ lookScale: 1, yaw: 0, pitch: 0 });
    expect(aimAssist({ eye, yaw: 0, pitch: 0, targets: [ahead(20)], firing: true, dt: 1 / 60 }).lookScale).toBe(1);
    expect(aimAssist({ eye, yaw: 0, pitch: 0, targets: [ahead(1, ASSIST.range + 5)], firing: true, dt: 1 / 60 }).lookScale).toBe(1);
  });

  it('slows the crosshair more the closer it is to an enemy', () => {
    const near = aimAssist({ eye, yaw: 0, pitch: 0, targets: [ahead(1)], firing: false, dt: 1 / 60 });
    const edge = aimAssist({ eye, yaw: 0, pitch: 0, targets: [ahead(5)], firing: false, dt: 1 / 60 });
    expect(near.lookScale).toBeCloseTo(ASSIST.slow, 5);
    expect(edge.lookScale).toBeGreaterThan(near.lookScale);
    expect(edge.lookScale).toBeLessThan(1);
    // No pull without firing.
    expect(near.yaw).toBe(0);
  });

  it('while firing, pulls towards the enemy at a capped rate and never past it', () => {
    const dt = 1 / 60;
    const r = aimAssist({ eye, yaw: 0, pitch: 0, targets: [ahead(4)], firing: true, dt });
    expect(r.yaw).toBeGreaterThan(0);
    expect(r.yaw).toBeCloseTo(ASSIST.pullRate * dt, 5);
    const close = aimAssist({ eye, yaw: 0, pitch: 0, targets: [ahead(0.05)], firing: true, dt: 1 });
    expect(close.yaw).toBeCloseTo(0.05 * Math.PI / 180, 5);
  });

  it('narrows with the scope zoom so a scope does not snap', () => {
    const hip = aimAssist({ eye, yaw: 0, pitch: 0, targets: [ahead(3)], firing: true, dt: 1 / 60 });
    const scoped = aimAssist({ eye, yaw: 0, pitch: 0, targets: [ahead(3)], firing: true, dt: 1 / 60, zoom: 4 });
    expect(hip.yaw).toBeGreaterThan(0);
    expect(scoped).toEqual({ lookScale: 1, yaw: 0, pitch: 0 });
  });
});
