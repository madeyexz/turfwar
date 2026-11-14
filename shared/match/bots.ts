import { chestPoint } from '../hitbox';
import { clamp, dirFromAngles, wrapAngle, type Vec3 } from '../math';
import { MOVE, stepMovement, type MoveInput } from '../movement';
import { peekOf } from '../peek';
import { blocksHeight, near, penetration, type Obstacle } from '../obstacles';
import { GRENADE, STAMINA } from '../weapons';
import { LEARNED, learnedHand, learnedLook } from './aim';
import { eyeOf, feetOf, onSite, shapeOf, resolvePellets, resolveShot, sideOf, smokeBlocks, spreadFor, throwGrenadeFrom, traceShot, weaponOf, type SimContext } from './combat';
import { fireNear, throwMolotovFrom } from './fire';
import { findPath, nearestNode } from './nav';
import { PLACES, PLACE_WEIGHTS } from './places';
import { ATTACKERS, type BotBrain, type MatchState, type Soldier } from './state';

/** Distance (m) from a bomb site's centre at which a bot stops to arm or disarm. */
const SITE_STOP = 3;
/** Rounds played before a player stops being a rookie (bots go easier on rookies). */
export const ROOKIE_ROUNDS = 10;
/**
 * How much easier bots are on rookies: extra reaction time (s) for a brand-new player, tapering to none
 * at ROOKIE_ROUNDS (rookieEase), and multipliers on the first aim error and on spread while still a rookie.
 */
export const ROOKIE_EASE = { reaction: 0.6, aimError: 2, spread: 1.5 };

/** 1 for a player with no rounds yet, falling evenly to 0 at ROOKIE_ROUNDS (career rounds at joining + rounds here). */
export function rookieEase(s: Soldier): number {
  if (s.rookieRounds === undefined) return 0;
  return clamp(1 - (s.rookieRounds + s.roundsHere) / ROOKIE_ROUNDS, 0, 1);
}

/** Path hops this short that rise or drop more than 1.5 m are ladders (see nav). */
const SPACING_LADDER = 2;

/**
 * The bots copy the habits of recorded mouse players, so that they play like people; the skill still sets how
 * strong a bot is. The numbers in the comments below are the players' (docs/DEVELOPMENT.md, "Bot bench", has the
 * check that compares the bots with them). Distances are metres, angles radians, times seconds.
 */
const NOTICE = {
  /** Shortest time from the first sight of an enemy to the first move of the aim, and what a bot of no skill adds. */
  base: 0.08, slow: 0.12,
  /** Added per radian between the enemy and the centre of the view (players' first shot: 0.67 s head-on, 1.67 s at 0.75 to 1.6 rad). */
  angle: 0.3,
  /** Mean of the long tail on top (the first move of the aim: 0.37 s at the median, but the upper quarter is past 0.8 s). */
  tail: 0.1, tailSlow: 0.25,
  /**
   * Chance of a late notice = late × √angle (a bot of no skill: `lateSlow` more), plus `far` beyond 30 m: players engage
   * 90% of the enemies in the middle of the view inside 3 s, 61% at 0.3 to 0.75 rad and 39% at 0.75 to 1.6 rad.
   * The wait is 0.5 to 1.5 × lateTime.
   */
  late: 0.12, lateSlow: 0.15, far: 0.05, lateTime: 2.4,
  /** A hit from the enemy cuts what is left of the wait to this, plus `wakeSlow` for a bot of no skill. */
  wake: 0.2, wakeSlow: 0.2,
};
const AIM = {
  /**
   * Median distance (m) between the aim point and the enemy's chest, sideways, for a bot of no skill: `error + errorFar × distance`
   * (players' shots at a slow enemy: 0.22 m off under 5 m, 0.34 m at 8 to 15 m, 0.49 m at 30 to 60 m). Skill divides it by 1 + sharp × skill.
   */
  error: 0.22, errorFar: 0.006, sharp: 6,
  /** The first aim point at an enemy is looser (players: 1.3 m off half a second before the first shot); each next one keeps this share of the last error. */
  first: 2, keep: 0.6,
  /** The aim point is this far above the chest's middle (m), more with skill; the error up and down is this share of the sideways one. */
  up: 0.1, vertical: 0.6,
  /** Seconds between two aim points at full skill, and what a bot of no skill adds. */
  every: 0.3, everySlow: 0.2,
  /**
   * A move of the hand goes to where the enemy will be when the move ends, by this share (more with skill): players are behind an enemy
   * that crosses their view (by 0.035 s of its way under 5 m, 0.07 to 0.12 s beyond).
   */
  lead: 0.5, leadSkill: 0.5,
  /** The hand leaves the view alone while it is within `rest` m of the aim point (and never corrects less than `fine` rad). */
  rest: 0.06, fine: 0.004,
  /** The trigger goes down when the view is within `fire` m of the enemy as the bot sees it (and never needs less than `fireMin` rad). */
  fire: 0.6, fireMin: 0.02,
};
const HAND = {
  /**
   * A player's hand turns the view in short moves, with rests between them. Seconds: the shortest move and the mean of what comes on
   * top (players: 0.13 s at the median, 0.19 s at the mean), and the mean rest after a move with no enemy in sight, with one, and with
   * the trigger down (players: 0.1 s, 0.07 s and 0.07 s at the median).
   */
  moveLeast: 0.05, move: 0.11, rest: 0.1, restSeen: 0.07, restFire: 0.05,
  /** One move covers this share of the way to where the bot wants to look, or up to `gainMore` more; the next move corrects what is left. */
  gain: 0.75, gainMore: 0.35,
  /** No hand moves straight: a move takes the view up or down by up to this share of its sideways part (players: 0.3 at the median), but not more than `tiltMost` rad. */
  tilt: 0.4, tiltMost: 0.05,
  /** The fastest turn (rad/s): a longer way takes a longer move (players: 10.5 rad/s in the fastest 1% of the ticks). */
  flick: 12,
};
const FIRE = {
  /** Share of the recoil climb that the hand does not pull down (players cancel 0.79), over at most this many shots. */
  climb: 0.21, climbShots: 6,
  /** A burst ends after any shot past `min` with this chance (players: 9 to 10 shots at the median under 15 m, 8 to 30 m, 4 to 60 m, 2 beyond). */
  stop: 0.09, stopFar: 0.2, stopVeryFar: 0.4, min: 2,
  /** Seconds between bursts: a floor, what a bot of no skill adds, and the mean of the tail (players: 0.57 s at the median). */
  pause: 0.15, pauseSlow: 0.1, pauseTail: 0.1, pauseTailSlow: 0.15,
  /** The finger comes off late: the chance per shot to stop once the enemy is out of sight or down (17% of the players' shots have no enemy in sight). */
  release: 0.4,
};
const BODY = {
  /** Share of the bots that aim down the sights at a distance: `ads + adsPerMetre × distance` (players: 26% of the shots under 5 m, 66% at 8 to 15 m, 87% beyond 30 m). */
  ads: 0.2, adsPerMetre: 0.035, adsMost: 0.92,
  /** Chance to stand still in a fight (players: 15% of the shots under 5 m, 28% at 8 to 15 m, 55% beyond 30 m); of the rest, this share strafes and the others keep to their way. */
  still: 0.1, stillPerMetre: 0.013, stillLeast: 0.15, stillMost: 0.6, strafeShare: 0.6,
  /** Seconds one of these lasts before the next choice (players change side 0.17 times per second). */
  strafe: 1.5, strafeMore: 3,
  /** The view rests this far below level when no enemy is engaged (players: 0.09 at the median). It is on the way `ahead` path steps in front (2.5 m each), and the hand moves it once it is more than `slack` rad off. */
  rest: 0.04, restMore: 0.1, ahead: 3, slack: 0.03,
  /**
   * Bots sprint out of the base until the round clock is at this (s), and to an armed bomb; they walk otherwise (players sprint 14%
   * of the time). The clock starts with the 4 s freeze, so this is the first 3 s of play.
   */
  dash: 7,
  /** An attacker looks round the bomb site for this long (s, and up to `plantMore` longer) before it starts to arm (players arm at 35 s into the round at the median). */
  plant: 2, plantMore: 6,
};
const DEG = Math.PI / 180;
/** The median size of a normal number, in standard deviations. */
const MEDIAN = 0.674;

/** A fixed number in [0, 1) per bot and habit: players differ from each other, and each keeps to their habits. */
const habit = (bot: Soldier, n: 0 | 1 | 2) => (bot.id * (n === 0 ? 0.6180339887 : n === 1 ? 0.4142135624 : 0.7320508076)) % 1;

/** The share of a move of the hand that is done after the share `u` of its time: the hand speeds up, then slows down. */
const ease = (u: number) => u * u * (3 - 2 * u);

/**
 * One tick of the hand on the view. `toYaw` and `toPitch` (rad) are the way to where the bot wants to look. A move starts when the
 * rest after the last one is over and the view is more than `slack` rad off; it is then carried out as it was planned, so the view
 * is behind something that moves. `rest`: the mean rest (s); one shorter than half a tick is no rest, so the hand can turn back at
 * once when it went too far. `drift`: how fast (rad/s) the thing crosses the view.
 */
function turnView(ctx: SimContext, bot: Soldier, brain: BotBrain, toYaw: number, toPitch: number, slack: number, rest: number, drift: number, dt: number) {
  let left = brain.handLeft ?? 0;
  if (left <= 0) {
    const wait = brain.handRest ?? 0;
    if (wait > dt * 0.5) { brain.handRest = wait - dt; return; }
    if (Math.hypot(toYaw, toPitch) <= slack) return;
    left = Math.max(dt, HAND.moveLeast - Math.log(1 - ctx.random()) * HAND.move);
    const gain = HAND.gain + ctx.random() * HAND.gainMore;
    const yaw = (toYaw + drift * left) * gain;
    const pitch = toPitch * gain + (ctx.random() * 2 - 1) * Math.min(HAND.tiltMost, HAND.tilt * Math.abs(yaw));
    left = Math.max(left, Math.hypot(yaw, pitch) / HAND.flick);
    brain.handYaw = yaw; brain.handPitch = pitch;
    brain.handRest = -Math.log(1 - ctx.random()) * rest; brain.handFor = left;
  }
  // The share of what is left of the move that this tick does.
  const all = Math.max(left, brain.handFor ?? left), from = 1 - left / all, to = from + dt / all;
  const share = to >= 1 ? 1 : (ease(to) - ease(from)) / (1 - ease(from)), yaw = brain.handYaw! * share, pitch = brain.handPitch! * share;
  bot.yaw = wrapAngle(bot.yaw + yaw); bot.pitch = clamp(bot.pitch + pitch, -1.3, 1.3);
  brain.handYaw! -= yaw; brain.handPitch! -= pitch; brain.handLeft = left - dt;
}

const CALLSIGNS = [
  'Halcyon', 'Vex', 'Marrow', 'Kestrel', 'Onyx', 'Sable', 'Rook', 'Cinder', 'Talon', 'Wren', 'Juno', 'Brask',
  'Ember', 'Quill', 'Nyx', 'Dagger', 'Lumen', 'Shrike', 'Vesper', 'Atlas', 'Mako', 'Pike', 'Orrin', 'Zephyr',
];

export function botName(state: MatchState, random: () => number) {
  const used = new Set(state.soldiers.map(s => s.name));
  for (let i = 0; i < 40; i++) {
    const name = CALLSIGNS[Math.floor(random() * CALLSIGNS.length)];
    if (!used.has(name)) return name;
  }
  // Big battles outnumber the callsigns: number them like squad members instead.
  for (let i = 0; i < 200; i++) {
    const name = `${CALLSIGNS[Math.floor(random() * CALLSIGNS.length)]}-${2 + Math.floor(random() * 8)}`;
    if (!used.has(name)) return name;
  }
  return `Unit-${state.nextId}`;
}

export function createBrain(skill: number): BotBrain {
  return {
    skill, goal: '', goalLeft: 0, goalX: 0, goalZ: 0, path: [], pathIndex: 0, repath: 0, target: -1, reaction: 0, lastSeen: -99,
    seenX: 0, seenY: 0, seenZ: 0, aimYaw: 0, aimPitch: 0, errYaw: 0, errPitch: 0, strafe: 1, strafeLeft: 0,
    crouchLeft: 0, burst: 0, burstPause: 0, stuck: 0, lastX: 0, lastY: 0, lastZ: 0, think: 0, grenadeCooldown: 6, jump: false,
  };
}

const yawTo = (from: Vec3, to: Vec3) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

const sabotageOn = (state: MatchState, ctx: SimContext) => state.config.mode === 'sabotage' && !!ctx.map.sabotage?.sites.length;

/** Bomb site centres for this map, in site order. */
function sitesOf(ctx: SimContext) {
  return (ctx.map.sabotage?.sites ?? []).map(id => ctx.map.points.find(p => p.id === id)!);
}

/** A place of the players stays a bot's goal for at most `time` s (enough to walk there), and the goal is within `near` m of it. */
const PLACE = { time: 40, near: 2.5 };

/**
 * Choose where to go. Elimination: go where recorded players stay on this side of the map (places.ts; a map
 * without that table sweeps its landmarks toward the enemy), then hunt the nearest enemy once the round drags
 * on (a timed-out round is a replay). Sabotage: Militia pushes the round's site and arms it; SWAT spreads over
 * the sites, and everyone converges on an armed bomb.
 */
function chooseGoal(state: MatchState, ctx: SimContext, bot: Soldier, brain: BotBrain) {
  brain.repath = 0;
  brain.goalLeft = 8 + ctx.random() * 8;
  if (sabotageOn(state, ctx)) {
    const sites = sitesOf(ctx);
    const attacking = bot.team === ATTACKERS;
    // Attackers commit to one site per round; defenders split between the sites.
    let site = state.bomb.armed || state.bomb.site >= 0 ? state.bomb.site
      : attacking ? state.round % sites.length : bot.id % sites.length;
    if (site < 0) site = 0;
    const p = sites[site];
    const near = attacking || state.bomb.armed ? SITE_STOP * 0.4 : p.radius * 0.8;
    const angle = ctx.random() * Math.PI * 2, r = ctx.random() * near;
    brain.goal = 'site'; brain.goalX = p.x + Math.cos(angle) * r; brain.goalZ = p.z + Math.sin(angle) * r; brain.goalY = p.y;
    return;
  }
  const enemies = state.soldiers.filter(s => s.alive && s.team !== bot.team);
  if (enemies.length && (state.roundClock > 35 || ctx.random() < 0.25)) {
    let nearest = enemies[0], best = Infinity;
    for (const e of enemies) { const d = Math.hypot(e.m.x - bot.m.x, e.m.z - bot.m.z); if (d < best) { best = d; nearest = e; } }
    brain.goal = 'hunt'; brain.goalX = nearest.m.x; brain.goalZ = nearest.m.z; brain.goalY = nearest.m.y; brain.goalLeft = 4 + ctx.random() * 3;
    return;
  }
  // The places of the players on this side of the map, each by its share of their time.
  const places = PLACES[ctx.map.id]?.[sideOf(state, ctx.map, bot.team)];
  if (places) {
    let at = 0, left = ctx.random() * PLACE_WEIGHTS - places[3];
    while (left >= 0 && at + 4 < places.length) { at += 4; left -= places[at + 3]; }
    const angle = ctx.random() * Math.PI * 2, r = ctx.random() * PLACE.near;
    brain.goal = 'roam'; brain.goalX = places[at] + Math.cos(angle) * r; brain.goalZ = places[at + 2] + Math.sin(angle) * r; brain.goalY = places[at + 1];
    brain.goalLeft = PLACE.time;
    return;
  }
  // Landmarks, weighted toward the enemy's half of the map.
  const enemyBase = ctx.map.spawns.filter(p => p.team === sideOf(state, ctx.map, (1 - bot.team) as 0 | 1));
  const ex = enemyBase.reduce((a, p) => a + p.x, 0) / (enemyBase.length || 1), ez = enemyBase.reduce((a, p) => a + p.z, 0) / (enemyBase.length || 1);
  let best = ctx.map.points[0], bestScore = -Infinity;
  for (const p of ctx.map.points) {
    const score = -Math.hypot(p.x - ex, p.z - ez) / 120 - Math.hypot(p.x - bot.m.x, p.z - bot.m.z) / 200 + ctx.random() * 0.9;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  const angle = ctx.random() * Math.PI * 2, r = ctx.random() * best.radius;
  brain.goal = 'roam'; brain.goalX = best.x + Math.cos(angle) * r; brain.goalZ = best.z + Math.sin(angle) * r; brain.goalY = best.y;
}

function plan(ctx: SimContext, bot: Soldier, brain: BotBrain, tx: number, ty: number, tz: number) {
  if (!ctx.nav) return;
  const start = nearestNode(ctx.nav, bot.m.x, bot.m.y, bot.m.z);
  const goal = nearestNode(ctx.nav, tx, ty, tz);
  brain.path = findPath(ctx.nav, start, goal);
  brain.pathIndex = brain.path.length > 1 ? 1 : 0;
}

/** Find the most pressing visible enemy. */
/** Line-of-sight checks one bot may spend per look; big battles have many candidates in view. */
const SIGHT_CHECKS = 4;

function perceive(state: MatchState, ctx: SimContext, bot: Soldier, brain: BotBrain) {
  const eye = eyeOf(bot);
  // Cheap filters first (range, field of view), then ray-test only the most pressing few.
  const candidates: { s: Soldier; score: number }[] = [];
  for (const s of state.soldiers) {
    if (!s.alive || s.team === bot.team) continue;
    const dx = s.m.x - bot.m.x, dz = s.m.z - bot.m.z;
    const d = Math.hypot(dx, dz);
    if (d > 95) continue;
    const facing = Math.abs(wrapAngle(yawTo(eye, s.m) - bot.yaw));
    const recentlyHit = bot.lastAttacker === s.id && bot.sinceHit < 2;
    if (facing > 1.25 && d > 11 && !recentlyHit) continue;
    candidates.push({ s, score: d * (facing > 1.25 ? 1.6 : 1) * (s.id === brain.target ? 0.7 : 1) * (recentlyHit ? 0.5 : 1) });
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const { s } of candidates.slice(0, SIGHT_CHECKS)) {
    // A soldier peeking round cover shows its head and shoulder, not its chest.
    const shape = shapeOf(ctx, s);
    const chest = peekOf(ctx.world, s) ? shape.chestTop : chestPoint(feetOf(s), s.m.crouch);
    const head = shape.head;
    // Smoke hides: a bot sees through a cloud no better than a player does.
    if ((ctx.world.lineOfSight(eye, chest, bot.team) && !smokeBlocks(state.bodies, eye, chest))
      || (ctx.world.lineOfSight(eye, head, bot.team) && !smokeBlocks(state.bodies, eye, head))) return s;
  }
  return undefined;
}

/** How far ahead (m) a bot looks for a vehicle body across its way. */
const AVOID_AHEAD = [0.5, 1.1, 1.8];

/**
 * Steer round the first vehicle body the next couple of metres toward (moveX, moveZ) would walk
 * into: along its side that turns least from the way we want to go (ties broken by the bot's id).
 */
export function avoidObstacles(bot: Soldier, obstacles: readonly Obstacle[], moveX: number, moveZ: number): [number, number] {
  const len = Math.hypot(moveX, moveZ);
  if (len < 0.05) return [moveX, moveZ];
  const dx = moveX / len, dz = moveZ / len, r = MOVE.radius + 0.15;
  for (const ob of obstacles) {
    if (!near(ob, bot.m.x, bot.m.z, AVOID_AHEAD[2] + r) || !blocksHeight(ob, bot.m.y, MOVE.standHeight)) continue;
    if (!AVOID_AHEAD.some(t => penetration(ob, bot.m.x + dx * t, bot.m.z + dz * t, r).depth > 0)) continue;
    // Tangents round the body's centre; take the one closer to where we are heading.
    const cx = ob.x - bot.m.x, cz = ob.z - bot.m.z, cl = Math.hypot(cx, cz) || 1;
    const lx = -cz / cl, lz = cx / cl;
    const dot = lx * dx + lz * dz;
    const side = Math.abs(dot) > 0.05 ? Math.sign(dot) : bot.id % 2 ? 1 : -1;
    // Lean a little away from the body too, so the bot clears its corners instead of grinding along them.
    const ax = lx * side - cx / cl * 0.35 + dx * 0.2, az = lz * side - cz / cl * 0.35 + dz * 0.2, al = Math.hypot(ax, az) || 1;
    return [ax / al * len, az / al * len];
  }
  return [moveX, moveZ];
}

/** `obstacles`: the vehicles' bodies this tick (bots walk round them, and are pushed by them like anyone). */
export function updateBot(state: MatchState, ctx: SimContext, bot: Soldier, dt: number, obstacles?: readonly Obstacle[]) {
  const brain = bot.brain!;
  if (!bot.alive || dt <= 0) return;
  brain.think -= dt; brain.repath -= dt; brain.strafeLeft -= dt; brain.crouchLeft -= dt;
  brain.burstPause -= dt; brain.grenadeCooldown -= dt; brain.reaction -= dt;
  const slow = 1 - brain.skill;

  // ---- Perception -----------------------------------------------------------------
  let target = state.soldiers.find(s => s.id === brain.target && s.alive);
  // A hit gets the bot's attention: the enemy in view has it at once, and for anyone else the bot looks round now.
  if (bot.sinceHit < dt * 1.5) {
    if (bot.lastAttacker === brain.target) brain.reaction = Math.min(brain.reaction, NOTICE.wake + slow * NOTICE.wakeSlow);
    else brain.think = 0;
  }
  if (brain.think <= 0) {
    brain.think = 0.2 + ctx.random() * 0.15;
    const seen = perceive(state, ctx, bot, brain);
    if (seen) {
      if (seen.id !== brain.target) {
        brain.target = seen.id;
        // How long the bot takes to notice the enemy: longer off the centre of its view, and now and then much longer.
        // Rookies (new players) get a beat on top, so their first fights are winnable. The draws do not depend on the enemy.
        const off = Math.abs(wrapAngle(yawTo(bot.m, seen.m) - bot.yaw));
        const tail = -Math.log(1 - ctx.random()) * (NOTICE.tail + slow * NOTICE.tailSlow), late = ctx.random(), lateFor = 0.5 + ctx.random();
        if (bot.lastAttacker === seen.id && bot.sinceHit < 2) brain.reaction = NOTICE.wake + slow * NOTICE.wakeSlow + tail * 0.5;
        else {
          const chance = (NOTICE.late + slow * NOTICE.lateSlow) * Math.sqrt(off) + (Math.hypot(seen.m.x - bot.m.x, seen.m.z - bot.m.z) > 30 ? NOTICE.far : 0);
          brain.reaction = NOTICE.base + slow * NOTICE.slow + Math.min(off, 1.6) * NOTICE.angle + tail + (late < chance ? NOTICE.lateTime * lateFor : 0);
        }
        const ease = rookieEase(seen);
        brain.reaction += ease * ROOKIE_EASE.reaction;
        // The first aim is loose, and looser at a rookie. -9 marks that this enemy has no aim point yet.
        brain.errYaw = (ctx.random() < 0.5 ? -1 : 1) * AIM.first * (ease > 0 ? ROOKIE_EASE.aimError : 1); brain.errPitch = 0; brain.aimLeft = -9;
      }
      brain.lastSeen = state.time; brain.seenX = seen.m.x; brain.seenY = seen.m.y; brain.seenZ = seen.m.z;
      target = seen;
    } else if (state.time - brain.lastSeen > 2.2) {
      brain.target = -1; target = undefined;
    }
  }
  // In sight at the last look (the looks are up to 0.35 s apart).
  const visible = !!target && state.time - brain.lastSeen < 0.4;
  // The bot fights an enemy once it has noticed it; until then it goes on as before.
  const engaged = visible && brain.reaction <= 0;

  // ---- Goals and navigation ------------------------------------------------------
  brain.goalLeft -= dt;
  const sabotage = sabotageOn(state, ctx);
  // Re-plan at once when the bomb goes down or a new arm starts somewhere else.
  if (sabotage && brain.goal === 'site') {
    const p = state.bomb.site >= 0 ? sitesOf(ctx)[state.bomb.site] : undefined;
    if (p && Math.hypot(brain.goalX - p.x, brain.goalZ - p.z) > p.radius) brain.goalLeft = 0;
  }
  if (!brain.goal || brain.goalLeft <= 0) chooseGoal(state, ctx, bot, brain);
  if (brain.repath <= 0) {
    if (target && !visible && state.time - brain.lastSeen < 2.2) plan(ctx, bot, brain, brain.seenX, brain.seenY, brain.seenZ);
    // Toward the goal's floor (a site or landmark on an upper storey is not the one under it).
    else plan(ctx, bot, brain, brain.goalX, brain.goalY ?? bot.m.y, brain.goalZ);
    brain.repath = 2.5 + ctx.random() * 2;
  }
  let moveX = 0, moveZ = 0, lookX = 0, lookZ = 0;
  if (ctx.nav && brain.path.length) {
    const nav = ctx.nav;
    let i = brain.pathIndex;
    // A ladder is a steep, short hop between path nodes: stand right at its foot (or head) before
    // heading for the other end, so the climb starts square in front of the rungs.
    const ladderNext = (k: number) => k < brain.path.length - 1 && Math.abs(nav.y[brain.path[k + 1]] - nav.y[brain.path[k]]) > 1.5
      && Math.hypot(nav.x[brain.path[k + 1]] - nav.x[brain.path[k]], nav.z[brain.path[k + 1]] - nav.z[brain.path[k]]) < SPACING_LADDER;
    while (i < brain.path.length - 1 && Math.hypot(nav.x[brain.path[i]] - bot.m.x, nav.z[brain.path[i]] - bot.m.z) < (ladderNext(i) ? 0.35 : 1.3)) i++;
    brain.pathIndex = i;
    const node = brain.path[i];
    const dx = nav.x[node] - bot.m.x, dz = nav.z[node] - bot.m.z, d = Math.hypot(dx, dz);
    if (d > 0.6 || i < brain.path.length - 1) { moveX = dx / (d || 1); moveZ = dz / (d || 1); }
    else if (ctx.random() < dt * 0.6) { brain.goalLeft = Math.min(brain.goalLeft, 1.5); }
    // The eyes are on the way a few steps ahead, not on the next step: the view does not follow each bend of the path.
    const far = brain.path[Math.min(i + BODY.ahead, brain.path.length - 1)];
    lookX = nav.x[far] - bot.m.x; lookZ = nav.z[far] - bot.m.z;
    if (nav.y[node] - bot.m.y > 0.9 && bot.m.grounded && d < 2 && !ctx.world.ladderAt(bot.m.x, bot.m.y, bot.m.z, MOVE.radius)) brain.jump = true;
  }

  // ---- Combat ----------------------------------------------------------------------
  const w = weaponOf(bot);
  // A learned bot (aim.ts): while an enemy is in sight, the network has the view, the trigger and the sights, and the script's hand rests.
  const ease = brain.learned && target ? rookieEase(target) : 0;
  const hand = brain.learned ? learnedHand(state, ctx, bot, dt, ease > 0 ? ROOKIE_EASE.spread : 1) : undefined;
  let wantAds = false, pull = false, stop = FIRE.release;
  if (target && engaged) {
    const eye = eyeOf(bot);
    const dx = target.m.x - eye.x, dz = target.m.z - eye.z, distance = Math.hypot(dx, dz), reach = Math.max(1.5, distance);
    // The aim point rides on the enemy as the bot sees it: its chest (or what shows of it), a little high, with the bot's error.
    // A soldier peeking round cover shows its head and shoulder, not its chest.
    const chest = peekOf(ctx.world, target) !== 0 ? shapeOf(ctx, target).chestTop : chestPoint(feetOf(target), target.m.crouch);
    let aimLeft = (brain.aimLeft ?? -9) - dt;
    if (aimLeft <= 0) {
      // A new error, which keeps a part of the last one (the first one at this enemy is set where the bot notices it).
      if (aimLeft > -1) {
        const g = Math.sqrt(-2 * Math.log(1 - ctx.random()) * (1 - AIM.keep * AIM.keep)), a = ctx.random() * Math.PI * 2;
        brain.errYaw = brain.errYaw * AIM.keep + g * Math.cos(a); brain.errPitch = brain.errPitch * AIM.keep + g * Math.sin(a);
      }
      aimLeft = (AIM.every + slow * AIM.everySlow) * (0.7 + ctx.random() * 0.6);
    }
    brain.aimLeft = aimLeft;
    const sd = (AIM.error + AIM.errorFar * distance) / (1 + AIM.sharp * brain.skill) / MEDIAN;
    brain.aimYaw = Math.atan2(-(chest.x - eye.x), -(chest.z - eye.z)) + brain.errYaw * sd / reach;
    brain.aimPitch = Math.atan2(chest.y + AIM.up * (1 + 2 * brain.skill) - eye.y, distance) + brain.errPitch * sd * AIM.vertical / reach;
    // How fast the enemy crosses the view (rad/s), from its speed and the bot's own: a move of the hand goes a part of the way ahead of it.
    const crossing = (dz * (target.m.vx - bot.m.vx) - dx * (target.m.vz - bot.m.vz)) / (reach * reach);
    if (!hand) turnView(ctx, bot, brain, wrapAngle(brain.aimYaw - bot.yaw), brain.aimPitch - bot.pitch, Math.max(AIM.fine, AIM.rest / reach),
      brain.burst > 0 ? HAND.restFire : HAND.restSeen, crossing * Math.min(1, AIM.lead + AIM.leadSkill * brain.skill), dt);
    const near = Math.max(AIM.fireMin, AIM.fire / reach);
    const aligned = Math.abs(wrapAngle(brain.aimYaw - bot.yaw)) < near && Math.abs(brain.aimPitch - bot.pitch) < near * 1.5;
    wantAds = w.class !== 'melee' && (w.class === 'sniper' || habit(bot, 0) < Math.min(BODY.adsMost, BODY.ads + BODY.adsPerMetre * distance));

    // The body: stand, strafe, or keep to the way, for a few seconds each; and keep the weapon's range.
    if (brain.strafeLeft <= 0) {
      const r = ctx.random(), still = clamp(BODY.still + BODY.stillPerMetre * distance, BODY.stillLeast, BODY.stillMost) * (0.5 + habit(bot, 1));
      brain.strafe = r < still ? 0 : (ctx.random() < 0.5 ? -1 : 1) * (r < still + (1 - still) * BODY.strafeShare ? 1 : 0.25);
      brain.strafeLeft = BODY.strafe + ctx.random() * BODY.strafeMore;
    }
    if (brain.strafe === 0 && bot.weapon !== 2) { moveX = 0; moveZ = 0; }
    else {
      const preferred = w.botRange;
      const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw), rx = Math.cos(bot.yaw), rz = -Math.sin(bot.yaw);
      const advance = distance > preferred * 1.4 ? 0.7 : distance < preferred * 0.5 ? -0.6 : 0;
      const pathWeight = distance > preferred ? 0.6 : 0.2;
      moveX = moveX * pathWeight + (fx * advance + rx * brain.strafe * 0.9);
      moveZ = moveZ * pathWeight + (fz * advance + rz * brain.strafe * 0.9);
    }
    if (brain.crouchLeft < -2 && ctx.random() < dt * 0.25 * brain.skill && distance > 15) brain.crouchLeft = 0.8 + ctx.random();

    // Knife anyone who closes right in; draw the gun again once they back off.
    if (bot.switchLeft <= 0 && bot.reloadLeft <= 0 && (bot.weapon === 2 ? distance > 3.5 : distance < 1.6 && ctx.random() < dt * 4)) {
      bot.weapon = bot.weapon === 2 ? 0 : 2; bot.switchLeft = weaponOf(bot).equipTime; brain.burst = 0;
    }

    // The trigger goes down when the view is on the aim point, and stays down for a burst: a few shots at long range, many up close.
    pull = !hand && (brain.burst > 0 || (aligned && brain.burstPause <= 0 && distance < w.range * 0.6));
    stop = !w.auto || w.class === 'melee' ? 1 : brain.burst + 1 < FIRE.min ? 0 : distance < 30 ? FIRE.stop : distance < 60 ? FIRE.stopFar : FIRE.stopVeryFar;
  } else {
    // The finger comes off late when the enemy drops or goes out of sight; the hand ends its move and no more for those shots.
    pull = !hand && brain.burst > 0;
    if (hand) { /* the network has the view */ }
    else if (pull) turnView(ctx, bot, brain, 0, 0, 1, HAND.restFire, 0, dt);
    else {
      // Look where we are going when not fighting, a little below level.
      const far = lookX * lookX + lookZ * lookZ > 1;
      turnView(ctx, bot, brain, far ? wrapAngle(Math.atan2(-lookX, -lookZ) - bot.yaw) : moveX || moveZ ? wrapAngle(Math.atan2(-moveX, -moveZ) - bot.yaw) : 0,
        -(BODY.rest + habit(bot, 2) * BODY.restMore) - bot.pitch, BODY.slack, HAND.rest, 0, dt);
      if (bot.weapon === 2 && bot.switchLeft <= 0) { bot.weapon = 0; bot.switchLeft = weaponOf(bot).equipTime; }
      else if (bot.weapon !== 2 && bot.ammo[bot.weapon] < w.magazine * 0.4 && bot.reloadLeft <= 0) bot.reloadLeft = w.reload;
    }
    // Grenade the last known position of an enemy who ducked behind cover.
    // A molotov goes on a nearer one, where it would land at their feet.
    if (target && !visible && brain.grenadeCooldown <= 0 && (bot.grenades > 0 || bot.molotovs > 0) && state.time - brain.lastSeen < 2.5) {
      const d = Math.hypot(brain.seenX - bot.m.x, brain.seenZ - bot.m.z);
      const frag = bot.grenades > 0 && d > 9 && d < 24, molotov = bot.molotovs > 0 && d > 6 && d < 20;
      if ((frag || molotov) && ctx.random() < 0.35) {
        const eye = eyeOf(bot);
        const yaw = yawTo(eye, { x: brain.seenX, y: 0, z: brain.seenZ });
        // Flat-ground ballistic estimate: pick a pitch whose range matches the distance.
        const v = GRENADE.throwSpeed, pitch = clamp(0.5 * Math.asin(clamp(d * 9.8 / (v * v), -1, 1)) - 0.08, 0.05, 0.9);
        if (molotov && (!frag || ctx.random() < 0.5)) throwMolotovFrom(state, bot, eye, dirFromAngles(yaw, pitch));
        else throwGrenadeFrom(state, bot, eye, dirFromAngles(yaw, pitch));
      }
      brain.grenadeCooldown = 9 + ctx.random() * 8;
    }
  }

  if (hand) { wantAds = hand.sights; brain.burst = 0; }

  // ---- Fire: the weapon's own spread with its bloom, and the part of the recoil that the hand does not hold ----
  if (pull && bot.reloadLeft <= 0 && bot.switchLeft <= 0 && bot.fireCooldown <= 0) {
    if (bot.weapon !== 2 && bot.ammo[bot.weapon] <= 0) { bot.reloadLeft = w.reload; brain.burst = 0; }
    else {
      const eye = eyeOf(bot);
      // The bloom falls off as on a player's weapon: slowly for a moment after a shot, then at the weapon's rate.
      const bloom = Math.max(0, (brain.bloom ?? 0) - w.spread.recovery * (Math.min(bot.sinceShot, 0.08) * 0.25 + Math.max(0, bot.sinceShot - 0.08)));
      const cone = w.pellets > 1 || w.class === 'melee' ? 0
        : spreadFor(bot, w, bloom * (bot.ads ? 0.4 : 1)) * (target && rookieEase(target) > 0 ? ROOKIE_EASE.spread : 1) * DEG;
      const a = ctx.random() * Math.PI * 2, r = Math.sqrt(ctx.random()) * cone;
      const climb = FIRE.climb * w.recoil.pitch * DEG * Math.min(brain.burst, FIRE.climbShots) * (bot.ads ? 0.65 : 1);
      const dir = dirFromAngles(bot.yaw + Math.cos(a) * r, bot.pitch + climb + Math.sin(a) * r);
      if (w.pellets > 1) resolvePellets(state, ctx, bot, w, eye, dir, bot.ads);
      else resolveShot(state, ctx, bot, w, eye, traceShot(state, ctx, bot, eye, dir, w.range));
      if (bot.weapon !== 2) bot.ammo[bot.weapon]--;
      bot.sinceShot = 0;
      bot.fireCooldown = w.auto ? w.interval : w.interval * (1.15 + ctx.random() * 0.6);
      brain.bloom = Math.min(w.spread.bloomMax, bloom + w.spread.bloomPerShot);
      brain.burst++;
      if (ctx.random() < stop) {
        brain.burst = 0;
        brain.burstPause = w.auto && w.class !== 'melee' ? FIRE.pause + slow * FIRE.pauseSlow - Math.log(1 - ctx.random()) * (FIRE.pauseTail + slow * FIRE.pauseTailSlow) : 0.05 + ctx.random() * 0.4;
      }
    }
  }

  // ---- Sabotage: hold E on the site (standing still) to arm or disarm --------------
  bot.using = false;
  let onJob = false;
  if (sabotage && !engaged && bot.m.grounded) {
    const site = state.bomb.armed ? state.bomb.site : bot.team === ATTACKERS ? sitesOf(ctx).findIndex(p => onSite(p, bot.m.x, bot.m.y, bot.m.z, SITE_STOP)) : -1;
    const p = site >= 0 ? sitesOf(ctx)[site] : undefined;
    const busy = state.bomb.by !== -1 && state.bomb.by !== bot.id;
    const myJob = state.bomb.armed ? bot.team !== ATTACKERS : bot.team === ATTACKERS;
    if (p && myJob && !busy && onSite(p, bot.m.x, bot.m.y, bot.m.z, SITE_STOP)) {
      onJob = true;
      // An attacker looks round the site for a moment first; nobody waits to disarm.
      if (!state.bomb.armed && state.bomb.by !== bot.id) brain.plantIn = (brain.plantIn ?? BODY.plant + ctx.random() * BODY.plantMore) - dt;
      if (state.bomb.armed || state.bomb.by === bot.id || brain.plantIn! <= 0) { bot.using = true; moveX = 0; moveZ = 0; }
    }
  }
  if (!onJob && brain.plantIn !== undefined) brain.plantIn = undefined;

  // ---- Fire: step out of the flames, and keep a step clear of them --------------
  const fire = state.bodies.length ? fireNear(state, ctx, feetOf(bot), 0.6) : undefined;
  if (fire) {
    const ax = bot.m.x - fire.x, az = bot.m.z - fire.z, d = Math.hypot(ax, az);
    if (d > 0.05) { moveX = ax / d; moveZ = az / d; } else { moveX = -Math.sin(bot.yaw); moveZ = -Math.cos(bot.yaw); }
    bot.using = false;
  }

  // ---- Vehicles in the way: the nav grid knows only where they park, so walk round the bodies ----
  if (obstacles?.length && (moveX || moveZ)) [moveX, moveZ] = avoidObstacles(bot, obstacles, moveX, moveZ);

  // ---- Stuck detection ------------------------------------------------------------
  // Climbing a ladder is progress too.
  const moved = Math.hypot(bot.m.x - brain.lastX, bot.m.z - brain.lastZ, bot.m.y - brain.lastY);
  brain.lastX = bot.m.x; brain.lastY = bot.m.y; brain.lastZ = bot.m.z;
  const wanted = Math.hypot(moveX, moveZ) > 0.3;
  brain.stuck = wanted && moved < dt * 0.8 ? brain.stuck + dt : Math.max(0, brain.stuck - dt * 2);
  if (brain.stuck > 0.7) { brain.jump = true; brain.stuck = 0; brain.repath = 0; brain.strafe *= -1; }

  // ---- Drive the shared movement controller ---------------------------------------
  const len = Math.hypot(moveX, moveZ);
  if (len > 1) { moveX /= len; moveZ /= len; }
  const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw), rx = Math.cos(bot.yaw), rz = -Math.sin(bot.yaw);
  const forward = moveX * fx + moveZ * fz, strafe = moveX * rx + moveZ * rz;
  // Sprint out of the base, and to an armed bomb; walk the rest of the way, as most players do.
  const hurry = !target && !hand?.sights && (state.roundClock < BODY.dash || state.bomb.armed);
  const input: MoveInput = {
    forward, strafe, yaw: bot.yaw, jump: brain.jump, crouch: brain.crouchLeft > 0,
    sprint: hurry && len > 0.5 && forward > 0.7 && bot.stamina > (bot.sprint ? 0 : STAMINA.tired),
    ads: wantAds, speed: w.speed,
  };
  brain.jump = false;
  bot.sprint = input.sprint && bot.m.grounded; bot.ads = input.ads;
  stepMovement(ctx.world, bot.m, input, dt, bot.team, obstacles);
  // Safety net: never let a bot fall out of the world.
  if (bot.m.y < -60) bot.m.y = ctx.world.groundHeight(bot.m.x, bot.m.z, 100, MOVE.radius);
  // A learned bot looks last, with its body where the tick left it. With a rookie in front it asks less of the network.
  if (brain.learned) learnedLook(state, ctx, bot, LEARNED.outcome - ease * LEARNED.rookie);
}
