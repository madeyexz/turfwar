/**
 * The share dialog: the card (sharecard.ts) as a preview, Share (the phone's share sheet, with the
 * picture), Save image and Copy link. It sits over the match or the end screen and keeps keys and
 * clicks away from the game while open.
 */
import type { MatchSummary } from '../game/matchstats';
import { bragText, cardBlob, copyText, download, drawShareCard, shareLink, shareNative } from './sharecard';
import { shareActs, shareFlow, type ShareMethod } from './sharechoice';
import { t } from './i18n';
import './share.css';

export type { ShareMethod };

export interface ShareOptions {
  summary: MatchSummary;
  url: string;
  backdrop?: CanvasImageSource & { width: number; height: number };
  meme: boolean;
  /** The code of the private 1v1 room the link opens (the dialog then speaks of sending a challenge). */
  room?: boolean;
  /** A line over the card (e.g. the 1v1 room that is open). */
  note?: string;
  /** Opened, and each time the player shares (analytics). */
  onShared?: (method: ShareMethod) => void;
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
  const label = (a: ShareMethod) => (a === 'native' || a === 'link' ? t(o.room ? 'chal.send' : 'share.native') : t(a === 'download' ? 'share.download' : 'share.copy'));
  root.innerHTML = `<div class="sp-box">
    <header><b>${t('share.title')}</b><button type="button" class="sp-close" aria-label="${t('share.close')}">×</button></header>
    ${o.note ? `<p class="sp-note"></p>` : ''}
    <div class="sp-body">
      <div class="sp-card"><span>${t('share.making')}</span></div>
      <div class="sp-acts">
        ${acts.map((a, i) => `<button type="button" class="${i ? '' : 'sp-go'}" data-act="${a}">${label(a)}</button>`).join('\n        ')}
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
    const canvas = await drawShareCard({ summary: o.summary, url: o.url, backdrop: o.backdrop, meme: o.meme });
    blob = await cardBlob(canvas);
    const img = new Image();
    img.alt = bragText(o.summary, o.meme);
    img.src = URL.createObjectURL(blob);
    root.querySelector('.sp-card')!.replaceChildren(img);
  } catch {
    root.querySelector('.sp-card')!.textContent = t('share.failed');
  }
  const file = () => new File([blob!], `turfwar-${o.summary.name.replace(/[^\p{L}\p{N}]+/gu, '') || 'card'}.png`, { type: 'image/png' });
  const text = bragText(o.summary, o.meme);
  const copyButton = () => root.querySelector<HTMLButtonElement>('[data-act="copy"]')!;
  const copied = () => {
    const b = copyButton();
    b.textContent = t('share.copied'); setTimeout(() => { b.textContent = label('copy'); }, 2000);
  };
  root.querySelector('.sp-acts')!.addEventListener('click', async e => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act as ShareMethod | undefined;
    if (!act) return;
    if (act === 'download') { if (blob) { download(blob, file().name); o.onShared?.('download'); } return; }
    // The share sheet needs the tap's own gesture: nothing is awaited before it.
    const first = act === 'copy' ? 'copy' : act === 'link' || !blob ? 'link' : 'native';
    const done = await shareFlow(first, {
      shareFile: () => shareNative(file(), t('share.text', { brag: text }), o.url),
      shareLink: () => shareLink(t('share.text', { brag: text }), o.url),
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
