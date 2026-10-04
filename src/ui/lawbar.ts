import type { LawCommand } from '../../shared/laws';
import { presets, translateCommand } from '../commands';

/**
 * The "/" command bar: natural language goes to the server-only /api/law route, which returns a
 * validated, clamped typed command (never code). The four examples also work offline.
 */
export class LawBar {
  readonly root: HTMLElement;
  private input: HTMLInputElement;
  private help: HTMLElement;
  private busy = false;
  onClose?: () => void;

  constructor(parent: HTMLElement, private apply: (command: LawCommand, source: string, text: string) => Promise<{ ok: boolean; message: string }>) {
    this.root = document.createElement('div');
    this.root.id = 'lawbar';
    this.root.hidden = true;
    this.root.innerHTML = `
      <form><span class="slash">/</span><input maxlength="1000" autocomplete="off" spellcheck="false" placeholder="Describe one change to the laws of this world…" aria-label="Rewrite a law"><kbd>ENTER</kbd></form>
      <div class="examples">${presets.map((p, i) => `<button type="button" data-i="${i}"><kbd>${i + 1}</kbd> “${p.sentence}”</button>`).join('')}</div>
      <div class="help">Words become validated parameters — never code. AI when configured; these four examples always work.</div>`;
    parent.appendChild(this.root);
    this.input = this.root.querySelector('input')!;
    this.help = this.root.querySelector('.help')!;
    this.root.querySelectorAll<HTMLButtonElement>('[data-i]').forEach(b => b.addEventListener('click', () => { this.input.value = presets[Number(b.dataset.i)].sentence; this.input.focus(); }));
    this.root.querySelector('form')!.addEventListener('submit', e => { e.preventDefault(); void this.submit(); });
    this.input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } e.stopPropagation(); });
  }

  get open() { return !this.root.hidden; }

  show() {
    this.root.hidden = false;
    this.help.className = 'help';
    this.help.textContent = 'Words become validated parameters — never code. AI when configured; these four examples always work.';
    document.exitPointerLock?.();
    setTimeout(() => this.input.focus(), 0);
  }

  close() { this.root.hidden = true; this.input.blur(); this.onClose?.(); }

  private async submit() {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    this.busy = true;
    this.help.className = 'help'; this.help.textContent = 'Translating your law…';
    try {
      const { command, source } = await translateCommand(text);
      const result = await this.apply(command, source, text);
      if (!result.ok) throw new Error(result.message);
      this.input.value = '';
      this.close();
    } catch (error) {
      this.help.className = 'help err';
      this.help.textContent = (error as Error).message;
    } finally { this.busy = false; }
  }
}
