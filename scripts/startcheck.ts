/**
 * Quick Play (anything open) and Start a Server against a LOCAL server, each player its own identity:
 * - Quick Play with no rooms opens a public 6v6 with bots; a second Quick Play joins it;
 * - a public started room is listed with its map and mode fixed, and a listed room can be joined;
 * - Quick Play fills the fullest open public room (the started one, once it has more players);
 * - a private started room is not listed, Quick Play never joins it, its code does;
 * - bots off leaves the empty slots empty; bots on fills them;
 * - start_room refuses an unknown size or mode and a map the size or mode cannot host;
 * - the older reducers (quick_play, create_room, join_room) still work.
 * Run it on an empty database:
 *
 *   bun scripts/startcheck.ts ws://127.0.0.1:3291 lbstart
 */
import { checker, connect, localOnly, wait, type Conn } from './stdb-local';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3291';
const db = process.argv[3] ?? 'lbstart';
localOnly(uri);
const { check, finish } = checker();
const QUERIES = ['SELECT * FROM match', 'SELECT * FROM player', 'SELECT * FROM roster', 'SELECT * FROM private_room', 'SELECT * FROM my_room_code'];
const open: Conn[] = [];
const client = async () => { const { conn } = await connect(uri, db, QUERIES); open.push(conn); return conn; };

async function roomOf(c: Conn) {
  for (let i = 0; i < 100; i++) {
    const p = c.db.player.identity.find(c.identity!);
    if (p) return p.room;
    await wait(50);
  }
  throw new Error('never joined');
}
const info = (c: Conn, room: number) => {
  const row = c.db.match.id.find(room)!;
  const config = JSON.parse(row.configJson);
  let bots = 0, humans = 0;
  for (const r of c.db.roster.iter()) if (r.room === room) { if (r.bot) bots++; else humans++; }
  // A private room's code only reaches the players in it (`my_room_code`), never the public row.
  const code = row.code || [...c.db.myRoomCode.iter()].find(r => r.room === room)?.code || '';
  return { room, code, private: !!c.db.privateRoom.room.find(room), publicCode: row.code, map: row.mapId, mode: config.mode, size: config.teamSize, fixedMap: !!config.fixedMap, fixedMode: !!config.fixedMode, noBots: !!config.noBots, bots, humans };
};
/** Public rooms as the lobby lists them. */
const listed = (c: Conn) => [...c.db.match.iter()].filter(r => r.code === '' && !c.db.privateRoom.room.find(r.id)).map(r => r.id).sort();
const refused = async (fn: () => Promise<unknown>) => { try { await fn(); return 'accepted'; } catch (e) { return String((e as Error).message ?? e); } };

check('starts with no rooms', [...(await client()).db.match.iter()].length === 0);

// Quick Play with nothing open opens a public 6v6 with bots; a second Quick Play joins it.
const q1 = await client();
await q1.reducers.quickAny({ name: 'Quick1', team: -1 });
const quickRoom = await roomOf(q1);
await wait(400);
const qInfo = info(q1, quickRoom);
check('Quick Play with no rooms opens a public 6v6 with bots that rotates', qInfo.code === '' && qInfo.size === 6 && !qInfo.fixedMap && !qInfo.fixedMode && !qInfo.noBots && qInfo.bots > 0, qInfo);
const q2 = await client();
await q2.reducers.quickAny({ name: 'Quick2', team: -1 });
check('a second Quick Play joins it', (await roomOf(q2)) === quickRoom);

// Start a server, public, bots off: listed, fixed, no bots; joinable from the list.
const host = await client();
await host.reducers.startRoom({ name: 'Host', team: -1, size: 1, mode: 'sabotage', mapId: 'taipei', bots: false, isPublic: true });
const pubRoom = await roomOf(host);
await wait(400);
const pInfo = info(host, pubRoom);
check('a public started room has its rules, fixed, and no code', pInfo.code === '' && pInfo.size === 1 && pInfo.map === 'taipei' && pInfo.mode === 'sabotage' && pInfo.fixedMap && pInfo.fixedMode, pInfo);
check('bots off: no bots', pInfo.noBots && pInfo.bots === 0, pInfo);
const viewer = await client();
check('a public started room is listed', listed(viewer).includes(pubRoom), listed(viewer));
await viewer.reducers.joinPublic({ name: 'Lister', team: -1, room: pubRoom });
check('a listed started room can be joined', (await roomOf(viewer)) === pubRoom);

// Private, bots on: hidden from the list, never Quick Played into, joined by its code.
const privHost = await client();
await privHost.reducers.startRoom({ name: 'PrivHost', team: -1, size: 6, mode: 'elimination', mapId: 'pipeline', bots: true, isPublic: false });
const privRoom = await roomOf(privHost);
await wait(400);
const vInfo = info(privHost, privRoom);
check('a private started room gets a code', /^[A-Z]{4}$/.test(vInfo.code), vInfo);
check('its code is kept off the public room row (only its players see it)', vInfo.private && vInfo.publicCode === '' && [...(await client()).db.myRoomCode.iter()].length === 0, vInfo);
check('bots on: bots fill the private room', !vInfo.noBots && vInfo.bots > 0, vInfo);
check('a private room is not listed', !listed(privHost).includes(privRoom), listed(privHost));
// Make the private room the fullest: Quick Play must still not pick it.
const friend = await client();
await friend.reducers.joinRoom({ name: 'Friend', team: -1, code: vInfo.code });
check('a private room is joined by its code', (await roomOf(friend)) === privRoom);
const friend2 = await client();
await friend2.reducers.joinRoom({ name: 'Friend2', team: -1, code: vInfo.code });
const q3 = await client();
await q3.reducers.quickAny({ name: 'Quick3', team: -1 });
const q3Room = await roomOf(q3);
check('Quick Play never joins a private room (even the fullest)', q3Room !== privRoom, { q3Room, privRoom });
check('Quick Play joins the fullest open public room', q3Room === quickRoom, { q3Room, quickRoom });
// The 1v1 started room is full now (host + lister): Quick Play skips it.
check('a full room is skipped', q3Room !== pubRoom);

// Validation.
for (const [name, args, want] of [
  ['unknown size', [5, 'elimination', 'pipeline'], 'Unknown room size'],
  ['any mode', [6, '', 'pipeline'], 'Unknown mode'],
  ['unknown mode', [6, 'domination', 'pipeline'], 'Unknown mode'],
  ['no map', [6, 'elimination', ''], 'That map does not host this room'],
  ['big map in 6v6', [6, 'elimination', 'meridian'], 'That map does not host this room'],
  ['small map in 24v24', [24, 'elimination', 'warehouse'], 'That map does not host this room'],
  ['Sabotage on a map without sites', [6, 'sabotage', 'warehouse'], 'That map does not host this room'],
] as const) {
  const c = await client();
  const [size, mode, mapId] = args;
  const got = await refused(() => c.reducers.startRoom({ name: 'Bad', team: -1, size, mode, mapId, bots: true, isPublic: true }));
  check(`start_room refuses ${name}`, got.includes(want), got);
}

// Older reducers still work.
const old = await client();
await old.reducers.quickPlay({ name: 'OldPlay', team: -1, size: 6, mode: 'sabotage', mapId: 'taipei' });
check('quick_play still opens or joins a room', info(old, await roomOf(old)).map === 'taipei');
const oldHost = await client();
await oldHost.reducers.createRoom({ name: 'OldHost', team: -1, size: 1, mode: 'elimination', mapId: 'pipeline', bots: false });
const oldPriv = info(oldHost, await roomOf(oldHost));
const oldFriend = await client();
await oldFriend.reducers.joinRoom({ name: 'OldFriend', team: -1, code: oldPriv.code });
check('create_room and join_room still work', oldPriv.code.length === 4 && (await roomOf(oldFriend)) === oldPriv.room, oldPriv);

for (const c of open) c.disconnect();
finish();
