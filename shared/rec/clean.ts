import { decodeFrame, type DecodedFrame } from '../match/frame';
import type { MatchEvent } from '../match/state';
import { In, type InputHeader, type InputRecord } from './inputlog';
import { CLEAN_RULES } from './policy';
import { Rec, recordJson, type Segment, type SegmentSoldier } from './segment';

/**
 * The clean rules (`clean-v2`, docs/RECORDING.md "Clean"): which seconds of a recorded round are clean
 * human play. The unit is one second of one recording subject alive in a live round; most rules drop the
 * whole subject-round. Two measures: **movement-clean** (every rule; touch aim assist allowed, its
 * per-frame correction is in the input log) and **aim-clean** (the same, but only mouse play or touch with
 * assist off). The processor writes one `Quality` per subject-round; the recount script runs this same
 * code over the raw files, so the admin numbers can be checked.
 */
export const RULES = {
  /** AFK: no input and no movement or turning for this long (s); a margin on each side; a round with more AFK than this share goes. */
  afkSeconds: 10, afkMargin: 2, afkRoundShare: 0.5, afkSpeed: 0.2, afkYawDeg: 0.5,
  /** Network: report round trip p95 (ms), corrections per minute, server frame gaps, input-log gap (s). */
  rttP95: 250, correctionsPerMin: 3, gapRatio: 0.02, inputGap: 1,
  /** Shots the server did not take (sent, but none of ours in the frames within the window, ticks). */
  rejectedShots: 2, shotWindow: [-2, 8] as const,
  /** Integrity: median |client aim − server aim| (degrees) at the best lag, and the clock fit's median residual (ticks). */
  aimErrorDeg: 2, clockResidual: 3,
} as const;

export type Tier = 'clean' | 'server-only' | 'excluded' | 'bot';

export interface Quality {
  rules: typeof CLEAN_RULES;
  segment: string;
  pid: string;
  soldierId: number;
  tier: Tier;
  /** Seconds alive in live rounds, movement-clean and aim-clean seconds, and why the rest was dropped (rule → seconds). */
  aliveLive: number;
  clean: number;
  aimClean: number;
  dropped: Record<string, number>;
  /** `phone`, `tablet` or `desktop`; `touch` or `mouse`; touch aim assist on. */
  device: string; input: 'touch' | 'mouse'; aimAssist: boolean; euUk: boolean;
  map: string; mode: string; teamSize: number; roomKind: string; date: string; startMs: number; matchUid: string; round: number;
  checks: { rttP95?: number; correctionsPerMin: number; rejectedShots: number; aimErrorDeg?: number; clockResidual?: number; inputCoverage: number };
}

export interface SegmentChecks { kills: number; killsMatched: number; gapRatio: number; ticksPerSecond: number; frames: number }

export interface Decoded { header: Segment['header']; frames: DecodedFrame[]; events: { tick: number; e: MatchEvent }[]; roster: { tick: number; r: Record<string, unknown> }[] }

export function decodeFrames(seg: Segment): Decoded {
  const frames: DecodedFrame[] = [], events: Decoded['events'] = [], roster: Decoded['roster'] = [];
  for (const r of seg.records) {
    if (r.type === Rec.Frame) { const f = decodeFrame(r.data); if (f) frames.push(f); }
    else if (r.type === Rec.Event) events.push({ tick: r.tick, e: recordJson<MatchEvent>(r) });
    else if (r.type === Rec.Roster) roster.push({ tick: r.tick, r: recordJson<Record<string, unknown>>(r) });
  }
  frames.sort((a, b) => a.tick - b.tick);
  return { header: seg.header, frames, events, roster };
}

/** P2 and P3 for one segment: every kill event's victim goes alive → dead within ±2 ticks; tick gaps. */
export function segmentChecks(d: Decoded): SegmentChecks {
  const alive = new Map<number, Map<number, boolean>>();
  for (const f of d.frames) for (const p of f.poses) { let m = alive.get(p.id); if (!m) alive.set(p.id, m = new Map()); m.set(f.tick, p.alive); }
  const excluded = new Set(d.header.soldiers.filter(s => s.excluded).map(s => s.soldierId));
  let kills = 0, matched = 0;
  for (const { tick, e } of d.events) {
    if (e.type !== 'kill' || excluded.has(e.victim)) continue;
    kills++;
    const m = alive.get(e.victim);
    if (!m) continue;
    let ok = false;
    for (let t = tick - 3; t <= tick + 2 && !ok; t++) if (m.get(t) === true && [1, 2, 3, 4].some(k => m.get(t + k) === false)) ok = true;
    // The kill's own frame may be the first we have of the victim (a round edge): dead at the event tick counts.
    if (!ok && m.get(tick) === false && m.get(tick - 1) === undefined) ok = true;
    if (ok) matched++;
  }
  return { kills, killsMatched: matched, gapRatio: d.header.gapRatio, ticksPerSecond: d.header.ticksPerSecond, frames: d.frames.length };
}

const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const DEG = 180 / Math.PI;
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const quantile = (xs: number[], q: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

export interface InputSession { header: InputHeader; records: InputRecord[] }

/** How server ticks map to the client's clock: the server tick at client time `t` (ms), and how far the arrivals stray from that map (median, ticks). */
export interface ClockFit { tickOf: (t: number) => number; residual: number; points: number }

/** The clock fit's local window (ms each side) and knot spacing (ms). */
const FIT_WINDOW = 2000, FIT_STEP = 500;

/**
 * Map client time to server ticks from the frames' arrival times (`t - tickAgeMs` of each new tick). The
 * server does not tick at a steady 30 Hz (a busy tick runs late: 27–31 Hz over 10 s, dips near 20 Hz), so
 * one straight line over a whole match strays by tens of ticks. Instead a line is fitted in a short window
 * around every knot (slope by least squares, offset along the earliest arrivals, which come late by a
 * varying delay) and the knots are joined. A tick that goes back (a new room) starts a new run. Null
 * without enough points.
 */
export function clockFit(records: InputRecord[]): ClockFit | null {
  const pts: { tick: number; t: number }[] = [];
  let lastTick = -1;
  for (const r of records) {
    if (r.type !== In.Frame || r.tick <= 0 || r.tick === lastTick) continue;
    lastTick = r.tick;
    pts.push({ tick: r.tick, t: r.t - r.tickAgeMs });
  }
  if (pts.length < 20) return null;
  pts.sort((a, b) => a.t - b.t);
  // Runs of rising ticks.
  const runs: { tick: number; t: number }[][] = [];
  let run: { tick: number; t: number }[] = [];
  for (const p of pts) {
    if (run.length && p.tick < run[run.length - 1].tick - 30) { runs.push(run); run = []; }
    run.push(p);
  }
  runs.push(run);
  const fits = runs.filter(r => r.length >= 20).map(fitRun);
  if (!fits.length) return null;
  const tickOf = (t: number) => {
    // The run whose time span holds t, else the nearest one.
    let best = fits[0], gap = Infinity;
    for (const f of fits) { const g = t < f.from ? f.from - t : t > f.to ? t - f.to : 0; if (g < gap) { gap = g; best = f; } }
    return best.at(t);
  };
  const residual = median(pts.map(p => Math.abs(p.tick - tickOf(p.t))));
  return { tickOf, residual, points: pts.length };
}

/** One run's knots: a local line around each, evaluated at the knot; between knots, a straight join. */
function fitRun(pts: { tick: number; t: number }[]) {
  const from = pts[0].t, to = pts[pts.length - 1].t;
  const knots: { t: number; tick: number; b: number }[] = [];
  let lo = 0, hi = 0;
  for (let kt = from; ; kt = Math.min(kt + FIT_STEP, to)) {
    while (lo < pts.length && pts[lo].t < kt - FIT_WINDOW) lo++;
    while (hi < pts.length && pts[hi].t <= kt + FIT_WINDOW) hi++;
    const win = pts.slice(lo, hi);
    if (win.length >= 5) {
      const n = win.length, mt = win.reduce((s, p) => s + p.t, 0) / n, mk = win.reduce((s, p) => s + p.tick, 0) / n;
      let sxy = 0, sxx = 0;
      for (const p of win) { sxy += (p.t - mt) * (p.tick - mk); sxx += (p.t - mt) ** 2; }
      // A short or flat window (a gap, a stall): the nominal 30 Hz.
      const b = sxx > 0 && win[n - 1].t - win[0].t > 500 ? Math.max(0.01, Math.min(0.05, sxy / sxx)) : 0.03;
      knots.push({ t: kt, tick: quantile(win.map(p => p.tick - b * (p.t - kt)), 0.9), b });
    }
    if (kt >= to) break;
  }
  if (!knots.length) { const b = 0.03; knots.push({ t: from, tick: quantile(pts.map(p => p.tick - b * (p.t - from)), 0.9), b }); }
  const at = (t: number) => {
    if (t <= knots[0].t) return knots[0].tick + knots[0].b * (t - knots[0].t);
    const last = knots[knots.length - 1];
    if (t >= last.t) return last.tick + last.b * (t - last.t);
    let i = 0, j = knots.length - 1;
    while (j - i > 1) { const m = (i + j) >> 1; if (knots[m].t <= t) i = m; else j = m; }
    const k0 = knots[i], k1 = knots[j];
    return k0.tick + (k1.tick - k0.tick) * (t - k0.t) / (k1.t - k0.t);
  };
  return { from, to, at };
}

/**
 * Classify one subject in one segment. `inputs`: the subject's input sessions (any; the ones that cover
 * the segment are used). `segmentKey` names the segment in the quality record.
 */
export function classify(d: Decoded, s: SegmentSoldier, inputs: InputSession[], segmentKey: string): Quality {
  const h = d.header;
  const dropped: Record<string, number> = {};
  const add = (k: string, sec: number) => { if (sec > 0) dropped[k] = (dropped[k] ?? 0) + sec; };
  const base = {
    rules: CLEAN_RULES, segment: segmentKey, pid: s.pid ?? '', soldierId: s.soldierId, device: s.device ?? '', euUk: !!s.euUk,
    map: h.mapId, mode: h.mode, teamSize: h.teamSize, roomKind: h.roomKind, date: new Date(h.startMs).toISOString().slice(0, 10), startMs: h.startMs, matchUid: h.matchUid, round: h.round,
  };
  // Ticks alive in a live round, and the server's view of the subject per tick.
  const poses: { tick: number; x: number; z: number; vx: number; vz: number; yaw: number; pitch: number; alive: boolean; live: boolean }[] = [];
  for (const f of d.frames) {
    const p = f.poses.find(q => q.id === s.soldierId);
    if (p) poses.push({ tick: f.tick, x: p.x, z: p.z, vx: p.vx, vz: p.vz, yaw: p.yaw, pitch: p.pitch, alive: p.alive, live: f.roundPhase === 'live' });
  }
  const aliveLiveTicks = poses.filter(p => p.alive && p.live);
  const aliveLive = aliveLiveTicks.length / 30;
  const empty = { input: 'mouse' as const, aimAssist: false, aimClean: 0, checks: { correctionsPerMin: 0, rejectedShots: 0, inputCoverage: 0 } };
  if (s.bot) return { ...base, ...empty, tier: 'bot', aliveLive, clean: 0, dropped: {} };
  if (s.excluded || !s.pid) return { ...base, ...empty, tier: 'excluded', aliveLive, clean: 0, dropped: aliveLive ? { E2: aliveLive } : {} };

  // The input session(s) of this room and soldier whose time covers the segment.
  const first = d.frames[0]?.tick ?? h.startTick, last = d.frames[d.frames.length - 1]?.tick ?? h.endTick;
  const mine = inputs.filter(i => i.header.db && i.header.soldierId === s.soldierId && i.header.room === h.room);
  const recs: InputRecord[] = [];
  let header: InputHeader | undefined;
  // Each page load has its own clock (performance.now() from its timeOrigin): put them all on the first one's.
  const origin = mine[0]?.header.timeOrigin ?? 0;
  for (const i of mine) {
    const shift = (i.header.timeOrigin ?? origin) - origin;
    for (const r of i.records) { header ??= i.header; recs.push(shift ? { ...r, t: r.t + shift } : r); }
  }
  recs.sort((a, b) => a.t - b.t);
  const fit = clockFit(recs);
  const tickOf = (t: number) => (fit ? fit.tickOf(t) : NaN);
  const inWindow = fit ? recs.filter(r => { const k = tickOf(r.t); return k >= first - 30 && k <= last + 30; }) : [];
  const frameRecs = inWindow.filter((r): r is Extract<InputRecord, { type: typeof In.Frame }> => r.type === In.Frame);
  const coveredTicks = new Set(frameRecs.map(r => Math.round(tickOf(r.t))));
  const covered = aliveLiveTicks.filter(p => [0, 1, -1, 2, -2].some(k => coveredTicks.has(p.tick + k))).length;
  const inputCoverage = aliveLiveTicks.length ? covered / aliveLiveTicks.length : 0;
  const input: 'touch' | 'mouse' = header?.touch ? 'touch' : 'mouse', aimAssist = !!header?.touch && !!header?.assist;
  const device = header?.device || s.device || '';

  // Round-level rules.
  const reasons: string[] = [];
  // E5: left, dropped or switched team before the round's end.
  if (!h.truncated && s.to < h.endTick - 30) reasons.push('E5');
  const teams = new Set(d.roster.filter(r => r.r.id === s.soldierId && typeof r.r.team === 'number').map(r => r.r.team));
  if (teams.size > 1) reasons.push('E5');
  // E6: network.
  const rtts = inWindow.filter(r => r.type === In.Rtt).map(r => (r as { ms: number }).ms);
  const rttP95 = rtts.length >= 5 ? quantile(rtts, 0.95) : undefined;
  if (rttP95 !== undefined && rttP95 > RULES.rttP95) reasons.push('E6');
  const corr = d.roster.filter(r => r.r.id === s.soldierId && typeof r.r.corrections === 'number').map(r => r.r.corrections as number);
  const minutes = Math.max(1 / 60, (last - first) / 30 / 60);
  const correctionsPerMin = corr.length >= 2 ? (Math.max(...corr) - Math.min(...corr)) / minutes : 0;
  if (correctionsPerMin > RULES.correctionsPerMin) reasons.push('E6');
  if (h.gapRatio > RULES.gapRatio) reasons.push('E6');
  for (let i = 1; i < frameRecs.length; i++) if (frameRecs[i].t - frameRecs[i - 1].t > RULES.inputGap * 1000 && frameRecs[i].alive) { reasons.push('E6'); break; }
  // E8: shots the server did not take.
  let rejectedShots = 0;
  if (fit) {
    const shotTicks = d.frames.flatMap(f => f.shots.filter(x => x.shooter === s.soldierId).map(() => f.tick));
    for (const r of inWindow) {
      if (r.type !== In.Send || r.kind !== 1) continue;
      const k = tickOf(r.t);
      if (!shotTicks.some(t => t >= k + RULES.shotWindow[0] && t <= k + RULES.shotWindow[1] + 6)) rejectedShots++;
    }
    if (rejectedShots > RULES.rejectedShots) reasons.push('E8');
  }
  // E9: integrity of aim (client aim against the server's, at the best lag) and of the clock.
  let aimErrorDeg: number | undefined;
  if (fit && frameRecs.length > 30) {
    // In a vehicle the server's aim is the seat's (a driver faces the heading), not the camera the client logs.
    const me = s.soldierId & 0x7fff;
    const seated = new Set(d.frames.filter(f => f.vehicles.some(v => v.driver === me || v.passenger === me)).map(f => f.tick));
    const server = new Map(poses.filter(p => p.alive && !seated.has(p.tick)).map(p => [p.tick, p]));
    let best = Infinity;
    for (let lag = 0; lag <= 15; lag++) {
      const errs: number[] = [];
      for (const r of frameRecs) {
        if (!r.alive) continue;
        const p = server.get(Math.round(tickOf(r.t)) + lag);
        if (p) errs.push(Math.abs(wrap(r.yaw - p.yaw)) * DEG);
      }
      if (errs.length >= 20) best = Math.min(best, median(errs));
    }
    if (Number.isFinite(best)) aimErrorDeg = best;
    if (aimErrorDeg !== undefined && aimErrorDeg > RULES.aimErrorDeg) reasons.push('E9');
    if (fit.residual > RULES.clockResidual) reasons.push('E9');
  }

  const checks = { ...(rttP95 !== undefined ? { rttP95 } : {}), correctionsPerMin, rejectedShots, ...(aimErrorDeg !== undefined ? { aimErrorDeg } : {}), ...(fit ? { clockResidual: fit.residual } : {}), inputCoverage };
  const tier: Tier = inputCoverage < 0.9 ? 'server-only' : 'clean';
  const out = { ...base, device, input, aimAssist, tier, aliveLive, dropped, checks };
  if (tier !== 'clean') { add('E10', aliveLive); return { ...out, clean: 0, aimClean: 0 }; }
  if (reasons.length) { add([...new Set(reasons)].join('+'), aliveLive); return { ...out, clean: 0, aimClean: 0 }; }

  // E4: AFK stretches, in 1-second bins of alive live ticks.
  const inputTicks = new Set(inWindow.filter(r => r.type === In.Move || r.type === In.Key || r.type === In.Touch || r.type === In.Wheel).map(r => Math.floor(tickOf(r.t))));
  const bins: boolean[] = [];
  for (let i = 0; i < aliveLiveTicks.length; i += 30) {
    const bin = aliveLiveTicks.slice(i, i + 30);
    const moving = bin.some(p => Math.hypot(p.vx, p.vz) > RULES.afkSpeed);
    const yaws = bin.map(p => p.yaw);
    const turning = yaws.length > 1 && Math.max(...yaws.map(y => Math.abs(wrap(y - yaws[0])))) * DEG > RULES.afkYawDeg;
    const typed = bin.some(p => inputTicks.has(p.tick) || inputTicks.has(p.tick - 1));
    bins.push(moving || turning || typed);
  }
  const afk = new Array(bins.length).fill(false);
  for (let i = 0; i < bins.length;) {
    if (bins[i]) { i++; continue; }
    let j = i; while (j < bins.length && !bins[j]) j++;
    if (j - i >= RULES.afkSeconds) for (let k = Math.max(0, i - RULES.afkMargin); k < Math.min(bins.length, j + RULES.afkMargin); k++) afk[k] = true;
    i = j;
  }
  const afkSec = afk.reduce((n, a, i) => n + (a ? Math.min(30, aliveLiveTicks.length - i * 30) / 30 : 0), 0);
  if (afkSec > aliveLive * RULES.afkRoundShare) { add('E4', aliveLive); return { ...out, clean: 0, aimClean: 0 }; }
  add('E4', afkSec);
  const clean = Math.max(0, aliveLive - afkSec);
  // E7 (aim only): touch aim assist changes aim and look speed, so those rounds are movement data, not aim data.
  if (aimAssist) add('E7aim', clean);
  return { ...out, clean, aimClean: aimAssist ? 0 : clean };
}

/** Bot-training and dataset targets (hours) the admin card shows progress to. */
export const TARGETS = { movement: 200, aim: 50, dataset: 1000 } as const;

/** Sum of quality records, as the admin card and the recount show it. */
export interface Totals {
  movementHours: number; aimHours: number; exportMovementHours: number; exportAimHours: number;
  serverOnlyHours: number; aliveLiveHours: number; subjectRounds: number; cleanRounds: number;
  byDay: Record<string, { movement: number; aim: number }>; byDevice: Record<string, number>; byInput: Record<string, number>; byMap: Record<string, number>;
}
/** Whether a quality record can go in the export set by itself (room and region; the match-level rules are the export's). */
export const exportable = (q: Pick<Quality, 'roomKind' | 'euUk'>) => q.roomKind === 'public' && !q.euUk;
export function totals(qs: Iterable<Quality>, canExport: (q: Quality) => boolean = exportable): Totals {
  const t: Totals = { movementHours: 0, aimHours: 0, exportMovementHours: 0, exportAimHours: 0, serverOnlyHours: 0, aliveLiveHours: 0, subjectRounds: 0, cleanRounds: 0, byDay: {}, byDevice: {}, byInput: {}, byMap: {} };
  for (const q of qs) {
    if (q.tier === 'bot' || q.tier === 'excluded') continue;
    t.subjectRounds++;
    t.aliveLiveHours += q.aliveLive / 3600;
    if (q.tier === 'server-only') t.serverOnlyHours += q.aliveLive / 3600;
    if (q.clean <= 0) continue;
    const h = q.clean / 3600, aim = (q.aimClean ?? 0) / 3600;
    t.movementHours += h; t.aimHours += aim; t.cleanRounds++;
    if (canExport(q)) { t.exportMovementHours += h; t.exportAimHours += aim; }
    const day = t.byDay[q.date] ??= { movement: 0, aim: 0 };
    day.movement += h; day.aim += aim;
    t.byDevice[q.device || 'unknown'] = (t.byDevice[q.device || 'unknown'] ?? 0) + h;
    t.byInput[q.input] = (t.byInput[q.input] ?? 0) + h;
    t.byMap[q.map] = (t.byMap[q.map] ?? 0) + h;
  }
  return t;
}
