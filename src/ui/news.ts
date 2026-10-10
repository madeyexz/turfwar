import { lang, onLang, t, type Lang } from './i18n';

/**
 * 最新更新 / Latest update: the lobby shows the newest entry, one line, with a NEW mark until the
 * player has seen it once. Hand-written for players (not commit messages): add an entry at the top
 * when a release brings something players will notice, in both languages, short.
 */
export interface NewsItem { id: string; date: string; text: Record<Lang, string> }

export const NEWS: readonly NewsItem[] = [
  { id: 'slipper-throw', date: '2026-10-10', text: { 'zh-TW': '新增：藍白拖可投擲，蓄滿力後可秒殺敵人', en: 'New: the slipper can be thrown, and a full wind-up kills in one hit' } },
];

const SEEN = 'lawbreaker.newsSeen';
const read = () => { try { return localStorage.getItem(SEEN); } catch { return null; } };
const write = (v: string) => { try { localStorage.setItem(SEEN, v); } catch { /* storage disabled */ } };
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** "10/10" from "2026-10-10". */
export const shortDate = (date: string) => { const [, m, d] = date.split('-'); return `${Number(m)}/${Number(d)}`; };

/** The latest entry, rendered into `el`; NEW stays up for this visit and is gone on the next one. */
export function mountNews(el: HTMLElement, items: readonly NewsItem[] = NEWS) {
  const item = items[0];
  el.hidden = !item;
  if (!item) return;
  const fresh = read() !== item.id;
  write(item.id);
  const render = () => {
    el.setAttribute('aria-label', t('news.title'));
    el.innerHTML = `<div class="news-head"><b>${esc(t('news.title'))}</b>${fresh ? `<span class="news-new">${esc(t('news.new'))}</span>` : ''}<time datetime="${item.date}">${shortDate(item.date)}</time></div>`
      + `<p>${esc(item.text[lang()])}</p>`;
  };
  render();
  onLang(render);
}
