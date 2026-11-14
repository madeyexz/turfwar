(() => {
  // A frame of a clip takes about 2 s to draw on the orb, but the HUD counts wall-clock time: timers (a kill feed line
  // stays 7 s), CSS animations and transitions (the round banner), and performance.now() (interpolation, smoke, fire).
  // This puts the three on one clock that moves 1/30 s for each game frame, so a clip shows them as a player sees them.
  if (window.__clipClock) return 'clock already there';
  const STEP = 1000 / 30;
  const realNow = performance.now.bind(performance), realSet = window.setTimeout.bind(window), realClear = window.clearTimeout.bind(window);
  let now = realNow(), inFrame = false, nextId = 1e9, first = true;
  const timers = new Map(), times = new WeakMap();
  performance.now = () => now;
  // The timers that the game makes in a frame wait on the frame clock. All others (loaders, the dev server client) keep the wall clock.
  window.setTimeout = (fn, ms, ...args) => {
    if (!inFrame || typeof fn !== 'function') return realSet(fn, ms, ...args);
    const id = nextId++;
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args });
    return id;
  };
  window.clearTimeout = id => { if (!timers.delete(id)) realClear(id); };
  const runTimers = () => {
    for (;;) {
      let due, at = Infinity;
      for (const [id, t] of timers) if (t.at <= now && t.at < at) { due = id; at = t.at; }
      if (due === undefined) return;
      const t = timers.get(due); timers.delete(due);
      try { t.fn(...t.args); } catch (e) { console.error(e); }
    }
  };
  // CSS animations and transitions: each one is stopped when it is first seen, then moved by hand, one step for each frame.
  const animations = advance => {
    let n = 0;
    for (const a of document.getAnimations()) {
      let t = times.get(a);
      if (t === undefined) t = first ? Number(a.currentTime) || 0 : 0;
      else if (!advance || t === Infinity) continue;
      else t += STEP;
      try {
        const end = a.effect ? Number(a.effect.getComputedTiming().endTime) : 0;
        if (Number.isFinite(end) && t >= end) { a.finish(); t = Infinity; } else { a.pause(); a.currentTime = t; n++; }
      } catch (e) { t = Infinity; }
      times.set(a, t);
    }
    return n;
  };
  const lb = window.__lb, step = lb.step;
  lb.step = (n = 1, render = true) => {
    for (let i = 0; i < n; i++) {
      now += STEP; inFrame = true;
      try { runTimers(); animations(true); step(1, render && i === n - 1); animations(false); } finally { inFrame = false; }
    }
    return n;
  };
  const held = animations(false); first = false;
  window.__clipClock = { realNow, now: () => now, timers: () => timers.size, moving: () => animations(false) };
  return 'clock ready, ' + held + ' animations held';
})()
