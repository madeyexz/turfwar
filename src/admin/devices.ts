import { DEVICE_KINDS, isDeviceKind, type DeviceKind } from '../../shared/devicekind';

/**
 * What players play on, on the admin page (pure, for tests): a player's `admin_player_device` row
 * joined by id, and the share of players by the device they last played on. A player without a row
 * (no report yet, or a server whose module predates the view) has no `device` and reads "—".
 */
export interface DeviceOf { device: string; phone: number; tablet: number; desktop: number; lastAtMs: number }

export interface WithDevice { device?: DeviceOf }

export const DEVICE_LABELS: Record<DeviceKind, string> = { phone: 'Phone', tablet: 'Tablet', desktop: 'Computer' };

/** "Phone", "Tablet", "Computer"; undefined without a report (or for a kind this page does not know). */
export const deviceLabel = (d: DeviceOf | undefined) => (d && isDeviceKind(d.device) ? DEVICE_LABELS[d.device] : undefined);

/** "phone 3 · computer 1": connections reported per kind, most first (kinds never reported left out). */
export function deviceCounts(d: DeviceOf): string {
  return DEVICE_KINDS.map(k => ({ k, n: d[k] })).filter(x => x.n > 0).sort((a, b) => b.n - a.n)
    .map(x => `${DEVICE_LABELS[x.k].toLowerCase()} ${x.n}`).join(' · ');
}

export interface DeviceShare { kind: DeviceKind; label: string; players: number; share: number }

/**
 * Players by the device they last played on, among those whose latest report is at or after
 * `sinceMs`: every kind (in a fixed order), with its count and its share of `total` (0–1).
 */
export function deviceShare(players: Iterable<WithDevice>, sinceMs = -Infinity): { total: number; kinds: DeviceShare[] } {
  const counts: Record<DeviceKind, number> = { phone: 0, tablet: 0, desktop: 0 };
  let total = 0;
  for (const p of players) {
    const d = p.device;
    if (!d || d.lastAtMs < sinceMs || !isDeviceKind(d.device)) continue;
    counts[d.device]++;
    total++;
  }
  return { total, kinds: DEVICE_KINDS.map(kind => ({ kind, label: DEVICE_LABELS[kind], players: counts[kind], share: total ? counts[kind] / total : 0 })) };
}

/** "40%", "<1%" for a sliver, "0%" for none. */
export const fmtShare = (share: number) => (share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`);
