import type { Identity, Infer } from 'spacetimedb';
import type { Vec3 } from '../../shared/math';
import type { ClientReport, MatchEvent, MatchState, Mode, ShotClaim, Soldier, Team, VehicleReport } from '../../shared/match/state';
import { sizeLabel, type RoomView } from '../../shared/match/rooms';
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
import { plural, t } from '../ui/i18n';
import { setPerson, track } from '../analytics';
import { NetReporter, SAMPLE_EVERY_MS, type NetFields, type NetReport } from '../../shared/netstats';
import type { WakeLink } from './wake';
import { keepAwake, pingUrl, serverIdentityKey } from './ping';
import { currentServer } from './servers';
import { currentDeviceKind } from '../game/device';

type RosterRow = Infer<typeof RosterTable>;

/**
 * Where the SpacetimeDB database lives: the server chosen in Settings (src/net/servers.ts; the
 * build's own by default), read at every connection, so a new choice reaches the lobby's next
 * watcher and the next match while a match in progress keeps its own connection.
 */
export function onlineConfig(): { uri?: string; database?: string } {
  const s = currentServer();
  return { uri: s?.uri, database: s?.database };
}

export function onlineAvailable(): { ok: boolean; reason: string } {
  const { uri, database } = onlineConfig();
  if (!uri || !database) return { ok: false, reason: 'No SpacetimeDB server is configured for this build. Solo skirmish works offline.' };
  return { ok: true, reason: `Server: ${database}` };
}

const weaponOr = (id: string, fallback: WeaponId): WeaponId => (id in WEAPONS && id !== 'knife' ? id as WeaponId : fallback);
const gearOf = (json: string): { owned: WeaponId[]; attachments: Partial<Record<WeaponId, Attachments>>; smokes: number; bobas: number } => {
  try { const g = JSON.parse(json); return { owned: g.owned ?? [...DEFAULT_WEAPONS], attachments: Object.fromEntries(Object.entries(g.attachments ?? {}).map(([w, a]) => [w, normalizeAttachments(a as Record<string, string>)])), smokes: Number(g.smokes) || 0, bobas: Number(g.bobas) || 0 }; } catch { return { owned: [...DEFAULT_WEAPONS], attachments: {}, smokes: 0, bobas: 0 }; }
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
    reloadLeft, fireCooldown: 0, switchLeft: 0, grenades: r.grenades, grenadeHE: r.grenadeHe, smokes: gear.smokes, bobas: gear.bobas, stamina: STAMINA.max, money: r.money,
    sinceHit: 99, lastAttacker: r.lastAttacker, kills: r.kills, deaths: r.deaths, assists: r.assists, score: r.score,
    sprint: p.sprint, ads: p.ads, sinceShot, using: p.using, corrections: r.corrections,
    idle: 0, moveSlack: 0, groundY: 0, round: newRoundStats(), roundsHere: 0,
  };
}

/**
 * How to get into a room: Quick Play (anything open, else a new 6v6), Start a Server (a new public
 * or private room with exactly these rules), a private room's code, or a listed public room.
 */
export type OnlineEntry =
  | { kind: 'any' }
  | { kind: 'start'; size: number; mode: Mode; mapId: string; bots: boolean; isPublic: boolean }
  | { kind: 'code'; code: string }
  | { kind: 'room'; room: number };

/** How long our player row may be missing (the transparent rejoin's window) before we leave the match. */
export const DROP_GRACE_MS = 8000;

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
  /** Connection quality (shared/netstats.ts): round trips, corrections, room time; reported every 2 minutes and on leaving. */
  private net = new NetReporter(performance.now());
  private netTimer = setInterval(() => this.pollNet(), 5000);
  /** Stops the in-match requests that keep the server from sleeping under us (`keepServerAwake`). */
  private stopAwake?: () => void;
  private reportsInFlight = 0;
  private disconnected = false;
  private rejoining = false;
  /** We have had a soldier in a room on this link (so losing it means the server dropped us). */
  private joinedOnce = false;
  /** When our player row went missing (0 = it is there). */
  private missingSince = 0;
  /** Why the link ended: the server removed us from the match, or the connection dropped. */
  dropReason?: 'removed' | 'lost';
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
    // The server corrected our soldier (a rejected movement report): count it for connection quality.
    db.roster.onUpdate((_ctx, old, row) => { if (row.id === this.me && row.corrections > old.corrections) this.net.meter.correct(row.corrections - old.corrections); });
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

  /** Called once when the connection drops (or after we leave). */
  onDrop?: () => void;
  markDisconnected() {
    if (this.disconnected) return;
    this.disconnected = true;
    clearInterval(this.netTimer);
    this.stopAwake?.();
    this.onDrop?.();
  }
  myId() { this.state(); return this.me; }
  version() { this.state(); return this.ver; }

  /** Follow our player row into its room: subscribe to that room's rows (and drop the old room's). */
  private followRoom() {
    const mine = this.conn.db.player.identity.find(this.identity);
    this.me = mine?.soldierId ?? -1;
    if (mine) this.joinedOnce = true;
    const room = mine ? mine.room : -1;
    if (room < 0 || room === this.room) return;
    this.room = room; this.frame = undefined; this.view = undefined;
    const old = this.roomSub;
    this.roomSub = this.conn.subscriptionBuilder()
      .onApplied(() => { old?.unsubscribe(); this.dirty = true; })
      .subscribe([`SELECT * FROM roster WHERE room = ${room}`, `SELECT * FROM frame WHERE id = ${room}`, `SELECT * FROM match_event WHERE room = ${room}`]);
  }

  /**
   * The room we play in: its private code ('' = Quick Play) and size. The code comes from
   * `my_room_code` (only players in the room see it), else `match.code` from an older server; it is
   * remembered, so a rejoin after the server dropped us (and the view went empty) still has it.
   */
  roomInfo() {
    const row = this.room >= 0 ? this.conn.db.match.id.find(this.room) : undefined;
    if (!row) return undefined;
    const config = JSON.parse(row.configJson) as { teamSize: number };
    const mine = [...this.conn.db.myRoomCode.iter()].find(r => r.room === this.room)?.code;
    const code = row.code || mine || (this.codeRoom === this.room ? this.code : '');
    if (code) { this.code = code; this.codeRoom = this.room; }
    return { code, size: sizeLabel(config.teamSize), room: this.room };
  }
  /** The last private code seen for our room (see `roomInfo`). */
  private code = '';
  private codeRoom = -1;

  /** In a room with a soldier: only then may inputs go out (the server rejects them otherwise). */
  private inMatch() { return !this.disconnected && !!this.conn.db.player.identity.find(this.identity); }

  /**
   * The server dropped us (idle, or the room closed) and the transparent rejoin did not bring us back
   * within DROP_GRACE_MS: end the link so the game returns to the lobby instead of playing on alone
   * against a frozen view. Checked on every state() read, since a closed room sends no more frames.
   */
  private checkRemoved() {
    if (this.disconnected || !this.joinedOnce) return;
    if (this.conn.db.player.identity.find(this.identity)) { this.missingSince = 0; return; }
    const now = performance.now();
    if (!this.missingSince) this.missingSince = now;
    else if (now - this.missingSince > DROP_GRACE_MS) { this.dropReason = 'removed'; this.markDisconnected(); }
  }

  state(): MatchState | undefined {
    this.checkRemoved();
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
    // No other human left: the room closes on its next tick, so a rejoin could only fail.
    if (this.me < 0 && this.entry && !this.rejoining && !this.disconnected && soldiers.some(s => !s.bot)) {
      // Backgrounded tabs stop reporting and get dropped as idle; rejoin the same room transparently.
      this.rejoining = true;
      const info = this.roomInfo();
      // Back into the same room: by its code, else as a listed public room.
      const how: OnlineEntry = info?.code ? { kind: 'code', code: info.code } : { kind: 'room', room: this.room };
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
    if (this.disconnected) return t('net.disconnected');
    const humans = this.view?.soldiers.filter(s => !s.bot).length ?? 0;
    const info = this.roomInfo();
    const room = info ? (info.code ? t('net.room', { code: info.code, size: info.size }) : t('net.quick', { size: info.size })) : t('net.online');
    return `${room} · ${plural('net.players', humans)} · ${Math.round(this.pingMs)} MS`;
  }

  report(r: ClientReport) {
    if (!this.inMatch()) return;
    if (this.reportsInFlight > 3) return; // never queue up stale movement
    this.reportsInFlight++;
    const sent = performance.now();
    void this.conn.reducers.report({ ...r, slide: !!r.slide, weapon: r.weapon, use: !!r.use })
      .then(() => this.samplePing(sent))
      .catch(() => undefined)
      .finally(() => { this.reportsInFlight--; });
  }
  /** A movement report's round trip, at most every 500 ms: the HUD's smoothed ping and a connection-quality sample. */
  private samplePing(sent: number) {
    if (sent - this.lastPing <= SAMPLE_EVERY_MS) return;
    const rtt = performance.now() - sent;
    this.pingMs = this.pingMs ? this.pingMs * 0.7 + rtt * 0.3 : rtt;
    this.lastPing = sent;
    this.net.meter.sample(rtt);
  }
  /** Every few seconds: the 2-minute report to the server and the 5-minute analytics sample, when due. */
  private pollNet() {
    if (this.disconnected) return;
    const { report, event } = this.net.poll(performance.now(), !!this.conn.db.player.identity.find(this.identity));
    if (report) this.sendNet(report);
    if (event) track('net_sample', event);
  }
  private sendNet(report: NetReport) {
    try { void this.conn.reducers.netStats(report).catch(() => undefined); } catch { /* a server without net_stats */ }
  }
  /**
   * The match is over for us (menu, a dropped connection, the tab closing): the last report to the
   * server while still connected, and the match's connection quality for analytics. Once; later
   * calls only return the numbers.
   */
  netLeft(): Omit<NetFields, 'seconds'> {
    clearInterval(this.netTimer);
    const { report, totals } = this.net.leave(performance.now());
    if (report && !this.disconnected) this.sendNet(report);
    // match_left has its own `seconds` (the match's length).
    return { ping_p50: totals.ping_p50, ping_p95: totals.ping_p95, samples: totals.samples, corrections: totals.corrections, corrections_per_min: totals.corrections_per_min };
  }
  fire(c: ShotClaim) {
    if (!this.inMatch()) return;
    void this.conn.reducers.fire({ weapon: c.weapon, ox: c.origin.x, oy: c.origin.y, oz: c.origin.z, dx: c.dir.x, dy: c.dir.y, dz: c.dir.z, target: c.target, zone: c.zone, px: c.point.x, py: c.point.y, pz: c.point.z }).catch(() => undefined);
  }
  buy(item: BuyItem) { if (!this.inMatch()) return; void this.conn.reducers.buy({ item }).catch(() => undefined); }
  attach(weapon: WeaponId, attachment: AttachmentId) { if (!this.inMatch()) return; void this.conn.reducers.buyAttachment({ weapon, attachment }).catch(() => undefined); }
  useCrate(index: number) { if (!this.inMatch()) return; void this.conn.reducers.useCrate({ index }).catch(() => undefined); }
  enterVehicle(index: number) { if (!this.inMatch()) return; void this.conn.reducers.enterVehicle({ index }).catch(() => undefined); }
  exitVehicle() { if (!this.inMatch()) return; void this.conn.reducers.exitVehicle({}).catch(() => undefined); }
  vehicleReport(r: VehicleReport) {
    if (!this.inMatch()) return;
    if (this.reportsInFlight > 3) return;
    this.reportsInFlight++;
    const sent = performance.now();
    void this.conn.reducers.vehicleReport({ ...r, aimYaw: r.aimYaw ?? r.yaw, aimPitch: r.aimPitch ?? 0 }).then(() => this.samplePing(sent)).catch(() => undefined).finally(() => { this.reportsInFlight--; });
  }
  switchTeam() { if (!this.inMatch()) return; try { void this.conn.reducers.changeTeam({}).catch(() => undefined); } catch { /* a server without change_team */ } }
  say(text: string, team: boolean) { if (!this.inMatch()) return; void this.conn.reducers.say({ text, team }).catch(() => undefined); }
  smoke(o: Vec3, d: Vec3) { if (!this.inMatch()) return; try { void this.conn.reducers.smoke({ ox: o.x, oy: o.y, oz: o.z, dx: d.x, dy: d.y, dz: d.z }).catch(() => undefined); } catch { /* a server without smoke */ } }
  drink() { if (!this.inMatch()) return; try { void this.conn.reducers.drink({}).catch(() => undefined); } catch { /* a server without bubble tea */ } }
  grenade(o: Vec3, d: Vec3) { if (!this.inMatch()) return; void this.conn.reducers.grenade({ ox: o.x, oy: o.y, oz: o.z, dx: d.x, dy: d.y, dz: d.z }).catch(() => undefined); }
  reload() { if (!this.inMatch()) return; void this.conn.reducers.reloadWeapon({}).catch(() => undefined); }
  switchWeapon(slot: Slot) { if (!this.inMatch()) return; void this.conn.reducers.switchSlot({ slot }).catch(() => undefined); }
  /** While we are in a room, keep the scale-to-zero server from sleeping under the match (`keepAwake`). */
  keepServerAwake(url: string) { this.stopAwake = keepAwake(url, () => this.inMatch()); }

  dispose() {
    this.stopAwake?.();
    this.netLeft();
    // Already dropped by the server: there is nothing to leave (it would only answer "Not joined").
    if (this.inMatch()) void this.conn.reducers.leave({}).catch(() => undefined);
    // We are leaving on purpose: the socket closing next is not a drop to report.
    this.onDrop = undefined;
    setTimeout(() => { try { this.conn.disconnect(); } catch { /* already closed */ } }, 300);
  }
}

/** Tell the server this browser's time zone and language, then its kind of device (once per connection; older servers lack `hello`). */
function sayHello(conn: DbConnection) {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''; } catch { /* no Intl time zone */ }
  try { void conn.reducers.hello({ tz, lang: navigator.language ?? '' }).catch(() => undefined); } catch { /* server without hello */ }
  // Then whether this is a phone, tablet or computer (src/game/device.ts; older servers lack `device`).
  try { void conn.reducers.device({ kind: currentDeviceKind() }).catch(() => undefined); } catch { /* server without device */ }
}

/** A server published before a reducer existed refuses the call by name. */
const missingReducer = (error: unknown) => /no such reducer|reducer.*not found|unknown reducer/i.test(String((error as Error)?.message ?? error));

/** Ask the server for a room (Quick Play, Start a Server, by code, a listed room, or an older lobby's way in). */
async function enter(conn: DbConnection, e: { name: string; team: number; how: OnlineEntry }): Promise<void> {
  const { name, team, how } = e;
  if (how.kind === 'any') {
    try { return await conn.reducers.quickAny({ name, team }); } catch (error) {
      // A server published before quick_any: Quick Play 6v6, which it has.
      if (!missingReducer(error)) throw error;
      return conn.reducers.quickJoin({ name, team, size: 6 });
    }
  }
  if (how.kind === 'start') {
    try { return await conn.reducers.startRoom({ name, team, size: how.size, mode: how.mode, mapId: how.mapId, bots: how.bots, isPublic: how.isPublic }); } catch (error) {
      // A server published before start_room: a public room by filter (bots on), or a private room.
      if (!missingReducer(error)) throw error;
      return how.isPublic ? conn.reducers.quickPlay({ name, team, size: how.size, mode: how.mode, mapId: how.mapId })
        : conn.reducers.createRoom({ name, team, size: how.size, mode: how.mode, mapId: how.mapId, bots: how.bots });
    }
  }
  if (how.kind === 'room') return conn.reducers.joinPublic({ name, team, room: how.room });
  return conn.reducers.joinRoom({ name, team, code: how.code });
}

/**
 * A public room as the lobby lists it (and as Play Online's matching sees it). `server` is the
 * SpacetimeDB URI it lives on (one database today), so the lobby shows each room its server's ping.
 */
export interface PublicRoom extends RoomView { phase: string; round: number; server: string }

/**
 * Live list of rooms for the lobby: a light connection that only subscribes to the room rows (no
 * joining). Private rooms are listed too, marked `private`; their code never leaves this function,
 * so joining one still takes the code. `onChange` fires whenever a room opens, fills or closes. One attempt: `live`
 * resolves once the rooms have arrived and rejects if the connection fails first; `lost` is called
 * (once) if it drops after that. Retrying, and telling a sleeping server from a dead one, is the
 * caller's (src/net/wake.ts).
 */
export function watchRooms(onChange: (rooms: PublicRoom[]) => void, lost: () => void): WakeLink {
  const { uri, database } = onlineConfig();
  let conn: DbConnection | undefined, stopped = false, isLive = false, ended = false;
  let settle: { resolve(): void; reject(error: Error): void } = { resolve() {}, reject() {} };
  const live = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
  live.catch(() => undefined);
  const stop = () => { stopped = true; try { conn?.disconnect(); } catch { /* already closed */ } };
  /** The connection failed (before live) or dropped (after): reported once. */
  const end = (error: Error) => {
    if (ended || stopped) return;
    ended = true;
    stop();
    if (isLive) lost(); else settle.reject(error);
  };
  if (!uri || !database) { settle.reject(new Error('No SpacetimeDB server configured.')); return { live, stop }; }
  const emit = () => {
    if (!conn || stopped) return;
    const rooms: PublicRoom[] = [];
    for (const r of conn.db.match.iter()) {
      let config: { mode?: Mode; teamSize?: number; fixedMap?: boolean; fixedMode?: boolean; noBots?: boolean } = {};
      try { config = JSON.parse(r.configJson); } catch { /* malformed row: listed with defaults */ }
      rooms.push({
        room: r.id, mapId: r.mapId, mode: config.mode === 'sabotage' ? 'sabotage' : 'elimination', size: config.teamSize ?? 6, humans: r.humans,
        phase: r.phase, round: r.score0 + r.score1 + 1, fixedMap: !!config.fixedMap, fixedMode: !!config.fixedMode, noBots: !!config.noBots, server: uri,
        ...(r.code !== '' || conn.db.privateRoom.room.find(r.id) ? { private: true } : {}),
      });
    }
    onChange(rooms.sort((a, b) => b.humans - a.humans || a.room - b.room));
  };
  void import('../module_bindings').then(({ DbConnection }) => {
    if (stopped) return;
    conn = DbConnection.builder().withUri(uri).withDatabaseName(database)
      .onConnect(c => {
        if (stopped) { c.disconnect(); return; }
        c.db.match.onInsert(emit); c.db.match.onUpdate(emit); c.db.match.onDelete(emit);
        c.db.privateRoom.onInsert(emit); c.db.privateRoom.onDelete(emit);
        c.subscriptionBuilder()
          .onApplied(() => { if (stopped) return; isLive = true; settle.resolve(); emit(); })
          .onError(() => end(new Error('Subscription failed.')))
          .subscribe(['SELECT * FROM match']);
        // Which rooms are private (their codes stay on the server). A server without the table: none listed.
        c.subscriptionBuilder().onApplied(emit).onError(() => undefined).subscribe(['SELECT * FROM private_room']);
      })
      // A socket that fails before the handshake reports an error and then a close: `end` keeps the first.
      .onConnectError((_ctx, error) => end(error ?? new Error('Connection failed.')))
      .onDisconnect(() => end(new Error('Disconnected.')))
      .build();
  }, (error: unknown) => end(error instanceof Error ? error : new Error(String(error))));
  return { live, stop };
}

/**
 * The server could not be reached (refused, timed out, dropped before we were in a room): asleep or
 * restarting, not a refusal by the game. The lobby wakes the server and tries once more.
 */
export class ConnectError extends Error {}

/** Connect, subscribe, enter a room and wait until our soldier exists. */
export async function connectOnline(name: string, team: Team | undefined, how: OnlineEntry, status: (s: string) => void): Promise<OnlineLink> {
  const { uri, database } = onlineConfig();
  if (!uri || !database) throw new Error('No SpacetimeDB server configured.');
  status(t('net.connecting'));
  const { DbConnection } = await import('../module_bindings');
  const tokenKey = `lawbreaker.token:${serverIdentityKey(uri)}:${database}`;
  let token: string | undefined;
  try { token = localStorage.getItem(tokenKey) ?? undefined; } catch { /* storage disabled */ }
  return new Promise<OnlineLink>((resolve, reject) => {
    let link: OnlineLink | undefined;
    /** Settled (in a room, or given up): a connection that opens after a timeout must not put a soldier in a room. */
    let done = false;
    const fail = (error: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { conn.disconnect(); } catch { /* already closed */ }
      reject(error);
    };
    // No handshake by then: the server is unreachable (asleep, restarting); after it, the join itself stalled.
    const timer = setTimeout(() => fail(link ? new Error(t('net.timeout')) : new ConnectError(t('net.timeout'))), 20_000);
    const conn: DbConnection = DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
      .onConnect((connection, identity, nextToken) => {
        if (done) { connection.disconnect(); return; }
        try { localStorage.setItem(tokenKey, nextToken); } catch { /* anonymous identity still works */ }
        status(t('net.joining'));
        // Rough "where from" for the owner's player counts (the private player_seen table): time zone and language, no IP;
        // and phone, tablet or computer (player_device).
        sayHello(connection);
        // PostHog people can be matched to SpacetimeDB profiles by this property (never identify()).
        setPerson({ stdb_identity: identity.toHexString() });
        link = new OnlineLink(connection, identity);
        const awake = pingUrl(uri);
        if (awake) link.keepServerAwake(awake);
        connection.subscriptionBuilder()
          .onApplied(async () => {
            if (done) return;
            try {
              link!.entry = { name, team: team ?? -1, how };
              await enter(connection, link!.entry);
              // Our soldier exists once the room's frame (with us in it) has arrived.
              const wait = () => {
                if (done) return;
                if (link!.myId() >= 0 && link!.state()) { done = true; clearTimeout(timer); resolve(link!); } else setTimeout(wait, 50);
              };
              wait();
            } catch (error) { fail(error as Error); }
          })
          .onError(() => fail(new Error(t('net.subscription'))))
          // Rooms (match rows), players and career stats; the room's own roster, frame and events
          // follow once we know our room. `soldier` and `body` are server-side detail.
          .subscribe(['SELECT * FROM match', 'SELECT * FROM player', 'SELECT * FROM profile']);
        // Our own private room's code (the server keeps codes off the public room rows); none from an older server.
        connection.subscriptionBuilder().onError(() => undefined).subscribe(['SELECT * FROM my_room_code']);
      })
      .onConnectError((_ctx, error) => fail(new ConnectError(t('net.unreachable', { error: error?.message ?? t('net.refused') }))))
      .onDisconnect(() => {
        // Dropped before we were in a room: as unreachable as a refused connection.
        if (!done) fail(new ConnectError(t('net.unreachable', { error: t('net.refused') })));
        if (link && !link.dropReason) link.dropReason = 'lost';
        link?.markDisconnected();
      })
      .build();
  });
}
