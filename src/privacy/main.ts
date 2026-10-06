import './privacy.css';

/**
 * The /privacy page: both languages are in the HTML (stacked when scripts are off); this shows the
 * one the game would use and the toggle switches it for this visit, without changing the game's
 * saved language. It reads the language the way `src/ui/i18n.ts` does (`?lang=`, the saved
 * `lawbreaker.lang`, then the browser) without importing the game's dictionaries. No analytics here.
 */
type Lang = 'en' | 'zh-TW';
const root = document.documentElement;
const buttons = document.querySelectorAll<HTMLButtonElement>('.langs [data-lang]');

function initialLang(): Lang {
  const url = new URLSearchParams(location.search).get('lang')?.toLowerCase();
  if (url === 'en' || url?.startsWith('en-')) return 'en';
  if (url === 'zh' || url === 'tw' || url?.startsWith('zh-')) return 'zh-TW';
  try { const saved = localStorage.getItem('lawbreaker.lang'); if (saved === 'en' || saved === 'zh-TW') return saved; } catch { /* storage disabled */ }
  return /^zh-(tw|hk|mo|hant)\b/.test((navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase()) ? 'zh-TW' : 'en';
}

function show(next: Lang) {
  root.lang = next;
  root.dataset.lang = next;
  document.title = next === 'zh-TW' ? '隱私權 · 角頭械鬥' : 'Privacy · Turf War: Taipei';
  buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === next)));
}

buttons.forEach(b => b.addEventListener('click', () => show(b.dataset.lang as Lang)));
show(initialLang());
