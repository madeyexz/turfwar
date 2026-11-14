// 24v24 tick stalls: when do they happen? Wall-clock gaps between frames by round phase and by soldiers alive,
// and 6v6 rooms that ran at the same time as a 24v24 room. Totals only.
import { readFileSync } from 'node:fs';
import { decodeSegment, Rec } from '/home/user/workspace/repo/shared/rec/segment';
import { decodeFrames } from '/home/user/workspace/repo/shared/rec/clean';
import { local } from './local';

const lines = readFileSync('/tmp/rec/quality.jsonl', 'utf8').split('\n').filter(Boolean);
const segs: { seg: string; ts: number }[] = [];
for (const l of lines) { const q = JSON.parse(l).q; const ts = q.qualities[0]?.teamSize; if (ts === undefined || q.checks.frames < 300) continue; segs.push({ seg: q.segment, ts }); }
const EDGES = [20, 45, 70, 100, 150, 250, 1e9];
const hist = (): number[] => new Array(EDGES.length).fill(0);
const bin = (ms: number) => EDGES.findIndex(e => ms < e);
const big = { all: hist(), freeze: hist(), live: hist(), over: hist(), alive: [hist(), hist(), hist(), hist()], bytes: 0, frames: 0, byDate: {} as Record<string, [number, number]>, humans: {} as Record<string, [number, number]> };
const spans: { a: number; b: number }[] = [];
for (const { seg, ts } of segs) {
  if (ts !== 24) continue;
  let s; try { s = decodeSegment(new Uint8Array(Bun.zstdDecompressSync(await Bun.file(local(seg)).bytes()))); } catch { continue; }
  const d = decodeFrames(s); const fr = s.records.filter(r => r.type === Rec.Frame);
  if (d.frames.length !== fr.length) continue;
  spans.push({ a: s.header.startMs, b: s.header.endMs });
  const date = seg.match(/dt=([^/]+)/)![1];
  const humans = String(Math.min(6, s.header.soldiers.filter(x => !x.bot).length));
  for (let i = 1; i < fr.length; i++) {
    if (fr[i].tick !== fr[i - 1].tick + 1) continue;
    const ms = fr[i].ms - fr[i - 1].ms, b = bin(ms), F = d.frames[i];
    big.all[b]++; big[F.roundPhase][b]++;
    const alive = F.poses.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
    if (F.roundPhase === 'live') big.alive[Math.max(0, Math.min(3, Math.floor((alive - 1) / 12)))][b]++;
    big.bytes += fr[i].data.length; big.frames++;
    const e = (big.byDate[date] ??= [0, 0]); e[0]++; if (ms >= 70) e[1]++;
    const h = (big.humans[humans] ??= [0, 0]); h[0]++; if (ms >= 70) h[1]++;
  }
}
spans.sort((x, y) => x.a - y.a);
const overlaps = (a: number, b: number) => spans.some(s => s.a < b && s.b > a);
const six = { with: hist(), without: hist(), nWith: 0, nWithout: 0, bytes: 0, frames: 0 };
// All 6v6 segments that overlap a 24v24 segment (cheap test on the key's time is not possible, so decode headers of a sample near those days).
const days = new Set(Object.keys(big.byDate));
let tried = 0;
for (const { seg, ts } of segs) {
  if (ts !== 6 || !days.has(seg.match(/dt=([^/]+)/)![1])) continue;
  if (tried++ % 3) continue;
  let s; try { s = decodeSegment(new Uint8Array(Bun.zstdDecompressSync(await Bun.file(local(seg)).bytes()))); } catch { continue; }
  const fr = s.records.filter(r => r.type === Rec.Frame);
  const ov = overlaps(s.header.startMs, s.header.endMs);
  const h = ov ? six.with : six.without; if (ov) six.nWith++; else six.nWithout++;
  for (let i = 1; i < fr.length; i++) { if (fr[i].tick !== fr[i - 1].tick + 1) continue; h[bin(fr[i].ms - fr[i - 1].ms)]++; six.bytes += fr[i].data.length; six.frames++; }
}
const pc = (h: number[]) => { const t = h.reduce((a, b) => a + b, 0) || 1; return h.map(x => (100 * x / t).toFixed(1)).join(' ') + `  (n ${t})`; };
console.log('wall gap between frames, % in bins <20 | 20-45 | 45-70 | 70-100 | 100-150 | 150-250 | >250 ms');
console.log('24v24 all   ', pc(big.all)); console.log('24v24 freeze', pc(big.freeze)); console.log('24v24 live  ', pc(big.live)); console.log('24v24 over  ', pc(big.over));
big.alive.forEach((h, i) => console.log(`24v24 live, alive ${i * 12 + 1}-${i * 12 + 12}`, pc(h)));
console.log('6v6 during a 24v24 round ', pc(six.with), 'segments', six.nWith); console.log('6v6, no 24v24 round      ', pc(six.without), 'segments', six.nWithout);
console.log('frame bytes: 24v24', (big.bytes / big.frames).toFixed(0), ' 6v6', (six.bytes / Math.max(1, six.frames)).toFixed(0));
console.log('24v24 share of gaps >= 70 ms by date:', Object.entries(big.byDate).sort().map(([d, [n, l]]) => `${d.slice(5)} ${(100 * l / n).toFixed(0)}% (${n})`).join(', '));
console.log('24v24 share of gaps >= 70 ms by humans in the room:', Object.entries(big.humans).sort().map(([d, [n, l]]) => `${d}: ${(100 * l / n).toFixed(0)}% (${n})`).join(', '));
