import { t } from './i18n';

/** The longest callsign: the lobby field's limit (the server keeps 20). */
export const CALLSIGN_MAX = 16;

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/**
 * A callsign the lobby made up rather than the player: blank, the random "Player-123" / "玩家123" a
 * new browser starts with, or the bare fallback. A player with one is asked for a name before playing.
 */
export function madeUpCallsign(name: string) {
  const n = name.trim();
  return !n || /^player-?\d{0,4}$/i.test(n) || /^玩家\d{0,4}$/.test(n);
}

/**
 * A typed callsign: trimmed, inner runs of spaces made one, at most CALLSIGN_MAX UTF-16 units (as the
 * field and the server count), never cutting a character such as an emoji in half.
 */
export function cleanCallsign(name: string) {
  let out = '';
  for (const ch of name.trim().replace(/\s+/g, ' ')) {
    if (out.length + ch.length > CALLSIGN_MAX) break;
    out += ch;
  }
  return out.trim();
}

/**
 * Before a first game: ask for a callsign, so the scoreboard, the kill feed and the server's player
 * list show a name the player chose. Play hands the name over from the same tap (a phone still goes
 * full screen); ✕, Esc or a tap outside goes back to the lobby without playing.
 */
export function askCallsign(current: string, play: (name: string) => void) {
  document.querySelector('.callsign-ask')?.remove();
  const el = document.createElement('div');
  el.className = 'callsign-ask';
  el.innerHTML = `<form class="panel" role="dialog" aria-modal="true" aria-labelledby="cs-title" novalidate>
    <header><h2 id="cs-title">${esc(t('cs.title'))}</h2><button type="button" class="x" data-act="close" aria-label="${esc(t('cs.close'))}" title="${esc(t('cs.close'))}">✕</button></header>
    <p class="why">${esc(t('cs.why'))}</p>
    <input type="text" name="callsign" maxlength="${CALLSIGN_MAX}" autocomplete="nickname" autocapitalize="words" spellcheck="false" enterkeyhint="go"
      placeholder="${esc(t('cs.placeholder'))}" aria-label="${esc(t('lobby.callsign'))}" value="${madeUpCallsign(current) ? '' : esc(current)}">
    <p class="err" role="alert" hidden></p>
    <button type="submit" class="go">${esc(t('cs.play'))}</button>
  </form>`;
  const form = el.querySelector('form')!, input = form.querySelector('input')!, err = form.querySelector<HTMLElement>('.err')!;
  const close = () => el.remove();
  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = cleanCallsign(input.value);
    if (madeUpCallsign(name)) {
      err.textContent = t(name ? 'cs.own' : 'cs.empty'); err.hidden = false;
      input.focus();
      return;
    }
    close();
    play(name);
  });
  input.addEventListener('input', () => { err.hidden = true; });
  el.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    if (target === el || target.closest('[data-act="close"]')) close();
  });
  // Keys typed here stay here: the lobby's shortcuts and its Enter-to-play must not see them.
  el.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  document.body.appendChild(el);
  input.focus({ preventScroll: true });
}
