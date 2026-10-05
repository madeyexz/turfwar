import type { Vec3 } from '../math';
import type { MoveState } from '../movement';
import type { PointId } from '../maps/types';
import type { LoadoutId, WeaponId } from '../weapons';
import type { Body } from '../world';

export type Team = 0 | 1;
export const TEAM_NAMES = ['Aegis Vanguard', 'Crimson Directorate'] as const;
export const TEAM_SHORT = ['AEGIS', 'CRIMSON'] as const;

export interface BotBrain {
  skill: number;
  goal: PointId | '';
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
  loadout: LoadoutId;
  m: MoveState;
  yaw: number;
  pitch: number;
  alive: boolean;
  health: number;
  shield: number;
  weapon: 0 | 1;
  /** Weapons in the primary and secondary slots (the kit's, unless bought or picked up). */
  weapons: [WeaponId, WeaponId];
  ammo: [number, number];
  /** Spare rounds per slot (reloads draw from these). */
  reserve: [number, number];
  /** Credits for the buy menu. */
  money: number;
  /** What this soldier last bought per slot, rebought automatically on respawn when affordable. */
  bought: [WeaponId | '', WeaponId | ''];
  /** Seconds since the last deployment (buy time). */
  sinceSpawn: number;
  reloadLeft: number;
  fireCooldown: number;
  switchLeft: number;
  grenades: number;
  respawnLeft: number;
  protectLeft: number;
  sinceHit: number;
  lastAttacker: number;
  kills: number;
  deaths: number;
  score: number;
  captures: number;
  /** Replicated animation flags. */
  sprint: boolean;
  ads: boolean;
  sinceShot: number;
  /** Increments whenever the server rejects a client-reported position. */
  corrections: number;
  /** Metres a client may still move right now (refilling budget used to absorb network jitter). */
  moveSlack: number;
  /** Feet height when last on a floor (server bookkeeping for the flying check). */
  groundY: number;
  /** Seconds since the last client report (humans) — used for disconnect cleanup. */
  idle: number;
  brain?: BotBrain;
}

export interface PointState {
  id: PointId;
  /** -100 (Crimson owns) .. 100 (Aegis owns). */
  progress: number;
  owner: -1 | Team;
  contested: boolean;
  /** Team currently capturing, or -1. */
  capturing: -1 | Team;
}

export type Phase = 'warmup' | 'live' | 'ended';

export interface MatchConfig {
  /** Total soldiers per team; bots fill the gaps left by humans. */
  teamSize: number;
  scoreLimit: number;
  timeLimit: number;
  warmup: number;
  respawn: number;
  botSkill: number;
  /** Practice range: no bots and no score limit — try weapons and routes in peace. */
  practice?: boolean;
  /** Testing: everything in the buy menu is free and buying works anywhere, any time. */
  freeBuy?: boolean;
}

export const OFFLINE_CONFIG: MatchConfig = { teamSize: 6, scoreLimit: 200, timeLimit: 600, warmup: 3, respawn: 4, botSkill: 0.45 };
export const PRACTICE_CONFIG: MatchConfig = { teamSize: 0, scoreLimit: 100000, timeLimit: 36000, warmup: 1, respawn: 2, botSkill: 0.4, practice: true, freeBuy: true };
export const ONLINE_CONFIG: MatchConfig = { teamSize: 6, scoreLimit: 200, timeLimit: 600, warmup: 8, respawn: 5, botSkill: 0.55 };

export interface MatchState {
  mapId: string;
  phase: Phase;
  phaseLeft: number;
  /** Wall-clock seconds since the match began. */
  time: number;
  tick: number;
  scores: [number, number];
  scoreTimer: number;
  soldiers: Soldier[];
  points: PointState[];
  bodies: Body[];
  /** Per map pickup: seconds until it is back (0 = lying there). */
  pickupLeft: number[];
  nextId: number;
  winner: -1 | Team;
  config: MatchConfig;
}

export type MatchEvent =
  | { type: 'shot'; shooter: number; weapon: WeaponId; from: Vec3; to: Vec3; hit: 0 | 1 | 2; surface?: string }
  | { type: 'damage'; target: number; attacker: number; amount: number; zone: string; x: number; y: number; z: number; shieldBroke: boolean }
  | { type: 'kill'; killer: number; victim: number; weapon: string; head: boolean }
  | { type: 'spawn'; id: number }
  | { type: 'capture'; point: PointId; team: Team }
  | { type: 'neutralize'; point: PointId; team: Team }
  | { type: 'explosion'; x: number; y: number; z: number; owner: number; radius?: number; weapon?: string }
  | { type: 'phase'; phase: Phase; winner: -1 | Team }
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
  weapon: 0 | 1;
}

/** A shot fired by a client, with an optional claimed hit for server validation. */
export interface ShotClaim {
  weapon: 0 | 1;
  origin: Vec3;
  dir: Vec3;
  target: number;
  zone: 'head' | 'body' | 'legs' | '';
  point: Vec3;
}
