/**
 * The bot bench: bot-only 6v6 matches in the shared simulation, measured as the recorded players are measured and
 * printed next to the players' totals in scripts/botbench/human.json (docs/DEVELOPMENT.md, "Bot bench"). Run it
 * before and after a change to the bots (shared/match/bots.ts, places.ts, botShop).
 *
 *   bun scripts/botbench.ts [--rounds 36] [--matches 2] [--seed 1] [--skill 0.3] [--learned 0.5] [--duel]
 *
 * Part 1 gives all bots the MP5 on taipei, because the players' aim windows have that weapon and map, and compares
 * 3-second windows of the aim. Part 2 plays full Online matches with the store on three maps. `--learned` is the
 * share of the bots with the learned aim (shared/match/aim.ts) in the two parts. Part 3 (`--duel`, some minutes) puts
 * a team of bots with the learned aim against a team with the script's aim, all with the MP5.
 */
import HUMAN from './botbench/human.json';
import { handTurn } from '../shared/match/aim';
import { eyeOf, smokeBlocks, weaponOf, type SimContext } from '../shared/match/combat';
import { refillAmmo } from '../shared/match/economy';
import { balanceTeams, createContext, createMatch, tickMatch, TICK_RATE } from '../shared/match/sim';
import { ELIMINATION, ONLINE_CONFIG, type MatchConfig, type MatchEvent, type MatchState, type Soldier } from '../shared/match/state';
import { rng, wrapAngle, type Vec3 } from '../shared/math';

const arg = (name: string, fallback: number) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? Number(process.argv[i + 1]) : fallback; };
const ROUNDS = arg('rounds', 36), MATCHES = arg('matches', 2), SEED = arg('seed', 1), SKILL = arg('skill', ONLINE_CONFIG.botSkill), LEARNED = arg('learned', ONLINE_CONFIG.learnedAim ?? 0);
const DUEL = process.argv.includes('--duel');
const MAPS = ['taipei', 'ochre', 'memorial'];

// ---------------------------------------------------------------------------------------
// What both parts share
// ---------------------------------------------------------------------------------------

const point = { x: 0, y: 0, z: 0 };
/** 1 when the chest of `o` is in sight from `eye`, plus 2 when its head is: the rule of the recordings' rows (smoke blocks the line). */
function sightOf(state: MatchState, ctx: SimContext, eye: Vec3, o: Soldier, team: number): number {
  const stand = 1 - 0.34 * o.m.crouch;
  let sight = 0;
  point.x = o.m.x; point.z = o.m.z;
  point.y = o.m.y + 1.2 * stand;
  if (ctx.world.lineOfSight(eye, point, team) && !smokeBlocks(state.bodies, eye, point)) sight |= 1;
  point.y = o.m.y + 1.66 * stand;
  if (ctx.world.lineOfSight(eye, point, team) && !smokeBlocks(state.bodies, eye, point)) sight |= 2;
  return sight;
}

interface Tally { rounds: number; liveSeconds: number; team0: number }
/** Play one room of bots until `done`, and count its rounds into `tally`. */
function play(
  mapId: string, config: MatchConfig, seed: number, tally: Tally, done: (state: MatchState) => boolean,
  onEvent: (e: MatchEvent, state: MatchState) => void, afterTick: (state: MatchState, ctx: SimContext, live: boolean) => void,
  ready?: (state: MatchState) => void,
) {
  let liveAt = 0;
  const ctx = createContext(mapId, rng(seed), e => {
    if (e.type === 'round' && e.phase === 'live') liveAt = state.time;
    else if (e.type === 'round' && e.phase === 'over') { tally.rounds++; tally.liveSeconds += state.time - liveAt; if (e.winner === 0) tally.team0++; }
    onEvent(e, state);
  });
  const state = createMatch(mapId, config);
  balanceTeams(state, ctx);
  ready?.(state);
  for (let i = 0; i < 3600 * TICK_RATE && !done(state); i++) {
    tickMatch(state, ctx, 1 / TICK_RATE);
    afterTick(state, ctx, state.phase === 'live' && state.roundPhase === 'live');
  }
}

/** numpy's percentile of a sorted array: a straight line between the two nearest ranks. */
function quantile(sorted: ArrayLike<number>, n: number, q: number) {
  const at = q * (n - 1), i = Math.floor(at);
  return i + 1 < n ? sorted[i] + (sorted[i + 1] - sorted[i]) * (at - i) : sorted[n - 1];
}

// ---------------------------------------------------------------------------------------
// Part 1: windows of the aim
// ---------------------------------------------------------------------------------------

const TICKS = HUMAN.windows.ticks, STEP = HUMAN.windows.step, SEEN = HUMAN.windows.minVisible;
/** One row per tick of a soldier's life in a live round: the view's turn (yaw, pitch), trigger, shots, the enemy's offset from the view (yaw, pitch), enemy in sight, the windows' weapon in hand. */
const COLS = 8, DYAW = 0, DPITCH = 1, FIRE = 2, SHOTS = 3, OFF_YAW = 4, OFF_PITCH = 5, SIGHT = 6, WEAPON = 7;
const lg = (x: number) => Math.log10(x + 1e-4);
const turnYaw = new Float64Array(TICKS), turnPitch = new Float64Array(TICKS), offYaw = new Float64Array(TICKS), offPitch = new Float64Array(TICKS);

/**
 * The features of one window (HUMAN.features, in that order), or nothing when the window does not count: another weapon
 * in hand, or an enemy in sight for too short a time. A turn below 0.0005 rad in a tick counts as none; the view is on
 * the enemy within 0.03 rad of yaw and off it beyond 0.1 rad.
 */
function windowFeatures(r: Float32Array, o: number): number[] | undefined {
  let seen = 0;
  for (let t = 0; t < TICKS; t++) { const p = o + t * COLS; if (!r[p + WEAPON]) return undefined; if (r[p + SIGHT]) seen++; }
  if (seen < SEEN) return undefined;
  let turn = 0, path = 0, pathPitch = 0, noYaw = 0, noPitch = 0, most = 0, fired = 0, presses = 0, press = 0, longest = 0, shots = 0;
  let on = 0, held = 0, firedSeen = 0, firedOff = 0, was = false;
  for (let t = 0, n = 0; t < TICKS; t++) {
    const p = o + t * COLS, dy = r[p + DYAW], ay = Math.abs(dy), ap = Math.abs(r[p + DPITCH]), fire = r[p + FIRE] > 0;
    turnYaw[t] = ay; turnPitch[t] = ap; turn += dy; path += ay; pathPitch += ap; shots += r[p + SHOTS];
    if (ay < 5e-4) noYaw++;
    if (ap < 5e-4) noPitch++;
    if (ay > most) most = ay;
    if (fire) { fired++; if (!was) presses++; if (++press > longest) longest = press; } else press = 0;
    was = fire;
    if (!r[p + SIGHT]) continue;
    const off = Math.abs(r[p + OFF_YAW]);
    offYaw[n] = off; offPitch[n++] = Math.abs(r[p + OFF_PITCH]);
    if (off < 0.03) { on++; if (!fire) held++; }
    if (fire) { firedSeen++; if (off > 0.1) firedOff++; }
  }
  // Each tick with the next one.
  const meanA = (turn - r[o + (TICKS - 1) * COLS + DYAW]) / (TICKS - 1), meanB = (turn - r[o + DYAW]) / (TICKS - 1);
  let ab = 0, aa = 0, bb = 0, both = 0, flips = 0, jerk = 0, pairs = 0, lead = 0, lag = 0, crossings = 0;
  for (let t = 0; t + 1 < TICKS; t++) {
    const p = o + t * COLS, q = p + COLS, a = r[p + DYAW], b = r[q + DYAW];
    ab += (a - meanA) * (b - meanB); aa += (a - meanA) ** 2; bb += (b - meanB) ** 2; jerk += Math.abs(b - a);
    if (Math.abs(a) >= 5e-4 && Math.abs(b) >= 5e-4) { both++; if (Math.sign(a) !== Math.sign(b)) flips++; }
    if (r[p + SIGHT] && r[q + SIGHT]) {
      pairs++; lead += r[p + OFF_YAW] * b; lag += r[p + OFF_YAW] ** 2;
      if (Math.sign(r[p + OFF_YAW]) !== Math.sign(r[q + OFF_YAW])) crossings++;
    }
  }
  turnYaw.sort(); turnPitch.sort();
  const offs = offYaw.subarray(0, seen).sort(), offsPitch = offPitch.subarray(0, seen).sort();
  return [
    noYaw / TICKS, lg(quantile(turnYaw, TICKS, 0.5)), lg(quantile(turnYaw, TICKS, 0.75)), lg(quantile(turnYaw, TICKS, 0.9)), lg(most), lg(path / TICKS),
    noPitch / TICKS, lg(quantile(turnPitch, TICKS, 0.9)), lg(pathPitch / TICKS),
    ab / (Math.sqrt(aa * bb) + 1e-12), flips / Math.max(1, both), jerk / (TICKS - 1) / (path / TICKS + 1e-4),
    fired / TICKS, presses, longest / TICKS, shots,
    lg(quantile(offs, seen, 0.5)), lg(quantile(offs, seen, 0.1)), on / seen, lg(quantile(offsPitch, seen, 0.5)),
    lead / (lag + 1e-6), crossings / Math.max(1, pairs), firedOff / Math.max(1, firedSeen), held / Math.max(1, on),
    lg(Math.abs(turn)), Math.abs(turn) / (path + 1e-4),
  ];
}

/** How far the windows are from the players' windows, per feature: the mean gap between the two quantile curves, in the players' standard deviations. */
function distances(windows: number[][]): number[] {
  return HUMAN.features.map((_, f) => {
    const sorted = Float64Array.from(windows, w => w[f]).sort(), players = HUMAN.quantiles[f];
    let gap = 0;
    for (let i = 0; i < players.length; i++) gap += Math.abs(quantile(sorted, sorted.length, (i + 0.5) / players.length) - players[i]);
    return gap / players.length / HUMAN.sd[f];
  });
}

function aimPart() {
  const tally: Tally = { rounds: 0, liveSeconds: 0, team0: 0 }, script: number[][] = [], learned: number[][] = [];
  const lives = new Map<number, { rows: Float32Array; n: number; yaw: number; pitch: number; learned: boolean }>(), shots = new Map<number, number>();
  let written = 0;
  // The windows start each STEP rows of all the rows, in the order the lives end, as in the players' row files.
  const close = (life: { rows: Float32Array; n: number; learned: boolean }) => {
    for (let at = Math.ceil(written / STEP) * STEP; at + TICKS <= written + life.n; at += STEP) {
      const w = windowFeatures(life.rows, (at - written) * COLS);
      if (w) (life.learned ? learned : script).push(w);
    }
    written += life.n; life.n = 0;
  };
  const eyeToChest = { x: 0, y: 0, z: 0 };
  play(HUMAN.windows.map, { ...ELIMINATION, teamSize: 6, botSkill: SKILL, learnedAim: LEARNED, warmup: 0.2, roundsToWin: 6 }, SEED, tally, () => tally.rounds >= ROUNDS, (e, state) => {
    if (e.type === 'shot') shots.set(e.shooter, (shots.get(e.shooter) ?? 0) + 1);
    // The same weapon for all (no store, no grenades): the windows do not depend on cash.
    else if (e.type === 'round' && e.phase === 'freeze') for (const s of state.soldiers) { s.weapons[0] = HUMAN.windows.weapon as never; s.attachments = {}; s.grenades = 0; s.molotovs = 0; s.money = 0; s.weapon = 0; refillAmmo(s); }
  }, (state, ctx, live) => {
    for (const s of state.soldiers) {
      let life = lives.get(s.id);
      if (!life) lives.set(s.id, life = { rows: new Float32Array(COLS * 4096), n: 0, yaw: 0, pitch: 0, learned: !!s.brain?.learned });
      const fired = shots.get(s.id) ?? 0;
      shots.set(s.id, 0);
      if (!live || !s.alive) { if (life.n) close(life); continue; }
      if ((life.n + 1) * COLS > life.rows.length) { const more = new Float32Array(life.rows.length * 2); more.set(life.rows); life.rows = more; }
      const r = life.rows, p = life.n * COLS, yaw = wrapAngle(s.yaw), eye = eyeOf(s);
      // The hand's turn: a learned bot's view also has the recoil, which the players' windows do not count.
      const hand = handTurn(s);
      r[p + DYAW] = !life.n ? 0 : hand ? hand[0] : wrapAngle(s.yaw - life.yaw); r[p + DPITCH] = !life.n ? 0 : hand ? hand[1] : s.pitch - life.pitch;
      r[p + FIRE] = s.sinceShot < 0.15 ? 1 : 0; r[p + SHOTS] = fired; r[p + WEAPON] = weaponOf(s).id === HUMAN.windows.weapon ? 1 : 0;
      // The enemy of the row: one in sight before one out of sight, then the nearest to the centre of the view.
      const cp = Math.cos(s.pitch), fx = -Math.sin(yaw) * cp, fy = Math.sin(s.pitch), fz = -Math.cos(yaw) * cp;
      let best = Infinity;
      r[p + OFF_YAW] = 0; r[p + OFF_PITCH] = 0; r[p + SIGHT] = 0;
      for (const o of state.soldiers) {
        if (o.team === s.team || !o.alive) continue;
        eyeToChest.x = o.m.x - eye.x; eyeToChest.y = o.m.y + 1.2 * (1 - 0.34 * o.m.crouch) - eye.y; eyeToChest.z = o.m.z - eye.z;
        const d = Math.hypot(eyeToChest.x, eyeToChest.y, eyeToChest.z);
        if (d > 120 || d < 0.05) continue;
        const seen = sightOf(state, ctx, eye, o, s.team) ? 1 : 0;
        const rank = Math.acos(Math.max(-1, Math.min(1, (eyeToChest.x * fx + eyeToChest.y * fy + eyeToChest.z * fz) / d))) + (seen ? 0 : 10);
        if (rank >= best) continue;
        best = rank;
        r[p + OFF_YAW] = wrapAngle(Math.atan2(-eyeToChest.x, -eyeToChest.z) - yaw); r[p + OFF_PITCH] = Math.atan2(eyeToChest.y, Math.hypot(eyeToChest.x, eyeToChest.z)) - s.pitch; r[p + SIGHT] = seen;
      }
      life.yaw = s.yaw; life.pitch = s.pitch; life.n++;
    }
  });
  for (const life of lives.values()) if (life.n) close(life);
  return { tally, script, learned };
}

// ---------------------------------------------------------------------------------------
// Part 2: full matches with the store
// ---------------------------------------------------------------------------------------

function matchPart() {
  const tally: Tally = { rounds: 0, liveSeconds: 0, team0: 0 }, team0: string[] = [];
  const carried: Record<string, number> = {}, allies: number[] = [];
  let soldierRounds = 0, pairs = 0, changed = 0, ticks = 0, shots = 0, gunShots = 0, hits = 0, heads = 0;
  let rows = 0, still = 0, sprint = 0, sight = 0, turns = 0, anySight = 0, sights = 0, stillInSight = 0;
  for (const map of MAPS) {
    const of = { rounds: tally.rounds, team0: tally.team0 };
    for (let m = 0; m < MATCHES; m++) {
      const last = new Map<number, string>(), side = new Map<number, { tick: number; sign: number }>();
      const tick = new Map<number, { shots: number; hits: number; heads: number; knife: boolean }>();
      play(map, { ...ONLINE_CONFIG, teamSize: 6, botSkill: SKILL, learnedAim: LEARNED, warmup: 1 }, SEED * 31 + 7 + m, tally, state => state.phase === 'ended', (e, state) => {
        if (e.type === 'shot') {
          let t = tick.get(e.shooter);
          if (!t) tick.set(e.shooter, t = { shots: 0, hits: 0, heads: 0, knife: false });
          // As the recordings count them: one shot a tick for the shotgun's pellets and for the knife.
          const once = e.weapon === 'm1014' || e.weapon === 'knife';
          t.shots = once ? 1 : t.shots + 1; t.hits = once ? Math.max(t.hits, e.hit ? 1 : 0) : t.hits + (e.hit ? 1 : 0); t.heads = once ? Math.max(t.heads, e.hit === 2 ? 1 : 0) : t.heads + (e.hit === 2 ? 1 : 0);
          t.knife = e.weapon === 'knife';
        } else if (e.type === 'round' && e.phase === 'freeze') {
          // What each bot carries out of the store, and whether it is another primary than in its last round.
          for (const s of state.soldiers) {
            const primary = s.weapons[0], before = last.get(s.id);
            carried[primary] = (carried[primary] ?? 0) + 1; soldierRounds++;
            if (before !== undefined) { pairs++; if (before !== primary) changed++; }
            last.set(s.id, primary);
          }
        }
      }, (state, ctx, live) => {
        for (const t of tick.values()) { shots += t.shots; if (!t.knife) { gunShots += t.shots; hits += t.hits; heads += t.heads; } t.shots = 0; t.hits = 0; t.heads = 0; }
        if (!live) return;
        for (const s of state.soldiers) {
          if (!s.alive) continue;
          ticks++;
          // The body, 10 times a second, as the recordings' movement rows.
          if (state.tick % 3) continue;
          rows++;
          const speed = Math.hypot(s.m.vx, s.m.vz), eye = eyeOf(s);
          if (speed < 0.5) still++;
          if (s.sprint) sprint++;
          let ally = Infinity, seen = 0;
          for (const o of state.soldiers) {
            if (o === s || !o.alive) continue;
            const d = Math.hypot(o.m.x - s.m.x, o.m.y - s.m.y, o.m.z - s.m.z);
            if (o.team === s.team) ally = Math.min(ally, d);
            else if (d < 120 && seen !== 3) seen |= sightOf(state, ctx, eye, o, s.team);
          }
          if (ally < Infinity) allies.push(ally);
          if (seen) { anySight++; if (s.ads) sights++; if (speed < 0.5) stillInSight++; }
          // A turn of the strafe: the sideways speed (above 1 m/s) changes its sign from one row to the next, with an enemy's chest in sight.
          const sideways = s.m.vx * Math.cos(s.yaw) - s.m.vz * Math.sin(s.yaw), sign = sideways > 1 ? 1 : sideways < -1 ? -1 : 0, before = side.get(s.id);
          if (seen & 1) { sight++; if (before && before.tick === state.tick - 3 && before.sign * sign < 0) turns++; }
          side.set(s.id, { tick: state.tick, sign });
        }
      });
    }
    team0.push(`${map} ${((tally.team0 - of.team0) / Math.max(1, tally.rounds - of.rounds)).toFixed(2)}`);
  }
  allies.sort((a, b) => a - b);
  return {
    tally, team0,
    carried: Object.fromEntries(Object.entries(carried).map(([id, n]) => [id, n / soldierRounds])), changed: changed / Math.max(1, pairs),
    soldierHours: ticks / TICK_RATE / 3600, hitRate: hits / Math.max(1, gunShots), headShare: heads / Math.max(1, hits), shotsPerMinute: shots / (ticks / TICK_RATE / 60),
    sights: sights / Math.max(1, anySight), stillInSight: stillInSight / Math.max(1, anySight),
    still: still / rows, sprint: sprint / rows, turns: turns / Math.max(1, sight) * 10, ally: allies[allies.length >> 1],
  };
}

// ---------------------------------------------------------------------------------------
// Part 3: the learned aim against the script's
// ---------------------------------------------------------------------------------------

/** One team with the learned aim, one with the script's: each map, each side and two seeds, ROUNDS rounds each with the players' weapon. The share of the kills that the learned team makes, run by run. */
function duelPart() {
  const runs: { map: string; share: number }[] = [];
  let won = 0, rounds = 0;
  for (const seed of [SEED, SEED + 100]) for (const [mi, map] of MAPS.entries()) for (const side of [0, 1]) {
    const tally: Tally = { rounds: 0, liveSeconds: 0, team0: 0 }, kills = [0, 0], team = new Map<number, number>();
    play(map, { ...ELIMINATION, teamSize: 6, botSkill: SKILL, warmup: 0.2, roundsToWin: 6 }, seed * 97 + mi * 10 + side, tally, () => tally.rounds >= ROUNDS, (e, state) => {
      if (e.type === 'kill' && team.has(e.killer) && team.has(e.victim) && team.get(e.killer) !== team.get(e.victim)) kills[team.get(e.killer)!]++;
      else if (e.type === 'round' && e.phase === 'freeze') for (const s of state.soldiers) { s.weapons[0] = HUMAN.windows.weapon as never; s.attachments = {}; s.grenades = 0; s.molotovs = 0; s.money = 0; s.weapon = 0; refillAmmo(s); }
    }, () => {}, state => { for (const s of state.soldiers) { team.set(s.id, s.team); if (s.brain) s.brain.learned = s.team === side; } });
    runs.push({ map, share: kills[side] / Math.max(1, kills[0] + kills[1]) });
    won += side === 0 ? tally.team0 : tally.rounds - tally.team0; rounds += tally.rounds;
  }
  const shares = runs.map(r => r.share), mean = shares.reduce((a, b) => a + b, 0) / shares.length;
  const error = Math.sqrt(shares.reduce((a, b) => a + (b - mean) ** 2, 0) / (shares.length - 1) / shares.length);
  return { mean, error, won, rounds, maps: MAPS.map(map => { const of = runs.filter(r => r.map === map); return `${map} ${(of.reduce((a, r) => a + r.share, 0) / of.length).toFixed(2)}`; }) };
}

// ---------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------

const f = (x: number | undefined, digits = 3) => (x === undefined ? '-' : x.toFixed(digits)).padStart(8);
const line = (name: string, ...values: string[]) => console.log('  ' + name.padEnd(44) + values.join(''));
const head = (...names: string[]) => names.map(n => n.padStart(8)).join('');

const aim = aimPart();
console.log(`Bot bench: 6v6 bots of skill ${SKILL}, ${LEARNED ? `${Math.round(LEARNED * 100)}% of them with the learned aim, ` : ''}seed ${SEED} (docs/DEVELOPMENT.md, "Bot bench")\n`);
console.log(`1. Aim: 3 s windows with the ${HUMAN.windows.weapon.toUpperCase()} on ${HUMAN.windows.map}, an enemy in sight for 0.5 s or more`);
console.log(`  ${aim.tally.rounds} rounds of ${(aim.tally.liveSeconds / aim.tally.rounds).toFixed(0)} s (players: ${HUMAN.windows.count} windows; players to players: ${HUMAN.control.mean.toFixed(3)}, ${HUMAN.control.p05.toFixed(3)} to ${HUMAN.control.p95.toFixed(3)})`);
for (const [name, windows] of [['the script\'s aim', aim.script], ['the learned aim', aim.learned]] as const) {
  if (!windows.length) continue;
  const each = distances(windows), far = each.map((d, i) => ({ d, name: HUMAN.features[i] })).sort((a, b) => b.d - a.d).slice(0, 4);
  line(`distance to the players, ${name}`, f(each.reduce((a, b) => a + b, 0) / each.length), `   ${windows.length} windows; farthest: ${far.map(x => `${x.name} ${x.d.toFixed(2)}`).join(', ')}`);
}

const m = matchPart(), H = HUMAN;
console.log(`\n2. Full matches with the store: ${MATCHES} each on ${MAPS.join(', ')}`);
console.log(`  ${m.tally.rounds} rounds of ${(m.tally.liveSeconds / m.tally.rounds).toFixed(0)} s, ${m.soldierHours.toFixed(2)} soldier-hours; rounds to team 0: ${m.team0.join(', ')}`);
line('The primary they carry', head('bots', 'players'));
for (const id of Object.keys(H.buy.primaryShare) as (keyof typeof H.buy.primaryShare)[]) line('  ' + id, f(m.carried[id] ?? 0), f(H.buy.primaryShare[id]));
line('  another primary than in the last round', f(m.changed), f(H.buy.changeShare));
line('How they shoot', head('bots', 'mouse'));
line('  hit rate', f(m.hitRate), f(H.aim.hitRate));
line('  head share of the hits', f(m.headShare), f(H.aim.headShareOfHits));
line('  shots a minute', f(m.shotsPerMinute, 1), f(H.aim.shotsPerMinute, 1));
line('  in the sights, an enemy in sight', f(m.sights), f(H.aim.adsShareEnemy));
line('  body still, an enemy in sight', f(m.stillInSight), f(H.aim.stillBodyShareEnemy));
line('How they move', head('bots', 'mouse', 'touch'));
line('  body still', f(m.still), f(H.move.mouse.stillShare), f(H.move.touch.stillShare));
line('  sprint', f(m.sprint), f(H.move.mouse.sprintShare), f(H.move.touch.sprintShare));
line('  strafe turns a second, an enemy in sight', f(m.turns), f(H.move.mouse.strafeFlipsPerSecondEnemy), f(H.move.touch.strafeFlipsPerSecondEnemy));
line('  nearest ally, median (m)', f(m.ally, 1), f(H.move.mouse.nearestAllyMedian, 1), f(H.move.touch.nearestAllyMedian, 1));

if (DUEL) {
  const d = duelPart();
  console.log(`\n3. The learned aim against the script's aim: ${d.rounds} rounds with the ${HUMAN.windows.weapon.toUpperCase()}, each side of ${MAPS.join(', ')}`);
  line('share of the kills, learned team', f(d.mean), `   ± ${d.error.toFixed(3)} (standard error of ${MAPS.length * 4} runs); ${d.maps.join(', ')}`);
  line('rounds won, learned team', f(d.won / d.rounds), `   ${d.won} of ${d.rounds}`);
}
