import { describe, expect, it } from 'vitest';
import { defaultLaws, lawCommandSchema, parseLawCommand } from './laws';

describe('law commands', () => {
  it('accepts all defaults and discriminates each kind', () => {
    for (const kind of ['gravity', 'time', 'lightSpeed', 'rewind'] as const) {
      const command = { kind, [kind]: defaultLaws[kind] };
      expect(parseLawCommand(command)).toEqual(command);
    }
  });
  it.each([NaN, Infinity, -Infinity, '5', null, true, undefined])('rejects invalid number %s', value => {
    expect(lawCommandSchema.safeParse({ kind: 'rewind', rewind: { seconds: value } }).success).toBe(false);
  });
  it('rejects unknown keys at every level and wrong variants', () => {
    for (const value of [
      { kind: 'rewind', rewind: { seconds: 5 }, code: 'evil' },
      { kind: 'rewind', rewind: { seconds: 5, code: 'evil' } },
      { kind: 'gravity', gravity: { ...defaultLaws.gravity, direction: { x: 0, y: -1, z: 0, w: 1 } } },
      { kind: 'time', time: { mode: 'invalid', scale: 1 } },
      { kind: 'time', rewind: { seconds: 5 } },
    ]) expect(lawCommandSchema.safeParse(value).success).toBe(false);
  });
  it('clamps all numeric ranges without coercion', () => {
    expect(parseLawCommand({ kind: 'gravity', gravity: {
      mode: 'uniform', strength: -999, exponent: 999, direction: { x: -99, y: 99, z: 0 },
    } })).toEqual({ kind: 'gravity', gravity: {
      mode: 'uniform', strength: -200, exponent: 3, direction: { x: -1, y: 1, z: 0 },
    } });
    expect(parseLawCommand({ kind: 'time', time: { mode: 'playerMotion', scale: -1 } })).toEqual({ kind: 'time', time: { mode: 'playerMotion', scale: 0.05 } });
    expect(parseLawCommand({ kind: 'lightSpeed', lightSpeed: { c: 9999 } })).toEqual({ kind: 'lightSpeed', lightSpeed: { c: 1000 } });
    expect(parseLawCommand({ kind: 'rewind', rewind: { seconds: -5 } })).toEqual({ kind: 'rewind', rewind: { seconds: 0 } });
  });
});
