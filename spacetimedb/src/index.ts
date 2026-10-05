import { ScheduleAt } from 'spacetimedb';
import { schema, table, t, SenderError, type ReducerCtx, type InferSchema } from 'spacetimedb/server';
import { MAP_IDS, loadMap, loadNav } from '../../shared/maps/index';
import type { SimContext } from '../../shared/match/combat';
import { encodeFrame } from '../../shared/match/frame';
import {
  addSoldier, balanceTeams, buyItem, createMatch, pickUp, fireShot, reload, removeSoldier, reportState, resetMatch,
  setLoadout, switchWeapon, teamSizeFor, throwGrenade, tickMatch, TICK_RATE,
} from '../../shared/match/sim';
import { ONLINE_CONFIG, type BotBrain, type MatchEvent, type MatchState, type PointState, type Soldier, type Team } from '../../shared/match/state';
import { LOADOUTS, WEAPONS, type LoadoutId, type WeaponId } from '../../shared/weapons';
import { kitWeapons, type BuyItem } from '../../shared/match/economy';
import { BODY_RADIUS, type Body } from '../../shared/world';

/**
 * Authoritative multiplayer: the same shared match simulation the offline client runs, executed
 * here on a 30 Hz scheduled reducer. Player reducers only queue their input (a cheap private-row
 * write); the tick loads the match once, applies every queued report and command through the
 * shared validation rules, simulates, and publishes one packed `frame` row plus the slow-changing
 * `roster` rows. That keeps a 100-soldier match to one load/save per tick and one small row
 * update per client per tick.
 */
const START_MAP = 'meridian';
/** Queued commands one soldier may have applied per tick; anything beyond is spam. */
const COMMANDS_PER_TICK = 24;

// ---- Tables -------------------------------------------------------------------------------
// `match`, `soldier`, `point`, `body`, `player` and `history` keep their original columns so existing
// databases migrate in place. Clients now read `match` (slow fields), `roster`, `frame` and their
// own `player` row; `soldier`, `point` and `body` hold full-precision server state.

const matchTable = table({ name: 'match', public: true }, {
  id: t.u8().primaryKey(),
  mapId: t.string(), phase: t.string(), phaseLeft: t.f64(), time: t.f64(), worldTime: t.f64(), tick: t.u32(),
  score0: t.u32(), score1: t.u32(), scoreTimer: t.f64(),
  // Legacy physics-law columns (lawsJson … rewindLeft, droneTimer, history*): written neutral, kept for in-place migration.
  lawsJson: t.string(), lawAuthor: t.i32(), lawText: t.string(), lawLeft: t.f64(), rewindLeft: t.u32(),
  nextId: t.u32(), droneTimer: t.f64(), winner: t.i8(), configJson: t.string(),
  historyHead: t.u32(), historyLength: t.u32(), lastTickMicros: t.u64(), humans: t.u32(),
});

/** Per-tick server bookkeeping, kept out of the public match row so it is not broadcast 30×/s. */
const clockTable = table({ name: 'clock' }, {
  id: t.u8().primaryKey(),
  phaseLeft: t.f64(), time: t.f64(), tick: t.u32(), scoreTimer: t.f64(), nextId: t.u32(), lastTickMicros: t.u64(),
  pickupsJson: t.string(),
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
});

/** What other players need about a soldier, rewritten only when it changes (not every tick). */
const rosterTable = table({ name: 'roster', public: true }, {
  id: t.u32().primaryKey(), name: t.string(), team: t.u8(), bot: t.bool(), loadout: t.string(), alive: t.bool(),
  grenades: t.u8(), kills: t.u32(), deaths: t.u32(), score: t.u32(), captures: t.u32(),
  /** Match time (`frame.time`) at which the soldier respawns. */
  respawnAt: t.f32(),
  protect: t.bool(), lastAttacker: t.i32(), corrections: t.u32(),
  weapon0: t.string(), weapon1: t.string(), reserve0: t.u16(), reserve1: t.u16(), money: t.u32(),
});

/** One row, rewritten every tick: the packed binary snapshot from shared/match/frame.ts. */
const frameTable = table({ name: 'frame', public: true }, { id: t.u8().primaryKey(), mapId: t.string(), data: t.byteArray() });

const brainTable = table({ name: 'bot_brain' }, { id: t.u32().primaryKey(), json: t.string() });

const pointTable = table({ name: 'point', public: true }, {
  id: t.string().primaryKey(), progress: t.f32(), owner: t.i8(), contested: t.bool(), capturing: t.i8(),
});

const bodyTable = table({ name: 'body', public: true }, {
  id: t.u32().primaryKey(), kind: t.string(), x: t.f32(), y: t.f32(), z: t.f32(), vx: t.f32(), vy: t.f32(), vz: t.f32(),
  age: t.f32(), owner: t.i32(), team: t.i8(), hp: t.f32(), timer: t.f32(),
});

const playerTable = table({ name: 'player', public: true }, {
  identity: t.identity().primaryKey(), soldierId: t.u32(), lastReportMicros: t.u64(),
});

/** Latest movement report per soldier, applied (and marked consumed) by the next tick. */
const inboxTable = table({ name: 'inbox' }, {
  soldierId: t.u32().primaryKey(), lastMicros: t.u64(), elapsed: t.f32(), pending: t.bool(),
  x: t.f32(), y: t.f32(), z: t.f32(), vx: t.f32(), vy: t.f32(), vz: t.f32(), yaw: t.f32(), pitch: t.f32(),
  crouch: t.f32(), grounded: t.bool(), sprint: t.bool(), ads: t.bool(), slide: t.bool(), weapon: t.u8(),
});

/** Queued shots, grenades, reloads, weapon and kit switches, applied in order by the next tick. */
const commandTable = table({ name: 'command' }, { id: t.u64().primaryKey().autoInc(), soldierId: t.u32(), json: t.string() });

/** Legacy: the world-rewind ring from the physics-law era. Unused; kept so existing databases migrate in place. */
const historyTable = table({ name: 'history' }, { slot: t.u32().primaryKey(), json: t.string() });

const eventTable = table({ name: 'match_event', public: true, event: true }, { seq: t.u32(), json: t.string() });

const tickTable = table({ name: 'tick_schedule' }, { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() });

const spacetimedb = schema({
  match: matchTable, clock: clockTable, soldier: soldierTable, roster: rosterTable, frame: frameTable, botBrain: brainTable,
  point: pointTable, body: bodyTable, player: playerTable, inbox: inboxTable, command: commandTable, history: historyTable,
  matchEvent: eventTable, tickSchedule: tickTable,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type SoldierRow = Parameters<Ctx['db']['soldier']['insert']>[0];
type RosterRow = Parameters<Ctx['db']['roster']['insert']>[0];
type BodyRow = Parameters<Ctx['db']['body']['insert']>[0];
type MatchRow = Parameters<Ctx['db']['match']['insert']>[0];
type ClockRow = Parameters<Ctx['db']['clock']['insert']>[0];

type Command =
  | { kind: 'fire'; weapon: 0 | 1; origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number }; target: number; zone: 'head' | 'body' | 'legs' | ''; point: { x: number; y: number; z: number } }
  | { kind: 'grenade'; origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } }
  | { kind: 'reload' }
  | { kind: 'switch'; slot: 0 | 1 }
  | { kind: 'loadout'; loadout: LoadoutId }
  | { kind: 'buy'; item: BuyItem }
  | { kind: 'pickup'; index: number };

// ---- Row <-> state conversion ------------------------------------------------------------

function soldierFromRow(r: SoldierRow, brain?: BotBrain): Soldier {
  return {
    id: r.id, name: r.name, team: r.team as Team, bot: r.bot, loadout: r.loadout as LoadoutId,
    m: { x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz, grounded: r.grounded, crouch: r.crouch, slideTime: r.slideTime, slideCooldown: r.slideCooldown, airTime: r.airTime, prevCrouchInput: r.prevCrouch, prevJumpInput: r.prevJump },
    yaw: r.yaw, pitch: r.pitch, alive: r.alive, health: r.health, shield: r.shield, weapon: r.weapon as 0 | 1, ammo: [r.ammo0, r.ammo1],
    reloadLeft: r.reloadLeft, fireCooldown: r.fireCooldown, switchLeft: r.switchLeft, grenades: r.grenades, respawnLeft: r.respawnLeft,
    protectLeft: r.protectLeft, sinceHit: r.sinceHit, lastAttacker: r.lastAttacker, kills: r.kills, deaths: r.deaths, score: r.score,
    captures: r.captures, sprint: r.sprint, ads: r.ads, sinceShot: r.sinceShot, corrections: r.corrections,
    idle: r.idle, moveSlack: r.moveSlack, groundY: r.groundY, brain,
    // Rows from before the economy carry no weapons: fall back to the kit.
    weapons: [weaponOr(r.weapon0, kitWeapons(r.loadout as LoadoutId)[0]), weaponOr(r.weapon1, kitWeapons(r.loadout as LoadoutId)[1])],
    reserve: [r.reserve0, r.reserve1], money: r.money, bought: [weaponOr(r.bought0, ''), weaponOr(r.bought1, '')], sinceSpawn: r.sinceSpawn,
  };
}

const weaponOr = <T extends string>(id: string, fallback: T): WeaponId | T => (id in WEAPONS ? id as WeaponId : fallback);
const u = (v: number, max = 0xffffffff) => Math.max(0, Math.min(max, Math.round(v)));
function soldierToRow(s: Soldier): SoldierRow {
  const m = s.m;
  return {
    id: s.id, name: s.name, team: s.team, bot: s.bot, loadout: s.loadout,
    x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, yaw: s.yaw, pitch: s.pitch,
    crouch: m.crouch, grounded: m.grounded, slideTime: m.slideTime, slideCooldown: m.slideCooldown, airTime: Math.min(m.airTime, 60),
    prevCrouch: m.prevCrouchInput, prevJump: m.prevJumpInput,
    alive: s.alive, health: s.health, shield: s.shield, weapon: s.weapon, ammo0: u(s.ammo[0], 65535), ammo1: u(s.ammo[1], 65535),
    reloadLeft: s.reloadLeft, fireCooldown: s.fireCooldown, switchLeft: s.switchLeft, grenades: u(s.grenades, 255), respawnLeft: s.respawnLeft,
    protectLeft: s.protectLeft, sinceHit: Math.min(s.sinceHit, 999), lastAttacker: s.lastAttacker, kills: u(s.kills), deaths: u(s.deaths),
    score: u(s.score), captures: u(s.captures), lawCooldown: 0, sprint: s.sprint, ads: s.ads, sinceShot: Math.min(s.sinceShot, 999),
    corrections: u(s.corrections), idle: Math.min(s.idle, 9999), moveSlack: s.moveSlack, groundY: s.groundY,
    weapon0: s.weapons[0], weapon1: s.weapons[1], reserve0: u(s.reserve[0], 65535), reserve1: u(s.reserve[1], 65535),
    money: u(s.money), bought0: s.bought[0], bought1: s.bought[1], sinceSpawn: Math.min(s.sinceSpawn, 999),
  };
}

/** The respawn countdown becomes an absolute match time so the row only changes when it starts. */
const at = (time: number, left: number) => left > 0 ? Math.round((time + left) * 10) / 10 : 0;
function rosterRow(s: Soldier, time: number): RosterRow {
  return {
    id: s.id, name: s.name, team: s.team, bot: s.bot, loadout: s.loadout, alive: s.alive, grenades: u(s.grenades, 255),
    kills: u(s.kills), deaths: u(s.deaths), score: u(s.score), captures: u(s.captures),
    respawnAt: s.alive ? 0 : at(time, s.respawnLeft),
    protect: s.protectLeft > 0, lastAttacker: s.lastAttacker, corrections: u(s.corrections),
    weapon0: s.weapons[0], weapon1: s.weapons[1], reserve0: u(s.reserve[0], 65535), reserve1: u(s.reserve[1], 65535), money: u(s.money),
  };
}
/** Compare roster rows ignoring the sub-second drift of a respawn countdown that is already running. */
const rosterKey = (r: RosterRow) => JSON.stringify({ ...r, respawnAt: Math.round(r.respawnAt) });

const bodyToRow = (b: Body): BodyRow => ({ id: b.id, kind: b.kind, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, age: Math.min(b.age, 9999), owner: b.owner, team: b.team, hp: b.hp, timer: b.timer });
const bodyFromRow = (r: BodyRow): Body => ({ id: r.id, kind: r.kind as Body['kind'], x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz, age: r.age, owner: r.owner, team: r.team, hp: r.hp, timer: r.timer });

/** The broadcast part of the match row: only these fields trigger a row update. */
const slowKey = (r: MatchRow) => JSON.stringify([r.mapId, r.phase, r.score0, r.score1, r.winner, r.configJson, r.humans]);

interface Loaded {
  state: MatchState; row: MatchRow; clock: ClockRow; clockExists: boolean;
  soldierKeys: Map<number, string>; rosterKeys: Map<number, string>; bodyKeys: Map<number, string>; pointKeys: Map<string, string>; brainKeys: Map<number, string>;
}

function load(ctx: Ctx): Loaded {
  const row = ctx.db.match.id.find(0);
  if (!row) throw new SenderError('Match not initialized');
  // Databases from before the clock table carry these fields in the match row.
  const existing = ctx.db.clock.id.find(0);
  const clock: ClockRow = existing ?? {
    id: 0, phaseLeft: row.phaseLeft, time: row.time, tick: row.tick, scoreTimer: row.scoreTimer, nextId: row.nextId,
    lastTickMicros: row.lastTickMicros, pickupsJson: '[]',
  };
  const brains = new Map<number, BotBrain>();
  const brainKeys = new Map<number, string>();
  for (const b of ctx.db.botBrain.iter()) { brains.set(b.id, JSON.parse(b.json)); brainKeys.set(b.id, b.json); }
  const soldierKeys = new Map<number, string>(), rosterKeys = new Map<number, string>(), bodyKeys = new Map<number, string>(), pointKeys = new Map<string, string>();
  const soldiers: Soldier[] = [];
  for (const r of ctx.db.soldier.iter()) { soldiers.push(soldierFromRow(r, brains.get(r.id))); soldierKeys.set(r.id, JSON.stringify(r)); }
  soldiers.sort((a, b) => a.id - b.id);
  for (const r of ctx.db.roster.iter()) rosterKeys.set(r.id, rosterKey(r));
  const bodies: Body[] = [];
  for (const r of ctx.db.body.iter()) {
    bodyKeys.set(r.id, JSON.stringify(r));
    // Sentinel drones, bolts and shards from before the laws were removed are dropped on save.
    if (r.kind in BODY_RADIUS) bodies.push(bodyFromRow(r));
  }
  bodies.sort((a, b) => a.id - b.id);
  const map = loadMap(row.mapId).def;
  const points: PointState[] = map.points.map(def => {
    const p = ctx.db.point.id.find(def.id);
    if (p) pointKeys.set(p.id, JSON.stringify(p));
    return { id: def.id, progress: p?.progress ?? 0, owner: (p?.owner ?? -1) as -1 | Team, contested: p?.contested ?? false, capturing: (p?.capturing ?? -1) as -1 | Team };
  });
  const state: MatchState = {
    mapId: row.mapId, phase: row.phase as MatchState['phase'], phaseLeft: clock.phaseLeft, time: clock.time, tick: clock.tick,
    scores: [row.score0, row.score1], scoreTimer: clock.scoreTimer, soldiers, points, bodies, nextId: clock.nextId,
    winner: row.winner as -1 | Team, config: { ...ONLINE_CONFIG, ...JSON.parse(row.configJson) },
    pickupLeft: (map.pickups ?? []).map((_, i) => (JSON.parse(clock.pickupsJson || '[]') as number[])[i] ?? 0),
  };
  return { state, row, clock: { ...clock }, clockExists: !!existing, soldierKeys, rosterKeys, bodyKeys, pointKeys, brainKeys };
}

function save(ctx: Ctx, loaded: Loaded, events: MatchEvent[], frame: boolean) {
  const { state, row, clock } = loaded;
  Object.assign(clock, {
    phaseLeft: state.phaseLeft, time: state.time, tick: state.tick >>> 0, scoreTimer: state.scoreTimer, nextId: state.nextId,
    pickupsJson: JSON.stringify(state.pickupLeft.map(v => Math.round(v * 100) / 100)),
  });
  if (loaded.clockExists) ctx.db.clock.id.update(clock); else { ctx.db.clock.insert(clock); loaded.clockExists = true; }
  const humans = state.soldiers.filter(s => !s.bot).length;
  const next: MatchRow = {
    ...row, mapId: state.mapId, phase: state.phase, score0: u(state.scores[0]), score1: u(state.scores[1]), winner: state.winner, humans,
    configJson: JSON.stringify(state.config),
  };
  if (slowKey(next) !== slowKey(row)) {
    // Refresh the legacy per-tick columns too, so the row stays self-consistent when it is written.
    ctx.db.match.id.update({ ...next, phaseLeft: clock.phaseLeft, time: clock.time, tick: clock.tick, scoreTimer: clock.scoreTimer, nextId: clock.nextId, lastTickMicros: clock.lastTickMicros });
  }
  const seen = new Set<number>();
  for (const s of state.soldiers) {
    seen.add(s.id);
    const nextRow = soldierToRow(s);
    const key = JSON.stringify(nextRow);
    const prev = loaded.soldierKeys.get(s.id);
    if (prev === undefined) ctx.db.soldier.insert(nextRow);
    else if (prev !== key) ctx.db.soldier.id.update(nextRow);
    const roster = rosterRow(s, state.time);
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
    const nextBody = bodyToRow(b);
    const prev = loaded.bodyKeys.get(b.id);
    if (prev === undefined) ctx.db.body.insert(nextBody);
    else if (prev !== JSON.stringify(nextBody)) ctx.db.body.id.update(nextBody);
  }
  for (const id of loaded.bodyKeys.keys()) if (!bodySeen.has(id)) ctx.db.body.id.delete(id);
  for (const p of state.points) {
    const nextPoint = { id: p.id, progress: p.progress, owner: p.owner, contested: p.contested, capturing: p.capturing };
    const prev = loaded.pointKeys.get(p.id);
    if (prev === undefined) ctx.db.point.insert(nextPoint);
    else if (prev !== JSON.stringify(nextPoint)) ctx.db.point.id.update(nextPoint);
  }
  // Shots ride in the packed frame; everything else is a (rarer) JSON event.
  const shots = frame ? events.filter((e): e is Extract<MatchEvent, { type: 'shot' }> => e.type === 'shot') : [];
  let seq = 0;
  for (const e of events) if (!frame || e.type !== 'shot') ctx.db.matchEvent.insert({ seq: seq++, json: JSON.stringify(e) });
  if (frame) {
    const data = encodeFrame(state, shots);
    if (ctx.db.frame.id.find(0)) ctx.db.frame.id.update({ id: 0, mapId: state.mapId, data });
    else ctx.db.frame.insert({ id: 0, mapId: state.mapId, data });
  }
}

/** Load the match, run `fn` against the shared rules, and persist the result atomically. */
function withMatch<T>(ctx: Ctx, fn: (state: MatchState, sim: SimContext, loaded: Loaded) => T, frame = false): T {
  const loaded = load(ctx);
  const events: MatchEvent[] = [];
  const { def, world } = loadMap(loaded.state.mapId);
  const sim: SimContext = { map: def, world, nav: loadNav(loaded.state.mapId), random: () => ctx.random(), emit: e => events.push(e) };
  const result = fn(loaded.state, sim, loaded);
  save(ctx, loaded, events, frame);
  return result;
}

function mySoldier(ctx: Ctx) {
  const player = ctx.db.player.identity.find(ctx.sender);
  if (!player) throw new SenderError('Not joined');
  return player;
}

const micros = (ctx: Ctx) => ctx.timestamp.microsSinceUnixEpoch;

/** Next battlefield: rotate through every map, skipping ones too small for the humans present. */
function nextMap(current: string, humans: number) {
  const fits = (id: string) => teamSizeFor(loadMap(id).def, ONLINE_CONFIG) * 2 >= humans;
  const start = MAP_IDS.indexOf(current as (typeof MAP_IDS)[number]);
  for (let i = 1; i <= MAP_IDS.length; i++) {
    const id = MAP_IDS[(start + i) % MAP_IDS.length];
    if (fits(id)) return id;
  }
  return START_MAP;
}

// ---- Lifecycle ----------------------------------------------------------------------------

function initializeMatch(ctx: Ctx) {
  if (ctx.db.match.id.find(0)) return;
  const random = () => ctx.random();
  const state = createMatch(START_MAP, { ...ONLINE_CONFIG }, random);
  ctx.db.match.insert({
    // The law columns are legacy (kept for in-place migration) and stay neutral.
    id: 0, mapId: state.mapId, phase: state.phase, phaseLeft: state.phaseLeft, time: 0, worldTime: 0, tick: 0, score0: 0, score1: 0,
    scoreTimer: 0, lawsJson: '{}', lawAuthor: -1, lawText: '', lawLeft: -1, rewindLeft: 0, nextId: state.nextId,
    droneTimer: 0, winner: -1, configJson: JSON.stringify(state.config), historyHead: 0, historyLength: 0,
    lastTickMicros: micros(ctx), humans: 0,
  });
  for (const b of state.bodies) ctx.db.body.insert(bodyToRow(b));
  for (const p of state.points) ctx.db.point.insert({ id: p.id, progress: 0, owner: -1, contested: false, capturing: -1 });
  withMatch(ctx, (s, sim) => balanceTeams(s, sim));
  ctx.db.tickSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(BigInt(Math.round(1_000_000 / TICK_RATE))) });
}

export const init = spacetimedb.init(initializeMatch);

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const player = ctx.db.player.identity.find(ctx.sender);
  if (!player) return;
  ctx.db.player.identity.delete(ctx.sender);
  withMatch(ctx, (state, sim) => { removeSoldier(state, sim, player.soldierId); balanceTeams(state, sim); });
});

/** Apply every queued movement report and command, in arrival order, through the shared rules. */
function applyInputs(ctx: Ctx, state: MatchState, sim: SimContext) {
  const present = new Set(state.soldiers.map(s => s.id));
  for (const row of [...ctx.db.inbox.iter()]) {
    if (!present.has(row.soldierId)) { ctx.db.inbox.soldierId.delete(row.soldierId); continue; }
    if (!row.pending) continue;
    reportState(state, sim, row.soldierId, {
      x: row.x, y: row.y, z: row.z, vx: row.vx, vy: row.vy, vz: row.vz, yaw: row.yaw, pitch: row.pitch, crouch: row.crouch,
      grounded: row.grounded, sprint: row.sprint, ads: row.ads, slide: row.slide, weapon: row.weapon ? 1 : 0,
    }, row.elapsed);
    ctx.db.inbox.soldierId.update({ ...row, pending: false, elapsed: 0 });
  }
  const commands = [...ctx.db.command.iter()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const applied = new Map<number, number>();
  for (const c of commands) {
    ctx.db.command.id.delete(c.id);
    const count = (applied.get(c.soldierId) ?? 0) + 1;
    applied.set(c.soldierId, count);
    if (!present.has(c.soldierId) || count > COMMANDS_PER_TICK) continue;
    const cmd = JSON.parse(c.json) as Command;
    switch (cmd.kind) {
      case 'fire': fireShot(state, sim, c.soldierId, cmd); break;
      case 'grenade': throwGrenade(state, sim, c.soldierId, cmd.origin, cmd.dir); break;
      case 'reload': reload(state, c.soldierId); break;
      case 'switch': switchWeapon(state, c.soldierId, cmd.slot); break;
      case 'loadout': setLoadout(state, c.soldierId, cmd.loadout); break;
      case 'buy': buyItem(state, sim, c.soldierId, cmd.item); break;
      case 'pickup': pickUp(state, sim, c.soldierId, cmd.index); break;
    }
  }
}

export const tick = spacetimedb.reducer({ onSchedule: tickTable }, { arg: tickTable.rowType }, ctx => {
  const row = ctx.db.match.id.find(0);
  if (!row) return;
  const now = micros(ctx);
  const clock = ctx.db.clock.id.find(0);
  const last = clock?.lastTickMicros ?? row.lastTickMicros;
  const dt = Math.min(0.1, Math.max(0, Number(now - last) / 1_000_000));
  // Nobody connected: freeze the battlefield instead of simulating bots for no one.
  if (row.humans === 0 || dt <= 0) {
    if (clock) ctx.db.clock.id.update({ ...clock, lastTickMicros: now });
    else ctx.db.match.id.update({ ...row, lastTickMicros: now });
    return;
  }
  withMatch(ctx, (state, sim, loaded) => {
    loaded.clock.lastTickMicros = now;
    applyInputs(ctx, state, sim);
    if (state.phase === 'ended' && state.phaseLeft - dt <= 0) {
      // Rotate battlefields between rounds; clients rebuild their scene when mapId changes.
      const next = nextMap(state.mapId, state.soldiers.filter(s => !s.bot).length);
      const { def, world } = loadMap(next);
      state.mapId = next;
      const nextSim = { ...sim, map: def, world, nav: loadNav(next) };
      resetMatch(state, nextSim);
      balanceTeams(state, nextSim);
      return;
    }
    tickMatch(state, sim, dt);
    // Drop players whose clients vanished without a disconnect.
    for (const s of [...state.soldiers]) {
      if (!s.bot && s.idle > 45) {
        for (const p of ctx.db.player.iter()) if (p.soldierId === s.id) ctx.db.player.identity.delete(p.identity);
        removeSoldier(state, sim, s.id); balanceTeams(state, sim);
      }
    }
  }, true);
});

// ---- Player commands ----------------------------------------------------------------------

export const join = spacetimedb.reducer({ name: t.string(), loadout: t.string(), team: t.i8() }, (ctx, { name, loadout, team }) => {
  const clean = name.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Lawbreaker';
  if (!(loadout in LOADOUTS)) throw new SenderError('Unknown loadout');
  // Updating an existing starter database does not run the init lifecycle reducer.
  initializeMatch(ctx);
  const existing = ctx.db.player.identity.find(ctx.sender);
  withMatch(ctx, (state, sim) => {
    if (existing && state.soldiers.some(s => s.id === existing.soldierId)) return;
    const soldier = addSoldier(state, sim, { name: clean, bot: false, loadout: loadout as LoadoutId, team: team === 0 || team === 1 ? team : undefined });
    balanceTeams(state, sim);
    if (existing) ctx.db.player.identity.update({ ...existing, soldierId: soldier.id, lastReportMicros: micros(ctx) });
    else ctx.db.player.insert({ identity: ctx.sender, soldierId: soldier.id, lastReportMicros: micros(ctx) });
  });
});

export const leave = spacetimedb.reducer({}, ctx => {
  const player = mySoldier(ctx);
  ctx.db.player.identity.delete(ctx.sender);
  withMatch(ctx, (state, sim) => { removeSoldier(state, sim, player.soldierId); balanceTeams(state, sim); });
});

/** Movement report: stored for the next tick (latest wins; elapsed time accumulates for the budget). */
export const report = spacetimedb.reducer({
  x: t.f32(), y: t.f32(), z: t.f32(), vx: t.f32(), vy: t.f32(), vz: t.f32(), yaw: t.f32(), pitch: t.f32(),
  crouch: t.f32(), grounded: t.bool(), sprint: t.bool(), ads: t.bool(), slide: t.bool(), weapon: t.u8(),
}, (ctx, r) => {
  const player = mySoldier(ctx);
  const now = micros(ctx);
  const prev = ctx.db.inbox.soldierId.find(player.soldierId);
  const since = Number(now - (prev?.lastMicros ?? player.lastReportMicros)) / 1_000_000;
  const next = { ...r, weapon: r.weapon ? 1 : 0, soldierId: player.soldierId, lastMicros: now, elapsed: (prev?.pending ? prev.elapsed : 0) + Math.max(0, since), pending: true };
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
  queue(ctx, { kind: 'fire', weapon: a.weapon ? 1 : 0, origin: { x: a.ox, y: a.oy, z: a.oz }, dir: { x: a.dx, y: a.dy, z: a.dz }, target: a.target, zone, point: { x: a.px, y: a.py, z: a.pz } });
});

export const grenade = spacetimedb.reducer({ ox: t.f32(), oy: t.f32(), oz: t.f32(), dx: t.f32(), dy: t.f32(), dz: t.f32() }, (ctx, a) => {
  queue(ctx, { kind: 'grenade', origin: { x: a.ox, y: a.oy, z: a.oz }, dir: { x: a.dx, y: a.dy, z: a.dz } });
});

export const reloadWeapon = spacetimedb.reducer({}, ctx => { queue(ctx, { kind: 'reload' }); });

export const switchSlot = spacetimedb.reducer({ slot: t.u8() }, (ctx, { slot }) => { queue(ctx, { kind: 'switch', slot: slot ? 1 : 0 }); });

export const chooseLoadout = spacetimedb.reducer({ loadout: t.string() }, (ctx, { loadout }) => {
  if (!(loadout in LOADOUTS)) throw new SenderError('Unknown loadout');
  queue(ctx, { kind: 'loadout', loadout: loadout as LoadoutId });
});

/** Buy menu purchase; validated by the next tick (buy time / spawn zone, credits). */
export const buy = spacetimedb.reducer({ item: t.string() }, (ctx, { item }) => {
  if (item !== 'grenade' && !(item in WEAPONS)) throw new SenderError('Unknown item');
  queue(ctx, { kind: 'buy', item: item as BuyItem });
});

/** Take the weapon lying at a map pickup (E); validated by the next tick (reach, availability). */
export const pickupItem = spacetimedb.reducer({ index: t.u32() }, (ctx, { index }) => { queue(ctx, { kind: 'pickup', index }); });
