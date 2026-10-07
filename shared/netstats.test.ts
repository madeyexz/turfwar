import { describe, expect, it } from 'vitest';
import {
  acceptNetReport, cleanNetReport, CORRECTIONS_PER_SECOND_MAX, EVENT_EVERY_MS, foldNetDay, foldNetReport, median, NetMeter, NetReporter, netReportAllowed,
  percentile, perMinute, PING_MAX_MS, RATE_LIMIT_MICROS, REPORT_EVERY_MS, RING_SIZE, SAMPLES_MAX, SECONDS_MAX, SECONDS_SLACK, type NetRecord,
} from './netstats';

const S = 1_000_000n; // a second in microseconds

describe('percentiles', () => {
  it('interpolates between neighbours and ignores what is not a number', () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 - i); // 100 … 1, unsorted
    expect(percentile(values, 50)).toBeCloseTo(50.5);
    expect(percentile(values, 95)).toBeCloseTo(95.05);
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 100)).toBe(100);
    expect(values[0]).toBe(100); // the input is not sorted in place
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([10, Number.NaN, 30], 50)).toBe(20);
  });

  it('is undefined without values', () => {
    expect(percentile([], 50)).toBeUndefined();
    expect(median([])).toBeUndefined();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});

describe('the meter', () => {
  it('keeps the newest 600 round trips, oldest first, clamped to 0–5000 ms', () => {
    const m = new NetMeter(0);
    for (let i = 1; i <= RING_SIZE + 100; i++) m.sample(i);
    expect(m.samples).toBe(RING_SIZE + 100);
    const kept = m.recent();
    expect(kept).toHaveLength(RING_SIZE);
    expect(kept[0]).toBe(101);
    expect(kept[RING_SIZE - 1]).toBe(RING_SIZE + 100);
    expect(m.recent(3)).toEqual([698, 699, 700]);
    m.sample(20_000); m.sample(-5); m.sample(Number.NaN); m.sample(Number.POSITIVE_INFINITY);
    expect(m.recent(2)).toEqual([PING_MAX_MS, 0]);
    expect(m.samples).toBe(RING_SIZE + 102);
  });

  it('measures a window: percentiles over its samples, corrections and time in a room', () => {
    const m = new NetMeter(0);
    for (let i = 0; i < 10; i++) m.sample(500); // before the mark
    m.correct(2);
    const mark = m.mark(10_000);
    for (let i = 1; i <= 20; i++) m.sample(i * 10);
    m.correct(3); m.correct(0); m.correct(-4);
    const w = m.since(mark, 70_000);
    expect(w).toMatchObject({ samples: 20, corrections: 3, seconds: 60 });
    expect(w.p50).toBeCloseTo(105);
    expect(w.p95).toBeCloseTo(190.5);
  });

  it('counts only time with a soldier in a room', () => {
    const m = new NetMeter(0);
    const start = m.mark(0);
    m.clock(30_000, false); // dropped from the room (a background tab)
    m.clock(90_000, true); // back in
    expect(m.since(start, 120_000).seconds).toBe(60);
  });

  it('formats corrections per minute', () => {
    expect(perMinute(3, 120)).toBe(1.5);
    expect(perMinute(1, 0)).toBe(0);
    expect(perMinute(1, 7)).toBe(8.57);
  });
});

describe('the report trigger', () => {
  /** A player in a match for `minutes`, sampling twice a second, polled every 5 s; what went out. */
  function play(minutes: number, opts: { corrections?: (t: number) => number; samples?: (t: number) => boolean } = {}) {
    const r = new NetReporter(0);
    const reports: { at: number; seconds: number; samples: number; corrections: number }[] = [];
    const events: number[] = [];
    for (let t = 0; t <= minutes * 60_000; t += 500) {
      if (opts.samples?.(t) ?? true) r.meter.sample(80 + (t % 7));
      r.meter.correct(opts.corrections?.(t) ?? 0);
      if (t % 5000 === 0) {
        const { report, event } = r.poll(t, true);
        if (report) reports.push({ at: t, ...report });
        if (event) events.push(t);
      }
    }
    return { r, reports, events };
  }

  it('reports to the server every 2 minutes, never more often, each covering its own stretch', () => {
    const { reports } = play(30, { corrections: t => (t % 60_000 === 0 ? 1 : 0) });
    expect(reports).toHaveLength(15);
    for (let i = 1; i < reports.length; i++) expect(reports[i].at - reports[i - 1].at).toBe(REPORT_EVERY_MS);
    for (const rep of reports) expect(rep.seconds).toBe(120);
    // One correction a minute, at 0:00 … 30:00: all 31 reported, none twice.
    expect(reports.reduce((n, x) => n + x.corrections, 0)).toBe(31);
    expect(reports.map(x => x.samples)).toEqual([241, ...Array(14).fill(240)]);
  });

  it('sends the analytics sample every 5 minutes', () => {
    const { events } = play(30);
    expect(events).toEqual(Array.from({ length: 6 }, (_, i) => (i + 1) * EVENT_EVERY_MS));
  });

  it('carries a stretch without samples (dead, spectating) into the next report', () => {
    // No samples between minute 1 and minute 5.
    const { reports } = play(6, { samples: t => t < 60_000 || t >= 300_000 });
    expect(reports.map(x => x.at)).toEqual([120_000, 300_000]);
    expect(reports[1].seconds).toBe(180);
  });

  it('leaving sends the last stretch once, and the match numbers', () => {
    const { r } = play(3, { corrections: t => (t === 1000 ? 4 : 0) });
    const left = r.leave(185_000);
    expect(left.report).toMatchObject({ seconds: 65 });
    expect(left.totals).toMatchObject({ samples: 361, corrections: 4, seconds: 185, ping_p50: 83 });
    expect(left.totals.corrections_per_min).toBeCloseTo(4 / (185 / 60), 2);
    // Once: no more reports or events afterwards.
    expect(r.done).toBe(true);
    expect(r.leave(400_000).report).toBeUndefined();
    expect(r.poll(600_000, true)).toEqual({});
  });

  it('skips the last report within 30 s of the previous one (the server would ignore it)', () => {
    const { r } = play(2); // reported at 120 s
    expect(r.leave(140_000).report).toBeUndefined();
    const { r: later } = play(2);
    later.meter.sample(70);
    expect(later.leave(150_000).report).toMatchObject({ seconds: 30, samples: 1, p50Ms: 70 });
  });

  it('sends nothing for a match without samples', () => {
    const r = new NetReporter(0);
    expect(r.poll(REPORT_EVERY_MS, true)).toEqual({});
    expect(r.leave(REPORT_EVERY_MS + 1000).report).toBeUndefined();
    expect(r.totals(1000)).toMatchObject({ samples: 0, ping_p50: 0, ping_p95: 0 });
  });
});

describe('the net_stats rules', () => {
  const report = { p50Ms: 60, p95Ms: 120, samples: 240, corrections: 3, seconds: 120 };

  it('clamps ping to 0–5000 ms, samples to 100000, seconds to 86400, corrections to 30 a second', () => {
    expect(cleanNetReport(report)).toEqual({ p50: 60, p95: 120, samples: 240, corrections: 3, seconds: 120 });
    expect(cleanNetReport({ p50Ms: 9999, p95Ms: 70_000, samples: 1e9, corrections: 1e9, seconds: 1e9 }))
      .toEqual({ p50: PING_MAX_MS, p95: PING_MAX_MS, samples: SAMPLES_MAX, seconds: SECONDS_MAX, corrections: SECONDS_MAX * CORRECTIONS_PER_SECOND_MAX });
    expect(cleanNetReport({ ...report, corrections: 100_000, seconds: 10 })?.corrections).toBe(300);
    // p95 is never below p50.
    expect(cleanNetReport({ ...report, p50Ms: 200, p95Ms: 100 })).toMatchObject({ p50: 200, p95: 200 });
    expect(cleanNetReport({ ...report, p50Ms: Number.NaN, p95Ms: -4 })).toMatchObject({ p50: 0, p95: 0 });
  });

  it('refuses a report without samples or under a second', () => {
    expect(cleanNetReport({ ...report, samples: 0 })).toBeUndefined();
    expect(cleanNetReport({ ...report, seconds: 0 })).toBeUndefined();
    expect(cleanNetReport({ ...report, seconds: 0.4 })).toBeUndefined();
  });

  it('allows one report per identity per 30 s', () => {
    const first = acceptNetReport(undefined, report, 1000n * S)!;
    expect(first.record).toMatchObject({ reports: 1, lastAt: 1000n * S });
    expect(netReportAllowed(first.record, 1000n * S + RATE_LIMIT_MICROS - 1n)).toBe(false);
    expect(acceptNetReport(first.record, report, 1029n * S)).toBeUndefined();
    expect(acceptNetReport(first.record, report, 1030n * S)?.record.reports).toBe(2);
  });

  it('caps the seconds at the wall clock since the previous report, plus a minute', () => {
    const first = acceptNetReport(undefined, { ...report, seconds: 100_000 }, 1000n * S)!;
    expect(first.report.seconds).toBe(SECONDS_MAX);
    const next = acceptNetReport(first.record, { ...report, seconds: 3600 }, 1040n * S)!;
    expect(next.report.seconds).toBe(40 + SECONDS_SLACK);
    expect(next.record.measuredSeconds).toBe(SECONDS_MAX + 40 + SECONDS_SLACK);
  });

  it('keeps the typical ping as a mean weighted by measured seconds, and the worst p95', () => {
    let rec: NetRecord | undefined;
    rec = foldNetReport(rec, { p50: 50, p95: 100, samples: 200, corrections: 2, seconds: 120 }, 1n);
    rec = foldNetReport(rec, { p50: 200, p95: 400, samples: 60, corrections: 6, seconds: 40 }, 2n);
    rec = foldNetReport(rec, { p50: 60, p95: 90, samples: 240, corrections: 0, seconds: 120 }, 3n);
    expect(rec).toMatchObject({ reports: 3, lastP50: 60, lastP95: 90, worstP95: 400, corrections: 8, measuredSeconds: 280, lastAt: 3n });
    expect(rec.avgP50).toBeCloseTo((50 * 120 + 200 * 40 + 60 * 120) / 280);
    expect(rec.avgP95).toBeCloseTo((100 * 120 + 400 * 40 + 90 * 120) / 280);
  });

  it('saturates its u32 totals', () => {
    const full: NetRecord = { reports: 0xffffffff, lastP50: 0, lastP95: 0, avgP50: 10, avgP95: 10, worstP95: 10, corrections: 0xfffffff0, measuredSeconds: 0xffffffff, lastAt: 0n };
    const rec = foldNetReport(full, { p50: 10, p95: 10, samples: 1, corrections: 100, seconds: 60 }, 99n * S);
    expect(rec).toMatchObject({ reports: 0xffffffff, corrections: 0xffffffff, measuredSeconds: 0xffffffff });
  });

  it('sums a day\'s reports weighted by seconds', () => {
    let d = foldNetDay(undefined, { p50: 50, p95: 100, samples: 1, corrections: 1, seconds: 120 });
    d = foldNetDay(d, { p50: 80, p95: 200, samples: 1, corrections: 2, seconds: 60 });
    expect(d).toEqual({ reports: 2, seconds: 180, p50Sum: 50 * 120 + 80 * 60, p95Sum: 100 * 120 + 200 * 60, corrections: 3 });
  });
});
