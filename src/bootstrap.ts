import { reportBootFailure, watchEarlyErrors } from './errors';
import { startAnalytics } from './analytics';
import { hasChosenLang, langFromLocale, setLang, t } from './ui/i18n';
import { serverHost } from './net/ping';
import { asFailure, scrub } from './exceptions';
import { CRAZYGAMES, crazyLoadingStart, crazyLocale, crazyRestore, initCrazyGames } from './crazygames';

/**
 * The CrazyGames build starts their SDK first (it waits at most a few seconds): loading is reported to
 * it, and the language follows the locale CrazyGames reports unless the player chose one.
 */
async function platform() {
  if (!CRAZYGAMES) return;
  await initCrazyGames();
  crazyLoadingStart();
  // Saved progress from the player's CrazyGames account, before the game reads it.
  crazyRestore();
  const locale = crazyLocale();
  if (locale && !hasChosenLang()) setLang(langFromLocale(locale), false);
}

watchEarlyErrors();
// Keep the game in its own chunk: even a failed import can be reported by this small entry point.
void platform().then(() => import('./main')).catch(error => {
  reportBootFailure(error);
  startAnalytics({ lang: document.documentElement.lang, online_db: import.meta.env.VITE_SPACETIMEDB_DATABASE || '', server_host: serverHost(import.meta.env.VITE_SPACETIMEDB_URI || ''), server_choice: '' });
  console.error('Game module failed to load', error);
  const app = document.getElementById('app');
  if (app) app.textContent = t('lobby.unableToStart', { error: scrub(asFailure(error).message) });
});
