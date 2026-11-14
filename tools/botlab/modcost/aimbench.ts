/**
 * LAB ONLY. Times the shared match simulation and the learned aim's work (spacetimedb/src/aimcost.ts of the lab tree)
 * under Bun, with the same cycle of modes as the module. Run it on two hosts to compare their speed.
 *
 *   bun scripts/aimbench.ts meridian 60 [teamSize]
 */
import { loadMap } from '../shared/maps/index';
import { rng } from '../shared/math';
import { encodeFrame } from '../shared/match/frame';
import { balanceTeams, createContext, createMatch, tickMatch, TICK_RATE } from '../shared/match/sim';
import { ONLINE_CONFIG } from '../shared/match/state';
import { aimHook, aimReport, aimTickEnd, CLOCK } from '../spacetimedb/src/aimcost';
import { cpus } from 'node:os';

CLOCK.now = () => performance.now(); CLOCK.fine = process.env.FINE !== '0';
const mapId = process.argv[2] ?? 'meridian';
const seconds = Number(process.argv[3] ?? 60);
const random = rng(7);
let events = 0;
const ctx = createContext(mapId, random, () => { events++; });
const teamSize = Number(process.argv[4] ?? 0) || (loadMap(mapId).def.big ? 24 : 6);
const state = createMatch(mapId, { ...ONLINE_CONFIG, teamSize, warmup: 1 });
balanceTeams(state, ctx);
const wall0 = performance.now();
let simMs = 0, n = 0;
const times: number[] = [];
// PACE=1: one tick each 1/30 s of real time (as the server does), with the per-tick serialization of the module in
// the loop. The caches are then as cold as in a real tick; without it the ticks run back to back.
const paced = process.env.PACE === '1';
let serMs = 0, late = 0;
for (let i = 0; i < seconds * TICK_RATE; i++) {
  const t0 = performance.now();
  tickMatch(state, ctx, 1 / TICK_RATE);
  const t1 = performance.now();
  simMs += t1 - t0; n++; times.push(t1 - t0);
  aimHook(1, state, ctx);
  aimTickEnd(1, t0, () => undefined);
  if (paced) {
    const s1 = performance.now();
    for (const s of state.soldiers) { JSON.stringify(s); if (s.brain) JSON.parse(JSON.stringify(s.brain)); }
    encodeFrame(state, []);
    serMs += performance.now() - s1;
    const wait = wall0 + (i + 1) * (1000 / TICK_RATE) - performance.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait)); else late++;
  }
}
const wall = performance.now() - wall0;
// The serialization that the module does each tick on top of the simulation (as scripts/simbench.ts).
const s0 = performance.now();
for (let i = 0; i < 100; i++) { for (const s of state.soldiers) { JSON.stringify(s); if (s.brain) JSON.parse(JSON.stringify(s.brain)); } encodeFrame(state, []); }
const serialize = (performance.now() - s0) / 100;
// A fixed float loop (the same as the module probe): 1.024e8 multiply-adds.
const a = new Float32Array(1024), b = new Float32Array(1024);
for (let i = 0; i < 1024; i++) { a[i] = i * 0.001; b[i] = 1 - i * 0.0005; }
let sum = 0; const f0 = performance.now();
for (let r = 0; r < 100000; r++) { let acc = 0; for (let i = 0; i < 1024; i++) acc += a[i] * b[i]; sum += acc; }
const floatNs = (performance.now() - f0) * 1e6 / (100000 * 1024);
times.sort((x, y) => x - y);
const pct = (q: number) => +(times[Math.floor(q * (times.length - 1))] * 1000).toFixed(0);
console.log(JSON.stringify({
  bun: Bun.version, cpu: cpus()[0]?.model, cores: cpus().length, mapId, soldiers: state.soldiers.length, seconds, wallSeconds: +(wall / 1000).toFixed(1), events,
  kills: state.soldiers.reduce((x, s) => x + s.kills, 0), simUs: { mean: +(simMs * 1000 / n).toFixed(1), p50: pct(0.5), p95: pct(0.95), p99: pct(0.99) },
  serializeUsPerTick: +(serialize * 1000).toFixed(1), paced, pacedSerializeUs: +(serMs * 1000 / n).toFixed(1), lateTicks: late, floatNsPerMulAdd: +floatNs.toFixed(3), sum: +sum.toFixed(0), aim: aimReport(1),
}));
