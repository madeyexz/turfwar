// Where and when a duel of the new script against the old script is decided (lab only).
// Usage: bun duel.ts --map taipei --newteam 0 --seed 380 --rounds 24 --skill 0.3,0.3 --loadout mp5 [--kills 1]
import { createContext, createMatch, balanceTeams, tickMatch, AB } from './shared/match/sim';
import { ELIMINATION, type MatchConfig, type MatchEvent } from './shared/match/state';
import { refillAmmo } from './shared/match/economy';
import { clamp } from './shared/math';
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const MAP = arg('map', 'taipei'), NEW = arg('newteam', '0'), SEED = +arg('seed', '380'), ROUNDS = +arg('rounds', '24'), LOADOUT = arg('loadout', 'mp5'), KILLS = arg('kills', '0') === '1';
const bs = arg('skill', '0.3').split(',').map(Number); const SK: [number, number] = [bs[0], bs[1] ?? bs[0]];
// The team under test is on the new script; the other is on the old one ("both" = both new, "none" = both old).
AB.old = [!(NEW === '0' || NEW === 'both'), !(NEW === '1' || NEW === 'both')];
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const DT = 1 / 30;
let rounds = 0, liveT = 0;
const wins = [0, 0], kills = [0, 0];
type K = { r: number; t: number; kt: number; kx: number; kz: number; vx: number; vz: number; d: number; aware: boolean; vGoal: string; vSpeed: number; kGoal: string };
const log: K[] = [];
const wrapA = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const offOf = (a: { m: { x: number; z: number }; yaw: number }, b: { m: { x: number; z: number } }) => Math.abs(wrapA(Math.atan2(-(b.m.x - a.m.x), -(b.m.z - a.m.z)) - a.yaw));
// The first damage of a life: how far off the victim's view the attacker was, by the victim's team.
const firstHit = new Map<number, { off: number; had: boolean; d: number; moving: boolean; foes: number; friends: number }>();
const fh: { team: number; off: number; had: boolean; d: number; died: boolean; moving: boolean; foes: number; friends: number }[] = [];
const nearCount = (v: { id: number; team: number; m: { x: number; z: number } }, same: boolean) => state.soldiers.filter(o => o.alive && o.id !== v.id && (o.team === v.team) === same && Math.hypot(o.m.x - v.m.x, o.m.z - v.m.z) < 15).length;
const away = [{ n: 0, back: 0, side: 0 }, { n: 0, back: 0, side: 0 }];
const ctx = createContext(MAP, rng(SEED), e => onEvent(e));
const config: MatchConfig = { ...ELIMINATION, teamSize: 6, botSkill: SK[0], warmup: 0.2, roundsToWin: 6 };
const state = createMatch(MAP, config);
balanceTeams(state, ctx);
const srand = rng(SEED + 4242);
for (const s of state.soldiers) s.brain!.skill = clamp(SK[s.team] + (srand() - 0.5) * 0.3, 0.15, 0.95);
const byId = (id: number) => state.soldiers.find(s => s.id === id);
function onEvent(e: MatchEvent) {
  if (e.type === 'damage') {
    const a = byId(e.attacker), v = byId(e.target);
    if (a && v && a.team !== v.team && !firstHit.has(v.id)) firstHit.set(v.id, { off: offOf(v, a), had: !!v.brain && v.brain.target === a.id && v.brain.reaction <= 0, d: Math.hypot(a.m.x - v.m.x, a.m.z - v.m.z), moving: Math.hypot(v.m.vx, v.m.vz) > 0.5, foes: nearCount(v, false), friends: nearCount(v, true) });
  } else if (e.type === 'spawn') { firstHit.delete(e.id); }
  if (e.type === 'kill') {
    const f = firstHit.get(e.victim), vv = byId(e.victim);
    if (f && vv) fh.push({ team: vv.team, ...f, died: true });
    firstHit.delete(e.victim);
    const k = byId(e.killer), v = byId(e.victim);
    if (k && v && k.team !== v.team) {
      kills[k.team]++;
      log.push({ r: rounds, t: +(state.time - liveT).toFixed(1), kt: k.team, kx: +k.m.x.toFixed(1), kz: +k.m.z.toFixed(1), vx: +v.m.x.toFixed(1), vz: +v.m.z.toFixed(1), d: +Math.hypot(k.m.x - v.m.x, k.m.z - v.m.z).toFixed(1),
        aware: !!v.brain && v.brain.target === e.killer && v.brain.reaction <= 0, vGoal: v.brain?.goal ?? '', vSpeed: +Math.hypot(v.m.vx, v.m.vz).toFixed(1), kGoal: k.brain?.goal ?? '' });
    }
  } else if (e.type === 'round') {
    if (e.phase === 'freeze' && LOADOUT) for (const s of state.soldiers) { s.weapons[0] = LOADOUT as never; s.attachments = {}; s.grenades = 0; s.molotovs = 0; s.money = 0; s.weapon = 0; refillAmmo(s); }
    if (e.phase === 'live') liveT = state.time;
    else if (e.phase === 'over') { rounds++; if (e.winner >= 0) wins[e.winner]++; }
  }
}
// Mean x and z of each team, and the count alive, at these seconds of the live round.
const AT = [0, 2, 4, 6, 8, 10, 14, 18, 24];
const pos = AT.map(() => [{ x: 0, z: 0, n: 0, alive: 0, sx: 0 }, { x: 0, z: 0, n: 0, alive: 0, sx: 0 }]);
let guard = 0;
while (rounds < ROUNDS && guard++ < ROUNDS * 30 * 400) {
  tickMatch(state, ctx, DT);
  if (state.phase === 'live' && state.roundPhase === 'live') {
    const t = state.time - liveT;
    if (state.tick % 10 === 0) for (const s of state.soldiers) {
      if (!s.alive) continue;
      let best: typeof s | undefined, bd = Infinity;
      for (const o of state.soldiers) if (o.alive && o.team !== s.team) { const d = Math.hypot(o.m.x - s.m.x, o.m.z - s.m.z); if (d < bd) { bd = d; best = o; } }
      if (!best || bd > 40) continue;
      const off = offOf(s, best); away[s.team].n++; if (off > 1.25) away[s.team].back++; else if (off > 0.6) away[s.team].side++;
    }
    for (let i = 0; i < AT.length; i++) if (Math.abs(t - AT[i]) < DT / 2) {
      for (const s of state.soldiers) { const p = pos[i][s.team]; p.n++; if (s.alive) { p.alive++; p.x += s.m.x; p.z += s.m.z; p.sx += s.m.x * s.m.x; } }
    }
  }
}
const nt = NEW === 'both' || NEW === 'none' ? 0 : +NEW, ot = 1 - nt;
console.log(`${MAP} new=team${NEW} seed ${SEED}: wins ${wins[0]}/${wins[1]}, kills ${kills[0]}/${kills[1]}, rounds ${rounds}`);
console.log('t(s)   team0: alive  x     sd     z   | team1: alive  x     sd     z');
for (let i = 0; i < AT.length; i++) {
  const f = (p: typeof pos[0][0]) => { const a = Math.max(1, p.alive), mx = p.x / a; return `${(p.alive / Math.max(1, p.n) * 6).toFixed(1).padStart(5)} ${mx.toFixed(1).padStart(6)} ${Math.sqrt(Math.max(0, p.sx / a - mx * mx)).toFixed(1).padStart(5)} ${(p.z / a).toFixed(1).padStart(6)}`; };
  console.log(`${String(AT[i]).padStart(4)}   ${f(pos[i][0])}   | ${f(pos[i][1])}`);
}
// Deaths of each team by the victim's x (10 m bins) and by the time in the round.
const bins = (team: number, key: (k: K) => number, edges: number[]) => { const out = edges.map(() => 0); for (const k of log) if (k.kt !== team) { let i = edges.findIndex(e => key(k) < e); if (i < 0) i = edges.length - 1; out[i]++; } return out; };
const XE = [-60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60, 1e9], TE = [4, 8, 12, 16, 20, 30, 1e9];
console.log('victim x <', XE.slice(0, -1).join(' '), '+');
for (const t of [0, 1]) console.log(`  team${t} deaths:`, bins(t, k => k.vx, XE).join(' '));
console.log('time <', TE.slice(0, -1).join(' '), '+');
for (const t of [0, 1]) console.log(`  team${t} deaths:`, bins(t, k => k.t, TE).join(' '));
for (const t of [0, 1]) {
  const d = log.filter(k => k.kt !== t), n = Math.max(1, d.length);
  const goals: Record<string, number> = {}; for (const k of d) goals[k.vGoal] = (goals[k.vGoal] ?? 0) + 1;
  const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
  console.log(`  team${t} deaths ${d.length}: aware ${(d.filter(k => k.aware).length / n).toFixed(2)}, still ${(d.filter(k => k.vSpeed < 0.5).length / n).toFixed(2)}, median distance ${med(d.map(k => k.d))}, median time ${med(d.map(k => k.t))}, goals ${JSON.stringify(goals)}`);
}
// The first death of each round: who died first, and when.
const first = [0, 0]; const seenR = new Set<number>(); const ft: number[] = [];
for (const k of log) if (!seenR.has(k.r)) { seenR.add(k.r); first[1 - k.kt]++; ft.push(k.t); }
console.log(`first death of the round: team0 ${first[0]}, team1 ${first[1]}; median time ${[...ft].sort((a, b) => a - b)[ft.length >> 1]}`);
for (const t of [0, 1]) {
  const d = fh.filter(x => x.team === t), n = Math.max(1, d.length);
  const sh = (f: (x: typeof fh[0]) => boolean) => (d.filter(f).length / n).toFixed(2);
  console.log(`  team${t} lives that ended, at the first hit (${d.length}): attacker more than 1.25 rad off the view ${sh(x => x.off > 1.25)}, 0.6 to 1.25 rad ${sh(x => x.off > 0.6 && x.off <= 1.25)}, under 0.6 rad ${sh(x => x.off <= 0.6)}; had the attacker as target ${sh(x => x.had)}; attacker beyond 11 m ${sh(x => x.d > 11)}; inside 15 m: enemies ${(d.reduce((a, x) => a + x.foes, 0) / n).toFixed(2)}, allies ${(d.reduce((a, x) => a + x.friends, 0) / n).toFixed(2)}; moving ${sh(x => x.moving)}`);
  console.log(`  team${t} alive samples with the nearest enemy inside 40 m (${away[t].n}): more than 1.25 rad off the view ${(away[t].back / Math.max(1, away[t].n)).toFixed(2)}, 0.6 to 1.25 rad ${(away[t].side / Math.max(1, away[t].n)).toFixed(2)}`);
}
if (KILLS) for (const k of log.slice(0, 60)) console.log(JSON.stringify(k));
void ot;
