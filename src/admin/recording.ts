/**
 * The "Recording" section of /admin (docs/RECORDING.md): clean human hours as the processor counted
 * them from R2 (`stats/clean-hours.json`, served by the ingest Worker to the admin key), against the
 * bot-training targets (movement-clean 200 h, aim-clean 50 h) and the dataset target (1,000 h of the
 * export set), with the independent recount beside them. The admin key typed at login is kept in this
 * page's memory only (never stored); after a reload the card asks for it once.
 */
const ENDPOINT = (import.meta.env.VITE_REC_URL as string | undefined) ?? 'https://rec.turfwar.ianhsiao.me';

export interface RecStats {
  env: string; rules: string; updatedAt: number; targets: { movement: number; aim: number; dataset: number };
  movementHours: number; aimHours: number; exportMovementHours: number; exportAimHours: number;
  serverOnlyHours: number; aliveLiveHours: number; subjectRounds: number; cleanRounds: number; segments: number; subjects: number;
  topTenShare: number; killReconciliation: { kills: number; matched: number }; meanGapRatio: number; dropped: Record<string, number>;
  byDay: Record<string, { movement: number; aim: number }>; byDevice: Record<string, number>; byInput: Record<string, number>; byMap: Record<string, number>;
  recount: { at: number; ok: boolean; movementHours: number; aimHours: number; segments: number } | null;
}

/** Which recording prefix a database's stats live under (none: not recorded). */
export const recEnvOf = (database: string) => (database === 'turfwar' ? 'tw' : database === 'lawbreaker-dev' ? 'dev' : undefined);

let key = '';
/** What is typed in the key field, kept across the dashboard's live re-renders. */
let typed = { value: '', focused: false };
let state: { env?: string; loading: boolean; stats?: RecStats; error?: string; at: number } = { loading: false, at: 0 };

/** The login form hands over the key it sent (memory only). */
export function rememberRecKey(k: string) { key = k; state = { loading: false, at: 0 }; }
export const forgetRecKey = () => { key = ''; state = { loading: false, at: 0 }; };

/** Fetch (at most once a minute) and call `done` to re-render. */
export function loadRecStats(database: string, done: () => void, force = false) {
  const env = recEnvOf(database);
  if (!env || !key || state.loading || (!force && state.env === env && Date.now() - state.at < 60_000)) return;
  state = { ...state, env, loading: true };
  fetch(`${ENDPOINT}/v1/stats${env === 'dev' ? '?env=dev' : ''}`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' })
    .then(async r => {
      if (r.status === 404) return { error: 'No summary yet: the processor has not run on any recorded round.' };
      if (r.status === 401) { key = ''; return { error: 'The admin key was not accepted.' }; }
      if (!r.ok) return { error: `The recording service answered ${r.status}.` };
      return { stats: await r.json() as RecStats };
    })
    .catch(() => ({ error: 'Could not reach the recording service.' }))
    .then(r => { state = { env, loading: false, at: Date.now(), ...r }; done(); });
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const h = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '—');

function progress(label: string, value: number, target: number, note: string) {
  const share = Math.max(0, Math.min(1, target ? value / target : 0));
  return `<div class="rec-goal"><div class="rec-goal-h"><b>${label}</b><span>${h(value)} h of ${target.toLocaleString('en')} h · ${pct(value, target)}</span></div>
    <div class="rec-bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${value.toFixed(2)}"><i style="width:${(share * 100).toFixed(1)}%"></i></div>
    <small>${note}</small></div>`;
}

/** The section's content: a key field, a message, or the figures. */
export function recordingContent(database: string, card: (title: string, sub: string, content: string) => string): string {
  const env = recEnvOf(database);
  if (!env) return card('Recording', '', '<p>This database is not recorded (only Taipei <code>turfwar</code> and <code>lawbreaker-dev</code> are).</p>');
  if (!key) {
    return card('Clean human hours', 'from R2, counted by the processor', `<form class="rec-key" id="rec-key" autocomplete="off">
      <p>The recording summary needs the admin key once per visit (kept in this page's memory only).</p>
      <div class="row"><input id="rec-key-input" type="password" autocomplete="current-password" aria-label="Admin key" required><button class="btn" type="submit">Show</button></div>
      ${state.error ? `<p class="msg" role="status">${esc(state.error)}</p>` : ''}</form>`);
  }
  const s = state.stats;
  if (!s) return card('Clean human hours', 'from R2', `<p>${state.loading ? 'Loading…' : esc(state.error ?? 'Loading…')}</p>`);
  const t = s.targets;
  const updated = new Date(s.updatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Taipei', hour12: false });
  const goals = `<div class="rec-goals">
    ${progress('Movement-clean', s.movementHours, t.movement, 'bot training: every clean rule; touch aim assist allowed (its per-frame correction is logged)')}
    ${progress('Aim-clean', s.aimHours, t.aim, 'bot training: the same rules, mouse play or touch with assist off')}
    ${progress('Dataset (export set)', s.exportMovementHours, t.dataset, `movement-clean hours that can go in the export (public rooms, outside the EU, EEA, UK and CH, no opt-out); ${h(s.exportAimHours)} h of it aim-clean`)}
  </div>`;
  const rc = s.recount;
  const recount = rc
    ? `<p class="${rc.ok ? 'ok' : 'warn'}">Recount ${new Date(rc.at).toISOString().slice(0, 10)}: ${h(rc.movementHours)} h movement, ${h(rc.aimHours)} h aim over ${rc.segments} segments — ${rc.ok ? 'matches' : 'does not match'} the processor.</p>`
    : '<p class="warn">No recount yet (<code>bun scripts/rec-recount.ts --write</code>).</p>';
  const kr = s.killReconciliation;
  const checks = `<table class="rec-table"><tbody>
    <tr><th>Recorded play (subjects, alive in live rounds)</th><td>${h(s.aliveLiveHours)} h · ${s.subjectRounds} subject-rounds · ${s.subjects} players</td></tr>
    <tr><th>Clean share</th><td>movement ${pct(s.movementHours, s.aliveLiveHours)} · aim ${pct(s.aimHours, s.aliveLiveHours)} · server-only (input log under 90 %) ${h(s.serverOnlyHours)} h</td></tr>
    <tr><th>Kill reconciliation</th><td>${kr.matched} of ${kr.kills} kill events match a death in the frames (${pct(kr.matched, kr.kills)})</td></tr>
    <tr><th>Mean frame gap ratio</th><td>${(s.meanGapRatio * 100).toFixed(2)}% · ${s.segments} segments</td></tr>
    <tr><th>Top 10 % of players</th><td>${pct(s.topTenShare, 1)} of movement-clean time</td></tr>
    <tr><th>By input</th><td>${Object.entries(s.byInput).map(([k, v]) => `${esc(k)} ${h(v)} h`).join(' · ') || '—'}</td></tr>
    <tr><th>By device</th><td>${Object.entries(s.byDevice).map(([k, v]) => `${esc(k)} ${h(v)} h`).join(' · ') || '—'}</td></tr>
    <tr><th>Dropped (rule → h)</th><td>${Object.entries(s.dropped).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${h(v)}`).join(' · ') || '—'}</td></tr>
  </tbody></table>`;
  const days = Object.entries(s.byDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
  const daily = days.length
    ? `<table class="rec-table"><thead><tr><th>Day (UTC)</th><th>Movement-clean</th><th>Aim-clean</th></tr></thead><tbody>${days.map(([d, v]) => `<tr><td>${d}</td><td>${h(v.movement)} h</td><td>${h(v.aim)} h</td></tr>`).join('')}</tbody></table>`
    : '<p>No clean hours yet.</p>';
  return card('Clean human hours', `from R2 · rules ${esc(s.rules)} · updated ${esc(updated)} Taipei`, goals + recount)
    + `<div class="grid2">${card('Checks', 'what the hours rest on', checks)}${card('Per day', 'last 14 days with clean play', daily)}</div>`;
}

/** Wire the key form after a render. */
export function bindRecording(root: HTMLElement, database: string, rerender: () => void) {
  const form = root.querySelector<HTMLFormElement>('#rec-key');
  const input = form?.querySelector<HTMLInputElement>('#rec-key-input');
  if (form && input) {
    input.value = typed.value;
    if (typed.focused) input.focus();
    input.addEventListener('input', () => { typed.value = input.value; });
    input.addEventListener('focus', () => { typed.focused = true; });
    input.addEventListener('blur', () => { typed.focused = false; });
  }
  form?.addEventListener('submit', e => {
    e.preventDefault();
    rememberRecKey(input!.value); input!.value = ''; typed = { value: '', focused: false };
    loadRecStats(database, rerender, true);
    rerender();
  });
  loadRecStats(database, rerender);
}
