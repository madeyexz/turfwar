import { CollisionWorld } from '../collision';
import { buildNav, type NavGraph } from '../match/nav';
import { cinderBasin } from './cinder';
import type { MapDef } from './types';

export const MAP_IDS = ['cinder'] as const;
export type MapId = (typeof MAP_IDS)[number];
const factories: Record<string, () => MapDef> = { cinder: cinderBasin };

export interface LoadedMap { def: MapDef; world: CollisionWorld; nav?: NavGraph }
const cache = new Map<string, LoadedMap>();

/** Map definitions are pure functions of their id, so caching them is safe everywhere. */
export function loadMap(id: string): LoadedMap {
  let loaded = cache.get(id);
  if (!loaded) {
    const factory = factories[id];
    if (!factory) throw new Error(`Unknown map ${id}`);
    const def = factory();
    loaded = { def, world: new CollisionWorld(def.solids, def.ramps, def.terrain, def.bounds) };
    cache.set(id, loaded);
  }
  return loaded;
}

/** Navigation is built lazily: only bot hosts (offline client, server module) need it. */
export function loadNav(id: string): NavGraph {
  const loaded = loadMap(id);
  loaded.nav ??= buildNav(loaded.def, loaded.world);
  return loaded.nav;
}

export function mapSummaries() {
  return MAP_IDS.map(id => { const d = loadMap(id).def; return { id, name: d.name, region: d.region, description: d.description, theme: d.theme }; });
}
