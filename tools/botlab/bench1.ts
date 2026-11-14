// Cost check: segment decode throughput, and the cost of one line-of-sight ray on the recorded maps.
import { decodeSegment } from '/home/user/workspace/repo/shared/rec/segment';
import { decodeFrames } from '/home/user/workspace/repo/shared/rec/clean';
import { loadMap, mapDef } from '/home/user/workspace/repo/shared/maps/index';
import { sha256Hex } from '/home/user/workspace/repo/tools/recorder/r2';
const segs: { key: string; size: number }[] = await Bun.file('/tmp/rec/lists/seg.json').json();
const pick = Array.from({ length: 60 }, (_, i) => segs[Math.floor((i + 0.5) * segs.length / 60)]);
let t0 = performance.now(), frames = 0, poses = 0, raw = 0, zst = 0;
const maps = new Map<string, { hash: string; n: number }>();
const sample: { map: string; a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number }; team: number }[] = [];
let tDecomp = 0, tDecode = 0;
for (const s of pick) {
  const bytes = await Bun.file('/tmp/rec/' + s.key.replace(/^v1\//, '')).bytes();
  let t = performance.now();
  const rawBytes = new Uint8Array(Bun.zstdDecompressSync(bytes));
  tDecomp += performance.now() - t; t = performance.now();
  const d = decodeFrames(decodeSegment(rawBytes));
  tDecode += performance.now() - t;
  zst += bytes.length; raw += rawBytes.length; frames += d.frames.length;
  for (const f of d.frames) poses += f.poses.length;
  const m = maps.get(d.header.mapId) ?? { hash: d.header.mapHash, n: 0 }; m.n++; maps.set(d.header.mapId, m);
  // Pairs of opposing soldiers for the ray benchmark.
  const team = new Map(d.header.soldiers.map(x => [x.soldierId, x.team]));
  for (let i = 0; i < d.frames.length; i += 45) {
    const ps = d.frames[i].poses.filter(p => p.alive);
    for (const p of ps) for (const q of ps) if (team.get(p.id) !== team.get(q.id) && sample.length < 60000) sample.push({ map: d.header.mapId, a: { x: p.x, y: p.y + 1.6, z: p.z }, b: { x: q.x, y: q.y + 1.2, z: q.z }, team: team.get(p.id) ?? 0 });
  }
}
const dt = performance.now() - t0;
console.log(`decode: ${pick.length} segments, ${(zst / 1e6).toFixed(1)} MB zstd -> ${(raw / 1e6).toFixed(1)} MB raw, ${frames} frames, ${poses} poses, ${dt.toFixed(0)} ms (decompress ${tDecomp.toFixed(0)}, decode ${tDecode.toFixed(0)}) => ${(dt / pick.length).toFixed(1)} ms/segment, est full pass ${(dt / pick.length * segs.length / 1000 / 60).toFixed(1)} min on one core`);
console.log('frames per segment', (frames / pick.length).toFixed(0), 'poses per frame', (poses / frames).toFixed(1));
for (const [id, m] of maps) {
  const now = sha256Hex(JSON.stringify(mapDef(id)));
  console.log('map', id, 'segments', m.n, 'recorded hash == current', m.hash === now);
}
// Ray cost per map.
const by = new Map<string, typeof sample>();
for (const s of sample) { let a = by.get(s.map); if (!a) by.set(s.map, a = []); a.push(s); }
for (const [id, arr] of by) {
  const tl = performance.now(); const { world, def } = loadMap(id); const load = performance.now() - tl;
  let vis = 0; const t = performance.now();
  for (const s of arr) if (world.lineOfSight(s.a, s.b, s.team)) vis++;
  const per = (performance.now() - t) / arr.length * 1000;
  console.log(`los ${id}: solids ${def.solids.length}, ${arr.length} rays, ${per.toFixed(2)} us/ray, visible ${(100 * vis / arr.length).toFixed(0)}%, map load ${load.toFixed(0)} ms`);
}
