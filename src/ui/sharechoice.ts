/**
 * What the share dialog offers and what each button does when the browser can't do it. Pure, so the
 * choices are tested (sharechoice.test.ts); sharepanel.ts supplies the real Web Share, clipboard and
 * download calls. Phones with file sharing send the card with its link; phones with Web Share but no
 * files (some in-app browsers, Firefox for Android) send the text and link; everything else copies.
 */

export type ShareMethod = 'native' | 'link' | 'download' | 'copy';
export type ShareResult = 'native' | 'cancel' | 'unsupported';

export interface ShareCaps {
  /** `navigator.canShare` accepts a picture. */
  files: boolean;
  /** `navigator.share` exists (the text and link). */
  link: boolean;
}

/** The dialog's buttons, the main one first. `room`: the link opens straight into a 1v1 room, so copying it is the main way on a computer. */
export function shareActs(caps: ShareCaps, room: boolean): ShareMethod[] {
  if (caps.files) return ['native', 'download', 'copy'];
  if (caps.link) return ['link', 'copy', 'download'];
  return room ? ['copy', 'download'] : ['download', 'copy'];
}

export interface ShareDeps {
  /** The card and its link, through the share sheet. */
  shareFile(): Promise<ShareResult>;
  /** Just the text and the link, through the share sheet. */
  shareLink(): Promise<ShareResult>;
  copy(): Promise<boolean>;
}

/**
 * Presses the share button: the card with its link, else the link alone, else the clipboard. Resolves
 * what was done (for analytics), `cancel` when the player closed the share sheet (nothing is retried: they chose
 * not to send) and `failed` when even the clipboard refused (the dialog then selects the link by hand).
 */
export async function shareFlow(first: 'native' | 'link' | 'copy', d: ShareDeps): Promise<ShareMethod | 'cancel' | 'failed'> {
  if (first === 'native') {
    const r = await d.shareFile();
    if (r === 'native') return 'native';
    if (r === 'cancel') return 'cancel';
  }
  if (first !== 'copy') {
    const r = await d.shareLink();
    if (r === 'native') return 'link';
    if (r === 'cancel') return 'cancel';
  }
  return (await d.copy()) ? 'copy' : 'failed';
}
