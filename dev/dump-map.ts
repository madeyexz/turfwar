// Development helper: bun dev/dump-map.ts cinder > map.json (consumed by a plotting script).
import { loadMap } from '../shared/maps/index';
const m = loadMap(process.argv[2] ?? 'cinder').def as any;
console.log(JSON.stringify({ ...m, terrain: { ...m.terrain, heights: Array.from(m.terrain.heights) } }));
