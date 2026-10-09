import { isRookie, loadProgress } from './progress';
import { rng, type Vec3 } from '../../shared/math';
import {
  addSoldier, balanceTeams, buyAttachmentFor, buyItem, createContext, createMatch, enterVehicle, exitVehicle, fireShot, reload, reportState,
  reportVehicle, switchTeam, switchWeapon, throwGrenade, drinkBoba, throwSmoke, tickMatch, useAmmoCrate, TICK_RATE, type SimContext,
} from '../../shared/match/sim';
import { ELIMINATION, PRACTICE_CONFIG, type ClientReport, type MatchConfig, type MatchEvent, type MatchState, type ShotClaim, type Team, type VehicleReport } from '../../shared/match/state';
import type { BuyItem } from '../../shared/match/economy';
import type { AttachmentId, Slot, WeaponId } from '../../shared/weapons';
import type { GameLink } from './link';
import { t } from '../ui/i18n';

/** Solo match: the authoritative simulation runs in this tab with bots on both teams. */
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
  private sinceVehicleReport = 0;
  private practice: boolean;

  /**
   * `rival`: a 單挑我 link with no room to join (src/game/challenge.ts): the other side's bot plays
   * under the challenger's name.
   */
  constructor(mapId: string, name: string, team: Team | undefined, config: Partial<MatchConfig> = {}, practice = false, private rival?: string) {
    const random = rng((Math.random() * 2 ** 31) | 0);
    this.ctx = createContext(mapId, random, e => this.events.push(e));
    this.match = createMatch(mapId, practice ? { ...PRACTICE_CONFIG, ...config } : { ...ELIMINATION, ...config });
    this.practice = practice;
    // A new player (few rounds on this browser) gets easier bots, as online (progress.ts).
    this.me = addSoldier(this.match, this.ctx, { name, team, bot: false, rookie: !practice && isRookie(loadProgress()) }).id;
    balanceTeams(this.match, this.ctx);
    this.nameRival();
  }

  /** The other side's bots carry the challenger's name (bots that join later too). */
  private nameRival() {
    if (!this.rival) return;
    const team = this.match.soldiers.find(s => s.id === this.me)?.team;
    for (const s of this.match.soldiers) if (s.bot && s.team !== team) s.name = this.rival;
  }

  myId() { return this.me; }
  state() { return this.match; }
  version() { return this.ticks; }
  drainEvents() { const e = this.events; this.events = []; return e; }
  status() { return t(this.practice ? 'net.practice' : 'net.solo'); }

  update(dt: number) {
    this.sinceReport += dt; this.sinceVehicleReport += dt;
    this.accumulator += Math.min(dt, 0.25);
    const step = 1 / TICK_RATE;
    while (this.accumulator >= step) {
      tickMatch(this.match, this.ctx, step);
      this.accumulator -= step;
      this.ticks++;
    }
    this.nameRival();
  }

  report(r: ClientReport) {
    reportState(this.match, this.ctx, this.me, r, this.sinceReport);
    this.sinceReport = 0;
  }
  fire(claim: ShotClaim) { fireShot(this.match, this.ctx, this.me, claim); }
  grenade(origin: Vec3, dir: Vec3) { throwGrenade(this.match, this.ctx, this.me, origin, dir); }
  smoke(origin: Vec3, dir: Vec3) { throwSmoke(this.match, this.ctx, this.me, origin, dir); }
  drink() { drinkBoba(this.match, this.ctx, this.me); }
  reload() { reload(this.match, this.me); }
  switchWeapon(slot: Slot) { switchWeapon(this.match, this.me, slot); }
  switchTeam() { switchTeam(this.match, this.ctx, this.me); }
  buy(item: BuyItem) { buyItem(this.match, this.ctx, this.me, item); }
  attach(weapon: WeaponId, attachment: AttachmentId) { buyAttachmentFor(this.match, this.me, weapon, attachment); }
  useCrate(index: number) { useAmmoCrate(this.match, this.ctx, this.me, index); }
  enterVehicle(index: number) { enterVehicle(this.match, this.ctx, this.me, index); }
  exitVehicle() { exitVehicle(this.match, this.ctx, this.me); }
  vehicleReport(r: VehicleReport) {
    reportVehicle(this.match, this.ctx, this.me, r, this.sinceVehicleReport);
    this.sinceVehicleReport = 0;
  }
  say(text: string, team: boolean) {
    const s = this.match.soldiers.find(x => x.id === this.me);
    const clean = text.trim().slice(0, 120);
    if (s && clean) this.events.push({ type: 'chat', id: s.id, name: s.name, team: s.team, text: clean, teamOnly: team });
  }
  dispose() { this.events = []; }
}
