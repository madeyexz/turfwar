/** Headless SpacetimeDB clients for the LOCAL check scripts (each its own identity, or a saved token). */
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
export type Conn = InstanceType<typeof DbConnection>;

/** Refuse anything but a server on this machine. */
export function localOnly(uri: string) {
  if (!/^wss?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(uri)) throw new Error(`Refusing non-local server ${uri}`);
  return uri.replace(/^ws/, 'http').replace(/\/$/, '');
}

/** Connect (optionally with a saved token), subscribe to `queries`, resolve with the connection and its token. */
export function connect(uri: string, db: string, queries: string[], token?: string) {
  return new Promise<{ conn: Conn; token: string }>((resolve, reject) => {
    DbConnection.builder().withUri(uri).withDatabaseName(db).withToken(token)
      .onConnect((conn, _identity, nextToken) => {
        if (!queries.length) { resolve({ conn, token: nextToken }); return; }
        conn.subscriptionBuilder().onApplied(() => resolve({ conn, token: nextToken })).onError((_c, e) => reject(e)).subscribe(queries);
      })
      .onConnectError((_c, e) => reject(e)).build();
  });
}

export const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export function checker() {
  const results: Record<string, unknown> = {};
  let failures = 0;
  return {
    check(name: string, ok: boolean, detail?: unknown) { results[name] = ok ? 'ok' : { FAILED: detail ?? true }; if (!ok) failures++; },
    note(name: string, value: unknown) { results[name] = value; },
    finish() { console.log(JSON.stringify(results, (_k, v) => (typeof v === 'bigint' ? String(v) : v), 2)); process.exit(failures ? 1 : 0); },
  };
}
