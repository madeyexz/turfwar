/**
 * Online law check against a LOCAL server: two separate identities join; one rewrites a law, the
 * other sees it replicate, and an immediate second rewrite is refused by the cooldown.
 *
 *   bun scripts/lawcheck.ts ws://127.0.0.1:3100 lawload
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
const { presets } = await import('../src/commands');
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

const a = await connect('LawA');
const b = await connect('LawB');
const command = presets[0].command;
await a.reducers.rewriteLaw({ commandJson: JSON.stringify(command), source: 'PRESET', text: 'inverse cube' });
await new Promise(r => setTimeout(r, 300));
const seen = b.db.match.id.find(0);
let second = 'accepted';
try { await a.reducers.rewriteLaw({ commandJson: JSON.stringify(command), source: 'PRESET', text: 'again' }); } catch (e) { second = String((e as Error).message ?? e); }
let bogus = 'accepted';
try { await b.reducers.rewriteLaw({ commandJson: JSON.stringify({ kind: 'gravity', gravity: { mode: 'central', exponent: 99, strength: 1e9, extra: 1 } }), source: 'PRESET', text: '' }); } catch (e) { bogus = String((e as Error).message ?? e); }
const mine = a.db.player.identity.find(a.identity!);
const roster = mine ? b.db.roster.id.find(mine.soldierId) : undefined;
console.log(JSON.stringify({
  otherClientSeesLawText: seen?.lawText, otherClientSeesExponent: JSON.parse(seen?.lawsJson ?? '{}').gravity?.exponent,
  immediateSecondRewrite: second, invalidCommandFromOtherClient: bogus, authorLawReadyAt: roster?.lawReadyAt,
}, null, 1));
a.disconnect(); b.disconnect();
process.exit(0);
