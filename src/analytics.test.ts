import { describe, expect, it } from 'vitest';
import { analyticsGuard, screenBucket } from './analytics';

const KEY = 'phc_test';
const prod = { key: KEY, dev: false, search: '', webdriver: false };

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
    for (const flag of ['bench', 'trailer', 'capture', 'fixeddt']) {
      expect(analyticsGuard({ ...prod, search: `?${flag}` })).toMatchObject({ enabled: false, reason: `?${flag}` });
      expect(analyticsGuard({ ...prod, search: `?map=taipei&${flag}=1` }).enabled).toBe(false);
      expect(analyticsGuard({ ...prod, dev: true, search: `?analytics&${flag}` }).enabled).toBe(false);
    }
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
