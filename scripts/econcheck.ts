/**
 * Online economy check against a LOCAL server: one identity buys an affordable pistol (accepted),
 * then a sniper it cannot afford (refused); a second identity sees the purchase in the roster.
 *
 *   bun scripts/econcheck.ts ws://127.0.0.1:3100 lawload
 */
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

const connect = (name: string) => new Promise<Conn>((resolve, reject) => {
  DbConnection.builder().withUri(uri).withDatabaseName(db)
    .onConnect(conn => {
      conn.subscriptionBuilder().onApplied(async () => {
        await conn.reducers.join({ name, loadout: 'assault', team: -1 });
        resolve(conn);
      }).subscribe(['SELECT * FROM match', 'SELECT * FROM roster', 'SELECT * FROM player']);
    })
    .onConnectError((_c, e) => reject(e)).build();
});
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const mine = (c: Conn) => c.db.roster.id.find(c.db.player.identity.find(c.identity!)!.soldierId)!;

const a = await connect('BuyerA');
const b = await connect('WatcherB');
await wait(1500); // deployed (buy time is 15 s)
const before = mine(a);
await a.reducers.buy({ item: 'hornet' });
await wait(500);
const afterPistol = mine(a);
await a.reducers.buy({ item: 'longbow' });
await wait(500);
const afterSniper = mine(a);
const seenByB = b.db.roster.id.find(afterPistol.id);
console.log(JSON.stringify({
  before: { money: before.money, weapons: [before.weapon0, before.weapon1] },
  afterHornet: { money: afterPistol.money, weapons: [afterPistol.weapon0, afterPistol.weapon1] },
  afterUnaffordableLongbow: { money: afterSniper.money, weapons: [afterSniper.weapon0, afterSniper.weapon1] },
  otherClientSees: seenByB && [seenByB.weapon0, seenByB.weapon1, seenByB.money],
}, null, 1));
a.disconnect(); b.disconnect();
process.exit(0);
