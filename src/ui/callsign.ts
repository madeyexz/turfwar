import { offensiveName } from '../../shared/names';
import { ask } from './ask';
import { t } from './i18n';

/** The longest callsign: the lobby field's limit (the server keeps 20). */
export const CALLSIGN_MAX = 16;

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
 * list show a name the player chose (the lobby's `ask` dialog; Play starts from the same tap).
 */
export function askCallsign(current: string, play: (name: string) => void) {
  ask({
    title: t('cs.title'), why: t('cs.why'), label: t('lobby.callsign'), placeholder: t('cs.placeholder'),
    go: t('cs.play'), close: t('cs.close'), maxLength: CALLSIGN_MAX,
    value: madeUpCallsign(current) ? '' : current, attrs: 'autocomplete="nickname" autocapitalize="words"',
    check: raw => {
      const name = cleanCallsign(raw);
      if (offensiveName(name)) return { error: t('cs.rude') };
      return madeUpCallsign(name) ? { error: t(name ? 'cs.own' : 'cs.empty') } : { ok: name };
    },
    done: play,
  });
}
