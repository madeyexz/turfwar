/**
 * What players play on: a phone, a tablet or a computer (`desktop`).
 *
 * Client (src/game/device.ts `deviceKind`): each online connection classifies its device once and
 * sends it with the `device` reducer right after `hello` (src/net/online.ts); an older server without
 * the reducer refuses the call quietly.
 *
 * Server (`device` in spacetimedb/src/index.ts): `acceptDevice` keeps only the three kinds, one
 * report per identity per 30 s, and folds it into the identity's private `player_device` row (the
 * latest kind, connections per kind, the latest report). The reducer ignores identities without a
 * `player_seen` row. The admin page reads it through the admin-only view `admin_player_device`.
 *
 * This file is pure logic, so tests can run it.
 */
export const DEVICE_KINDS = ['phone', 'tablet', 'desktop'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const isDeviceKind = (v: unknown): v is DeviceKind => typeof v === 'string' && (DEVICE_KINDS as readonly string[]).includes(v);

/** Server: one report per identity per 30 s (a reconnecting loop cannot keep rewriting the row). */
export const DEVICE_RATE_LIMIT_MICROS = 30_000_000n;
const U32 = 0xffffffff;

/** A `player_device` row (identity aside): the latest kind, connections reported per kind, the latest report (epoch µs). */
export interface DeviceRecord { device: string; phone: number; tablet: number; desktop: number; lastAt: bigint }

/**
 * The whole `device` rule: refused (undefined) when `kind` is not one of the three, or inside 30 s of
 * the identity's previous report; otherwise the new record (that kind's count up by one, saturating).
 */
export function acceptDevice(prev: DeviceRecord | undefined, kind: unknown, now: bigint): DeviceRecord | undefined {
  if (!isDeviceKind(kind)) return undefined;
  if (prev && now - prev.lastAt < DEVICE_RATE_LIMIT_MICROS) return undefined;
  const counts = { phone: prev?.phone ?? 0, tablet: prev?.tablet ?? 0, desktop: prev?.desktop ?? 0 };
  counts[kind] = Math.min(U32, counts[kind] + 1);
  return { device: kind, ...counts, lastAt: now };
}
