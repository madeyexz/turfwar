/**
 * Online rules check against a LOCAL server with two identities sharing a private room (the second
 * joins with the first one's code): rounds run (the frame carries the
 * round and its phase), the store refuses what the new-match bonus cannot pay for and sells an
 * attachment, chat reaches the other client and is rate-limited.
 *
 *   bun scripts/econcheck.ts ws://127.0.0.1:3100 lawload
 */
import { decodeFrame } from '../shared/match/frame';

const uri = process.argv[2] ?? 'ws://127.0.0.1:3100';
const db = process.argv[3] ?? 'lawload';
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

const chat: Record<string, string[]> = {};
/** The first identity opens a private room; the second joins it with the code. */
const code = { value: '' };
const connect = (name: string) => new Promise<Conn>((resolve, reject) => {
  chat[name] = [];
  DbConnection.builder().withUri(uri).withDatabaseName(db)
    .onConnect(conn => {
      conn.db.matchEvent.onInsert((_c, row) => { const e = JSON.parse(row.json); if (e.type === 'chat') chat[name].push(`${e.name}: ${e.text}`); });
      conn.subscriptionBuilder().onApplied(async () => {
        await (code.value ? conn.reducers.joinRoom({ name, team: -1, code: code.value }) : conn.reducers.createRoom({ name, team: -1, size: 6, mode: 'elimination', mapId: 'cinder', bots: true }));
        const wait = () => {
          const mine = conn.db.player.identity.find(conn.identity!);
          if (!mine) { setTimeout(wait, 50); return; }
          code.value ||= conn.db.match.id.find(mine.room)!.code;
          conn.subscriptionBuilder().onApplied(() => resolve(conn))
            .subscribe([`SELECT * FROM roster WHERE room = ${mine.room}`, `SELECT * FROM frame WHERE id = ${mine.room}`, `SELECT * FROM match_event WHERE room = ${mine.room}`]);
        };
        wait();
      }).subscribe(['SELECT * FROM match', 'SELECT * FROM player']);
    })
    .onConnectError((_c, e) => reject(e)).build();
});
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const mine = (c: Conn) => c.db.roster.id.find(c.db.player.identity.find(c.identity!)!.soldierId)!;
const roomOf = (c: Conn) => c.db.player.identity.find(c.identity!)!.room;
const frame = (c: Conn) => { const f = c.db.frame.id.find(roomOf(c)); return f ? decodeFrame(f.data) : undefined; };

const a = await connect('BuyerA');
const b = await connect('WatcherB');
await wait(1500);
const before = mine(a);
await a.reducers.buy({ item: 'm4a1' });
await a.reducers.buyAttachment({ weapon: 'mp5', attachment: 'ammoCounter' });
await wait(600);
const after = mine(a);
await a.reducers.say({ text: 'hello from A', team: false });
let limited = false;
for (let i = 0; i < 6; i++) await a.reducers.say({ text: `spam ${i}`, team: false }).catch(() => { limited = true; });
await wait(600);
const f = frame(b);
const seenByB = b.db.roster.id.find(after.id);
console.log(JSON.stringify({
  room: { code: code.value, a: roomOf(a), b: roomOf(b) },
  match: { phase: b.db.match.id.find(roomOf(b))?.phase, mode: JSON.parse(b.db.match.id.find(roomOf(b))?.configJson ?? '{}').mode, round: f?.round, roundPhase: f?.roundPhase, soldiers: f?.poses.length },
  before: { money: before.money, weapons: [before.weapon0, before.weapon1], gear: before.gearJson },
  afterUnaffordableM4AndAmmoCounter: { money: after.money, weapons: [after.weapon0, after.weapon1], gear: after.gearJson },
  otherClientSees: seenByB && { money: seenByB.money, gear: seenByB.gearJson },
  chatSeenByB: chat.WatcherB, chatRateLimited: limited,
}, null, 1));
a.disconnect(); b.disconnect();
process.exit(0);
