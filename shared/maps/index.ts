import { CollisionWorld, type Solid } from '../collision';
import { buildNav, type NavGraph } from '../match/nav';
import { createVehicle, vehicleGround, vehicleObstacles } from '../vehicles';
import { cinderBasin } from './cinder';
import { citadelKeep } from './citadel';
import { courtyard } from './courtyard';
import { crane } from './crane';
import { frostlineReach } from './frostline';
import { meridianDistrict } from './meridian';
import { ochreQuarter } from './ochre';
import { pipeline } from './pipeline';
import { railyard } from './railyard';
import { skylineRooftops } from './skyline';
import { taipei } from './taipei';
import { taipei101 } from './taipei101';
import { xinyi } from './xinyi';
import { timbertown } from './timbertown';
import { tower } from './tower';
import { verdantDivide } from './verdant';
import { warehouse } from './warehouse';
import type { MapDef } from './types';

/** BeGone's six maps first (in their release order), then the original battlefields, then Taipei's Ximending and Xinyi (from 臺北狂飆), then the office floor high up Taipei 101. */
export const MAP_IDS = ['crane', 'tower', 'warehouse', 'pipeline', 'courtyard', 'timbertown', 'cinder', 'frostline', 'verdant', 'ochre', 'citadel', 'railyard', 'skyline', 'meridian', 'taipei', 'xinyi', 'taipei101'] as const;
export type MapId = (typeof MAP_IDS)[number];
const factories: Record<string, () => MapDef> = {
  cinder: cinderBasin, frostline: frostlineReach, verdant: verdantDivide, ochre: ochreQuarter, citadel: citadelKeep, railyard, skyline: skylineRooftops, meridian: meridianDistrict,
  crane, tower, warehouse, pipeline, courtyard, timbertown, taipei, xinyi, taipei101,
};

export interface LoadedMap { def: MapDef; world: CollisionWorld; nav?: NavGraph }
const cache = new Map<string, LoadedMap>();

/** Map definitions are pure functions of their id, so caching them is safe everywhere. */
export function loadMap(id: string): LoadedMap {
  let loaded = cache.get(id);
  if (!loaded) {
    const factory = factories[id];
    if (!factory) throw new Error(`Unknown map ${id}`);
    const def = factory();
    const world = new CollisionWorld(def.solids, def.ramps, def.terrain, def.bounds, def.ladders);
    furnishBases(def, world);
    loaded = { def, world };
    cache.set(id, loaded);
  }
  return loaded;
}

/** Spawn slots each base needs: 6v6 on every map (with room to spare), 24v24 on big maps. */
export const BASE_SLOTS = 12, BIG_BASE_SLOTS = 24;

/**
 * Every round deploys the whole team in its base at once, so each base needs room for the largest
 * room the map hosts, plus an ammo crate. Maps built for fewer slots get extra ones on clear, level floor
 * next to their own (deterministic, so Solo and the server agree).
 */
function furnishBases(def: MapDef, world: CollisionWorld) {
  const fits = (x: number, y: number, z: number, taken: { x: number; z: number }[], gap: number) => {
    const b = def.bounds;
    if (x < b.minX + 2 || x > b.maxX - 2 || z < b.minZ + 2 || z > b.maxZ - 2) return undefined;
    const floor = world.groundHeight(x, z, y + 0.6, 0.35);
    if (Math.abs(floor - y) > 0.45) return undefined;
    if (world.overlapsSolid({ x, y: floor + 0.05, z }, 0.45, 1.7)) return undefined;
    // Not on or under stairs: ramps are walkable but never solid, so the overlap test misses them.
    if (world.rampsAt(x, z).some(i => { const r = world.ramps[i]; return x > r.minX - 0.5 && x < r.maxX + 0.5 && z > r.minZ - 0.5 && z < r.maxZ + 0.5; })) return undefined;
    if (taken.some(p => Math.hypot(p.x - x, p.z - z) < gap)) return undefined;
    return floor;
  };
  const rings = [1.8, 3.4, 5, 6.6];
  const slots = def.big ? BIG_BASE_SLOTS : BASE_SLOTS;
  for (const team of [0, 1] as const) {
    const own = def.spawns.filter(s => s.team === team);
    if (!own.length) continue;
    const taken = def.spawns.map(s => ({ x: s.x, z: s.z }));
    for (const r of rings) for (let k = 0; k < 8 && own.length < slots; k++) {
      for (const base of own.slice()) {
        if (own.length >= slots) break;
        const a = (k / 8) * Math.PI * 2;
        const x = base.x + Math.cos(a) * r, z = base.z + Math.sin(a) * r;
        const y = fits(x, base.y, z, taken, 1.5);
        if (y === undefined) continue;
        const slot = { team, x, y, z, yaw: base.yaw };
        def.spawns.push(slot); own.push(slot); taken.push(slot);
      }
    }
    const cx = own.reduce((a, s) => a + s.x, 0) / own.length, cz = own.reduce((a, s) => a + s.z, 0) / own.length;
    def.pickups ??= [];
    if (def.pickups.some(p => Math.hypot(p.x - cx, p.z - cz) < 20)) continue;
    // A crate a few metres from the slots, so it never blocks a deploying soldier.
    search: for (const r of [3, 4.5, 6]) for (const base of own) for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = base.x + Math.cos(a) * r, z = base.z + Math.sin(a) * r;
      const y = fits(x, base.y, z, taken, 2.2);
      if (y === undefined) continue;
      def.pickups.push({ x, y, z, item: 'ammo', respawn: 0 });
      break search;
    }
  }
}

/** Navigation is built lazily: only bot hosts (offline client, server module) need it. */
export function loadNav(id: string): NavGraph {
  const loaded = loadMap(id);
  loaded.nav ??= buildNav(loaded.def, withParkedVehicles(loaded.def, loaded.world));
  return loaded.nav;
}

/**
 * The world with the vehicles standing at their spots as solids (the bounding boxes of their
 * bodies), for the navigation grid: bots plan round them as parked at every round start. Once
 * driven off, bots steer round their bodies wherever they are (bots.ts).
 */
function withParkedVehicles(def: MapDef, world: CollisionWorld) {
  if (!def.vehicles?.length) return world;
  const parked: Solid[] = [];
  def.vehicles.forEach((spot, i) => {
    const v = createVehicle(i, spot);
    v.y = vehicleGround(world, { ...v, y: spot.y + 0.5 });
    for (const ob of vehicleObstacles(v)) {
      const ex = Math.abs(ob.rx) * ob.hw + Math.abs(ob.fx) * ob.hl, ez = Math.abs(ob.rz) * ob.hw + Math.abs(ob.fz) * ob.hl;
      parked.push({ minX: ob.x - ex, maxX: ob.x + ex, minY: ob.y0, maxY: ob.y1, minZ: ob.z - ez, maxZ: ob.z + ez, surface: 'metal' });
    }
  });
  return new CollisionWorld([...def.solids, ...parked], def.ramps, def.terrain, def.bounds, def.ladders);
}

export function mapSummaries() {
  return MAP_IDS.map(id => {
    const d = loadMap(id).def;
    return { id, name: d.name, region: d.region, description: d.description, theme: d.theme, sites: d.sabotage?.sites.length ?? 0, big: !!d.big };
  });
}
