import { rng, type Vec3 } from '../../shared/math';
import {
  addSoldier, balanceTeams, buyItem, createContext, createMatch, fireShot, pickUp, reload, reportState, setLoadout, switchWeapon,
  throwGrenade, tickMatch, TICK_RATE, type SimContext,
} from '../../shared/match/sim';
import { OFFLINE_CONFIG, PRACTICE_CONFIG, type ClientReport, type MatchConfig, type MatchEvent, type MatchState, type ShotClaim, type Team } from '../../shared/match/state';
import type { BuyItem } from '../../shared/match/economy';
import type { LoadoutId } from '../../shared/weapons';
import type { GameLink } from './link';

/** Solo skirmish: the authoritative simulation runs in this tab with bots on both teams. */
export class OfflineLink implements GameLink {
  readonly mode = 'offline' as const;
  readonly interpDelay = 1 / TICK_RATE;
  private match: MatchState;
  private ctx: SimContext;
  private events: MatchEvent[] = [];
  private me: number;
  private accumulator = 0;
  private ticks = 0;
  /** Game time since the last report: the movement check runs on the same clock as the player. */
  private sinceReport = 0;

  constructor(mapId: string, name: string, loadout: LoadoutId, team: Team | undefined, config: Partial<MatchConfig> = {}, practice = false) {
    const random = rng((Math.random() * 2 ** 31) | 0);
    this.ctx = createContext(mapId, random, e => this.events.push(e));
    this.match = createMatch(mapId, practice ? { ...PRACTICE_CONFIG } : { ...OFFLINE_CONFIG, ...config }, random);
    this.practice = practice;
    this.me = addSoldier(this.match, this.ctx, { name, team, bot: false, loadout }).id;
    balanceTeams(this.match, this.ctx);
  }

  myId() { return this.me; }
  state() { return this.match; }
  version() { return this.ticks; }
  drainEvents() { const e = this.events; this.events = []; return e; }
  private practice = false;
  status() { return this.practice ? 'PRACTICE RANGE' : 'SOLO SKIRMISH'; }

  update(dt: number) {
    this.sinceReport += dt;
    this.accumulator += Math.min(dt, 0.25);
    const step = 1 / TICK_RATE;
    while (this.accumulator >= step) {
      tickMatch(this.match, this.ctx, step);
      this.accumulator -= step;
      this.ticks++;
    }
  }

  report(r: ClientReport) {
    reportState(this.match, this.ctx, this.me, r, this.sinceReport);
    this.sinceReport = 0;
  }
  fire(claim: ShotClaim) { fireShot(this.match, this.ctx, this.me, claim); }
  grenade(origin: Vec3, dir: Vec3) { throwGrenade(this.match, this.ctx, this.me, origin, dir); }
  reload() { reload(this.match, this.me); }
  switchWeapon(slot: 0 | 1) { switchWeapon(this.match, this.me, slot); }
  setLoadout(loadout: LoadoutId) { setLoadout(this.match, this.me, loadout); }
  buy(item: BuyItem) { buyItem(this.match, this.ctx, this.me, item); }
  pickup(index: number) { pickUp(this.match, this.ctx, this.me, index); }
  dispose() { this.events = []; }
}
