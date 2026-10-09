import { describe, expect, it } from 'vitest';
import { defaultQuality, deviceKind, inAppBrowserName, installHint, isInAppBrowser, isIOS, openInBrowserUrl, TABLET_MIN_SIDE, touchEnabled, touchPrimary, type DeviceEnv } from './device';

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

describe('phone, tablet or computer', () => {
  // Screens in CSS px (screen.width × screen.height; the shorter side decides when the user agent does not).
  const IPHONE_SCREEN = { width: 393, height: 852 }, IPAD_SCREEN = { width: 820, height: 1180 }, PIXEL_SCREEN = { width: 412, height: 915 };
  const LAPTOP_SCREEN = { width: 1512, height: 982 };
  const ANDROID_TABLET = env({ coarse: true, fine: false, maxTouchPoints: 10, platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });

  it('phones: iPhone, Android phones (their user agent says Mobile), Firefox on Android', () => {
    expect(deviceKind(IPHONE, IPHONE_SCREEN)).toBe('phone');
    expect(deviceKind(INSTAGRAM, IPHONE_SCREEN)).toBe('phone');
    expect(deviceKind(ANDROID, PIXEL_SCREEN)).toBe('phone');
    expect(deviceKind(env({ coarse: true, fine: false, maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0' }), PIXEL_SCREEN)).toBe('phone');
    // An unfolded foldable has a tablet-sized screen but says Mobile: still a phone.
    expect(deviceKind(ANDROID, { width: 690, height: 829 })).toBe('phone');
  });

  it('tablets: iPads (also when they say they are a Mac), Android tablets (no Mobile), older iPads that say iPad', () => {
    expect(deviceKind(IPAD, IPAD_SCREEN)).toBe('tablet');
    expect(deviceKind(IPAD, { width: 744, height: 1133 })).toBe('tablet'); // iPad mini
    expect(deviceKind(ANDROID_TABLET, { width: 1848, height: 2960 })).toBe('tablet');
    expect(deviceKind(env({ coarse: true, fine: false, maxTouchPoints: 5, platform: 'iPad', userAgent: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' }), IPAD_SCREEN)).toBe('tablet');
    expect(deviceKind(env({ coarse: true, fine: false, maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Android 14; Tablet; rv:128.0) Gecko/128.0 Firefox/128.0' }), { width: 800, height: 1280 })).toBe('tablet');
  });

  it('computers: no touch, or a touch screen with a trackpad or mouse', () => {
    expect(deviceKind(MAC, LAPTOP_SCREEN)).toBe('desktop');
    expect(deviceKind(TOUCH_LAPTOP, { width: 1920, height: 1080 })).toBe('desktop');
    expect(deviceKind(env({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), { width: 0, height: 0 })).toBe('desktop');
  });

  it('without a telling user agent the screen decides: a 600 px shorter side is a tablet', () => {
    // A phone asking for the desktop site says it is a Mac or a Linux computer, but its screen is small.
    expect(deviceKind(IPAD, IPHONE_SCREEN)).toBe('phone');
    const linuxTouch = env({ coarse: true, fine: false, maxTouchPoints: 5, platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
    expect(deviceKind(linuxTouch, PIXEL_SCREEN)).toBe('phone');
    expect(deviceKind(linuxTouch, { width: TABLET_MIN_SIDE - 1, height: 1200 })).toBe('phone');
    expect(deviceKind(linuxTouch, { width: 1200, height: TABLET_MIN_SIDE })).toBe('tablet');
    // A Windows tablet with the keyboard off: touch-primary, a large screen.
    expect(deviceKind(env({ coarse: true, fine: false, maxTouchPoints: 10, platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), { width: 1368, height: 912 })).toBe('tablet');
    // No screen size (should not happen in a browser): a touch device counts as a phone.
    expect(deviceKind(linuxTouch, { width: 0, height: 0 })).toBe('phone');
  });

  it('follows the device, not the touch-controls setting', () => {
    expect(touchEnabled('on', MAC)).toBe(true);
    expect(deviceKind(MAC, LAPTOP_SCREEN)).toBe('desktop');
    expect(touchEnabled('off', IPHONE)).toBe(false);
    expect(deviceKind(IPHONE, IPHONE_SCREEN)).toBe('phone');
  });
});

describe('in-app browsers', () => {
  const THREADS_IOS = env({ ...IPHONE, userAgent: `${IPHONE.userAgent} Barcelona 360.0.0.30.109 (iPhone15,2; iOS 17_5; zh_TW; zh-Hant)` });
  const THREADS_ANDROID = env({ ...ANDROID, userAgent: `${ANDROID.userAgent.replace(')', '; wv)')} Barcelona 360.0.0.30.109 Android` });

  it('recognises Threads (its app calls itself Barcelona) as well as Instagram and the Android web view', () => {
    expect(isInAppBrowser(THREADS_IOS)).toBe(true);
    expect(isInAppBrowser(THREADS_ANDROID)).toBe(true);
    expect(isInAppBrowser(INSTAGRAM)).toBe(true);
    expect(isInAppBrowser(IPHONE)).toBe(false);
    expect(installHint(THREADS_IOS, { touch: true, dismissed: false, canPrompt: false })).toBe('browser');
  });

  it('names the app for analytics: Threads before the Android web view it runs in', () => {
    expect(inAppBrowserName(THREADS_IOS)).toBe('threads');
    expect(inAppBrowserName(THREADS_ANDROID)).toBe('threads');
    expect(inAppBrowserName(INSTAGRAM)).toBe('instagram');
    expect(inAppBrowserName(env({ ...ANDROID, userAgent: ANDROID.userAgent.replace(')', '; wv)') }))).toBe('webview');
    expect(inAppBrowserName(IPHONE)).toBeUndefined();
    expect(inAppBrowserName(MAC)).toBeUndefined();
  });

  it('offers Chrome on Android only, keeping the page and its query', () => {
    const url = 'https://turfwar.ianhsiao.me/?utm_source=threads';
    expect(openInBrowserUrl(THREADS_ANDROID, url)).toBe(`intent://turfwar.ianhsiao.me/?utm_source=threads#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`);
    expect(openInBrowserUrl(THREADS_IOS, url)).toBeUndefined();
    expect(openInBrowserUrl(ANDROID, url)).toBeUndefined();
  });
});
