import { installHint, openInBrowserUrl, readEnv, type InstallHint } from '../game/device';
import { onTouchLayout, touchActive } from '../game/touchlayout';
import { canPromptInstall, onInstallChange, promptInstall } from '../pwa';
import { onLang, t } from './i18n';
import './touch.css';

const KEY = 'lawbreaker.installHint';
const TIP_KEY = 'lawbreaker.touchTip';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage disabled */ } };
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
/** iOS's share icon (a box with an arrow out of it), as Safari draws it. */
const SHARE = '<svg class="share" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1"/></svg>';

/**
 * The lobby's install hint on phones and tablets that are not running the installed app: an Install
 * button where the browser offers one, Share → Add to Home Screen on iOS, short instructions
 * elsewhere, and a one-line tip (landscape, the touch layout editor). Dismissing it is remembered;
 * the installed app shows only the tip until that is dismissed too.
 */
export class InstallBanner {
  readonly el = document.createElement('aside');
  private readonly stops: (() => void)[] = [];

  constructor(parent: HTMLElement) {
    this.el.className = 'install-hint';
    this.el.setAttribute('role', 'region');
    parent.appendChild(this.el);
    this.el.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.act === 'install') void promptInstall().then(ok => { if (ok) write(KEY, 'installed'); this.render(); });
      // Closing the banner closes its tip too.
      if (b.dataset.act === 'close') { if (this.kind()) write(KEY, 'dismissed'); write(TIP_KEY, 'dismissed'); this.render(); }
    });
    this.stops.push(onInstallChange(() => this.render()), onTouchLayout(() => this.render()), onLang(() => this.render()));
    this.render();
  }

  private kind(): InstallHint | undefined {
    return installHint(readEnv(), { touch: touchActive(), dismissed: !!read(KEY), canPrompt: canPromptInstall() });
  }

  render() {
    const kind = this.kind();
    const tip = touchActive() && !read(TIP_KEY);
    this.el.hidden = !kind && !tip;
    this.el.classList.toggle('tip-only', !kind);
    if (this.el.hidden) return;
    const chrome = kind === 'browser' ? openInBrowserUrl(readEnv(), location.href) : undefined;
    const how = kind === 'ios' ? t('inst.ios', { share: '\u0000' }).split('\u0000').map(esc).join(SHARE) : kind ? esc(t(`inst.${kind}`)) : '';
    this.el.setAttribute('aria-label', kind ? t('inst.title') : t('inst.tipTitle'));
    // In an app's own browser the game still plays (sideways); the real browser gives full screen and installing.
    const title = kind === 'browser' ? t('inst.inAppTitle') : t('inst.title');
    this.el.innerHTML = (kind ? `<img class="mark" src="/icons/icon-192.png" alt="" width="40" height="40"><b>${esc(title)}</b><p>${how}</p>` : '')
      + `<div class="acts">${kind === 'prompt' ? `<button type="button" class="inst-go" data-act="install">${esc(t('inst.install'))}</button>` : ''}`
      + `${chrome ? `<a class="inst-go" href="${esc(chrome)}">${esc(t('inst.openChrome'))}</a>` : ''}<button type="button" class="x" data-act="close" aria-label="${esc(t('inst.dismiss'))}" title="${esc(t('inst.dismiss'))}">✕</button></div>`
      + (tip || kind ? `<p class="tip">${esc(t('inst.tip'))}</p>` : '');
  }

  dispose() { for (const f of this.stops) f(); this.el.remove(); }
}
