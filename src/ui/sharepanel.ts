/**
 * The share dialog: the card (sharecard.ts) as a preview; the message to send (prefilled with the
 * match's brag line, editable); LINE and Threads (their share pages, sendto.ts), the phone's share
 * sheet with the picture (IG Stories), Save image and Copy link; and, for a card without a room,
 * 改開 1v1 房間 (the end screen's 約朋友單挑). It sits over the match or the end screen and keeps keys and
 * clicks away from the game while open.
 */
import type { MatchSummary } from '../game/matchstats';
import { bragText, cardBlob, copyText, download, drawShareCard, mapLabel, shareLink, shareNative } from './sharecard';
import { shareActs, shareFlow, type ShareMethod } from './sharechoice';
import { escapeHtml, t } from './i18n';
import { sendTo, type SendApp } from './sendto';
import './share.css';
import type { KnifeSkin } from '../../shared/skins';

/** How a card went out: a share-dialog way (sharechoice.ts) or an app's share page. */
export type SentMethod = ShareMethod | SendApp;
export type { ShareMethod };

export interface ShareOptions {
  summary: MatchSummary;
  url: string;
  backdrop?: CanvasImageSource & { width: number; height: number };
  /** The player's knife skin (names their knife kills). */
  knife: KnifeSkin;
  /** The code of the private 1v1 room the link opens (the dialog then speaks of sending a challenge). */
  room?: boolean;
  /** A line over the card (e.g. the 1v1 room that is open). */
  note?: string;
  /** Each time the player shares (analytics). */
  onShared?: (method: SentMethod) => void;
  /** 改開 1v1 房間: open a private 1v1 room and share its link instead (cards without a room). */
  onDuel?: () => void;
  onClose?: () => void;
}

const canShareFiles = () => {
  try { return !!navigator.canShare?.({ files: [new File([new Uint8Array(1)], 'x.png', { type: 'image/png' })] }); } catch { return false; }
};
const canShareLink = () => typeof navigator.share === 'function';

let open: HTMLElement | undefined;

/** Opens the dialog (one at a time); resolves once the card is drawn. */
export async function openSharePanel(o: ShareOptions) {
  open?.remove();
  const root = document.createElement('div');
  root.className = o.room ? 'share-panel sp-room' : 'share-panel';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', t('share.title'));
  const acts = shareActs({ files: canShareFiles(), link: canShareLink() }, !!o.room);
  // The main button is the first; a room's is worded as sending the challenge.
  const label = (a: ShareMethod) => (a === 'native' ? t('share.picture') : a === 'link' ? t('share.native') : t(a === 'download' ? 'share.download' : 'share.copy'));
  root.innerHTML = `<div class="sp-box">
    <header><b>${t('share.title')}</b><button type="button" class="sp-close" aria-label="${t('share.close')}">×</button></header>
    ${o.note ? `<p class="sp-note"></p>` : ''}
    <div class="sp-body">
      <div class="sp-card"><span>${t('share.making')}</span></div>
      <div class="sp-acts">
        <label class="sp-say">${escapeHtml(t('share.say'))}<textarea rows="3" maxlength="300"></textarea></label>
        <div class="sp-apps">
          <button type="button" class="sp-line" data-act="line">${escapeHtml(t('invite.line'))}</button>
          <button type="button" class="sp-threads" data-act="threads">${escapeHtml(t('invite.threads'))}</button>
          ${acts.map(a => `<button type="button" data-act="${a}">${label(a)}</button>`).join('\n          ')}
        </div>
        ${!o.room && o.onDuel ? `<button type="button" class="sp-duel" data-act="duel">${escapeHtml(t('share.duelRoom'))}</button>` : ''}
        <input class="sp-url" readonly aria-label="${t('share.copy')}">
        <p class="sp-hold">${t('share.hold')}</p>
      </div>
    </div>
  </div>`;
  if (o.note) root.querySelector('.sp-note')!.textContent = o.note;
  (root.querySelector('.sp-url') as HTMLInputElement).value = o.url;
  open = root;
  const close = () => { root.remove(); if (open === root) open = undefined; o.onClose?.(); };
  // The game listens on the document: keep the dialog's keys and clicks to itself.
  for (const type of ['keydown', 'keyup', 'pointerdown', 'mousedown', 'wheel'] as const) root.addEventListener(type, e => {
    e.stopPropagation();
    if (type === 'keydown' && (e as KeyboardEvent).key === 'Escape') close();
  });
  root.addEventListener('click', e => { if (e.target === root) close(); });
  root.querySelector('.sp-close')!.addEventListener('click', close);
  document.body.appendChild(root);

  let blob: Blob | undefined;
  try {
    const canvas = await drawShareCard({ summary: o.summary, url: o.url, backdrop: o.backdrop, knife: o.knife });
    blob = await cardBlob(canvas);
    const img = new Image();
    img.alt = bragText(o.summary, o.knife);
    img.src = URL.createObjectURL(blob);
    root.querySelector('.sp-card')!.replaceChildren(img);
  } catch {
    root.querySelector('.sp-card')!.textContent = t('share.failed');
  }
  const file = () => new File([blob!], `turfwar-${o.summary.name.replace(/[^\p{L}\p{N}]+/gu, '') || 'card'}.png`, { type: 'image/png' });
  const text = bragText(o.summary, o.knife);
  const say = root.querySelector('textarea')!;
  const words = { brag: text, map: mapLabel(o.summary.mapId), kills: o.summary.kills };
  say.value = t(o.room ? 'share.sayRoom' : 'share.text', words);
  // The words typed here stay the player's (the dialog keeps keys from the game).
  const message = () => say.value.trim() || t('share.text', words);
  const copyButton = () => root.querySelector<HTMLButtonElement>('[data-act="copy"]')!;
  const copied = () => {
    const b = copyButton();
    b.textContent = t('share.copied'); setTimeout(() => { b.textContent = label('copy'); }, 2000);
  };
  root.querySelector('.sp-acts')!.addEventListener('click', async e => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act as SentMethod | 'duel' | undefined;
    if (!act) return;
    if (act === 'download') { if (blob) { download(blob, file().name); o.onShared?.('download'); } return; }
    if (act === 'line' || act === 'threads') { sendTo(act, `${message()}\n${o.url}`); o.onShared?.(act); return; }
    if (act === 'duel') { close(); o.onDuel?.(); return; }
    // The share sheet needs the tap's own gesture: nothing is awaited before it.
    const first = act === 'copy' ? 'copy' : act === 'link' || !blob ? 'link' : 'native';
    const done = await shareFlow(first, {
      shareFile: () => shareNative(file(), message(), o.url),
      shareLink: () => shareLink(message(), o.url),
      copy: () => copyText(o.url),
    });
    if (done === 'cancel') return;
    if (done === 'failed') { (root.querySelector('.sp-url') as HTMLInputElement).select(); return; }
    if (done === 'copy') copied();
    o.onShared?.(done);
  });
  return { close };
}

export const sharePanelOpen = () => !!open;
