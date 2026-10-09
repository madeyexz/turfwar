/**
 * Sideways play on an upright touch screen. In-app browsers (Threads, Instagram, LINE) never turn to
 * landscape, and neither does an iPhone with rotation lock on, so instead of asking the player to
 * rotate, a match on an upright touch screen turns the page itself 90° (`body.sideways`, touch.css)
 * and the player turns the phone. Everything fixed-position turns with the body; code that sizes the
 * game or reads finger positions goes through here, in the turned page's own coordinates.
 */

let sideways = false;
const listeners = new Set<(on: boolean) => void>();

export const isSideways = () => sideways;
/** The game's width and height in CSS pixels (the long side across while sideways). */
export const viewWidth = () => (sideways ? innerHeight : innerWidth);
export const viewHeight = () => (sideways ? innerWidth : innerHeight);

/**
 * A screen point (`clientX`, `clientY`) in the page's layout coordinates. The body is turned a
 * quarter clockwise (`rotate(90deg) translateY(-100%)` about its top-left corner), which maps the
 * layout point (u, v) to the screen point (innerWidth − v, u).
 */
export function toView(x: number, y: number, turned = sideways, width = innerWidth) {
  return turned ? { x: y, y: width - x } : { x, y };
}

/** A `getBoundingClientRect` (screen space) as a rectangle in layout coordinates. */
export function viewRect(r: { left: number; top: number; right: number; bottom: number; width: number; height: number }, turned = sideways, width = innerWidth) {
  if (!turned) return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  return { left: r.top, top: width - r.right, right: r.bottom, bottom: width - r.left, width: r.height, height: r.width };
}

/** Whether the page should be turned: a touch match (or the layout editor) on an upright screen. */
export function wantSideways(o: { touch: boolean; inMenu: boolean; editing: boolean; width: number; height: number }) {
  return o.touch && (!o.inMenu || o.editing) && o.height > o.width;
}

export function onSideways(f: (on: boolean) => void) { listeners.add(f); return () => { listeners.delete(f); }; }

function update() {
  const b = document.body;
  const want = wantSideways({ touch: b.classList.contains('touch'), inMenu: b.classList.contains('menu-open'), editing: b.classList.contains('tc-editing'), width: innerWidth, height: innerHeight });
  if (want) { b.style.width = `${innerHeight}px`; b.style.height = `${innerWidth}px`; }
  if (want === sideways) return;
  sideways = want;
  b.classList.toggle('sideways', want);
  if (!want) { b.style.width = ''; b.style.height = ''; }
  for (const f of listeners) f(want);
  // Everything that sizes itself on resize (the renderer, the HUD, the touch layout) measures again.
  window.dispatchEvent(new Event('resize'));
}

let watching = false;
/** Follow the window and the body's state (lobby, match, layout editor) from now on. */
export function watchSideways() {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  addEventListener('resize', () => { if (!updating) { updating = true; try { update(); } finally { updating = false; } } });
  addEventListener('orientationchange', () => setTimeout(update, 50));
  new MutationObserver(update).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  update();
}
let updating = false;
