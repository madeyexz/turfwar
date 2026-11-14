(() => {
  // The eyes the clips look through, by tick. Clip 1 (round 2): Orrin (14). Clip 2 (round 6): Orrin (14) until he dies
  // at tick 7157, then Juno (18) until she dies at tick 7466, then Dagger (15).
  const css = document.createElement('style');
  css.textContent = '.vitals, .arms, .fps { display: none !important; }';
  document.head.appendChild(css);
  window.__director = tick => {
    const g = window.__lb.game;
    g.spectating = tick < 6000 ? (tick <= 2362 ? 14 : 18) : tick <= 7157 ? 14 : tick <= 7466 ? 18 : 15;
  };
  // What the HUD shows at each frame, to check the clip: the kill feed lines and the round banner.
  const hud = window.__clipHud = [];
  const px = new Uint8Array(4);
  window.__clipFrame = () => {
    const st = window.__lb.game.link.state();
    window.__director(st.tick + 1); window.__lb.step(1); window.__clipSample();
    const banner = document.querySelector('.announce');
    hud.push([st.tick, [...document.querySelectorAll('.killfeed > div')].map(d => d.textContent.trim().replace(/\s+/g, ' ')), banner ? +(+getComputedStyle(banner).opacity).toFixed(2) : -1, banner ? banner.textContent.trim().replace(/\s+/g, ' ') : '']);
    // The software GPU draws after the script returns: a read waits for it, so the picture that follows is of this tick.
    const gl = window.__lb.renderer.renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return st.tick;
  };
  return 'director ready';
})()
