import { describe, expect, it } from 'vitest';
import { fmtPing, fmtRate, medianCorrections, medianPing, pingByCountry, pingClass, type NetOf, type WithNet } from './net';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const net = (pingP50: number, ageMs: number, correctionsPerMin = 0): NetOf => ({ pingP50, pingP95: pingP50 * 2, worstP95: pingP50 * 3, correctionsPerMin, measuredMinutes: 10, lastAtMs: NOW - ageMs });

const players: WithNet[] = [
  { tz: 'Asia/Taipei', net: net(30, 1000, 0.5) },
  { tz: 'Asia/Taipei', net: net(50, 2 * 3_600_000, 1) },
  { tz: 'Asia/Taipei', net: net(40, 3 * DAY, 2) },
  { tz: 'America/Los_Angeles', net: net(180, 5 * DAY, 4) },
  { tz: 'Europe/Berlin', net: net(220, 20 * DAY, 8) },
  { tz: 'UTC', net: net(90, 1000) },
  { tz: 'Asia/Tokyo' }, // never reported
];

describe('admin connection quality', () => {
  it('takes the median ping over players active in a window', () => {
    expect(medianPing(players, NOW - DAY)).toEqual({ ms: 50, players: 3 }); // 30, 50, 90
    expect(medianPing(players, NOW - 7 * DAY)).toEqual({ ms: 50, players: 5 }); // 30, 40, 50, 90, 180
    expect(medianPing(players, NOW - 30 * DAY)).toEqual({ ms: 70, players: 6 });
  });

  it('takes the median corrections per minute over players active in a window', () => {
    expect(medianCorrections(players, NOW - 7 * DAY)).toEqual({ perMin: 1, players: 5 }); // 0, 0.5, 1, 2, 4
  });

  it('takes the median ping per country, most players first', () => {
    expect(pingByCountry(players)).toEqual([
      { country: 'Taiwan', ms: 40, players: 3 },
      { country: 'United States', ms: 180, players: 1 },
      { country: 'Germany', ms: 220, players: 1 },
      { country: 'Other', ms: 90, players: 1 },
    ]);
  });

  it('shows "—" without data (no reports, or a server without the views)', () => {
    const none: WithNet[] = players.map(p => ({ tz: p.tz }));
    expect(medianPing(none, 0)).toEqual({ ms: undefined, players: 0 });
    expect(medianCorrections([], 0)).toEqual({ perMin: undefined, players: 0 });
    expect(pingByCountry(none)).toEqual([]);
    expect(fmtPing(medianPing(none, 0).ms)).toBe('—');
    expect(fmtRate(medianCorrections(none, 0).perMin)).toBe('—');
    expect(fmtPing(Number.NaN)).toBe('—');
  });

  it('formats and colours ping', () => {
    expect(fmtPing(42.4)).toBe('42 ms');
    expect(fmtRate(0.456)).toBe('0.46');
    expect(fmtRate(12.6)).toBe('13');
    expect(fmtRate(0)).toBe('0');
    expect([0, 79, 80, 159, 160, 900].map(pingClass)).toEqual(['good', 'good', 'fair', 'fair', 'poor', 'poor']);
  });
});
