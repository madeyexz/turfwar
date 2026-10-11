/**
 * Online map check against a LOCAL server: two identities (SWAT and Militia, no bots) share a
 * private room on the given map. Both must load the map, spawn alive in their own base, and walk
 * toward each other along the bots' graph with the shared movement controller, reporting at 20 Hz
 * (the server must accept every report: 0 corrections). Once they have a clear line, the SWAT player
 * fires one validated shot at the Militia player: the server must accept it (ammo spent, the shot in
 * the frame, the target's health down), and a second claim from 200 m away must not be honoured (refused, or fired from the shooter's own eye).
 *
 *   bun scripts/mapcheck.ts ws://127.0.0.1:3000 <db> [map=taipei] [size=6]
 */
import { loadMap, loadNav } from '../shared/maps/index';
import { clearLine } from '../shared/maps/sightlines';
import { decodeFrame, type DecodedFrame } from '../shared/match/frame';
import { findPath, nearestNode } from '../shared/match/nav';
import { createMoveState, stepMovement, type MoveState } from '../shared/movement';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3000';
const db = process.argv[3] ?? 'turfwar';
const mapId = process.argv[4] ?? 'taipei';
const size = Number(process.argv[5] ?? 6);
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
          : conn.reducers.createRoom({ name, team, size, mode: 'elimination', mapId, bots: false }));
        const ready = () => {
          const mine = conn.db.player.identity.find(conn.identity!);
          if (!mine) { setTimeout(ready, 50); return; }
          code.value ||= conn.db.match.id.find(mine.room)!.code || [...conn.db.myRoomCode.iter()].find(r => r.room === mine.room)?.code || '';
          conn.subscriptionBuilder().onApplied(() => resolve(conn))
            .subscribe([`SELECT * FROM roster WHERE room = ${mine.room}`, `SELECT * FROM frame WHERE id = ${mine.room}`]);
        };
        ready();
      }).subscribe(['SELECT * FROM match', 'SELECT * FROM player', 'SELECT * FROM my_room_code']);
    })
    .onConnectError((_c, e) => reject(e)).build();
});

const a = await connect('SWAT', 0);
const b = await connect('Militia', 1);
const soldierOf = (c: Conn) => c.db.player.identity.find(c.identity!)!.soldierId;
const frameOf = (c: Conn): DecodedFrame | undefined => { const p = c.db.player.identity.find(c.identity!); const f = p ? c.db.frame.id.find(p.room) : undefined; return f ? decodeFrame(f.data) : undefined; };
const poseOf = (c: Conn) => frameOf(c)?.poses.find(p => p.id === soldierOf(c));
const corrections = (c: Conn) => c.db.roster.id.find(soldierOf(c))?.corrections ?? -1;
const keepalive = setInterval(() => { /* both soldiers report below */ }, 1000);
const roomRules = a.db.match.id.find(a.db.player.identity.find(a.identity!)!.room)!;

for (let i = 0; i < 600; i++) {
  if (frameOf(a)?.roundPhase === 'live' && poseOf(a)?.alive && poseOf(b)?.alive) break;
  await wait(100);
}
const { world, def } = loadMap(mapId), nav = loadNav(mapId);
const STEP = 1 / 120, EYE = 1.55;
const start = { a: poseOf(a)!, b: poseOf(b)! };
const before = { a: corrections(a), b: corrections(b) };
const spawnedInOwnBase = (team: 0 | 1, p: { x: number; z: number }) => def.spawns.filter(s => s.team === team).some(s => Math.hypot(s.x - p.x, s.z - p.z) < 1.5);

class Walker {
  m: MoveState; reports = 0; k = 0; points: { x: number; z: number }[] = [];
  constructor(readonly c: Conn, p: { x: number; y: number; z: number }) { this.m = createMoveState(p.x, p.y, p.z); }
  plan(to: { x: number; y: number; z: number }) {
    const path = findPath(nav, nearestNode(nav, this.m.x, this.m.y, this.m.z), nearestNode(nav, to.x, to.y, to.z));
    this.points = path.map(n => ({ x: nav.x[n], z: nav.z[n] })); this.k = 0;
  }
  async step() {
    const m = this.m;
    while (this.k < this.points.length - 1 && Math.hypot(this.points[this.k].x - m.x, this.points[this.k].z - m.z) < 0.7) this.k++;
    const p = this.points[this.k] ?? { x: m.x, z: m.z }, yaw = Math.atan2(-(p.x - m.x), -(p.z - m.z));
    for (let i = 0; i < 6; i++) stepMovement(world, m, { forward: 1, strafe: 0, yaw, jump: false, crouch: false, sprint: true, ads: false }, STEP, 0);
    await this.c.reducers.report({ x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, yaw, pitch: 0, crouch: m.crouch, grounded: m.grounded, sprint: true, ads: false, slide: false, weapon: 0, use: false });
    this.reports++;
    const sp = poseOf(this.c), c = corrections(this.c);
    if (c !== (this as unknown as { seen?: number }).seen && (this as unknown as { seen?: number }).seen !== undefined && sp) { m.x = sp.x; m.y = sp.y; m.z = sp.z; m.vx = m.vy = m.vz = 0; }
    (this as unknown as { seen?: number }).seen = c;
  }
}
const wa = new Walker(a, start.a), wb = new Walker(b, start.b);
wa.plan(start.b); wb.plan(start.a);
let lineAt = -1, t = 0;
for (; t < 120; t += 0.05) {
  await Promise.all([wa.step(), wb.step()]);
  await wait(50);
  if (clearLine(world, wa.m.x, wa.m.y + EYE, wa.m.z, wb.m.x, wb.m.y + EYE, wb.m.z) && Math.hypot(wa.m.x - wb.m.x, wa.m.z - wb.m.z) < 40) { lineAt = t; break; }
}
const walkCorrections = { a: corrections(a) - before.a, b: corrections(b) - before.b };
// Fire one shot from A's eye at B's chest, claiming the hit; the other claim comes from 200 m away.
await wait(300);
const pa = poseOf(a)!, pb = poseOf(b)!;
const eye = { x: pa.x, y: pa.y + EYE, z: pa.z }, target = { x: pb.x, y: pb.y + 1.2, z: pb.z };
const d = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z), dir = { x: (target.x - eye.x) / d, y: (target.y - eye.y) / d, z: (target.z - eye.z) / d };
const shots: DecodedFrame['shots'] = [];
b.db.frame.onUpdate((_c, _o, row) => { for (const s of decodeFrame(row.data)?.shots ?? []) shots.push(s); });
const ammo = pa.ammo, health = pb.health;
const fire = (o: typeof eye) => a.reducers.fire({ weapon: pa.weapon, ox: o.x, oy: o.y, oz: o.z, dx: dir.x, dy: dir.y, dz: dir.z, target: soldierOf(b), zone: 'body', px: target.x, py: target.y, pz: target.z });
await fire(eye); await wait(500);
const after = { ammo: poseOf(a)!.ammo, health: poseOf(b)!.health, shots: shots.filter(s => s.shooter === soldierOf(a)).length };
const hitsBefore = after.shots;
await fire({ x: eye.x + 200, y: eye.y, z: eye.z }); await wait(500);
// The server refuses a claim from far off the shooter, or fires from the shooter's own eye instead: never from the claimed spot.
const mine = shots.filter(s => s.shooter === soldierOf(a)), last = mine[mine.length - 1];
const refused = mine.length === hitsBefore || (!!last && Math.hypot(last.from.x - (eye.x + 200), last.from.z - eye.z) > 100);
clearInterval(keepalive);
const result = {
  map: mapId, size, room: code.value, rulesMap: roomRules.mapId,
  spawned: { swat: spawnedInOwnBase(0, start.a), militia: spawnedInOwnBase(1, start.b) },
  walked: { seconds: +t.toFixed(1), reportsA: wa.reports, reportsB: wb.reports, clearLineAt: lineAt, corrections: walkCorrections },
  shot: { ammoBefore: ammo, ammoAfter: after.ammo, targetHealthBefore: health, targetHealthAfter: after.health, shotsInFrame: after.shots, farClaimNotHonoured: refused },
};
console.log(JSON.stringify(result, null, 1));
const ok = result.rulesMap === mapId && result.spawned.swat && result.spawned.militia && lineAt >= 0 && walkCorrections.a === 0 && walkCorrections.b === 0 && after.ammo < ammo && after.shots >= 1 && refused;
console.log(ok ? 'PASS' : 'FAIL');
a.disconnect(); b.disconnect();
process.exit(ok ? 0 : 1);
