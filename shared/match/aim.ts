import { clamp, dirFromAngles, wrapAngle } from '../math';
import { AIM_NET } from './aimnet';
import { eyeOf, resolvePellets, resolveShot, smokeBlocks, traceShot, weaponOf, type SimContext } from './combat';
import type { MatchState, Soldier } from './state';

/**
 * The learned aim: a small network, trained on recorded mouse players, that turns the view and holds the trigger of
 * a bot while an enemy is in sight (docs/ARCHITECTURE.md, "Bots"). The bot script (bots.ts) keeps all the rest:
 * where the bot goes, how its body moves, what it buys, the knife, grenades and the bomb.
 *
 * Thirty times a second the network sees what a player sees (the enemies in sight and where they are from the
 * crosshair, how they moved in the last half second, the bot's own weapon, body and last moves of the hand) and gives
 * the chances of each size of the next turn of the hand, and of the trigger being down. The bot draws from those
 * chances, so two bots do not aim alike. Its shots are those of a player's weapon: the spread of the weapon and the
 * recoil that kicks the view, which the network pulls down as the players do.
 *
 * `LEARNED.outcome` is the difficulty: the network was trained with the number of hits the player made in the next
 * 1.5 s as one more input, so asking for many hits picks the way the players aimed when they hit.
 */
export const LEARNED = {
  /** The outcome asked of the network, from -1 (no hit in the next 1.5 s) to 2 (the most it takes), and how much less is asked with a brand-new player in front (bots.ts, rookieEase). */
  outcome: 2, rookie: 3,
  /** Below 1 the bot draws the likely turns more often than the players made them: a steadier hand. */
  steady: 0.8,
  /** How much surer than the players (in log-odds) the network must be before the trigger goes down: the outcome input alone makes the bot fire twice as much as they do. */
  trigger: 1,
  /** All enemies are checked for a line of sight each `look` ticks; between two looks only the ones that were in sight. At most `checks` of them, nearest to the crosshair first. */
  look: 6, checks: 10,
  /** The network runs while an enemy was in sight in the last `after` ticks. */
  after: 30,
};

const DEG = Math.PI / 180;

// ---- The network ----------------------------------------------------------------------

/** The inputs without the outcome, the sizes of a turn (to each side), and the choices of a turn (none, then each size to the left, then to the right). */
const FEATURES = 118, SIZES = AIM_NET.edges.length - 1, CHOICES = 1 + 2 * SIZES;
/** The order of the weapons in the network's input (the order of the weapons when it was trained). */
const WEAPON_INPUT: Record<string, number> = { knife: 0, mp5: 1, m4a1: 2, m1014: 3, m110: 4, m249: 5, m9a1: 6, mp7: 7 };

interface Net { weights: Float32Array[]; biases: Float32Array[]; layers: Float32Array[]; input: Float32Array; logEdges: number[] }
let net: Net | undefined;

/** The bytes of a base64 text (the module's runtime has no atob). */
function bytesOf(text: string): Uint8Array {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', value = new Uint8Array(128);
  for (let i = 0; i < 64; i++) value[letters.charCodeAt(i)] = i;
  const n = text.length / 4 * 3 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0), out = new Uint8Array(n);
  for (let i = 0, o = 0; i < text.length; i += 4) {
    const v = value[text.charCodeAt(i)] << 18 | value[text.charCodeAt(i + 1)] << 12 | value[text.charCodeAt(i + 2)] << 6 | value[text.charCodeAt(i + 3)];
    if (o < n) out[o++] = v >> 16;
    if (o < n) out[o++] = v >> 8 & 255;
    if (o < n) out[o++] = v & 255;
  }
  return out;
}

function loadNet(): Net {
  const bytes = bytesOf(AIM_NET.data), sizes = AIM_NET.sizes;
  let at = 0;
  const take = (n: number, unit: number) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++, at += 2) { const v = bytes[at] | bytes[at + 1] << 8; out[i] = (v > 32767 ? v - 65536 : v) * unit; }
    return out;
  };
  const weights: Float32Array[] = [], biases: Float32Array[] = [];
  for (let l = 0; l + 1 < sizes.length; l++) { weights.push(take(sizes[l] * sizes[l + 1], AIM_NET.weightUnit[l])); biases.push(take(sizes[l + 1], AIM_NET.biasUnit[l])); }
  if (at !== bytes.length || sizes[0] !== FEATURES + 1 || sizes[sizes.length - 1] !== 2 * CHOICES + 1) throw new Error('The aim network does not fit its code');
  return { weights, biases, layers: sizes.slice(1).map(n => new Float32Array(n)), input: new Float32Array(sizes[0]), logEdges: AIM_NET.edges.map(e => Math.log(e)) };
}

/** The network's answer to `net.input` (each input is kept within ±2): the scores of each choice of the turn sideways, then up and down, then of the trigger. */
function answer(net: Net): Float32Array {
  const x = net.input, last = net.weights.length - 1;
  for (let i = 0; i < x.length; i++) x[i] = x[i] > 2 ? 2 : x[i] < -2 ? -2 : x[i];
  let input = x;
  for (let l = 0; l <= last; l++) {
    const w = net.weights[l], b = net.biases[l], out = net.layers[l], nin = input.length, nout = out.length;
    for (let j = 0, o = 0; j < nout; j++, o += nin) {
      let sum = b[j];
      for (let i = 0; i < nin; i++) sum += w[o + i] * input[i];
      out[j] = l < last && sum < 0 ? 0 : sum;
    }
    input = out;
  }
  return input;
}

/** One turn (rad) drawn from the scores of its choices at `from`. `u` and `v` are random numbers in [0, 1): the choice, and the place inside its range of sizes. */
function drawTurn(net: Net, scores: Float32Array, from: number, u: number, v: number): number {
  let most = -Infinity, sum = 0;
  for (let i = 0; i < CHOICES; i++) if (scores[from + i] > most) most = scores[from + i];
  for (let i = 0; i < CHOICES; i++) sum += Math.exp((scores[from + i] - most) / LEARNED.steady);
  let choice = CHOICES - 1;
  for (let i = 0, left = u * sum; i < CHOICES; i++) { left -= Math.exp((scores[from + i] - most) / LEARNED.steady); if (left <= 0) { choice = i; break; } }
  if (choice === 0) return 0;
  const right = choice > SIZES, size = (right ? choice - SIZES : choice) - 1;
  const turn = Math.exp(net.logEdges[size] + (net.logEdges[size + 1] - net.logEdges[size]) * v);
  return right ? -turn : turn;
}

// ---- What a bot remembers ---------------------------------------------------------------
//
// The network looks back 1.5 s. That history is kept here and not in the match state: it would be many numbers to
// store for each bot at each tick, and a bot that loses it (a restarted server) aims again after a moment, as after a spawn.
// It is kept by soldier id: Online ids are unique across the rooms, and Solo has one match. Two matches with the same ids
// that tick in turns in one process (a test, a script) would share it, so play such matches one after the other.

/** Ticks of history kept, and the numbers of one tick: the view, the hand's turn, trigger, shots, damage taken, enemies in sight, then for each of 3 enemies its id, sight, and place from the crosshair (sideways, up). */
const KEEP = 48, ROW = 20, YAW = 0, PITCH = 1, TURN_YAW = 2, TURN_PITCH = 3, FIRE = 4, SHOTS = 5, HURT = 6, IN_SIGHT = 7, ENEMY = 8, ENEMIES = 3, EACH = 4;
/** What the network sees of an enemy now: id, distance, place of its chest from the crosshair (sideways, up), of its head (up), sight (1 chest, 2 head), health. */
const NOW = 7, N_ID = 0, N_DISTANCE = 1, N_YAW = 2, N_CHEST = 3, N_HEAD = 4, N_SIGHT = 5, N_HEALTH = 6;
/** The earlier ticks that the network sees of the first enemy's place, and the spans (ticks) of its speeds across the view. */
const BEFORE = [1, 2, 3, 4, 6, 8, 11, 15], SPEEDS = [1, 3, 6];

interface Memory {
  /** The match tick of the last step, and the count of all steps then (old memories are dropped by it). */
  tick: number; used: number;
  rows: Float32Array; head: number; length: number;
  now: Float32Array;
  /** What the network asked for the next tick. */
  act: boolean; turnYaw: number; turnPitch: number; fire: boolean;
  /** The step turned the view and held the trigger; an enemy is in sight. */
  acted: boolean; seeing: boolean;
  /** The weapon as in a player's hands: how far the sights are up (0 to 1), the bloom (degrees), the recoil not yet settled (rad), the seconds to the next shot, the trigger held, the shots of this pull, and the seconds since a sprint. */
  sights: number; bloom: number; kick: number; wait: number; held: boolean; pull: number; sprinted: number;
  shots: number; health: number; yaw: number; pitch: number;
  /** Ticks since an enemy was in sight. */
  since: number;
}
const memories = new Map<number, Memory>();
let steps = 0;

function memoryOf(bot: Soldier, tick: number): Memory {
  let m = memories.get(bot.id);
  if (!m) {
    // Now and then, drop the memories of bots that are gone.
    if (memories.size >= 512) for (const [id, old] of memories) if (steps - old.used > 4096) memories.delete(id);
    m = {
      tick: -9, used: 0, rows: new Float32Array(KEEP * ROW), head: -1, length: 0, now: new Float32Array(ENEMIES * NOW), act: false, turnYaw: 0, turnPitch: 0, fire: false,
      acted: false, seeing: false, sights: 0, bloom: 0, kick: 0, wait: 0, held: false, pull: 0, sprinted: 0, shots: 0, health: bot.health, yaw: bot.yaw, pitch: bot.pitch, since: LEARNED.after,
    };
    memories.set(bot.id, m);
  }
  // A new life, a new round or another match under the same id: start again.
  if (tick !== m.tick && tick !== m.tick + 1) {
    m.length = 0; m.head = -1; m.act = false; m.acted = false; m.seeing = false; m.fire = false; m.sights = bot.ads ? 1 : 0; m.bloom = 0; m.kick = 0; m.wait = 0; m.held = false; m.pull = 0;
    m.sprinted = 0; m.shots = 0; m.health = bot.health; m.since = LEARNED.after;
  }
  m.used = ++steps;
  return m;
}

/** The turn of the hand of a learned bot in its last tick (the view's turn without the recoil), for the bot bench; nothing for another bot. */
export function handTurn(bot: Soldier): [number, number] | undefined {
  const m = bot.brain?.learned ? memories.get(bot.id) : undefined;
  return m && m.length ? [m.rows[m.head * ROW + TURN_YAW], m.rows[m.head * ROW + TURN_PITCH]] : undefined;
}

// ---- The hand and the weapon ------------------------------------------------------------

/**
 * The start of a learned bot's tick: turn the view and hold the trigger as the network asked at the end of the last
 * tick. Returns nothing when the network has no say (no enemy in sight in the last second, or the knife in hand):
 * the script's hand and trigger act then. `ease`: above 1, the spread of the shots is this much wider (a rookie in front).
 */
export function learnedHand(state: MatchState, ctx: SimContext, bot: Soldier, dt: number, ease: number): { sights: boolean } | undefined {
  const m = memoryOf(bot, state.tick), w = weaponOf(bot);
  m.bloom = Math.max(0, m.bloom - w.spread.recovery * dt * (bot.sinceShot > 0.08 ? 1 : 0.25));
  m.wait = Math.max(-dt, m.wait - dt);
  m.sights = clamp(m.sights + Math.sign((bot.ads ? 1 : 0) - m.sights) * dt / w.adsTime, 0, 1);
  m.sprinted = bot.sprint ? 0.14 : Math.max(0, m.sprinted - dt);
  m.acted = m.act && bot.weapon !== 2;
  if (m.acted) {
    bot.yaw = wrapAngle(bot.yaw + m.turnYaw); bot.pitch = clamp(bot.pitch + m.turnPitch, -1.48, 1.48);
    const trigger = m.fire && !bot.sprint && m.sprinted <= 0;
    if (!trigger) { m.held = false; m.pull = 0; }
    else if (bot.switchLeft <= 0 && bot.reloadLeft <= 0 && m.wait <= 0 && (w.auto || !m.held)) {
      const slot = bot.weapon as 0 | 1;
      if (bot.ammo[slot] <= 0) bot.reloadLeft = w.reload;
      else {
        bot.ammo[slot]--;
        m.wait += w.interval;
        // The spread of a player's weapon: hip or sights, more on the move and in the air, less in a crouch, plus the bloom.
        const moving = Math.hypot(bot.m.vx, bot.m.vz) > 1.5;
        let spread = w.spread.hip + (w.spread.ads - w.spread.hip) * m.sights;
        if (moving) spread += w.spread.moving * (1 - m.sights * 0.65);
        if (!bot.m.grounded) spread += w.spread.air;
        if (bot.m.crouch > 0.5 && !moving) spread *= 0.7;
        spread = w.pellets > 1 ? 0 : (spread + m.bloom * (1 - m.sights * 0.6)) * ease * DEG;
        const a = ctx.random() * Math.PI * 2, r = Math.sqrt(ctx.random()) * spread;
        const eye = eyeOf(bot), dir = dirFromAngles(bot.yaw + Math.cos(a) * r, bot.pitch + Math.sin(a) * r);
        if (w.pellets > 1) resolvePellets(state, ctx, bot, w, eye, dir, m.sights > 0.5);
        else resolveShot(state, ctx, bot, w, eye, traceShot(state, ctx, bot, eye, dir, w.range));
        // The recoil kicks the view, as on a player's screen; the network pulls it down.
        const steady = 1 - m.sights * 0.35;
        const up = w.recoil.pitch * DEG * (0.85 + ctx.random() * 0.3) * steady * (bot.m.crouch > 0.5 ? 0.8 : 1);
        const side = ((w.recoil.pattern.length ? w.recoil.pattern[m.pull % w.recoil.pattern.length] : 0) + (ctx.random() - 0.5) * 0.6) * w.recoil.yaw * DEG * steady;
        bot.pitch = Math.min(1.48, bot.pitch + up); bot.yaw = wrapAngle(bot.yaw - side); m.kick += up;
        m.bloom = Math.min(w.spread.bloomMax, m.bloom + w.spread.bloomPerShot);
        bot.sinceShot = 0; bot.fireCooldown = w.interval; m.pull++; m.shots++;
      }
      m.held = true;
    }
  } else { m.held = false; m.pull = 0; }
  // The view settles after the recoil, as a player's does.
  if (bot.sinceShot > 0.12 && m.kick > 0) { const back = Math.min(m.kick, m.kick * (1 - Math.exp(-w.recoil.recover * dt))); bot.pitch -= back * 0.72; m.kick -= back; }
  return m.acted ? { sights: m.fire || m.seeing } : undefined;
}

// ---- The eyes and the network -----------------------------------------------------------

interface Candidate { s: Soldier; angle: number; distance: number; yaw: number; chest: number; head: number; sight: number }
const candidates: Candidate[] = [], pool: Candidate[] = [];
const chest = { x: 0, y: 0, z: 0 }, head = { x: 0, y: 0, z: 0 };
const was = new Uint8Array(30), wasYaw = new Float64Array(30), wasPitch = new Float64Array(30);

/**
 * The end of a learned bot's tick: look at the enemies, and ask the network for the next tick's turn and trigger.
 * `outcome`: what is asked of the network (LEARNED.outcome, less with a rookie in front).
 */
export function learnedLook(state: MatchState, ctx: SimContext, bot: Soldier, outcome: number) {
  const m = memoryOf(bot, state.tick), fresh = m.length === 0, w = weaponOf(bot);
  const yaw = wrapAngle(bot.yaw), pitch = bot.pitch, eye = eyeOf(bot);

  // 1. The enemies: the place of each from the crosshair, and a line of sight to its chest and its head (smoke blocks it).
  const look = fresh || (state.tick + bot.id) % LEARNED.look === 0;
  const cp = Math.cos(pitch), fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp;
  const last = m.head >= 0 ? m.head * ROW + ENEMY : -1;
  candidates.length = 0;
  for (const s of state.soldiers) {
    if (s.team === bot.team || !s.alive) continue;
    if (!look && !(last >= 0 && ((m.rows[last] === s.id && m.rows[last + 1] > 0) || (m.rows[last + EACH] === s.id && m.rows[last + EACH + 1] > 0) || (m.rows[last + 2 * EACH] === s.id && m.rows[last + 2 * EACH + 1] > 0)))) continue;
    const stand = 1 - 0.34 * s.m.crouch, dx = s.m.x - eye.x, dy = s.m.y + 1.2 * stand - eye.y, dz = s.m.z - eye.z, distance = Math.hypot(dx, dy, dz);
    if (distance > 120 || distance < 0.05) continue;
    const flat = Math.hypot(dx, dz), c = pool[candidates.length] ??= { s, angle: 0, distance: 0, yaw: 0, chest: 0, head: 0, sight: 0 };
    c.s = s; c.distance = distance; c.angle = Math.acos(clamp((dx * fx + dy * fy + dz * fz) / distance, -1, 1));
    c.yaw = wrapAngle(Math.atan2(-dx, -dz) - yaw); c.chest = Math.atan2(dy, flat) - pitch; c.head = Math.atan2(s.m.y + 1.66 * stand - eye.y, flat) - pitch; c.sight = 0;
    candidates.push(c);
  }
  if (candidates.length > LEARNED.checks) { candidates.sort((a, b) => a.angle - b.angle); candidates.length = LEARNED.checks; }
  const smoke = state.bodies.length > 0;
  let inSight = 0;
  for (const c of candidates) {
    const s = c.s, stand = 1 - 0.34 * s.m.crouch;
    chest.x = head.x = s.m.x; chest.z = head.z = s.m.z; chest.y = s.m.y + 1.2 * stand; head.y = s.m.y + 1.66 * stand;
    if (ctx.world.lineOfSight(eye, chest, bot.team) && !(smoke && smokeBlocks(state.bodies, eye, chest))) c.sight |= 1;
    if (ctx.world.lineOfSight(eye, head, bot.team) && !(smoke && smokeBlocks(state.bodies, eye, head))) c.sight |= 2;
    if (c.sight) inSight++;
  }
  // In sight first, then the nearest to the crosshair.
  candidates.sort((a, b) => (a.sight ? 0 : 1) - (b.sight ? 0 : 1) || a.angle - b.angle);

  // 2. This tick's row of the history.
  m.head = (m.head + 1) % KEEP;
  if (m.length < KEEP) m.length++;
  const R = m.rows, r0 = m.head * ROW, now = m.now;
  R[r0 + YAW] = yaw; R[r0 + PITCH] = pitch;
  R[r0 + TURN_YAW] = m.acted ? m.turnYaw : fresh ? 0 : wrapAngle(bot.yaw - m.yaw); R[r0 + TURN_PITCH] = m.acted ? m.turnPitch : fresh ? 0 : pitch - m.pitch;
  R[r0 + FIRE] = (m.acted ? m.fire : bot.sinceShot < 0.15) ? 1 : 0; R[r0 + SHOTS] = m.shots; R[r0 + HURT] = Math.max(0, m.health - bot.health); R[r0 + IN_SIGHT] = inSight;
  for (let j = 0; j < ENEMIES; j++) {
    const c = candidates[j], p = r0 + ENEMY + j * EACH, q = j * NOW;
    if (!c) { R[p] = -1; R[p + 1] = 0; R[p + 2] = 0; R[p + 3] = 0; now[q + N_ID] = -1; now[q + N_SIGHT] = 0; continue; }
    R[p] = c.s.id; R[p + 1] = c.sight; R[p + 2] = c.yaw; R[p + 3] = c.chest;
    now[q + N_ID] = c.s.id; now[q + N_DISTANCE] = c.distance; now[q + N_YAW] = c.yaw; now[q + N_CHEST] = c.chest; now[q + N_HEAD] = c.head; now[q + N_SIGHT] = c.sight; now[q + N_HEALTH] = c.s.health;
  }
  m.tick = state.tick; m.shots = 0; m.health = bot.health; m.yaw = bot.yaw; m.pitch = pitch; m.seeing = inSight > 0;

  // 3. What the network sees. The order and the scales are those of its training.
  net ??= loadNet();
  const x = net.input, n = m.length, at = (ago: number) => ((m.head - ago + KEEP * 2) % KEEP) * ROW;
  x.fill(0);
  x[WEAPON_INPUT[w.id] ?? 1] = 1;
  let c = 8, hurt = 0, shots = 0;
  for (let ago = 0; ago < 15 && ago < n; ago++) { const o = at(ago); hurt += R[o + HURT]; shots += R[o + SHOTS]; }
  const ammo = bot.weapon === 2 ? 0 : bot.ammo[bot.weapon], speed = Math.hypot(bot.m.vx, bot.m.vz);
  x[c] = bot.ads ? 1 : 0; x[c + 1] = bot.m.crouch; x[c + 2] = speed / 8;
  x[c + 3] = (bot.m.vx * -Math.sin(yaw) + bot.m.vz * -Math.cos(yaw)) / 8; x[c + 4] = (bot.m.vx * Math.cos(yaw) + bot.m.vz * -Math.sin(yaw)) / 8;
  x[c + 5] = bot.m.grounded ? 1 : 0; x[c + 6] = bot.health / 100; x[c + 7] = Math.min(ammo, 100) / 100; x[c + 8] = ammo <= 0 ? 1 : 0; x[c + 9] = bot.reloadLeft > 0 ? 1 : 0;
  x[c + 10] = Math.min(inSight, 3) / 3; x[c + 11] = pitch / 1.3; x[c + 12] = Math.min(hurt, 100) / 100;
  c += 13;
  // The enemies in sight.
  for (let j = 0; j < ENEMIES; j++, c += 11) {
    const q = j * NOW, sight = now[q + N_SIGHT];
    if (!(sight > 0 && now[q + N_ID] >= 0)) continue;
    const ey = now[q + N_YAW], ec = now[q + N_CHEST];
    x[c] = 1; x[c + 1] = sight & 1 ? 1 : 0; x[c + 2] = sight & 2 ? 1 : 0;
    x[c + 3] = Math.tanh(ey / 0.06); x[c + 4] = Math.tanh(ey / 0.4); x[c + 5] = ey / Math.PI;
    x[c + 6] = Math.tanh(ec / 0.06); x[c + 7] = Math.tanh(ec / 0.4);
    x[c + 8] = clamp((now[q + N_HEAD] - ec) / 0.1, 0, 3) / 3; x[c + 9] = Math.log1p(now[q + N_DISTANCE]) / 5; x[c + 10] = now[q + N_HEALTH] / 100;
  }
  // Where the first enemy was in the ticks before, and how fast it crossed the view.
  const first = R[r0 + ENEMY];
  for (let ago = 0; ago < 30; ago++) {
    was[ago] = 0;
    if (first < 0 || ago >= n) continue;
    const o = at(ago) + ENEMY;
    for (let j = 0; j < ENEMIES; j++) { const p = o + j * EACH; if (R[p] === first && R[p + 1] > 0) { was[ago] = 1; wasYaw[ago] = R[p + 2]; wasPitch[ago] = R[p + 3]; break; } }
  }
  for (const ago of BEFORE) {
    if (was[ago]) { x[c] = 1; x[c + 1] = Math.tanh(wasYaw[ago] / 0.2); x[c + 2] = Math.tanh(wasPitch[ago] / 0.2); }
    c += 3;
  }
  for (const ago of SPEEDS) {
    if (was[0] && was[ago]) {
      const o = at(ago);
      x[c] = Math.tanh(wrapAngle((yaw + wasYaw[0]) - (R[o + YAW] + wasYaw[ago])) * 30 / ago / 1.5);
      x[c + 1] = Math.tanh(((pitch + wasPitch[0]) - (R[o + PITCH] + wasPitch[ago])) * 30 / ago / 1.5);
    }
    c += 2;
  }
  // For how long it has been in sight, and the ticks since any enemy was.
  let seenFor = 0, since = LEARNED.after;
  while (seenFor < 30 && was[seenFor]) seenFor++;
  for (let ago = 0; ago < 30 && ago < n; ago++) if (R[at(ago) + IN_SIGHT] > 0) { since = ago; break; }
  m.since = since;
  x[c] = seenFor / 30; x[c + 1] = seenFor >= 3 ? 1 : 0; x[c + 2] = seenFor >= 6 ? 1 : 0; x[c + 3] = seenFor >= 9 ? 1 : 0; x[c + 4] = seenFor >= 12 ? 1 : 0; x[c + 5] = seenFor >= 18 ? 1 : 0;
  x[c + 6] = since / 30;
  c += 7;
  // The hand's own turns before.
  for (let ago = 0; ago < 4; ago++, c += 4) {
    if (ago >= n) continue;
    const o = at(ago), a = R[o + TURN_YAW], b = R[o + TURN_PITCH];
    x[c] = Math.tanh(a / 0.01); x[c + 1] = Math.tanh(a / 0.1); x[c + 2] = Math.tanh(b / 0.01); x[c + 3] = Math.tanh(b / 0.1);
  }
  let turnYaw = 0, turnPitch = 0;
  for (let ago = 4; ago < 8 && ago < n; ago++) { const o = at(ago); turnYaw += R[o + TURN_YAW]; turnPitch += R[o + TURN_PITCH]; }
  x[c] = Math.tanh(turnYaw / 0.1); x[c + 1] = Math.tanh(turnPitch / 0.1);
  turnYaw = 0; turnPitch = 0;
  for (let ago = 8; ago < 16 && ago < n; ago++) { const o = at(ago); turnYaw += R[o + TURN_YAW]; turnPitch += R[o + TURN_PITCH]; }
  x[c + 2] = Math.tanh(turnYaw / 0.2); x[c + 3] = Math.tanh(turnPitch / 0.2);
  c += 4;
  // The trigger before.
  for (let ago = 0; ago < 3 && ago < n; ago++) x[c + ago] = R[at(ago) + FIRE];
  let held = 0, sinceFire = 45;
  while (held < 45 && held < n && R[at(held) + FIRE] > 0) held++;
  for (let ago = 0; ago < 45 && ago < n; ago++) if (R[at(ago) + FIRE] > 0) { sinceFire = ago; break; }
  x[c + 3] = held / 45; x[c + 4] = sinceFire / 45; x[c + 5] = R[r0 + SHOTS] > 0 ? 1 : 0; x[c + 6] = Math.min(shots / 10, 2);
  x[FEATURES] = outcome;

  // 4. The next tick's turn and trigger, while an enemy was in sight in the last second.
  m.act = since < LEARNED.after;
  if (!m.act) return;
  const scores = answer(net);
  m.turnYaw = drawTurn(net, scores, 0, ctx.random(), ctx.random());
  m.turnPitch = drawTurn(net, scores, CHOICES, ctx.random(), ctx.random());
  m.fire = ctx.random() < 1 / (1 + Math.exp(LEARNED.trigger - scores[2 * CHOICES]));
}

/** For the check of the training tools against this file: the input that the network saw at the last look (the features, then the outcome). */
export const aimInput = (): Float32Array => (net ??= loadNet()).input;

/** For tests: the network's scores for one input (the features, then the outcome). */
export function aimScores(input: ArrayLike<number>): Float32Array {
  net ??= loadNet();
  net.input.set(input);
  return answer(net);
}
