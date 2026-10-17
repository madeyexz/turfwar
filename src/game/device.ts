/**
 * What kind of device is playing: touch-primary phones and tablets get on-screen controls, low
 * graphics by default and the install hint; keyboard-and-mouse computers keep pointer lock.
 *
 * Decisions are pure functions of a `DeviceEnv` snapshot so they can be tested without a browser.
 */
import type { DeviceKind } from '../../shared/devicekind';

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
/** The apps whose built-in browser we recognise (analytics' `in_app`); `webview` is any other Android web view. */
export type InAppBrowser = 'threads' | 'instagram' | 'messenger' | 'facebook' | 'line' | 'tiktok' | 'wechat' | 'webview';

/**
 * Which app's in-app browser this is, or undefined for a regular browser. In-app browsers (Threads,
 * whose app calls itself Barcelona; Instagram, Messenger, Facebook, LINE, TikTok…) cannot install a web
 * app or turn to landscape, often keep storage and audio to themselves, and the real browser is a tap away.
 * Order matters: Messenger's user agent also says FBAN/FBAV, and every Android app says `; wv)`.
 */
export function inAppBrowserName(env: DeviceEnv): InAppBrowser | undefined {
  const ua = env.userAgent;
  if (/Barcelona|Threads/i.test(ua)) return 'threads';
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/Messenger|FB_IAB\/Orca/i.test(ua)) return 'messenger';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'facebook';
  if (/Line\//i.test(ua)) return 'line';
  if (/musical_ly|TikTok|BytedanceWebview|trill_/i.test(ua)) return 'tiktok';
  if (/MicroMessenger/i.test(ua)) return 'wechat';
  return /; wv\)/i.test(ua) ? 'webview' : undefined;
}
export const isInAppBrowser = (env: DeviceEnv) => inAppBrowserName(env) !== undefined;

/**
 * A link that opens `url` in Chrome from an Android in-app browser (an intent URL); none elsewhere —
 * iOS in-app browsers can only be left through their own menu (⋯ → Open in browser).
 */
export function openInBrowserUrl(env: DeviceEnv, url: string): string | undefined {
  if (!isInAppBrowser(env) || !isAndroid(env)) return undefined;
  const u = new URL(url);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

/**
 * A touch-primary device: the primary pointer is coarse, or the screen takes touches and nothing
 * finer is attached, or it is an iPad (which can report a fine pointer through Safari's desktop mode).
 * A touch laptop with a trackpad stays keyboard-and-mouse (its owner can switch touch controls on).
 */
export function touchPrimary(env: DeviceEnv) {
  if (env.maxTouchPoints <= 0 && !env.coarse) return false;
  return env.coarse || !env.fine || isIPad(env) || /iPhone|iPod|Android.*Mobile/i.test(env.userAgent);
}

/** A screen whose shorter side reaches this many CSS px is a tablet's (Android's own phone/tablet line, sw600dp). */
export const TABLET_MIN_SIDE = 600;

/**
 * Phone, tablet or computer, for the owner's player counts (the `device` reducer, once per connection;
 * shared/devicekind.ts). `screen` is the device's screen in CSS px, not the window, so rotating it or
 * splitting the screen changes nothing.
 * - Not touch-primary (`touchPrimary`): a computer (`desktop`), touch-screen laptops included.
 * - The user agent says so: iPhone or iPod, or Android with "Mobile" (Android phones say it, tablets
 *   don't): a phone; iPad: a tablet.
 * - Otherwise (iPadOS saying it is a Mac, Android tablets, any other touch device, a phone asking for
 *   the desktop site): the screen decides, a tablet from a 600 px shorter side, else a phone.
 */
export function deviceKind(env: DeviceEnv, screen: { width: number; height: number }): DeviceKind {
  if (!touchPrimary(env)) return 'desktop';
  if (/iPhone|iPod/.test(env.userAgent) || /Android.*Mobile/i.test(env.userAgent)) return 'phone';
  if (/iPad/.test(env.userAgent)) return 'tablet';
  const side = Math.min(screen.width, screen.height);
  return side >= TABLET_MIN_SIDE ? 'tablet' : 'phone';
}

/** This browser's kind (`deviceKind` of the current environment and screen). */
export function currentDeviceKind(): DeviceKind {
  const s = typeof screen === 'undefined' ? undefined : screen;
  return deviceKind(readEnv(), { width: s?.width ?? 0, height: s?.height ?? 0 });
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

/**
 * Graphics Medium is too much for: Intel's integrated graphics (UHD, HD, Iris; not the Arc cards) and software
 * renderers (no graphics card drawing at all). In October 2026 Windows computers on Intel UHD 630 and Iris Xe
 * played Medium at about 30 fps with 1% lows of 10–20 even after the adaptive resolution had reached its 0.6
 * floor (a school's computer room among them), while AMD and NVIDIA cards held 60 or more.
 */
export function weakGpu(renderer: string): boolean {
  if (/swiftshader|llvmpipe|softpipe|basic render|software/i.test(renderer)) return true;
  return /\bintel\b/i.test(renderer) && !/\barc\b/i.test(renderer);
}

let renderer: string | undefined;
/** The graphics card as WebGL names it ('' without WebGL or a name), read once from a throwaway context. */
export function gpuRenderer(): string {
  if (renderer !== undefined) return renderer;
  renderer = '';
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* no WebGL, no document (tests) */ }
  return renderer;
}

/** Phones, tablets and computers on weak graphics (weakGpu) start on low graphics (lower resolution, lighter shadows, no bloom) unless the player chose. */
export const defaultQuality = (touch: boolean, gpu = ''): 'low' | 'medium' => touch || weakGpu(gpu) ? 'low' : 'medium';

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

/** Which browser's steps turn its hardware acceleration back on (the boot help when WebGL cannot start). */
export type GraphicsHelp = 'chrome' | 'edge' | 'firefox' | 'apple' | 'other';
export function graphicsHelp(userAgent: string): GraphicsHelp {
  if (/Edg(e|A|iOS)?\//.test(userAgent)) return 'edge';
  if (/Firefox\/|FxiOS\//.test(userAgent)) return 'firefox';
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && /Safari\//.test(userAgent) && !/Chrome\/|Chromium\//.test(userAgent))) return 'apple';
  if (/Chrome\/|Chromium\/|CriOS\//.test(userAgent)) return 'chrome';
  return 'other';
}

/** The page could not get a WebGL context (graphics acceleration off, a blocked driver, out of memory). */
export const isWebglFailure = (message: string) => /WebGL/i.test(message);
