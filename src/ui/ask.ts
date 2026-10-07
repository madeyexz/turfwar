/**
 * A small dialog over the lobby that asks for one short value (a callsign, a private room's code):
 * a title, a line saying why, the field and one button. The button hands the value over from the
 * same tap (a phone still goes full screen); ✕, Esc or a tap outside closes it without acting. Keys
 * typed in it stay in it, so the lobby's shortcuts and its Enter-to-play never see them.
 */
export interface AskOptions {
  title: string;
  why: string;
  /** The field's accessible name and placeholder. */
  label: string;
  placeholder: string;
  /** The button's text. */
  go: string;
  /** The close button's accessible name. */
  close: string;
  value?: string;
  maxLength: number;
  /** Extra input attributes (autocomplete, autocapitalize …), already escaped. */
  attrs?: string;
  /** Tidies what was typed, live (e.g. upper case letters only) — optional. */
  clean?: (raw: string) => string;
  /** The value to hand over, or an error message to show instead. */
  check: (value: string) => { ok: string } | { error: string };
  done: (value: string) => void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function ask(o: AskOptions) {
  document.querySelector('.ask-dialog')?.remove();
  const el = document.createElement('div');
  el.className = 'ask-dialog';
  el.innerHTML = `<form class="panel" role="dialog" aria-modal="true" aria-labelledby="ask-title" novalidate>
    <header><h2 id="ask-title">${esc(o.title)}</h2><button type="button" class="x" data-act="close" aria-label="${esc(o.close)}" title="${esc(o.close)}">✕</button></header>
    <p class="why">${esc(o.why)}</p>
    <input type="text" maxlength="${o.maxLength}" spellcheck="false" enterkeyhint="go" ${o.attrs ?? ''}
      placeholder="${esc(o.placeholder)}" aria-label="${esc(o.label)}" value="${esc(o.value ?? '')}">
    <p class="err" role="alert" hidden></p>
    <button type="submit" class="go">${esc(o.go)}</button>
  </form>`;
  const form = el.querySelector('form')!, input = form.querySelector('input')!, err = form.querySelector<HTMLElement>('.err')!;
  const close = () => el.remove();
  form.addEventListener('submit', e => {
    e.preventDefault();
    const result = o.check(o.clean ? o.clean(input.value) : input.value);
    if ('error' in result) {
      err.textContent = result.error; err.hidden = false;
      input.focus();
      return;
    }
    close();
    o.done(result.ok);
  });
  input.addEventListener('input', () => {
    err.hidden = true;
    if (o.clean) { const v = o.clean(input.value); if (v !== input.value) input.value = v; }
  });
  el.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    if (target === el || target.closest('[data-act="close"]')) close();
  });
  el.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  document.body.appendChild(el);
  input.focus({ preventScroll: true });
}

/**
 * A yes/no question in the same dialog: `go` acts, `stay` (the default focus, so a stray Enter does
 * not act), Esc or a tap outside closes it.
 */
export function confirmDialog(o: { title: string; why: string; go: string; stay: string; done: () => void }) {
  document.querySelector('.ask-dialog')?.remove();
  const el = document.createElement('div');
  el.className = 'ask-dialog';
  el.innerHTML = `<div class="panel" role="alertdialog" aria-modal="true" aria-labelledby="ask-title" aria-describedby="ask-why">
    <header><h2 id="ask-title">${esc(o.title)}</h2></header>
    <p class="why" id="ask-why">${esc(o.why)}</p>
    <div class="choices"><button type="button" class="stay" data-act="stay">${esc(o.stay)}</button><button type="button" class="go danger" data-act="go">${esc(o.go)}</button></div>
  </div>`;
  const close = () => el.remove();
  el.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'go') { close(); o.done(); } else if (act === 'stay' || target === el) close();
  });
  el.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  document.body.appendChild(el);
  el.querySelector<HTMLElement>('[data-act="stay"]')!.focus({ preventScroll: true });
}
