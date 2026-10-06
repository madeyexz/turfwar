import { describe, expect, it } from 'vitest';
import { cutTest, modelCut } from './dressing';
import { MAP_IDS, loadMap } from './index';
import { BARRICADE_BUS, CORDON_Z, PLAY, POLICE_VANS } from './taipei-compact';
import { DELIVERY_VANS, KERB, vanRect, type Rect } from './taipei-cover';
import { STREET_MODELS } from './taipei-street';

/**
 * Parked (decorative, not drivable) vehicles a soldier can reach must block him: every car, taxi,
 * scooter, YouBike, van and bus drawn inside a map's bounds stands on a collider. Backdrop past
 * the bounds is out of reach and needs none. Drivable vehicles are tested in shared/vehicles.test.ts.
 */

/** A parked vehicle: points along its length (map coordinates) and the floor it stands on. */
interface Parked { what: string; y: number; points: { x: number; z: number }[] }

/** The street models of each dressing set (what src/render/dressing.ts draws from it). */
// taipei101's set is the city 383 m below the office floor: nothing in it is in reach.
const DRESSING_MODELS: Record<string, Record<string, number[]>> = { taipei: STREET_MODELS, taipei101: {} };
/** Two-wheelers among the dressing models, about 1.8 m long. */
const TWO_WHEELERS = ['scooter', 'bike'];
/** Instance models that are cars (src/render/dressing.ts carGeometry: 1.8 × 4.5 m). */
const CARS = ['car', 'taxi'];
/** Model instance rows: x, y, z, heading, scale, roll, colour, extra. */
const STRIDE = 8;

/** A model's points along its length: the source's models face local +z, turned by -heading. */
const along = (x: number, z: number, heading: number, offsets: number[]) =>
  offsets.map(t => ({ x: x - Math.sin(heading) * t, z: z + Math.cos(heading) * t }));

/** Points down the long axis of a source rect, its ends inset, shifted to map coordinates. */
function rectPoints([x0, z0, x1, z1]: Rect, ox: number, oz: number) {
  const alongX = x1 - x0 >= z1 - z0, cx = (x0 + x1) / 2 - ox, cz = (z0 + z1) / 2 - oz, half = Math.max(x1 - x0, z1 - z0) / 2 - 0.6;
  return [-half, 0, half].map(t => alongX ? { x: cx + t, z: cz } : { x: cx, z: cz + t });
}

function parkedVehicles(id: string): Parked[] {
  const { def } = loadMap(id), out: Parked[] = [];
  for (const d of def.decor) {
    if (d.kind === 'instances' && CARS.includes(d.model)) {
      for (let i = 0; i < d.data.length; i += STRIDE) {
        const [x, y, z, heading] = d.data.slice(i, i + 4);
        out.push({ what: `${d.model} at ${x.toFixed(1)}, ${z.toFixed(1)}`, y, points: along(x, z, heading, [-1.9, 0, 1.9]) });
      }
    }
    if (d.kind === 'dressing') {
      const models = DRESSING_MODELS[d.set];
      expect(models, `dressing set ${d.set} has no models listed here`).toBeDefined();
      const cut = cutTest([...(d.cut ?? []), ...(d.clear ?? [])]);
      for (const model of TWO_WHEELERS) {
        const rows = models[model] ?? [];
        for (let i = 0; i < rows.length; i += STRIDE) {
          const [sx, y, sz, heading] = rows.slice(i, i + 4), x = sx - d.x, z = sz - d.z;
          // The renderer drops what stands in a cut; that needs no collider.
          if (modelCut(cut, x, y, z)) continue;
          out.push({ what: `${d.set} ${model} at source ${sx}, ${sz}`, y, points: along(x, z, heading, [-0.75, 0, 0.75]) });
        }
      }
    }
  }
  // Ximending's vans and bus are built from boxes (taipei-cover.ts, taipei-compact.ts).
  if (id === 'taipei') {
    const ox = (PLAY.x0 + PLAY.x1) / 2, oz = (PLAY.z0 + PLAY.z1) / 2;
    for (const [x0, z0, alongX] of DELIVERY_VANS) out.push({ what: `delivery van at source ${x0}, ${z0}`, y: KERB, points: rectPoints(vanRect(x0, z0, alongX), ox, oz) });
    for (const [x0] of POLICE_VANS) out.push({ what: `police van at source ${x0}, ${CORDON_Z}`, y: 0, points: rectPoints(vanRect(x0, CORDON_Z, true), ox, oz) });
    out.push({ what: 'barricade bus', y: KERB, points: rectPoints(BARRICADE_BUS, ox, oz) });
  }
  return out;
}

describe('parked vehicles', () => {
  it.each(MAP_IDS)('%s: every parked vehicle inside the bounds blocks a soldier', id => {
    const { def, world } = loadMap(id), b = def.bounds;
    const inside = (p: { x: number; z: number }) => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ;
    const open: string[] = [];
    for (const v of parkedVehicles(id)) {
      // A soldier (any part of him: 0.3 m round, knee to head) stood on any reachable point of it.
      const loose = v.points.filter(inside).filter(p => !world.overlapsSolid({ x: p.x, y: v.y + 0.05, z: p.z }, 0.3, 1.0));
      if (loose.length) open.push(`${v.what}: walk-through at ${loose.map(p => `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).join('; ')}`);
    }
    expect(open).toEqual([]);
  });

  it('taipei: the parked vehicles are found (the check above is not vacuous)', () => {
    const { def } = loadMap('taipei'), b = def.bounds;
    const reachable = parkedVehicles('taipei').filter(v => v.points.some(p => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ));
    expect(reachable.filter(v => v.what.includes('scooter')).length).toBeGreaterThan(20);
    expect(reachable.filter(v => v.what.includes('van') || v.what.includes('bus')).length).toBe(DELIVERY_VANS.length + POLICE_VANS.length + 1);
  });
});
