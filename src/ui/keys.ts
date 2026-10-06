import { binding, keyLabel, type ActionId, type InputCode } from '../game/keybinds';
import { t } from './i18n';

/** Mouse and wheel names in the current language (keyboard keys keep their printed label). */
const names = () => ({
  Mouse0: t('key.lmb'), Mouse1: t('key.mmb'), Mouse2: t('key.rmb'), Mouse3: t('key.mouseN', { n: 4 }), Mouse4: t('key.mouseN', { n: 5 }),
  WheelUp: t('key.wheelUp'), WheelDown: t('key.wheelDown'),
});
const escape = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** A key's label as the player sees it ("A", "Space", "L-Shift", "RMB", "Wheel ↑"). */
export const codeLabel = (code: InputCode) => keyLabel(code, names());
/** The label of the key an action is bound to (its primary key), for hints. */
export const keyOf = (action: ActionId) => codeLabel(binding(action)[0] ?? '');
/** `keyOf`, escaped for HTML. */
export const keyHtml = (action: ActionId) => escape(keyOf(action));
/** `<kbd>` with the action's primary key, for HTML hints ("<kbd>B</kbd> STORE"). */
export const kbd = (action: ActionId) => `<kbd>${escape(keyOf(action))}</kbd>`;
/** `<kbd>` for a fixed key code (Esc). */
export const kbdCode = (code: InputCode) => `<kbd>${escape(codeLabel(code))}</kbd>`;
