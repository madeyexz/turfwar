// A local stand-in for the R2 client over /tmp/rec (downloaded with the read key). Only what
// tools/recorder/lib.ts and r2.ts call: list({prefix}), file(key).arrayBuffer()/text()/exists().
import { existsSync, readFileSync } from 'node:fs';
export const ROOT = '/tmp/rec/';
export const local = (key: string) => ROOT + key.replace(/^v1\//, '');
type Item = { key: string; size: number };
const load = (name: string): Item[] => JSON.parse(readFileSync(`${ROOT}lists/${name}.json`, 'utf8'));
export const lists = { seg: load('seg'), input: load('input'), index: load('index') };
// Sorted key arrays for prefix lists.
const sorted = [...lists.input, ...lists.index, ...lists.seg].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
const keys = sorted.map(x => x.key);
function lower(prefix: string) { let lo = 0, hi = keys.length; while (lo < hi) { const m = (lo + hi) >> 1; if (keys[m] < prefix) lo = m + 1; else hi = m; } return lo; }
export const client: any = {
  async list({ prefix }: { prefix: string }) {
    const out: Item[] = [];
    for (let i = lower(prefix); i < keys.length && keys[i].startsWith(prefix); i++) out.push(sorted[i]);
    return { contents: out, isTruncated: false };
  },
  file(key: string) {
    const path = local(key);
    return {
      async arrayBuffer() { const b = readFileSync(path); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
      async text() { return readFileSync(path, 'utf8'); },
      async exists() { return existsSync(path); },
    };
  },
};
/** A Map that keeps the newest `max` entries (the recount's session cache would otherwise hold every decoded batch). */
export class Lru<K, V> extends Map<K, V> {
  constructor(private max: number) { super(); }
  get(k: K) { const v = super.get(k); if (v !== undefined) { super.delete(k); super.set(k, v); } return v; }
  set(k: K, v: V) { super.delete(k); super.set(k, v); while (this.size > this.max) this.delete(this.keys().next().value as K); return this; }
}
export const shardOf = (segKey: string, n: number) => {
  const m = segKey.match(/dt=([^/]+)\/room=([^/]+)\//); const s = m ? m[1] + m[2] : segKey;
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
};
