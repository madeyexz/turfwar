import { MapBuilder } from './builder';
import type { MapDef } from './types';

/** Pipeline: placeholder while the BeGone homage is built. */
export function pipeline(): MapDef {
  const b = new MapBuilder({
    id: 'pipeline', name: 'Pipeline', region: 'BEGONE', description: 'Under construction.',
    theme: 'forest', halfX: 40, halfZ: 30, seed: 1, roll: 0, ridge: 0, sun: { x: 0.4, y: 0.7, z: 0.3 }, ground: () => 0,
  });
  b.buildTerrain(2);
  b.spawn(0, 30, 0, 0, Math.PI / 2);
  b.spawn(1, -30, 0, 0, -Math.PI / 2);
  b.point('A', 'A', 0, 0, 0, 6);
  return b.build();
}
