import type { Vec3 } from '../../shared/math';
import type { ClientReport, MatchEvent, MatchState, ShotClaim } from '../../shared/match/state';
import type { LoadoutId } from '../../shared/weapons';

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
  switchWeapon(slot: 0 | 1): void;
  setLoadout(loadout: LoadoutId): void;
  law(command: unknown, source: string, text: string): Promise<{ ok: boolean; message: string }>;
  status(): string;
  dispose(): void;
}
