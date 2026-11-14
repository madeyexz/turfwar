(async () => {
  const SEED = __SEED__;
  const sim = await import('/shared/match/sim.ts');
  const math = await import('/shared/math.ts');
  const g = window.__lb.game, link = g.link, st = link.match, ctx = link.ctx;
  if (st.tick !== 0) return 'ERR: the match has already stepped';
  // A match of bots only, from a known seed: the human leaves, and all the bots are made again from the seeded generator.
  ctx.random = math.rng(SEED);
  for (const s of [...st.soldiers]) sim.removeSoldier(st, ctx, s.id);
  sim.balanceTeams(st, ctx);
  link.events = [];
  g.player.alive = false;
  const log = window.__clipLog = [], samples = window.__clipSamples = [];
  const emit = ctx.emit;
  ctx.emit = e => {
    if (e.type === 'kill' || e.type === 'round' || e.type === 'phase' || e.type === 'damage' || e.type === 'explosion' || e.type === 'smoke' || e.type === 'molotov' || e.type === 'bomb') log.push({ tick: st.tick, ...e });
    else if (e.type === 'shot') log.push({ tick: st.tick, type: 'shot', shooter: e.shooter, weapon: e.weapon, hit: e.hit });
    emit(e);
  };
  window.__clipSample = () => {
    const r1 = v => Math.round(v * 10) / 10, r3 = v => Math.round(v * 1000) / 1000;
    samples.push([st.tick, st.round, st.roundPhase, r1(st.roundClock), st.soldiers.map(s => [s.id, s.alive ? 1 : 0, r1(s.m.x), r1(s.m.y), r1(s.m.z), r3(s.yaw), r3(s.pitch), s.brain ? s.brain.target : -1, s.brain ? s.brain.burst : 0, s.brain ? s.brain.goal : '', s.health, s.weapon === 2 ? 'knife' : s.weapons[s.weapon], s.sprint ? 1 : 0, s.ads ? 1 : 0])]);
  };
  return JSON.stringify({ seed: SEED, soldiers: st.soldiers.map(s => [s.id, s.name, s.team, +s.brain.skill.toFixed(2)]) });
})()
