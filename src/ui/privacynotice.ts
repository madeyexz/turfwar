import { onLang, t } from './i18n';

const KEY = 'turfwar.privacyNotice';

/**
 * The CrazyGames build's first-visit note that the game collects data beyond their SDK (PostHog, the game
 * server), linking the privacy page. CrazyGames asks for a notice, not a pop-up that blocks play: a small
 * card in the lobby until the player dismisses it (remembered in this browser).
 */
export function mountPrivacyNotice(parent: HTMLElement, href: () => string) {
  try { if (localStorage.getItem(KEY)) return; } catch { /* storage disabled: show it each visit */ }
  const el = document.createElement('aside');
  el.className = 'privacy-notice';
  el.innerHTML = '<p></p><div class="acts"><a target="_blank" rel="noopener"></a><button type="button"></button></div>';
  const render = () => {
    el.querySelector('p')!.textContent = t('privacy.notice');
    const link = el.querySelector('a')!;
    link.textContent = t('privacy.noticeLink');
    link.href = href();
    el.querySelector('button')!.textContent = t('privacy.noticeOk');
  };
  render();
  const off = onLang(render);
  el.querySelector('button')!.onclick = () => {
    try { localStorage.setItem(KEY, '1'); } catch { /* storage disabled */ }
    off();
    el.remove();
  };
  parent.appendChild(el);
}
