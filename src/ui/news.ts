import { lang, onLang, t, type Lang } from './i18n';

/**
 * 最新更新 / Latest update: the lobby shows the newest entry, one line, with a NEW mark until the
 * player has seen it once. Hand-written for players (not commit messages): add an entry at the top
 * when a release brings something players will notice, in both languages, short.
 */
export interface NewsItem { id: string; date: string; text: Record<Lang, string> }

export const NEWS: readonly NewsItem[] = [
  { id: 'faster-chat-filter', date: '2026-10-15', text: { 'zh-TW': '手機載入更快（下載量少約四成），聊天會過濾髒話，設定裡也能關閉玩家聊天', en: 'Faster loading on phones, a chat swear filter, and a setting to turn player chat off' } },
  { id: 'molotov', date: '2026-10-14', text: { 'zh-TW': '新增燃燒彈（$400，按 7）：落地起火，站在火裡會被燒；煙霧彈可以滅火', en: 'New: the molotov ($400, key 7). It sets the floor alight; a smoke grenade puts it out' } },
  { id: 'invite-gold', date: '2026-10-14', text: { 'zh-TW': '新增「邀請朋友」：開私人房一鍵傳 LINE，揪 3 位朋友來玩解鎖金拖', en: 'Invite friends: a private room sent on LINE in one tap. 3 friends unlock the gold slipper' } },
  { id: 'skins-broom', date: '2026-10-13', text: { 'zh-TW': '新增外觀：刀可以換成掃把，民兵也能挑角色（大廳右上的衣服）', en: 'Skins: swap the knife for a broom and pick your Militia character (the T-shirt, top right)' } },
  { id: 'discord-community', date: '2026-10-11', text: { 'zh-TW': '新增 discord 社群，歡迎加入！', en: 'Our Discord community is now open. Come join us!' } },
  { id: 'challenge-friend', date: '2026-10-11', text: { 'zh-TW': '結算畫面的「約朋友單挑」，一鍵把連結傳給朋友', en: '"Challenge a friend" on the end screen sends a 1v1 link in one tap' } },
  { id: 'slipper-throw', date: '2026-10-10', text: { 'zh-TW': '藍白拖可投擲，蓄滿力後可秒殺敵人', en: 'The slipper can be thrown, and a full wind-up kills in one hit' } },
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
