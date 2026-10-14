/**
 * Sending a message with a link straight to an app: LINE's and Threads' share pages take the text
 * (link included) in the URL, so they work on computers, in phone browsers and in in-app browsers
 * where the Web Share API is missing. Opened in a new tab; a phone with the app installed hands it over.
 */

export type SendApp = 'line' | 'threads';

/** The share page that posts `text` (with its link) to `app`. */
export function sendUrl(app: SendApp, text: string) {
  const q = encodeURIComponent(text);
  return app === 'line' ? `https://line.me/R/share?text=${q}` : `https://www.threads.net/intent/post?text=${q}`;
}

/** Open `app`'s share page with `text` (inside the tap, so popup blockers let it through). */
export function sendTo(app: SendApp, text: string) {
  const a = document.createElement('a');
  a.href = sendUrl(app, text);
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
