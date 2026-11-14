(() => {
  // The learned-aim clips of 2026-11-14 (seed 20261114, &learned=1). Clip 1 (round 2): Pike (16) until he dies at tick 2217, then Lumen (19). Clip 2 (round 3): Dagger (23).
  const css = document.createElement('style');
  css.textContent = '.vitals, .arms, .fps { display: none !important; }';
  document.head.appendChild(css);
  window.__director = tick => {
    const g = window.__lb.game;
    g.spectating = tick < 3000 ? (tick <= 2217 ? 16 : 19) : 23;
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
