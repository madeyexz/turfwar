import type { Vec3 } from '../math';
import type { MoveState } from '../movement';
import type { Attachments, Slot, WeaponId } from '../weapons';
import type { Body } from '../world';

export type Team = 0 | 1;
/** Team 0 is SWAT, team 1 Militia (BeGone). In Sabotage, Militia arms the bomb and SWAT defends. */
export const TEAM_NAMES = ['SWAT', 'Militia'] as const;
export const TEAM_SHORT = ['SWAT', 'MILITIA'] as const;
export const ATTACKERS: Team = 1;

export interface BotBrain {
  skill: number;
  /** What the bot is heading for: '' none, 'roam' a map area, 'hunt' an enemy, 'site' a bomb site. */
  goal: '' | 'roam' | 'hunt' | 'site';
  /** Seconds before the bot picks a new goal. */
  goalLeft: number;
  goalX: number; goalZ: number;
  path: number[];
  pathIndex: number;
  repath: number;
  target: number;
  reaction: number;
  lastSeen: number;
  seenX: number; seenY: number; seenZ: number;
  aimYaw: number; aimPitch: number;
  errYaw: number; errPitch: number;
  strafe: number; strafeLeft: number;
  crouchLeft: number;
  burst: number; burstPause: number;
  stuck: number; lastX: number; lastZ: number;
  think: number;
  grenadeCooldown: number;
  jump: boolean;
}

export interface Soldier {
  id: number;
  name: string;
  team: Team;
  bot: boolean;
  m: MoveState;
  yaw: number;
  pitch: number;
  alive: boolean;
  health: number;
  /** Weapon in hand: 0 primary, 1 secondary, 2 knife. */
  weapon: Slot;
  /** Equipped primary and secondary. */
  weapons: [WeaponId, WeaponId];
  /** Every weapon bought this match (plus the defaults); owned weapons swap in free during buy time. */
  owned: WeaponId[];
  /** Attachments fitted per weapon (persist for the match). */
  attachments: Partial<Record<WeaponId, Attachments>>;
  ammo: [number, number];
  reserve: [number, number];
  reloadLeft: number;
  fireCooldown: number;
  switchLeft: number;
  /** M67 frags carried (0 or 1) and whether they carry the High Explosive mod. */
  grenades: number;
  grenadeHE: boolean;
  stamina: number;
  money: number;
  sinceHit: number;
  lastAttacker: number;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  /** Replicated animation flags. */
  sprint: boolean;
  ads: boolean;
  sinceShot: number;
  /** Holding the use key (E): arming or disarming the bomb. */
  using: boolean;
  /** Increments whenever the server rejects a client-reported position. */
  corrections: number;
  /** Metres a client may still move right now (refilling budget used to absorb network jitter). */
  moveSlack: number;
  /** Feet height when last on a floor (server bookkeeping for the flying check). */
  groundY: number;
  /** Seconds since the last client report (humans) — used for disconnect cleanup. */
  idle: number;
  /** Per-round bookkeeping for credits (BeGone's cash awards). */
  round: RoundStats;
  /** Rounds played on this server, for the loyalty bonus. */
  roundsHere: number;
  brain?: BotBrain;
}

export interface RoundStats {
  kills: number;
  /** Kill streak this life. */
  streak: number;
  lastKillAt: number;
  /** Kills in the current multi-kill chain (each under 4 s after the last). */
  chain: number;
  /** Last soldier this one killed and when (for trades). */
  lastVictim: number;
  /** Recent damage taken: attacker id and match time (for assists). */
  hits: { by: number; at: number }[];
  /** Headshot bullets already paid per opponent (capped at 3). */
  headshots: Record<number, number>;
  damage: number;
  /** Ammo crate already paid for this round. */
  crate: boolean;
}

export type Mode = 'elimination' | 'sabotage';
export type Phase = 'warmup' | 'live' | 'ended';
/** Within a match: frozen at round start (buying, no moving), fighting, then the round-over pause. */
export type RoundPhase = 'freeze' | 'live' | 'over';

export interface MatchConfig {
  mode: Mode;
  /** Soldiers per team; bots fill the gaps left by humans. */
  teamSize: number;
  /** Round wins needed for the match. */
  roundsToWin: number;
  /** Seconds per round (Sabotage on single-bomb maps uses `roundTimeSingle`). */
  roundTime: number;
  roundTimeSingle: number;
  /** Seconds left once the bomb is armed. */
  bombTime: number;
  armTime: number;
  disarmTime: number;
  freezeTime: number;
  roundOverTime: number;
  matchOverTime: number;
  /** Seconds from round start during which buying works (inside your base). */
  buyTime: number;
  warmup: number;
  botSkill: number;
  /** Practice range: no bots, no win limit. */
  practice?: boolean;
  /** Testing: everything in the store is free and buying works anywhere, any time. */
  freeBuy?: boolean;
}

/** BeGone's GameSettings.json: 4 s round start, 5 s round over, 10 s match over, first to 10. */
const BEGONE = { roundsToWin: 10, bombTime: 40, armTime: 5, disarmTime: 5, freezeTime: 4, roundOverTime: 5, matchOverTime: 10, buyTime: 20 };
export const ELIMINATION: MatchConfig = { ...BEGONE, mode: 'elimination', teamSize: 6, roundTime: 120, roundTimeSingle: 120, warmup: 3, botSkill: 0.45 };
export const SABOTAGE: MatchConfig = { ...BEGONE, mode: 'sabotage', teamSize: 6, roundTime: 90, roundTimeSingle: 120, warmup: 3, botSkill: 0.45 };
export const OFFLINE_CONFIG = ELIMINATION;
export const ONLINE_CONFIG: MatchConfig = { ...ELIMINATION, warmup: 8, botSkill: 0.55 };
export const PRACTICE_CONFIG: MatchConfig = { ...ELIMINATION, teamSize: 0, roundsToWin: 1000, roundTime: 3600, warmup: 1, botSkill: 0.4, practice: true, freeBuy: true };

export interface BombState {
  /** Index into the map's bomb sites being armed or armed (-1 = none). */
  site: number;
  armed: boolean;
  /** 0..1 progress of the current arm or disarm. */
  progress: number;
  /** Soldier arming/disarming (-1 = nobody). */
  by: number;
}

export interface MatchState {
  mapId: string;
  phase: Phase;
  /** Seconds left in the current match or round phase. */
  phaseLeft: number;
  /** Wall-clock seconds since the match began. */
  time: number;
  tick: number;
  /** Round wins per team. */
  scores: [number, number];
  round: number;
  roundPhase: RoundPhase;
  /** Seconds since the current round started (buy window). */
  roundClock: number;
  /** Winner of the last round (-1 draw). */
  roundWinner: -1 | Team;
  /** Consecutive round losses per team (loss bonus). */
  lossStreak: [number, number];
  firstKill: boolean;
  firstBlood: boolean;
  /** Team that made the latest kill (decides a round where the last two soldiers trade). */
  lastKillTeam: -1 | Team;
  bomb: BombState;
  soldiers: Soldier[];
  bodies: Body[];
  nextId: number;
  winner: -1 | Team;
  config: MatchConfig;
}

export type RoundEnd = 'eliminated' | 'time' | 'armed' | 'disarmed' | 'exploded';

export type MatchEvent =
  | { type: 'shot'; shooter: number; weapon: WeaponId; from: Vec3; to: Vec3; hit: 0 | 1 | 2; surface?: string }
  | { type: 'damage'; target: number; attacker: number; amount: number; zone: string; x: number; y: number; z: number }
  | { type: 'kill'; killer: number; victim: number; weapon: string; head: boolean }
  | { type: 'spawn'; id: number }
  | { type: 'explosion'; x: number; y: number; z: number; owner: number; radius?: number; weapon?: string }
  | { type: 'phase'; phase: Phase; winner: -1 | Team }
  | { type: 'round'; phase: RoundPhase; round: number; winner: -1 | Team; reason?: RoundEnd }
  | { type: 'bomb'; action: 'armed' | 'disarmed' | 'exploded'; site: number; by: number }
  | { type: 'reward'; id: number; amount: number; reason: string }
  | { type: 'join'; id: number; name: string; team: Team }
  | { type: 'leave'; id: number; name: string };

/** Report a client sends about its own soldier each network tick. */
export interface ClientReport {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  crouch: number;
  grounded: boolean;
  sprint: boolean;
  ads: boolean;
  /** Sliding (replicated so other players see the slide animation). */
  slide?: boolean;
  weapon: Slot;
  /** Holding the use key (arming/disarming). */
  use?: boolean;
}

/** A shot fired by a client, with an optional claimed hit for server validation. */
export interface ShotClaim {
  weapon: Slot;
  origin: Vec3;
  dir: Vec3;
  target: number;
  zone: 'head' | 'body' | 'legs' | '';
  point: Vec3;
}
