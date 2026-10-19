/**
 * The CrazyGames build (`bun run build:crazygames`, `vite --mode crazygames`): the flag that hides what
 * CrazyGames does not allow (links back to our own site, the service worker and install hint, our
 * fullscreen button), and a thin wrapper around their HTML5 SDK v3 (docs.crazygames.com/sdk/intro).
 *
 * index.html loads the SDK script in that build only. Every call here is a no-op on the website, when an
 * ad blocker stopped the script, and in the SDK's `disabled` environment (any domain but theirs and
 * localhost), so callers never check. On localhost the SDK runs in its `local` mode (fake ads, console logs);
 * `?useLocalSdk=true` forces that mode elsewhere, and `?disableChat=true` / `?muteAudio=true` set its settings.
 */

/** True in the CrazyGames build. */
export const CRAZYGAMES = import.meta.env.MODE === 'crazygames';

export interface CrazyUser { username: string; profilePictureUrl: string }
export interface CrazySettings { disableChat: boolean; muteAudio: boolean }
export type InviteParams = Record<string, string>;

/** The part of `window.CrazyGames.SDK` this game uses. */
export interface CrazySdk {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  game: {
    loadingStart(): void; loadingStop(): void;
    gameplayStart(): void; gameplayStop(): void;
    happytime(): void;
    settings: CrazySettings;
    addSettingsChangeListener(f: (s: CrazySettings) => void): void;
    isInstantMultiplayer?: boolean;
    inviteParams: InviteParams | null;
    inviteLink(params: InviteParams): string;
    updateRoom(input: { roomId?: string; isJoinable?: boolean; inviteParams?: InviteParams }): void;
    leftRoom(): void;
    addJoinRoomListener(f: (params: InviteParams) => void): void;
  };
  ad: {
    requestAd(type: 'midgame' | 'rewarded', callbacks: { adStarted(): void; adFinished(): void; adError(error: { code: string; message: string }): void }): void;
  };
  /** The Data module (like localStorage; with the CrazyGames account when logged in). Throws when it is off. */
  data?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  user: {
    isUserAccountAvailable: boolean;
    systemInfo?: { locale?: string; countryCode?: string; device?: { type?: string } };
    getUser(): Promise<CrazyUser | null>;
  };
}

declare global { interface Window { CrazyGames?: { SDK?: CrazySdk } } }

let sdk: CrazySdk | undefined;
let playing = false;

/**
 * Start the SDK (once, on the loading screen). Resolves when it is ready, or after `timeoutMs` without it
 * (the game never waits longer than that on CrazyGames' servers). `source` is for tests.
 */
export async function initCrazyGames(source: CrazySdk | undefined = CRAZYGAMES ? window.CrazyGames?.SDK : undefined, timeoutMs = 4000) {
  if (!source || sdk) return;
  try {
    const ready = await Promise.race([source.init().then(() => true), new Promise<false>(r => setTimeout(() => r(false), timeoutMs))]);
    if (ready && source.environment !== 'disabled') sdk = source;
  } catch (error) {
    console.warn('CrazyGames SDK not started', error);
  }
}

/**
 * What CrazyGames' Data module keeps besides this browser: level and progress (with the daily streak), the
 * warm-up flag, the knife and character skins, key bindings and the crosshair. A logged-in player has them on
 * any device; the game ID (the server identity) stays on this browser only.
 */
export const SAVED_KEYS = ['lawbreaker.progress', 'lawbreaker.warmup', 'lawbreaker.skin', 'lawbreaker.keys', 'lawbreaker.crosshair'];
/** Off after the module first fails (not enabled for the game): no warning on every save. */
let dataOff = false;

function withData(f: (data: NonNullable<CrazySdk['data']>, local: Storage) => void) {
  if (!sdk?.data || dataOff) return;
  try { f(sdk.data, localStorage); } catch (error) { dataOff = true; console.warn('CrazyGames Data module unavailable', error); }
}

/** XP in a saved progress value (to keep the further one of two). */
const xpOf = (raw: string | null) => { try { return Number((JSON.parse(raw ?? '') as { xp?: unknown }).xp) || 0; } catch { return 0; } };

/**
 * At start, before the game reads its storage: what the Data module holds wins (the account's on a new device),
 * except progress, where the one with more XP wins; what only this browser has is copied to the module (players
 * from before it).
 */
export function crazyRestore(keys = SAVED_KEYS) {
  withData((data, local) => {
    for (const key of keys) {
      const saved = data.getItem(key), here = local.getItem(key);
      if (saved === here) continue;
      if (saved !== null && (key !== 'lawbreaker.progress' || xpOf(saved) >= xpOf(here))) local.setItem(key, saved);
      else if (here !== null) data.setItem(key, here);
    }
  });
}

/** Copy what changed in this browser to the Data module (it saves within a second or so). */
export function crazySave(keys = SAVED_KEYS) {
  withData((data, local) => {
    for (const key of keys) {
      const here = local.getItem(key);
      if (here !== null && data.getItem(key) !== here) data.setItem(key, here);
    }
  });
}

/** Whether the SDK is running (CrazyGames build, on their site or localhost). */
export const crazyActive = () => !!sdk;

/** Calls `f` with the SDK when it runs; a failing call is logged, never thrown into the game. */
function call<T>(f: (s: CrazySdk) => T): T | undefined {
  if (!sdk) return undefined;
  try { return f(sdk); } catch (error) { console.warn('CrazyGames SDK call failed', error); return undefined; }
}

export const crazyLoadingStart = () => call(s => s.game.loadingStart());
export const crazyLoadingStop = () => call(s => s.game.loadingStop());

/** The player is in a match (or out of it): CrazyGames measures play time and places ads from these. */
export function crazyGameplay(on: boolean) {
  if (on === playing) return;
  playing = on;
  call(s => on ? s.game.gameplayStart() : s.game.gameplayStop());
}

/** A big moment (a won match): CrazyGames celebrates on the page. Use sparingly. */
export const crazyHappytime = () => call(s => s.game.happytime());

/** The platform's settings now; both false off CrazyGames. */
export const crazySettings = (): CrazySettings => call(s => ({ ...s.game.settings })) ?? { disableChat: false, muteAudio: false };
/** `f` now and whenever the platform's settings change. */
export function onCrazySettings(f: (s: CrazySettings) => void) {
  f(crazySettings());
  call(s => s.game.addSettingsChangeListener(next => f({ ...next })));
}

/** The browser locale CrazyGames reports ("en-US", "zh-TW"), if any. */
export const crazyLocale = () => call(s => s.user.systemInfo?.locale);

/** The logged-in CrazyGames user, or null for a guest or off CrazyGames. */
export async function crazyUser(): Promise<CrazyUser | null> {
  if (!sdk?.user.isUserAccountAvailable) return null;
  try { return await sdk.user.getUser(); } catch { return null; }
}

/** Whether CrazyGames asks the game to drop the player straight into a joinable room. */
export const crazyInstantMultiplayer = () => !!call(s => s.game.isInstantMultiplayer);
/** One parameter of the invite link the game was opened from, or null. */
export const crazyInviteParam = (name: string) => call(s => s.game.inviteParams?.[name]) ?? null;
/** A CrazyGames link that opens the game with `params` (in place of our own invite link), or undefined off CrazyGames. */
export const crazyInviteLink = (params: InviteParams) => call(s => s.game.inviteLink(params));
/**
 * Our own link (an invite `/r/<code>?ref=…` or a challenge `/c?…`) as CrazyGames invite parameters, without
 * the UTM tags (a CrazyGames link carries its own attribution): `r` the room code, `c` a challenge.
 */
export function linkParams(url: string): InviteParams {
  const u = new URL(url, 'https://x.invalid');
  const out: InviteParams = {};
  const room = /^\/r\/([A-Za-z]{4})\/?$/.exec(u.pathname);
  if (room) out.r = room[1];
  else if (/^\/c\/?$/.test(u.pathname)) out.c = '1';
  for (const [k, v] of u.searchParams) if (!k.startsWith('utm_')) out[k] = v;
  return out;
}

/** The address invite parameters stand for (what `parseInvite` / `parseChallenge` read), or undefined. */
export function linkPlace(params: InviteParams): { pathname: string; search: string } | undefined {
  if (params.r) {
    const { r, ...rest } = params;
    return { pathname: `/r/${r}`, search: `?${new URLSearchParams(rest)}` };
  }
  if (params.c) return { pathname: '/c', search: `?${new URLSearchParams(params)}` };
  return undefined;
}

/** A link we hand out: on CrazyGames their invite link to the same room or challenge (never our own site), else as it is. */
export const shareableLink = (url: string) => crazyInviteLink(linkParams(url)) ?? url;
/** The invite or challenge the game was opened with on CrazyGames, as an address. */
export const crazyLinkPlace = () => call(s => s.game.inviteParams ? linkPlace(s.game.inviteParams) : undefined);

/** The room the player is in, for CrazyGames' "join friend" buttons. */
export const crazyRoom = (roomId: string, isJoinable: boolean, inviteParams: InviteParams) => call(s => s.game.updateRoom({ roomId, isJoinable, inviteParams }));
export const crazyLeftRoom = () => call(s => s.game.leftRoom());
/** A friend's invite was accepted while the game was already open. */
export const onCrazyJoinRoom = (f: (params: InviteParams) => void) => call(s => s.game.addJoinRoomListener(f));

/**
 * A midgame video ad at a natural break (after a match). Resolves when it ended, failed or was not
 * filled (always, during Basic Launch); the SDK itself keeps ads at least 3 minutes apart. `mute` runs
 * only when an ad really starts, and `unmute` after it if it did. A clear sheet stops taps on the
 * game's UI while the request is open, as CrazyGames asks.
 */
export function crazyMidgameAd(mute: () => void, unmute: () => void): Promise<void> {
  const s = sdk;
  if (!s) return Promise.resolve();
  const sheet = document.createElement('div');
  sheet.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
  document.body.append(sheet);
  return new Promise<void>(resolve => {
    let started = false, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sheet.remove();
      if (started) unmute();
      resolve();
    };
    try {
      s.ad.requestAd('midgame', {
        adStarted: () => { started = true; mute(); },
        adFinished: finish,
        adError: finish,
      });
    } catch (error) {
      console.warn('CrazyGames ad request failed', error);
      finish();
    }
  });
}

/** Tests only: forget the SDK. */
export function resetCrazyGamesForTest() { sdk = undefined; playing = false; dataOff = false; }
