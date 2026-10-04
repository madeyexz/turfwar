import type { LawCommand, Laws } from '../shared/laws';
import { describeLaws, presets, translateCommand } from './commands';

export class HUD {
  panel: HTMLDialogElement;
  input: HTMLInputElement;
  busy = false;
  toastTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private apply: (command: LawCommand, source: string) => void, private onOpen: () => void) {
    document.querySelector('#app')!.insertAdjacentHTML('beforeend', `
      <div class="command-dock"><div class="dock-title"><span>THE UNIVERSE IS LISTENING.</span><span>TRY A DIFFERENT LAW</span></div><button id="command-open"><span class="slash">/</span><span>What if the universe worked differently?</span><span class="command-key">REWRITE A LAW <kbd>/</kbd></span></button><div class="presets">${presets.map((p, i) => `<button data-preset="${i}"><kbd>${i + 1}</kbd>${p.title}<span>↗</span></button>`).join('')}</div></div>
      <dialog id="command-panel" aria-labelledby="command-title"><div class="dialog-heading"><span class="section-label">LAW EDITOR / NATURAL LANGUAGE</span><button id="command-close" aria-label="Close law editor">×</button></div><h2 id="command-title">Make the impossible<br><em>a law of nature.</em></h2><form id="command-form"><label for="sentence">Describe one change to this universe</label><div class="input-row"><span>/</span><input id="sentence" maxlength="1000" autocomplete="off" placeholder="Gravity falls off with the cube of distance" required><button id="command-submit" type="submit" aria-label="Apply law">↗</button></div></form><p id="command-help" role="status">AI when connected. These four examples also work offline.</p><div class="examples">${presets.map((p, i) => `<button data-example="${i}"><span>0${i + 1}</span>“${p.sentence}”<span>↗</span></button>`).join('')}</div><div class="dialog-footer"><span>WORDS → PARAMETERS. NEVER CODE.</span><span><kbd>ESC</kbd> Close</span></div></dialog>
    `);
    this.panel = document.querySelector('#command-panel')!;
    this.input = document.querySelector('#sentence')!;
    document.querySelector('#command-open')!.addEventListener('click', () => this.open());
    document.querySelector('#command-close')!.addEventListener('click', () => this.panel.close());
    document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.addEventListener('click', () => this.preset(Number(button.dataset.preset))));
    document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach(button => button.addEventListener('click', () => { this.input.value = presets[Number(button.dataset.example)].sentence; this.input.focus(); }));
    document.querySelector('#command-form')!.addEventListener('submit', async event => {
      event.preventDefault();
      if (this.busy) return;
      this.busy = true;
      const submit = document.querySelector<HTMLButtonElement>('#command-submit')!;
      const help = document.querySelector('#command-help')!;
      submit.disabled = true; help.textContent = 'Translating your law…';
      try {
        const result = await translateCommand(this.input.value);
        this.apply(result.command, result.source); this.panel.close();
        help.textContent = 'AI when connected. These four examples also work offline.';
      } catch (error) { help.textContent = (error as Error).message; }
      finally { this.busy = false; submit.disabled = false; }
    });
  }

  open() { this.onOpen(); document.exitPointerLock(); if (!this.panel.open) this.panel.showModal(); this.input.focus(); }
  preset(index: number) { this.apply(structuredClone(presets[index].command), 'PRESET'); }
  update(laws: Laws) {
    document.querySelector('#laws')!.innerHTML = `<div class="section-label">THE LAWS OF THIS WORLD <span>↗</span></div>${describeLaws(laws).map((law, i) => `<div class="law"><span class="law-icon">${law.icon}</span><div><small>0${i + 1} / ${law.title}</small><p>${law.text}</p><code>${law.value}</code></div></div>`).join('')}`;
  }
  toast(text: string) {
    clearTimeout(this.toastTimer);
    const node = document.querySelector<HTMLElement>('#toast')!;
    node.textContent = text; node.classList.add('visible');
    this.toastTimer = setTimeout(() => node.classList.remove('visible'), 4200);
  }
}
