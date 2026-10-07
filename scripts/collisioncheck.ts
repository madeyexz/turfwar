/**
 * Online vehicle-collision check against a LOCAL server (a companion to vehiclecheck.ts): two
 * identities share a private Taipei room (Elimination, no bots), both predicting with the shared
 * controllers against the vehicles' bodies as their frames show them, reporting at 20 Hz in real
 * time like the game client.
 *   1. The Militia pedestrian walks onto the road in front of the car nearest SWAT's base and
 *      stands there; the SWAT driver gets in and creeps forward into him: his client is pushed
 *      aside (never overlapping the car in the server's frames), with no corrections either side.
 *   2. The driver backs at full reverse into the other car parked in the same carriageway: the
 *      host shoves it (and damages it if the blow is hard enough), with no corrections.
 *   3. The pedestrian's client reports a position inside a parked vehicle: corrected (1).
 *
 *   bun scripts/collisioncheck.ts ws://127.0.0.1:3252 <db>
 */
import { loadMap, loadNav } from '../shared/maps/index';
import { decodeFrame, type DecodedFrame, type FrameVehicle } from '../shared/match/frame';
import { findPath, nearestNode } from '../shared/match/nav';
import { wrapAngle } from '../shared/math';
import { MOVE, createMoveState, stepMovement, type MoveState } from '../shared/movement';
import { deepestOverlap } from '../shared/obstacles';
import { exitSpot, forwardOf, idleVehicleInput, obstaclesOf, speedOf, stepVehicle, vehicleObstacles, type Vehicle, type VehicleInput } from '../shared/vehicles';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3252';
const db = process.argv[3] ?? 'collisioncheck';
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
          : conn.reducers.createRoom({ name, team, size: 6, mode: 'elimination', mapId: 'taipei', bots: false }));
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

const a = await connect('Driver', 0);
const b = await connect('Pedestrian', 1);
const soldierOf = (c: Conn) => c.db.player.identity.find(c.identity!)!.soldierId;
const frameOf = (c: Conn): DecodedFrame | undefined => {
  const p = c.db.player.identity.find(c.identity!);
  const f = p ? c.db.frame.id.find(p.room) : undefined;
  return f ? decodeFrame(f.data) : undefined;
};
const poseOf = (c: Conn) => frameOf(c)?.poses.find(p => p.id === soldierOf(c));
const corrections = (c: Conn) => c.db.roster.id.find(soldierOf(c))?.corrections ?? -1;
/** The vehicles as a client's latest frame shows them (what the game predicts against). */
const seen = (c: Conn): FrameVehicle[] => frameOf(c)?.vehicles ?? [];
const bodies = (c: Conn, skip = -1) => obstaclesOf(seen(c), skip);

for (let i = 0; i < 400; i++) {
  if (frameOf(a)?.roundPhase === 'live' && poseOf(a)?.alive && poseOf(b)?.alive) break;
  await wait(100);
}
const { world } = loadMap('taipei'), nav = loadNav('taipei');
const STEP = 1 / 120;
const startA = poseOf(a)!, startB = poseOf(b)!;
const counts = { a: corrections(a), b: corrections(b) };

/** A walker: the shared controller against the world and the vehicle bodies, reporting at 20 Hz. */
class Walker {
  m: MoveState; reports = 0;
  constructor(readonly c: Conn, p: { x: number; y: number; z: number }) { this.m = createMoveState(p.x, p.y, p.z); }
  async tick(yaw: number, forward: number) {
    for (let i = 0; i < 6; i++) stepMovement(world, this.m, { forward, strafe: 0, yaw, jump: false, crouch: false, sprint: forward > 0.8, ads: false }, STEP, -1, bodies(this.c));
    const m = this.m;
    await this.c.reducers.report({ x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, yaw, pitch: 0, crouch: m.crouch, grounded: m.grounded, sprint: forward > 0.8, ads: false, slide: false, weapon: 0, use: false });
    this.reports++;
  }
  async walkTo(target: { x: number; y: number; z: number }) {
    const path = findPath(nav, nearestNode(nav, this.m.x, this.m.y, this.m.z), nearestNode(nav, target.x, target.y, target.z));
    const points = [...path.map(n => ({ x: nav.x[n], z: nav.z[n] })), target];
    let k = 0;
    for (let t = 0; t < 60 && Math.hypot(target.x - this.m.x, target.z - this.m.z) > 0.4; t += 0.05) {
      while (k < points.length - 1 && Math.hypot(points[k].x - this.m.x, points[k].z - this.m.z) < 0.6) k++;
      const p = points[k], near = Math.hypot(target.x - this.m.x, target.z - this.m.z) < 1.2;
      await this.tick(Math.atan2(-(p.x - this.m.x), -(p.z - this.m.z)), near ? 0.4 : 1);
      await wait(50);
    }
  }
}

// 1. The car nearest SWAT's slots; the pedestrian stands in the road 9 m ahead of it.
const spots = loadMap('taipei').def.vehicles!;
const carIndex = spots.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'car')
  .sort((p, q) => Math.hypot(p.s.x - startA.x, p.s.z - startA.z) - Math.hypot(q.s.x - startA.x, q.s.z - startA.z))[0].i;
const car0 = seen(a)[carIndex];
const f0 = forwardOf(car0.yaw);
const standAt = { x: car0.x + f0.x * 9 + -f0.z * 0.3, y: car0.y, z: car0.z + f0.z * 9 + f0.x * 0.3 };
const pedestrian = new Walker(b, startB), driverOnFoot = new Walker(a, startA);
await Promise.all([pedestrian.walkTo(standAt), driverOnFoot.walkTo(exitSpot(world, car0, 0, MOVE.radius, MOVE.standHeight, bodies(a, carIndex)))]);
await a.reducers.enterVehicle({ index: carIndex });
for (let i = 0; i < 60 && seen(a)[carIndex].driver !== soldierOf(a); i++) await wait(50);
if (seen(a)[carIndex].driver !== soldierOf(a)) throw new Error('Could not board the car');
const car: Vehicle = { ...seen(a)[carIndex], steer: 0, slack: 0, lastAttacker: -1, lastRun: 0 };
const standing = { x: pedestrian.m.x, z: pedestrian.m.z };

/** Drive one 50 ms network tick (6 physics steps) against the other vehicles as the driver sees them, and report. */
let driverReports = 0;
async function driveTick(input: Partial<VehicleInput>) {
  const full = { ...idleVehicleInput(car.yaw, true), ...input };
  let impact = 0;
  for (let i = 0; i < 6; i++) impact = Math.max(impact, stepVehicle(world, car, full, STEP, bodies(a, car.id)).impact);
  await a.reducers.vehicleReport({ vehicle: car.id, x: car.x, y: car.y, z: car.z, vx: car.vx, vy: car.vy, vz: car.vz, yaw: car.yaw, pitch: car.pitch, roll: car.roll, aimYaw: car.yaw, aimPitch: 0 });
  driverReports++;
  // Like the game: a correction snaps the prediction to the server's pose.
  if (corrections(a) !== counts.a + (driveFix.n)) { driveFix.n = corrections(a) - counts.a; Object.assign(car, seen(a)[car.id]); }
  return impact;
}
const driveFix = { n: 0 };

// 2. Creep forward at walking pace into the pedestrian for 7 s; he stands still (his client keeps
// stepping, so the car's body pushes him aside), and the server's frames never show him inside it.
let worstOverlap = 0, overlapSamples = 0;
for (let t = 0; t < 7; t += 0.05) {
  const speed = speedOf(car);
  await Promise.all([driveTick({ throttle: speed < 3.5 ? 0.5 : 0 }), pedestrian.tick(0, 0)]);
  await wait(50);
  const fb = frameOf(b), me = fb?.poses.find(p => p.id === soldierOf(b)), v = fb?.vehicles[carIndex];
  if (me && v) {
    overlapSamples++;
    worstOverlap = Math.max(worstOverlap, deepestOverlap(vehicleObstacles(v), me, MOVE.radius, MOVE.standHeight).depth);
  }
}
const pushed = Math.hypot(pedestrian.m.x - standing.x, pedestrian.m.z - standing.z);
const passed = (() => { const v = seen(a)[carIndex]; return (v.x - standing.x) * f0.x + (v.z - standing.z) * f0.z; })();
const serverPed = poseOf(b)!;
const agree = Math.hypot(serverPed.x - pedestrian.m.x, serverPed.z - pedestrian.m.z);
const afterPush = { a: corrections(a) - counts.a, b: corrections(b) - counts.b };

// 3. Ram the other car parked in the same carriageway (straight behind us): back into it at full
// reverse, holding the lane.
const lane = forwardOf(car.yaw);
const targets = seen(a).map((v, i) => ({ v, i })).filter(({ v, i }) => {
  if (i === carIndex || v.kind === 'heli') return false;
  const dx = v.x - car.x, dz = v.z - car.z, along = dx * lane.x + dz * lane.z, across = Math.abs(dx * lane.z - dz * lane.x);
  return along < 0 && across < 1.5;
}).sort((p, q) => Math.hypot(p.v.x - car.x, p.v.z - car.z) - Math.hypot(q.v.x - car.x, q.v.z - car.z));
let ram: object = { skipped: 'no vehicle behind' };
if (targets.length) {
  const { i: target } = targets[0];
  const before = { ...seen(a)[target] };
  const heading = car.yaw;
  let hit = 0, topSpeed = 0;
  for (let t = 0; t < 25 && !hit; t += 0.05) {
    topSpeed = Math.max(topSpeed, speedOf(car));
    // Reversing steers the other way round: keep the heading.
    const impact = await driveTick({ steer: Math.max(-1, Math.min(1, wrapAngle(heading - car.yaw) * 3)), throttle: -1 });
    // Contact: our client bounced, or the host started shoving it.
    if (impact > 1 || Math.hypot(seen(a)[target].x - before.x, seen(a)[target].z - before.z) > 0.2) hit = Math.max(impact, 0.01);
    if (process.env.TRACE) { const o = seen(a)[target]; console.error("ram", t.toFixed(2), "me", car.x.toFixed(2), speedOf(car).toFixed(1), "it", o.x.toFixed(2), Math.hypot(o.vx, o.vz).toFixed(1), impact.toFixed(1)); }
    await wait(50);
  }
  // Brake to a stop (W brakes a reversing car), then let the struck vehicle roll out.
  for (let t = 0; t < 3; t += 0.05) {
    const f = forwardOf(car.yaw), along = car.vx * f.x + car.vz * f.z;
    await Promise.all([driveTick({ throttle: speedOf(car) > 0.3 ? -Math.sign(along) : 0 }), pedestrian.tick(0, 0)]);
    await wait(50);
  }
  const after = seen(a)[target];
  ram = { target, kind: before.kind, topSpeed: +topSpeed.toFixed(1), impact: +hit.toFixed(1), shoved: +Math.hypot(after.x - before.x, after.z - before.z).toFixed(2), health: [before.health, after.health] };
}
const afterRam = { a: corrections(a) - counts.a, b: corrections(b) - counts.b };

// 4. A cheat: the pedestrian reports a spot inside a parked vehicle's body (1 correction).
const parked = seen(b).map((v, i) => ({ v, i })).filter(({ v, i }) => i !== carIndex && v.driver < 0 && v.kind === 'car')
  .sort((p, q) => Math.hypot(p.v.x - pedestrian.m.x, p.v.z - pedestrian.m.z) - Math.hypot(q.v.x - pedestrian.m.x, q.v.z - pedestrian.m.z))[0]?.v;
let cheat: object = { skipped: true };
if (parked) {
  // Walk up to its side first (allowed), then one report into its middle.
  const f = forwardOf(parked.yaw), side = { x: parked.x + f.z * 1.6, y: parked.y, z: parked.z - f.x * 1.6 };
  await pedestrian.walkTo(side);
  const before = corrections(b);
  await b.reducers.report({ x: parked.x, y: parked.y, z: parked.z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, crouch: 0, grounded: true, sprint: false, ads: false, slide: false, weapon: 0, use: false });
  await wait(400);
  const p = poseOf(b)!;
  cheat = { corrections: corrections(b) - before, serverKeptHimOut: deepestOverlap(vehicleObstacles(parked), p, MOVE.radius, MOVE.standHeight).depth < 0.05 };
}

console.log(JSON.stringify({
  map: 'taipei', room: code.value, car: carIndex,
  push: { stoodAt: standing, pushedAside: +pushed.toFixed(2), carPassedHim: +passed.toFixed(1), worstServerOverlap: +worstOverlap.toFixed(3), overlapSamples, serverVsClient: +agree.toFixed(3) },
  correctionsAfterPush: afterPush, ram, correctionsAfterRam: afterRam,
  reports: { driver: driverReports, pedestrian: pedestrian.reports, driverOnFoot: driverOnFoot.reports },
  cheat,
}, null, 1));
a.disconnect(); b.disconnect();
process.exit(0);
