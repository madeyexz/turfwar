/**
 * Online ladder check against a LOCAL server: two identities share a private Tower room (Elimination,
 * no bots); the SWAT player walks from the base to the tower ladder with the shared movement
 * controller, reporting at 20 Hz in real time, climbs to the crow's nest and the server must accept
 * every report (0 corrections).
 *
 *   bun scripts/laddercheck.ts ws://127.0.0.1:3300 <db>
 */
import { loadMap, loadNav } from '../shared/maps/index';
import { LADDER_DIRS } from '../shared/collision';
import { decodeFrame } from '../shared/match/frame';
import { findPath, nearestNode } from '../shared/match/nav';
import { createMoveState, stepMovement } from '../shared/movement';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3300';
const db = process.argv[3] ?? 'mapcheck';
if (!/^wss?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(uri)) throw new Error(`Refusing non-local server ${uri}`);
if (typeof DecompressionStream === 'undefined') {
  const { gunzipSync } = await import('node:zlib');
  (globalThis as Record<string, unknown>).DecompressionStream = class {
    readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>;
    constructor() {
      const parts: Uint8Array[] = [];
      const t = new TransformStream<Uint8Array, Uint8Array>({ transform(c) { parts.push(c); }, flush(c) { c.enqueue(new Uint8Array(gunzipSync(Buffer.concat(parts)))); } });
      this.readable = t.readable; this.writable = t.writable;
    }
  };
}
const { DbConnection } = await import('../src/module_bindings');
type Conn = InstanceType<typeof DbConnection>;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const code = { value: '' };
const connect = (name: string, team: number) => new Promise<Conn>((resolve, reject) => {
  DbConnection.builder().withUri(uri).withDatabaseName(db)
    .onConnect(conn => {
      conn.subscriptionBuilder().onApplied(async () => {
        await (code.value ? conn.reducers.joinRoom({ name, team, code: code.value })
          : conn.reducers.createRoom({ name, team, size: 6, mode: 'elimination', mapId: 'tower', bots: false }));
        const ready = () => {
          const mine = conn.db.player.identity.find(conn.identity!);
          if (!mine) { setTimeout(ready, 50); return; }
          // The server keeps codes off the public rows: our own room's comes from `my_room_code`.
          code.value ||= conn.db.match.id.find(mine.room)!.code || [...conn.db.myRoomCode.iter()].find(r => r.room === mine.room)?.code || '';
          conn.subscriptionBuilder().onApplied(() => resolve(conn))
            .subscribe([`SELECT * FROM roster WHERE room = ${mine.room}`, `SELECT * FROM frame WHERE id = ${mine.room}`]);
        };
        ready();
      }).subscribe(['SELECT * FROM match', 'SELECT * FROM player', 'SELECT * FROM my_room_code']);
    })
    .onConnectError((_c, e) => reject(e)).build();
});

const a = await connect('LadderSWAT', 0);
const b = await connect('Watcher', 1);
const me = () => a.db.player.identity.find(a.identity!)!;
const pose = () => {
  const f = a.db.frame.id.find(me().room);
  return f ? decodeFrame(f.data)?.poses.find(p => p.id === me().soldierId) : undefined;
};
const corrections = () => a.db.roster.id.find(me().soldierId)?.corrections ?? -1;

// Wait for the round to go live (warm-up, then the freeze) with our soldier deployed.
for (let i = 0; i < 400; i++) {
  const f = a.db.frame.id.find(me().room), d = f ? decodeFrame(f.data) : undefined;
  if (d?.roundPhase === 'live' && pose()?.alive) break;
  await wait(100);
}
const start = pose()!;
const { world, def } = loadMap('tower'), nav = loadNav('tower');
const ladder = world.ladders[0];
const [nx, nz] = LADDER_DIRS[ladder.dir];
const foot = { x: ladder.x - nx * 0.7, y: ladder.y0, z: ladder.z - nz * 0.7 };
const path = findPath(nav, nearestNode(nav, start.x, start.y, start.z), nearestNode(nav, foot.x, foot.y, foot.z));
const points = [...path.map(n => ({ x: nav.x[n], z: nav.z[n] })), foot];
const m = createMoveState(start.x, start.y, start.z);
const before = corrections();
let target = 0, top = m.y, reports = 0, last = performance.now(), firstBad: unknown, seen = before;
const STEP = 1 / 120;
for (let t = 0; t < 30 && !(m.y > ladder.y1 - 0.05 && m.grounded); t += 0.05) {
  // Walk the path, then face the wall and push into the rungs.
  while (target < points.length - 1 && Math.hypot(points[target].x - m.x, points[target].z - m.z) < 0.6) target++;
  const p = points[target];
  const atLadder = target === points.length - 1 && Math.hypot(p.x - m.x, p.z - m.z) < 0.8 || m.y > ladder.y0 + 0.5;
  const yaw = atLadder ? Math.atan2(-nx, -nz) : Math.atan2(-(p.x - m.x), -(p.z - m.z));
  for (let i = 0; i < 6; i++) stepMovement(world, m, { forward: 1, strafe: 0, yaw, jump: false, crouch: false, sprint: !atLadder, ads: false }, STEP, 0);
  top = Math.max(top, m.y);
  await wait(50);
  const now = performance.now(), elapsed = (now - last) / 1000; last = now; void elapsed;
  await a.reducers.report({ x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, yaw, pitch: 0, crouch: m.crouch, grounded: m.grounded, sprint: !atLadder, ads: false, slide: false, weapon: 0, use: false });
  reports++;
  // Like the game client: a rejected report snaps us back to the server's position.
  const c = corrections();
  if (c !== seen) {
    seen = c; const sp = pose();
    firstBad ??= { t: +t.toFixed(2), client: { x: +m.x.toFixed(2), y: +m.y.toFixed(2), z: +m.z.toFixed(2), grounded: m.grounded }, server: sp && { x: +sp.x.toFixed(2), y: +sp.y.toFixed(2), z: +sp.z.toFixed(2) } };
    if (sp) { m.x = sp.x; m.y = sp.y; m.z = sp.z; m.vx = m.vy = m.vz = 0; }
  }
}
await wait(400);
const server = pose();
console.log(JSON.stringify({
  map: def.name, room: code.value, ladder: { x: ladder.x, z: ladder.z, y0: ladder.y0, y1: ladder.y1 },
  start: { x: +start.x.toFixed(1), y: +start.y.toFixed(2), z: +start.z.toFixed(1) }, pathNodes: path.length, reports,
  clientTop: +top.toFixed(2), serverY: server ? +server.y.toFixed(2) : null, corrections: corrections() - before, firstBad,
}, null, 1));
a.disconnect(); b.disconnect();
process.exit(0);
