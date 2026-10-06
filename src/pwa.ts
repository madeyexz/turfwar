/**
 * The installable app: registers the service worker (production builds only; `public/` has no
 * worker in the dev server) and keeps the browser's install prompt (`beforeinstallprompt`, Android
 * Chrome, Edge, Samsung Internet) so the lobby's install hint can offer an Install button.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | undefined;
const listeners = new Set<() => void>();
const notify = () => { for (const f of listeners) f(); };

if (typeof window !== 'undefined') {
  addEventListener('beforeinstallprompt', e => {
    // Keep the browser's own mini-infobar away; the lobby shows its hint instead.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  addEventListener('appinstalled', () => { deferred = undefined; notify(); });
}

/** Whether the browser will show its install dialog when asked. */
export const canPromptInstall = () => !!deferred;
/** Show the browser's install dialog (from a tap). Resolves true when the player installed. */
export async function promptInstall() {
  const e = deferred;
  if (!e) return false;
  deferred = undefined;
  await e.prompt();
  const choice = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  notify();
  return choice.outcome === 'accepted';
}
/** Called when the prompt becomes available or is used up. */
export function onInstallChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

/** Register `/sw.js` once the page has loaded (it caches the app for the next visit). */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const go = () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(error => console.warn('Service worker not registered', error)); };
  if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
}

/**
 * After the game's assets have loaded: hand the worker the list of same-origin files this page
 * fetched, so a first visit (which loads before the worker takes control) is cached as well.
 */
export function warmServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.ready.then(reg => {
    const urls = performance.getEntriesByType('resource').map(e => e.name).filter(u => u.startsWith(location.origin));
    reg.active?.postMessage({ type: 'warm', urls });
  }, () => undefined);
}
