import { cinderBasin } from './cinder';
import type { MapDef } from './types';

/** Placeholder while the layout is being built (borrows Cinder Basin's geometry). */
export function railyard(): MapDef {
  return { ...cinderBasin(), id: 'railyard', name: 'Railyard', description: 'Under construction.' };
}
