import { PLAYABLE_MAP_IDS, loadMap } from '../maps/index';
import type { Mode } from './state';

/**
 * Room sizes (soldiers per team). Every room plays BeGone's rules; 24v24 needs a big map.
 * Online, one database holds many rooms: Play Online fills public rooms of a size (optionally of a
 * mode and a map), private rooms are joined with a code.
 */
export const ROOM_SIZES = [
  { id: 'duel', perTeam: 1, label: '1v1', name: 'Duel' },
  { id: 'squad', perTeam: 6, label: '6v6', name: 'Squad' },
  { id: 'war', perTeam: 24, label: '24v24', name: 'War' },
] as const;
export type RoomSize = (typeof ROOM_SIZES)[number]['perTeam'];
export const isRoomSize = (n: number): n is RoomSize => ROOM_SIZES.some(s => s.perTeam === n);
export const sizeLabel = (n: number) => ROOM_SIZES.find(s => s.perTeam === n)?.label ?? `${n}v${n}`;

/** Maps a room of this size may play (retired maps never): 24v24 only on big maps, smaller rooms on the others. */
export function mapsFor(perTeam: number, mode?: Mode): string[] {
  return PLAYABLE_MAP_IDS.filter(id => {
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

// ---- Play Online: filtered matchmaking ------------------------------------------------------

export const MODES: readonly Mode[] = ['elimination', 'sabotage'];
export const isMode = (m: string): m is Mode => m === 'elimination' || m === 'sabotage';
export const hasSites = (mapId: string) => !!loadMap(mapId).def.sabotage?.sites.length;

/** What Play Online asks for: a room size and, optionally, a mode and a map ('' = any). */
export interface RoomFilter { size: number; mode: Mode | ''; map: string }

/**
 * Why the server refuses a filter (the module's error text), or undefined when it is valid: a known
 * size, a known mode or '', and a map that size (and that mode) can play, or ''.
 */
export function filterError(f: { size: number; mode: string; map: string }): string | undefined {
  if (!isRoomSize(f.size)) return 'Unknown room size';
  if (f.mode !== '' && !isMode(f.mode)) return 'Unknown mode';
  if (f.map !== '' && !mapsFor(f.size, f.mode === '' ? undefined : f.mode as Mode).includes(f.map)) return 'That map does not host this room';
  return undefined;
}

/** A public room as matchmaking and the lobby see it. */
export interface RoomView {
  room: number; mapId: string; mode: Mode; size: number; humans: number;
  /** Match phase: a rotating room on its end screen is about to change map and mode. */
  phase?: string;
  /** The room keeps its map / mode from match to match (it was opened for them). */
  fixedMap?: boolean; fixedMode?: boolean;
  /** A private room (joined only by its code): never listed, never matched. */
  private?: boolean;
  /** The room was started with bots off. */
  noBots?: boolean;
}

/**
 * Does the room play what the filter asks for right now? The size must be equal; '' matches any
 * mode or map. A room on its end screen that is about to rotate away from the asked-for map or
 * mode does not match it.
 */
export function roomMatches(r: RoomView, f: RoomFilter): boolean {
  if (r.private || r.size !== f.size) return false;
  const leaving = r.phase === 'ended';
  if (f.map && (r.mapId !== f.map || (leaving && !r.fixedMap))) return false;
  if (f.mode && (r.mode !== f.mode || (leaving && !r.fixedMode))) return false;
  return true;
}

export const roomFull = (r: RoomView) => r.humans >= r.size * 2;

/**
 * Where Play Online puts you: the fullest matching public room with a free slot; on a tie, a room
 * that keeps the asked-for map or mode, then the lowest room id. Undefined = open a new room.
 */
export function pickRoom<R extends RoomView>(rooms: readonly R[], f: RoomFilter): R | undefined {
  const keeps = (r: R) => (f.map && r.fixedMap ? 1 : 0) + (f.mode && r.fixedMode ? 1 : 0);
  let best: R | undefined;
  for (const r of rooms) {
    if (roomFull(r) || !roomMatches(r, f)) continue;
    if (!best || r.humans > best.humans
      || (r.humans === best.humans && (keeps(r) > keeps(best) || (keeps(r) === keeps(best) && r.room < best.room)))) best = r;
  }
  return best;
}

/**
 * A new room's rules from a filter. '' picks the way Quick Play always has: a random map the size
 * (and the chosen mode) plays, and Sabotage half the time where the map has bomb sites. What was
 * chosen stays fixed for the room's later matches; what was "any" rotates (`nextRoomRules`).
 */
export function newRoomRules(f: RoomFilter, random: () => number): { mapId: string; mode: Mode; fixedMap: boolean; fixedMode: boolean } {
  const maps = mapsFor(f.size, f.mode || undefined);
  const mapId = f.map || maps[Math.floor(random() * maps.length)] || maps[0];
  const mode: Mode = f.mode || (hasSites(mapId) && random() < 0.5 ? 'sabotage' : 'elimination');
  return { mapId, mode, fixedMap: !!f.map, fixedMode: !!f.mode };
}

/**
 * A public room's next match. A fixed map and a fixed mode are kept. Otherwise the room moves on to
 * the next map its size plays (only maps with bomb sites while Sabotage is fixed), and an unfixed
 * mode alternates Elimination and Sabotage where the map has bomb sites (Elimination elsewhere).
 */
export function nextRoomRules(current: string, mode: Mode, perTeam: number, fixed: { fixedMap?: boolean; fixedMode?: boolean } = {}): { mapId: string; mode: Mode } {
  const maps = mapsFor(perTeam, fixed.fixedMode ? mode : undefined);
  const mapId = fixed.fixedMap ? current : maps[(maps.indexOf(current) + 1) % maps.length] ?? current;
  if (fixed.fixedMode) return { mapId, mode };
  return { mapId, mode: mode === 'elimination' && hasSites(mapId) ? 'sabotage' : 'elimination' };
}

// ---- Quick Play: anything open ----------------------------------------------------------------

/** What Quick Play opens when no public room has a free slot: 6v6 with bots, a random map and mode that rotate. */
export const QUICK_PLAY_NEW: RoomFilter = { size: 6, mode: '', map: '' };

/**
 * Quick Play: any public room (any size, map and mode) with a free slot, the fullest first; on a
 * tie the one on the lowest-ping server (`ping`, when the caller knows it; the server does not),
 * then the lowest room id. Private and full rooms are never picked. Undefined = open `QUICK_PLAY_NEW`.
 */
export function pickAnyRoom<R extends RoomView>(rooms: readonly R[], ping?: (r: R) => number | undefined): R | undefined {
  const lag = (r: R) => ping?.(r) ?? Infinity;
  let best: R | undefined;
  for (const r of rooms) {
    if (r.private || roomFull(r)) continue;
    if (!best || r.humans > best.humans
      || (r.humans === best.humans && (lag(r) < lag(best) || (lag(r) === lag(best) && r.room < best.room)))) best = r;
  }
  return best;
}

/**
 * The lobby's room list order: rooms with a free slot before full ones, then the most players,
 * then the lowest ping (`ping`, when known), then the lowest room id.
 */
export function listOrder<R extends RoomView>(rooms: readonly R[], ping?: (r: R) => number | undefined): R[] {
  const lag = (r: R) => ping?.(r) ?? Infinity;
  return [...rooms].sort((a, b) => Number(roomFull(a)) - Number(roomFull(b)) || b.humans - a.humans || lag(a) - lag(b) || a.room - b.room);
}

// ---- Start a server: a room with exactly these rules --------------------------------------------

/** What Start a Server asks for: every rule is chosen (no "any"). */
export interface StartRules { size: number; mode: string; map: string; bots: boolean; isPublic: boolean }

/**
 * Why the server refuses a started room (the module's error text), or undefined: a known size, a
 * known mode, and a map that size and mode can play (24v24 big maps only, Sabotage bomb sites).
 */
export function startRoomError(r: { size: number; mode: string; map: string }): string | undefined {
  if (!isRoomSize(r.size)) return 'Unknown room size';
  if (!isMode(r.mode)) return 'Unknown mode';
  if (!mapsFor(r.size, r.mode).includes(r.map)) return 'That map does not host this room';
  return undefined;
}

/**
 * A started room's config: its size, mode and bots. A public one keeps its map and mode from match
 * to match (it is listed, and Quick Play and Play Online may fill it); a private one replays the
 * host's choice anyway.
 */
export function startRoomConfig(r: StartRules): { mode: Mode; teamSize: number; noBots: boolean; fixedMap?: boolean; fixedMode?: boolean } {
  const config = { mode: r.mode as Mode, teamSize: r.size, noBots: !r.bots };
  return r.isPublic ? { ...config, fixedMap: true, fixedMode: true } : config;
}
