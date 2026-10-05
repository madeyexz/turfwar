import { cinderBasin } from './cinder';
import type { MapDef } from './types';

/** Placeholder while the layout is being built (borrows Cinder Basin's geometry). */
export function skylineRooftops(): MapDef {
  return { ...cinderBasin(), id: 'skyline', name: 'Skyline Rooftops', description: 'Under construction.' };
}
