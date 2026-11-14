// Probe one aim-clean subject-round: roster rows, events, input header and record rates. Prints no pid, name or session id.
import { decodeSegment } from '/home/user/workspace/repo/shared/rec/segment';
import { decodeFrames, clockFit } from '/home/user/workspace/repo/shared/rec/clean';
import { In } from '/home/user/workspace/repo/shared/rec/inputlog';
import { inputsFor } from '/home/user/workspace/repo/tools/recorder/lib';
import { client, local } from './local';
import { readFileSync } from 'node:fs';

const want = process.argv[2] ?? 'sabotage';
const skip = Number(process.argv[3] ?? 0);
let seen = 0;
for (const line of readFileSync('/tmp/rec/quality.jsonl', 'utf8').split('\n')) {
  if (!line) continue;
  const { key, q } = JSON.parse(line);
  const sub = q.qualities.find((x: any) => x.aimClean > 60 && x.mode === want && x.teamSize === 6);
  if (!sub) continue;
  if (seen++ < skip) continue;
  const segKey = q.segment as string;
  const seg = decodeSegment(new Uint8Array(Bun.zstdDecompressSync(await Bun.file(local(segKey)).bytes())));
  const d = decodeFrames(seg);
  console.log('segment', segKey.replace(/room=[^/]+/, 'room=<r>'), 'frames', d.frames.length, 'tps', d.header.ticksPerSecond, 'map', d.header.mapId, 'mode', d.header.mode);
  console.log('config', d.header.configJson.slice(0, 600));
  console.log('soldiers', d.header.soldiers.map(s => `${s.soldierId}:${s.team}${s.bot ? 'b' : s.pid ? 'S' : 'x'}`).join(' '));
  const mask = (r: Record<string, unknown>) => JSON.stringify({ ...r, name: '<n>', ...(r.pid ? { pid: '<pid>' } : {}), ...(r.identity ? { identity: '<id>' } : {}) });
  const me = d.roster.filter(r => r.r.id === sub.soldierId);
  console.log('roster rows total', d.roster.length, 'mine', me.length);
  for (const r of me.slice(0, 3)) console.log(' tick', r.tick, mask(r.r).slice(0, 900));
  const bot = d.roster.find(r => r.r.bot);
  if (bot) console.log(' bot row', mask(bot.r).slice(0, 900));
  const types: Record<string, number> = {};
  for (const e of d.events) types[e.e.type] = (types[e.e.type] ?? 0) + 1;
  console.log('events', types);
  for (const t of ['round', 'bomb', 'reward', 'damage', 'kill']) { const xs = d.events.filter(e => e.e.type === t).slice(0, 3); for (const e of xs) console.log(' ', e.tick, JSON.stringify(e.e)); }
  const f0 = d.frames[0], f1 = d.frames[d.frames.length - 1];
  console.log('frame0 tick', f0.tick, 'time', f0.time, 'phase', f0.roundPhase, 'phaseLeft', f0.phaseLeft, '| last tick', f1.tick, 'time', f1.time, f1.roundPhase);
  const phases: Record<string, number> = {}; for (const f of d.frames) phases[f.roundPhase] = (phases[f.roundPhase] ?? 0) + 1; console.log('phases', phases);
  // Frame time deltas.
  const dts = d.frames.slice(1).map((f, i) => f.time - d.frames[i].time).sort((a, b) => a - b);
  console.log('dt p05/p50/p95', dts[Math.floor(dts.length * 0.05)].toFixed(4), dts[Math.floor(dts.length * 0.5)].toFixed(4), dts[Math.floor(dts.length * 0.95)].toFixed(4));
  const found = await inputsFor(client, 'v1', sub.pid, seg, sub.soldierId);
  console.log('input sessions', found.sessions.length, 'batches', found.keys.length);
  for (const s of found.sessions) {
    const h = s.header as any;
    console.log(' header', JSON.stringify({ ...h, session: '<s>', keys: undefined, timeOrigin: '<t>' }).slice(0, 700));
    console.log(' keys', h.keys.length, 'actions', JSON.stringify(h.actions));
    const n: Record<number, number> = {};
    for (const r of s.records) n[r.type] = (n[r.type] ?? 0) + 1;
    const span = (s.records[s.records.length - 1].t - s.records[0].t) / 1000;
    console.log(' records', n, 'span s', span.toFixed(1), 'frames/s', ((n[In.Frame] ?? 0) / span).toFixed(1), 'moves/s', ((n[In.Move] ?? 0) / span).toFixed(1));
    const sends0 = s.records.filter(r => r.type === In.Send && r.kind === 0);
    const gaps = sends0.slice(1).map((r, i) => r.t - sends0[i].t).sort((a, b) => a - b);
    if (gaps.length) console.log(' move reports/s', (sends0.length / span).toFixed(1), 'gap ms p05/p50/p95', gaps[Math.floor(gaps.length * 0.05)].toFixed(1), gaps[Math.floor(gaps.length * 0.5)].toFixed(1), gaps[Math.floor(gaps.length * 0.95)].toFixed(1));
    const fit = clockFit(s.records);
    console.log(' clock fit residual', fit?.residual.toFixed(2), 'points', fit?.points);
    // A few frame records around a shot.
    const shotAt = s.records.findIndex(r => r.type === In.Send && r.kind === 1);
    if (shotAt > 0) for (const r of s.records.slice(Math.max(0, shotAt - 6), shotAt + 10)) console.log('  ', r.type, r.t.toFixed(1), JSON.stringify({ ...r, type: undefined, t: undefined }).slice(0, 220));
  }
  break;
}
