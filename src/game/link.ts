import type { Vec3 } from '../../shared/math';
import type { ClientReport, MatchEvent, MatchState, ShotClaim } from '../../shared/match/state';
import type { BuyItem } from '../../shared/match/economy';
import type { AttachmentId, Slot, WeaponId } from '../../shared/weapons';

/**
 * The game client talks to a match through this interface. OfflineLink runs the shared
 * simulation in-process with bots; OnlineLink talks to the SpacetimeDB module that runs the
 * same simulation authoritatively for every connected player.
 */
export interface GameLink {
  readonly mode: 'offline' | 'online';
  /** Seconds remote entities are rendered behind the newest snapshot. */
  readonly interpDelay: number;
  myId(): number;
  state(): MatchState | undefined;
  /** Increments whenever a new authoritative snapshot is available. */
  version(): number;
  drainEvents(): MatchEvent[];
  update(dt: number): void;
  report(r: ClientReport): void;
  fire(claim: ShotClaim): void;
  grenade(origin: Vec3, dir: Vec3): void;
  reload(): void;
  switchWeapon(slot: Slot): void;
  /** Store purchase (validated by the host: buy time in base, cash). */
  buy(item: BuyItem): void;
  /** Attachment for an owned weapon (validated by the host: fit, cash). */
  attach(weapon: WeaponId, attachment: AttachmentId): void;
  /** Use ammo crate `index` (E). */
  useCrate(index: number): void;
  /** Chat line to everyone, or to the team only. */
  say(text: string, team: boolean): void;
  status(): string;
  /** Online: career stats of the players who have played on this server, best first. */
  leaderboard?(): CareerStats[];
  dispose(): void;
}

export interface CareerStats {
  name: string; mine: boolean;
  kills: number; deaths: number; assists: number; headshots: number;
  roundsWon: number; roundsPlayed: number; matchesWon: number; matchesPlayed: number;
}
