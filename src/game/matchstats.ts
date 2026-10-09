/**
 * What a share card says about a match: the player's own tally (kept from the match's kill events,
 * so it is the same online and in Solo) and the one line worth bragging about.
 */
import type { Mode } from '../../shared/match/state';

/** The player's kills, deaths and highlights in one match, from its kill and round events. */
export class MatchTally {
  kills = 0;
  deaths = 0;
  headshots = 0;
  /** Kills with the knife (the 藍白拖 when the meme skins are on). */
  knifeKills = 0;
  /** Most kills in one round. */
  bestRound = 0;
  private roundKills = 0;

  kill(e: { killer: number; victim: number; weapon: string; head: boolean }, me: number) {
    if (e.victim === me) this.deaths++;
    if (e.killer !== me || e.victim === me) return;
    this.kills++;
    if (e.head) this.headshots++;
    if (e.weapon === 'knife') this.knifeKills++;
    this.bestRound = Math.max(this.bestRound, ++this.roundKills);
  }
  /** A new round starts. */
  round() { this.roundKills = 0; }
}

export interface MatchSummary {
  name: string;
  mapId: string;
  mode: Mode;
  /** Soldiers a side (1 for a 1v1). */
  teamSize: number;
  /** Against bots (Solo). */
  solo: boolean;
  result: 'win' | 'loss' | 'draw';
  /** Rounds: ours, theirs. */
  score: [number, number];
  kills: number;
  deaths: number;
  headshots: number;
  knifeKills: number;
  bestRound: number;
  /** A 單挑我 match: the challenger, and whether the player won it. */
  rival?: { name: string; beaten: boolean };
}

export type BragKey = 'beat' | 'lostTo' | 'slipperMulti' | 'round' | 'holiday' | 'kills' | 'slipper' | 'heads' | 'someKills' | 'win' | 'wrecked';
export interface Brag { key: BragKey; n?: number; name?: string }

/** Taiwan's National Day long weekend (10/9–10/12, Taipei time). */
export function nationalDay(at: Date) {
  const taipei = new Date(at.getTime() + 8 * 3600_000);
  return taipei.getUTCMonth() === 9 && taipei.getUTCDate() >= 9 && taipei.getUTCDate() <= 12;
}

/** The card's headline: the most share-worthy thing in the match, best first. */
export function bragLine(s: MatchSummary, at = new Date()): Brag {
  if (s.rival?.beaten) return { key: 'beat', name: s.rival.name };
  if (s.knifeKills >= 2) return { key: 'slipperMulti', n: s.knifeKills };
  if (s.bestRound >= 3) return { key: 'round', n: s.bestRound };
  if (s.kills >= 10) return { key: nationalDay(at) ? 'holiday' : 'kills', n: s.kills };
  if (s.knifeKills === 1) return { key: 'slipper' };
  if (s.headshots >= 5) return { key: 'heads', n: s.headshots };
  if (s.rival) return { key: 'lostTo', name: s.rival.name };
  if (s.kills >= 3) return { key: nationalDay(at) ? 'holiday' : 'kills', n: s.kills };
  if (s.result === 'win') return { key: 'win' };
  if (s.kills > 0) return { key: 'someKills', n: s.kills };
  return { key: 'wrecked' };
}
