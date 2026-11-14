// Where the bots of a script spend the live time: seconds per nav node, by map and team, in bot-only 6v6 Elimination.
// Usage: bun visits.ts --script new|old --maps taipei,ochre --rounds 20 --seed 1 --out /tmp/rec/s2/visits-new.json
import { createContext, createMatch, balanceTeams, tickMatch, AB } from './shared/match/sim';
import { ELIMINATION, type MatchConfig } from './shared/match/state';
import { nearestNode } from './shared/match/nav';
import { clamp } from './shared/math';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const SCRIPT = arg('script', 'new'), ROUNDS = +arg('rounds', '20'), SEED = +arg('seed', '1'), SKILL = +arg('skill', '0.3'), OUT = arg('out', '');
AB.old = [SCRIPT === 'old', SCRIPT === 'old'];
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const DT = 1 / 30;
const res: Record<string, Record<string, { hours: number; node: Record<string, number>; late: Record<string, number> }>> = {};
for (const map of arg('maps', 'taipei,ochre').split(',')) {
  const ctx = createContext(map, rng(SEED), () => {});
  const config: MatchConfig = { ...ELIMINATION, teamSize: 6, botSkill: SKILL, warmup: 0.2, roundsToWin: 99 };
  const state = createMatch(map, config);
  balanceTeams(state, ctx);
  const srand = rng(SEED + 4242);
  for (const s of state.soldiers) s.brain!.skill = clamp(SKILL + (srand() - 0.5) * 0.3, 0.15, 0.95);
  const n = ctx.nav!.x.length, all = [new Float64Array(n), new Float64Array(n)], late = [new Float64Array(n), new Float64Array(n)];
  let last = state.round, done = 0;
  for (let i = 0; i < 60 * 60 * 30 && done < ROUNDS; i++) {
    tickMatch(state, ctx, DT);
    if (state.round !== last) { last = state.round; done++; }
    if (!(state.phase === 'live' && state.roundPhase === 'live') || i % 3) continue;
    const clock = state.roundClock - config.freezeTime;
    for (const s of state.soldiers) {
      if (!s.alive) continue;
      const k = nearestNode(ctx.nav!, s.m.x, s.m.y, s.m.z);
      if (k < 0) continue;
      all[s.team][k] += 0.1; if (clock > 10) late[s.team][k] += 0.1;
    }
  }
  res[map] = {};
  for (const t of [0, 1]) {
    const pack = (a: Float64Array) => { const o: Record<string, number> = {}; a.forEach((v, k) => { if (v > 0) o[k] = +v.toFixed(1); }); return o; };
    res[map][t] = { hours: +(all[t].reduce((x, y) => x + y, 0) / 3600).toFixed(3), node: pack(all[t]), late: pack(late[t]) };
  }
}
if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(res)); }
console.log(Object.entries(res).map(([m, r]) => `${m} ${r[0].hours}h/${r[1].hours}h`).join('  '));
