import { CRAZYGAMES } from '../crazygames';
import { REC_TERMS_VERSION, TERMS_VERSION, type ExcludedBy } from '../../shared/rec/policy';

/**
 * Terms and the dataset switch (docs/RECORDING.md). Pressing Play accepts the Terms shown next to it
 * (clickwrap: the version is remembered in this browser and sent to the game server with `consent`).
 * "Exclude my matches from datasets" (Settings → Privacy) is off unless the player turns it on; the
 * browser's Global Privacy Control or Do Not Track turns it on and locks it, and the CrazyGames build is
 * always left out (their platform, their rules).
 */
const TERMS_KEY = 'lawbreaker.termsAccepted';
const EXCLUDE_KEY = 'lawbreaker.excludeDatasets';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage disabled */ } };

/** The browser's own opt-out signal: Global Privacy Control first, then Do Not Track (the same signals analytics honors). */
export function privacySignal(nav: Partial<Navigator> & { globalPrivacyControl?: boolean; msDoNotTrack?: string } = typeof navigator === 'undefined' ? {} : navigator,
  win: { doNotTrack?: string } = typeof window === 'undefined' ? {} : window as unknown as { doNotTrack?: string }): '' | 'gpc' | 'dnt' {
  if (nav.globalPrivacyControl === true) return 'gpc';
  const dnt = [nav.doNotTrack, nav.msDoNotTrack, win.doNotTrack];
  return dnt.some(v => v === '1' || v === 'yes') ? 'dnt' : '';
}

/** Why this player is left out of the datasets ('' = they are not). */
export function excludedBy(): ExcludedBy {
  if (CRAZYGAMES) return 'platform';
  const signal = privacySignal();
  if (signal) return signal;
  return read(EXCLUDE_KEY) === '1' ? 'setting' : '';
}
/** The switch can only be changed when no browser signal or platform decides it. */
export const excludeLocked = () => CRAZYGAMES || !!privacySignal();

const listeners = new Set<() => void>();
export function onConsent(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function setExcludeDatasets(on: boolean) { write(EXCLUDE_KEY, on ? '1' : '0'); for (const fn of listeners) fn(); }

/** Pressing Play accepts the current Terms. */
export function acceptTerms() { if (Number(read(TERMS_KEY)) !== TERMS_VERSION) write(TERMS_KEY, String(TERMS_VERSION)); }
export const acceptedTerms = () => Number(read(TERMS_KEY)) || 0;

/** What the `consent` reducer gets. */
export function consentState() {
  const by = excludedBy();
  return { termsVersion: acceptedTerms(), excluded: by !== '', excludedBy: by, platform: CRAZYGAMES ? 'crazygames' : 'web' };
}
/** Whether this browser may log its inputs now (the recorder applies the same rule on the server). */
export const mayRecord = () => acceptedTerms() >= REC_TERMS_VERSION && excludedBy() === '';
