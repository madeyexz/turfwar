import { MAP_IDS, loadMap } from '../maps/index';
import type { Mode } from './state';

/**
 * Room sizes (soldiers per team). Every room plays BeGone's rules; 24v24 needs a big map.
 * Online, one database holds many rooms: Quick Play fills public rooms of a size, private rooms
 * are joined with a code.
 */
export const ROOM_SIZES = [
  { id: 'duel', perTeam: 1, label: '1v1', name: 'Duel' },
  { id: 'squad', perTeam: 6, label: '6v6', name: 'Squad' },
  { id: 'war', perTeam: 24, label: '24v24', name: 'War' },
] as const;
export type RoomSize = (typeof ROOM_SIZES)[number]['perTeam'];
export const isRoomSize = (n: number): n is RoomSize => ROOM_SIZES.some(s => s.perTeam === n);
export const sizeLabel = (n: number) => ROOM_SIZES.find(s => s.perTeam === n)?.label ?? `${n}v${n}`;

/** Maps a room of this size may play: 24v24 only on big maps, smaller rooms on the others. */
export function mapsFor(perTeam: number, mode?: Mode): string[] {
  return MAP_IDS.filter(id => {
    const d = loadMap(id).def;
    if (perTeam > 12 ? !d.big : d.big) return false;
    return mode !== 'sabotage' || !!d.sabotage?.sites.length;
  });
}

/** Room codes: four letters without look-alikes (no I, L, O). */
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export function roomCode(random: () => number) {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)];
  return code;
}
export const cleanCode = (code: string) => code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
