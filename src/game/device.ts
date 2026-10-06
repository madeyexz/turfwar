/**
 * What kind of device is playing: touch-primary phones and tablets get on-screen controls, low
 * graphics by default and the install hint; keyboard-and-mouse computers keep pointer lock.
 *
 * Decisions are pure functions of a `DeviceEnv` snapshot so they can be tested without a browser.
 */

export interface DeviceEnv {
  /** `(pointer: coarse)`: the primary pointer is a finger. */
  coarse: boolean;
  /** `(any-pointer: fine)`: some mouse or trackpad is attached. */
  fine: boolean;
  maxTouchPoints: number;
  userAgent: string;
  platform: string;
  /** Running as an installed app (`display-mode: standalone` / `fullscreen`, or iOS's `navigator.standalone`). */
  standalone: boolean;
}

const media = (q: string) => { try { return typeof matchMedia === 'function' && matchMedia(q).matches; } catch { return false; } };

/** The current browser's environment. */
export function readEnv(): DeviceEnv {
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as Partial<Navigator> & { standalone?: boolean };
  return {
    coarse: media('(pointer: coarse)'),
    fine: media('(any-pointer: fine)'),
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    userAgent: nav.userAgent ?? '',
    platform: nav.platform ?? '',
    standalone: media('(display-mode: standalone)') || media('(display-mode: fullscreen)') || nav.standalone === true,
  };
}

/** iPadOS Safari says it is a Mac; only the touch points give it away. */
export const isIPad = (env: DeviceEnv) => /iPad/.test(env.userAgent) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
export const isIOS = (env: DeviceEnv) => /iPhone|iPod/.test(env.userAgent) || isIPad(env);
export const isAndroid = (env: DeviceEnv) => /Android/i.test(env.userAgent);
/** In-app browsers (Instagram, Facebook, LINE…) cannot install a web app: open it in the real browser. */
export const isInAppBrowser = (env: DeviceEnv) => /FBAN|FBAV|Instagram|Line\/|MicroMessenger|; wv\)/i.test(env.userAgent);

/**
 * A touch-primary device: the primary pointer is coarse, or the screen takes touches and nothing
 * finer is attached, or it is an iPad (which can report a fine pointer through Safari's desktop mode).
 * A touch laptop with a trackpad stays keyboard-and-mouse (its owner can switch touch controls on).
 */
export function touchPrimary(env: DeviceEnv) {
  if (env.maxTouchPoints <= 0 && !env.coarse) return false;
  return env.coarse || !env.fine || isIPad(env) || /iPhone|iPod|Android.*Mobile/i.test(env.userAgent);
}

/** Settings → Controls: touch controls follow the device, or are forced on or off. */
export type TouchPref = 'auto' | 'on' | 'off';
export const TOUCH_PREFS: readonly TouchPref[] = ['auto', 'on', 'off'];

/** Whether on-screen touch controls are used: `?touch=1|0` (testing) beats the saved preference, which beats the device. */
export function touchEnabled(pref: TouchPref, env: DeviceEnv, flag?: string | null) {
  if (flag === '1' || flag === 'on') return true;
  if (flag === '0' || flag === 'off') return false;
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return touchPrimary(env);
}

/** Phones and tablets start on low graphics (lower resolution, lighter shadows) unless the player chose. */
export const defaultQuality = (touch: boolean): 'low' | 'medium' => touch ? 'low' : 'medium';

/**
 * The lobby's install hint for a touch device that is not running as an installed app.
 * `prompt`: the browser offered `beforeinstallprompt` (Android Chrome, Edge, Samsung): an Install button.
 * `ios`: Safari (and every iOS browser since 16.4): Share → Add to Home Screen.
 * `android`: Android without the prompt (yet): the browser menu → Install app / Add to Home screen.
 * `browser`: an in-app browser: open the page in Safari / Chrome first.
 * `other`: anything else: the browser's menu → Add to Home Screen.
 */
export type InstallHint = 'prompt' | 'ios' | 'android' | 'browser' | 'other';

export function installHint(env: DeviceEnv, opts: { touch: boolean; dismissed: boolean; canPrompt: boolean }): InstallHint | undefined {
  if (!opts.touch || env.standalone || opts.dismissed) return undefined;
  if (isInAppBrowser(env)) return 'browser';
  if (opts.canPrompt) return 'prompt';
  if (isIOS(env)) return 'ios';
  if (isAndroid(env)) return 'android';
  return 'other';
}
