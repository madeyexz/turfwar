import { ScheduleAt } from 'spacetimedb';
import { schema, table, t, SenderError, type ReducerCtx, type InferSchema } from 'spacetimedb/server';
import { parseLawCommand } from '../../shared/laws';
import { loadMap, loadNav } from '../../shared/maps/index';
import type { SimContext } from '../../shared/match/combat';
import {
  addSoldier, applyLaw, balanceTeams, createMatch, fireShot, HISTORY_SECONDS, reload, removeSoldier, reportState,
  setLoadout, switchWeapon, throwGrenade, tickMatch, TICK_RATE,
} from '../../shared/match/sim';
import { ONLINE_CONFIG, type BotBrain, type MatchEvent, type MatchState, type PointState, type Soldier, type Team, type WorldSnapshot } from '../../shared/match/state';
import { LOADOUTS, type LoadoutId } from '../../shared/weapons';
import type { Body } from '../../shared/world';

/**
 * Authoritative multiplayer: the same shared match simulation the offline client runs, executed
 * here on a 30 Hz scheduled reducer. Clients report their own movement and shot claims; every
 * report is validated by the shared rules before it touches the match.
 */
const MAP_ID = 'cinder';
const HISTORY_CAPACITY = HISTORY_SECONDS * TICK_RATE + 1;

const matchTable = table({ name: 'match', public: true }, {
  id: t.u8().primaryKey(),
  mapId: t.string(), phase: t.string(), phaseLeft: t.f64(), time: t.f64(), worldTime: t.f64(), tick: t.u32(),
  score0: t.u32(), score1: t.u32(), scoreTimer: t.f64(),
  lawsJson: t.string(), lawAuthor: t.i32(), lawText: t.string(), lawLeft: t.f64(), rewindLeft: t.u32(),
  nextId: t.u32(), droneTimer: t.f64(), winner: t.i8(), configJson: t.string(),
  historyHead: t.u32(), historyLength: t.u32(), lastTickMicros: t.u64(), humans: t.u32(),
});

const soldierTable = table({ name: 'soldier', public: true }, {
  id: t.u32().primaryKey(), name: t.string(), team: t.u8(), bot: t.bool(), loadout: t.string(),
  x: t.f32(), y: t.f32(), z: t.f32(), vx: t.f32(), vy: t.f32(), vz: t.f32(), yaw: t.f32(), pitch: t.f32(),
  crouch: t.f32(), grounded: t.bool(), slideTime: t.f32(), slideCooldown: t.f32(), airTime: t.f32(), prevCrouch: t.bool(), prevJump: t.bool(),
  alive: t.bool(), health: t.f32(), shield: t.f32(), weapon: t.u8(), ammo0: t.u16(), ammo1: t.u16(),
  reloadLeft: t.f32(), fireCooldown: t.f32(), switchLeft: t.f32(), grenades: t.u8(), respawnLeft: t.f32(), protectLeft: t.f32(),
  sinceHit: t.f32(), lastAttacker: t.i32(), kills: t.u32(), deaths: t.u32(), score: t.u32(), captures: t.u32(),
  lawCooldown: t.f32(), sprint: t.bool(), ads: t.bool(), sinceShot: t.f32(), corrections: t.u32(), idle: t.f32(),
});

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

const historyTable = table({ name: 'history' }, { slot: t.u32().primaryKey(), json: t.string() });

const eventTable = table({ name: 'match_event', public: true, event: true }, { seq: t.u32(), json: t.string() });

const tickTable = table({ name: 'tick_schedule' }, { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() });

const spacetimedb = schema({
  match: matchTable, soldier: soldierTable, botBrain: brainTable, point: pointTable, body: bodyTable,
  player: playerTable, history: historyTable, matchEvent: eventTable, tickSchedule: tickTable,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type SoldierRow = Parameters<Ctx['db']['soldier']['insert']>[0];
type BodyRow = Parameters<Ctx['db']['body']['insert']>[0];
type MatchRow = Parameters<Ctx['db']['match']['insert']>[0];

// ---- Row <-> state conversion ------------------------------------------------------------

function soldierFromRow(r: SoldierRow, brain?: BotBrain): Soldier {
  return {
    id: r.id, name: r.name, team: r.team as Team, bot: r.bot, loadout: r.loadout as LoadoutId,
    m: { x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz, grounded: r.grounded, crouch: r.crouch, slideTime: r.slideTime, slideCooldown: r.slideCooldown, airTime: r.airTime, prevCrouchInput: r.prevCrouch, prevJumpInput: r.prevJump },
    yaw: r.yaw, pitch: r.pitch, alive: r.alive, health: r.health, shield: r.shield, weapon: r.weapon as 0 | 1, ammo: [r.ammo0, r.ammo1],
    reloadLeft: r.reloadLeft, fireCooldown: r.fireCooldown, switchLeft: r.switchLeft, grenades: r.grenades, respawnLeft: r.respawnLeft,
    protectLeft: r.protectLeft, sinceHit: r.sinceHit, lastAttacker: r.lastAttacker, kills: r.kills, deaths: r.deaths, score: r.score,
    captures: r.captures, lawCooldown: r.lawCooldown, sprint: r.sprint, ads: r.ads, sinceShot: r.sinceShot, corrections: r.corrections,
    idle: r.idle, brain,
  };
}

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
    score: u(s.score), captures: u(s.captures), lawCooldown: s.lawCooldown, sprint: s.sprint, ads: s.ads, sinceShot: Math.min(s.sinceShot, 999),
    corrections: u(s.corrections), idle: Math.min(s.idle, 9999),
  };
}

const bodyToRow = (b: Body): BodyRow => ({ id: b.id, kind: b.kind, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, age: Math.min(b.age, 9999), owner: b.owner, team: b.team, hp: b.hp, timer: b.timer });
const bodyFromRow = (r: BodyRow): Body => ({ id: r.id, kind: r.kind as Body['kind'], x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz, age: r.age, owner: r.owner, team: r.team, hp: r.hp, timer: r.timer });

interface Loaded { state: MatchState; row: MatchRow; soldierKeys: Map<number, string>; bodyKeys: Map<number, string>; pointKeys: Map<string, string>; brainKeys: Map<number, string> }

function load(ctx: Ctx): Loaded {
  const row = ctx.db.match.id.find(0);
  if (!row) throw new SenderError('Match not initialized');
  const brains = new Map<number, BotBrain>();
  const brainKeys = new Map<number, string>();
  for (const b of ctx.db.botBrain.iter()) { brains.set(b.id, JSON.parse(b.json)); brainKeys.set(b.id, b.json); }
  const soldierKeys = new Map<number, string>(), bodyKeys = new Map<number, string>(), pointKeys = new Map<string, string>();
  const soldiers: Soldier[] = [];
  for (const r of ctx.db.soldier.iter()) { soldiers.push(soldierFromRow(r, brains.get(r.id))); soldierKeys.set(r.id, JSON.stringify(r)); }
  soldiers.sort((a, b) => a.id - b.id);
  const bodies: Body[] = [];
  for (const r of ctx.db.body.iter()) { bodies.push(bodyFromRow(r)); bodyKeys.set(r.id, JSON.stringify(r)); }
  bodies.sort((a, b) => a.id - b.id);
  const map = loadMap(row.mapId).def;
  const points: PointState[] = map.points.map(def => {
    const p = ctx.db.point.id.find(def.id);
    if (p) pointKeys.set(p.id, JSON.stringify(p));
    return { id: def.id, progress: p?.progress ?? 0, owner: (p?.owner ?? -1) as -1 | Team, contested: p?.contested ?? false, capturing: (p?.capturing ?? -1) as -1 | Team };
  });
  const state: MatchState = {
    mapId: row.mapId, phase: row.phase as MatchState['phase'], phaseLeft: row.phaseLeft, time: row.time, worldTime: row.worldTime, tick: row.tick,
    scores: [row.score0, row.score1], scoreTimer: row.scoreTimer, laws: JSON.parse(row.lawsJson), lawAuthor: row.lawAuthor, lawText: row.lawText,
    lawLeft: row.lawLeft, rewindLeft: row.rewindLeft, soldiers, points, bodies, nextId: row.nextId, droneTimer: row.droneTimer,
    winner: row.winner as -1 | Team, config: JSON.parse(row.configJson),
  };
  return { state, row, soldierKeys, bodyKeys, pointKeys, brainKeys };
}

function save(ctx: Ctx, loaded: Loaded, events: MatchEvent[]) {
  const { state, row } = loaded;
  const humans = state.soldiers.filter(s => !s.bot).length;
  ctx.db.match.id.update({
    ...row, phase: state.phase, phaseLeft: state.phaseLeft, time: state.time, worldTime: state.worldTime, tick: state.tick >>> 0,
    score0: u(state.scores[0]), score1: u(state.scores[1]), scoreTimer: state.scoreTimer, lawsJson: JSON.stringify(state.laws),
    lawAuthor: state.lawAuthor, lawText: state.lawText.slice(0, 200), lawLeft: state.lawLeft, rewindLeft: u(state.rewindLeft),
    nextId: state.nextId, droneTimer: state.droneTimer, winner: state.winner, humans,
    historyHead: loaded.row.historyHead, historyLength: loaded.row.historyLength, lastTickMicros: loaded.row.lastTickMicros,
  });
  const seen = new Set<number>();
  for (const s of state.soldiers) {
    seen.add(s.id);
    const next = soldierToRow(s);
    const key = JSON.stringify(next);
    const prev = loaded.soldierKeys.get(s.id);
    if (prev === undefined) ctx.db.soldier.insert(next);
    else if (prev !== key) ctx.db.soldier.id.update(next);
    if (s.brain) {
      const json = JSON.stringify(s.brain);
      const before = loaded.brainKeys.get(s.id);
      if (before === undefined) ctx.db.botBrain.insert({ id: s.id, json });
      else if (before !== json) ctx.db.botBrain.id.update({ id: s.id, json });
    }
  }
  for (const id of loaded.soldierKeys.keys()) if (!seen.has(id)) ctx.db.soldier.id.delete(id);
  for (const id of loaded.brainKeys.keys()) if (!seen.has(id)) ctx.db.botBrain.id.delete(id);
  const bodySeen = new Set<number>();
  for (const b of state.bodies) {
    bodySeen.add(b.id);
    const next = bodyToRow(b);
    const prev = loaded.bodyKeys.get(b.id);
    if (prev === undefined) ctx.db.body.insert(next);
    else if (prev !== JSON.stringify(next)) ctx.db.body.id.update(next);
  }
  for (const id of loaded.bodyKeys.keys()) if (!bodySeen.has(id)) ctx.db.body.id.delete(id);
  for (const p of state.points) {
    const next = { id: p.id, progress: p.progress, owner: p.owner, contested: p.contested, capturing: p.capturing };
    const prev = loaded.pointKeys.get(p.id);
    if (prev === undefined) ctx.db.point.insert(next);
    else if (prev !== JSON.stringify(next)) ctx.db.point.id.update(next);
  }
  events.forEach((e, i) => ctx.db.matchEvent.insert({ seq: i, json: JSON.stringify(e) }));
}

/** World-rewind history lives in a private ring of rows. */
function historyAdapter(ctx: Ctx, loaded: Loaded): SimContext['history'] {
  const row = loaded.row;
  const read = (slot: number): WorldSnapshot | undefined => { const r = ctx.db.history.slot.find(slot); return r ? JSON.parse(r.json) : undefined; };
  return {
    get length() { return row.historyLength; },
    push(s: WorldSnapshot) {
      const slot = row.historyHead, json = JSON.stringify(s);
      if (ctx.db.history.slot.find(slot)) ctx.db.history.slot.update({ slot, json }); else ctx.db.history.insert({ slot, json });
      row.historyHead = (row.historyHead + 1) % HISTORY_CAPACITY;
      row.historyLength = Math.min(HISTORY_CAPACITY, row.historyLength + 1);
    },
    pop() {
      if (!row.historyLength) return undefined;
      row.historyHead = (row.historyHead - 1 + HISTORY_CAPACITY) % HISTORY_CAPACITY;
      row.historyLength--;
      return read(row.historyHead);
    },
    peek() { return row.historyLength ? read((row.historyHead - 1 + HISTORY_CAPACITY) % HISTORY_CAPACITY) : undefined; },
    clear() { for (const h of [...ctx.db.history.iter()]) ctx.db.history.slot.delete(h.slot); row.historyHead = 0; row.historyLength = 0; },
  };
}

/** Load the match, run `fn` against the shared rules, and persist the result atomically. */
function withMatch<T>(ctx: Ctx, fn: (state: MatchState, sim: SimContext) => T): T {
  const loaded = load(ctx);
  const events: MatchEvent[] = [];
  const { def, world } = loadMap(loaded.state.mapId);
  const sim: SimContext = { map: def, world, nav: loadNav(loaded.state.mapId), random: () => ctx.random(), emit: e => events.push(e), history: historyAdapter(ctx, loaded) };
  const result = fn(loaded.state, sim);
  save(ctx, loaded, events);
  return result;
}

function mySoldier(ctx: Ctx) {
  const player = ctx.db.player.identity.find(ctx.sender);
  if (!player) throw new SenderError('Not joined');
  return player;
}

const micros = (ctx: Ctx) => ctx.timestamp.microsSinceUnixEpoch;

// ---- Lifecycle ----------------------------------------------------------------------------

export const init = spacetimedb.init(ctx => {
  const random = () => ctx.random();
  const state = createMatch(MAP_ID, { ...ONLINE_CONFIG }, random);
  ctx.db.match.insert({
    id: 0, mapId: state.mapId, phase: state.phase, phaseLeft: state.phaseLeft, time: 0, worldTime: 0, tick: 0, score0: 0, score1: 0,
    scoreTimer: 0, lawsJson: JSON.stringify(state.laws), lawAuthor: -1, lawText: '', lawLeft: -1, rewindLeft: 0, nextId: state.nextId,
    droneTimer: state.droneTimer, winner: -1, configJson: JSON.stringify(state.config), historyHead: 0, historyLength: 0,
    lastTickMicros: micros(ctx), humans: 0,
  });
  for (const b of state.bodies) ctx.db.body.insert(bodyToRow(b));
  for (const p of state.points) ctx.db.point.insert({ id: p.id, progress: 0, owner: -1, contested: false, capturing: -1 });
  withMatch(ctx, (s, sim) => balanceTeams(s, sim));
  ctx.db.tickSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(BigInt(Math.round(1_000_000 / TICK_RATE))) });
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const player = ctx.db.player.identity.find(ctx.sender);
  if (!player) return;
  ctx.db.player.identity.delete(ctx.sender);
  withMatch(ctx, (state, sim) => { removeSoldier(state, sim, player.soldierId); balanceTeams(state, sim); });
});

export const tick = spacetimedb.reducer({ onSchedule: tickTable }, { arg: tickTable.rowType }, ctx => {
  const row = ctx.db.match.id.find(0);
  if (!row) return;
  const now = micros(ctx);
  const dt = Math.min(0.1, Math.max(0, Number(now - row.lastTickMicros) / 1_000_000));
  ctx.db.match.id.update({ ...row, lastTickMicros: now });
  // Nobody connected: freeze the battlefield instead of simulating bots for no one.
  if (row.humans === 0 || dt <= 0) return;
  withMatch(ctx, (state, sim) => {
    tickMatch(state, sim, dt);
    // Drop lawbreakers whose clients vanished without a disconnect.
    for (const s of [...state.soldiers]) {
      if (!s.bot && s.idle > 20) {
        for (const p of ctx.db.player.iter()) if (p.soldierId === s.id) ctx.db.player.identity.delete(p.identity);
        removeSoldier(state, sim, s.id); balanceTeams(state, sim);
      }
    }
  });
});

// ---- Player commands ----------------------------------------------------------------------

export const join = spacetimedb.reducer({ name: t.string(), loadout: t.string(), team: t.i8() }, (ctx, { name, loadout, team }) => {
  const clean = name.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Lawbreaker';
  if (!(loadout in LOADOUTS)) throw new SenderError('Unknown loadout');
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

export const report = spacetimedb.reducer({
  x: t.f32(), y: t.f32(), z: t.f32(), vx: t.f32(), vy: t.f32(), vz: t.f32(), yaw: t.f32(), pitch: t.f32(),
  crouch: t.f32(), grounded: t.bool(), sprint: t.bool(), ads: t.bool(), weapon: t.u8(),
}, (ctx, r) => {
  const player = mySoldier(ctx);
  const now = micros(ctx);
  const elapsed = Number(now - player.lastReportMicros) / 1_000_000;
  ctx.db.player.identity.update({ ...player, lastReportMicros: now });
  withMatch(ctx, (state, sim) => reportState(state, sim, player.soldierId, { ...r, weapon: r.weapon ? 1 : 0 }, elapsed));
});

export const fire = spacetimedb.reducer({
  weapon: t.u8(), ox: t.f32(), oy: t.f32(), oz: t.f32(), dx: t.f32(), dy: t.f32(), dz: t.f32(),
  target: t.i32(), zone: t.string(), px: t.f32(), py: t.f32(), pz: t.f32(),
}, (ctx, a) => {
  const player = mySoldier(ctx);
  const zone = a.zone === 'head' || a.zone === 'body' || a.zone === 'legs' ? a.zone : '';
  withMatch(ctx, (state, sim) => fireShot(state, sim, player.soldierId, {
    weapon: a.weapon ? 1 : 0, origin: { x: a.ox, y: a.oy, z: a.oz }, dir: { x: a.dx, y: a.dy, z: a.dz }, target: a.target, zone,
    point: { x: a.px, y: a.py, z: a.pz },
  }));
});

export const grenade = spacetimedb.reducer({ ox: t.f32(), oy: t.f32(), oz: t.f32(), dx: t.f32(), dy: t.f32(), dz: t.f32() }, (ctx, a) => {
  const player = mySoldier(ctx);
  withMatch(ctx, (state, sim) => throwGrenade(state, sim, player.soldierId, { x: a.ox, y: a.oy, z: a.oz }, { x: a.dx, y: a.dy, z: a.dz }));
});

export const reloadWeapon = spacetimedb.reducer({}, ctx => {
  const player = mySoldier(ctx);
  withMatch(ctx, state => reload(state, player.soldierId));
});

export const switchSlot = spacetimedb.reducer({ slot: t.u8() }, (ctx, { slot }) => {
  const player = mySoldier(ctx);
  withMatch(ctx, state => switchWeapon(state, player.soldierId, slot ? 1 : 0));
});

export const chooseLoadout = spacetimedb.reducer({ loadout: t.string() }, (ctx, { loadout }) => {
  const player = mySoldier(ctx);
  if (!(loadout in LOADOUTS)) throw new SenderError('Unknown loadout');
  withMatch(ctx, state => setLoadout(state, player.soldierId, loadout as LoadoutId));
});

/** Law commands arrive as JSON and are validated/clamped by the shared Zod schema. */
export const rewriteLaw = spacetimedb.reducer({ commandJson: t.string(), source: t.string(), text: t.string() }, (ctx, a) => {
  const player = mySoldier(ctx);
  if (a.commandJson.length > 2048) throw new SenderError('Law command too large');
  let command;
  try { command = parseLawCommand(JSON.parse(a.commandJson)); } catch { throw new SenderError('Invalid law command'); }
  const source = ['PRESET', 'AI TRANSLATION', 'OFFLINE PRESET'].includes(a.source) ? a.source : 'PRESET';
  const result = withMatch(ctx, (state, sim) => applyLaw(state, sim, player.soldierId, command, source, a.text.slice(0, 200)));
  if (!result.ok) throw new SenderError(result.message);
});
