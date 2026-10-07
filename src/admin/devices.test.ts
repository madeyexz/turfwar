import { describe, expect, it } from 'vitest';
import { deviceCounts, deviceLabel, deviceShare, fmtShare, type DeviceOf, type WithDevice } from './devices';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const dev = (device: string, ageMs: number, counts: Partial<Record<'phone' | 'tablet' | 'desktop', number>> = {}): DeviceOf =>
  ({ device, phone: 0, tablet: 0, desktop: 0, [device]: 1, ...counts, lastAtMs: NOW - ageMs });

const players: WithDevice[] = [
  { device: dev('phone', 1000) },
  { device: dev('phone', 2 * DAY) },
  { device: dev('desktop', 3 * DAY, { desktop: 4, phone: 1 }) },
  { device: dev('tablet', 6 * DAY) },
  { device: dev('desktop', 20 * DAY) },
  { device: dev('watch', 1000) }, // a kind this page does not know: left out
  {}, // never reported, or a server without the view
];

describe('admin devices', () => {
  it('counts players by the device they last played on, in a window', () => {
    const week = deviceShare(players, NOW - 7 * DAY);
    expect(week.total).toBe(4);
    expect(week.kinds.map(k => [k.kind, k.label, k.players, k.share])).toEqual([
      ['phone', 'Phone', 2, 0.5], ['tablet', 'Tablet', 1, 0.25], ['desktop', 'Computer', 1, 0.25],
    ]);
    const ever = deviceShare(players);
    expect(ever.total).toBe(5);
    expect(ever.kinds.find(k => k.kind === 'desktop')).toMatchObject({ players: 2, share: 0.4 });
  });

  it('shows nothing without data (no reports, or a server without the view)', () => {
    const none = deviceShare([{}, {}], 0);
    expect(none.total).toBe(0);
    expect(none.kinds.map(k => k.share)).toEqual([0, 0, 0]);
    expect(deviceLabel(undefined)).toBeUndefined();
    expect(deviceLabel(dev('watch', 0))).toBeUndefined();
  });

  it('labels a player\'s device and the connections behind it', () => {
    expect(deviceLabel(dev('phone', 0))).toBe('Phone');
    expect(deviceLabel(dev('tablet', 0))).toBe('Tablet');
    expect(deviceLabel(dev('desktop', 0))).toBe('Computer');
    expect(deviceCounts(dev('desktop', 0, { desktop: 4, phone: 1 }))).toBe('computer 4 · phone 1');
    expect(deviceCounts(dev('tablet', 0))).toBe('tablet 1');
  });

  it('formats shares', () => {
    expect(fmtShare(0.5)).toBe('50%');
    expect(fmtShare(1 / 3)).toBe('33%');
    expect(fmtShare(0.001)).toBe('<1%');
    expect(fmtShare(0)).toBe('0%');
    expect(fmtShare(1)).toBe('100%');
  });
});
