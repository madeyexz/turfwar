// Development helper: bun dev/dump-map.ts cinder > map.json (consumed by a plotting script).
import { cinderBasin } from '../shared/maps/cinder';
const maps: Record<string, () => unknown> = { cinder: cinderBasin };
const m = maps[process.argv[2] ?? 'cinder']() as any;
console.log(JSON.stringify({ ...m, terrain: { ...m.terrain, heights: Array.from(m.terrain.heights) } }));
