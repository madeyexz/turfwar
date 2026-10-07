import { Identity, ScheduleAt, Timestamp } from 'spacetimedb';
import { schema, table, t, SenderError, type ReducerCtx, type InferSchema } from 'spacetimedb/server';
import { loadMap, loadNav } from '../../shared/maps/index';
import { cleanCode, filterError, isRoomSize, mapsFor, newRoomRules, nextRoomRules, pickAnyRoom, pickRoom, QUICK_PLAY_NEW, roomCode, startRoomConfig, startRoomError, type RoomFilter, type RoomView } from '../../shared/match/rooms';
import type { SimContext } from '../../shared/match/combat';
import { encodeFrame } from '../../shared/match/frame';
import {
  addSoldier, balanceTeams, buyAttachmentFor, buyItem, createMatch, enterVehicle as getIn, exitVehicle as getOut, fireShot, reload, removeSoldier, reportState, switchTeam,
  reportVehicle, resetMatch, switchWeapon, throwGrenade, tickMatch, useAmmoCrate, TICK_RATE,
} from '../../shared/match/sim';
import {
  ONLINE_CONFIG, type BombState, type BotBrain, type MatchConfig, type MatchEvent, type MatchState, type RoundStats, type Soldier, type Team,
} from '../../shared/match/state';
import { ATTACHMENTS, DEFAULT_WEAPONS, STAMINA, WEAPONS, normalizeAttachments, type AttachmentId, type Attachments, type Slot, type WeaponId } from '../../shared/weapons';
import { newRoundStats, type BuyItem } from '../../shared/match/economy';
import { BODY_RADIUS, type Body } from '../../shared/world';
import { VEHICLE_KINDS, type Vehicle, type VehicleKind } from '../../shared/vehicles';
import { cleanHello } from '../../shared/hello';
import { beginPlay, endPlay, flushDue, flushPlay, type PlayStore } from '../../shared/playtime';
import { acceptNetReport, foldNetDay } from '../../shared/netstats';
import { acceptDevice } from '../../shared/devicekind';
import * as Admin from './admin';
import { AdminError, dailyNetRows, dailyRows, dailyTimeRows, dayOf, forAdmin, playerDeviceRows, playerNetRows, playerRows, playTimeRows, type AdminStore } from './admin';

/**
 * Authoritative multiplayer: the same shared match simulation the offline client runs, executed
 * here on a 30 Hz scheduled reducer per room. One database holds many rooms: Play Online fills
 * public rooms of a size (1v1, 6v6, 24v24), optionally of a mode and a map; private rooms are joined
 * with a four-letter code. A room
 * exists (and ticks) only while humans are in it. Player reducers only queue their input (a cheap private-row
 * write); the tick loads the match once, applies every queued report and command through the
 * shared validation rules, simulates, and publishes one packed `frame` row plus the slow-changing
 * `roster` rows. That keeps a 100-soldier match to one load/save per tick and one small row
 * update per client per tick.
 */
/** Highest room id (rooms are u8 keys of the match, clock and frame tables). */
const MAX_ROOMS = 250;
/** Soldier and body ids are global (frames carry them as u16): wrap well before that. */
const MAX_ID = 60_000;
/** Chat lines one player may send per 10 seconds. */
const CHAT_BURST = 5;
/** Queued commands one soldier may have applied per tick; anything beyond is spam. */
const COMMANDS_PER_TICK = 24;

// ---- Tables -------------------------------------------------------------------------------
// `match`, `soldier`, `point`, `body`, `player` and `history` keep their original columns so existing
// databases migrate in place (new columns are appended with defaults). Clients read `match` (slow
// fields), `roster`, `frame` and their own `player` row; `soldier` and `body` hold full-precision
// server state. `point` and `history` are unused leftovers of capture points and world rewind.

const matchTable = table({ name: 'match', public: true }, {
  id: t.u8().primaryKey(),
  mapId: t.string(), phase: t.string(), phaseLeft: t.f64(), time: t.f64(), worldTime: t.f64(), tick: t.u32(),
  score0: t.u32(), score1: t.u32(), scoreTimer: t.f64(),
  // Legacy physics-law columns (lawsJson … rewindLeft, droneTimer, history*): written neutral, kept for in-place migration.
  lawsJson: t.string(), lawAuthor: t.i32(), lawText: t.string(), lawLeft: t.f64(), rewindLeft: t.u32(),
  nextId: t.u32(), droneTimer: t.f64(), winner: t.i8(), configJson: t.string(),
  historyHead: t.u32(), historyLength: t.u32(), lastTickMicros: t.u64(), humans: t.u32(),
  /**
   * Always '' now: a private room's code lives in `room_code` (private) and `private_room` marks it.
   * Rooms opened before kept their code here until their next tick moved it. The row id is the room id.
   */
  code: t.string().default(''),
});

/** Per-tick server bookkeeping per room (id = room), kept out of the public match row so it is not broadcast 30×/s. */
const clockTable = table({ name: 'clock' }, {
  id: t.u8().primaryKey(),
  phaseLeft: t.f64(), time: t.f64(), tick: t.u32(), nextId: t.u32(), lastTickMicros: t.u64(),
  /** Round, freeze/live/over, buy clock, last round result, loss streaks, first-kill flags and the bomb. */
  roundJson: t.string(),
});

const soldierTable = table({ name: 'soldier', public: true }, {
  id: t.u32().primaryKey(), name: t.string(), team: t.u8(), bot: t.bool(), loadout: t.string(),
  x: t.f32(), y: t.f32(), z: t.f32(), vx: t.f32(), vy: t.f32(), vz: t.f32(), yaw: t.f32(), pitch: t.f32(),
  crouch: t.f32(), grounded: t.bool(), slideTime: t.f32(), slideCooldown: t.f32(), airTime: t.f32(), prevCrouch: t.bool(), prevJump: t.bool(),
  alive: t.bool(), health: t.f32(), shield: t.f32(), weapon: t.u8(), ammo0: t.u16(), ammo1: t.u16(),
  reloadLeft: t.f32(), fireCooldown: t.f32(), switchLeft: t.f32(), grenades: t.u8(), respawnLeft: t.f32(), protectLeft: t.f32(),
  sinceHit: t.f32(), lastAttacker: t.i32(), kills: t.u32(), deaths: t.u32(), score: t.u32(), captures: t.u32(),
  lawCooldown: t.f32(), sprint: t.bool(), ads: t.bool(), sinceShot: t.f32(), corrections: t.u32(), idle: t.f32(),
  // Appended with defaults so existing databases migrate in place.
  moveSlack: t.f32().default(6), groundY: t.f32().default(0),
  weapon0: t.string().default(''), weapon1: t.string().default(''), reserve0: t.u16().default(0), reserve1: t.u16().default(0),
  money: t.u32().default(800), bought0: t.string().default(''), bought1: t.string().default(''), sinceSpawn: t.f32().default(99),
  /** Owned weapons, attachments, stamina, assists, per-round cash bookkeeping (JSON). */
  gearJson: t.string().default(''),
  room: t.u8().default(0),
});

/** What other players need about a soldier, rewritten only when it changes (not every tick). */
const rosterTable = table({ name: 'roster', public: true }, {
  id: t.u32().primaryKey(), room: t.u8().index('btree'), name: t.string(), team: t.u8(), bot: t.bool(), alive: t.bool(),
  grenades: t.u8(), grenadeHE: t.bool(), kills: t.u32(), deaths: t.u32(), assists: t.u32(), score: t.u32(),
  lastAttacker: t.i32(), corrections: t.u32(),
  weapon0: t.string(), weapon1: t.string(), reserve0: t.u16(), reserve1: t.u16(), money: t.u32(),
  /** Weapons bought this match and their attachments (JSON). */
  gearJson: t.string(),
});

/** One row per room (id = room), rewritten every tick: the packed binary snapshot from shared/match/frame.ts. */
const frameTable = table({ name: 'frame', public: true }, { id: t.u8().primaryKey(), mapId: t.string(), data: t.byteArray() });

const brainTable = table({ name: 'bot_brain' }, { id: t.u32().primaryKey(), json: t.string() });

const pointTable = table({ name: 'point', public: true }, {
  id: t.string().primaryKey(), progress: t.f32(), owner: t.i8(), contested: t.bool(), capturing: t.i8(),
});

const bodyTable = table({ name: 'body', public: true }, {
  id: t.u32().primaryKey(), kind: t.string(), x: t.f32(), y: t.f32(), z: t.f32(), vx: t.f32(), vy: t.f32(), vz: t.f32(),
  age: t.f32(), owner: t.i32(), team: t.i8(), hp: t.f32(), timer: t.f32(),
  room: t.u8().default(0),
});

const playerTable = table({ name: 'player', public: true }, {
  identity: t.identity().primaryKey(), soldierId: t.u32(), lastReportMicros: t.u64(),
  /** Chat rate limit: start of the current 10 s window and lines sent in it. */
  chatWindowMicros: t.u64().default(0n), chatCount: t.u32().default(0),
  room: t.u8().default(0),
});

/** Latest movement report per soldier, applied (and marked consumed) by the next tick. */
const inboxTable = table({ name: 'inbox' }, {
  soldierId: t.u32().primaryKey(), lastMicros: t.u64(), elapsed: t.f32(), pending: t.bool(),
  x: t.f32(), y: t.f32(), z: t.f32(), vx: t.f32(), vy: t.f32(), vz: t.f32(), yaw: t.f32(), pitch: t.f32(),
  crouch: t.f32(), grounded: t.bool(), sprint: t.bool(), ads: t.bool(), slide: t.bool(), weapon: t.u8(), use: t.bool(),
});

/** Queued shots, grenades, reloads, weapon switches and purchases, applied in order by the next tick. */
const commandTable = table({ name: 'command' }, { id: t.u64().primaryKey().autoInc(), soldierId: t.u32(), json: t.string() });

/** Legacy: the world-rewind ring from the physics-law era. Unused; kept so existing databases migrate in place. */
const historyTable = table({ name: 'history' }, { slot: t.u32().primaryKey(), json: t.string() });

const eventTable = table({ name: 'match_event', public: true, event: true }, { seq: t.u32(), json: t.string(), room: t.u8().default(0) });

/** Global id allocator for soldiers and bodies (ids must be unique across rooms). */
const counterTable = table({ name: 'counter' }, { id: t.u8().primaryKey(), nextId: t.u32() });

/** Career stats per identity (BeGone profile): the public leaderboard reads this. */
const profileTable = table({ name: 'profile', public: true }, {
  identity: t.identity().primaryKey(), name: t.string(),
  kills: t.u32(), deaths: t.u32(), assists: t.u32(), headshots: t.u32(),
  roundsWon: t.u32(), roundsPlayed: t.u32(), matchesWon: t.u32(), matchesPlayed: t.u32(),
});

/**
 * Drivable vehicles per room (key = room * 256 + the map spot's index), rewritten while they move.
 * Private: clients see vehicles in the packed frame.
 */
const vehicleTable = table({ name: 'vehicle' }, {
  key: t.u32().primaryKey(), room: t.u8().index('btree'), id: t.u8(), kind: t.string(),
  x: t.f32(), y: t.f32(), z: t.f32(), vx: t.f32(), vy: t.f32(), vz: t.f32(), yaw: t.f32(), pitch: t.f32(), roll: t.f32(),
  steer: t.f32(), rotor: t.f32(), grounded: t.bool(), health: t.f32(), driver: t.i32(), passenger: t.i32(), wrecked: t.bool(),
  slack: t.f32(), lastAttacker: t.i32(), lastRun: t.f64(),
});

/** Latest vehicle report per driver (like `inbox`), applied and marked consumed by the next tick. */
const vehicleInboxTable = table({ name: 'vehicle_inbox' }, {
  soldierId: t.u32().primaryKey(), vehicle: t.u8(), lastMicros: t.u64(), elapsed: t.f32(), pending: t.bool(),
  x: t.f32(), y: t.f32(), z: t.f32(), vx: t.f32(), vy: t.f32(), vz: t.f32(), yaw: t.f32(), pitch: t.f32(), roll: t.f32(),
  // Appended with defaults so existing databases migrate in place: where the driver aims (scooter riders shoot).
  aimYaw: t.f32().default(0), aimPitch: t.f32().default(0),
});

/**
 * Who has played, per identity (private: only the database owner reads it, with `spacetime sql`;
 * `scripts/players.ts` summarises it). A row is made when an identity first says `hello` or joins
 * a room; each later connection counts a session. The lobby's room-list connections have throwaway
 * identities that never join, so they are not counted. `tz` and `lang` are what the browser
 * reports (IANA zone, BCP 47 tag): rough "where from" without IP addresses. Per-connection
 * bookkeeping only; it never loads a match.
 */
const seenTable = table({ name: 'player_seen' }, {
  identity: t.identity().primaryKey(), firstSeen: t.timestamp(), lastSeen: t.timestamp(), sessions: t.u32(), tz: t.string(), lang: t.string(),
  /** The callsign of the latest join. */
  name: t.string(),
});

/** Days each player was active (key = identity hex + ':' + UTC day): the admin page's daily actives. Private. */
const dayTable = table({ name: 'player_day' }, { key: t.string().primaryKey(), day: t.u32().index('btree'), identity: t.identity() });

/**
 * Online play time per player (shared/playtime.ts): seconds spent in rooms, credited on leaving and
 * once a minute by each room's tick; `since` = start of the stretch not yet credited (epoch
 * microseconds, 0 = not in a room). Its own table so existing ones keep their columns. Private.
 */
const timeTable = table({ name: 'player_time' }, { identity: t.identity().primaryKey(), playSeconds: t.u64(), since: t.u64() });

/** Play time per player per UTC day (key = identity hex + ':' + day, like `player_day`): the admin page's daily play time. Private. */
const dayTimeTable = table({ name: 'player_day_time' }, { key: t.string().primaryKey(), day: t.u32().index('btree'), identity: t.identity(), seconds: t.u32() });

/**
 * Connection quality per player (shared/netstats.ts), from `net_stats` reports: the latest and the
 * typical (mean weighted by measured seconds) round-trip p50 and p95 in ms, the worst p95, the
 * server's movement corrections and the seconds in rooms they cover. Its own table so existing ones
 * keep their columns. Private.
 */
const netTable = table({ name: 'player_net' }, {
  identity: t.identity().primaryKey(), reports: t.u32(), lastP50: t.u16(), lastP95: t.u16(), avgP50: t.f32(), avgP95: t.f32(), worstP95: t.u16(),
  corrections: t.u32(), measuredSeconds: t.u32(), lastAt: t.timestamp(),
});

/** Connection quality per player per UTC day (key = identity hex + ':' + day): p50/p95 sums weighted by seconds, for the admin page's daily median. Private. */
const dayNetTable = table({ name: 'player_day_net' }, {
  key: t.string().primaryKey(), day: t.u32().index('btree'), identity: t.identity(),
  reports: t.u32(), seconds: t.u32(), p50Sum: t.f64(), p95Sum: t.f64(), corrections: t.u32(),
});

/**
 * What each player plays on (shared/devicekind.ts), from `device` reports (one per connection, after
 * `hello`): the latest kind ('phone', 'tablet' or 'desktop'), connections reported per kind and the
 * latest report. Its own table so existing ones keep their columns. Private.
 */
const deviceTable = table({ name: 'player_device' }, {
  identity: t.identity().primaryKey(), device: t.string(), phone: t.u32(), tablet: t.u32(), desktop: t.u32(), lastAt: t.timestamp(),
});

/**
 * Private rooms' codes. `match` is public (every lobby lists the rooms), so a code kept on it would
 * reach every client: rooms opened before this table keep `match.code` until their next tick moves
 * it here, and new rooms leave it ''. Private.
 */
const roomCodeTable = table({ name: 'room_code' }, { room: t.u8().primaryKey(), code: t.string().unique() });
/** Which rooms are private, without their codes: the lobby lists them as private and asks for the code. Public. */
const privateRoomTable = table({ name: 'private_room', public: true }, { room: t.u8().primaryKey() });

/** Identities logged in to the admin dashboard with the admin key (see admin.ts). Private. */
const adminTable = table({ name: 'admin' }, { identity: t.identity().primaryKey(), grantedAt: t.timestamp() });
/** Failed admin logins per identity in the current 10-minute window (the rate limit). Private. */
const adminAttemptTable = table({ name: 'admin_attempt' }, { identity: t.identity().primaryKey(), windowStart: t.timestamp(), failures: t.u32() });

const tickTable = table({ name: 'tick_schedule' }, { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(), room: t.u8().default(0) });

const spacetimedb = schema({
  match: matchTable, clock: clockTable, soldier: soldierTable, roster: rosterTable, frame: frameTable, botBrain: brainTable,
  point: pointTable, body: bodyTable, player: playerTable, inbox: inboxTable, command: commandTable, history: historyTable,
  matchEvent: eventTable, tickSchedule: tickTable, profile: profileTable, counter: counterTable,
  vehicle: vehicleTable, vehicleInbox: vehicleInboxTable, playerSeen: seenTable,
  playerDay: dayTable, admin: adminTable, adminAttempt: adminAttemptTable, playerTime: timeTable, playerDayTime: dayTimeTable,
  playerNet: netTable, playerDayNet: dayNetTable, playerDevice: deviceTable, roomCode: roomCodeTable, privateRoom: privateRoomTable,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type SoldierRow = Parameters<Ctx['db']['soldier']['insert']>[0];
type RosterRow = Parameters<Ctx['db']['roster']['insert']>[0];
type BodyRow = Parameters<Ctx['db']['body']['insert']>[0];
type MatchRow = Parameters<Ctx['db']['match']['insert']>[0];
type ClockRow = Parameters<Ctx['db']['clock']['insert']>[0];
type VehicleRow = Parameters<Ctx['db']['vehicle']['insert']>[0];
type RoundRow = Pick<MatchState, 'round' | 'roundPhase' | 'roundClock' | 'roundWinner' | 'lossStreak' | 'firstKill' | 'firstBlood' | 'lastKillTeam'> & { bomb: BombState };

type Command =
  | { kind: 'fire'; weapon: Slot; origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number }; target: number; zone: 'head' | 'body' | 'legs' | ''; point: { x: number; y: number; z: number } }
  | { kind: 'grenade'; origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } }
  | { kind: 'reload' }
  | { kind: 'switch'; slot: Slot }
  | { kind: 'buy'; item: BuyItem }
  | { kind: 'attach'; weapon: WeaponId; attachment: AttachmentId }
  | { kind: 'crate'; index: number }
  | { kind: 'vehicle'; enter: boolean; index: number }
  | { kind: 'team' };

/** Soldier state without a typed column of its own. */
interface Gear {
  owned: WeaponId[]; attachments: Partial<Record<WeaponId, Attachments>>; grenadeHE: boolean; stamina: number;
  assists: number; roundsHere: number; using: boolean; round: RoundStats;
}
const slotOf = (v: number): Slot => (v === 1 || v === 2 ? v : 0);

// ---- Row <-> state conversion ------------------------------------------------------------

function soldierFromRow(r: SoldierRow, brain?: BotBrain): Soldier {
  const gear: Partial<Gear> = r.gearJson ? JSON.parse(r.gearJson) : {};
  // Rows from before the BeGone roster carry other weapons: fall back to the defaults.
  const weapons: [WeaponId, WeaponId] = [weaponOr(r.weapon0, DEFAULT_WEAPONS[0]), weaponOr(r.weapon1, DEFAULT_WEAPONS[1])];
  return {
    id: r.id, name: r.name, team: r.team as Team, bot: r.bot,
    m: { x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz, grounded: r.grounded, crouch: r.crouch, slideTime: r.slideTime, slideCooldown: r.slideCooldown, airTime: r.airTime, prevCrouchInput: r.prevCrouch, prevJumpInput: r.prevJump },
    yaw: r.yaw, pitch: r.pitch, alive: r.alive, health: r.health, weapon: slotOf(r.weapon), weapons,
    owned: gear.owned?.filter(id => id in WEAPONS) ?? [...DEFAULT_WEAPONS],
    attachments: Object.fromEntries(Object.entries(gear.attachments ?? {}).map(([w, a]) => [w, normalizeAttachments(a)])),
    ammo: [r.ammo0, r.ammo1], reserve: [r.reserve0, r.reserve1],
    reloadLeft: r.reloadLeft, fireCooldown: r.fireCooldown, switchLeft: r.switchLeft, grenades: r.grenades, grenadeHE: gear.grenadeHE ?? false,
    stamina: gear.stamina ?? STAMINA.max, money: r.money,
    sinceHit: r.sinceHit, lastAttacker: r.lastAttacker, kills: r.kills, deaths: r.deaths, assists: gear.assists ?? 0, score: r.score,
    sprint: r.sprint, ads: r.ads, sinceShot: r.sinceShot, using: gear.using ?? false, corrections: r.corrections,
    moveSlack: r.moveSlack, groundY: r.groundY, idle: r.idle, round: gear.round ?? newRoundStats(), roundsHere: gear.roundsHere ?? 0, brain,
  };
}

const weaponOr = (id: string, fallback: WeaponId): WeaponId => (id in WEAPONS && id !== 'knife' ? id as WeaponId : fallback);
const u = (v: number, max = 0xffffffff) => Math.max(0, Math.min(max, Math.round(v)));
function soldierToRow(s: Soldier, room: number): SoldierRow {
  const m = s.m;
  const gear: Gear = {
    owned: s.owned, attachments: s.attachments, grenadeHE: s.grenadeHE, stamina: Math.round(s.stamina * 10) / 10,
    assists: s.assists, roundsHere: s.roundsHere, using: s.using, round: s.round,
  };
  return {
    // Legacy columns (kit, shield, respawn, spawn protection, captures, law cooldown, purchases) stay neutral.
    id: s.id, name: s.name, team: s.team, bot: s.bot, loadout: '',
    x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, yaw: s.yaw, pitch: s.pitch,
    crouch: m.crouch, grounded: m.grounded, slideTime: m.slideTime, slideCooldown: m.slideCooldown, airTime: Math.min(m.airTime, 60),
    prevCrouch: m.prevCrouchInput, prevJump: m.prevJumpInput,
    alive: s.alive, health: s.health, shield: 0, weapon: s.weapon, ammo0: u(s.ammo[0], 65535), ammo1: u(s.ammo[1], 65535),
    reloadLeft: s.reloadLeft, fireCooldown: s.fireCooldown, switchLeft: s.switchLeft, grenades: u(s.grenades, 255), respawnLeft: 0,
    protectLeft: 0, sinceHit: Math.min(s.sinceHit, 999), lastAttacker: s.lastAttacker, kills: u(s.kills), deaths: u(s.deaths),
    score: u(s.score), captures: 0, lawCooldown: 0, sprint: s.sprint, ads: s.ads, sinceShot: Math.min(s.sinceShot, 999),
    corrections: u(s.corrections), idle: Math.min(s.idle, 9999), moveSlack: s.moveSlack, groundY: s.groundY,
    weapon0: s.weapons[0], weapon1: s.weapons[1], reserve0: u(s.reserve[0], 65535), reserve1: u(s.reserve[1], 65535),
    money: u(s.money), bought0: '', bought1: '', sinceSpawn: 0, gearJson: JSON.stringify(gear), room,
  };
}

function rosterRow(s: Soldier, room: number): RosterRow {
  return {
    id: s.id, room, name: s.name, team: s.team, bot: s.bot, alive: s.alive, grenades: u(s.grenades, 255), grenadeHE: s.grenadeHE,
    kills: u(s.kills), deaths: u(s.deaths), assists: u(s.assists), score: u(s.score), lastAttacker: s.lastAttacker, corrections: u(s.corrections),
    weapon0: s.weapons[0], weapon1: s.weapons[1], reserve0: u(s.reserve[0], 65535), reserve1: u(s.reserve[1], 65535), money: u(s.money),
    gearJson: JSON.stringify({ owned: s.owned, attachments: s.attachments }),
  };
}
const rosterKey = (r: RosterRow) => JSON.stringify(r);

const bodyToRow = (b: Body, room: number): BodyRow => ({ id: b.id, kind: b.kind, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, age: Math.min(b.age, 9999), owner: b.owner, team: b.team, hp: b.hp, timer: b.timer, room });
const bodyFromRow = (r: BodyRow): Body => ({ id: r.id, kind: r.kind as Body['kind'], x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz, age: r.age, owner: r.owner, team: r.team, hp: r.hp, timer: r.timer });

const vehicleKey = (room: number, id: number) => room * 256 + id;
const vehicleToRow = (v: Vehicle, room: number): VehicleRow => ({
  key: vehicleKey(room, v.id), room, id: v.id, kind: v.kind, x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy, vz: v.vz,
  yaw: v.yaw, pitch: v.pitch, roll: v.roll, steer: v.steer, rotor: v.rotor, grounded: v.grounded, health: v.health,
  driver: v.driver, passenger: v.passenger, wrecked: v.wrecked, slack: v.slack, lastAttacker: v.lastAttacker, lastRun: v.lastRun,
});
const vehicleFromRow = (r: VehicleRow): Vehicle => ({
  id: r.id, kind: (VEHICLE_KINDS.includes(r.kind as VehicleKind) ? r.kind : 'car') as VehicleKind, x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz,
  yaw: r.yaw, pitch: r.pitch, roll: r.roll, steer: r.steer, rotor: r.rotor, grounded: r.grounded, health: r.health,
  driver: r.driver, passenger: r.passenger, wrecked: r.wrecked, slack: r.slack, lastAttacker: r.lastAttacker, lastRun: r.lastRun,
});

/** The broadcast part of the match row: only these fields trigger a row update. */
const slowKey = (r: MatchRow) => JSON.stringify([r.mapId, r.phase, r.score0, r.score1, r.winner, r.configJson, r.humans, r.code]);

interface Loaded {
  room: number;
  state: MatchState; row: MatchRow; clock: ClockRow; clockExists: boolean;
  soldierKeys: Map<number, string>; rosterKeys: Map<number, string>; bodyKeys: Map<number, string>; brainKeys: Map<number, string>;
  vehicleKeys: Map<number, string>;
}

function load(ctx: Ctx, room: number): Loaded {
  const row = ctx.db.match.id.find(room);
  if (!row) throw new SenderError('No such room');
  // Databases from before the clock table carry these fields in the match row.
  const existing = ctx.db.clock.id.find(room);
  const clock: ClockRow = existing ?? {
    id: room, phaseLeft: row.phaseLeft, time: row.time, tick: row.tick, nextId: row.nextId, lastTickMicros: row.lastTickMicros, roundJson: '',
  };
  const brainKeys = new Map<number, string>();
  const soldierKeys = new Map<number, string>(), rosterKeys = new Map<number, string>(), bodyKeys = new Map<number, string>();
  const soldiers: Soldier[] = [];
  for (const r of ctx.db.soldier.iter()) {
    if (r.room !== room) continue;
    const b = r.bot ? ctx.db.botBrain.id.find(r.id) : undefined;
    if (b) brainKeys.set(b.id, b.json);
    soldiers.push(soldierFromRow(r, b ? JSON.parse(b.json) : undefined)); soldierKeys.set(r.id, JSON.stringify(r));
  }
  soldiers.sort((a, b) => a.id - b.id);
  for (const r of ctx.db.roster.room.filter(room)) rosterKeys.set(r.id, rosterKey(r));
  const bodies: Body[] = [];
  for (const r of ctx.db.body.iter()) {
    if (r.room !== room) continue;
    bodyKeys.set(r.id, JSON.stringify(r));
    // Drones, charges, bolts and shards from before the rebuild are dropped on save.
    if (r.kind in BODY_RADIUS) bodies.push(bodyFromRow(r));
  }
  bodies.sort((a, b) => a.id - b.id);
  const vehicleKeys = new Map<number, string>();
  const vehicles: Vehicle[] = [];
  for (const r of ctx.db.vehicle.room.filter(room)) { vehicleKeys.set(r.key, JSON.stringify(r)); vehicles.push(vehicleFromRow(r)); }
  vehicles.sort((a, b) => a.id - b.id);
  const round: Partial<RoundRow> = clock.roundJson ? JSON.parse(clock.roundJson) : {};
  // A match from before rounds (Domination) restarts in warm-up with the BeGone rules; a room
  // opened just now has no clock yet and keeps its own settings.
  const legacy = existing ? !existing.roundJson : row.tick > 0;
  const state: MatchState = {
    mapId: row.mapId, phase: legacy ? 'warmup' : row.phase as MatchState['phase'], phaseLeft: legacy ? ONLINE_CONFIG.warmup : clock.phaseLeft,
    time: clock.time, tick: clock.tick,
    scores: legacy ? [0, 0] : [row.score0, row.score1], soldiers, bodies, vehicles, nextId: clock.nextId,
    winner: legacy ? -1 : row.winner as -1 | Team, config: legacy ? { ...ONLINE_CONFIG } : { ...ONLINE_CONFIG, ...JSON.parse(row.configJson) },
    round: round.round ?? 0, roundPhase: round.roundPhase ?? 'freeze', roundClock: round.roundClock ?? 0, roundWinner: round.roundWinner ?? -1,
    lossStreak: round.lossStreak ?? [0, 0], firstKill: round.firstKill ?? false, firstBlood: round.firstBlood ?? false,
    lastKillTeam: round.lastKillTeam ?? -1, bomb: round.bomb ?? { site: -1, armed: false, progress: 0, by: -1 },
  };
  return { room, state, row, clock: { ...clock }, clockExists: !!existing, soldierKeys, rosterKeys, bodyKeys, brainKeys, vehicleKeys };
}

function save(ctx: Ctx, loaded: Loaded, events: MatchEvent[], frame: boolean) {
  const { state, row, clock, room } = loaded;
  const round: RoundRow = {
    round: state.round, roundPhase: state.roundPhase, roundClock: state.roundClock, roundWinner: state.roundWinner, lossStreak: state.lossStreak,
    firstKill: state.firstKill, firstBlood: state.firstBlood, lastKillTeam: state.lastKillTeam, bomb: state.bomb,
  };
  Object.assign(clock, { phaseLeft: state.phaseLeft, time: state.time, tick: state.tick >>> 0, nextId: state.nextId, roundJson: JSON.stringify(round) });
  if (loaded.clockExists) ctx.db.clock.id.update(clock); else { ctx.db.clock.insert(clock); loaded.clockExists = true; }
  const humans = state.soldiers.filter(s => !s.bot).length;
  const next: MatchRow = {
    ...row, mapId: state.mapId, phase: state.phase, score0: u(state.scores[0]), score1: u(state.scores[1]), winner: state.winner, humans,
    configJson: JSON.stringify(state.config),
  };
  if (slowKey(next) !== slowKey(row)) {
    // Refresh the legacy per-tick columns too, so the row stays self-consistent when it is written.
    ctx.db.match.id.update({ ...next, phaseLeft: clock.phaseLeft, time: clock.time, tick: clock.tick, scoreTimer: 0, nextId: clock.nextId, lastTickMicros: clock.lastTickMicros });
  }
  const seen = new Set<number>();
  for (const s of state.soldiers) {
    seen.add(s.id);
    const nextRow = soldierToRow(s, room);
    const key = JSON.stringify(nextRow);
    const prev = loaded.soldierKeys.get(s.id);
    if (prev === undefined) ctx.db.soldier.insert(nextRow);
    else if (prev !== key) ctx.db.soldier.id.update(nextRow);
    const roster = rosterRow(s, room);
    const before = loaded.rosterKeys.get(s.id);
    if (before === undefined) ctx.db.roster.insert(roster);
    else if (before !== rosterKey(roster)) ctx.db.roster.id.update(roster);
    if (s.brain) {
      const json = JSON.stringify(s.brain);
      const prevBrain = loaded.brainKeys.get(s.id);
      if (prevBrain === undefined) ctx.db.botBrain.insert({ id: s.id, json });
      else if (prevBrain !== json) ctx.db.botBrain.id.update({ id: s.id, json });
    }
  }
  for (const id of loaded.soldierKeys.keys()) if (!seen.has(id)) ctx.db.soldier.id.delete(id);
  for (const id of loaded.rosterKeys.keys()) if (!seen.has(id)) ctx.db.roster.id.delete(id);
  for (const id of loaded.brainKeys.keys()) if (!seen.has(id)) ctx.db.botBrain.id.delete(id);
  const bodySeen = new Set<number>();
  for (const b of state.bodies) {
    bodySeen.add(b.id);
    const nextBody = bodyToRow(b, room);
    const prev = loaded.bodyKeys.get(b.id);
    if (prev === undefined) ctx.db.body.insert(nextBody);
    else if (prev !== JSON.stringify(nextBody)) ctx.db.body.id.update(nextBody);
  }
  for (const id of loaded.bodyKeys.keys()) if (!bodySeen.has(id)) ctx.db.body.id.delete(id);
  const vehicleSeen = new Set<number>();
  for (const v of state.vehicles) {
    const next = vehicleToRow(v, room);
    vehicleSeen.add(next.key);
    const prev = loaded.vehicleKeys.get(next.key);
    if (prev === undefined) ctx.db.vehicle.insert(next);
    else if (prev !== JSON.stringify(next)) ctx.db.vehicle.key.update(next);
  }
  for (const key of loaded.vehicleKeys.keys()) if (!vehicleSeen.has(key)) ctx.db.vehicle.key.delete(key);
  // Shots ride in the packed frame; everything else is a (rarer) JSON event.
  const shots = frame ? events.filter((e): e is Extract<MatchEvent, { type: 'shot' }> => e.type === 'shot') : [];
  let seq = 0;
  for (const e of events) if (!frame || e.type !== 'shot') ctx.db.matchEvent.insert({ seq: seq++, json: JSON.stringify(e), room });
  if (frame) {
    const data = encodeFrame(state, shots);
    if (ctx.db.frame.id.find(room)) ctx.db.frame.id.update({ id: room, mapId: state.mapId, data });
    else ctx.db.frame.insert({ id: room, mapId: state.mapId, data });
  }
}

/** Next free global id, shared by every room (soldiers and bodies). */
function takeIds(ctx: Ctx) {
  const row = ctx.db.counter.id.find(0);
  let next = row?.nextId ?? 1;
  if (!row) {
    // First use: start above every id already in use (older databases numbered per match).
    for (const r of ctx.db.soldier.iter()) next = Math.max(next, r.id + 1);
    for (const r of ctx.db.body.iter()) next = Math.max(next, r.id + 1);
    for (const r of ctx.db.clock.iter()) next = Math.max(next, r.nextId);
  }
  if (next > MAX_ID) next = 1;
  return next;
}
function storeIds(ctx: Ctx, next: number) {
  // Wrapping around: skip ids still held by long-lived soldiers or bodies.
  while (ctx.db.soldier.id.find(next) || ctx.db.body.id.find(next)) next++;
  if (ctx.db.counter.id.find(0)) ctx.db.counter.id.update({ id: 0, nextId: next }); else ctx.db.counter.insert({ id: 0, nextId: next });
}

/** Load a room's match, run `fn` against the shared rules, and persist the result atomically. */
function withMatch<T>(ctx: Ctx, room: number, fn: (state: MatchState, sim: SimContext, loaded: Loaded) => T, frame = false): T {
  const loaded = load(ctx, room);
  loaded.state.nextId = takeIds(ctx);
  const events: MatchEvent[] = [];
  const { def, world } = loadMap(loaded.state.mapId);
  const sim: SimContext = { map: def, world, nav: loadNav(loaded.state.mapId), random: () => ctx.random(), emit: e => events.push(e) };
  const result = fn(loaded.state, sim, loaded);
  save(ctx, loaded, events, frame);
  storeIds(ctx, loaded.state.nextId);
  recordStats(ctx, loaded.state, events);
  return result;
}

type ProfileRow = Parameters<Ctx['db']['profile']['insert']>[0];

/** Fold this tick's kills and round results into the humans' career stats. */
function recordStats(ctx: Ctx, state: MatchState, events: MatchEvent[]) {
  if (!events.some(e => e.type === 'kill' || e.type === 'round' || e.type === 'phase')) return;
  const owners = new Map<number, Identity>();
  for (const p of ctx.db.player.iter()) owners.set(p.soldierId, p.identity);
  const rows = new Map<number, ProfileRow>();
  const profile = (soldierId: number) => {
    const identity = owners.get(soldierId);
    if (!identity) return undefined;
    let row = rows.get(soldierId);
    if (!row) {
      const name = state.soldiers.find(s => s.id === soldierId)?.name ?? '';
      row = ctx.db.profile.identity.find(identity) ?? { identity, name, kills: 0, deaths: 0, assists: 0, headshots: 0, roundsWon: 0, roundsPlayed: 0, matchesWon: 0, matchesPlayed: 0 };
      row = { ...row, name: name || row.name };
      rows.set(soldierId, row);
    }
    return row;
  };
  for (const e of events) {
    if (e.type === 'kill') {
      const killer = e.killer !== e.victim ? profile(e.killer) : undefined;
      if (killer) { killer.kills++; if (e.head) killer.headshots++; }
      const victim = profile(e.victim);
      if (victim) victim.deaths++;
    } else if (e.type === 'reward' && e.reason === 'Assist') {
      const r = profile(e.id); if (r) r.assists++;
    } else if (e.type === 'round' && e.phase === 'over') {
      for (const s of state.soldiers) { const r = profile(s.id); if (r) { r.roundsPlayed++; if (s.team === e.winner) r.roundsWon++; } }
    } else if (e.type === 'phase' && e.phase === 'ended') {
      for (const s of state.soldiers) { const r = profile(s.id); if (r) { r.matchesPlayed++; if (s.team === e.winner) r.matchesWon++; } }
    }
  }
  for (const row of rows.values()) {
    if (ctx.db.profile.identity.find(row.identity)) ctx.db.profile.identity.update(row); else ctx.db.profile.insert(row);
  }
}

function mySoldier(ctx: Ctx) {
  const player = ctx.db.player.identity.find(ctx.sender);
  if (!player) throw new SenderError('Not joined');
  return player;
}

const micros = (ctx: Ctx) => ctx.timestamp.microsSinceUnixEpoch;

// ---- Rooms --------------------------------------------------------------------------------

const TICK_EVERY = () => ScheduleAt.interval(BigInt(Math.round(1_000_000 / TICK_RATE)));

/** Open a room (lowest free id) with its match, clock and tick schedule. */
function openRoom(ctx: Ctx, mapId: string, config: MatchConfig, code: string) {
  let room = -1;
  for (let id = 0; id <= MAX_ROOMS && room < 0; id++) if (!ctx.db.match.id.find(id)) room = id;
  if (room < 0) throw new SenderError('Every room is busy, try again shortly');
  const state = createMatch(mapId, config);
  ctx.db.match.insert({
    // The law columns are legacy (kept for in-place migration) and stay neutral.
    id: room, mapId, phase: state.phase, phaseLeft: state.phaseLeft, time: 0, worldTime: 0, tick: 0, score0: 0, score1: 0,
    scoreTimer: 0, lawsJson: '{}', lawAuthor: -1, lawText: '', lawLeft: -1, rewindLeft: 0, nextId: 0,
    droneTimer: 0, winner: -1, configJson: JSON.stringify(config), historyHead: 0, historyLength: 0,
    lastTickMicros: micros(ctx), humans: 0, code: '',
  });
  // A reused room id: no code from its last life.
  ctx.db.roomCode.room.delete(room); ctx.db.privateRoom.room.delete(room);
  if (code) { ctx.db.roomCode.insert({ room, code }); ctx.db.privateRoom.insert({ room }); }
  for (const t of [...ctx.db.tickSchedule.iter()]) if (t.room === room) ctx.db.tickSchedule.scheduledId.delete(t.scheduledId);
  ctx.db.tickSchedule.insert({ scheduledId: 0n, scheduledAt: TICK_EVERY(), room });
  return room;
}

/** Close a room: its match, soldiers, bodies, frame and tick all go; anyone still placed in it stops accruing play time. */
function closeRoom(ctx: Ctx, room: number) {
  const time = playStore(ctx), now = micros(ctx);
  for (const p of ctx.db.player.iter()) if (p.room === room) endPlay(time, p.identity, now);
  for (const t of [...ctx.db.tickSchedule.iter()]) if (t.room === room) ctx.db.tickSchedule.scheduledId.delete(t.scheduledId);
  for (const r of [...ctx.db.soldier.iter()]) {
    if (r.room !== room) continue;
    ctx.db.soldier.id.delete(r.id); ctx.db.botBrain.id.delete(r.id); ctx.db.inbox.soldierId.delete(r.id); ctx.db.vehicleInbox.soldierId.delete(r.id);
  }
  for (const r of [...ctx.db.vehicle.room.filter(room)]) ctx.db.vehicle.key.delete(r.key);
  for (const r of [...ctx.db.roster.room.filter(room)]) ctx.db.roster.id.delete(r.id);
  for (const r of [...ctx.db.body.iter()]) if (r.room === room) ctx.db.body.id.delete(r.id);
  ctx.db.frame.id.delete(room); ctx.db.clock.id.delete(room); ctx.db.match.id.delete(room);
  ctx.db.roomCode.room.delete(room); ctx.db.privateRoom.room.delete(room);
}

/** A room's private code ('' = public): `room_code`, or `match.code` for a room opened before it. */
const codeOf = (ctx: Ctx, row: { id: number; code: string }) => ctx.db.roomCode.room.find(row.id)?.code ?? row.code;

/** Move a room's code off the public `match` row (rooms opened before `room_code`; once per room). */
function hideCode(ctx: Ctx, row: MatchRow) {
  if (!ctx.db.roomCode.room.find(row.id)) ctx.db.roomCode.insert({ room: row.id, code: row.code });
  if (!ctx.db.privateRoom.room.find(row.id)) ctx.db.privateRoom.insert({ room: row.id });
  ctx.db.match.id.update({ ...row, code: '' });
}

const humansIn = (ctx: Ctx, room: number) => { let n = 0; for (const r of ctx.db.soldier.iter()) if (r.room === room && !r.bot) n++; return n; };
const configOf = (row: MatchRow): MatchConfig => ({ ...ONLINE_CONFIG, ...JSON.parse(row.configJson) });

/** Take a player out of their room (crediting their play time); an emptied room closes. */
function leaveRoom(ctx: Ctx, player: { identity: Identity; soldierId: number; room: number }) {
  endPlay(playStore(ctx), player.identity, micros(ctx));
  if (!ctx.db.match.id.find(player.room)) return;
  withMatch(ctx, player.room, (state, sim) => { removeSoldier(state, sim, player.soldierId); balanceTeams(state, sim); });
  if (humansIn(ctx, player.room) === 0) closeRoom(ctx, player.room);
}

/** Note that the caller is here now (made on first sight); `info` updates its time zone, language or callsign. */
function markSeen(ctx: Ctx, info: { tz?: string; lang?: string; name?: string } = {}) {
  const row = ctx.db.playerSeen.identity.find(ctx.sender);
  if (row) ctx.db.playerSeen.identity.update({ ...row, lastSeen: ctx.timestamp, ...info });
  else ctx.db.playerSeen.insert({ identity: ctx.sender, firstSeen: ctx.timestamp, lastSeen: ctx.timestamp, sessions: 1, tz: info.tz ?? '', lang: info.lang ?? '', name: info.name ?? '' });
  markDay(ctx);
}

/** `player_time` and `player_day_time` for the play-time rules in shared/playtime.ts. */
function playStore(ctx: Ctx): PlayStore<Identity> {
  return {
    get: identity => {
      const r = ctx.db.playerTime.identity.find(identity);
      return r ? { seconds: r.playSeconds, since: r.since } : undefined;
    },
    set: (identity, time) => {
      const row = { identity, playSeconds: time.seconds, since: time.since };
      if (ctx.db.playerTime.identity.find(identity)) ctx.db.playerTime.identity.update(row); else ctx.db.playerTime.insert(row);
    },
    addDay: (identity, day, seconds) => {
      const key = `${identity.toHexString()}:${day}`;
      const r = ctx.db.playerDayTime.key.find(key);
      if (r) ctx.db.playerDayTime.key.update({ ...r, seconds: r.seconds + seconds });
      else ctx.db.playerDayTime.insert({ key, day, identity, seconds });
    },
  };
}

/** One `player_day` row per player per UTC day they were active. */
function markDay(ctx: Ctx) {
  const day = dayOf(micros(ctx));
  const key = `${ctx.sender.toHexString()}:${day}`;
  if (!ctx.db.playerDay.key.find(key)) ctx.db.playerDay.insert({ key, day, identity: ctx.sender });
}

/** Put the caller into `room` (leaving any other room first). Every way in (quick_any, start_room, quick_play, quick_join, join, create_room, join_room, join_public) ends here. */
function enterRoom(ctx: Ctx, room: number, name: string, team: number) {
  const clean = name.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Operator';
  markSeen(ctx, { name: clean });
  const existing = ctx.db.player.identity.find(ctx.sender);
  if (existing && existing.room === room && ctx.db.soldier.id.find(existing.soldierId)) return;
  if (existing && ctx.db.soldier.id.find(existing.soldierId)) leaveRoom(ctx, existing);
  const row = ctx.db.match.id.find(room)!;
  if (humansIn(ctx, room) >= configOf(row).teamSize * 2) throw new SenderError('That room is full');
  withMatch(ctx, room, (state, sim) => {
    const soldier = addSoldier(state, sim, { name: clean, bot: false, team: team === 0 || team === 1 ? team : undefined });
    balanceTeams(state, sim);
    const player = { identity: ctx.sender, soldierId: soldier.id, lastReportMicros: micros(ctx), room };
    if (existing) ctx.db.player.identity.update({ ...existing, ...player });
    else ctx.db.player.insert({ ...player, chatWindowMicros: 0n, chatCount: 0 });
  });
  beginPlay(playStore(ctx), ctx.sender, micros(ctx));
}

/**
 * Play Online (and Quick Play, which is Play Online with any mode and any map): the fullest public
 * room of the filter's size whose current mode and map match ('' = any) with a free slot
 * (`pickRoom`), or a new public room with those rules. A new room keeps the map and mode that were
 * asked for from match to match; what was "any" rotates as Quick Play rooms always have. Like every
 * room reducer this only looks rooms up; the caller's own soldier is added the way joining always has.
 */
function matchmake(ctx: Ctx, name: string, filter: RoomFilter, team: number) {
  const error = filterError(filter);
  if (error) throw new SenderError(error);
  let room = pickRoom(publicRooms(ctx, filter.size), filter)?.room;
  if (room === undefined) room = openFor(ctx, filter);
  enterRoom(ctx, room, name, team);
}

/** Public rooms (of one size, or every size) as matchmaking sees them; our own seat does not count against the room we are in. */
function publicRooms(ctx: Ctx, size?: number): RoomView[] {
  const mine = ctx.db.player.identity.find(ctx.sender);
  const rooms: RoomView[] = [];
  for (const row of ctx.db.match.iter()) {
    if (codeOf(ctx, row) !== '') continue;
    const config = configOf(row);
    if (size !== undefined && config.teamSize !== size) continue;
    const humans = humansIn(ctx, row.id) - (mine?.room === row.id ? 1 : 0);
    rooms.push({ room: row.id, mapId: row.mapId, mode: config.mode, size: config.teamSize, humans, phase: row.phase, fixedMap: config.fixedMap, fixedMode: config.fixedMode });
  }
  return rooms;
}

/** A new public room for a filter: what it names is kept from match to match, what is "any" rotates. */
function openFor(ctx: Ctx, filter: RoomFilter) {
  const rules = newRoomRules(filter, () => ctx.random());
  const config: MatchConfig = { ...ONLINE_CONFIG, mode: rules.mode, teamSize: filter.size };
  // Only rooms opened for a specific map or mode carry the flags (older rooms simply rotate).
  if (rules.fixedMap) config.fixedMap = true;
  if (rules.fixedMode) config.fixedMode = true;
  return openRoom(ctx, rules.mapId, config, '');
}

/** A fresh private room code (not in use). */
function freshCode(ctx: Ctx) {
  let code = '';
  for (let i = 0; i < 20 && (!code || ctx.db.roomCode.code.find(code) || [...ctx.db.match.iter()].some(r => r.code === code)); i++) code = roomCode(() => ctx.random());
  return code;
}

// ---- Lifecycle ----------------------------------------------------------------------------

// Rooms open on demand (Quick Play, private rooms); nothing to set up at publish time.
export const init = spacetimedb.init(() => {});

/** A known player connecting again counts a session (unknown identities wait for `hello` or a join). */
export const onConnect = spacetimedb.clientConnected(ctx => {
  const row = ctx.db.playerSeen.identity.find(ctx.sender);
  if (!row) return;
  ctx.db.playerSeen.identity.update({ ...row, lastSeen: ctx.timestamp, sessions: row.sessions + 1 });
  markDay(ctx);
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const player = ctx.db.player.identity.find(ctx.sender);
  if (!player) return;
  ctx.db.player.identity.delete(ctx.sender);
  leaveRoom(ctx, player);
});

/** Apply every queued movement report and command, in arrival order, through the shared rules. */
function applyInputs(ctx: Ctx, state: MatchState, sim: SimContext) {
  const present = new Set(state.soldiers.map(s => s.id));
  for (const row of [...ctx.db.inbox.iter()]) {
    if (!present.has(row.soldierId)) { if (!ctx.db.soldier.id.find(row.soldierId)) ctx.db.inbox.soldierId.delete(row.soldierId); continue; }
    if (!row.pending) continue;
    reportState(state, sim, row.soldierId, {
      x: row.x, y: row.y, z: row.z, vx: row.vx, vy: row.vy, vz: row.vz, yaw: row.yaw, pitch: row.pitch, crouch: row.crouch,
      grounded: row.grounded, sprint: row.sprint, ads: row.ads, slide: row.slide, weapon: slotOf(row.weapon), use: row.use,
    }, row.elapsed);
    ctx.db.inbox.soldierId.update({ ...row, pending: false, elapsed: 0 });
  }
  for (const row of [...ctx.db.vehicleInbox.iter()]) {
    if (!present.has(row.soldierId)) { if (!ctx.db.soldier.id.find(row.soldierId)) ctx.db.vehicleInbox.soldierId.delete(row.soldierId); continue; }
    if (!row.pending) continue;
    reportVehicle(state, sim, row.soldierId, {
      vehicle: row.vehicle, x: row.x, y: row.y, z: row.z, vx: row.vx, vy: row.vy, vz: row.vz, yaw: row.yaw, pitch: row.pitch, roll: row.roll,
      aimYaw: row.aimYaw, aimPitch: row.aimPitch,
    }, row.elapsed);
    ctx.db.vehicleInbox.soldierId.update({ ...row, pending: false, elapsed: 0 });
  }
  const commands = [...ctx.db.command.iter()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const applied = new Map<number, number>();
  for (const c of commands) {
    // Other rooms' commands wait for their own tick; those of vanished soldiers are dropped.
    if (!present.has(c.soldierId)) { if (!ctx.db.soldier.id.find(c.soldierId)) ctx.db.command.id.delete(c.id); continue; }
    ctx.db.command.id.delete(c.id);
    const count = (applied.get(c.soldierId) ?? 0) + 1;
    applied.set(c.soldierId, count);
    if (count > COMMANDS_PER_TICK) continue;
    const cmd = JSON.parse(c.json) as Command;
    switch (cmd.kind) {
      case 'fire': fireShot(state, sim, c.soldierId, cmd); break;
      case 'grenade': throwGrenade(state, sim, c.soldierId, cmd.origin, cmd.dir); break;
      case 'reload': reload(state, c.soldierId); break;
      case 'switch': switchWeapon(state, c.soldierId, cmd.slot); break;
      case 'buy': buyItem(state, sim, c.soldierId, cmd.item); break;
      case 'attach': buyAttachmentFor(state, c.soldierId, cmd.weapon, cmd.attachment); break;
      case 'crate': useAmmoCrate(state, sim, c.soldierId, cmd.index); break;
      case 'vehicle': if (cmd.enter) getIn(state, sim, c.soldierId, cmd.index); else getOut(state, sim, c.soldierId); break;
      case 'team': switchTeam(state, sim, c.soldierId); break;
    }
  }
}

export const tick = spacetimedb.reducer({ onSchedule: tickTable }, { arg: tickTable.rowType }, (ctx, { arg }) => {
  const room = arg.room;
  let row = ctx.db.match.id.find(room);
  if (!row) { ctx.db.tickSchedule.scheduledId.delete(arg.scheduledId); return; }
  if (row.code) { hideCode(ctx, row); row = ctx.db.match.id.find(room)!; }
  const now = micros(ctx);
  const clock = ctx.db.clock.id.find(room);
  const last = clock?.lastTickMicros ?? row.lastTickMicros;
  const dt = Math.min(0.1, Math.max(0, Number(now - last) / 1_000_000));
  // A room without humans closes (its tick stops, so idle rooms cost nothing).
  if (humansIn(ctx, room) === 0) { closeRoom(ctx, room); return; }
  if (dt <= 0) return;
  withMatch(ctx, room, (state, sim, loaded) => {
    loaded.clock.lastTickMicros = now;
    // Once a wall-clock minute (not every tick): credit the play time of every human in this room.
    if (flushDue(last, now)) {
      const humans = new Set(state.soldiers.filter(s => !s.bot).map(s => s.id));
      const here: Identity[] = [];
      for (const p of ctx.db.player.iter()) if (p.room === room && humans.has(p.soldierId)) here.push(p.identity);
      flushPlay(playStore(ctx), here, now);
    }
    applyInputs(ctx, state, sim);
    if (state.phase === 'ended' && state.phaseLeft - dt <= 0) {
      // Public rooms rotate maps and modes between matches, except a map or mode they were opened
      // for (Play Online with a specific choice); private rooms replay the host's choice.
      if (!codeOf(ctx, row)) {
        const next = nextRoomRules(state.mapId, state.config.mode, state.config.teamSize, state.config);
        state.mapId = next.mapId;
        state.config = { ...state.config, mode: next.mode };
      }
      const { def, world } = loadMap(state.mapId);
      const nextSim = { ...sim, map: def, world, nav: loadNav(state.mapId) };
      resetMatch(state, nextSim);
      balanceTeams(state, nextSim);
      return;
    }
    tickMatch(state, sim, dt);
    // Drop players whose clients vanished without a disconnect.
    for (const s of [...state.soldiers]) {
      if (!s.bot && s.idle > 45) {
        // Their play time ends when they went quiet, not now.
        const quietSince = now - BigInt(Math.round(s.idle * 1_000_000));
        for (const p of [...ctx.db.player.iter()]) {
          if (p.soldierId !== s.id) continue;
          endPlay(playStore(ctx), p.identity, quietSince);
          ctx.db.player.identity.delete(p.identity);
        }
        removeSoldier(state, sim, s.id); balanceTeams(state, sim);
      }
    }
  }, true);
});

// ---- Player commands ----------------------------------------------------------------------

/** Older clients' join: Quick Play 6v6. */
export const join = spacetimedb.reducer({ name: t.string(), team: t.i8() }, (ctx, { name, team }) => { matchmake(ctx, name, { size: 6, mode: '', map: '' }, team); });

/** Quick Play (older clients): the fullest public room of this size (1, 6 or 24 per team) with a free slot. */
export const quickJoin = spacetimedb.reducer({ name: t.string(), size: t.u8(), team: t.i8() }, (ctx, { name, size, team }) => {
  matchmake(ctx, name, { size, mode: '', map: '' }, team);
});

/**
 * Play Online: the fullest public room of this size whose current mode and map match ('' = any),
 * or a new public room with those rules. Validated: a known size and mode, a map the size plays.
 */
export const quickPlay = spacetimedb.reducer({ name: t.string(), size: t.u8(), mode: t.string(), mapId: t.string(), team: t.i8() },
  (ctx, { name, size, mode, mapId, team }) => {
    if (!isRoomSize(size)) throw new SenderError('Unknown room size');
    if (mode !== '' && mode !== 'elimination' && mode !== 'sabotage') throw new SenderError('Unknown mode');
    matchmake(ctx, name, { size, mode, map: mapId }, team);
  });

/** Private room: the host picks size, mode, map and bots; friends join with the code. */
export const createRoom = spacetimedb.reducer({ name: t.string(), size: t.u8(), mode: t.string(), mapId: t.string(), bots: t.bool(), team: t.i8() },
  (ctx, { name, size, mode, mapId, bots, team }) => {
    if (!isRoomSize(size)) throw new SenderError('Unknown room size');
    if (mode !== 'elimination' && mode !== 'sabotage') throw new SenderError('Unknown mode');
    if (!mapsFor(size, mode).includes(mapId)) throw new SenderError('That map does not host this room');
    const room = openRoom(ctx, mapId, { ...ONLINE_CONFIG, mode, teamSize: size, noBots: !bots }, freshCode(ctx));
    enterRoom(ctx, room, name, team);
  });

/**
 * Quick Play: any public room with a free slot, any size, map or mode (`pickAnyRoom`: the fullest,
 * private and full rooms never), else a new public 6v6 room with bots on a random map and mode.
 */
export const quickAny = spacetimedb.reducer({ name: t.string(), team: t.i8() }, (ctx, { name, team }) => {
  let room = pickAnyRoom(publicRooms(ctx))?.room;
  if (room === undefined) room = openFor(ctx, QUICK_PLAY_NEW);
  enterRoom(ctx, room, name, team);
});

/**
 * Start a server: a new room with exactly these rules (validated like Play Online: a known size and
 * mode, a map the size and mode play). Public: listed, kept on its map and mode, and filled by
 * Quick Play and Play Online. Private: joined with its four-letter code. Bots off leaves empty slots empty.
 */
export const startRoom = spacetimedb.reducer({ name: t.string(), size: t.u8(), mode: t.string(), mapId: t.string(), bots: t.bool(), isPublic: t.bool(), team: t.i8() },
  (ctx, { name, size, mode, mapId, bots, isPublic, team }) => {
    const error = startRoomError({ size, mode, map: mapId });
    if (error) throw new SenderError(error);
    const room = openRoom(ctx, mapId, { ...ONLINE_CONFIG, ...startRoomConfig({ size, mode, map: mapId, bots, isPublic }) }, isPublic ? '' : freshCode(ctx));
    enterRoom(ctx, room, name, team);
  });

/** Join a private room by its code. */
export const joinRoom = spacetimedb.reducer({ name: t.string(), code: t.string(), team: t.i8() }, (ctx, { name, code, team }) => {
  const clean = cleanCode(code);
  const byCode = clean ? ctx.db.roomCode.code.find(clean) : undefined;
  const row = byCode ? ctx.db.match.id.find(byCode.room) : clean ? [...ctx.db.match.iter()].find(r => r.code === clean) : undefined;
  if (!row) throw new SenderError('No room with that code');
  enterRoom(ctx, row.id, name, team);
});

/** Join a public room picked from the lobby's room list (private rooms need their code). */
export const joinPublic = spacetimedb.reducer({ name: t.string(), room: t.u8(), team: t.i8() }, (ctx, { name, room, team }) => {
  const row = ctx.db.match.id.find(room);
  if (!row || codeOf(ctx, row) !== '') throw new SenderError('That room is gone; try Quick Play');
  enterRoom(ctx, room, name, team);
});

/** Sent once after connecting: the browser's time zone and language (cleaned and capped: tz 64, lang 16). */
export const hello = spacetimedb.reducer({ tz: t.string(), lang: t.string() }, (ctx, { tz, lang }) => { markSeen(ctx, cleanHello(tz, lang)); });

export const leave = spacetimedb.reducer({}, ctx => {
  const player = mySoldier(ctx);
  ctx.db.player.identity.delete(ctx.sender);
  leaveRoom(ctx, player);
});

/**
 * The client's connection quality since its previous report (shared/netstats.ts): round-trip p50 and
 * p95 in ms, the samples behind them, the server's corrections of its soldier and the seconds in a
 * room. Sent every 2 minutes in a match and on leaving. Validated and clamped (`acceptNetReport`):
 * one per identity per 30 s, only from identities in `player_seen`; anything else is ignored.
 * Per-identity bookkeeping only; it never loads a match.
 */
export const netStats = spacetimedb.reducer({ p50Ms: t.u32(), p95Ms: t.u32(), samples: t.u32(), corrections: t.u32(), seconds: t.u32() }, (ctx, report) => {
  if (!ctx.db.playerSeen.identity.find(ctx.sender)) return;
  const now = micros(ctx);
  const row = ctx.db.playerNet.identity.find(ctx.sender);
  const accepted = acceptNetReport(row ? { ...row, lastAt: row.lastAt.microsSinceUnixEpoch } : undefined, report, now);
  if (!accepted) return;
  const next = { identity: ctx.sender, ...accepted.record, lastAt: ctx.timestamp };
  if (row) ctx.db.playerNet.identity.update(next); else ctx.db.playerNet.insert(next);
  const day = dayOf(now), key = `${ctx.sender.toHexString()}:${day}`;
  const prevDay = ctx.db.playerDayNet.key.find(key);
  const folded = { key, day, identity: ctx.sender, ...foldNetDay(prevDay ?? undefined, accepted.report) };
  if (prevDay) ctx.db.playerDayNet.key.update(folded); else ctx.db.playerDayNet.insert(folded);
});

/**
 * What the client plays on: 'phone', 'tablet' or 'desktop' (shared/devicekind.ts), sent once per
 * connection right after `hello`. Only those three kinds, one report per identity per 30 s, only from
 * identities in `player_seen` (`acceptDevice`); anything else is ignored. Per-identity bookkeeping
 * only; it never loads a match.
 */
export const device = spacetimedb.reducer({ kind: t.string() }, (ctx, { kind }) => {
  if (!ctx.db.playerSeen.identity.find(ctx.sender)) return;
  const row = ctx.db.playerDevice.identity.find(ctx.sender);
  const next = acceptDevice(row ? { ...row, lastAt: row.lastAt.microsSinceUnixEpoch } : undefined, kind, micros(ctx));
  if (!next) return;
  const write = { identity: ctx.sender, ...next, lastAt: ctx.timestamp };
  if (row) ctx.db.playerDevice.identity.update(write); else ctx.db.playerDevice.insert(write);
});

/** Movement report: stored for the next tick (latest wins; elapsed time accumulates for the budget). */
export const report = spacetimedb.reducer({
  x: t.f32(), y: t.f32(), z: t.f32(), vx: t.f32(), vy: t.f32(), vz: t.f32(), yaw: t.f32(), pitch: t.f32(),
  crouch: t.f32(), grounded: t.bool(), sprint: t.bool(), ads: t.bool(), slide: t.bool(), weapon: t.u8(), use: t.bool(),
}, (ctx, r) => {
  const player = mySoldier(ctx);
  const now = micros(ctx);
  const prev = ctx.db.inbox.soldierId.find(player.soldierId);
  const since = Number(now - (prev?.lastMicros ?? player.lastReportMicros)) / 1_000_000;
  const next = { ...r, weapon: slotOf(r.weapon), soldierId: player.soldierId, lastMicros: now, elapsed: (prev?.pending ? prev.elapsed : 0) + Math.max(0, since), pending: true };
  if (prev) ctx.db.inbox.soldierId.update(next); else ctx.db.inbox.insert(next);
});

const queue = (ctx: Ctx, command: Command) => {
  const player = mySoldier(ctx);
  ctx.db.command.insert({ id: 0n, soldierId: player.soldierId, json: JSON.stringify(command) });
};

export const fire = spacetimedb.reducer({
  weapon: t.u8(), ox: t.f32(), oy: t.f32(), oz: t.f32(), dx: t.f32(), dy: t.f32(), dz: t.f32(),
  target: t.i32(), zone: t.string(), px: t.f32(), py: t.f32(), pz: t.f32(),
}, (ctx, a) => {
  const zone = a.zone === 'head' || a.zone === 'body' || a.zone === 'legs' ? a.zone : '';
  queue(ctx, { kind: 'fire', weapon: slotOf(a.weapon), origin: { x: a.ox, y: a.oy, z: a.oz }, dir: { x: a.dx, y: a.dy, z: a.dz }, target: a.target, zone, point: { x: a.px, y: a.py, z: a.pz } });
});

export const grenade = spacetimedb.reducer({ ox: t.f32(), oy: t.f32(), oz: t.f32(), dx: t.f32(), dy: t.f32(), dz: t.f32() }, (ctx, a) => {
  queue(ctx, { kind: 'grenade', origin: { x: a.ox, y: a.oy, z: a.oz }, dir: { x: a.dx, y: a.dy, z: a.dz } });
});

export const reloadWeapon = spacetimedb.reducer({}, ctx => { queue(ctx, { kind: 'reload' }); });

/** Change sides (the shared rules decide: only toward the side with fewer humans, between fights). */
export const changeTeam = spacetimedb.reducer({}, ctx => { queue(ctx, { kind: 'team' }); });

export const switchSlot = spacetimedb.reducer({ slot: t.u8() }, (ctx, { slot }) => { queue(ctx, { kind: 'switch', slot: slotOf(slot) }); });

/** Store purchase; validated by the next tick (buy time in base, cash). */
export const buy = spacetimedb.reducer({ item: t.string() }, (ctx, { item }) => {
  if (item !== 'grenade' && item !== 'highExplosive' && (!(item in WEAPONS) || item === 'knife')) throw new SenderError('Unknown item');
  queue(ctx, { kind: 'buy', item: item as BuyItem });
});

/** Attachment purchase for an owned weapon; validated by the next tick (fit, cash). */
export const buyAttachment = spacetimedb.reducer({ weapon: t.string(), attachment: t.string() }, (ctx, { weapon, attachment }) => {
  if (!(weapon in WEAPONS) || !(attachment in ATTACHMENTS)) throw new SenderError('Unknown attachment');
  queue(ctx, { kind: 'attach', weapon: weapon as WeaponId, attachment: attachment as AttachmentId });
});

/** Use an ammo crate (E); validated by the next tick (reach, cash). */
export const useCrate = spacetimedb.reducer({ index: t.u32() }, (ctx, { index }) => { queue(ctx, { kind: 'crate', index }); });

/** E beside a vehicle: get in (driver's seat, or a teammate's passenger seat); validated by the next tick (reach, seats). */
export const enterVehicle = spacetimedb.reducer({ index: t.u8() }, (ctx, { index }) => { queue(ctx, { kind: 'vehicle', enter: true, index }); });

/** E in a vehicle: get out beside it. */
export const exitVehicle = spacetimedb.reducer({}, ctx => { queue(ctx, { kind: 'vehicle', enter: false, index: 0 }); });

/**
 * The driver's vehicle report and where it aims (a scooter rider shoots while riding): stored for
 * the next tick (latest wins; elapsed time accumulates for the budget).
 */
export const vehicleReport = spacetimedb.reducer({
  vehicle: t.u8(), x: t.f32(), y: t.f32(), z: t.f32(), vx: t.f32(), vy: t.f32(), vz: t.f32(), yaw: t.f32(), pitch: t.f32(), roll: t.f32(),
  aimYaw: t.f32(), aimPitch: t.f32(),
}, (ctx, r) => {
  const player = mySoldier(ctx);
  const now = micros(ctx);
  const prev = ctx.db.vehicleInbox.soldierId.find(player.soldierId);
  const since = prev ? Number(now - prev.lastMicros) / 1_000_000 : 0.05;
  const next = { ...r, soldierId: player.soldierId, lastMicros: now, elapsed: (prev?.pending ? prev.elapsed : 0) + Math.max(0, since), pending: true };
  if (prev) ctx.db.vehicleInbox.soldierId.update(next); else ctx.db.vehicleInbox.insert(next);
});

/** Chat (Enter for everyone, T for the team). Rate-limited; clients filter team lines. */
export const say = spacetimedb.reducer({ text: t.string(), team: t.bool() }, (ctx, { text, team }) => {
  const player = mySoldier(ctx);
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  if (!clean) return;
  const now = micros(ctx);
  const fresh = now - player.chatWindowMicros > 10_000_000n;
  const count = fresh ? 1 : player.chatCount + 1;
  if (count > CHAT_BURST) throw new SenderError('Slow down');
  ctx.db.player.identity.update({ ...player, chatWindowMicros: fresh ? now : player.chatWindowMicros, chatCount: count });
  const soldier = ctx.db.soldier.id.find(player.soldierId);
  if (!soldier) return;
  const event: MatchEvent = { type: 'chat', id: soldier.id, name: soldier.name, team: soldier.team as Team, text: clean, teamOnly: team };
  ctx.db.matchEvent.insert({ seq: 0, json: JSON.stringify(event), room: player.room });
});

// ---- Admin dashboard ----------------------------------------------------------------------
// The owner logs in with the admin key (hashed and compared in the module, see admin.ts); the views
// below return rows only to identities in `admin`, nothing to anyone else. Read-only views of slow
// tables (no soldier, frame or clock reads), evaluated only for their subscribers.

function adminStore(ctx: Ctx): AdminStore {
  const id = (hex: string) => Identity.fromString(hex);
  return {
    isAdmin: hex => !!ctx.db.admin.identity.find(id(hex)),
    grant: hex => { if (!ctx.db.admin.identity.find(id(hex))) ctx.db.admin.insert({ identity: id(hex), grantedAt: ctx.timestamp }); },
    revoke: hex => { ctx.db.admin.identity.delete(id(hex)); },
    revokeAll: () => { for (const r of [...ctx.db.admin.iter()]) ctx.db.admin.identity.delete(r.identity); },
    attempts: hex => {
      const r = ctx.db.adminAttempt.identity.find(id(hex));
      return r ? { windowStart: r.windowStart.microsSinceUnixEpoch, failures: r.failures } : undefined;
    },
    setAttempts: (hex, a) => {
      const identity = id(hex);
      if (!a) { ctx.db.adminAttempt.identity.delete(identity); return; }
      const row = { identity, windowStart: new Timestamp(a.windowStart), failures: a.failures };
      if (ctx.db.adminAttempt.identity.find(identity)) ctx.db.adminAttempt.identity.update(row); else ctx.db.adminAttempt.insert(row);
    },
  };
}
const asSender = (e: unknown): never => { throw e instanceof AdminError ? new SenderError(e.message) : e; };

/**
 * Log in to the admin dashboard with the admin key. A wrong key returns normally (so its failure
 * is recorded; a thrown error would roll it back) and the caller's `admin_status` shows it; after
 * five failures in ten minutes every attempt is refused with an error until the window passes.
 */
export const adminLogin = spacetimedb.reducer({ key: t.string() }, (ctx, { key }) => {
  try { Admin.adminLogin(adminStore(ctx), ctx.sender.toHexString(), key, micros(ctx)); } catch (e) { asSender(e); }
});

/** Leave the admin dashboard (this identity only). */
export const adminLogout = spacetimedb.reducer({}, ctx => { Admin.adminLogout(adminStore(ctx), ctx.sender.toHexString()); });

/** Sign out every admin session (after rotating the key, or a lost device). Admins only. */
export const adminRevokeAll = spacetimedb.reducer({}, ctx => {
  try { Admin.adminRevokeAll(adminStore(ctx), ctx.sender.toHexString()); } catch (e) { asSender(e); }
});

/** The admin check of a view (read-only): is this identity in `admin`? */
const viewAdmins = (db: { admin: { identity: { find(id: Identity): unknown } } }) => ({ isAdmin: (hex: string) => !!db.admin.identity.find(Identity.fromString(hex)) });

/** The caller's own login state: admin or not, and failed attempts in the current window. */
export const adminStatus = spacetimedb.view({ name: 'admin_status', public: true },
  t.array(t.row('AdminStatusRow', { admin: t.bool(), failures: t.u32(), windowStart: t.timestamp() })),
  ctx => {
    const attempt = ctx.db.adminAttempt.identity.find(ctx.sender);
    return [{ admin: !!ctx.db.admin.identity.find(ctx.sender), failures: attempt?.failures ?? 0, windowStart: attempt?.windowStart ?? Timestamp.UNIX_EPOCH }];
  });

/** Totals: online now (players in rooms), rooms, players ever, career numbers. */
export const adminOverview = spacetimedb.view({ name: 'admin_overview', public: true },
  t.array(t.row('AdminOverviewRow', {
    onlineNow: t.u32(), rooms: t.u32(), humansInRooms: t.u32(), totalPlayers: t.u32(), profiles: t.u32(),
    playerMatches: t.u32(), roundsPlayed: t.u32(), kills: t.u32(), admins: t.u32(),
  })),
  ctx => forAdmin(viewAdmins(ctx.db), ctx.sender.toHexString(), () => {
    let rooms = 0, humans = 0, profiles = 0, playerMatches = 0, roundsPlayed = 0, kills = 0;
    for (const m of ctx.db.match.iter()) { rooms++; humans += m.humans; }
    for (const p of ctx.db.profile.iter()) { profiles++; playerMatches += p.matchesPlayed; roundsPlayed += p.roundsPlayed; kills += p.kills; }
    return [{
      onlineNow: Number(ctx.db.player.count()), rooms, humansInRooms: humans, totalPlayers: Number(ctx.db.playerSeen.count()), profiles,
      playerMatches, roundsPlayed, kills, admins: Number(ctx.db.admin.count()),
    }];
  }));

/** Live rooms: map, mode, size, humans, bots, round and phase (code '' = public). */
export const adminRooms = spacetimedb.view({ name: 'admin_rooms', public: true },
  t.array(t.row('AdminRoomRow', {
    room: t.u8(), code: t.string(), mapId: t.string(), mode: t.string(), size: t.u8(), humans: t.u32(), bots: t.u32(), round: t.u32(), phase: t.string(),
  })),
  ctx => forAdmin(viewAdmins(ctx.db), ctx.sender.toHexString(), () => [...ctx.db.match.iter()].map(m => {
    let config: { mode?: string; teamSize?: number } = {};
    try { config = JSON.parse(m.configJson); } catch { /* listed with defaults */ }
    let bots = 0;
    for (const r of ctx.db.roster.room.filter(m.id)) if (r.bot) bots++;
    return { room: m.id, code: ctx.db.roomCode.room.find(m.id)?.code ?? m.code, mapId: m.mapId, mode: config.mode ?? 'elimination', size: config.teamSize ?? 6, humans: m.humans, bots, round: m.score0 + m.score1 + 1, phase: m.phase };
  })));

/** The code of the private room the caller plays in (no row otherwise): the in-game line the host shares it from. */
export const myRoomCode = spacetimedb.view({ name: 'my_room_code', public: true },
  t.array(t.row('MyRoomCodeRow', { room: t.u8(), code: t.string() })),
  ctx => {
    const me = ctx.db.player.identity.find(ctx.sender);
    const code = me ? ctx.db.roomCode.room.find(me.room) : undefined;
    return me && code ? [{ room: me.room, code: code.code }] : [];
  });

/** Every player seen, by an anonymous short id (never the identity), with career numbers; newest activity first. */
export const adminPlayers = spacetimedb.view({ name: 'admin_players', public: true },
  t.array(t.row('AdminPlayerRow', {
    id: t.string(), name: t.string(), firstSeen: t.timestamp(), lastSeen: t.timestamp(), sessions: t.u32(), tz: t.string(), lang: t.string(),
    matches: t.u32(), kills: t.u32(),
  })),
  ctx => forAdmin(viewAdmins(ctx.db), ctx.sender.toHexString(), () => {
    const seen = [...ctx.db.playerSeen.iter()].map(s => ({ ...s, identity: s.identity.toHexString(), firstSeen: s.firstSeen.microsSinceUnixEpoch, lastSeen: s.lastSeen.microsSinceUnixEpoch }));
    const profiles = [...ctx.db.profile.iter()].map(p => ({ ...p, identity: p.identity.toHexString() }));
    return playerRows(seen, profiles).map(r => ({ ...r, firstSeen: new Timestamp(r.firstSeen), lastSeen: new Timestamp(r.lastSeen) }));
  }));

/** New and active players per UTC day, the 30 days up to the latest activity. */
export const adminDaily = spacetimedb.view({ name: 'admin_daily', public: true },
  t.array(t.row('AdminDayRow', { day: t.u32(), date: t.string(), newPlayers: t.u32(), activePlayers: t.u32() })),
  ctx => forAdmin(viewAdmins(ctx.db), ctx.sender.toHexString(), () => {
    const seen = [...ctx.db.playerSeen.iter()].map(s => ({ identity: '', firstSeen: s.firstSeen.microsSinceUnixEpoch, lastSeen: s.lastSeen.microsSinceUnixEpoch, sessions: 0, tz: '', lang: '' }));
    return dailyRows(seen, day => [...ctx.db.playerDay.day.filter(day)].length);
  }));

// Play time has views of its own: changing an existing view's columns would disconnect every client
// on publish, so the views above keep theirs and the page joins these to `admin_players` by id.

/**
 * Per player (same short id as `admin_players`): rounds played (from `profile`), online play time
 * credited so far, and `playingSince`, the start of the stretch not yet credited (the epoch when not
 * in a room), so the page can count a session in progress.
 */
export const adminPlayerTime = spacetimedb.view({ name: 'admin_player_time', public: true },
  t.array(t.row('AdminPlayerTimeRow', { id: t.string(), rounds: t.u32(), playSeconds: t.u64(), playingSince: t.timestamp() })),
  ctx => forAdmin(viewAdmins(ctx.db), ctx.sender.toHexString(), () => {
    const ids = [...ctx.db.playerSeen.iter()].map(s => s.identity.toHexString());
    const profiles = [...ctx.db.profile.iter()].map(p => ({ identity: p.identity.toHexString(), roundsPlayed: p.roundsPlayed }));
    const times = [...ctx.db.playerTime.iter()].map(p => ({ identity: p.identity.toHexString(), seconds: p.playSeconds, since: p.since }));
    return playTimeRows(ids, profiles, times).map(r => ({ ...r, playingSince: new Timestamp(r.playingSince) }));
  }));

/** Online play time (credited seconds, all players) per UTC day, the 30 days up to the latest activity. */
export const adminDailyTime = spacetimedb.view({ name: 'admin_daily_time', public: true },
  t.array(t.row('AdminDayTimeRow', { day: t.u32(), date: t.string(), playSeconds: t.u64() })),
  ctx => forAdmin(viewAdmins(ctx.db), ctx.sender.toHexString(), () => {
    const playOn = (day: number) => { let n = 0n; for (const r of ctx.db.playerDayTime.day.filter(day)) n += BigInt(r.seconds); return n; };
    let last = -1;
    for (const s of ctx.db.playerSeen.iter()) last = Math.max(last, dayOf(s.lastSeen.microsSinceUnixEpoch));
    // A session running past midnight credits a day after anyone's last sighting.
    for (let d = last + 1, end = last + 3; last >= 0 && d <= end; d++) if (playOn(d) > 0n) last = d;
    return dailyTimeRows(last, playOn);
  }));

// Connection quality has views of its own too (joined to `admin_players` by id on the page).

/**
 * Per player who has reported (same short id as `admin_players`): typical ping p50 and p95 in ms
 * (means weighted by measured time), the worst p95 reported, corrections per minute in rooms, the
 * minutes measured and the latest report.
 */
export const adminPlayerNet = spacetimedb.view({ name: 'admin_player_net', public: true },
  t.array(t.row('AdminPlayerNetRow', {
    id: t.string(), pingP50: t.u16(), pingP95: t.u16(), worstP95: t.u16(), correctionsPerMin: t.f32(), measuredMinutes: t.f32(), lastAt: t.timestamp(),
  })),
  ctx => forAdmin(viewAdmins(ctx.db), ctx.sender.toHexString(), () => {
    const rows = [...ctx.db.playerNet.iter()].map(r => ({ ...r, identity: r.identity.toHexString(), lastAt: r.lastAt.microsSinceUnixEpoch }));
    return playerNetRows(rows).map(r => ({ ...r, lastAt: new Timestamp(r.lastAt) }));
  }));

/** Connection quality per UTC day, the 30 days up to the latest report: players, median p50 and p95, corrections per minute. */
export const adminDailyNet = spacetimedb.view({ name: 'admin_daily_net', public: true },
  t.array(t.row('AdminDayNetRow', { day: t.u32(), date: t.string(), players: t.u32(), medianP50: t.u16(), medianP95: t.u16(), correctionsPerMin: t.f32() })),
  ctx => forAdmin(viewAdmins(ctx.db), ctx.sender.toHexString(), () => {
    let last = -1;
    for (const r of ctx.db.playerNet.iter()) last = Math.max(last, dayOf(r.lastAt.microsSinceUnixEpoch));
    return dailyNetRows(last, day => ctx.db.playerDayNet.day.filter(day));
  }));

// What players play on has a view of its own too (joined to `admin_players` by id on the page).

/** Per player who has reported a device (same short id as `admin_players`): the latest kind, connections per kind, the latest report. */
export const adminPlayerDevice = spacetimedb.view({ name: 'admin_player_device', public: true },
  t.array(t.row('AdminPlayerDeviceRow', { id: t.string(), device: t.string(), phone: t.u32(), tablet: t.u32(), desktop: t.u32(), lastAt: t.timestamp() })),
  ctx => forAdmin(viewAdmins(ctx.db), ctx.sender.toHexString(), () => {
    const rows = [...ctx.db.playerDevice.iter()].map(r => ({ ...r, identity: r.identity.toHexString(), lastAt: r.lastAt.microsSinceUnixEpoch }));
    return playerDeviceRows(rows).map(r => ({ ...r, lastAt: new Timestamp(r.lastAt) }));
  }));
