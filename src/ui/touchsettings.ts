import { TOUCH_PREFS, readEnv, touchPrimary, type TouchPref } from '../game/device';
import { TOUCH_SENS_RANGE, onTouchLayout, setTouchPref, setTouchSensitivity, touchActive, touchPref, touchSensitivity } from '../game/touchlayout';
import { onLang, t } from './i18n';
import { openTouchEditor } from './toucheditor';
import './touch.css';

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/**
 * The touch section at the top of Settings → Controls: touch controls Auto / On / Off, the finger
 * look speed, and the button that opens the layout editor.
 */
export class TouchSettings {
  readonly el = document.createElement('section');
  private readonly stops: (() => void)[] = [];

  constructor() {
    this.el.className = 'ts-touch';
    this.render();
    this.stops.push(onTouchLayout(() => this.refresh()), onLang(() => this.render()));
    this.el.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.pref) { setTouchPref(b.dataset.pref as TouchPref); return; }
      if (b.dataset.act === 'edit') openTouchEditor();
    });
    this.el.addEventListener('input', e => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.in === 'tsens') { (el.nextElementSibling as HTMLElement).textContent = `${Number(el.value).toFixed(2)}×`; }
    });
    this.el.addEventListener('change', e => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.in === 'tsens') setTouchSensitivity(Number(el.value));
    });
    // Keys typed into the slider must not reach the game or the key-binding panel.
    this.el.addEventListener('keydown', e => e.stopPropagation());
  }

  private render() {
    const label = (p: TouchPref) => t(`ts.${p}`);
    this.el.innerHTML = `
      <h3>${esc(t('ts.title'))}</h3>
      <div class="ts-row"><span>${esc(t('ts.mode'))}</span><div class="seg" role="group">${TOUCH_PREFS.map(p => `<button type="button" data-pref="${p}">${esc(label(p))}</button>`).join('')}</div><small class="note" data-k="status"></small></div>
      <div class="ts-row" data-k="sens"><span>${esc(t('ts.sens'))}</span><input type="range" data-in="tsens" min="${TOUCH_SENS_RANGE[0]}" max="${TOUCH_SENS_RANGE[1]}" step="0.05"><output></output></div>
      <div class="ts-row" data-k="edit"><button type="button" class="edit" data-act="edit">${esc(t('ts.edit'))}</button><p class="note">${esc(t('ts.note'))}</p></div>`;
    this.refresh();
  }

  private refresh() {
    const pref = touchPref(), on = touchActive();
    this.el.querySelectorAll<HTMLButtonElement>('[data-pref]').forEach(b => { const sel = b.dataset.pref === pref; b.classList.toggle('on', sel); b.setAttribute('aria-pressed', String(sel)); });
    const status = this.el.querySelector<HTMLElement>('[data-k="status"]')!;
    status.textContent = pref === 'auto' ? t(touchPrimary(readEnv()) ? 'ts.autoOn' : 'ts.autoOff') : '';
    (this.el.querySelector('[data-k="sens"]') as HTMLElement).hidden = !on;
    (this.el.querySelector('[data-k="edit"]') as HTMLElement).hidden = !on;
    const slider = this.el.querySelector<HTMLInputElement>('[data-in="tsens"]')!;
    if (document.activeElement !== slider) slider.value = String(touchSensitivity());
    (slider.nextElementSibling as HTMLElement).textContent = `${touchSensitivity().toFixed(2)}×`;
  }

  dispose() { for (const f of this.stops) f(); this.el.remove(); }
}
