/**
 * Virtual time for deterministic capture, injected into every page before its own scripts run.
 * The page's clocks (performance.now, Date.now), timers, requestAnimationFrame, CSS animations and
 * transitions, and Math.random all follow `window.__vclock`, which only the capture driver advances:
 * a frame that takes two seconds to render and screenshot still covers exactly 1/30 s of game time.
 */
export const VCLOCK_SOURCE = String.raw`(() => {
  if (window.__vclock) return;
  let now = 0;
  const epoch = 1791284400000; // fixed wall clock (2026-10-06, 11:00 UTC)
  performance.now = () => now;
  const RealDate = Date;
  class VDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(epoch + now); } static now() { return epoch + now; } }
  window.Date = VDate;

  let nextId = 1;
  const timers = new Map();
  const setT = (fn, ms, args, every) => { const id = nextId++; timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args, every }); return id; };
  window.setTimeout = (fn, ms, ...args) => setT(fn, ms, args, 0);
  window.setInterval = (fn, ms, ...args) => setT(fn, ms, args, Math.max(1, Number(ms) || 0));
  window.clearTimeout = window.clearInterval = id => { timers.delete(id); };

  let rafs = new Map();
  window.requestAnimationFrame = fn => { const id = nextId++; rafs.set(id, fn); return id; };
  window.cancelAnimationFrame = id => { rafs.delete(id); };

  // Seeded Math.random (mulberry32) so a capture replays the same spread, bots and effects.
  let seed = 0x1a2b3c4d;
  Math.random = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  // Vite's hot-reload socket would reload the page mid-capture when a trailer source changes:
  // hand it a socket that never connects (the game's own sockets are untouched).
  const RealWS = window.WebSocket;
  window.WebSocket = new Proxy(RealWS, { construct(target, args) {
    const protocols = [].concat(args[1] || []);
    if (protocols.some(p => String(p).startsWith('vite'))) return Object.assign(new EventTarget(), { readyState: 0, send() {}, close() {}, addEventListener: EventTarget.prototype.addEventListener });
    return Reflect.construct(target, args);
  } });

  const seen = new WeakSet();
  window.__vclock = {
    get now() { return now; },
    seed(n) { seed = n | 0; },
    /** Run every timer due up to now + ms, in order, then land on now + ms. */
    advance(ms) {
      const end = now + ms;
      for (let guard = 0; guard < 10000; guard++) {
        let best, bestId;
        for (const [id, t] of timers) if (t.at <= end && (!best || t.at < best.at)) { best = t; bestId = id; }
        if (!best) break;
        now = Math.max(now, best.at);
        if (best.every) best.at = now + best.every; else timers.delete(bestId);
        try { typeof best.fn === 'function' ? best.fn(...best.args) : (0, eval)(best.fn); } catch (e) { console.error(e); }
      }
      now = end;
    },
    /** Fire this frame's animation-frame callbacks. */
    frame() { const list = [...rafs.values()]; rafs = new Map(); for (const f of list) { try { f(now); } catch (e) { console.error(e); } } },
    /** Step CSS animations and transitions by ms (new ones start paused at 0). */
    animations(ms) {
      for (const a of document.getAnimations()) {
        if (!seen.has(a)) { seen.add(a); a.pause(); a.currentTime = 0; continue; }
        if (a.playState !== 'paused') a.pause();
        a.currentTime = (Number(a.currentTime) || 0) + ms;
      }
    },
  };
})();`;
