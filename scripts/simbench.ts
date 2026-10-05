/**
 * Times the shared match simulation alone (no database, no rendering) on a battlefield at its
 * full team size: how much of a 33 ms server tick the bots and the lawful world use.
 *
 *   bun scripts/simbench.ts meridian 60
 */
import { rng } from '../shared/math';
import { balanceTeams, createContext, createMatch, takeSnapshot, tickMatch, TICK_RATE } from '../shared/match/sim';
import { ONLINE_CONFIG } from '../shared/match/state';

const mapId = process.argv[2] ?? 'meridian';
const seconds = Number(process.argv[3] ?? 60);
const random = rng(7);
let events = 0;
const ctx = createContext(mapId, random, () => { events++; });
const state = createMatch(mapId, { ...ONLINE_CONFIG, warmup: 1 }, random);
balanceTeams(state, ctx);
const times: number[] = [];
for (let i = 0; i < seconds * TICK_RATE; i++) {
  const t0 = performance.now();
  tickMatch(state, ctx, 1 / TICK_RATE);
  times.push(performance.now() - t0);
}
// Per-tick serialization the module does on top of the simulation.
const t0 = performance.now();
for (let i = 0; i < 100; i++) { for (const s of state.soldiers) { JSON.stringify(s); if (s.brain) JSON.parse(JSON.stringify(s.brain)); } JSON.stringify(takeSnapshot(state)); }
const serialize = (performance.now() - t0) / 100;
times.sort((a, b) => a - b);
const pct = (q: number) => times[Math.floor(q * (times.length - 1))].toFixed(2);
console.log(JSON.stringify({
  mapId, soldiers: state.soldiers.length, kills: state.soldiers.reduce((a, s) => a + s.kills, 0), events,
  tickMs: { mean: (times.reduce((a, b) => a + b, 0) / times.length).toFixed(2), p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: pct(1) },
  serializeMsPerTick: serialize.toFixed(2),
}));
