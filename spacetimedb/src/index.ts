import { ScheduleAt, type Identity } from 'spacetimedb';
import { schema, table, t, SenderError, type ReducerCtx, type InferSchema } from 'spacetimedb/server';
import { MAP_IDS, loadMap, loadNav } from '../../shared/maps/index';
import type { SimContext } from '../../shared/match/combat';
import { encodeFrame } from '../../shared/match/frame';
import {
  addSoldier, balanceTeams, buyAttachmentFor, buyItem, createMatch, fireShot, reload, removeSoldier, reportState, resetMatch,
  switchWeapon, throwGrenade, tickMatch, useAmmoCrate, TICK_RATE,
} from '../../shared/match/sim';
import {
  ONLINE_CONFIG, type BombState, type BotBrain, type MatchEvent, type MatchState, type Mode, type RoundStats, type Soldier, type Team,
} from '../../shared/match/state';
import { ATTACHMENTS, DEFAULT_WEAPONS, STAMINA, WEAPONS, normalizeAttachments, type AttachmentId, type Attachments, type Slot, type WeaponId } from '../../shared/weapons';
import { newRoundStats, type BuyItem } from '../../shared/match/economy';
import { BODY_RADIUS, type Body } from '../../shared/world';

/**
 * Authoritative multiplayer: the same shared match simulation the offline client runs, executed
 * here on a 30 Hz scheduled reducer. Player reducers only queue their input (a cheap private-row
 * write); the tick loads the match once, applies every queued report and command through the
 * shared validation rules, simulates, and publishes one packed `frame` row plus the slow-changing
 * `roster` rows. That keeps a 100-soldier match to one load/save per tick and one small row
 * update per client per tick.
 */
const START_MAP = 'cinder';
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
});

/** Per-tick server bookkeeping, kept out of the public match row so it is not broadcast 30×/s. */
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
});

/** What other players need about a soldier, rewritten only when it changes (not every tick). */
const rosterTable = table({ name: 'roster', public: true }, {
  id: t.u32().primaryKey(), name: t.string(), team: t.u8(), bot: t.bool(), alive: t.bool(),
  grenades: t.u8(), grenadeHE: t.bool(), kills: t.u32(), deaths: t.u32(), assists: t.u32(), score: t.u32(),
  lastAttacker: t.i32(), corrections: t.u32(),
  weapon0: t.string(), weapon1: t.string(), reserve0: t.u16(), reserve1: t.u16(), money: t.u32(),
  /** Weapons bought this match and their attachments (JSON). */
  gearJson: t.string(),
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
  /** Chat rate limit: start of the current 10 s window and lines sent in it. */
  chatWindowMicros: t.u64().default(0n), chatCount: t.u32().default(0),
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

const eventTable = table({ name: 'match_event', public: true, event: true }, { seq: t.u32(), json: t.string() });

/** Career stats per identity (BeGone profile): the public leaderboard reads this. */
const profileTable = table({ name: 'profile', public: true }, {
  identity: t.identity().primaryKey(), name: t.string(),
  kills: t.u32(), deaths: t.u32(), assists: t.u32(), headshots: t.u32(),
  roundsWon: t.u32(), roundsPlayed: t.u32(), matchesWon: t.u32(), matchesPlayed: t.u32(),
});

const tickTable = table({ name: 'tick_schedule' }, { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() });

const spacetimedb = schema({
  match: matchTable, clock: clockTable, soldier: soldierTable, roster: rosterTable, frame: frameTable, botBrain: brainTable,
  point: pointTable, body: bodyTable, player: playerTable, inbox: inboxTable, command: commandTable, history: historyTable,
  matchEvent: eventTable, tickSchedule: tickTable, profile: profileTable,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type SoldierRow = Parameters<Ctx['db']['soldier']['insert']>[0];
type RosterRow = Parameters<Ctx['db']['roster']['insert']>[0];
type BodyRow = Parameters<Ctx['db']['body']['insert']>[0];
type MatchRow = Parameters<Ctx['db']['match']['insert']>[0];
type ClockRow = Parameters<Ctx['db']['clock']['insert']>[0];
type RoundRow = Pick<MatchState, 'round' | 'roundPhase' | 'roundClock' | 'roundWinner' | 'lossStreak' | 'firstKill' | 'firstBlood' | 'lastKillTeam'> & { bomb: BombState };

type Command =
  | { kind: 'fire'; weapon: Slot; origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number }; target: number; zone: 'head' | 'body' | 'legs' | ''; point: { x: number; y: number; z: number } }
  | { kind: 'grenade'; origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } }
  | { kind: 'reload' }
  | { kind: 'switch'; slot: Slot }
  | { kind: 'buy'; item: BuyItem }
  | { kind: 'attach'; weapon: WeaponId; attachment: AttachmentId }
  | { kind: 'crate'; index: number };

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
function soldierToRow(s: Soldier): SoldierRow {
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
    money: u(s.money), bought0: '', bought1: '', sinceSpawn: 0, gearJson: JSON.stringify(gear),
  };
}

function rosterRow(s: Soldier): RosterRow {
  return {
    id: s.id, name: s.name, team: s.team, bot: s.bot, alive: s.alive, grenades: u(s.grenades, 255), grenadeHE: s.grenadeHE,
    kills: u(s.kills), deaths: u(s.deaths), assists: u(s.assists), score: u(s.score), lastAttacker: s.lastAttacker, corrections: u(s.corrections),
    weapon0: s.weapons[0], weapon1: s.weapons[1], reserve0: u(s.reserve[0], 65535), reserve1: u(s.reserve[1], 65535), money: u(s.money),
    gearJson: JSON.stringify({ owned: s.owned, attachments: s.attachments }),
  };
}
const rosterKey = (r: RosterRow) => JSON.stringify(r);

const bodyToRow = (b: Body): BodyRow => ({ id: b.id, kind: b.kind, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, age: Math.min(b.age, 9999), owner: b.owner, team: b.team, hp: b.hp, timer: b.timer });
const bodyFromRow = (r: BodyRow): Body => ({ id: r.id, kind: r.kind as Body['kind'], x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz, age: r.age, owner: r.owner, team: r.team, hp: r.hp, timer: r.timer });

/** The broadcast part of the match row: only these fields trigger a row update. */
const slowKey = (r: MatchRow) => JSON.stringify([r.mapId, r.phase, r.score0, r.score1, r.winner, r.configJson, r.humans]);

interface Loaded {
  state: MatchState; row: MatchRow; clock: ClockRow; clockExists: boolean;
  soldierKeys: Map<number, string>; rosterKeys: Map<number, string>; bodyKeys: Map<number, string>; brainKeys: Map<number, string>;
}

function load(ctx: Ctx): Loaded {
  const row = ctx.db.match.id.find(0);
  if (!row) throw new SenderError('Match not initialized');
  // Databases from before the clock table carry these fields in the match row.
  const existing = ctx.db.clock.id.find(0);
  const clock: ClockRow = existing ?? {
    id: 0, phaseLeft: row.phaseLeft, time: row.time, tick: row.tick, nextId: row.nextId, lastTickMicros: row.lastTickMicros, roundJson: '',
  };
  const brains = new Map<number, BotBrain>();
  const brainKeys = new Map<number, string>();
  for (const b of ctx.db.botBrain.iter()) { brains.set(b.id, JSON.parse(b.json)); brainKeys.set(b.id, b.json); }
  const soldierKeys = new Map<number, string>(), rosterKeys = new Map<number, string>(), bodyKeys = new Map<number, string>();
  const soldiers: Soldier[] = [];
  for (const r of ctx.db.soldier.iter()) { soldiers.push(soldierFromRow(r, brains.get(r.id))); soldierKeys.set(r.id, JSON.stringify(r)); }
  soldiers.sort((a, b) => a.id - b.id);
  for (const r of ctx.db.roster.iter()) rosterKeys.set(r.id, rosterKey(r));
  const bodies: Body[] = [];
  for (const r of ctx.db.body.iter()) {
    bodyKeys.set(r.id, JSON.stringify(r));
    // Drones, charges, bolts and shards from before the rebuild are dropped on save.
    if (r.kind in BODY_RADIUS) bodies.push(bodyFromRow(r));
  }
  bodies.sort((a, b) => a.id - b.id);
  const round: Partial<RoundRow> = clock.roundJson ? JSON.parse(clock.roundJson) : {};
  // A database from before rounds (Domination) restarts in warm-up with the BeGone rules.
  const legacy = !clock.roundJson;
  const state: MatchState = {
    mapId: legacy ? START_MAP : row.mapId, phase: legacy ? 'warmup' : row.phase as MatchState['phase'], phaseLeft: legacy ? ONLINE_CONFIG.warmup : clock.phaseLeft,
    time: clock.time, tick: clock.tick,
    scores: legacy ? [0, 0] : [row.score0, row.score1], soldiers, bodies, nextId: clock.nextId,
    winner: legacy ? -1 : row.winner as -1 | Team, config: legacy ? { ...ONLINE_CONFIG } : { ...ONLINE_CONFIG, ...JSON.parse(row.configJson) },
    round: round.round ?? 0, roundPhase: round.roundPhase ?? 'freeze', roundClock: round.roundClock ?? 0, roundWinner: round.roundWinner ?? -1,
    lossStreak: round.lossStreak ?? [0, 0], firstKill: round.firstKill ?? false, firstBlood: round.firstBlood ?? false,
    lastKillTeam: round.lastKillTeam ?? -1, bomb: round.bomb ?? { site: -1, armed: false, progress: 0, by: -1 },
  };
  return { state, row, clock: { ...clock }, clockExists: !!existing, soldierKeys, rosterKeys, bodyKeys, brainKeys };
}

function save(ctx: Ctx, loaded: Loaded, events: MatchEvent[], frame: boolean) {
  const { state, row, clock } = loaded;
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
    const nextRow = soldierToRow(s);
    const key = JSON.stringify(nextRow);
    const prev = loaded.soldierKeys.get(s.id);
    if (prev === undefined) ctx.db.soldier.insert(nextRow);
    else if (prev !== key) ctx.db.soldier.id.update(nextRow);
    const roster = rosterRow(s);
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

/** Next match: the next map in the rotation, alternating Sabotage (where the map has bomb sites) and Elimination. */
function nextMatch(current: string, mode: Mode): { mapId: string; mode: Mode } {
  const start = MAP_IDS.indexOf(current as (typeof MAP_IDS)[number]);
  const mapId = MAP_IDS[(start + 1) % MAP_IDS.length];
  const wantSabotage = mode === 'elimination' && !!loadMap(mapId).def.sabotage?.sites.length;
  return { mapId, mode: wantSabotage ? 'sabotage' : 'elimination' };
}

// ---- Lifecycle ----------------------------------------------------------------------------

function initializeMatch(ctx: Ctx) {
  if (ctx.db.match.id.find(0)) return;
  const state = createMatch(START_MAP, { ...ONLINE_CONFIG });
  ctx.db.match.insert({
    // The law columns are legacy (kept for in-place migration) and stay neutral.
    id: 0, mapId: state.mapId, phase: state.phase, phaseLeft: state.phaseLeft, time: 0, worldTime: 0, tick: 0, score0: 0, score1: 0,
    scoreTimer: 0, lawsJson: '{}', lawAuthor: -1, lawText: '', lawLeft: -1, rewindLeft: 0, nextId: state.nextId,
    droneTimer: 0, winner: -1, configJson: JSON.stringify(state.config), historyHead: 0, historyLength: 0,
    lastTickMicros: micros(ctx), humans: 0,
  });
  for (const b of state.bodies) ctx.db.body.insert(bodyToRow(b));
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
      grounded: row.grounded, sprint: row.sprint, ads: row.ads, slide: row.slide, weapon: slotOf(row.weapon), use: row.use,
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
      case 'buy': buyItem(state, sim, c.soldierId, cmd.item); break;
      case 'attach': buyAttachmentFor(state, c.soldierId, cmd.weapon, cmd.attachment); break;
      case 'crate': useAmmoCrate(state, sim, c.soldierId, cmd.index); break;
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
      // Rotate maps and modes between matches; clients rebuild their scene when mapId changes.
      const next = nextMatch(state.mapId, state.config.mode);
      const { def, world } = loadMap(next.mapId);
      state.mapId = next.mapId;
      state.config = { ...state.config, mode: next.mode };
      const nextSim = { ...sim, map: def, world, nav: loadNav(next.mapId) };
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

export const join = spacetimedb.reducer({ name: t.string(), team: t.i8() }, (ctx, { name, team }) => {
  const clean = name.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Operator';
  // Updating an existing starter database does not run the init lifecycle reducer.
  initializeMatch(ctx);
  const existing = ctx.db.player.identity.find(ctx.sender);
  withMatch(ctx, (state, sim) => {
    if (existing && state.soldiers.some(s => s.id === existing.soldierId)) return;
    const soldier = addSoldier(state, sim, { name: clean, bot: false, team: team === 0 || team === 1 ? team : undefined });
    balanceTeams(state, sim);
    if (existing) ctx.db.player.identity.update({ ...existing, soldierId: soldier.id, lastReportMicros: micros(ctx) });
    else ctx.db.player.insert({ identity: ctx.sender, soldierId: soldier.id, lastReportMicros: micros(ctx), chatWindowMicros: 0n, chatCount: 0 });
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
  ctx.db.matchEvent.insert({ seq: 0, json: JSON.stringify(event) });
});
