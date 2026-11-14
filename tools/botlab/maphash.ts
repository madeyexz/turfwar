// Count segments per (mapId, mapHash) in the manifests, and compare with the hash of the repo's current map definition.
import { mapDef } from '/home/user/workspace/repo/shared/maps/index';
import { sha256Hex } from '/home/user/workspace/repo/tools/recorder/r2';
import { lists, local } from './local';
import { manifestKey } from '/home/user/workspace/repo/tools/recorder/lib';
import { readFileSync } from 'node:fs';
const now = new Map<string, string>();
const seen = new Map<string, { n: number; first: string; last: string }>();
for (const { key } of lists.seg) {
  let m; try { m = JSON.parse(readFileSync(local(manifestKey(key)), 'utf8')); } catch { continue; }
  const k = `${m.mapId} ${m.mapHash.slice(0, 10)} mod=${m.moduleHash.slice(0, 8)}`;
  const day = new Date(m.startMs).toISOString().slice(0, 10);
  const e = seen.get(k) ?? { n: 0, first: day, last: day };
  e.n++; if (day < e.first) e.first = day; if (day > e.last) e.last = day;
  seen.set(k, e);
  if (!now.has(m.mapId)) { try { now.set(m.mapId, sha256Hex(JSON.stringify(mapDef(m.mapId)))); } catch { now.set(m.mapId, 'unknown'); } }
}
const byMap = new Map<string, { same: number; diff: number }>();
const mods = new Map<string, { n: number; first: string; last: string }>();
for (const [k, e] of [...seen].sort()) {
  const [id, h, mod] = k.split(' ');
  const same = now.get(id)!.startsWith(h);
  const b = byMap.get(id) ?? { same: 0, diff: 0 }; if (same) b.same += e.n; else b.diff += e.n; byMap.set(id, b);
  const mm = mods.get(mod) ?? { n: 0, first: e.first, last: e.last }; mm.n += e.n; if (e.first < mm.first) mm.first = e.first; if (e.last > mm.last) mm.last = e.last; mods.set(mod, mm);
}
console.log('map: segments with the current hash / another hash');
for (const [id, b] of byMap) console.log(' ', id, b.same, b.diff);
console.log('module versions', mods.size);
for (const [k, e] of [...mods].sort((a, b) => a[1].first < b[1].first ? -1 : 1)) console.log(' ', k, e.n, e.first, e.last);
const diffs = [...seen].filter(([k]) => { const [id, h] = k.split(' '); return !now.get(id)!.startsWith(h); });
console.log('other-hash groups', diffs.length); for (const [k, e] of diffs.slice(0, 30)) console.log(' ', k, e.n, e.first, e.last);
