/**
 * Play Online matchmaking check against a LOCAL server, each player its own identity:
 * - two clients with the same filters land in the same room;
 * - different specific maps land in different rooms;
 * - an Any client joins an existing specific-map room (the fullest);
 * - older clients' quick_join and join still work;
 * - the server refuses an unknown size or mode and a map the size (or mode) cannot host;
 * - after a match a room opened for a map and mode keeps them, one opened for a map alternates its
 *   mode, and an Any room rotates (needs `spacetime sql` owner access to end the matches early).
 *
 *   bun scripts/roomcheck.ts ws://127.0.0.1:3253 lbfilter
 */
import { spawnSync } from 'node:child_process';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3253';
const db = process.argv[3] ?? 'lbfilter';
if (!/^wss?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(uri)) throw new Error(`Refusing non-local server ${uri}`);
const httpServer = uri.replace(/^ws/, 'http').replace(/\/$/, '');
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

const connect = () => new Promise<Conn>((resolve, reject) => {
  DbConnection.builder().withUri(uri).withDatabaseName(db)
    .onConnect(conn => { conn.subscriptionBuilder().onApplied(() => resolve(conn)).subscribe(['SELECT * FROM match', 'SELECT * FROM player']); })
    .onConnectError((_c, e) => reject(e)).build();
});
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function roomOf(c: Conn) {
  for (let i = 0; i < 100; i++) {
    const p = c.db.player.identity.find(c.identity!);
    if (p) return p.room;
    await wait(50);
  }
  throw new Error('never joined');
}
const rules = (c: Conn, room: number) => {
  const row = c.db.match.id.find(room)!;
  const config = JSON.parse(row.configJson);
  return { room, map: row.mapId, mode: config.mode, size: config.teamSize, fixedMap: !!config.fixedMap, fixedMode: !!config.fixedMode, phase: row.phase };
};
const results: Record<string, unknown> = {};
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { results[name] = ok ? 'ok' : { FAILED: detail ?? true }; if (!ok) failures++; };
const play = async (size: number, mode: string, mapId: string) => {
  const c = await connect();
  await c.reducers.quickPlay({ name: `P-${mode || 'any'}-${mapId || 'any'}`, team: -1, size, mode, mapId });
  return { c, room: await roomOf(c) };
};

// Same filters, same room.
const a = await play(6, 'sabotage', 'taipei');
const b = await play(6, 'sabotage', 'taipei');
check('same filters share a room', a.room === b.room, [a.room, b.room]);
check('a specific map and mode open a fixed room', JSON.stringify(rules(a.c, a.room)) === JSON.stringify({ room: a.room, map: 'taipei', mode: 'sabotage', size: 6, fixedMap: true, fixedMode: true, phase: rules(a.c, a.room).phase }), rules(a.c, a.room));

// Different specific maps, different rooms.
const crane = await play(6, '', 'crane');
const tower = await play(6, '', 'tower');
check('different maps get different rooms', new Set([a.room, crane.room, tower.room]).size === 3, [a.room, crane.room, tower.room]);
check('a map with any mode is fixed to the map only', rules(crane.c, crane.room).map === 'crane' && rules(crane.c, crane.room).fixedMap && !rules(crane.c, crane.room).fixedMode, rules(crane.c, crane.room));
// A mode-only filter on a room whose map is a fixed other map: joins only if the mode matches.
const elim = await play(6, 'elimination', '');
const elimRule = rules(elim.c, elim.room);
check('a mode filter joins a room playing that mode', elimRule.mode === 'elimination', elimRule);

// Any joins the fullest room, a specific-map one.
const any = await play(6, '', '');
check('Any joins the fullest (specific-map) room', any.room === a.room, { any: any.room, fullest: a.room });

// Older clients.
const old = await connect();
await old.reducers.quickJoin({ name: 'OldQuick', team: -1, size: 6 });
const oldRoom = await roomOf(old);
check('quick_join (older clients) still joins the fullest room', oldRoom === a.room, { oldRoom, fullest: a.room });
const older = await connect();
await older.reducers.join({ name: 'OldJoin', team: -1 });
check('join (oldest clients) still works', (await roomOf(older)) === a.room);
const duel = await connect();
await duel.reducers.quickJoin({ name: 'OldDuel', team: -1, size: 1 });
const duelRoom = rules(duel, await roomOf(duel));
check('quick_join 1v1 opens a rotating room', duelRoom.size === 1 && !duelRoom.fixedMap && !duelRoom.fixedMode, duelRoom);

// Validation.
const refused = async (size: number, mode: string, mapId: string) => {
  const c = await connect();
  try { await c.reducers.quickPlay({ name: 'Bad', team: -1, size, mode, mapId }); return 'accepted'; } catch (e) { return String((e as Error).message ?? e); } finally { c.disconnect(); }
};
for (const [name, args, want] of [
  ['unknown size', [5, '', ''], 'Unknown room size'],
  ['unknown mode', [6, 'domination', ''], 'Unknown mode'],
  ['big map in 6v6', [6, '', 'meridian'], 'That map does not host this room'],
  ['small map in 24v24', [24, '', 'crane'], 'That map does not host this room'],
  ['Sabotage on a map without sites', [6, 'sabotage', 'tower'], 'That map does not host this room'],
  ['unknown map', [6, '', 'atlantis'], 'That map does not host this room'],
] as const) {
  const got = await refused(...(args as unknown as [number, string, string]));
  check(`refuses ${name}`, got.includes(want), got);
}

// Rotation after a match: end three rooms' matches early (owner SQL on this local database).
const sql = (q: string) => spawnSync('spacetime', ['sql', db, q, '--server', httpServer], { encoding: 'utf8' });
const before = { fixed: rules(a.c, a.room), mapOnly: rules(crane.c, crane.room), any: duelRoom };
for (const room of [a.room, crane.room, duelRoom.room]) {
  // Phase first (the tick then counts the end screen down), then almost no time left on it.
  const r2 = sql(`UPDATE match SET phase = 'ended' WHERE id = ${room}`);
  const r1 = sql(`UPDATE clock SET phaseLeft = 0.05 WHERE id = ${room}`);
  if (r1.status || r2.status) { results.sqlError = `${r1.stderr}${r2.stderr}`.trim(); }
}
// The matches roll over on the next tick.
await wait(1500);
const after = { fixed: rules(a.c, a.room), mapOnly: rules(crane.c, crane.room), any: rules(duel, duelRoom.room) };
check('every ended match started a new one', [after.fixed, after.mapOnly, after.any].every(r => r.phase !== 'ended'), after);
check('a fixed map and mode replay', after.fixed.map === 'taipei' && after.fixed.mode === 'sabotage', { before: before.fixed, after: after.fixed });
check('a fixed map keeps its map and alternates the mode', after.mapOnly.map === 'crane' && after.mapOnly.mode !== before.mapOnly.mode, { before: before.mapOnly, after: after.mapOnly });
check('an Any room rotates its map', after.any.map !== before.any.map, { before: before.any, after: after.any });

console.log(JSON.stringify({ results, failures }, null, 1));
for (const c of [a.c, b.c, crane.c, tower.c, elim.c, any.c, old, older, duel]) c.disconnect();
process.exit(failures ? 1 : 0);
