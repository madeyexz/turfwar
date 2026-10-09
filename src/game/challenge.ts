/**
 * 單挑我: the challenge link a share card carries. It names the challenger, the map, the kills to
 * brag about and a random share code (`ref`, for counting players a share brings), and the code of
 * the private 1v1 room the challenger waits in, when there is one. Everything in it is user text from
 * a URL, so every field is checked here and anything doubtful is dropped.
 */
import { cleanCode } from '../../shared/match/rooms';

export interface Challenge {
  /** The challenger's callsign, cleaned like the server cleans callsigns. */
  name: string;
  /** A private room's 4-letter code, when the challenger opened one. */
  room?: string;
  /** The map the challenge is on (any id; `challengeMap` picks a 1v1 one). */
  map?: string;
  /** The challenger's kills in the shared match. */
  beat?: number;
  /** The sharer's random code. */
  ref?: string;
}

/** Callsigns: letters, digits, space, _ - . (as `enter_room` keeps them), at most 16 characters. */
export const cleanName = (s: string) => s.replace(/[^\p{L}\p{N} _\-.]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
const REF = /^[a-z0-9]{6,12}$/;
const MAP = /^[a-z0-9]{2,20}$/;

/** The challenge in a page's query string, or undefined when it has none (or no usable challenger). */
export function parseChallenge(search: string): Challenge | undefined {
  const p = new URLSearchParams(search);
  if (!p.has('c')) return undefined;
  const name = cleanName(p.get('ch') ?? '');
  if (!name) return undefined;
  const c: Challenge = { name };
  const room = cleanCode(p.get('room') ?? '');
  if (room.length === 4) c.room = room;
  const map = p.get('map') ?? '';
  if (MAP.test(map)) c.map = map;
  const beat = Number(p.get('beat'));
  if (p.has('beat') && Number.isInteger(beat) && beat >= 0 && beat <= 999) c.beat = beat;
  const ref = (p.get('ref') ?? '').toLowerCase();
  if (REF.test(ref)) c.ref = ref;
  return c;
}

/** The link for a challenge, on `origin` (this site's, so a preview shares preview links). */
export function challengeUrl(origin: string, c: Challenge) {
  const p = new URLSearchParams({ c: '1' });
  if (c.room) p.set('room', c.room);
  p.set('ch', cleanName(c.name) || 'Operator');
  if (c.map && MAP.test(c.map)) p.set('map', c.map);
  if (c.beat !== undefined) p.set('beat', String(Math.max(0, Math.min(999, Math.round(c.beat)))));
  if (c.ref && REF.test(c.ref)) p.set('ref', c.ref);
  return `${origin}/?${p}`;
}

/** The challenge's map if a 1v1 can be played there, else the first that can. */
export const challengeMap = (map: string | undefined, duelMaps: readonly string[]) => (map && duelMaps.includes(map) ? map : duelMaps[0]);

/** This browser's share code: random, made once, never tied to the player's identity. */
export function shareRef(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, random = Math.random) {
  try {
    const kept = storage?.getItem('turfwar.ref');
    if (kept && REF.test(kept)) return kept;
  } catch { /* storage disabled */ }
  let ref = '';
  while (ref.length < 8) ref += Math.floor(random() * 36).toString(36);
  try { storage?.setItem('turfwar.ref', ref); } catch { /* a fresh code next time */ }
  return ref;
}
