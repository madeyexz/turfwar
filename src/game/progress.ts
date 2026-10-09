import { ROOKIE_ROUNDS } from '../../shared/match/sim';

/**
 * The player's progress on this browser: XP and a level, and one goal per day. Kept in localStorage
 * only (nothing is sent anywhere), fed by the match's own events (game.ts) in Solo and Online alike.
 * It also decides whether Solo treats the player as a rookie (online, the server's career stats do).
 */

export type GoalKind = 'winRounds' | 'kills' | 'headshots' | 'playRounds';
/** The daily goals: how many, and the XP for finishing. One per local calendar day, in rotation. */
export const GOALS: Record<GoalKind, { target: number; xp: number }> = {
  winRounds: { target: 3, xp: 150 },
  kills: { target: 8, xp: 150 },
  headshots: { target: 3, xp: 150 },
  playRounds: { target: 6, xp: 100 },
};
const GOAL_ORDER: GoalKind[] = ['winRounds', 'kills', 'playRounds', 'headshots'];
/** XP per thing done. */
export const XP = { round: 10, roundWon: 20, kill: 15, headshot: 10, matchWon: 80 };

export interface Progress {
  xp: number; rounds: number; roundsWon: number; kills: number; headshots: number; matches: number; matchesWon: number;
  /** The local day (YYYY-MM-DD) the goal belongs to. */
  day: string;
  goal: { kind: GoalKind; count: number; done: boolean };
}

export type ProgressEvent = { type: 'round'; won: boolean } | { type: 'kill'; head: boolean } | { type: 'match'; won: boolean };

/** The local calendar day. */
export function today(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The goal for a day: the days rotate through the goals. */
export function goalFor(day: string): GoalKind {
  const n = Math.floor(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 86_400_000);
  return GOAL_ORDER[((n % GOAL_ORDER.length) + GOAL_ORDER.length) % GOAL_ORDER.length];
}

export function fresh(day = today()): Progress {
  return { xp: 0, rounds: 0, roundsWon: 0, kills: 0, headshots: 0, matches: 0, matchesWon: 0, day, goal: { kind: goalFor(day), count: 0, done: false } };
}

/** Level 1 at 0 XP; each level needs 60 XP more than the last (100, 160, 220…). */
export function levelOf(xp: number) {
  let level = 1, need = 100, into = Math.max(0, Math.floor(xp));
  while (into >= need) { into -= need; level++; need = 100 + 60 * (level - 1); }
  return { level, into, need };
}

/** A new day starts a new goal; the lifetime totals carry on. */
export function rollDay(p: Progress, day: string): Progress {
  return p.day === day ? p : { ...p, day, goal: { kind: goalFor(day), count: 0, done: false } };
}

/** Apply one event: the new progress, the XP it gave, and whether it finished the day's goal. */
export function apply(prev: Progress, e: ProgressEvent, day = today()): { next: Progress; gained: number; goalDone: boolean } {
  const p = rollDay(prev, day);
  const next: Progress = { ...p, goal: { ...p.goal } };
  let gained = 0, step = 0;
  if (e.type === 'round') {
    next.rounds++; gained += XP.round;
    if (e.won) { next.roundsWon++; gained += XP.roundWon; }
    if (next.goal.kind === 'playRounds') step = 1;
    if (next.goal.kind === 'winRounds' && e.won) step = 1;
  } else if (e.type === 'kill') {
    next.kills++; gained += XP.kill;
    if (e.head) { next.headshots++; gained += XP.headshot; }
    if (next.goal.kind === 'kills') step = 1;
    if (next.goal.kind === 'headshots' && e.head) step = 1;
  } else {
    next.matches++;
    if (e.won) { next.matchesWon++; gained += XP.matchWon; }
  }
  let goalDone = false;
  if (step && !next.goal.done) {
    next.goal.count = Math.min(GOALS[next.goal.kind].target, next.goal.count + step);
    if (next.goal.count >= GOALS[next.goal.kind].target) { next.goal.done = true; goalDone = true; gained += GOALS[next.goal.kind].xp; }
  }
  next.xp += gained;
  return { next, gained, goalDone };
}

/** A new player: bots go easier on them (Solo; online the server decides from its career stats). */
export const isRookie = (p: Progress) => p.rounds < ROOKIE_ROUNDS;

// ---- Storage --------------------------------------------------------------------------------------

const KEY = 'lawbreaker.progress';
const listeners = new Set<() => void>();

export function loadProgress(): Progress {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Progress> | null;
    if (!raw || typeof raw !== 'object') return fresh();
    const base = fresh(typeof raw.day === 'string' ? raw.day : today());
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    const goal = raw.goal && typeof raw.goal === 'object' && raw.goal.kind in GOALS ? { kind: raw.goal.kind, count: num(raw.goal.count), done: !!raw.goal.done } : base.goal;
    return rollDay({ ...base, xp: num(raw.xp), rounds: num(raw.rounds), roundsWon: num(raw.roundsWon), kills: num(raw.kills), headshots: num(raw.headshots), matches: num(raw.matches), matchesWon: num(raw.matchesWon), goal }, today());
  } catch { return fresh(); }
}

/** Record an event; returns what it gave (for the HUD). */
export function recordProgress(e: ProgressEvent) {
  const r = apply(loadProgress(), e);
  try { localStorage.setItem(KEY, JSON.stringify(r.next)); } catch { /* storage blocked: progress lasts the page */ }
  for (const f of listeners) f();
  return r;
}

export function onProgress(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
