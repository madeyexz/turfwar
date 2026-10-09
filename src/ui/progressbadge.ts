import { GOALS, levelOf, loadProgress, onProgress } from '../game/progress';
import { escapeHtml as esc, onLang, t, type Key } from './i18n';

/**
 * The lobby's level and daily goal (game/progress.ts): "LV 3 ▰▰▱ 120/220 XP · Today: win 3 rounds 1/3".
 */
export function mountProgressBadge(el: HTMLElement) {
  const render = () => {
    const p = loadProgress();
    const lv = levelOf(p.xp), goal = GOALS[p.goal.kind];
    const pct = Math.round(100 * lv.into / lv.need);
    el.className = `prog${p.goal.done ? ' done' : ''}`;
    el.innerHTML = `<b class="lv">${esc(t('prog.level', { n: lv.level }))}</b>`
      + `<span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${lv.need}" aria-valuenow="${lv.into}" aria-label="${esc(t('prog.xp', { n: lv.into, of: lv.need }))}"><i style="width:${pct}%"></i></span>`
      + `<small class="xp">${esc(t('prog.xp', { n: lv.into, of: lv.need }))}</small>`
      + `<span class="goal">${esc(t('prog.today'))} ${esc(t(`prog.goal.${p.goal.kind}` as Key, { n: goal.target }))} <b>${p.goal.done ? '✓' : `${p.goal.count}/${goal.target}`}</b></span>`;
  };
  render();
  const stops = [onProgress(render), onLang(render)];
  addEventListener('storage', render);
  return () => { for (const f of stops) f(); removeEventListener('storage', render); };
}
