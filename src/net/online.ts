import type { Identity, Infer } from 'spacetimedb';
import type { Vec3 } from '../../shared/math';
import type { ClientReport, MatchEvent, MatchState, ShotClaim, Soldier, Team } from '../../shared/match/state';
import type { Body } from '../../shared/world';
import type { GameLink } from '../game/link';
import type { DbConnection } from '../module_bindings';
import type RosterTable from '../module_bindings/roster_table';
import { decodeFrame, type DecodedFrame, type FramePose } from '../../shared/match/frame';
import { DEFAULT_WEAPONS, STAMINA, WEAPONS, weaponStats, type AttachmentId, type Attachments, type Slot, type WeaponId } from '../../shared/weapons';
import { newRoundStats, type BuyItem } from '../../shared/match/economy';

type RosterRow = Infer<typeof RosterTable>;

type Env = Record<string, string | undefined>;

/**
 * Where the SpacetimeDB database lives. "same-origin" routes the websocket through the page's
 * own host at /stdb (the dev server proxies it), so a single preview URL serves everything.
 */
export function onlineConfig() {
  const env = import.meta.env as Env;
  const params = new URLSearchParams(location.search);
  let uri = params.get('stdb') ?? env.VITE_SPACETIMEDB_URI;
  const database = params.get('db') ?? env.VITE_SPACETIMEDB_DATABASE;
  // Trailing slash matters: the SDK resolves 'v1/...' relative to this base URL.
  if (uri === 'same-origin') uri = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/stdb/`;
  return { uri, database };
}

export function onlineAvailable(): { ok: boolean; reason: string } {
  const { uri, database } = onlineConfig();
  if (!uri || !database) return { ok: false, reason: 'No SpacetimeDB server is configured for this build. Solo skirmish works offline.' };
  return { ok: true, reason: `Server: ${database}` };
}

const weaponOr = (id: string, fallback: WeaponId): WeaponId => (id in WEAPONS && id !== 'knife' ? id as WeaponId : fallback);
const gearOf = (json: string): { owned: WeaponId[]; attachments: Partial<Record<WeaponId, Attachments>> } => {
  try { const g = JSON.parse(json); return { owned: g.owned ?? [...DEFAULT_WEAPONS], attachments: g.attachments ?? {} }; } catch { return { owned: [...DEFAULT_WEAPONS], attachments: {} }; }
};

/** Rebuild a shared Soldier from its roster row and its pose in the latest frame. */
function soldierFrom(r: RosterRow, p: FramePose, reloadLeft: number, sinceShot: number): Soldier {
  const gear = gearOf(r.gearJson);
  return {
    id: r.id, name: r.name, team: r.team as Team, bot: r.bot,
    m: { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, grounded: p.grounded, crouch: p.crouch, slideTime: p.slide ? 0.2 : 0, slideCooldown: 0, airTime: 0, prevCrouchInput: false, prevJumpInput: false },
    yaw: p.yaw, pitch: p.pitch, alive: p.alive, health: p.health, weapon: p.weapon,
    weapons: [weaponOr(r.weapon0, DEFAULT_WEAPONS[0]), weaponOr(r.weapon1, DEFAULT_WEAPONS[1])], owned: gear.owned, attachments: gear.attachments,
    ammo: [0, 0], reserve: [r.reserve0, r.reserve1],
    reloadLeft, fireCooldown: 0, switchLeft: 0, grenades: r.grenades, grenadeHE: r.grenadeHe, stamina: STAMINA.max, money: r.money,
    sinceHit: 99, lastAttacker: r.lastAttacker, kills: r.kills, deaths: r.deaths, assists: r.assists, score: r.score,
    sprint: p.sprint, ads: p.ads, sinceShot, using: p.using, corrections: r.corrections,
    idle: 0, moveSlack: 0, groundY: 0, round: newRoundStats(), roundsHere: 0,
  };
}

/** A match hosted by the SpacetimeDB module; this client renders it and sends validated intents. */
export class OnlineLink implements GameLink {
  readonly mode = 'online' as const;
  readonly interpDelay = 0.1;
  private events: MatchEvent[] = [];
  private dirty = true;
  private ver = 0;
  private view?: MatchState;
  private me = -1;
  private pingMs = 0;
  private lastPing = 0;
  private reportsInFlight = 0;
  private disconnected = false;
  private rejoining = false;
  /** Join parameters, kept so the client can rejoin if the server drops an idle soldier. */
  joinArgs?: { name: string; team: number };

  private frame?: DecodedFrame;
  private frameMap = '';
  /** Client-side clocks for remote animation: when each soldier started reloading / last fired. */
  private reloadStart = new Map<number, number>();
  private lastShot = new Map<number, number>();

  constructor(private conn: DbConnection, private identity: Identity) {
    const bump = () => { this.dirty = true; };
    const db = conn.db;
    db.roster.onInsert(bump); db.roster.onUpdate(bump); db.roster.onDelete(bump);
    db.match.onUpdate(bump); db.match.onInsert(bump);
    db.player.onInsert(bump); db.player.onUpdate(bump); db.player.onDelete(bump);
    const onFrame = (row: { mapId: string; data: Uint8Array }) => {
      const decoded = decodeFrame(row.data);
      if (!decoded) return;
      this.frame = decoded; this.frameMap = row.mapId; this.dirty = true;
      const now = performance.now();
      for (const shot of decoded.shots) { this.events.push(shot); this.lastShot.set(shot.shooter, now); }
    };
    db.frame.onInsert((_ctx, row) => onFrame(row));
    db.frame.onUpdate((_ctx, _old, row) => onFrame(row));
    db.matchEvent.onInsert((_ctx, row) => { try { this.events.push(JSON.parse(row.json)); } catch { /* malformed event */ } });
  }

  markDisconnected() { this.disconnected = true; }
  myId() { this.state(); return this.me; }
  version() { this.state(); return this.ver; }

  state(): MatchState | undefined {
    if (!this.dirty && this.view) return this.view;
    const db = this.conn.db;
    const match = db.match.id.find(0);
    const frame = this.frame;
    if (!match || !frame) return this.view;
    const now = performance.now();
    const poses = new Map(frame.poses.map(p => [p.id, p]));
    const soldiers: Soldier[] = [];
    for (const r of db.roster.iter()) {
      const p = poses.get(r.id);
      if (!p) continue; // joined after the latest frame
      let reloadLeft = 0;
      if (p.reloading) {
        if (!this.reloadStart.has(r.id)) this.reloadStart.set(r.id, now);
        const total = p.weapon === 2 ? 0.01 : weaponStats(p.weaponId, gearOf(r.gearJson).attachments[p.weaponId]).reload;
        reloadLeft = Math.max(0.01, total - (now - this.reloadStart.get(r.id)!) / 1000);
      } else this.reloadStart.delete(r.id);
      const shot = this.lastShot.get(r.id);
      const sinceShot = p.firing ? 0 : shot === undefined ? 99 : (now - shot) / 1000;
      soldiers.push(soldierFrom(r, p, reloadLeft, sinceShot));
    }
    soldiers.sort((a, b) => a.id - b.id);
    const bodies: Body[] = frame.bodies.map(b => ({ ...b, age: 0, owner: -1, hp: 1, timer: 0 }));
    const mine = db.player.identity.find(this.identity);
    this.me = mine?.soldierId ?? -1;
    if (this.me < 0 && this.joinArgs && !this.rejoining && !this.disconnected) {
      // Backgrounded tabs stop reporting and get dropped as idle; rejoin transparently.
      this.rejoining = true;
      void this.conn.reducers.join(this.joinArgs).catch(() => undefined).finally(() => { setTimeout(() => { this.rejoining = false; }, 2000); });
    }
    // Mid-rotation the frame may still describe the previous map: hold its bomb back.
    const sameMap = this.frameMap === match.mapId;
    this.view = {
      mapId: match.mapId, phase: match.phase as MatchState['phase'], phaseLeft: frame.phaseLeft, time: frame.time, tick: frame.tick,
      scores: [match.score0, match.score1], soldiers, bodies, nextId: match.nextId,
      winner: match.winner as -1 | Team, config: JSON.parse(match.configJson),
      round: frame.round, roundPhase: frame.roundPhase, roundClock: 0, roundWinner: -1, lossStreak: [0, 0],
      firstKill: false, firstBlood: false, lastKillTeam: -1,
      bomb: sameMap ? frame.bomb : { site: -1, armed: false, progress: 0, by: -1 },
    };
    this.dirty = false;
    this.ver++;
    return this.view;
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
  update() { /* the server ticks the match */ }

  status() {
    if (this.disconnected) return 'DISCONNECTED';
    const humans = this.view?.soldiers.filter(s => !s.bot).length ?? 0;
    return `ONLINE · ${humans} PLAYER${humans === 1 ? '' : 'S'} · ${Math.round(this.pingMs)} MS`;
  }

  report(r: ClientReport) {
    if (this.reportsInFlight > 3) return; // never queue up stale movement
    this.reportsInFlight++;
    const sent = performance.now();
    void this.conn.reducers.report({ ...r, slide: !!r.slide, weapon: r.weapon, use: !!r.use })
      .then(() => { if (sent - this.lastPing > 500) { this.pingMs = this.pingMs ? this.pingMs * 0.7 + (performance.now() - sent) * 0.3 : performance.now() - sent; this.lastPing = sent; } })
      .catch(() => undefined)
      .finally(() => { this.reportsInFlight--; });
  }
  fire(c: ShotClaim) {
    void this.conn.reducers.fire({ weapon: c.weapon, ox: c.origin.x, oy: c.origin.y, oz: c.origin.z, dx: c.dir.x, dy: c.dir.y, dz: c.dir.z, target: c.target, zone: c.zone, px: c.point.x, py: c.point.y, pz: c.point.z }).catch(() => undefined);
  }
  buy(item: BuyItem) { void this.conn.reducers.buy({ item }).catch(() => undefined); }
  attach(weapon: WeaponId, attachment: AttachmentId) { void this.conn.reducers.buyAttachment({ weapon, attachment }).catch(() => undefined); }
  useCrate(index: number) { void this.conn.reducers.useCrate({ index }).catch(() => undefined); }
  say(text: string, team: boolean) { void this.conn.reducers.say({ text, team }).catch(() => undefined); }
  grenade(o: Vec3, d: Vec3) { void this.conn.reducers.grenade({ ox: o.x, oy: o.y, oz: o.z, dx: d.x, dy: d.y, dz: d.z }).catch(() => undefined); }
  reload() { void this.conn.reducers.reloadWeapon({}).catch(() => undefined); }
  switchWeapon(slot: Slot) { void this.conn.reducers.switchSlot({ slot }).catch(() => undefined); }
  dispose() {
    void this.conn.reducers.leave({}).catch(() => undefined);
    setTimeout(() => { try { this.conn.disconnect(); } catch { /* already closed */ } }, 300);
  }
}

/** Connect, subscribe, join the match and wait until our soldier exists. */
export async function connectOnline(name: string, team: Team | undefined, status: (s: string) => void): Promise<GameLink> {
  const { uri, database } = onlineConfig();
  if (!uri || !database) throw new Error('No SpacetimeDB server configured.');
  status('Connecting to SpacetimeDB…');
  const { DbConnection } = await import('../module_bindings');
  const tokenKey = `lawbreaker.token:${uri}:${database}`;
  let token: string | undefined;
  try { token = localStorage.getItem(tokenKey) ?? undefined; } catch { /* storage disabled */ }
  return new Promise<GameLink>((resolve, reject) => {
    let link: OnlineLink | undefined;
    const timer = setTimeout(() => reject(new Error('Timed out connecting to the match server.')), 20_000);
    const conn = DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
      .onConnect((connection, identity, nextToken) => {
        try { localStorage.setItem(tokenKey, nextToken); } catch { /* anonymous identity still works */ }
        status('Joining the battlefield…');
        link = new OnlineLink(connection, identity);
        connection.subscriptionBuilder()
          .onApplied(async () => {
            try {
              link!.joinArgs = { name, team: team ?? -1 };
              await connection.reducers.join(link!.joinArgs);
              const wait = () => {
                if (link!.myId() >= 0) { clearTimeout(timer); resolve(link!); } else setTimeout(wait, 50);
              };
              wait();
            } catch (error) { clearTimeout(timer); reject(error); }
          })
          .onError(() => { clearTimeout(timer); reject(new Error('Subscription failed.')); })
          // Per-tick state arrives packed in `frame`; `soldier` and `body` are server-side detail.
          .subscribe(['SELECT * FROM match', 'SELECT * FROM roster', 'SELECT * FROM frame', 'SELECT * FROM player', 'SELECT * FROM match_event']);
      })
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(new Error(`Could not reach the match server (${error?.message ?? 'connection refused'}).`)); })
      .onDisconnect(() => { link?.markDisconnected(); })
      .build();
    void conn;
  });
}
