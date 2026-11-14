// Headless matches in the lab copy of the shared simulation: the current bots and the learned aim, on the same measures.
// Usage: bun run.ts --map taipei --mode elimination --size 6 --rounds 60 --seed 1 --proto none|0|1|both
//          [--skill 0] [--temp 1] [--firetemp 1] [--delay 5] [--model lc-h29.7-s0-64x2] [--botskill 0.3 | 0.3,0.6]
//          [--rows /tmp/rec/sim/name] [--rowbots 1] [--out /tmp/rec/out/sim.jsonl] [--tag name] [--cap 10]
// Rows are the aim rows of /tmp/botlab/rows.ts (one per soldier per tick, alive, live round), so metrics.py reads them.
import { createContext, createMatch, balanceTeams, tickMatch, AB } from './shared/match/sim';
import { LAB } from './shared/match/bots';
import { ELIMINATION, SABOTAGE, type MatchEvent, type MatchConfig, type Soldier } from './shared/match/state';
import { refillAmmo } from './shared/match/economy';
import { eyeOf, feetOf, weaponOf, traceShot, resolveShot, resolvePellets } from './shared/match/combat';
import { dirFromAngles, wrapAngle, clamp, type Vec3 } from './shared/math';
import type { WeaponDef } from './shared/weapons';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AimNet, AimState, NF } from './policy';
import { A, NA, OWN, OV, SLOT, WIDX, RowFile, fillEnemies, wrap, type Seen } from './rows';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const MAP = arg('map', 'taipei'), MODE = arg('mode', 'elimination'), SIZE = +arg('size', '6'), ROUNDS = +arg('rounds', '60'), SEED = +arg('seed', '1');
const PROTO = arg('proto', 'none'), SKILL = +arg('skill', '0'), TEMP = +arg('temp', '1'), FIRETEMP = +arg('firetemp', '1'), DELAY = +arg('delay', '5');
const MODEL = arg('model', 'lc-h29.7-s0-64x2'), ROWS = arg('rows', ''), ROWBOTS = arg('rowbots', '1') === '1', OUT = arg('out', ''), TAG = arg('tag', '');
const CAP = +arg('cap', '10'), TIMING = arg('timing', '0') === '1', LOADOUT = arg('loadout', ''), STILL = +arg('still', '-1');
const bs = arg('botskill', '0.3').split(',').map(Number);
const ADSOPT = arg('ads', '0') === '1'; // the learned aim holds ADS while it sees an enemy or fires (the script decides if 0)
const SCAN = +arg('scan', '1'); // the learned aim checks the line of sight to all candidates each SCAN ticks, and between them only to the enemies it saw (1 = each tick)
const TRIGGER = arg('trigger', 'model'); // model: the learned aim has the trigger; script: the bot script keeps the trigger and the sights
const ADSMODEL = arg('adsmodel', '0') === '1'; // the model's fourth output holds the sights key
const EMA = +arg('ema', '0'), FIREBIAS = +arg('firebias', '0'); // the share of the last aim change that the next one keeps (a low-pass filter on the model's output), and a shift of the fire logit
const RHO = +arg('rho', '0'); // correlation of the sampling quantile from tick to tick (0 = independent samples)
const [Z0, Z1] = arg('zero', '0:0').split(':').map(Number); // feature columns set to zero (the model must be trained the same way)
const BOTSKILL: [number, number] = [bs[0], bs[1] ?? bs[0]];
const OLDTEAM = arg('oldteam', 'none'), ROWTEAM = arg('rowteam', 'both'); // the teams on the old bot script (none|0|1|both), and the team whose bots write rows
AB.old = [OLDTEAM === 'both' || OLDTEAM === '0', OLDTEAM === 'both' || OLDTEAM === '1'];
const DT = 1 / 30, DEG = Math.PI / 180, SN = 16, MAXID = 512;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const prand = rng(SEED * 7919 + 13); // the policy's own stream (samples, spread, recoil)
const net = PROTO === 'none' ? undefined : new AimNet('/tmp/rec/models/' + MODEL);
const gauss = () => Math.sqrt(-2 * Math.log(1 - prand())) * Math.cos(2 * Math.PI * prand());
/** The standard normal distribution function (Abramowitz and Stegun 26.2.17). */
const phi = (z: number) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989422804 * Math.exp(-z * z / 2) * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return z > 0 ? 1 - d : d; };

/** One soldier's controller state: the learned aim's pending action, the human fire model, and the row bookkeeping. */
class Ctl {
  proto = false; st = new AimState(); row = new Float32Array(NA);
  act = false; dyaw = 0; dpitch = 0; key = false; sights = false; acted = false; seeing = false;
  held = false; burst = 0; bloom = 0; debt = 0; ads = 0; cool = 0; sprintRecover = 0;
  buf = new Float32Array(NA * 256); n = 0; hasPrev = false; lastYaw = 0; lastPitch = 0;
  shots = 0; hits = 0; heads = 0; hurt = 0; zy = 0; zp = 0; sy = 0; sp = 0; v0 = -1; v1 = -1; v2 = -1;
  constructor(public team: number) {}
  resetLife() { this.st.reset(); this.act = false; this.acted = false; this.seeing = false; this.held = false; this.burst = 0; this.bloom = 0; this.debt = 0; this.ads = 0; this.cool = 0; this.sprintRecover = 0; this.hasPrev = false; this.zy = 0; this.zp = 0; this.sy = 0; this.sp = 0; this.v0 = this.v1 = this.v2 = -1; }
}
const ctls: (Ctl | undefined)[] = new Array(MAXID);
const files = ROWS ? { proto: new RowFile(ROWS + '-proto.f32', NA), bot: new RowFile(ROWS + '-bot.f32', NA) } : undefined;
if (ROWS) mkdirSync(dirname(ROWS), { recursive: true });
function flush(c: Ctl) {
  if (files && c.n) { const f = c.proto ? files.proto : files.bot; for (let i = 0; i < c.n; i += NA) { const { a, o } = f.row(); a.set(c.buf.subarray(i, i + NA), o); } }
  c.n = 0; c.hasPrev = false;
}

// ---- Match statistics ----
const BANDS = [5, 8, 15, 30, 1e9];
const T = () => ({ wins: 0, kills: 0, deaths: 0, shots: 0, hits: 0, heads: 0, damage: 0, aliveTicks: 0, ttk: [] as number[], killDist: [] as number[], bandShots: [0, 0, 0, 0, 0], bandHits: [0, 0, 0, 0, 0], first: [] as number[], firstWide: [] as number[], ads: 0, stillShots: 0, duelWin: 0, duelLoss: 0 });
const acq = new Map<number, { target: number; t: number; off: number; shot: boolean }>();
const team = [T(), T()];
const res = { rounds: 0, draws: 0, liveSeconds: 0, reasons: {} as Record<string, number>, armed: 0, disarmed: 0, exploded: 0, matches: 0 };
const firstDamage = new Map<number, number>();
let liveTick = 0, liveT = 0;

// ---- Positions of every soldier at the end of the last SN ticks (the learned aim sees enemies DELAY ticks late) ----
const snaps = Array.from({ length: SN }, () => ({ x: new Float32Array(MAXID), y: new Float32Array(MAXID), z: new Float32Array(MAXID), crouch: new Float32Array(MAXID), health: new Float32Array(MAXID), alive: new Uint8Array(MAXID) }));
const snapAt = (tick: number) => snaps[((tick % SN) + SN) % SN];

const ctx = createContext(MAP, rng(SEED), e => onEvent(e));
const config: MatchConfig = { ...(MODE === 'sabotage' ? SABOTAGE : ELIMINATION), teamSize: SIZE, botSkill: BOTSKILL[0], warmup: 0.2, roundsToWin: 6 };
const state = createMatch(MAP, config);
balanceTeams(state, ctx);
const srand = rng(SEED + 4242);
for (const s of state.soldiers) {
  s.brain!.skill = clamp(BOTSKILL[s.team] + (srand() - 0.5) * 0.3, 0.15, 0.95);
  const c = ctlOf(s);
  c.proto = PROTO === 'both' || PROTO === String(s.team);
}
function ctlOf(s: Soldier): Ctl { return ctls[s.id] ??= new Ctl(s.team); }
const byId = (id: number) => state.soldiers.find(s => s.id === id);

function onEvent(e: MatchEvent) {
  if (e.type === 'shot') {
    const c = ctls[e.shooter]; if (!c) return;
    {
      const sh = byId(e.shooter), tg = sh?.brain && sh.brain.target >= 0 ? byId(sh.brain.target) : undefined;
      if (sh && tg) {
        const d = Math.hypot(sh.m.x - tg.m.x, sh.m.z - tg.m.z), b = BANDS.findIndex(x => d < x), tt = team[c.team];
        tt.bandShots[b]++; if (e.hit) tt.bandHits[b]++;
        if (sh.ads) tt.ads++; if (Math.hypot(sh.m.vx, sh.m.vz) < 0.5) tt.stillShots++;
        const q = acq.get(sh.id);
        if (q && q.target === tg.id && !q.shot) { q.shot = true; (q.off > 0.6 ? tt.firstWide : tt.first).push(state.time - q.t); }
      }
    }
    if (e.weapon === 'm1014' || e.weapon === 'knife') { c.shots = 1; if (e.hit) c.hits = 1; if (e.hit === 2) c.heads = 1; }
    else { c.shots++; if (e.hit) c.hits++; if (e.hit === 2) c.heads++; }
  } else if (e.type === 'damage') {
    const c = ctls[e.target]; if (c) c.hurt += e.amount;
    const a = ctls[e.attacker];
    if (a && c && a.team !== c.team) { team[a.team].damage += e.amount; if (!firstDamage.has(e.target)) firstDamage.set(e.target, state.time); }
  } else if (e.type === 'kill') {
    const k = ctls[e.killer], v = ctls[e.victim];
    if (v) team[v.team].deaths++;
    if (k && v && k.team !== v.team) {
      team[k.team].kills++;
      const t0 = firstDamage.get(e.victim); if (t0 !== undefined) team[k.team].ttk.push(state.time - t0);
      { const vb = byId(e.victim); if (vb?.brain && vb.brain.target === e.killer && (vb.brain.reaction <= 0)) team[k.team].duelWin++; else team[k.team].duelLoss++; }
      const a = byId(e.killer), b = byId(e.victim); if (a && b) team[k.team].killDist.push(Math.hypot(a.m.x - b.m.x, a.m.y - b.m.y, a.m.z - b.m.z));
    }
    firstDamage.delete(e.victim);
  } else if (e.type === 'spawn') {
    const c = ctls[e.id]; if (c) { flush(c); c.resetLife(); }
  } else if (e.type === 'round') {
    if (e.phase === 'freeze' && LOADOUT) {
      // The same weapon for all soldiers (no store, no grenades): the result does not depend on cash.
      for (const s of state.soldiers) { s.weapons[0] = LOADOUT as never; s.attachments = {}; s.grenades = 0; s.molotovs = 0; s.money = 0; s.weapon = 0; refillAmmo(s); }
    }
    if (e.phase === 'live') { liveTick = state.tick; liveT = state.time; firstDamage.clear(); }
    else if (e.phase === 'over') {
      res.rounds++; res.liveSeconds += state.time - liveT;
      if (e.winner === -1) res.draws++; else team[e.winner].wins++;
      res.reasons[e.reason ?? ''] = (res.reasons[e.reason ?? ''] ?? 0) + 1;
    }
  } else if (e.type === 'bomb') { res[e.action]++; }
  else if (e.type === 'phase' && e.phase === 'ended') res.matches++;
}

// ---- The learned aim: apply last tick's action at the start of the bot's tick, with the human fire model ----
/** Where the shooter saw the target (lag compensation, as the server gives human players). */
const seenFeet = (s: Soldier): Vec3 => {
  const P = snapAt(state.tick - DELAY);
  return P.alive[s.id] ? { x: P.x[s.id], y: P.y[s.id], z: P.z[s.id] } : feetOf(s);
};
function spreadOf(bot: Soldier, w: WeaponDef, c: Ctl) {
  const moving = Math.hypot(bot.m.vx, bot.m.vz) > 1.5;
  let s = w.spread.hip + (w.spread.ads - w.spread.hip) * c.ads;
  if (moving) s += w.spread.moving * (1 - c.ads * 0.65);
  if (!bot.m.grounded) s += w.spread.air;
  if (bot.m.crouch > 0.5 && !moving) s *= 0.7;
  return s + c.bloom * (1 - c.ads * 0.6);
}
let nRow = 0, tPolicy = 0, tFill = 0, tFeat = 0, tFwd = 0, nPolicy = 0, nFwd = 0, tTick = 0, nTick = 0, tBefore = 0;
LAB.before = (st, cx, bot, dt) => {
  const c = ctls[bot.id];
  if (!c || !c.proto) return undefined;
  const t0 = TIMING ? Bun.nanoseconds() : 0;
  const w = weaponOf(bot);
  c.bloom = Math.max(0, c.bloom - w.spread.recovery * dt * (bot.sinceShot > 0.08 ? 1 : 0.25));
  c.cool = Math.max(-dt, c.cool - dt);
  c.ads = clamp(c.ads + Math.sign((bot.ads ? 1 : 0) - c.ads) * dt / w.adsTime, 0, 1);
  c.sprintRecover = bot.sprint ? 0.14 : Math.max(0, c.sprintRecover - dt);
  let active = false;
  if (c.act && st.roundPhase === 'live') {
    active = true; c.acted = true;
    bot.yaw = wrapAngle(bot.yaw + c.dyaw); bot.pitch = clamp(bot.pitch + c.dpitch, -1.48, 1.48);
    const trigger = TRIGGER === 'model' && c.key && !bot.sprint && c.sprintRecover <= 0;
    if (!trigger && TRIGGER === 'model') { c.held = false; c.burst = 0; }
    if (trigger && bot.switchLeft <= 0 && bot.reloadLeft <= 0 && c.cool <= 0 && (w.auto || !c.held)) {
      if (bot.weapon !== 2 && bot.ammo[bot.weapon] <= 0) bot.reloadLeft = w.reload;
      else {
        if (bot.weapon !== 2) bot.ammo[bot.weapon]--;
        c.cool += w.interval;
        const spread = w.pellets > 1 || w.class === 'melee' ? 0 : spreadOf(bot, w, c) * DEG;
        const a = prand() * Math.PI * 2, r = Math.sqrt(prand()) * spread;
        const eye = eyeOf(bot), dir = dirFromAngles(bot.yaw + Math.cos(a) * r, bot.pitch + Math.sin(a) * r);
        const feet = DELAY > 0 ? seenFeet : feetOf;
        if (w.pellets > 1) resolvePellets(st, cx, bot, w, eye, dir, c.ads > 0.5, feet);
        else resolveShot(st, cx, bot, w, eye, traceShot(st, cx, bot, eye, dir, w.range, feet));
        const k = 1 - c.ads * 0.35;
        const pk = w.recoil.pitch * DEG * (0.85 + prand() * 0.3) * k * (bot.m.crouch > 0.5 ? 0.8 : 1);
        const pat = w.recoil.pattern.length ? w.recoil.pattern[c.burst % w.recoil.pattern.length] : 0;
        const yk = (pat + (prand() - 0.5) * 0.6) * w.recoil.yaw * DEG * k;
        bot.pitch = Math.min(1.48, bot.pitch + pk); bot.yaw = wrapAngle(bot.yaw - yk); c.debt += pk;
        c.bloom = Math.min(w.spread.bloomMax, c.bloom + w.spread.bloomPerShot);
        bot.sinceShot = 0; c.burst++; bot.fireCooldown = w.interval;
      }
      c.held = true;
    }
  } else if (TRIGGER === 'model') { c.held = false; c.burst = 0; }
  if (bot.sinceShot > 0.12 && c.debt > 0) { const back = Math.min(c.debt, c.debt * (1 - Math.exp(-w.recoil.recover * dt))); bot.pitch -= back * 0.72; c.debt -= back; }
  if (TIMING) tBefore += Bun.nanoseconds() - t0;
  if (TRIGGER === 'script') return { active, noSprint: active && c.seeing, script: true };
  return { active, noSprint: active && (c.key || c.seeing), moveScale: STILL >= 0 && active && c.key ? STILL : undefined, ads: ADSMODEL ? (active ? c.sights : undefined) : ADSOPT && active ? (c.key || c.seeing) : undefined };
};
/** A shot of the script's trigger with the learned hand: the spread, the lag compensation and the recoil of a human client. */
LAB.shot = (st, cx, bot, burst) => {
  const c = ctls[bot.id]!, w = weaponOf(bot);
  const spread = w.pellets > 1 || w.class === 'melee' ? 0 : spreadOf(bot, w, c) * DEG;
  const a = prand() * Math.PI * 2, r = Math.sqrt(prand()) * spread;
  const eye = eyeOf(bot), dir = dirFromAngles(bot.yaw + Math.cos(a) * r, bot.pitch + Math.sin(a) * r);
  const feet = DELAY > 0 ? seenFeet : feetOf;
  if (w.pellets > 1) resolvePellets(st, cx, bot, w, eye, dir, c.ads > 0.5, feet);
  else resolveShot(st, cx, bot, w, eye, traceShot(st, cx, bot, eye, dir, w.range, feet));
  const k = 1 - c.ads * 0.35;
  const pk = w.recoil.pitch * DEG * (0.85 + prand() * 0.3) * k * (bot.m.crouch > 0.5 ? 0.8 : 1);
  const pat = w.recoil.pattern.length ? w.recoil.pattern[burst % w.recoil.pattern.length] : 0;
  const yk = (pat + (prand() - 0.5) * 0.6) * w.recoil.yaw * DEG * k;
  bot.pitch = Math.min(1.48, bot.pitch + pk); bot.yaw = wrapAngle(bot.yaw - yk); c.debt += pk;
  c.bloom = Math.min(w.spread.bloomMax, c.bloom + w.spread.bloomPerShot);
};

// ---- The end of each tick: positions, statistics, the aim rows, and the learned aim's next action ----
const seenPool: Seen[] = Array.from({ length: 64 }, () => ({ id: 0, bot: 1, x: 0, y: 0, z: 0, crouch: 0, health: 0 }));
const losA = { x: 0, y: 0, z: 0 }, losB = { x: 0, y: 0, z: 0 };
function afterTick() {
  const live = state.phase === 'live' && state.roundPhase === 'live';
  const P0 = snapAt(state.tick);
  for (const s of state.soldiers) { const i = s.id; P0.x[i] = s.m.x; P0.y[i] = s.m.y; P0.z[i] = s.m.z; P0.crouch[i] = s.m.crouch; P0.health[i] = s.health; P0.alive[i] = s.alive ? 1 : 0; }
  const clouds = state.bodies.some(b => b.kind === 'smokeCloud') ? state.bodies.filter(b => b.kind === 'smokeCloud') : undefined;
  for (const s of state.soldiers) {
    const c = ctlOf(s), tm = team[s.team];
    tm.shots += c.shots; tm.hits += c.hits; tm.heads += c.heads;
    if (live && s.alive && s.brain) {
      const q = acq.get(s.id), tg = s.brain.target;
      if (!q || q.target !== tg) {
        const e = tg >= 0 ? byId(tg) : undefined;
        acq.set(s.id, { target: tg, t: state.time, off: e ? Math.abs(wrapAngle(Math.atan2(-(e.m.x - s.m.x), -(e.m.z - s.m.z)) - s.yaw)) : 0, shot: false });
      }
    }
    if (live && s.alive) {
      tm.aliveTicks++;
      if (c.proto || (ROWBOTS && files && (ROWTEAM === 'both' || ROWTEAM === String(s.team)))) row(s, c, clouds);
    } else { if (c.n) flush(c); c.hasPrev = false; c.act = false; }
    c.shots = 0; c.hits = 0; c.heads = 0; c.hurt = 0; c.acted = false;
  }
}
function row(s: Soldier, c: Ctl, clouds: ReturnType<typeof Array.prototype.filter> | undefined) {
  const t0 = TIMING ? Bun.nanoseconds() : 0;
  const R = c.row, newRun = !c.hasPrev, m = s.m, w = weaponOf(s);
  R.fill(0);
  const yaw = wrap(s.yaw), pitch = s.pitch;
  R[A.t] = state.time - liveT; R[A.dt] = newRun ? 0 : DT; R[A.yaw] = yaw; R[A.pitch] = pitch;
  if (c.proto && c.acted) { R[A.mdyaw] = c.dyaw; R[A.mdpitch] = c.dpitch; }
  else if (!newRun) { R[A.mdyaw] = wrap(s.yaw - c.lastYaw); R[A.mdpitch] = pitch - c.lastPitch; }
  R[A.fire] = c.proto ? (TRIGGER === 'script' ? ((s.brain?.burst ?? 0) > 0 || c.shots > 0 ? 1 : 0) : c.acted && c.key ? 1 : 0) : (s.sinceShot < 0.15 ? 1 : 0);
  R[A.shots] = c.shots; R[A.hits] = c.hits; R[A.heads] = c.heads;
  R[A.weapon] = WIDX[w.id]; R[A.ads] = s.ads ? 1 : 0; R[A.crouch] = m.crouch;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  R[A.speed] = Math.hypot(m.vx, m.vz); R[A.vf] = m.vx * fx + m.vz * fz; R[A.vs] = m.vx * rx + m.vz * rz;
  R[A.grounded] = m.grounded ? 1 : 0; R[A.health] = s.health; R[A.ammo] = s.weapon === 2 ? 0 : s.ammo[s.weapon]; R[A.reloading] = s.reloadLeft > 0 ? 1 : 0;
  const P = c.proto ? snapAt(state.tick - DELAY) : snapAt(state.tick);
  let n = 0, nEn = 0;
  const scanTick = SCAN <= 1 || !c.proto || newRun || (state.tick + s.id) % SCAN === 0;
  for (const e of state.soldiers) {
    const i = e.id;
    if (e.team === s.team || !P.alive[i]) continue;
    nEn++;
    if (!scanTick && i !== c.v0 && i !== c.v1 && i !== c.v2) continue;
    if (n >= seenPool.length) continue;
    const q = seenPool[n++];
    q.id = i; q.bot = 1; q.x = P.x[i]; q.y = P.y[i]; q.z = P.z[i]; q.crouch = P.crouch[i]; q.health = P.health[i];
  }
  const eye = eyeOf(s);
  const tA = TIMING ? Bun.nanoseconds() : 0;
  R[A.nvis] = fillEnemies(R, OWN, ctx.world, clouds as never, eye.x, eye.y, eye.z, yaw, pitch, s.team, seenPool, n, CAP);
  if (TIMING) { tFill += Bun.nanoseconds() - tA; nRow++; }
  if (SCAN > 1) { c.v0 = R[OWN + 6] > 0 ? R[OWN] : -1; c.v1 = R[OWN + SLOT + 6] > 0 ? R[OWN + SLOT] : -1; c.v2 = R[OWN + 2 * SLOT + 6] > 0 ? R[OWN + 2 * SLOT] : -1; }
  R[A.nenemy] = nEn; R[A.hurt] = c.hurt; R[A.nframes] = 1; R[A.tick] = state.tick - liveTick; R[A.aimkey] = s.ads ? 1 : 0;
  R[OV] = R[OWN + 3]; R[OV + 1] = R[OWN + 4]; R[OV + 2] = R[OWN + 6];
  if (c.proto && DELAY > 0 && R[OWN] >= 0 && files) {
    // The slot-0 enemy as a spectator of the server frames sees it now (not DELAY ticks late).
    const e = byId(R[OWN]);
    if (e && e.alive) {
      const sc = 1 - 0.34 * e.m.crouch, dx = e.m.x - eye.x, dz = e.m.z - eye.z, hd = Math.hypot(dx, dz);
      losA.x = eye.x; losA.y = eye.y; losA.z = eye.z; losB.x = e.m.x; losB.y = e.m.y + 1.2 * sc; losB.z = e.m.z;
      R[OV] = wrap(Math.atan2(-dx, -dz) - yaw); R[OV + 1] = Math.atan2(losB.y - eye.y, hd) - pitch;
      let vis = ctx.world.lineOfSight(losA, losB, s.team) ? 1 : 0; losB.y = e.m.y + 1.66 * sc; if (ctx.world.lineOfSight(losA, losB, s.team)) vis |= 2;
      R[OV + 2] = vis;
    } else R[OV + 2] = 0;
  }
  c.lastYaw = s.yaw; c.lastPitch = pitch; c.hasPrev = true;
  if (files) {
    if (c.n + NA > c.buf.length) { const b = new Float32Array(c.buf.length * 2); b.set(c.buf); c.buf = b; }
    c.buf.set(R, c.n); c.n += NA;
  }
  if (c.proto && net) {
    const o = c.st.push(newRun);
    c.st.rows.set(R, o);
    const tB = TIMING ? Bun.nanoseconds() : 0;
    c.st.features(net.x); net.x[NF] = SKILL; if (Z1 > Z0) net.x.fill(0, Z0, Z1);
    if (TIMING) tFeat += Bun.nanoseconds() - tB;
    c.seeing = R[A.nvis] > 0;
    if (c.st.sinceAny < 30) {
      const tC = TIMING ? Bun.nanoseconds() : 0;
      const L = net.forward();
      if (RHO > 0) {
        // The quantile of each sample follows an AR(1) process: the per-tick distribution stays the model's, the path gets smooth.
        const k = Math.sqrt(1 - RHO * RHO);
        c.zy = RHO * c.zy + k * gauss(); c.zp = RHO * c.zp + k * gauss();
        c.dyaw = net.classValue(net.sampleOrdered(L, 0, TEMP, phi(c.zy)), prand());
        c.dpitch = net.classValue(net.sampleOrdered(L, net.nc, TEMP, phi(c.zp)), prand());
      } else {
        c.dyaw = net.classValue(net.sampleClass(L, 0, TEMP, prand()), prand());
        c.dpitch = net.classValue(net.sampleClass(L, net.nc, TEMP, prand()), prand());
      }
      if (EMA > 0) { c.sy = EMA * c.sy + (1 - EMA) * c.dyaw; c.sp = EMA * c.sp + (1 - EMA) * c.dpitch; c.dyaw = c.sy; c.dpitch = c.sp; }
      c.key = prand() < 1 / (1 + Math.exp(-(L[2 * net.nc] - FIREBIAS) / FIRETEMP));
      if (ADSMODEL) c.sights = prand() < 1 / (1 + Math.exp(-L[2 * net.nc + 1]));
      c.act = true;
      if (TIMING) { tFwd += Bun.nanoseconds() - tC; nFwd++; }
    } else { c.act = false; c.sy = 0; c.sp = 0; }
    if (TIMING) { tPolicy += Bun.nanoseconds() - t0; nPolicy++; }
  }
}

const wall0 = Date.now();
let guard = 0;
while (res.rounds < ROUNDS && guard++ < ROUNDS * 30 * 400) {
  const t0 = TIMING ? Bun.nanoseconds() : 0;
  tickMatch(state, ctx, DT);
  if (TIMING && state.phase === 'live' && state.roundPhase === 'live') { tTick += Bun.nanoseconds() - t0; nTick++; }
  afterTick();
}
for (const c of ctls) if (c) flush(c);
if (files) { await files.proto.end(); await files.bot.end(); }
const q = (a: number[], p: number) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return +b[Math.min(b.length - 1, Math.floor(p * b.length))].toFixed(3); };
const sum = (t: ReturnType<typeof T>) => ({
  wins: t.wins, kills: t.kills, deaths: t.deaths, shots: t.shots, hits: t.hits, heads: t.heads, damage: Math.round(t.damage), aliveHours: +(t.aliveTicks / 108000).toFixed(3),
  band: t.bandShots.map((n, i) => n + ':' + (t.bandHits[i] / Math.max(1, n)).toFixed(2)).join(' '), first: [q(t.first, 0.25), q(t.first, 0.5), q(t.first, 0.75)], firstWide: [q(t.firstWide, 0.25), q(t.firstWide, 0.5), q(t.firstWide, 0.75)],
  adsShots: +(t.ads / Math.max(1, t.bandShots.reduce((x, y) => x + y, 0))).toFixed(2), stillShots: +(t.stillShots / Math.max(1, t.bandShots.reduce((x, y) => x + y, 0))).toFixed(2), killsAware: t.duelWin, killsUnaware: t.duelLoss,
  hitRate: +(t.hits / Math.max(1, t.shots)).toFixed(4), ttk: [q(t.ttk, 0.25), q(t.ttk, 0.5), q(t.ttk, 0.75)], killDist: [q(t.killDist, 0.25), q(t.killDist, 0.5), q(t.killDist, 0.75)],
});
const soldiers = state.soldiers.length;
const out = {
  tag: TAG, oldteam: OLDTEAM, loadout: LOADOUT, still: STILL, map: MAP, mode: MODE, size: SIZE, seed: SEED, proto: PROTO, skill: SKILL, temp: TEMP, firetemp: FIRETEMP, delay: DELAY, zero: [Z0, Z1], adsopt: ADSOPT, trigger: TRIGGER, adsmodel: ADSMODEL, ema: EMA, firebias: FIREBIAS, rho: RHO, scan: SCAN, model: PROTO === 'none' ? '' : MODEL, botskill: BOTSKILL, cap: CAP,
  ...res, liveSeconds: Math.round(res.liveSeconds), team0: sum(team[0]), team1: sum(team[1]), wallSeconds: +((Date.now() - wall0) / 1000).toFixed(1), ticks: state.tick, soldiers,
  ...(TIMING ? { timing: {
    liveTicks: nTick, tick_us: +(tTick / nTick / 1000).toFixed(1), tick_us_per_soldier: +(tTick / nTick / 1000 / soldiers).toFixed(2),
    policy_calls: nPolicy, policy_us: +(tPolicy / Math.max(1, nPolicy) / 1000).toFixed(2), fill_us: +(tFill / Math.max(1, nRow) / 1000).toFixed(2), row_calls: nRow, features_us: +(tFeat / Math.max(1, nPolicy) / 1000).toFixed(2),
    forward_calls: nFwd, forward_us: +(tFwd / Math.max(1, nFwd) / 1000).toFixed(2), engaged_share: +(nFwd / Math.max(1, nPolicy)).toFixed(3), before_us_per_live_tick: +(tBefore / Math.max(1, nTick) / 1000).toFixed(2),
  } } : {}),
};
console.log(JSON.stringify(out));
if (OUT) appendFileSync(OUT, JSON.stringify(out) + '\n');
