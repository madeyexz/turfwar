import { describe, expect, it } from 'vitest';
import { throwOwner } from './bodies';

describe('whose thrown slipper an online body is', () => {
  const throws = [{ x: 0, z: 0 }, { x: 0, z: 20 }];
  it('takes the throw behind it on its line of flight, even seen far down its path', () => {
    expect(throwOwner({ x: 11, z: 0.4, vx: 15, vz: 0 }, throws)).toBe(0);
    expect(throwOwner({ x: 8, z: 28, vx: 10, vz: 10 }, throws)).toBe(1);
  });
  it('does not take a throw it is flying toward', () => {
    expect(throwOwner({ x: -6, z: 0, vx: 15, vz: 0 }, [{ x: 0, z: 0 }, { x: -12, z: 1 }])).toBe(1);
  });
  it('falls back to the nearest throw once it has bounced or come to rest, and gives up beyond 40 m', () => {
    expect(throwOwner({ x: 2, z: 15, vx: 0, vz: 0 }, throws)).toBe(1);
    expect(throwOwner({ x: 12, z: 3, vx: -4, vz: 9 }, throws)).toBe(0);
    expect(throwOwner({ x: 100, z: 0, vx: 0, vz: 0 }, throws)).toBe(-1);
    expect(throwOwner({ x: 1, z: 1, vx: 3, vz: 0 }, [])).toBe(-1);
  });
});
