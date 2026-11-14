// The body's habits of a bot script in bot-only 6v6 matches: time still, time in sprint, distance to the nearest ally,
// strafe direction changes per second with an enemy in sight, and time in ADS with an enemy in sight.
// Usage: bun movehabits.ts --script new|old [--mode elimination|sabotage] [--maps taipei,ochre,memorial] [--rounds 12] [--seed 1] [--skill 0.3]
import { createContext, createMatch, balanceTeams, tickMatch, AB } from './shared/match/sim';
import { ELIMINATION, SABOTAGE, type MatchConfig } from './shared/match/state';
import { eyeOf, feetOf } from './shared/match/combat';
import { chestPoint } from './shared/hitbox';
import { clamp, wrapAngle } from './shared/math';
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const SCRIPT = arg('script', 'new'), MODE = arg('mode', 'elimination'), ROUNDS = +arg('rounds', '12'), SEED = +arg('seed', '1'), SKILL = +arg('skill', '0.3');
AB.old = [SCRIPT === 'old', SCRIPT === 'old'];
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const DT = 1 / 30;
let n = 0, still = 0, sprint = 0, sight = 0, changes = 0, ads = 0, stillSight = 0; const ally: number[] = [];
for (const map of arg('maps', 'taipei,ochre,memorial').split(',')) {
  let rounds = 0;
  const ctx = createContext(map, rng(SEED), e => { if (e.type === 'round' || (e as any).type === 'roundEnd') rounds++; });
  const config: MatchConfig = { ...(MODE === 'sabotage' ? SABOTAGE : ELIMINATION), teamSize: 6, botSkill: SKILL, warmup: 0.2, roundsToWin: 99 };
  const state = createMatch(map, config);
  balanceTeams(state, ctx);
  const srand = rng(SEED + 4242);
  for (const s of state.soldiers) s.brain!.skill = clamp(SKILL + (srand() - 0.5) * 0.3, 0.15, 0.95);
  const side = new Map<number, number>();
  let last = state.round, done = 0;
  for (let i = 0; i < 60 * 60 * 30 && done < ROUNDS; i++) {
    tickMatch(state, ctx, DT);
    if (state.round !== last) { last = state.round; done++; }
    if (!(state.phase === 'live' && state.roundPhase === 'live')) continue;
    for (const s of state.soldiers) {
      if (!s.alive) continue;
      n++;
      const speed = Math.hypot(s.m.vx, s.m.vz);
      if (speed < 0.5) still++;
      if (s.sprint) sprint++;
      if (i % 15 === s.id % 15) {
        let best = Infinity;
        for (const o of state.soldiers) if (o !== s && o.alive && o.team === s.team) best = Math.min(best, Math.hypot(o.m.x - s.m.x, o.m.y - s.m.y, o.m.z - s.m.z));
        if (best < Infinity) ally.push(best);
      }
      // An enemy in sight: inside 1 rad of the view's centre, with a clear line to its chest.
      const eye = eyeOf(s); let seen = false;
      for (const o of state.soldiers) {
        if (!o.alive || o.team === s.team) continue;
        const d = Math.hypot(o.m.x - s.m.x, o.m.z - s.m.z);
        if (d > 95 || Math.abs(wrapAngle(Math.atan2(-(o.m.x - eye.x), -(o.m.z - eye.z)) - s.yaw)) > 1) continue;
        if (ctx.world.lineOfSight(eye, chestPoint(feetOf(o), o.m.crouch), s.team)) { seen = true; break; }
      }
      if (seen) {
        sight++; if (s.ads) ads++; if (speed < 0.5) stillSight++;
        const vs = s.m.vx * Math.cos(s.yaw) + s.m.vz * -Math.sin(s.yaw), sg = vs > 1 ? 1 : vs < -1 ? -1 : 0;
        const prev = side.get(s.id) ?? 0;
        if (sg !== 0) { if (prev !== 0 && prev !== sg) changes++; side.set(s.id, sg); }
      } else side.delete(s.id);
    }
  }
}
ally.sort((a, b) => a - b);
console.log(JSON.stringify({ script: SCRIPT, mode: MODE, soldierHours: +(n * DT / 3600).toFixed(2), still: +(still / n).toFixed(3), sprint: +(sprint / n).toFixed(3), allyMedian: +ally[ally.length >> 1].toFixed(1), allyP25: +ally[ally.length >> 2].toFixed(1), sightShare: +(sight / n).toFixed(3), strafeChangesPerSecond: +(changes / (sight * DT)).toFixed(3), adsInSight: +(ads / sight).toFixed(3), stillInSight: +(stillSight / sight).toFixed(3) }));
