/**
 * The share dialog: the card (sharecard.ts) as a preview, Share (the phone's share sheet, with the
 * picture), Save image and Copy link. It sits over the match or the end screen and keeps keys and
 * clicks away from the game while open.
 */
import type { MatchSummary } from '../game/matchstats';
import { bragText, cardBlob, copyText, download, drawShareCard, shareNative } from './sharecard';
import { t } from './i18n';
import './share.css';

export type ShareMethod = 'native' | 'download' | 'copy';

export interface ShareOptions {
  summary: MatchSummary;
  url: string;
  backdrop?: CanvasImageSource & { width: number; height: number };
  meme: boolean;
  /** A line over the card (e.g. the 1v1 room that is open). */
  note?: string;
  /** Opened, and each time the player shares (analytics). */
  onShared?: (method: ShareMethod) => void;
  onClose?: () => void;
}

const canShareFiles = () => {
  try { return !!navigator.canShare?.({ files: [new File([new Uint8Array(1)], 'x.png', { type: 'image/png' })] }); } catch { return false; }
};

let open: HTMLElement | undefined;

/** Opens the dialog (one at a time); resolves once the card is drawn. */
export async function openSharePanel(o: ShareOptions) {
  open?.remove();
  const root = document.createElement('div');
  root.className = 'share-panel';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', t('share.title'));
  const native = canShareFiles();
  root.innerHTML = `<div class="sp-box">
    <header><b>${t('share.title')}</b><button type="button" class="sp-close" aria-label="${t('share.close')}">×</button></header>
    ${o.note ? `<p class="sp-note"></p>` : ''}
    <div class="sp-body">
      <div class="sp-card"><span>${t('share.making')}</span></div>
      <div class="sp-acts">
        ${native ? `<button type="button" class="sp-go" data-act="native">${t('share.native')}</button>` : ''}
        <button type="button" class="${native ? '' : 'sp-go'}" data-act="download">${t('share.download')}</button>
        <button type="button" data-act="copy">${t('share.copy')}</button>
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
  root.querySelector('.sp-acts')!.addEventListener('click', async e => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act as ShareMethod | undefined;
    if (!act) return;
    if (act === 'native' && blob) {
      const r = await shareNative(file(), t('share.text', { brag: text }), o.url);
      if (r === 'native') o.onShared?.('native');
      if (r === 'unsupported') { download(blob, file().name); o.onShared?.('download'); }
    } else if (act === 'download' && blob) {
      download(blob, file().name); o.onShared?.('download');
    } else if (act === 'copy') {
      const ok = await copyText(o.url);
      const b = e.target as HTMLButtonElement;
      if (ok) { b.textContent = t('share.copied'); o.onShared?.('copy'); setTimeout(() => { b.textContent = t('share.copy'); }, 2000); }
      else (root.querySelector('.sp-url') as HTMLInputElement).select();
    }
  });
  return { close };
}

export const sharePanelOpen = () => !!open;
