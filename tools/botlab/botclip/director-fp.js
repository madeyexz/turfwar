(() => {
  // Clip 1: round 2 through the eyes of Orrin (14); when he dies (tick 2362), the last SWAT soldier, Juno (18).
  const css = document.createElement('style');
  css.textContent = '.vitals, .arms, .fps { display: none !important; }';
  document.head.appendChild(css);
  window.__director = tick => { window.__lb.game.spectating = tick <= 2362 ? 14 : 18; };
  window.__clipFrame = () => { const st = window.__lb.game.link.state(); window.__director(st.tick + 1); window.__lb.step(1); window.__clipSample(); return st.tick; };
  return 'director ready';
})()
