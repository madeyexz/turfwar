import type { GroupId } from './groups';

/**
 * Peak online on the admin page (pure, for tests): the most players in rooms at once, from the
 * module's `admin_peak_hour` rows (one per hour with players: everyone, Phone and Computer, and when
 * the all-player peak was reached), folded into the charts' buckets.
 */
export interface PeakOf { hour: number; peak: number; phone: number; computer: number; atMs: number }
/** The most at once in a bucket for each group; `atMs` is when the all-player figure was reached. */
export interface Peak { all: number; phone: number; computer: number; atMs: number }

const fold = (into: Peak | undefined, r: PeakOf): Peak => (!into
  ? { all: r.peak, phone: r.phone, computer: r.computer, atMs: r.atMs }
  : { all: Math.max(into.all, r.peak), phone: Math.max(into.phone, r.phone), computer: Math.max(into.computer, r.computer), atMs: r.peak > into.all ? r.atMs : into.atMs });

/** The peak per bucket: per hour as recorded (hours since the epoch), or per UTC day (the highest hour of each). */
export function peaksBy(rows: Iterable<PeakOf>, hourly: boolean): Map<number, Peak> {
  const out = new Map<number, Peak>();
  for (const r of rows) {
    const key = hourly ? r.hour : Math.floor(r.hour / 24);
    out.set(key, fold(out.get(key), r));
  }
  return out;
}

/** The peak over the hours from `from` to `to` (inclusive); undefined without records there. */
export function peakBetween(rows: Iterable<PeakOf>, from: number, to: number): Peak | undefined {
  let out: Peak | undefined;
  for (const r of rows) if (r.hour >= from && r.hour <= to) out = fold(out, r);
  return out;
}

/** A group's figure in a peak. */
export const peakFor = (p: Peak, g: GroupId) => (g === 'all' ? p.all : p[g]);
