// Arming time of 4 Militia bots (skill 0.2, no enemy in sight) on each Sabotage map: the setups of the repository tests.
// Usage: bun armtime.ts <path to shared> [seed]
const root = process.argv[2] ?? '/home/user/workspace/repo/shared';
const { createContext, createMatch, addSoldier, resetMatch, tickMatch } = await import(root + '/match/sim');
const { SABOTAGE, ATTACKERS } = await import(root + '/match/state');
const { rng } = await import(root + '/math');
const rate = 30;
const out: string[] = [];
for (const [map, limit, sites] of [['cinder', 90, 1], ['taipei', 110, 1], ['xinyi', 110, 1], ['taipei101', 90, 1], ['sanchong', 60, 2], ['memorial', 60, 2], ['ximending', 60, 2], ['xinyi', 120, 2]] as const) {
  for (let site = 0; site < sites; site++) {
    const times: number[] = [];
    for (const seed of (process.argv[3] ? [+process.argv[3]] : [5, 6, 7, 8, 9])) {
      const events: any[] = [];
      let ctx: any, state: any;
      try { ctx = createContext(map, rng(seed), (e: any) => events.push(e)); state = createMatch(map, { ...SABOTAGE, teamSize: 0, warmup: 0, botSkill: 0.2 }); } catch (e) { times.push(NaN); continue; }
      for (let i = 0; i < 4; i++) addSoldier(state, ctx, { name: `M${i}`, team: ATTACKERS, bot: true });
      const swat = addSoldier(state, ctx, { name: 'S', team: (1 - ATTACKERS) as 0 | 1, bot: false });
      resetMatch(state, ctx);
      if (sites === 2 && state.round % 2 !== site) state.round++;
      let t = -1;
      for (let i = 0; i < 200 * rate && !state.bomb.armed; i++) { swat.m.x = 0; swat.m.y = -30; swat.m.z = 0; tickMatch(state, ctx, 1 / rate); t = (i + 1) / rate; }
      times.push(state.bomb.armed ? +t.toFixed(1) : Infinity);
    }
    out.push(`${map} site ${sites === 2 ? site : '-'} limit ${limit}: ${times.join(' ')}`);
  }
}
console.log(out.join('\n'));
