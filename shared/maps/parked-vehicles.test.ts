import { describe, expect, it } from 'vitest';
import { MAP_IDS, loadMap } from './index';

/**
 * Parked (decorative, not drivable) vehicles a soldier can reach must block him: every car, taxi and
 * scooter drawn inside a map's bounds stands on a collider. Backdrop past the bounds is out of reach
 * and needs none. Drivable vehicles are tested in shared/vehicles.test.ts; vans and buses are built
 * from collision boxes, so they block by construction.
 */

/** A parked vehicle: points along its length (map coordinates) and the floor it stands on. */
interface Parked { what: string; y: number; points: { x: number; z: number }[] }

/** Two-wheelers among the instance models, about 1.8 m long. */
const TWO_WHEELERS = ['scooter', 'bike'];
/** Instance models that are cars (src/render/dressing.ts carGeometry: 1.8 × 4.5 m). */
const CARS = ['car', 'taxi'];
/** Model instance rows: x, y, z, heading, scale, roll, colour, extra. */
const STRIDE = 8;

/** A model's points along its length: models face local +z, turned by -heading. */
const along = (x: number, z: number, heading: number, offsets: number[]) =>
  offsets.map(t => ({ x: x - Math.sin(heading) * t, z: z + Math.cos(heading) * t }));

function parkedVehicles(id: string): Parked[] {
  const { def } = loadMap(id), out: Parked[] = [];
  for (const d of def.decor) {
    if (d.kind === 'instances' && CARS.includes(d.model)) {
      for (let i = 0; i < d.data.length; i += STRIDE) {
        const [x, y, z, heading] = d.data.slice(i, i + 4);
        out.push({ what: `${d.model} at ${x.toFixed(1)}, ${z.toFixed(1)}`, y, points: along(x, z, heading, [-1.9, 0, 1.9]) });
      }
    }
    // Scooters and bikes placed as model instances by the map itself (parked rows).
    if (d.kind === 'instances' && TWO_WHEELERS.includes(d.model)) {
      for (let i = 0; i < d.data.length; i += STRIDE) {
        const [x, y, z, heading] = d.data.slice(i, i + 4);
        out.push({ what: `${d.model} at ${x.toFixed(1)}, ${z.toFixed(1)}`, y, points: along(x, z, heading, [-0.75, 0, 0.75]) });
      }
    }
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

  it('sanchong: its rows of parked scooters are found (the check above is not vacuous)', () => {
    const { def } = loadMap('sanchong'), b = def.bounds;
    const reachable = parkedVehicles('sanchong').filter(v => v.points.some(p => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ));
    expect(reachable.filter(v => v.what.includes('scooter')).length).toBeGreaterThan(100);
  });

  it('taipei (Ximending): its rows of parked scooters are found (the check above is not vacuous)', () => {
    const { def } = loadMap('taipei'), b = def.bounds;
    const reachable = parkedVehicles('taipei').filter(v => v.points.some(p => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ));
    expect(reachable.filter(v => v.what.includes('scooter')).length).toBeGreaterThan(80);
  });
});
