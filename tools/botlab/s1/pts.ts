import { PLAYABLE_MAP_IDS, mapDef, loadNav } from '/home/user/workspace/repo/shared/maps';
for (const id of PLAYABLE_MAP_IDS) {
  const m: any = mapDef(id), b = m.bounds;
  const nav = loadNav(id);
  console.log(id.padEnd(12), 'points', String(m.points.length).padStart(3), 'spawns', m.spawns.length, 'size', Math.round(b.maxX - b.minX) + 'x' + Math.round(b.maxZ - b.minZ), 'sites', m.sabotage?.sites?.length ?? 0, 'nodes', nav.x.length, 'radius', m.points.slice(0, 5).map((p: any) => p.radius).join(','));
}
