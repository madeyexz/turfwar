import { describe, expect, it } from 'vitest';
import { analyticsGuard, privateErrorProperties, screenBucket, stayTimes, stayVisibility, type StayClock } from './analytics';

const KEY = 'phc_test';
const prod = { key: KEY, dev: false, search: '', webdriver: false };

it('error reports exclude inherited player and attribution fields, but preserve anonymous SDK IDs', () => {
  const distinct_id = 'ab12'.repeat(16);
  expect(privateErrorProperties({ token: 'phc_public_ingestion_key' })).toEqual({ token: 'phc_public_ingestion_key' });
  // A lost graphics context keeps its timing and drawing properties.
  const loss = { kind: 'webgl_restored', lost_ms: 6, frame_ms: 2400, losses: 2, visible: true, visible_s: 0.4, quality: 'low', pixel_ratio: 1.5, canvas: '1266x585', map: 'taipei' };
  expect(privateErrorProperties({ ...loss, callsign: 'Ian' })).toEqual(loss);
  expect(privateErrorProperties({ distinct_id, callsign: 'Ian', room: 'ABCD', first_utm_source: 'private', $set: { name: 'Ian' }, $current_url: 'https://a.test/?room=ABCD#secret', message: 'bad token=secret', app_version: '123abc', test: true })).toEqual({ distinct_id, $current_url: 'https://a.test/', message: 'bad token=[x]', app_version: '123abc', test: true });
});

describe('analytics guard', () => {
  it('sends in a production build with a key', () => {
    expect(analyticsGuard(prod)).toMatchObject({ enabled: true, test: false });
  });

  it('is a no-op without a key', () => {
    expect(analyticsGuard({ ...prod, key: undefined }).enabled).toBe(false);
    expect(analyticsGuard({ ...prod, key: '' }).enabled).toBe(false);
    expect(analyticsGuard({ ...prod, key: undefined, dev: true, search: '?analytics' }).enabled).toBe(false);
  });

  it('is blocked under the automation flags', () => {
    for (const flag of ['trailer', 'capture', 'fixeddt']) {
      expect(analyticsGuard({ ...prod, search: `?${flag}` })).toMatchObject({ enabled: false, reason: `?${flag}` });
      expect(analyticsGuard({ ...prod, search: `?map=taipei&${flag}=1` }).enabled).toBe(false);
      expect(analyticsGuard({ ...prod, dev: true, search: `?analytics&${flag}` }).enabled).toBe(false);
      expect(analyticsGuard({ ...prod, search: `?bench&${flag}` }).enabled).toBe(false);
    }
  });

  it('lets a ?bench page send its result and nothing else, never from headless browsers', () => {
    expect(analyticsGuard({ ...prod, search: '?bench&map=taipei&quality=medium' })).toMatchObject({ enabled: true, test: false, only: 'bench_result' });
    expect(analyticsGuard({ ...prod, search: '?map=taipei' }).only).toBeUndefined();
    expect(analyticsGuard({ ...prod, search: '?bench', webdriver: true }).enabled).toBe(false);
    expect(analyticsGuard({ ...prod, dev: true, search: '?bench' }).enabled).toBe(false);
  });

  it('is blocked in headless automation (navigator.webdriver)', () => {
    expect(analyticsGuard({ ...prod, webdriver: true })).toMatchObject({ enabled: false, reason: 'webdriver' });
  });

  it('is blocked in the dev server unless ?analytics, and then sends test events', () => {
    expect(analyticsGuard({ ...prod, dev: true })).toMatchObject({ enabled: false, reason: 'dev server' });
    expect(analyticsGuard({ ...prod, dev: true, search: '?analytics' })).toMatchObject({ enabled: true, test: true });
    // ?analytics changes nothing in production.
    expect(analyticsGuard({ ...prod, search: '?analytics' })).toMatchObject({ enabled: true, test: false });
  });

  it('buckets the screen to 100 px', () => {
    expect(screenBucket(1512, 982)).toBe('1500x1000');
    expect(screenBucket(1920, 1080)).toBe('1900x1100');
    expect(screenBucket(390, 844)).toBe('400x800');
  });
});

it('a stay counts only the time its tab was in view as play time', () => {
  // Joined at 10 s, hidden 70–3670 s (an hour in the background), back in view, hidden again at 3700 s for good.
  const c: StayClock = { start: 10_000, hiddenMs: 0 };
  stayVisibility(c, true, 70_000);
  stayVisibility(c, true, 80_000); // a repeated "hidden" does not restart the stretch
  stayVisibility(c, false, 3_670_000);
  expect(stayTimes(c, 3_690_000)).toEqual({ seconds: 80, hidden: 3600 });
  stayVisibility(c, true, 3_700_000);
  expect(stayTimes(c, 3_760_000)).toEqual({ seconds: 90, hidden: 3660 });
});
