import { cinderBasin } from './cinder';
import type { MapDef } from './types';

/** Placeholder while the layout is being built (borrows Cinder Basin's geometry). */
export function citadelKeep(): MapDef {
  return { ...cinderBasin(), id: 'citadel', name: 'Citadel Keep', description: 'Under construction.' };
}
