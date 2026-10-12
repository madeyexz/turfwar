import { reportBootFailure, watchEarlyErrors } from './errors';
import { startAnalytics } from './analytics';
import { t } from './ui/i18n';
import { serverHost } from './net/ping';
import { asFailure, scrub } from './exceptions';

watchEarlyErrors();
// Keep the game in its own chunk: even a failed import can be reported by this small entry point.
void import('./main').catch(error => {
  reportBootFailure(error);
  startAnalytics({ lang: document.documentElement.lang, online_db: import.meta.env.VITE_SPACETIMEDB_DATABASE || '', server_host: serverHost(import.meta.env.VITE_SPACETIMEDB_URI || ''), server_choice: '' });
  console.error('Game module failed to load', error);
  const app = document.getElementById('app');
  if (app) app.textContent = t('lobby.unableToStart', { error: scrub(asFailure(error).message) });
});
