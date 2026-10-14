/**
 * 燃燒彈 check against a LOCAL server, each player its own identity (owner `spacetime sql` places them):
 * - A opens a private 1v1 room without bots and B joins with its code; once the round is live they
 *   stand 4 m apart.
 * - Throwing without one does nothing; A buys one ($400, carried in gearJson) and throws it at B's feet.
 * - B's frame shows the bottle, then the fire; B hears it break (a `molotov` burst event) and burns
 *   (burn damage events, health falling) until it steps out; A's molotov is gone and a second throw does nothing.
 *
 *   bun scripts/molotovcheck.ts ws://127.0.0.1:3000 turfwar
 */
import { spawnSync } from 'node:child_process';
import { loadMap } from '../shared/maps/index';
import { decodeFrame } from '../shared/match/frame';
import { MOLOTOV } from '../shared/weapons';
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
await a.reducers.createRoom({ name: 'MolA', size: 1, mode: 'elimination', mapId: MAP, bots: false, team: 0 });
const room = await roomOf(a);
const code = String(sql(server, db, `SELECT * FROM room_code WHERE room = ${room}`)[0].code);
await b.reducers.joinRoom({ name: 'MolB', code, team: 1 });
check('same room', await roomOf(b) === room);
const soldier = (name: string) => sql(server, db, `SELECT * FROM soldier WHERE name = '${name}'`)[0] as { id: number; x: number; y: number; z: number; health: number; alive: boolean; money: number; gear_json: string };
const roundPhase = () => { const r = sql(server, db, `SELECT * FROM clock WHERE id = ${room}`)[0]; return r ? JSON.parse(String(r.round_json)).roundPhase : ''; };
for (let i = 0; i < 400 && !(sql(server, db, `SELECT * FROM match WHERE id = ${room}`)[0].phase === 'live' && roundPhase() === 'live'); i++) await wait(100);
check('round live', roundPhase() === 'live');

const { world } = loadMap(MAP);
const sa = soldier('MolA'), sb = soldier('MolB');
const place = (id: number, x: number, z: number) => { const y = world.groundHeight(x, z, 50, 0.3); exec(`UPDATE soldier SET x = ${x}, y = ${y}, z = ${z}, vx = 0, vy = 0, vz = 0 WHERE id = ${id}`); return y; };
const ax = sa.x, az = sa.z;
const ay = place(sa.id, ax, az), by = place(sb.id, ax + 4, az);
const throwAtFeet = () => {
  const o = { x: ax, y: ay + 1.6, z: az }, d = { x: 4, y: by - o.y, z: 0 }, l = Math.hypot(d.x, d.y, d.z);
  return a.reducers.molotov({ ox: o.x, oy: o.y, oz: o.z, dx: d.x / l, dy: d.y / l, dz: d.z / l });
};
const molotovs = () => JSON.parse(soldier('MolA').gear_json).molotovs ?? 0;
note('placed', { a: [ax, ay, az], b: [ax + 4, by, az] });

await throwAtFeet(); await wait(600);
check('none carried: nothing thrown', !sql(server, db, 'SELECT * FROM body').some(r => r.kind === 'molotov' || r.kind === 'fire'));
const cash = soldier('MolA').money;
await a.reducers.buy({ item: 'molotov' }); await wait(300);
check('bought for $400 (gearJson)', molotovs() === 1 && soldier('MolA').money === cash - MOLOTOV.price, { money: soldier('MolA').money, gear: soldier('MolA').gear_json });

await throwAtFeet();
const seen = new Set<string>();
for (let i = 0; i < 30; i++) {
  const f = b.db.frame.id.find(room);
  for (const x of (f && decodeFrame(f.data)?.bodies) ?? []) seen.add(x.kind);
  await wait(50);
}
check('B sees the bottle and then the fire in its frame', seen.has('molotov') && seen.has('fire'), [...seen]);
check('burst event', events.some(e => e.type === 'molotov' && e.action === 'burst' && e.owner === sa.id));
check('A has none left', molotovs() === 0);
const fire = sql(server, db, 'SELECT * FROM body').find(r => r.kind === 'fire') as { x: number; z: number } | undefined;
note('fire', fire && { x: fire.x, z: fire.z, fromB: Math.hypot(fire.x - (ax + 4), fire.z - az) });
await wait(1000);
const burnt = 100 - soldier('MolB').health;
check('B burns', burnt >= MOLOTOV.dps && soldier('MolB').alive, burnt);
check('burn damage events from A', events.some(e => e.type === 'damage' && e.zone === 'burn' && e.attacker === sa.id && e.target === sb.id));
check('A, 4 m off, does not', soldier('MolA').health === 100);
await throwAtFeet(); await wait(600);
check('no second throw', sql(server, db, 'SELECT * FROM body').filter(r => r.kind === 'fire' || r.kind === 'molotov').length === 1);
place(sb.id, ax + 4 + MOLOTOV.radius + 3, az);
await wait(300);
const out = soldier('MolB').health;
await wait(1000);
check('out of the fire, the burning stops', soldier('MolB').health === out, [out, soldier('MolB').health]);
await a.reducers.leave({}).catch(() => undefined); await b.reducers.leave({}).catch(() => undefined);
finish();
