/**
 * The /thanks page: both languages are in the HTML (stacked when scripts are off). This shows the one the
 * game would use (`?lang=`, the saved `lawbreaker.lang`, then the browser), like src/privacy/main.ts, and
 * the toggle switches it for this visit without changing the game's saved language. No analytics here.
 */
type Lang = 'en' | 'zh-TW';
const root = document.documentElement;
const buttons = document.querySelectorAll<HTMLButtonElement>('.langs [data-lang]');
// The page's own title is the Chinese one; the English one is on <title data-en> (no Chinese text here: src/ui/font.test.ts reads src/ for the game font).
const titles = { 'zh-TW': document.title, en: document.querySelector('title')?.dataset.en ?? document.title };

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
  document.title = titles[next];
  buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === next)));
}

buttons.forEach(b => b.addEventListener('click', () => show(b.dataset.lang as Lang)));
show(initialLang());
