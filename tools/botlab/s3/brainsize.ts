// Scratch: the size of the bots' brain JSON, and the time to write and read it, on one tree.
const root = process.argv[2], mapId = process.argv[3] ?? 'meridian', seconds = Number(process.argv[4] ?? 60);
const { loadMap } = await import(root + '/shared/maps/index');
const { rng } = await import(root + '/shared/math');
const { balanceTeams, createContext, createMatch, tickMatch, TICK_RATE } = await import(root + '/shared/match/sim');
const { ONLINE_CONFIG } = await import(root + '/shared/match/state');
const ctx = createContext(mapId, rng(7), () => {});
const state = createMatch(mapId, { ...ONLINE_CONFIG, teamSize: loadMap(mapId).def.big ? 24 : 6, warmup: 1 });
balanceTeams(state, ctx);
let bytes = 0, pathBytes = 0, n = 0, ms = 0, ticks = 0, tickMs = 0;
for (let i = 0; i < seconds * TICK_RATE; i++) {
  const a = performance.now();
  tickMatch(state, ctx, 1 / TICK_RATE);
  tickMs += performance.now() - a;
  const t0 = performance.now();
  const all: string[] = [];
  for (const s of state.soldiers) if (s.brain) all.push(JSON.stringify(s.brain));
  for (const j of all) JSON.parse(j);
  ms += performance.now() - t0; ticks++;
  if (i % 15 === 0) for (const s of state.soldiers) if (s.brain) { bytes += JSON.stringify(s.brain).length; pathBytes += JSON.stringify(s.brain.path).length; n++; }
}
console.log(JSON.stringify({ mapId, bots: state.soldiers.filter((s: any) => s.brain).length, brainBytes: Math.round(bytes / n), pathBytes: Math.round(pathBytes / n), brainJsonMsPerTick: +(ms / ticks).toFixed(3), tickMs: +(tickMs / ticks).toFixed(3) }));
