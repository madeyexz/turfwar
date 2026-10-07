import { describe, expect, it } from 'vitest';
import { acceptDevice, DEVICE_KINDS, DEVICE_RATE_LIMIT_MICROS, isDeviceKind, type DeviceRecord } from './devicekind';

const S = 1_000_000n; // a second in microseconds

describe('the device rules', () => {
  it('knows exactly three kinds', () => {
    expect(DEVICE_KINDS).toEqual(['phone', 'tablet', 'desktop']);
    for (const k of DEVICE_KINDS) expect(isDeviceKind(k)).toBe(true);
    for (const k of ['', 'Phone', ' phone', 'mobile', 'computer', 'tv', 'phone\u0000', 'x'.repeat(10_000), 1, null, undefined, {}]) expect(isDeviceKind(k)).toBe(false);
  });

  it('records the first report: the kind, one connection of it, the time', () => {
    expect(acceptDevice(undefined, 'tablet', 5n * S)).toEqual({ device: 'tablet', phone: 0, tablet: 1, desktop: 0, lastAt: 5n * S });
  });

  it('ignores anything that is not one of the three kinds, leaving the record as it was', () => {
    const prev = acceptDevice(undefined, 'phone', 0n)!;
    for (const k of ['Phone', 'watch', '', '<script>', 42]) expect(acceptDevice(prev, k, 600n * S)).toBeUndefined();
    expect(acceptDevice(undefined, 'laptop', 0n)).toBeUndefined();
  });

  it('allows one report per identity per 30 s', () => {
    const first = acceptDevice(undefined, 'phone', 1000n * S)!;
    expect(acceptDevice(first, 'phone', 1000n * S + DEVICE_RATE_LIMIT_MICROS - 1n)).toBeUndefined();
    expect(acceptDevice(first, 'desktop', 1029n * S)).toBeUndefined();
    expect(acceptDevice(first, 'phone', 1030n * S)).toEqual({ device: 'phone', phone: 2, tablet: 0, desktop: 0, lastAt: 1030n * S });
  });

  it('keeps the latest kind and counts connections per kind', () => {
    let rec: DeviceRecord | undefined;
    for (const [i, k] of (['phone', 'phone', 'desktop', 'phone', 'tablet'] as const).entries()) rec = acceptDevice(rec, k, BigInt(i) * 60n * S) ?? rec;
    expect(rec).toEqual({ device: 'tablet', phone: 3, tablet: 1, desktop: 1, lastAt: 240n * S });
  });

  it('saturates its u32 counts', () => {
    const full: DeviceRecord = { device: 'desktop', phone: 0, tablet: 0, desktop: 0xffffffff, lastAt: 0n };
    expect(acceptDevice(full, 'desktop', 60n * S)?.desktop).toBe(0xffffffff);
  });
});
