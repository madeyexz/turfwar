import { describe, expect, it } from 'vitest';
import { PHONE_ADAPTIVE_DPR } from '../game/adaptivedpr';
import { QUALITY, adaptiveOptions } from './renderer';

describe('adaptive resolution options per preset', () => {
  it('phones (the low preset) get the steady-60 options; the others the defaults', () => {
    expect(adaptiveOptions(QUALITY.low)).toBe(PHONE_ADAPTIVE_DPR);
    expect(adaptiveOptions(QUALITY.medium)).toEqual({});
    expect(adaptiveOptions(QUALITY.high)).toEqual({});
  });
});
