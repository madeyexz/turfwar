import { describe, expect, it } from 'vitest';
import { defaultQuality, installHint, isIOS, touchEnabled, touchPrimary, type DeviceEnv } from './device';

const env = (o: Partial<DeviceEnv>): DeviceEnv => ({ coarse: false, fine: true, maxTouchPoints: 0, userAgent: '', platform: '', standalone: false, ...o });
const IPHONE = env({ coarse: true, fine: false, maxTouchPoints: 5, platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
/** iPadOS Safari asks for the desktop site: it says it is a Mac, and may report a fine pointer. */
const IPAD = env({ coarse: false, fine: true, maxTouchPoints: 5, platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15' });
const ANDROID = env({ coarse: true, fine: false, maxTouchPoints: 5, platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });
const MAC = env({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
const TOUCH_LAPTOP = env({ maxTouchPoints: 10, platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
const INSTAGRAM = env({ ...IPHONE, userAgent: `${IPHONE.userAgent} Instagram 300.0.0.0` });

describe('touch-primary devices', () => {
  it('phones and tablets (iPads included) get touch controls; computers do not, even with a touch screen', () => {
    expect(touchPrimary(IPHONE)).toBe(true);
    expect(touchPrimary(ANDROID)).toBe(true);
    expect(touchPrimary(IPAD)).toBe(true);
    expect(isIOS(IPAD)).toBe(true);
    expect(touchPrimary(MAC)).toBe(false);
    expect(touchPrimary(TOUCH_LAPTOP)).toBe(false);
    // Not the screen width: a large tablet in landscape is still touch-primary.
    expect(touchPrimary(env({ coarse: true, fine: false, maxTouchPoints: 10, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X910) Chrome/126' }))).toBe(true);
  });

  it('the setting and ?touch= override the device', () => {
    expect(touchEnabled('auto', MAC)).toBe(false);
    expect(touchEnabled('on', MAC)).toBe(true);
    expect(touchEnabled('off', IPHONE)).toBe(false);
    expect(touchEnabled('off', MAC, '1')).toBe(true);
    expect(touchEnabled('on', IPHONE, '0')).toBe(false);
    expect(touchEnabled('auto', IPHONE, null)).toBe(true);
  });

  it('phones start on low graphics, computers on medium', () => {
    expect(defaultQuality(true)).toBe('low');
    expect(defaultQuality(false)).toBe('medium');
  });
});

describe('install hint', () => {
  const open = { touch: true, dismissed: false, canPrompt: false };
  it('iOS: Share → Add to Home Screen (Safari has no install prompt)', () => {
    expect(installHint(IPHONE, open)).toBe('ios');
    expect(installHint(IPAD, open)).toBe('ios');
  });
  it('Android: the Install button once the browser offers it, else the menu', () => {
    expect(installHint(ANDROID, { ...open, canPrompt: true })).toBe('prompt');
    expect(installHint(ANDROID, open)).toBe('android');
  });
  it('in-app browsers: open the page in a real browser first', () => {
    expect(installHint(INSTAGRAM, open)).toBe('browser');
    expect(installHint(env({ ...ANDROID, userAgent: `${ANDROID.userAgent.replace(')', '; wv)')}` }), { ...open, canPrompt: true })).toBe('browser');
  });
  it('other touch browsers: short instructions', () => {
    expect(installHint(env({ coarse: true, maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (X11; Linux) Firefox/128' }), open)).toBe('other');
  });
  it('nothing once installed, dismissed, or on a computer', () => {
    expect(installHint({ ...IPHONE, standalone: true }, open)).toBeUndefined();
    expect(installHint({ ...ANDROID, standalone: true }, { ...open, canPrompt: true })).toBeUndefined();
    expect(installHint(IPHONE, { ...open, dismissed: true })).toBeUndefined();
    expect(installHint(MAC, { ...open, touch: false, canPrompt: true })).toBeUndefined();
  });
});
