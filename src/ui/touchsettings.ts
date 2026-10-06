import { TOUCH_PREFS, readEnv, touchPrimary, type TouchPref } from '../game/device';
import {
  TOUCH_SENS_DEFAULT, TOUCH_SENS_RANGE, onTouchLayout, setTouchAutoAim, setTouchPref, setTouchSensitivity, touchActive, touchAutoAim, touchPref, touchSensitivity,
} from '../game/touchlayout';
import { onLang, t } from './i18n';
import { openTouchEditor } from './toucheditor';
import './touch.css';

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const times = (v: number) => `${v.toFixed(2)}×`;

/**
 * The touch section at the top of Settings → Controls: touch controls Auto / On / Off, the finger
 * look speed (with a way back to its default), hold fire to aim, and the button that opens the layout editor.
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
      if (b.dataset.aim) { setTouchAutoAim(b.dataset.aim === 'on'); return; }
      if (b.dataset.act === 'sensDefault') { setTouchSensitivity(TOUCH_SENS_DEFAULT); return; }
      if (b.dataset.act === 'edit') openTouchEditor();
    });
    this.el.addEventListener('input', e => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.in === 'tsens') { (el.nextElementSibling as HTMLElement).textContent = times(Number(el.value)); }
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
      <div class="ts-row" data-k="sens"><span>${esc(t('ts.sens'))}</span><input type="range" data-in="tsens" min="${TOUCH_SENS_RANGE[0]}" max="${TOUCH_SENS_RANGE[1]}" step="0.05" aria-label="${esc(t('ts.sens'))}"><output></output><button type="button" class="ts-default" data-act="sensDefault">${esc(t('ts.sensDefault', { n: times(TOUCH_SENS_DEFAULT) }))}</button></div>
      <div class="ts-row" data-k="aim"><span>${esc(t('ts.autoAim'))}</span><div class="seg" role="group" aria-label="${esc(t('ts.autoAim'))}"><button type="button" data-aim="on">${esc(t('ts.on'))}</button><button type="button" data-aim="off">${esc(t('ts.off'))}</button></div><p class="note">${esc(t('ts.autoAimNote'))}</p></div>
      <div class="ts-row" data-k="edit"><button type="button" class="edit" data-act="edit">${esc(t('ts.edit'))}</button><p class="note">${esc(t('ts.note'))}</p></div>`;
    this.refresh();
  }

  private refresh() {
    const pref = touchPref(), on = touchActive(), aim = touchAutoAim();
    this.el.querySelectorAll<HTMLButtonElement>('[data-pref]').forEach(b => { const sel = b.dataset.pref === pref; b.classList.toggle('on', sel); b.setAttribute('aria-pressed', String(sel)); });
    this.el.querySelectorAll<HTMLButtonElement>('[data-aim]').forEach(b => { const sel = (b.dataset.aim === 'on') === aim; b.classList.toggle('on', sel); b.setAttribute('aria-pressed', String(sel)); });
    const status = this.el.querySelector<HTMLElement>('[data-k="status"]')!;
    status.textContent = pref === 'auto' ? t(touchPrimary(readEnv()) ? 'ts.autoOn' : 'ts.autoOff') : '';
    for (const k of ['sens', 'aim', 'edit']) (this.el.querySelector(`[data-k="${k}"]`) as HTMLElement).hidden = !on;
    const slider = this.el.querySelector<HTMLInputElement>('[data-in="tsens"]')!;
    const sens = touchSensitivity();
    if (document.activeElement !== slider) slider.value = String(sens);
    (slider.nextElementSibling as HTMLElement).textContent = times(sens);
    (this.el.querySelector('[data-act="sensDefault"]') as HTMLElement).hidden = Math.abs(sens - TOUCH_SENS_DEFAULT) < 1e-3;
  }

  dispose() { for (const f of this.stops) f(); this.el.remove(); }
}
