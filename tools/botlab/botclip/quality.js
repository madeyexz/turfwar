(() => {
  // Half the resolution, hard 1024 shadows, no muzzle lights: a frame of the Medium preset takes 6.5 s on the orb's software GPU, this one about 2 s.
  const R = window.__lb.renderer, gl = R.renderer.getContext(), px = new Uint8Array(4);
  R.applyQuality(Object.assign({}, R.quality, { pixelRatio: 0.5, adaptive: false, shadows: 1024, softShadows: false, dynamicLights: false }));
  R.render(0); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return 'quality ready';
})()
