(() => {
  const N = __N__;
  const wall = window.__clipClock ? window.__clipClock.realNow : () => performance.now(), t0 = wall();
  for (let i = 0; i < N; i++) { window.__lb.step(1, false); window.__clipSample(); }
  const st = window.__lb.game.link.state();
  return JSON.stringify({ ms: Math.round(wall() - t0), tick: st.tick, round: st.round, roundPhase: st.roundPhase, scores: st.scores, phase: st.phase, log: window.__clipLog.length, samples: window.__clipSamples.length });
})()
