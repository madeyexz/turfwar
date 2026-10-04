import type { Team } from '../../shared/match/state';
import type { LoadoutId } from '../../shared/weapons';
import type { GameLink } from '../game/link';

/** Online play needs a SpacetimeDB database URL configured at build time. */
export function onlineAvailable(): { ok: boolean; reason: string } {
  const env = import.meta.env as Record<string, string | undefined>;
  if (!env.VITE_SPACETIMEDB_URI || !env.VITE_SPACETIMEDB_DATABASE) return { ok: false, reason: 'No SpacetimeDB server configured for this build.' };
  return { ok: true, reason: '' };
}

export async function connectOnline(_name: string, _loadout: LoadoutId, _team: Team | undefined, _status: (s: string) => void): Promise<GameLink> {
  throw new Error('Online play is not available in this build yet.');
}
