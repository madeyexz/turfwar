/**
 * 飛拖 check against a LOCAL server, each player its own identity (owner `spacetime sql` places them):
 * - A opens a private 1v1 room without bots and B joins with its code; once the round is live they
 *   stand 4 m apart on open ground.
 * - A throws without a wind-up: B takes 30 and lives; A's empty hand rides in gearJson and a second
 *   throw does nothing; B's frame shows the `slipper` body.
 * - A walks onto the slipper (placed there) and picks it up; a full wind-up then kills B as a knife kill.
 *
 *   bun scripts/slippercheck.ts ws://127.0.0.1:3000 turfwar
 */
import { spawnSync } from 'node:child_process';
import { loadMap } from '../shared/maps/index';
import { decodeFrame } from '../shared/match/frame';
import { sql } from './stdb-sql';
import { checker, connect, localOnly, wait, type Conn } from './stdb-local';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3000';
const db = process.argv[3] ?? 'turfwar';
const server = localOnly(uri);
const { check, note, finish } = checker();
const MAP = 'ochre';
const SUBS = ['SELECT * FROM player', 'SELECT * FROM roster', 'SELECT * FROM frame', 'SELECT * FROM match_event'];
const exec = (q: string) => { const r = spawnSync('spacetime', ['sql', db, q, '--server', server], { encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); };

const a = (await connect(uri, db, SUBS)).conn, b = (await connect(uri, db, SUBS)).conn;
const events: { type: string; [k: string]: unknown }[] = [];
b.db.matchEvent.onInsert((_c, row) => { try { events.push(JSON.parse(row.json)); } catch { /* not ours */ } });
const roomOf = async (c: Conn) => { for (let i = 0; i < 100; i++) { const p = c.db.player.identity.find(c.identity!); if (p) return p.room; await wait(50); } throw new Error('never joined'); };
await a.reducers.createRoom({ name: 'SlipA', size: 1, mode: 'elimination', mapId: MAP, bots: false, team: 0 });
const room = await roomOf(a);
const code = String(sql(server, db, `SELECT * FROM room_code WHERE room = ${room}`)[0].code);
await b.reducers.joinRoom({ name: 'SlipB', code, team: 1 });
check('same room', await roomOf(b) === room);
const soldier = (name: string) => sql(server, db, `SELECT * FROM soldier WHERE name = '${name}'`)[0] as { id: number; x: number; y: number; z: number; health: number; alive: boolean; gear_json: string };
const roundPhase = () => { const r = sql(server, db, `SELECT * FROM clock WHERE id = ${room}`)[0]; return r ? JSON.parse(String(r.round_json)).roundPhase : ''; };
for (let i = 0; i < 400 && !(sql(server, db, `SELECT * FROM match WHERE id = ${room}`)[0].phase === 'live' && roundPhase() === 'live'); i++) await wait(100);
check('round live', roundPhase() === 'live');

const { world } = loadMap(MAP);
const sa = soldier('SlipA'), sb = soldier('SlipB');
const place = (id: number, x: number, z: number) => { const y = world.groundHeight(x, z, 50, 0.3); exec(`UPDATE soldier SET x = ${x}, y = ${y}, z = ${z}, vx = 0, vy = 0, vz = 0 WHERE id = ${id}`); return y; };
const ax = sa.x, az = sa.z;
const ay = place(sa.id, ax, az), by = place(sb.id, ax + 4, az);
const throwAt = (power: number) => {
  const o = { x: ax, y: ay + 1.6, z: az }, t = { x: ax + 4, y: by + 1.2, z: az };
  const d = { x: t.x - o.x, y: t.y - o.y, z: t.z - o.z }, l = Math.hypot(d.x, d.y, d.z);
  return a.reducers.slipper({ ox: o.x, oy: o.y, oz: o.z, dx: d.x / l, dy: d.y / l, dz: d.z / l, power });
};
note('placed', { a: [ax, ay, az], b: [ax + 4, by, az] });

// No wind-up: 30 damage, and B sees the slipper in the frame.
await throwAt(0);
let sawBody = false;
for (let i = 0; i < 20; i++) {
  const f = b.db.frame.id.find(room);
  if (f && decodeFrame(f.data)?.bodies.some(x => x.kind === 'slipper')) sawBody = true;
  await wait(50);
}
check('B sees the slipper in its frame', sawBody);
check('no wind-up does 30', Math.round(soldier('SlipB').health) === 70, soldier('SlipB').health);
check('hit event', events.some(e => e.type === 'slipper' && e.action === 'hit' && e.id === sb.id));
check('A empty-handed (gearJson)', JSON.parse(soldier('SlipA').gear_json).slippers === 0);
await throwAt(1); await wait(600);
check('no second throw while empty-handed', Math.round(soldier('SlipB').health) === 70, soldier('SlipB').health);

// Walk onto it: picked up.
const body = sql(server, db, `SELECT * FROM body`).find(r => r.kind === 'slipper') as { x: number; z: number } | undefined;
check('slipper lies on the floor', !!body);
if (body) { place(sa.id, body.x - 0.4, body.z); await wait(500); }
check('picked up', JSON.parse(soldier('SlipA').gear_json).slippers === undefined && !sql(server, db, 'SELECT * FROM body').some(r => r.kind === 'slipper'));
check('pickup event', events.some(e => e.type === 'slipper' && e.action === 'pickup' && e.id === sa.id));

// Full wind-up: a kill, credited as the knife.
place(sa.id, ax, az); await wait(200);
await throwAt(1); await wait(800);
check('full wind-up kills', soldier('SlipB').alive === false);
check('kill event is a knife kill', events.some(e => e.type === 'kill' && e.killer === sa.id && e.victim === sb.id && e.weapon === 'knife'), events.filter(e => e.type === 'kill'));
await a.reducers.leave({}).catch(() => undefined); await b.reducers.leave({}).catch(() => undefined);
finish();
