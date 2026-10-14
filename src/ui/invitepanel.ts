/**
 * 邀請朋友: the dialog over a private room we just opened. The room's code, who is in it (kept up to
 * date), and the ways to send its link: LINE and Threads (their share pages), copy, the phone's share
 * sheet, and a QR code for a friend sitting next to you. 開始對戰 closes it and plays on; bots hold the
 * seats until friends arrive and take them.
 */
import qrcode from 'qrcode-generator';
import { copyText, shareLink } from './sharecard';
import { sendTo } from './sendto';
import { escapeHtml, t } from './i18n';
import './share.css';

export type InviteMethod = 'line' | 'threads' | 'copy' | 'native';

export interface InviteOptions {
  code: string;
  url: string;
  /** "西門町 · 6v6 殲滅戰". */
  where: string;
  /** The humans in the room now (us first), polled while the dialog is open. */
  people: () => { name: string; me: boolean }[];
  /** Seats a side, for the empty rows. */
  seats: number;
  onSent?: (method: InviteMethod) => void;
  onClose?: () => void;
}

let open: HTMLElement | undefined;

/** A QR code of `url` as an SVG (dark modules on white, a quiet zone round it). */
function qrSvg(url: string) {
  const q = qrcode(0, 'M');
  q.addData(url); q.make();
  const n = q.getModuleCount(), pad = 3, size = n + pad * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + pad} ${r + pad}h1v1h-1z`;
  return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** Opens the dialog (one at a time). */
export function openInvitePanel(o: InviteOptions) {
  open?.remove();
  const root = document.createElement('div');
  root.className = 'share-panel invite-panel';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', t('invite.title'));
  const native = typeof navigator.share === 'function';
  const host = o.url.replace(/^https?:\/\//, '');
  root.innerHTML = `<div class="sp-box">
    <header><b>${escapeHtml(t('invite.title'))}</b><span class="ip-code">${escapeHtml(o.code)}</span><span class="ip-where">${escapeHtml(o.where)}</span><button type="button" class="sp-close" aria-label="${escapeHtml(t('share.close'))}">×</button></header>
    <div class="ip-cols">
      <div class="ip-people"><h4></h4><div class="ip-rows"></div>
        <p class="ip-hint">${escapeHtml(t('invite.hint'))}<br>${escapeHtml(t('invite.hint2'))}</p></div>
      <div class="ip-send"><h4>${escapeHtml(t('invite.send'))}</h4>
        <div class="ip-apps">
          <button type="button" class="line" data-act="line">${escapeHtml(t('invite.line'))}</button>
          <button type="button" class="threads" data-act="threads">${escapeHtml(t('invite.threads'))}</button>
          <button type="button" data-act="copy">${escapeHtml(t('share.copy'))}</button>
          ${native ? `<button type="button" data-act="native">${escapeHtml(t('invite.more'))}</button>` : ''}
        </div>
        <div class="ip-link">${qrSvg(o.url)}<div><span>${escapeHtml(t('invite.scan'))}</span><input readonly aria-label="${escapeHtml(t('share.copy'))}"></div></div>
      </div>
    </div>
    <button type="button" class="ip-play" data-act="play">${escapeHtml(t('invite.play'))}</button>
  </div>`;
  const input = root.querySelector('input')!;
  input.value = host;
  const text = `${t('invite.text', { code: o.code })}\n${o.url}`;

  let timer = 0;
  const close = () => { clearInterval(timer); root.remove(); if (open === root) open = undefined; o.onClose?.(); };
  const people = () => {
    const list = o.people(), rows = Math.max(list.length + 1, Math.min(o.seats, 5));
    root.querySelector('.ip-people h4')!.textContent = t('invite.people', { n: list.length });
    root.querySelector('.ip-rows')!.innerHTML = Array.from({ length: rows }, (_, i) => {
      const p = list[i];
      return p ? `<div class="ip-row${p.me ? ' me' : ''}"><i></i>${escapeHtml(p.name)}${p.me ? `<em>${escapeHtml(t('invite.host'))}</em>` : ''}</div>`
        : `<div class="ip-row wait"><i></i>${escapeHtml(t('invite.waiting'))}</div>`;
    }).join('');
  };
  people();
  timer = window.setInterval(people, 1000);

  // The game listens on the document: keep the dialog's keys and clicks to itself.
  for (const type of ['keydown', 'keyup', 'pointerdown', 'mousedown', 'wheel'] as const) root.addEventListener(type, e => {
    e.stopPropagation();
    if (type === 'keydown' && (e as KeyboardEvent).key === 'Escape') close();
  });
  root.addEventListener('click', e => {
    if (e.target === root) return close();
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!btn) return;
    if (btn.classList.contains('sp-close') || btn.dataset.act === 'play') return close();
    const act = btn.dataset.act as InviteMethod | undefined;
    if (act === 'line' || act === 'threads') { sendTo(act, text); o.onSent?.(act); return; }
    if (act === 'copy') {
      void copyText(o.url).then(ok => {
        if (!ok) { input.focus(); input.select(); return; }
        btn.textContent = t('share.copied');
        setTimeout(() => { btn.textContent = t('share.copy'); }, 1600);
        o.onSent?.('copy');
      });
      return;
    }
    if (act === 'native') void shareLink(t('invite.text', { code: o.code }), o.url).then(r => { if (r === 'native') o.onSent?.('native'); });
  });
  open = root;
  document.body.appendChild(root);
}
