/**
 * Times the shared match simulation alone (no database, no rendering) on a map at the largest
 * room size (6v6): how much of a 33 ms server tick the bots and the lawful world use.
 *
 *   bun scripts/simbench.ts taipei 60
 */
import { rng } from '../shared/math';
import { encodeFrame } from '../shared/match/frame';
import { balanceTeams, createContext, createMatch, tickMatch, TICK_RATE } from '../shared/match/sim';
import { ONLINE_CONFIG } from '../shared/match/state';

const mapId = process.argv[2] ?? 'taipei';
const seconds = Number(process.argv[3] ?? 60);
const random = rng(7);
let events = 0;
const ctx = createContext(mapId, random, () => { events++; });
// Full team size: 6v6.
const state = createMatch(mapId, { ...ONLINE_CONFIG, teamSize: 6, warmup: 1 });
balanceTeams(state, ctx);
const times: number[] = [];
for (let i = 0; i < seconds * TICK_RATE; i++) {
  const t0 = performance.now();
  tickMatch(state, ctx, 1 / TICK_RATE);
  times.push(performance.now() - t0);
}
// Per-tick serialization the module does on top of the simulation.
const t0 = performance.now();
for (let i = 0; i < 100; i++) { for (const s of state.soldiers) { JSON.stringify(s); if (s.brain) JSON.parse(JSON.stringify(s.brain)); } encodeFrame(state, []); }
const serialize = (performance.now() - t0) / 100;
times.sort((a, b) => a - b);
const pct = (q: number) => times[Math.floor(q * (times.length - 1))].toFixed(2);
console.log(JSON.stringify({
  mapId, soldiers: state.soldiers.length, kills: state.soldiers.reduce((a, s) => a + s.kills, 0), events,
  tickMs: { mean: (times.reduce((a, b) => a + b, 0) / times.length).toFixed(2), p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: pct(1) },
  serializeMsPerTick: serialize.toFixed(2),
}));
