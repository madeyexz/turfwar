import type { Identity, Infer } from 'spacetimedb';
import type { Vec3 } from '../../shared/math';
import type { ClientReport, MatchEvent, MatchState, Mode, ShotClaim, Soldier, Team, VehicleReport } from '../../shared/match/state';
import { sizeLabel } from '../../shared/match/rooms';
import type { Body } from '../../shared/world';
import { maxSlack, type Vehicle } from '../../shared/vehicles';
import type { CareerStats, GameLink } from '../game/link';
import type { DbConnection } from '../module_bindings';
import type RosterTable from '../module_bindings/roster_table';
import { loadMap } from '../../shared/maps/index';
import { roundLength } from '../../shared/match/sim';
import { decodeFrame, type DecodedFrame, type FramePose } from '../../shared/match/frame';
import { DEFAULT_WEAPONS, STAMINA, WEAPONS, normalizeAttachments, weaponStats, type AttachmentId, type Attachments, type Slot, type WeaponId } from '../../shared/weapons';
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
  try { const g = JSON.parse(json); return { owned: g.owned ?? [...DEFAULT_WEAPONS], attachments: Object.fromEntries(Object.entries(g.attachments ?? {}).map(([w, a]) => [w, normalizeAttachments(a as Record<string, string>)])) }; } catch { return { owned: [...DEFAULT_WEAPONS], attachments: {} }; }
};

/** Rebuild a shared Soldier from its roster row and its pose in the latest frame. */
function soldierFrom(r: RosterRow, p: FramePose, reloadLeft: number, sinceShot: number): Soldier {
  const gear = gearOf(r.gearJson);
  return {
    id: r.id, name: r.name, team: r.team as Team, bot: r.bot,
    m: { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, grounded: p.grounded, crouch: p.crouch, slideTime: p.slide ? 0.2 : 0, slideCooldown: 0, airTime: 0, prevCrouchInput: false, prevJumpInput: false },
    yaw: p.yaw, pitch: p.pitch, alive: p.alive, health: p.health, weapon: p.weapon,
    weapons: [weaponOr(r.weapon0, DEFAULT_WEAPONS[0]), weaponOr(r.weapon1, DEFAULT_WEAPONS[1])], owned: gear.owned, attachments: gear.attachments,
    ammo: p.weapon === 0 ? [p.ammo, 0] : p.weapon === 1 ? [0, p.ammo] : [0, 0], reserve: [r.reserve0, r.reserve1],
    reloadLeft, fireCooldown: 0, switchLeft: 0, grenades: r.grenades, grenadeHE: r.grenadeHe, stamina: STAMINA.max, money: r.money,
    sinceHit: 99, lastAttacker: r.lastAttacker, kills: r.kills, deaths: r.deaths, assists: r.assists, score: r.score,
    sprint: p.sprint, ads: p.ads, sinceShot, using: p.using, corrections: r.corrections,
    idle: 0, moveSlack: 0, groundY: 0, round: newRoundStats(), roundsHere: 0,
  };
}

/** How to get into a room: Quick Play by size, a new private room, or a private room's code. */
export type OnlineEntry =
  | { kind: 'quick'; size: number }
  | { kind: 'create'; size: number; mode: Mode; mapId: string; bots: boolean }
  | { kind: 'code'; code: string }
  | { kind: 'room'; room: number };

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
  /** How we got in, kept so the client can rejoin its room if the server drops an idle soldier. */
  entry?: { name: string; team: number; how: OnlineEntry };
  /** Our room, and the subscription to its roster, frame and events. */
  private room = -1;
  private roomSub?: { unsubscribe(): void };

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
    const onFrame = (row: { id: number; mapId: string; data: Uint8Array }) => {
      if (row.id !== this.room) return;
      const decoded = decodeFrame(row.data);
      if (!decoded) return;
      this.frame = decoded; this.frameMap = row.mapId; this.dirty = true;
      const now = performance.now();
      for (const shot of decoded.shots) { this.events.push(shot); this.lastShot.set(shot.shooter, now); }
    };
    db.frame.onInsert((_ctx, row) => onFrame(row));
    db.frame.onUpdate((_ctx, _old, row) => onFrame(row));
    db.matchEvent.onInsert((_ctx, row) => { if (row.room === this.room) try { this.events.push(JSON.parse(row.json)); } catch { /* malformed event */ } });
  }

  markDisconnected() { this.disconnected = true; }
  myId() { this.state(); return this.me; }
  version() { this.state(); return this.ver; }

  /** Follow our player row into its room: subscribe to that room's rows (and drop the old room's). */
  private followRoom() {
    const mine = this.conn.db.player.identity.find(this.identity);
    this.me = mine?.soldierId ?? -1;
    const room = mine ? mine.room : -1;
    if (room < 0 || room === this.room) return;
    this.room = room; this.frame = undefined; this.view = undefined;
    const old = this.roomSub;
    this.roomSub = this.conn.subscriptionBuilder()
      .onApplied(() => { old?.unsubscribe(); this.dirty = true; })
      .subscribe([`SELECT * FROM roster WHERE room = ${room}`, `SELECT * FROM frame WHERE id = ${room}`, `SELECT * FROM match_event WHERE room = ${room}`]);
  }

  /** The room we play in: its private code ('' = Quick Play) and size. */
  roomInfo() {
    const row = this.room >= 0 ? this.conn.db.match.id.find(this.room) : undefined;
    if (!row) return undefined;
    const config = JSON.parse(row.configJson) as { teamSize: number };
    return { code: row.code, size: sizeLabel(config.teamSize) };
  }

  state(): MatchState | undefined {
    if (!this.dirty && this.view) return this.view;
    const db = this.conn.db;
    this.followRoom();
    const match = this.room >= 0 ? db.match.id.find(this.room) : undefined;
    const frame = this.frame;
    if (!match || !frame) return this.view;
    const now = performance.now();
    const poses = new Map(frame.poses.map(p => [p.id, p]));
    const soldiers: Soldier[] = [];
    for (const r of db.roster.iter()) {
      if (r.room !== this.room) continue;
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
    const vehicles: Vehicle[] = frame.vehicles.map(v => ({ ...v, steer: 0, slack: maxSlack(v.kind), lastAttacker: -1, lastRun: -9 }));
    if (this.me < 0 && this.entry && !this.rejoining && !this.disconnected) {
      // Backgrounded tabs stop reporting and get dropped as idle; rejoin the same room transparently.
      this.rejoining = true;
      const info = this.roomInfo(), how: OnlineEntry = info?.code ? { kind: 'code', code: info.code } : this.entry.how.kind === 'code' ? this.entry.how : { kind: 'quick', size: JSON.parse(match.configJson).teamSize };
      void enter(this.conn, { ...this.entry, how }).catch(() => undefined).finally(() => { setTimeout(() => { this.rejoining = false; }, 2000); });
    }
    // Mid-rotation the frame may still describe the previous map: hold its bomb back.
    const sameMap = this.frameMap === match.mapId;
    this.view = {
      mapId: match.mapId, phase: match.phase as MatchState['phase'], phaseLeft: frame.phaseLeft, time: frame.time, tick: frame.tick,
      scores: [match.score0, match.score1], soldiers, bodies, vehicles: sameMap ? vehicles : [], nextId: match.nextId,
      winner: match.winner as -1 | Team, config: JSON.parse(match.configJson),
      round: frame.round, roundPhase: frame.roundPhase, roundClock: 0, roundWinner: -1, lossStreak: [0, 0],
      firstKill: false, firstBlood: false, lastKillTeam: -1,
      bomb: sameMap ? frame.bomb : { site: -1, armed: false, progress: 0, by: -1 },
    };
    // The buy window counts from round start: rebuild that clock from the phase countdown.
    const v = this.view, config = v.config;
    v.roundClock = v.roundPhase === 'freeze' ? config.freezeTime - v.phaseLeft
      : v.roundPhase === 'live' ? config.freezeTime + roundLength(v, loadMap(v.mapId).def) - v.phaseLeft : 999;
    this.dirty = false;
    this.ver++;
    return this.view;
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
  update() { /* the server ticks the match */ }

  leaderboard(): CareerStats[] {
    const rows: CareerStats[] = [];
    for (const p of this.conn.db.profile.iter()) rows.push({ ...p, mine: p.identity.isEqual(this.identity) });
    return rows.sort((a, b) => b.matchesWon - a.matchesWon || b.kills - a.kills);
  }

  status() {
    if (this.disconnected) return 'DISCONNECTED';
    const humans = this.view?.soldiers.filter(s => !s.bot).length ?? 0;
    const info = this.roomInfo();
    const room = info ? (info.code ? `ROOM ${info.code} · ${info.size}` : `QUICK PLAY ${info.size}`) : 'ONLINE';
    return `${room} · ${humans} PLAYER${humans === 1 ? '' : 'S'} · ${Math.round(this.pingMs)} MS`;
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
  enterVehicle(index: number) { void this.conn.reducers.enterVehicle({ index }).catch(() => undefined); }
  exitVehicle() { void this.conn.reducers.exitVehicle({}).catch(() => undefined); }
  vehicleReport(r: VehicleReport) {
    if (this.reportsInFlight > 3) return;
    this.reportsInFlight++;
    void this.conn.reducers.vehicleReport({ ...r, aimYaw: r.aimYaw ?? r.yaw, aimPitch: r.aimPitch ?? 0 }).catch(() => undefined).finally(() => { this.reportsInFlight--; });
  }
  say(text: string, team: boolean) { void this.conn.reducers.say({ text, team }).catch(() => undefined); }
  grenade(o: Vec3, d: Vec3) { void this.conn.reducers.grenade({ ox: o.x, oy: o.y, oz: o.z, dx: d.x, dy: d.y, dz: d.z }).catch(() => undefined); }
  reload() { void this.conn.reducers.reloadWeapon({}).catch(() => undefined); }
  switchWeapon(slot: Slot) { void this.conn.reducers.switchSlot({ slot }).catch(() => undefined); }
  dispose() {
    void this.conn.reducers.leave({}).catch(() => undefined);
    setTimeout(() => { try { this.conn.disconnect(); } catch { /* already closed */ } }, 300);
  }
}

/** Ask the server for a room (Quick Play, new private room, or by code). */
function enter(conn: DbConnection, e: { name: string; team: number; how: OnlineEntry }) {
  const { name, team, how } = e;
  if (how.kind === 'quick') return conn.reducers.quickJoin({ name, team, size: how.size });
  if (how.kind === 'create') return conn.reducers.createRoom({ name, team, size: how.size, mode: how.mode, mapId: how.mapId, bots: how.bots });
  if (how.kind === 'room') return conn.reducers.joinPublic({ name, team, room: how.room });
  return conn.reducers.joinRoom({ name, team, code: how.code });
}

/** A public room as the lobby lists it. */
export interface PublicRoom { room: number; mapId: string; mode: Mode; size: number; humans: number; phase: string; round: number }

/**
 * Live list of public rooms for the lobby: a light connection that only subscribes to the room rows
 * (no joining). `onChange` fires whenever a room opens, fills or closes. Returns a stop function.
 */
export async function watchRooms(onChange: (rooms: PublicRoom[]) => void, onState: (s: 'connecting' | 'live' | 'offline') => void): Promise<() => void> {
  const { uri, database } = onlineConfig();
  if (!uri || !database) { onState('offline'); return () => {}; }
  onState('connecting');
  const { DbConnection } = await import('../module_bindings');
  let conn: DbConnection | undefined, stopped = false;
  const emit = () => {
    if (!conn) return;
    const rooms: PublicRoom[] = [];
    for (const r of conn.db.match.iter()) {
      if (r.code !== '') continue;
      const config = JSON.parse(r.configJson) as { mode: Mode; teamSize: number };
      rooms.push({ room: r.id, mapId: r.mapId, mode: config.mode, size: config.teamSize, humans: r.humans, phase: r.phase, round: r.score0 + r.score1 + 1 });
    }
    onChange(rooms.sort((a, b) => b.humans - a.humans || a.room - b.room));
  };
  conn = DbConnection.builder().withUri(uri).withDatabaseName(database)
    .onConnect(c => {
      if (stopped) { c.disconnect(); return; }
      c.db.match.onInsert(emit); c.db.match.onUpdate(emit); c.db.match.onDelete(emit);
      c.subscriptionBuilder().onApplied(() => { onState('live'); emit(); }).subscribe(['SELECT * FROM match']);
    })
    .onConnectError(() => onState('offline'))
    .onDisconnect(() => { if (!stopped) onState('offline'); })
    .build();
  return () => { stopped = true; try { conn?.disconnect(); } catch { /* already closed */ } };
}

/** Connect, subscribe, enter a room and wait until our soldier exists. */
export async function connectOnline(name: string, team: Team | undefined, how: OnlineEntry, status: (s: string) => void): Promise<OnlineLink> {
  const { uri, database } = onlineConfig();
  if (!uri || !database) throw new Error('No SpacetimeDB server configured.');
  status('Connecting to SpacetimeDB…');
  const { DbConnection } = await import('../module_bindings');
  const tokenKey = `lawbreaker.token:${uri}:${database}`;
  let token: string | undefined;
  try { token = localStorage.getItem(tokenKey) ?? undefined; } catch { /* storage disabled */ }
  return new Promise<OnlineLink>((resolve, reject) => {
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
              link!.entry = { name, team: team ?? -1, how };
              await enter(connection, link!.entry);
              // Our soldier exists once the room's frame (with us in it) has arrived.
              const wait = () => {
                if (link!.myId() >= 0 && link!.state()) { clearTimeout(timer); resolve(link!); } else setTimeout(wait, 50);
              };
              wait();
            } catch (error) { clearTimeout(timer); reject(error); }
          })
          .onError(() => { clearTimeout(timer); reject(new Error('Subscription failed.')); })
          // Rooms (match rows), players and career stats; the room's own roster, frame and events
          // follow once we know our room. `soldier` and `body` are server-side detail.
          .subscribe(['SELECT * FROM match', 'SELECT * FROM player', 'SELECT * FROM profile']);
      })
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(new Error(`Could not reach the match server (${error?.message ?? 'connection refused'}).`)); })
      .onDisconnect(() => { link?.markDisconnected(); })
      .build();
    void conn;
  });
}
