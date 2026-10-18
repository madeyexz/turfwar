/**
 * 發起單挑: the challenge link a share card carries. It names the challenger, the map, the kills to
 * brag about and a random share code (`ref`, for counting players a share brings), and the code of
 * the private 1v1 room the challenger waits in, when there is one. Everything in it is user text from
 * a URL, so every field is checked here and anything doubtful is dropped.
 */
import { cleanCode } from '../../shared/match/rooms';
import { maskProfanity } from '../../shared/profanity';
import { withUtm } from '../utm';
import type { ServerId } from '../net/servers';

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
  /** The room's server when it is not Taipei (`s=us`); a room link without it means Taipei. */
  server?: ServerId;
}

/** Callsigns: letters, digits, space, _ - . (as `enter_room` keeps them), at most 16 characters, bad words masked (＊ kept). */
export const cleanName = (s: string) => maskProfanity(s.replace(/[^\p{L}\p{N} _\-.＊]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16));
const REF = /^[a-z0-9]{6,12}$/;
const MAP = /^[a-z0-9]{2,20}$/;

/**
 * The challenge in a page's address, or undefined when it has none (or no usable challenger): links made
 * now open `/c?…` (a path of its own, so the link-preview middleware never touches the home page), older
 * ones `/?c=1&…`.
 */
export function parseChallenge(search: string, pathname = '/'): Challenge | undefined {
  const p = new URLSearchParams(search);
  if (!p.has('c') && !/^\/c\/?$/.test(pathname)) return undefined;
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
  if (c.room && p.get('s') === 'us') c.server = 'us';
  return c;
}

/**
 * Where a link we hand out came from, as UTM parameters (so a visit it brings is attributed):
 * `source` is the kind of link, `medium` the screen it came from. `share`: the brag card, no room;
 * `challenge`: a 發起單挑 link with no room (the bot double answers); `duel`: a link to the private
 * 1v1 room we opened (約朋友單挑). `end_screen`: the end-of-match buttons; `share_card`: the share
 * dialog (its link, copy, QR and share sheet); `lobby`: the lobby.
 */
export interface LinkOrigin {
  source: 'share' | 'challenge' | 'duel';
  medium: 'end_screen' | 'share_card' | 'lobby';
  campaign?: string;
}

/** The link for a challenge, on `origin` (this site's, so a preview shares preview links); `origin` tags it with where it was handed out. */
export function challengeUrl(origin: string, c: Challenge, from?: LinkOrigin) {
  const p = new URLSearchParams();
  if (c.room) p.set('room', c.room);
  p.set('ch', cleanName(c.name) || 'Operator');
  if (c.map && MAP.test(c.map)) p.set('map', c.map);
  if (c.beat !== undefined) p.set('beat', String(Math.max(0, Math.min(999, Math.round(c.beat)))));
  if (c.ref && REF.test(c.ref)) p.set('ref', c.ref);
  if (c.room && c.server === 'us') p.set('s', 'us');
  const url = `${origin}/c?${p}`;
  return from ? withUtm(url, from) : url;
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

/**
 * 邀請朋友: the link to a private room, `/r/<code>?ref=<share code>`. Whoever opens it is asked to join
 * that room (the lobby's invite banner); the share code counts them toward the 金拖 (shared/skins.ts).
 * Short on purpose: it is pasted into chats as text. `vercel.json` sends `/r/…` to the link-preview page.
 */
export function inviteUrl(origin: string, room: string, ref: string, server?: ServerId) {
  const code = cleanCode(room);
  const p = new URLSearchParams();
  if (REF.test(ref)) p.set('ref', ref);
  if (server === 'us') p.set('s', 'us');
  const q = `${p}`;
  return `${origin}/r/${code}${q ? `?${q}` : ''}`;
}

/** The private room an invite link names (`/r/<code>`, with the sharer's `ref`), or undefined. */
export function parseInvite(pathname: string, search: string): { room: string; ref?: string; server?: ServerId } | undefined {
  const m = /^\/r\/([A-Za-z]{4})\/?$/.exec(pathname);
  if (!m) return undefined;
  const room = cleanCode(m[1]);
  if (room.length !== 4) return undefined;
  const p = new URLSearchParams(search);
  const ref = (p.get('ref') ?? '').toLowerCase();
  return { room, ...(REF.test(ref) ? { ref } : {}), ...(p.get('s') === 'us' ? { server: 'us' as const } : {}) };
}

/**
 * The server a link to a friend's room (an invite, or a challenge naming a room) plays on: its `s`, else
 * Taipei, where every room link was made before `s` existed. Undefined for any other address: the
 * player's own choice then stands.
 */
export function linkServer(place: { pathname: string; search: string }): ServerId | undefined {
  const c = parseChallenge(place.search, place.pathname);
  const room = c ? c.room && c : parseInvite(place.pathname, place.search);
  return room ? room.server ?? 'tw' : undefined;
}
