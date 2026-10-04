import { rng, type Vec3 } from '../../shared/math';
import {
  addSoldier, applyLaw, balanceTeams, createContext, createMatch, fireShot, reload, reportState, setLoadout, switchWeapon,
  throwGrenade, tickMatch, TICK_RATE, type SimContext,
} from '../../shared/match/sim';
import { OFFLINE_CONFIG, PRACTICE_CONFIG, type ClientReport, type MatchConfig, type MatchEvent, type MatchState, type ShotClaim, type Team } from '../../shared/match/state';
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
  private lastReport = performance.now();

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
  status() { return this.practice ? 'LAW LAB · PRACTICE' : 'SOLO SKIRMISH'; }

  update(dt: number) {
    this.accumulator += Math.min(dt, 0.25);
    const step = 1 / TICK_RATE;
    while (this.accumulator >= step) {
      tickMatch(this.match, this.ctx, step);
      this.accumulator -= step;
      this.ticks++;
    }
  }

  report(r: ClientReport) {
    const now = performance.now();
    reportState(this.match, this.ctx, this.me, r, (now - this.lastReport) / 1000);
    this.lastReport = now;
  }
  fire(claim: ShotClaim) { fireShot(this.match, this.ctx, this.me, claim); }
  grenade(origin: Vec3, dir: Vec3) { throwGrenade(this.match, this.ctx, this.me, origin, dir); }
  reload() { reload(this.match, this.me); }
  switchWeapon(slot: 0 | 1) { switchWeapon(this.match, this.me, slot); }
  setLoadout(loadout: LoadoutId) { setLoadout(this.match, this.me, loadout); }
  async law(command: unknown, source: string, text: string) { return applyLaw(this.match, this.ctx, this.me, command, source, text); }
  dispose() { this.events = []; }
}
