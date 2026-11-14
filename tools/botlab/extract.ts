// Extract training and metric rows from the local copy of the recordings (read key only, files under /tmp).
// Usage: bun extract.ts <shard> <shards> [maxSegments]
// Writes /tmp/rec/ds/{haim,baim,hmove,bmove}-<shard>.f32, tracks-<shard>.jsonl and segs-<shard>.jsonl.
// Players are opaque numbers (order of first appearance in quality.jsonl); no pid, name or session id is written.
import { readFileSync, mkdirSync } from 'node:fs';
import { decodeSegment } from '/home/user/workspace/repo/shared/rec/segment';
import { decodeFrames, clockFit, type Decoded, type InputSession } from '/home/user/workspace/repo/shared/rec/clean';
import { In } from '/home/user/workspace/repo/shared/rec/inputlog';
import { inputsFor } from '/home/user/workspace/repo/tools/recorder/lib';
import { loadMap, loadNav } from '/home/user/workspace/repo/shared/maps/index';
import { nearestNode } from '/home/user/workspace/repo/shared/match/nav';
import { client, local, Lru, shardOf } from './local';
import { A, M, NA, NM, OWN, OV, SegView, RowFile, fillEnemies, wrap, type Seen } from './rows';

const shard = Number(process.argv[2] ?? 0), shards = Number(process.argv[3] ?? 1), maxSeg = Number(process.argv[4] ?? Infinity);
const DS = '/tmp/rec/ds/';
mkdirSync(DS, { recursive: true });
const tag = process.env.TAG ?? (maxSeg === Infinity ? `${shard}` : `test${shard}`);
const files = { haim: new RowFile(`${DS}haim-${tag}.f32`, NA), baim: new RowFile(`${DS}baim-${tag}.f32`, NA), hmove: new RowFile(`${DS}hmove-${tag}.f32`, NM), bmove: new RowFile(`${DS}bmove-${tag}.f32`, NM) };
const tracks = Bun.file(`${DS}tracks-${tag}.jsonl`).writer(), segsOut = Bun.file(`${DS}segs-${tag}.jsonl`).writer();
const RENDER_DELAY = Number(process.env.RENDER_DELAY ?? 180), LAG_ADD = Number(process.env.LAG_ADD ?? 0); // ms: remote soldiers are drawn this late on the client (interpolation delay plus arrival)
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

const lines = readFileSync('/tmp/rec/quality.jsonl', 'utf8').split('\n').filter(Boolean);
const pidNum = new Map<string, number>();
for (const l of lines) for (const q of JSON.parse(l).q.qualities) if (q.pid && !pidNum.has(q.pid)) pidNum.set(q.pid, pidNum.size);

const cache = new Lru<string, InputSession[]>(10);
const eyeOf = (crouch: number) => 1.62 + (1.05 - 1.62) * crouch;
const seenPool: Seen[] = Array.from({ length: 64 }, () => ({ id: 0, bot: 0, x: 0, y: 0, z: 0, crouch: 0, health: 0 }));
const tmpPose = { x: 0, y: 0, z: 0, crouch: 0, health: 0 };
const rayO = { x: 0, y: 0, z: 0 }, rayD = { x: 0, y: 0, z: 0 }, losA = { x: 0, y: 0, z: 0 }, losB = { x: 0, y: 0, z: 0 };

interface SegCtx {
  d: Decoded; v: SegView; world: ReturnType<typeof loadMap>['world']; def: ReturnType<typeof loadMap>['def']; nav: ReturnType<typeof loadNav>;
  hurt: Float32Array; shots: Uint8Array; hits: Uint8Array; heads: Uint8Array; seated: Uint8Array; lastLive: number; sites: { x: number; y: number; z: number }[];
}

/** Movement rows (10 Hz of the frame clock) for one soldier: alive, live round, on foot. */
function moveRows(c: SegCtx, slot: number, out: RowFile): number {
  const { v, world, nav } = c, S = v.S, team = v.team[slot];
  let rows = 0, next = -1, prevT = -1, hurt = 0;
  const t0 = v.time[v.liveStart];
  const order: { d: number; e: number }[] = [];
  for (let f = v.liveStart; f <= c.lastLive; f++) {
    const i = f * S + slot;
    hurt += c.hurt[i];
    if (v.phase[f] !== 1 || !(v.flags[i] & 1) || c.seated[i]) { prevT = -1; continue; }
    const t = v.time[f];
    if (t < next) continue;
    next = t + 0.0999 - 1 / 60;
    const { a, o } = out.row(); rows++;
    const yaw = wrap(v.yaw[i]), x = v.x[i], y = v.y[i], z = v.z[i];
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    a[o + M.t] = t - t0; a[o + M.dt] = prevT < 0 ? 0 : t - prevT; prevT = t;
    a[o + M.x] = x; a[o + M.y] = y; a[o + M.z] = z; a[o + M.yaw] = yaw; a[o + M.pitch] = v.pitch[i];
    a[o + M.vf] = v.vx[i] * fx + v.vz[i] * fz; a[o + M.vs] = v.vx[i] * rx + v.vz[i] * rz; a[o + M.vy] = v.vy[i];
    a[o + M.flags] = v.flags[i]; a[o + M.health] = v.health[i]; a[o + M.weapon] = v.weapon[i] & 15;
    // Others.
    let nAl = 0, nEn = 0, ntD = -1, ntB = 0;
    order.length = 0;
    for (let e = 0; e < S; e++) {
      if (e === slot) continue;
      const j = f * S + e;
      if (!(v.flags[j] & 1)) continue;
      const dx = v.x[j] - x, dz = v.z[j] - z, dist = Math.hypot(dx, v.y[j] - y, dz);
      if (v.team[e] === team) { nAl++; if (ntD < 0 || dist < ntD) { ntD = dist; ntB = wrap(Math.atan2(-dx, -dz) - yaw); } }
      else { nEn++; order.push({ d: dist, e }); }
    }
    order.sort((p, q) => p.d - q.d);
    let nVis = 0, nvD = -1, nvB = 0;
    losA.x = x; losA.y = y + eyeOf(v.crouch[i]); losA.z = z;
    for (let k = 0; k < order.length && k < 8; k++) {
      const j = f * S + order[k].e;
      losB.x = v.x[j]; losB.y = v.y[j] + 1.2 * (1 - 0.34 * v.crouch[j]); losB.z = v.z[j];
      if (order[k].d < 120 && world.lineOfSight(losA, losB, team)) { nVis++; if (nvD < 0) { nvD = order[k].d; nvB = wrap(Math.atan2(-(losB.x - x), -(losB.z - z)) - yaw); } }
    }
    a[o + M.nvDist] = nvD; a[o + M.nvBear] = nvB;
    if (order.length) { const j = f * S + order[0].e; a[o + M.neDist] = order[0].d; a[o + M.neBear] = wrap(Math.atan2(-(v.x[j] - x), -(v.z[j] - z)) - yaw); } else a[o + M.neDist] = -1;
    a[o + M.ntDist] = ntD; a[o + M.ntBear] = ntB; a[o + M.nAllies] = nAl; a[o + M.nEnemies] = nEn; a[o + M.nVisible] = nVis;
    for (let s = 0; s < 2; s++) {
      const p = c.sites[s];
      if (!p) { a[o + M.siteA + s * 2] = -1; continue; }
      a[o + M.siteA + s * 2] = Math.hypot(p.x - x, p.z - z); a[o + M.siteABear + s * 2] = wrap(Math.atan2(-(p.x - x), -(p.z - z)) - yaw);
    }
    const b = c.d.frames[f].bomb;
    a[o + M.bomb] = b.armed ? b.site + 1 : b.progress > 0 ? -(b.site + 1) : 0;
    a[o + M.left] = c.d.frames[f].phaseLeft;
    rayO.x = x; rayO.y = y + 1.0; rayO.z = z; rayD.y = 0;
    for (let k = 0; k < 8; k++) {
      const ang = yaw + k * Math.PI / 4;
      rayD.x = -Math.sin(ang); rayD.z = -Math.cos(ang);
      const hit = world.raycast(rayO, rayD, 40, team);
      a[o + M.rays + k] = hit ? hit.t : 40;
    }
    a[o + M.node] = nearestNode(nav, x, y, z);
    a[o + M.hurt] = hurt; hurt = 0;
  }
  return rows;
}

/** Aim rows for a bot from the server frames (one per frame: alive, live, on foot). The aim change is all the bot's own (no recoil on bots). */
function botAimRows(c: SegCtx, slot: number, out: RowFile): number {
  const { v, world } = c, S = v.S, team = v.team[slot];
  let rows = 0, prev = -1;
  const t0 = v.time[v.liveStart];
  for (let f = v.liveStart; f <= c.lastLive; f++) {
    const i = f * S + slot;
    if (v.phase[f] !== 1 || !(v.flags[i] & 1) || c.seated[i]) { prev = -1; continue; }
    const { a, o } = out.row(); rows++;
    const yaw = wrap(v.yaw[i]), pitch = v.pitch[i], x = v.x[i], y = v.y[i], z = v.z[i], fl = v.flags[i];
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    a[o + A.t] = v.time[f] - t0; a[o + A.dt] = prev < 0 ? 0 : v.time[f] - v.time[prev];
    a[o + A.yaw] = yaw; a[o + A.pitch] = pitch;
    if (prev >= 0) { a[o + A.mdyaw] = wrap(v.yaw[i] - v.yaw[prev * S + slot]); a[o + A.mdpitch] = pitch - v.pitch[prev * S + slot]; }
    a[o + A.fire] = fl & 128 ? 1 : 0; a[o + A.shots] = c.shots[i]; a[o + A.hits] = c.hits[i]; a[o + A.heads] = c.heads[i];
    a[o + A.weapon] = v.weapon[i] & 15; a[o + A.ads] = fl & 8 ? 1 : 0; a[o + A.crouch] = v.crouch[i];
    a[o + A.speed] = Math.hypot(v.vx[i], v.vz[i]); a[o + A.vf] = v.vx[i] * fx + v.vz[i] * fz; a[o + A.vs] = v.vx[i] * rx + v.vz[i] * rz;
    a[o + A.grounded] = fl & 2 ? 1 : 0; a[o + A.health] = v.health[i]; a[o + A.ammo] = v.ammo[i]; a[o + A.reloading] = fl & 64 ? 1 : 0;
    let n = 0, nEn = 0;
    for (let e = 0; e < S; e++) {
      const j = f * S + e;
      if (v.team[e] === team || !(v.flags[j] & 1)) continue;
      nEn++;
      if (n >= seenPool.length) continue;
      const s = seenPool[n++];
      s.id = e; s.bot = v.bot[e]; s.x = v.x[j]; s.y = v.y[j]; s.z = v.z[j]; s.crouch = v.crouch[j]; s.health = v.health[j];
    }
    a[o + A.nvis] = fillEnemies(a, o + OWN, world, v.clouds[f], x, y + eyeOf(v.crouch[i]), z, yaw, pitch, team, seenPool, n);
    a[o + A.nenemy] = nEn; a[o + A.hurt] = c.hurt[i]; a[o + A.nframes] = 1; a[o + A.tick] = v.tick[f] - v.tick[v.liveStart]; a[o + A.aimkey] = fl & 8 ? 1 : 0;
    a[o + OV] = a[o + OWN + 3]; a[o + OV + 1] = a[o + OWN + 4]; a[o + OV + 2] = a[o + OWN + 6];
    prev = f;
  }
  return rows;
}

// ---- The human side: client frame records joined to server ticks ----
interface Joined {
  key: string; n: number; t: Float64Array; yaw: Float32Array; pitch: Float32Array; mdyaw: Float32Array; mdpitch: Float32Array; alive: Uint8Array; fire: Uint8Array; aim: Uint8Array;
  shotT: Float64Array; shotFrame: Int32Array; tickOf: (t: number) => number; residual: number; sens: number; fov: number; rtt: number; fps: number;
}
let lastJoin: Joined | undefined;
function join(key: string, sessions: InputSession[], room: number, soldierId: number): Joined | undefined {
  if (lastJoin?.key === key) return lastJoin;
  const mine = sessions.filter(i => i.header.db && i.header.soldierId === soldierId && i.header.room === room);
  if (!mine.length) return undefined;
  const origin = mine[0].header.timeOrigin ?? 0;
  type R = { r: InputSession['records'][number]; t: number; s: number };
  const recs: R[] = [];
  mine.forEach((i, s) => { const shift = (i.header.timeOrigin ?? origin) - origin; for (const r of i.records) recs.push({ r, t: r.t + shift, s }); });
  recs.sort((a, b) => a.t - b.t);
  const fit = clockFit(recs.map(x => (x.t === x.r.t ? x.r : { ...x.r, t: x.t })));
  if (!fit) return undefined;
  const idx = mine.map(i => {
    const fire = new Set<number>(), aim = new Set<number>();
    i.header.actions.forEach((a, k) => { const parts = a.split('|'); if (parts.includes('fire')) fire.add(k); if (parts.includes('aim')) aim.add(k); });
    return { fire, aim };
  });
  const nF = recs.reduce((n, x) => n + (x.r.type === In.Frame ? 1 : 0), 0);
  const j: Joined = {
    key, n: nF, t: new Float64Array(nF), yaw: new Float32Array(nF), pitch: new Float32Array(nF), mdyaw: new Float32Array(nF), mdpitch: new Float32Array(nF), alive: new Uint8Array(nF), fire: new Uint8Array(nF), aim: new Uint8Array(nF),
    shotT: new Float64Array(0), shotFrame: new Int32Array(0), tickOf: fit.tickOf, residual: fit.residual, sens: mine[0].header.sens, fov: mine[0].header.fov, rtt: 0, fps: 0,
  };
  const fireDown = new Set<number>(), aimDown = new Set<number>();
  const shotT: number[] = [], shotFrame: number[] = [], rtts: number[] = [];
  let n = 0, session = -1;
  for (const x of recs) {
    const r = x.r;
    if (x.s !== session) { session = x.s; fireDown.clear(); aimDown.clear(); }
    if (r.type === In.Key) {
      const m = idx[x.s];
      if (m.fire.has(r.key)) { if (r.down) fireDown.add(r.key); else fireDown.delete(r.key); }
      if (m.aim.has(r.key)) { if (r.down) aimDown.add(r.key); else aimDown.delete(r.key); }
    } else if (r.type === In.State) { if (r.state === 2 || r.state === 4 || r.state === 6) { fireDown.clear(); aimDown.clear(); } }
    else if (r.type === In.Send) { if (r.kind === 1) { shotT.push(x.t); shotFrame.push(n); } }
    else if (r.type === In.Rtt) rtts.push(r.ms);
    else if (r.type === In.Frame) {
      j.t[n] = x.t; j.yaw[n] = r.yaw; j.pitch[n] = r.pitch; j.mdyaw[n] = -r.lookX * r.scale; j.mdpitch[n] = -r.lookY * r.scale; j.alive[n] = r.alive ? 1 : 0;
      j.fire[n] = fireDown.size ? 1 : 0; j.aim[n] = aimDown.size ? 1 : 0; n++;
    }
  }
  j.shotT = Float64Array.from(shotT); j.shotFrame = Int32Array.from(shotFrame);
  rtts.sort((a, b) => a - b); j.rtt = rtts.length ? rtts[rtts.length >> 1] : 0;
  j.fps = nF > 1 ? (nF - 1) / ((j.t[nF - 1] - j.t[0]) / 1000) : 0;
  return lastJoin = j;
}
const lowerBound = (a: Float64Array, x: number) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };

/** Aim rows for a mouse player: 30 Hz bins of the client's frame records; enemies as the client drew them. Returns the rows and the track's facts. */
function humanAimRows(c: SegCtx, slot: number, j: Joined, out: RowFile): { rows: number; lag: number } {
  const { v, world } = c, S = v.S, team = v.team[slot], id = v.ids[slot];
  const tickLive = v.tick[v.liveStart], tickEnd = v.tick[c.lastLive];
  // The frame records of this round's live part: tickOf rises with t.
  let lo = 0, hi = j.n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (j.tickOf(j.t[m]) < tickLive) lo = m + 1; else hi = m; }
  const first = lo;
  hi = j.n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (j.tickOf(j.t[m]) <= tickEnd) lo = m + 1; else hi = m; }
  const end = lo;
  if (end - first < 60) return { rows: 0, lag: -1 };
  // How many ticks later the server shows the aim the client had (best of 0..15, as the clean rules do).
  let lag = 0, bestErr = Infinity;
  for (let L = 0; L <= 15; L++) {
    const errs: number[] = [];
    for (let k = first; k < end; k += 4) {
      if (!j.alive[k]) continue;
      const tk = Math.round(j.tickOf(j.t[k])) + L - v.tick0;
      const f = tk >= 0 && tk < v.byTick.length ? v.byTick[tk] : -1;
      if (f < 0 || !(v.flags[f * S + slot] & 1)) continue;
      errs.push(Math.abs(wrap(j.yaw[k] - v.yaw[f * S + slot])));
    }
    if (errs.length < 20) continue;
    errs.sort((a, b) => a - b);
    const med = errs[errs.length >> 1];
    if (med < bestErr - 1e-6) { bestErr = med; lag = L; }
  }
  const lagUsed = lag + LAG_ADD;
  // The server's shots of this soldier, in order, for the client's shot sends.
  const sv: { tick: number; hit: number; used: boolean }[] = [];
  for (let f = v.liveStart; f <= c.lastLive; f++) { const i = f * S + slot; for (let n = 0; n < c.shots[i]; n++) sv.push({ tick: v.tick[f], hit: n < c.heads[i] ? 2 : n < c.hits[i] ? 1 : 0, used: false }); }
  const hitOf = new Map<number, { shots: number; hits: number; heads: number }>(); // by frame record index
  let svAt = 0;
  for (let s = lowerBound(j.shotT, j.t[first]); s < j.shotT.length && j.shotT[s] <= j.t[end - 1]; s++) {
    const k = j.tickOf(j.shotT[s]);
    while (svAt < sv.length && sv[svAt].tick < k - 2) svAt++;
    const e = hitOf.get(j.shotFrame[s]) ?? { shots: 0, hits: 0, heads: 0 };
    e.shots++;
    for (let q = svAt; q < sv.length && sv[q].tick <= k + 14; q++) if (!sv[q].used) { sv[q].used = true; if (sv[q].hit) e.hits++; if (sv[q].hit === 2) e.heads++; break; }
    hitOf.set(j.shotFrame[s], e);
  }
  const tStart = j.t[first], BIN = 1000 / 30;
  let rows = 0, prevBin = -2, k = first, lastK = -1, hurtFrom = v.liveStart;
  while (k < end) {
    const bin = Math.floor((j.t[k] - tStart) / BIN);
    let mdy = 0, mdp = 0, shots = 0, hits = 0, heads = 0, nf = 0, last = k, alive = 1;
    while (k < end && Math.floor((j.t[k] - tStart) / BIN) === bin) {
      mdy += j.mdyaw[k]; mdp += j.mdpitch[k]; nf++; last = k; alive &= j.alive[k];
      const h = hitOf.get(k); if (h) { shots += h.shots; hits += h.hits; heads += h.heads; }
      k++;
    }
    const tEnd = j.t[last], kNow = j.tickOf(tEnd);
    // The server's view of this soldier at the same moment (its pose arrives `lag` ticks later).
    const fo = v.at(kNow + lagUsed);
    if (fo < 0) continue;
    const i = fo * S + slot;
    // Damage taken since the last bin (even when this bin makes no row).
    let hurt = 0; const fNow = v.at(kNow); for (let f = hurtFrom + 1; f <= fNow; f++) hurt += c.hurt[f * S + slot]; if (fNow > hurtFrom) hurtFrom = fNow;
    if (!alive || v.phase[fo] !== 1 || !(v.flags[i] & 1) || c.seated[i] || !v.pose(slot, kNow + lagUsed, tmpPose)) { prevBin = -2; lastK = -1; continue; }
    const { a, o } = out.row(); rows++;
    const yaw = wrap(j.yaw[last]), pitch = j.pitch[last], fl = v.flags[i];
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    a[o + A.t] = (tEnd - tStart) / 1000; a[o + A.dt] = prevBin < 0 ? 0 : (bin - prevBin) / 30; prevBin = bin;
    a[o + A.yaw] = yaw; a[o + A.pitch] = pitch; a[o + A.mdyaw] = mdy; a[o + A.mdpitch] = mdp;
    a[o + A.fire] = j.fire[last]; a[o + A.shots] = shots; a[o + A.hits] = hits; a[o + A.heads] = heads;
    a[o + A.weapon] = v.weapon[i] & 15; a[o + A.ads] = fl & 8 ? 1 : 0; a[o + A.crouch] = tmpPose.crouch;
    a[o + A.speed] = Math.hypot(v.vx[i], v.vz[i]); a[o + A.vf] = v.vx[i] * fx + v.vz[i] * fz; a[o + A.vs] = v.vx[i] * rx + v.vz[i] * rz;
    a[o + A.grounded] = fl & 2 ? 1 : 0; a[o + A.health] = v.health[i]; a[o + A.ammo] = v.ammo[i]; a[o + A.reloading] = fl & 64 ? 1 : 0;
    const ex = tmpPose.x, ey = tmpPose.y + eyeOf(tmpPose.crouch), ez = tmpPose.z;
    // Enemies where the client drew them: the newest tick it had, less the render delay.
    const kSeen = j.tickOf(tEnd - RENDER_DELAY), fSeen = v.at(kSeen);
    let n = 0, nEn = 0;
    if (fSeen >= 0) for (let e = 0; e < S; e++) {
      if (v.team[e] === team || !v.pose(e, kSeen, tmpPose)) continue;
      nEn++;
      if (n >= seenPool.length) continue;
      const s = seenPool[n++];
      s.id = e; s.bot = v.bot[e]; s.x = tmpPose.x; s.y = tmpPose.y; s.z = tmpPose.z; s.crouch = tmpPose.crouch; s.health = tmpPose.health;
    }
    a[o + A.nvis] = fillEnemies(a, o + OWN, world, fSeen >= 0 ? v.clouds[fSeen] : undefined, ex, ey, ez, yaw, pitch, team, seenPool, n);
    a[o + A.nenemy] = nEn; a[o + A.hurt] = hurt; a[o + A.nframes] = nf; a[o + A.tick] = kNow - tickLive; a[o + A.aimkey] = j.aim[last];
    // The same enemy as a spectator sees it when this aim reaches the server.
    const e0 = a[o + OWN];
    if (e0 >= 0 && v.pose(e0, kNow + lagUsed, tmpPose)) {
      const sc = 1 - 0.34 * tmpPose.crouch, dx = tmpPose.x - ex, dz = tmpPose.z - ez, hd = Math.hypot(dx, dz);
      losA.x = ex; losA.y = ey; losA.z = ez; losB.x = tmpPose.x; losB.y = tmpPose.y + 1.2 * sc; losB.z = tmpPose.z;
      a[o + OV] = wrap(Math.atan2(-dx, -dz) - yaw); a[o + OV + 1] = Math.atan2(losB.y - ey, hd) - pitch;
      let vis = world.lineOfSight(losA, losB, team) ? 1 : 0; losB.y = tmpPose.y + 1.66 * sc; if (world.lineOfSight(losA, losB, team)) vis |= 2;
      a[o + OV + 2] = vis;
    }
    lastK = last;
  }
  void lastK; void id;
  return { rows, lag };
}

// ---- One segment ----
const t00 = Date.now();
let done = 0, errors = 0, nTracks = 0;
for (let li = 0; li < lines.length && done < maxSeg; li++) {
  const { q } = JSON.parse(lines[li]) as { q: { segment: string; qualities: any[] } };
  if (shardOf(q.segment, shards) !== shard) continue;
  try {
    const seg = decodeSegment(new Uint8Array(Bun.zstdDecompressSync(await Bun.file(local(q.segment)).bytes())));
    const d = decodeFrames(seg);
    const v = new SegView(d);
    done++;
    if (!d.frames.length || v.liveStart < 0) continue;
    const h = d.header, S = v.S, n = v.n;
    const { def, world } = loadMap(h.mapId), nav = loadNav(h.mapId);
    let lastLive = v.liveStart; for (let f = v.liveStart; f < n; f++) if (v.phase[f] === 1) lastLive = f;
    const c: SegCtx = {
      d, v, world, def, nav, hurt: new Float32Array(n * S), shots: new Uint8Array(n * S), hits: new Uint8Array(n * S), heads: new Uint8Array(n * S), seated: new Uint8Array(n * S), lastLive,
      sites: h.mode === 'sabotage' && def.sabotage ? def.sabotage.sites.map(id => def.points.find(p => p.id === id)!).filter(Boolean) : [],
    };
    for (let f = 0; f < n; f++) {
      const F = d.frames[f];
      for (const s of F.shots) {
        const slot = v.slotOf.get(s.shooter); if (slot === undefined) continue;
        const i = f * S + slot;
        if (s.weapon === 'm1014' || s.weapon === 'knife') { c.shots[i] = 1; if (s.hit) c.hits[i] = 1; if (s.hit === 2) c.heads[i] = 1; }
        else { c.shots[i]++; if (s.hit) c.hits[i]++; if (s.hit === 2) c.heads[i]++; }
      }
      for (const veh of F.vehicles) for (const who of [veh.driver, veh.passenger]) {
        if (who < 0) continue;
        for (let s = 0; s < S; s++) if ((v.ids[s] & 0x7fff) === who) c.seated[f * S + s] = 1;
      }
    }
    const posAt = (id: number, tick: number) => { const s = v.slotOf.get(id), f = v.at(tick); return s === undefined || f < 0 ? undefined : { s, f, i: f * S + s }; };
    const kills: unknown[] = [], bomb: unknown[] = [], dmg = new Float32Array(S), taken = new Float32Array(S);
    let winner = -1, reason = '';
    const tLive = v.time[v.liveStart];
    for (const { tick, e } of d.events) {
      if (e.type === 'damage') {
        const t = posAt(e.target, tick); if (t) { c.hurt[t.i] += e.amount; taken[t.s] += e.amount; }
        const a = v.slotOf.get(e.attacker); if (a !== undefined) dmg[a] += e.amount;
      } else if (e.type === 'kill') {
        const k = posAt(e.killer, tick), w = posAt(e.victim, tick);
        const f = v.at(tick);
        kills.push({ t: +(v.time[Math.max(0, f)] - tLive).toFixed(2), k: k?.s ?? -1, v: w?.s ?? -1, w: e.weapon, h: e.head ? 1 : 0, d: k && w ? +Math.hypot(v.x[k.i] - v.x[w.i], v.y[k.i] - v.y[w.i], v.z[k.i] - v.z[w.i]).toFixed(1) : -1 });
      } else if (e.type === 'bomb') {
        const f = v.at(tick);
        bomb.push({ a: e.action, site: e.site, t: +(v.time[Math.max(0, f)] - tLive).toFixed(2), by: v.slotOf.get(e.by) ?? -1 });
      } else if (e.type === 'round' && e.phase === 'over') { winner = e.winner; reason = e.reason ?? ''; }
    }
    // Subjects' facts from the roster rows (money, weapons); the weapon most held in each slot from the frames.
    const qBySoldier = new Map<number, any>(q.qualities.map(x => [x.soldierId, x]));
    const soldiers = h.soldiers.map((s, slot) => {
      const held: Record<string, number>[] = [{}, {}];
      let aliveFrames = 0, shots = 0, hits = 0, heads = 0;
      for (let f = v.liveStart; f <= lastLive; f++) { const i = f * S + slot; shots += c.shots[i]; hits += c.hits[i]; heads += c.heads[i]; if (!(v.flags[i] & 1)) continue; aliveFrames++; const sl = v.weapon[i] >> 4; if (sl < 2) held[sl][v.weapon[i] & 15] = (held[sl][v.weapon[i] & 15] ?? 0) + 1; }
      const top = (m: Record<string, number>) => { let b = -1, bn = 0; for (const k in m) if (m[k] > bn) { bn = m[k]; b = +k; } return b; };
      const qq = qBySoldier.get(s.soldierId);
      const rows = d.roster.filter(r => r.r.id === s.soldierId && typeof r.r.money === 'number');
      const r0 = rows[0]?.r, r1 = [...rows].reverse().find(r => r.tick <= v.tick[v.liveStart] + 30 * 22)?.r ?? r0;
      let att = 0; try { att = r1?.gearJson ? Object.values(JSON.parse(r1.gearJson as string).attachments ?? {}).flat().length : 0; } catch { /* none */ }
      return {
        slot, team: s.team, bot: s.bot ? 1 : 0, p: s.pid ? pidNum.get(s.pid) ?? -1 : -1, tier: qq?.tier ?? (s.bot ? 'bot' : 'none'), clean: qq ? +qq.clean.toFixed(1) : 0, aim: qq ? +qq.aimClean.toFixed(1) : 0,
        input: qq?.input, assist: qq?.aimAssist ? 1 : 0, alive: +(aliveFrames / 30).toFixed(1), held0: top(held[0]), held1: top(held[1]), dmg: Math.round(dmg[slot]), taken: Math.round(taken[slot]), shots, hits, heads,
        ...(r0 ? { money0: r0.money, money1: r1?.money, w0: r1?.weapon0, w1: r1?.weapon1, att, kills: rows[rows.length - 1].r.kills, deaths: rows[rows.length - 1].r.deaths } : {}),
      };
    });
    const match = hash(h.matchUid ?? q.segment.replace(/-r\d+.*$/, ''));
    segsOut.write(JSON.stringify({ i: li, map: h.mapId, mode: h.mode, size: h.teamSize, kind: h.roomKind, date: new Date(h.startMs).toISOString().slice(0, 10), hour: new Date(h.startMs).getUTCHours(), round: h.round, match, live: +(v.time[lastLive] - tLive).toFixed(1), frames: n, winner, reason, attacker: def.sabotage?.attackerSpawn ?? -1, bomb, kills, soldiers }) + '\n');
    const base = { seg: li, map: h.mapId, mode: h.mode, size: h.teamSize, room: h.roomKind, round: h.round, match };
    const track = (kind: keyof typeof files, slot: number, start: number, rows: number, extra: object) => { if (rows) { nTracks++; tracks.write(JSON.stringify({ kind, ...base, slot, team: v.team[slot], start, n: rows, ...extra }) + '\n'); } };
    let anyAim = false;
    for (const x of q.qualities) {
      if (x.tier !== 'clean' || !(x.clean > 0)) continue;
      const slot = v.slotOf.get(x.soldierId); if (slot === undefined) continue;
      const p = pidNum.get(x.pid) ?? -1, extra = { p, input: x.input, assist: x.aimAssist ? 1 : 0, device: x.device, clean: x.clean, aim: x.aimClean, exp: x.roomKind === 'public' && !x.euUk ? 1 : 0 };
      let start = files.hmove.rows;
      track('hmove', slot, start, moveRows(c, slot, files.hmove), extra);
      if (!(x.aimClean > 0) || x.input !== 'mouse') continue;
      const found = await inputsFor(client, 'v1', x.pid, seg, x.soldierId, cache);
      const j = join(`${p}:${h.room}:${x.soldierId}:${found.sessions.length}:${found.sessions.reduce((s, i) => s + i.records.length, 0)}`, found.sessions, h.room, x.soldierId);
      if (!j) continue;
      start = files.haim.rows;
      const r = humanAimRows(c, slot, j, files.haim);
      track('haim', slot, start, r.rows, { ...extra, lag: r.lag, resid: +j.residual.toFixed(2), sens: j.sens, fov: j.fov, rtt: Math.round(j.rtt), fps: Math.round(j.fps) });
      anyAim ||= r.rows > 0;
    }
    // One bot per segment (the same choice every run): movement always; aim where a mouse player's aim rows exist.
    const bots = h.soldiers.map((s, i) => (s.bot ? i : -1)).filter(i => i >= 0);
    if (bots.length) {
      const slot = bots[hash(q.segment) % bots.length];
      let start = files.bmove.rows;
      track('bmove', slot, start, moveRows(c, slot, files.bmove), { p: -1 });
      if (anyAim) { start = files.baim.rows; track('baim', slot, start, botAimRows(c, slot, files.baim), { p: -1 }); }
    }
  } catch (e) { errors++; if (errors < 20) console.log('ERR', li, String((e as Error).stack ?? e).slice(0, 400)); }
  if (done % 250 === 0) { console.log(shard, done, 'segs', ((Date.now() - t00) / 1000).toFixed(0) + 's', 'rows', files.haim.rows, files.baim.rows, files.hmove.rows, files.bmove.rows, 'rss', (process.memoryUsage().rss / 1e6).toFixed(0) + 'MB', 'err', errors); tracks.flush(); segsOut.flush(); }
}
for (const f of Object.values(files)) await f.end();
await tracks.end(); await segsOut.end();
console.log('DONE', JSON.stringify({ shard, done, errors, nTracks, haim: files.haim.rows, baim: files.baim.rows, hmove: files.hmove.rows, bmove: files.bmove.rows, seconds: (Date.now() - t00) / 1000 }));
