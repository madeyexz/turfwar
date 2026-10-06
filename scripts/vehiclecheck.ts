/**
 * Online vehicle check against a LOCAL server: two identities share a private Taipei room
 * (Elimination, no bots). The SWAT player walks to the nearest car, gets in, drives it along Civic
 * Blvd and down Zhonghua Rd to the helicopter pad (where a shot from the driver's seat must be
 * refused), gets out, boards the helicopter, waits for the rotor, climbs, flies and lands, then
 * walks to a scooter and rides it with handbrake drifts both ways while firing its SMG sideways
 * (aim independent of the heading), all in real time with the shared controllers and 20 Hz
 * reports. The server must accept every report (0 corrections) and every rider shot (from the
 * rider's claimed muzzle, ammo spent) while the other client sees the vehicles move, the shots and
 * the rider's aim in the frame. Finally one teleporting report must be rejected (1 correction).
 *
 *   bun scripts/vehiclecheck.ts ws://127.0.0.1:3400 <db>
 */
import { loadMap, loadNav } from '../shared/maps/index';
import { decodeFrame, type DecodedFrame } from '../shared/match/frame';
import { findPath, nearestNode } from '../shared/match/nav';
import { wrapAngle } from '../shared/math';
import { createMoveState, stepMovement, type MoveState } from '../shared/movement';
import { eyeHeight } from '../shared/movement';
import { VEHICLES, exitSpot, forwardOf, idleVehicleInput, seatPosition, slipAngle, speedOf, stepVehicle, type Vehicle, type VehicleInput } from '../shared/vehicles';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3400';
const db = process.argv[3] ?? 'vehiclecheck';
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
          code.value ||= conn.db.match.id.find(mine.room)!.code;
          conn.subscriptionBuilder().onApplied(() => resolve(conn))
            .subscribe([`SELECT * FROM roster WHERE room = ${mine.room}`, `SELECT * FROM frame WHERE id = ${mine.room}`]);
        };
        ready();
      }).subscribe(['SELECT * FROM match', 'SELECT * FROM player']);
    })
    .onConnectError((_c, e) => reject(e)).build();
});

const a = await connect('Driver', 0);
const b = await connect('Watcher', 1);
const me = () => a.db.player.identity.find(a.identity!)!;
const frameOf = (c: Conn): DecodedFrame | undefined => {
  const p = c.db.player.identity.find(c.identity!);
  const f = p ? c.db.frame.id.find(p.room) : undefined;
  return f ? decodeFrame(f.data) : undefined;
};
const pose = () => frameOf(a)?.poses.find(p => p.id === me().soldierId);
const corrections = () => a.db.roster.id.find(me().soldierId)?.corrections ?? -1;

// The watcher records every vehicle pose it sees in the frame, and every shot.
const seen = new Map<number, { x: number; y: number; z: number }[]>();
const shotsSeen: DecodedFrame['shots'] = [];
b.db.frame.onUpdate((_c, _old, row) => { for (const s of decodeFrame(row.data)?.shots ?? []) shotsSeen.push(s); });
const watch = setInterval(() => {
  for (const v of frameOf(b)?.vehicles ?? []) {
    const list = seen.get(v.id) ?? [];
    const last = list[list.length - 1];
    if (!last || Math.hypot(last.x - v.x, last.y - v.y, last.z - v.z) > 0.01) list.push({ x: v.x, y: v.y, z: v.z });
    seen.set(v.id, list);
  }
}, 30);
// The watcher stands still but keeps reporting, or the server drops it as idle after 45 s.
const keepalive = setInterval(() => {
  const p = frameOf(b)?.poses.find(x => x.id === b.db.player.identity.find(b.identity!)?.soldierId);
  if (p?.alive) void b.reducers.report({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, yaw: p.yaw, pitch: 0, crouch: 0, grounded: true, sprint: false, ads: false, slide: false, weapon: 0, use: false }).catch(() => undefined);
}, 1000);

for (let i = 0; i < 400; i++) {
  const f = frameOf(a);
  if (f?.roundPhase === 'live' && pose()?.alive) break;
  await wait(100);
}
const { world, def } = loadMap('taipei'), nav = loadNav('taipei');
const start = pose()!;
const spots = def.vehicles!;
const vehicleNow = (i: number) => frameOf(a)!.vehicles[i];
const carIndex = spots.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'car')
  .sort((p, q) => Math.hypot(p.s.x - start.x, p.s.z - start.z) - Math.hypot(q.s.x - start.x, q.s.z - start.z))[0].i;
const heliIndex = spots.findIndex(s => s.kind === 'heli');
const before = corrections();
let reports = 0, firstBad: unknown, seenCorrections = before;
const STEP = 1 / 120;

/** Like the game client: a rejected report snaps us back to the server's pose. */
function checkCorrection(label: string, snap: () => void, client: object) {
  const c = corrections();
  if (c === seenCorrections) return;
  seenCorrections = c;
  firstBad ??= { label, client };
  snap();
}

/** Walk with the shared controller (nav path, then straight), reporting at 20 Hz. */
async function walkTo(m: MoveState, target: { x: number; y: number; z: number }) {
  const path = findPath(nav, nearestNode(nav, m.x, m.y, m.z), nearestNode(nav, target.x, target.y, target.z));
  const points = [...path.map(n => ({ x: nav.x[n], z: nav.z[n] })), target];
  let k = 0;
  for (let t = 0; t < 60 && Math.hypot(target.x - m.x, target.z - m.z) > 0.4; t += 0.05) {
    while (k < points.length - 1 && Math.hypot(points[k].x - m.x, points[k].z - m.z) < 0.6) k++;
    const p = points[k], yaw = Math.atan2(-(p.x - m.x), -(p.z - m.z));
    const near = Math.hypot(target.x - m.x, target.z - m.z) < 1.2;
    for (let i = 0; i < 6; i++) stepMovement(world, m, { forward: near ? 0.4 : 1, strafe: 0, yaw, jump: false, crouch: false, sprint: !near, ads: false }, STEP, 0);
    await wait(50);
    await a.reducers.report({ x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, yaw, pitch: 0, crouch: m.crouch, grounded: m.grounded, sprint: !near, ads: false, slide: false, weapon: 0, use: false });
    reports++;
    checkCorrection('walk', () => { const sp = pose(); if (sp) { m.x = sp.x; m.y = sp.y; m.z = sp.z; m.vx = m.vy = m.vz = 0; } }, { x: m.x, y: m.y, z: m.z });
  }
}

async function board(index: number) {
  await a.reducers.enterVehicle({ index });
  for (let i = 0; i < 60 && vehicleNow(index).driver !== me().soldierId; i++) await wait(50);
  if (vehicleNow(index).driver !== me().soldierId) throw new Error(`Could not board vehicle ${index}: at ${JSON.stringify(pose())}, vehicle ${JSON.stringify(vehicleNow(index))}`);
  const f = vehicleNow(index);
  return { ...f, steer: 0, slack: 0, lastAttacker: -1, lastRun: 0 } as Vehicle;
}

async function leave(index: number) {
  await a.reducers.exitVehicle({});
  for (let i = 0; i < 60 && vehicleNow(index).driver === me().soldierId; i++) await wait(50);
  await wait(100);
  const p = pose()!;
  const m = createMoveState(p.x, p.y, p.z);
  return m;
}

/** Drive/fly with the shared controller, reporting at 20 Hz in real time, until `done` or `seconds`. */
async function pilot(v: Vehicle, seconds: number, control: (v: Vehicle, t: number) => Partial<VehicleInput>, done: (v: Vehicle) => boolean,
  aim: (v: Vehicle) => { yaw: number; pitch: number } = v => ({ yaw: v.yaw, pitch: 0 }), each?: (v: Vehicle, t: number) => Promise<void>) {
  let top = v.y, t = 0;
  for (; t < seconds && !done(v); t += 0.05) {
    const input = { ...idleVehicleInput(v.yaw, true), ...control(v, t) };
    for (let i = 0; i < 6; i++) stepVehicle(world, v, input, STEP);
    top = Math.max(top, v.y);
    await wait(50);
    const look = aim(v);
    await a.reducers.vehicleReport({ vehicle: v.id, x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy, vz: v.vz, yaw: v.yaw, pitch: v.pitch, roll: v.roll, aimYaw: look.yaw, aimPitch: look.pitch });
    await each?.(v, t);
    reports++;
    checkCorrection(`pilot ${v.kind}`, () => { Object.assign(v, vehicleNow(v.id)); }, { x: v.x, y: v.y, z: v.z, vy: v.vy, rotor: v.rotor });
  }
  return { top, t };
}

/** Steer toward a waypoint (positive steer turns right, i.e. decreases yaw). */
const toward = (v: Vehicle, x: number, z: number, speed: number) => {
  const want = Math.atan2(-(x - v.x), -(z - v.z)), err = wrapAngle(want - v.yaw);
  const fast = Math.hypot(v.vx, v.vz);
  return { steer: Math.max(-1, Math.min(1, -err * 2.5)), throttle: fast > speed ? -0.3 : Math.abs(err) > 0.6 ? 0.25 : 1 };
};

// 1. Walk to the car's door and get in.
const m = createMoveState(start.x, start.y, start.z);
const car0 = vehicleNow(carIndex);
await walkTo(m, exitSpot(world, { ...car0 }, 0));
let car = await board(carIndex);
const carStart = { x: car.x, z: car.z };
// 2. Drive east along Civic Blvd's south carriageway, then south down Zhonghua Rd toward the pad.
const OX = -781.5, OZ = -183;
const route = [{ x: -760 - OX, z: -289 - OZ }, { x: -706 - OX, z: -289 - OZ }, { x: -692 - OX, z: -272 - OZ }, { x: -692 - OX, z: -244 - OZ }];
let leg = 0;
// Into the corner onto Zhonghua Rd the driver holds the handbrake: a drift round the bend.
let carSlip = 0, carDriftSteps = 0;
const drive = await pilot(car, 40, v => {
  while (leg < route.length - 1 && Math.hypot(route[leg].x - v.x, route[leg].z - v.z) < 6) leg++;
  const r = route[leg], last = leg === route.length - 1, d = Math.hypot(r.x - v.x, r.z - v.z);
  if (last && d < 9) return { throttle: -1 };
  const c = toward(v, r.x, r.z, last ? 9 : leg >= 1 ? 14 : 20);
  const brake = leg === 2 && Math.abs(c.steer) > 0.5 && speedOf(v) > 8;
  if (brake) carDriftSteps++;
  return { ...c, brake };
}, v => leg === route.length - 1 && Math.hypot(route[leg].x - v.x, route[leg].z - v.z) < 9 && Math.hypot(v.vx, v.vz) < 0.3,
undefined, async v => { if (speedOf(v) > 5) carSlip = Math.max(carSlip, Math.abs(slipAngle(v))); });
await wait(300);
const carEnd = vehicleNow(carIndex);
// A car's driver cannot shoot: the server refuses the shot (no ammo spent, nothing in the frame).
const myPose = () => frameOf(a)!.poses.find(p => p.id === me().soldierId)!;
const fireFrom = (o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, weapon: number) =>
  a.reducers.fire({ weapon, ox: o.x, oy: o.y, oz: o.z, dx: d.x, dy: d.y, dz: d.z, target: -1, zone: '', px: o.x + d.x * 40, py: o.y + d.y * 40, pz: o.z + d.z * 40 });
const carAmmo = myPose().ammo;
const carSeat = seatPosition(carEnd, 0);
await fireFrom({ ...carSeat, y: carSeat.y + 1.2 }, { ...forwardOf(carEnd.yaw), y: 0 }, myPose().weapon);
await wait(400);
const carShot = { ammoBefore: carAmmo, ammoAfter: myPose().ammo, shotsSeen: shotsSeen.filter(s => s.shooter === me().soldierId).length };
const carDistance = Math.hypot(carEnd.x - carStart.x, carEnd.z - carStart.z);
// 3. Out of the car, over to the helicopter, in.
const walker = await leave(carIndex);
const heli0 = vehicleNow(heliIndex);
await walkTo(walker, exitSpot(world, { ...heli0 }, 0));
const heli = await board(heliIndex);
const ground = heli.y;
// 4. Spin up, climb to ~30 m, fly north 60 m (back over the car, toward Civic Blvd), hover, turn and
// fly back to the pad, descend and land.
const pad = { x: heli.x, z: heli.z };
const climb = await pilot(heli, 8, () => ({ lift: 1 }), v => v.y > ground + 30);
const north = heli.z - 60;
await pilot(heli, 10, v => ({ throttle: v.z > north + 12 ? 1 : 0.2, yaw: 0 }), v => v.z < north);
await pilot(heli, 2, () => ({}), () => false);
await pilot(heli, 16, v => {
  const want = Math.atan2(-(pad.x - v.x), -(pad.z - v.z)), d = Math.hypot(pad.x - v.x, pad.z - v.z);
  return { yaw: want, throttle: Math.abs(wrapAngle(want - v.yaw)) > 0.4 ? 0 : d > 15 ? 1 : 0.15 };
}, v => Math.hypot(pad.x - v.x, pad.z - v.z) < 3);
await pilot(heli, 1.5, () => ({}), () => false);
const landed = await pilot(heli, 20, () => ({ lift: -1 }), v => v.grounded && Math.abs(v.vy) < 0.01);
await wait(400);
const heliEnd = vehicleNow(heliIndex);
// 5. Out of the helicopter, onto the scooter with the most open road ahead.
const rider = await leave(heliIndex);
const openRoad = (i: number) => { const s = spots[i], f = forwardOf(s.yaw); return world.raycast({ x: s.x, y: s.y + 0.7, z: s.z }, { x: f.x, y: 0, z: f.z }, 200)?.t ?? 200; };
const scooterIndex = spots.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'scooter')
  .sort((p, q) => Math.hypot(p.s.x - rider.x, p.s.z - rider.z) / 4 - openRoad(p.i) - (Math.hypot(q.s.x - rider.x, q.s.z - rider.z) / 4 - openRoad(q.i)))[0].i;
await walkTo(rider, exitSpot(world, { ...vehicleNow(scooterIndex) }, 0));
const scooter = await board(scooterIndex);
await wait(1200); // the sidearm/SMG comes up
// 6. Ride: up to speed, a handbrake drift right, counter-steer, a drift left, straighten; the rider
// fires the weapon in hand to the bike's left every 0.25 s, aiming independently of the heading.
const ammoBefore = myPose().ammo, slot = myPose().weapon, weaponId = myPose().weaponId;
const aimLeft = (v: Vehicle) => ({ yaw: v.yaw + Math.PI / 2, pitch: 0.02 });
const sent: { x: number; y: number; z: number }[] = [];
let peakSlip = 0, topSpeed = 0, aimSeen = 0, nextShot = 1.2;
const ride = await pilot(scooter, 6, (v, t) =>
  t < 1.6 ? { throttle: 1 } : t < 2.4 ? { throttle: 1, steer: 1, brake: true } : t < 2.9 ? { throttle: 1, steer: -1 } : t < 3.7 ? { throttle: 0.8, steer: -1, brake: true } : t < 4.2 ? { throttle: 0.8, steer: 1 } : { throttle: -1 },
() => false, aimLeft, async (v, t) => {
  if (speedOf(v) > 5) peakSlip = Math.max(peakSlip, Math.abs(slipAngle(v))); topSpeed = Math.max(topSpeed, speedOf(v));
  // The watcher sees the rider turned to the aim, not to the bike's heading.
  const p = frameOf(b)?.poses.find(x => x.id === me().soldierId);
  if (p && Math.abs(wrapAngle(p.yaw - aimLeft(v).yaw)) < 0.05 && Math.abs(wrapAngle(p.yaw - v.yaw)) > 1) aimSeen++;
  if (t >= nextShot && sent.length < 12) {
    nextShot = t + 0.25;
    const seat = seatPosition(v, 0), look = aimLeft(v);
    const eye = { x: seat.x, y: seat.y + eyeHeight({ crouch: VEHICLES.scooter.sit }), z: seat.z };
    const d = { x: -Math.sin(look.yaw) * Math.cos(look.pitch), y: Math.sin(look.pitch), z: -Math.cos(look.yaw) * Math.cos(look.pitch) };
    sent.push(eye);
    await fireFrom(eye, d, slot);
  }
});
await wait(500);
const mine = shotsSeen.filter(s => s.shooter === me().soldierId);
// Each accepted shot leaves from the muzzle the rider claimed (within the frame's 2 cm quantization).
const fromClaim = mine.filter(s => sent.some(o => Math.hypot(o.x - s.from.x, o.y - s.from.y, o.z - s.from.z) < 0.1)).length;
const riderShots = { weapon: weaponId, sent: sent.length, seenByWatcher: mine.length, fromClaimedMuzzle: fromClaim, ammoBefore, ammoAfter: myPose().ammo, aimSeen };
const accepted = corrections() - before;
// 7. A teleport must be corrected.
await a.reducers.vehicleReport({ vehicle: scooter.id, x: scooter.x + 60, y: scooter.y, z: scooter.z, vx: 0, vy: 0, vz: 0, yaw: scooter.yaw, pitch: 0, roll: 0, aimYaw: scooter.yaw, aimPitch: 0 });
await wait(400);
const afterTeleport = corrections() - before;
const scooterAfter = vehicleNow(scooterIndex);
clearInterval(watch); clearInterval(keepalive);
const track = (i: number) => {
  const l = seen.get(i) ?? [];
  let path = 0, top = -Infinity;
  for (let k = 1; k < l.length; k++) path += Math.hypot(l[k].x - l[k - 1].x, l[k].y - l[k - 1].y, l[k].z - l[k - 1].z);
  for (const p of l) top = Math.max(top, p.y);
  if (process.env.TRACE) console.log(i, l.filter((_, k) => k % 8 === 0).map(p => `${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}`).join(" "));
  return { samples: l.length, path: +path.toFixed(1), topY: +top.toFixed(1) };
};
console.log(JSON.stringify({
  map: def.name, room: code.value, reports,
  car: { index: carIndex, driven: +carDistance.toFixed(1), seconds: +drive.t.toFixed(1), end: { x: +carEnd.x.toFixed(1), z: +carEnd.z.toFixed(1) }, handbrakeReports: carDriftSteps, peakSlipDeg: +(carSlip * 180 / Math.PI).toFixed(1) },
  carDriverShot: carShot,
  heli: { index: heliIndex, groundY: +ground.toFixed(2), climbTop: +climb.top.toFixed(1), landedY: +heliEnd.y.toFixed(2), landSeconds: +landed.t.toFixed(1), grounded: heliEnd.grounded },
  scooter: { index: scooterIndex, seconds: +ride.t.toFixed(1), peakSlipDeg: +(peakSlip * 180 / Math.PI).toFixed(1), topSpeed: +topSpeed.toFixed(1), maxSpeed: VEHICLES.scooter.maxSpeed, riderShots },
  watcherSaw: { car: track(carIndex), heli: track(heliIndex), scooter: track(scooterIndex) },
  corrections: accepted, firstBad,
  teleport: { corrections: afterTeleport - accepted, serverStayed: Math.abs(scooterAfter.x - scooter.x) < 1 },
}, null, 1));
a.disconnect(); b.disconnect();
process.exit(0);
