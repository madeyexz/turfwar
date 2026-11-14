// The features of the repository's learned aim (shared/match/aim.ts) against the lab's (policy.ts), on the same script-bot match.
import { createContext, createMatch, balanceTeams, tickMatch } from './shared/match/sim';
import { ELIMINATION, type MatchEvent, type Soldier } from './shared/match/state';
import { refillAmmo } from './shared/match/economy';
import { eyeOf, weaponOf } from './shared/match/combat';
import { AimState, NF } from './policy';
import { A, NA, OWN, OV, SLOT, WIDX, fillEnemies, wrap, type Seen } from './rows';
import { learnedLook, aimInput } from '/home/user/workspace/repo/shared/match/aim';

const DT = 1 / 30, SCAN = 6;
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
class Ctl { st = new AimState(); row = new Float32Array(NA); hasPrev = false; lastYaw = 0; lastPitch = 0; v0 = -1; v1 = -1; v2 = -1; shots = 0; hurt = 0; }
const ctls = new Map<number, Ctl>();
const ctlOf = (id: number) => { let c = ctls.get(id); if (!c) ctls.set(id, c = new Ctl()); return c; };
let liveT = 0, liveTick = 0, rounds = 0;
const ctx = createContext('taipei', rng(5), (e: MatchEvent) => {
  if (e.type === 'shot') ctlOf(e.shooter).shots++;
  else if (e.type === 'damage') ctlOf(e.target).hurt += e.amount;
  else if (e.type === 'round') {
    if (e.phase === 'freeze') for (const s of state.soldiers) { s.weapons[0] = 'mp5' as never; s.attachments = {}; s.grenades = 0; s.molotovs = 0; s.money = 0; s.weapon = 0; refillAmmo(s); }
    if (e.phase === 'live') { liveT = state.time; liveTick = state.tick; } else if (e.phase === 'over') rounds++;
  }
});
const state = createMatch('taipei', { ...ELIMINATION, teamSize: 6, botSkill: 0.3, warmup: 0.2, roundsToWin: 6 });
balanceTeams(state, ctx);
const pool: Seen[] = Array.from({ length: 64 }, () => ({ id: 0, bot: 1, x: 0, y: 0, z: 0, crouch: 0, health: 0 }));
const x = new Float32Array(NF + 1), worst = new Float64Array(NF), bad = new Int32Array(NF);
let rows = 0, seenRows = 0;
while (rounds < 12) {
  tickMatch(state, ctx, DT);
  const live = state.phase === 'live' && state.roundPhase === 'live';
  for (const s of state.soldiers) {
    const c = ctlOf(s.id);
    if (!(live && s.alive)) { c.hasPrev = false; c.shots = 0; c.hurt = 0; continue; }
    const R = c.row, newRun = !c.hasPrev, m = s.m, w = weaponOf(s), yaw = wrap(s.yaw), pitch = s.pitch;
    R.fill(0);
    R[A.t] = state.time - liveT; R[A.dt] = newRun ? 0 : DT; R[A.yaw] = yaw; R[A.pitch] = pitch;
    if (!newRun) { R[A.mdyaw] = wrap(s.yaw - c.lastYaw); R[A.mdpitch] = pitch - c.lastPitch; }
    R[A.fire] = s.sinceShot < 0.15 ? 1 : 0; R[A.shots] = 0; R[A.weapon] = WIDX[w.id]; R[A.ads] = s.ads ? 1 : 0; R[A.crouch] = m.crouch;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    R[A.speed] = Math.hypot(m.vx, m.vz); R[A.vf] = m.vx * fx + m.vz * fz; R[A.vs] = m.vx * rx + m.vz * rz;
    R[A.grounded] = m.grounded ? 1 : 0; R[A.health] = s.health; R[A.ammo] = s.weapon === 2 ? 0 : s.ammo[s.weapon]; R[A.reloading] = s.reloadLeft > 0 ? 1 : 0;
    const scan = newRun || (state.tick + s.id) % SCAN === 0;
    let n = 0;
    for (const e of state.soldiers) {
      if (e.team === s.team || !e.alive) continue;
      if (!scan && e.id !== c.v0 && e.id !== c.v1 && e.id !== c.v2) continue;
      const q = pool[n++]; q.id = e.id; q.x = e.m.x; q.y = e.m.y; q.z = e.m.z; q.crouch = e.m.crouch; q.health = e.health;
    }
    const eye = eyeOf(s);
    R[A.nvis] = fillEnemies(R, OWN, ctx.world, undefined, eye.x, eye.y, eye.z, yaw, pitch, s.team, pool, n, 10);
    c.v0 = R[OWN + 6] > 0 ? R[OWN] : -1; c.v1 = R[OWN + SLOT + 6] > 0 ? R[OWN + SLOT] : -1; c.v2 = R[OWN + 2 * SLOT + 6] > 0 ? R[OWN + 2 * SLOT] : -1;
    R[A.hurt] = c.hurt;
    c.lastYaw = s.yaw; c.lastPitch = pitch; c.hasPrev = true; c.shots = 0; c.hurt = 0;
    c.st.rows.set(R, c.st.push(newRun));
    c.st.features(x);
    learnedLook(state as never, ctx as never, s as never, 2);
    const y = aimInput();
    rows++; if (R[A.nvis] > 0) seenRows++;
    for (let i = 0; i < NF; i++) {
      const a = Math.max(-2, Math.min(2, x[i])), b = Math.max(-2, Math.min(2, y[i])), d = Math.abs(a - b);
      if (d > worst[i]) worst[i] = d;
      if (d > 1e-4) bad[i]++;
    }
  }
}
const off = [...worst].map((d, i) => [i, d, bad[i]] as const).filter(v => v[1] > 1e-4);
console.log('rows', rows, 'with an enemy in sight', seenRows, 'features that differ:', off.length ? off.map(v => `#${v[0]} max ${v[1].toFixed(4)} in ${v[2]} rows`).join('; ') : 'none');
