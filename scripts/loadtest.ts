/**
 * Online load test: headless clients join a LOCAL SpacetimeDB match, move with the shared
 * movement controller between map landmarks, and fire at visible enemies with claimed hits the
 * server validates. Prints the server tick rate, bytes each client receives, report round trips,
 * movement corrections and kills.
 *
 *   bun scripts/loadtest.ts --uri ws://127.0.0.1:3100 --db lawload --clients 100 --procs 4 --seconds 60
 *
 * Refuses non-local servers: never point this at Maincloud.
 */
import { spawn } from 'node:child_process';
import { chestPoint } from '../shared/hitbox';
import { loadMap } from '../shared/maps/index';
import { dirFromAngles, normalize3 } from '../shared/math';
import { createMoveState, eyeHeight, stepMovement, type MoveState } from '../shared/movement';
import { WEAPONS } from '../shared/weapons';
import { readWorld, type WorldView } from './loadtest-view';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const uri = args.get('uri') ?? 'ws://127.0.0.1:3100';
const db = args.get('db') ?? 'lawload';
const clients = Number(args.get('clients') ?? 100);
const procs = Number(args.get('procs') ?? 4);
const seconds = Number(args.get('seconds') ?? 60);
/** Room size (soldiers per team): clients Quick Play into rooms of this size. */
const size = Number(args.get('size') ?? 6);
const worker = args.get('worker');
if (!/^wss?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(uri)) throw new Error(`Refusing non-local server ${uri}`);

interface Result { clients: number; joined: number; rooms: number[]; bytes: number; messages: number; rtts: number[]; corrections: number; shots: number; kills: number; ticks: number[]; seconds: number }

if (worker === undefined) {
  // ---- Parent: fan out over processes so the test client never becomes the bottleneck ----
  const per = Math.ceil(clients / procs);
  const runs = Array.from({ length: procs }, (_, p) => new Promise<Result>((resolve, reject) => {
    const n = Math.min(per, clients - p * per);
    const child = spawn('bun', [import.meta.path, '--uri', uri, '--db', db, '--seconds', String(seconds), '--size', String(size), '--worker', String(p), '--clients', String(n)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.on('exit', code => {
      const line = out.trim().split('\n').pop() ?? '';
      try { resolve(JSON.parse(line)); } catch { reject(new Error(`worker ${p} exited ${code}: ${out.slice(-500)}`)); }
    });
  }));
  const results = await Promise.all(runs);
  const rtts = results.flatMap(r => r.rtts).sort((a, b) => a - b);
  const pct = (q: number) => rtts.length ? rtts[Math.min(rtts.length - 1, Math.floor(q * rtts.length))].toFixed(0) : '-';
  const joined = results.reduce((a, r) => a + r.joined, 0);
  const bytes = results.reduce((a, r) => a + r.bytes, 0);
  const ticks = results[0].ticks;
  const tickRate = ticks.length > 2 ? (ticks[ticks.length - 1] - ticks[1]) / (ticks.length - 2) : 0;
  console.log(JSON.stringify({
    clients, joined, size: `${size}v${size}`, rooms: new Set(results.flatMap(r => r.rooms)).size,
    serverTicksPerSecond: +tickRate.toFixed(1),
    tickRateMinMax: ticks.length > 2 ? [Math.min(...ticks.slice(2).map((t, i) => t - ticks[i + 1])), Math.max(...ticks.slice(2).map((t, i) => t - ticks[i + 1]))] : [],
    kBytesPerClientPerSecond: +(bytes / Math.max(1, joined) / seconds / 1024).toFixed(1),
    serverEgressMBps: +(bytes / seconds / 1024 / 1024).toFixed(2),
    messagesPerClientPerSecond: +(results.reduce((a, r) => a + r.messages, 0) / Math.max(1, joined) / seconds).toFixed(1),
    reportRttMs: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), n: rtts.length },
    corrections: results.reduce((a, r) => a + r.corrections, 0),
    shots: results.reduce((a, r) => a + r.shots, 0),
    kills: results.reduce((a, r) => a + r.kills, 0),
  }, null, 1));
  process.exit(0);
}

// ---- Worker: count wire bytes, then run `clients` soldiers for `seconds` ----
// Bun lacks DecompressionStream; keep gzip on (as browsers use it) so byte counts are realistic.
if (typeof DecompressionStream === 'undefined') {
  const { gunzipSync, inflateSync, inflateRawSync } = await import('node:zlib');
  (globalThis as Record<string, unknown>).DecompressionStream = class {
    readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>;
    constructor(format: string) {
      const parts: Uint8Array[] = [];
      const t = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk) { parts.push(chunk); },
        flush(controller) {
          const all = Buffer.concat(parts);
          controller.enqueue(new Uint8Array(format === 'gzip' ? gunzipSync(all) : format === 'deflate' ? inflateSync(all) : inflateRawSync(all)));
        },
      });
      this.readable = t.readable; this.writable = t.writable;
    }
  };
}
let bytes = 0, messages = 0, measuring = false;
const Native = globalThis.WebSocket;
globalThis.WebSocket = class extends Native {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    this.addEventListener('message', (e: MessageEvent) => {
      if (!measuring) return;
      messages++;
      const d = e.data as ArrayBuffer | string;
      bytes += typeof d === 'string' ? d.length : d.byteLength;
    });
  }
} as typeof WebSocket;
const { DbConnection } = await import('../src/module_bindings');
type Conn = InstanceType<typeof DbConnection>;

const rtts: number[] = [];
let shots = 0, kills = 0, corrections = 0;
const ticks: number[] = [];
const rooms = new Set<number>();

class Client {
  conn!: Conn;
  me = -1;
  m: MoveState = createMoveState(0, 0, 0);
  yaw = 0; pitch = 0;
  alive = false;
  seenCorrections = -1;
  goal = 0; goalLeft = 0;
  ammo = 0; reloadUntil = 0; nextShot = 0;
  inFlight = 0;
  constructor(readonly index: number) {}

  connect() {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('join timeout')), 60_000);
      DbConnection.builder().withUri(uri).withDatabaseName(db)
        .onConnect((conn) => {
          this.conn = conn;
          conn.subscriptionBuilder().onApplied(async () => {
            await conn.reducers.quickJoin({ name: `Load${worker}-${this.index}`, team: -1, size });
            const wait = () => {
              const mine = conn.db.player.identity.find(conn.identity!);
              if (!mine) { setTimeout(wait, 100); return; }
              conn.subscriptionBuilder().onApplied(() => { this.me = mine.soldierId; rooms.add(mine.room); clearTimeout(timer); resolve(); }).subscribe(readWorld.roomQueries(mine.room));
            };
            wait();
          }).subscribe(readWorld.queries(conn));
        })
        .onConnectError((_c, e) => { clearTimeout(timer); reject(e); })
        .build();
    });
  }

  step(dt: number, now: number) {
    const view: WorldView = readWorld(this.conn, this.me);
    const self = view.soldiers.get(this.me);
    if (!self) return;
    const { def, world } = loadMap(view.mapId);
    if (self.corrections !== this.seenCorrections) {
      if (this.seenCorrections >= 0) { corrections += self.corrections - this.seenCorrections; this.m.x = self.x; this.m.y = self.y; this.m.z = self.z; this.m.vx = this.m.vy = this.m.vz = 0; }
      this.seenCorrections = self.corrections;
    }
    if (self.alive && !this.alive) {
      this.m = createMoveState(self.x, self.y, self.z); this.yaw = self.yaw;
      this.ammo = WEAPONS.mp5.magazine; this.goalLeft = 0;
      // Shop like a player: try a random gun each round (the server checks cash, base and buy time).
      const ids = Object.keys(WEAPONS).filter(id => id !== 'knife');
      void this.conn.reducers.buy({ item: ids[Math.floor(Math.random() * ids.length)] }).catch(() => undefined);
    }
    this.alive = self.alive;
    if (!self.alive) return;

    // Wander between landmarks so the fight spreads over the map like real players.
    this.goalLeft -= dt;
    if (this.goalLeft <= 0) { this.goal = Math.floor(Math.random() * def.points.length); this.goalLeft = 8 + Math.random() * 12; }
    // The room may have rotated to a map with fewer landmarks since the goal was picked.
    const p = def.points[this.goal % def.points.length];
    const want = Math.atan2(-(p.x - this.m.x), -(p.z - this.m.z)) + Math.sin(now / 900 + this.index) * 0.6;
    this.yaw = want;
    const near = Math.hypot(p.x - this.m.x, p.z - this.m.z) < p.radius;
    const input = { forward: near ? 0.3 : 1, strafe: Math.sin(now / 700 + this.index * 3) * 0.6, yaw: this.yaw, jump: Math.random() < 0.01, crouch: false, sprint: !near && Math.random() < 0.9, ads: false };
    const sub = 3;
    for (let i = 0; i < sub; i++) stepMovement(world, this.m, input, dt / sub, self.team);

    if (this.inFlight < 3) {
      this.inFlight++;
      const sent = performance.now();
      void this.conn.reducers.report({
        x: this.m.x, y: this.m.y, z: this.m.z, vx: this.m.vx, vy: this.m.vy, vz: this.m.vz, yaw: this.yaw, pitch: this.pitch,
        crouch: this.m.crouch, grounded: this.m.grounded, sprint: input.sprint, ads: false, slide: this.m.slideTime > 0, weapon: 0, use: false,
      }).then(() => { if (measuring) rtts.push(performance.now() - sent); }).catch(() => undefined).finally(() => { this.inFlight--; });
    }

    // Shoot the nearest visible enemy (the server re-checks range, line of sight and hit volume).
    if (now < this.nextShot || now < this.reloadUntil) return;
    if (this.ammo <= 0) { void this.conn.reducers.reloadWeapon({}).catch(() => undefined); this.reloadUntil = now + 2300; this.ammo = WEAPONS.mp5.magazine; return; }
    const eye = { x: this.m.x, y: this.m.y + eyeHeight(this.m), z: this.m.z };
    let best: { id: number; chest: { x: number; y: number; z: number } } | undefined, bestD = 45;
    for (const s of view.soldiers.values()) {
      if (!s.alive || s.team === self.team) continue;
      const d = Math.hypot(s.x - eye.x, s.z - eye.z);
      if (d >= bestD) continue;
      const chest = chestPoint({ x: s.x, y: s.y, z: s.z }, s.crouch);
      if (!world.lineOfSight(eye, chest, self.team)) continue;
      best = { id: s.id, chest }; bestD = d;
    }
    if (!best) return;
    const dir = normalize3({ x: best.chest.x - eye.x, y: best.chest.y - eye.y, z: best.chest.z - eye.z });
    this.pitch = Math.asin(dir.y); void dirFromAngles;
    this.ammo--; shots++;
    this.nextShot = now + WEAPONS.mp5.interval * 1000 * 1.05;
    void this.conn.reducers.fire({ weapon: 0, ox: eye.x, oy: eye.y, oz: eye.z, dx: dir.x, dy: dir.y, dz: dir.z, target: best.id, zone: 'body', px: best.chest.x, py: best.chest.y, pz: best.chest.z }).catch(() => undefined);
  }
}

const all = Array.from({ length: clients }, (_, i) => new Client(i));
let joined = 0;
// Join gradually, like players arriving.
await Promise.all(all.map((c, i) => new Promise<void>(r => setTimeout(r, i * 120)).then(() => c.connect()).then(() => { joined++; }).catch(e => console.error(`client ${i}: ${e?.message ?? e}`))));
const live = all.filter(c => c.me >= 0);
const killWatch = new Set<number>();
let last = performance.now();
const loop = setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  for (const c of live) c.step(dt, now);
}, 50);
// Warm up for 5 s, then measure.
await new Promise(r => setTimeout(r, 5000));
measuring = true;
const start = performance.now();
const sampler = setInterval(() => {
  if (!live[0]) return;
  const v = readWorld(live[0].conn, live[0].me);
  ticks.push(v.tick);
  for (const s of v.soldiers.values()) if (!s.alive) killWatch.add(s.id * 100000 + Math.floor(performance.now() / 4000));
}, 1000);
await new Promise(r => setTimeout(r, seconds * 1000));
measuring = false;
clearInterval(loop); clearInterval(sampler);
if (live[0]) kills = readWorld(live[0].conn, live[0].me).totalKills;
const result: Result = { clients, joined, rooms: [...rooms], bytes, messages, rtts, corrections, shots, kills, ticks, seconds: (performance.now() - start) / 1000 };
for (const c of live) { try { c.conn.disconnect(); } catch { /* closing */ } }
console.log(JSON.stringify(result));
process.exit(0);
