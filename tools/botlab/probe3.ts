// How does the server pose of a human move between the client's reports? Prints frames of one aim-clean subject (no ids).
import { decodeSegment } from '/home/user/workspace/repo/shared/rec/segment';
import { decodeFrames } from '/home/user/workspace/repo/shared/rec/clean';
import { local } from './local';
import { readFileSync } from 'node:fs';
let seen = 0; const skip = Number(process.argv[2] ?? 5);
for (const line of readFileSync('/tmp/rec/quality.jsonl', 'utf8').split('\n')) {
  if (!line) continue;
  const { q } = JSON.parse(line);
  const sub = q.qualities.find((x: any) => x.aimClean > 60 && x.teamSize === 6);
  if (!sub) continue;
  if (seen++ < skip) continue;
  const d = decodeFrames(decodeSegment(new Uint8Array(Bun.zstdDecompressSync(await Bun.file(local(q.segment)).bytes()))));
  let moved = 0, same = 0, movingFrames = 0; let prev: any;
  const out: string[] = [];
  for (const f of d.frames) {
    if (f.roundPhase !== 'live') continue;
    const p = f.poses.find(p => p.id === sub.soldierId); if (!p || !p.alive) { prev = undefined; continue; }
    if (prev) {
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 3) { movingFrames++; if (p.x !== prev.x || p.z !== prev.z) moved++; else same++; }
      if (out.length < 45 && sp > 3) out.push(`${f.tick} t=${f.time.toFixed(3)} x=${p.x.toFixed(2)} z=${p.z.toFixed(2)} v=(${p.vx.toFixed(2)},${p.vz.toFixed(2)}) step=${Math.hypot(p.x - prev.x, p.z - prev.z).toFixed(3)} yaw=${p.yaw.toFixed(4)} dyaw=${(p.yaw - prev.yaw).toFixed(4)}`);
    }
    prev = p;
  }
  console.log(out.join('\n'));
  console.log('moving frames', movingFrames, 'pos changed', moved, 'same', same);
  break;
}
