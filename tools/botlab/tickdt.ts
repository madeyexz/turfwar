// Why do the 24v24 segments run below 30 ticks per second? Compare, for each segment, the simulation time per tick
// (the frame clock: the module's dt, capped at 0.1 s) with the recorder's wall-clock per tick (record.ms).
// Totals only; no player ids are read or printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeSegment, Rec } from '/home/user/workspace/repo/shared/rec/segment';
import { decodeFrames } from '/home/user/workspace/repo/shared/rec/clean';
import { local } from './local';

const lines = readFileSync('/tmp/rec/quality.jsonl', 'utf8').split('\n').filter(Boolean);
const per = Number(process.argv[2] ?? 400);
type Row = { ts: number; soldiers: number; humans: number; frames: number; tps: number; gap: number; simDt: number; wallDt: number; capped: number; burst: number; startMs: number; endMs: number; room: number; late: number };
const picked: { seg: string; ts: number }[] = [];
const count: Record<number, number> = {};
// Every 24v24 segment, and an evenly spread sample of the others.
const bySize: Record<number, string[]> = {};
for (const l of lines) { const q = JSON.parse(l).q; const ts = q.qualities[0]?.teamSize; if (ts === undefined || q.checks.frames < 300) continue; (bySize[ts] ??= []).push(q.segment); }
for (const [ts, segs] of Object.entries(bySize)) { const step = Math.max(1, Math.floor(segs.length / (Number(ts) === 24 ? 1e9 : per)) || 1); for (let i = 0; i < segs.length; i += Number(ts) === 24 ? 1 : step) picked.push({ seg: segs[i], ts: Number(ts) }); count[Number(ts)] = segs.length; }
const rows: Row[] = [];
for (const { seg, ts } of picked) {
  let s;
  try { s = decodeSegment(new Uint8Array(Bun.zstdDecompressSync(await Bun.file(local(seg)).bytes()))); } catch { continue; }
  const d = decodeFrames(s);
  const fr = s.records.filter(r => r.type === Rec.Frame);
  if (fr.length < 300 || d.frames.length !== fr.length) continue;
  const n = fr.length, ticks = fr[n - 1].tick - fr[0].tick;
  let capped = 0, burst = 0, pairs = 0, late = 0;
  for (let i = 1; i < n; i++) {
    if (fr[i].tick !== fr[i - 1].tick + 1) continue;
    pairs++;
    const dt = d.frames[i].time - d.frames[i - 1].time;
    if (dt >= 0.099) capped++;
    if (dt >= 0.045) late++;
    if (fr[i].ms - fr[i - 1].ms <= 2) burst++;
  }
  rows.push({
    ts, soldiers: s.header.soldiers.length, humans: s.header.soldiers.filter(x => !x.bot).length, frames: n, tps: s.header.ticksPerSecond, gap: s.header.gapRatio,
    simDt: (d.frames[n - 1].time - d.frames[0].time) / ticks, wallDt: (fr[n - 1].ms - fr[0].ms) / 1000 / ticks, capped: capped / pairs, burst: burst / pairs, late: late / pairs,
    startMs: s.header.startMs, endMs: s.header.endMs, room: s.header.room,
  });
}
writeFileSync('/tmp/rec/out/tickdt.json', JSON.stringify({ count, rows }));
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
for (const ts of [1, 6, 24]) {
  const r = rows.filter(x => x.ts === ts); if (!r.length) continue;
  console.log(`size ${ts}: n ${r.length} of ${count[ts]}; soldiers med ${med(r.map(x => x.soldiers))}; humans med ${med(r.map(x => x.humans))}; wall Hz med ${(1 / med(r.map(x => x.wallDt))).toFixed(1)}; sim dt med ${(med(r.map(x => x.simDt)) * 1000).toFixed(1)} ms; wall dt med ${(med(r.map(x => x.wallDt)) * 1000).toFixed(1)} ms; ticks with dt>=45ms med ${(med(r.map(x => x.late)) * 100).toFixed(0)}%; capped med ${(med(r.map(x => x.capped)) * 100).toFixed(1)}%; burst med ${(med(r.map(x => x.burst)) * 100).toFixed(1)}%; gap med ${(med(r.map(x => x.gap)) * 100).toFixed(2)}%`);
}
