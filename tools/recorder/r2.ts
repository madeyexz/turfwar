/**
 * R2 through its S3 API (Bun.S3Client). Keys come from the environment: R2_ACCOUNT_ID (or
 * CLOUDFLARE_ACCOUNT_ID) and `<prefix>_ACCESS_KEY_ID` / `<prefix>_SECRET_ACCESS_KEY`, where prefix is
 * R2_REC_VM (the Taipei VM: read and write turfwar-rec), R2_REC_READ (read turfwar-rec) or R2_REC_EXPORT
 * (read turfwar-rec, write turfwar-export). docs/DEVELOPMENT.md "Recording" lists them.
 */
import { S3Client } from 'bun';

export function r2(bucket: string, keys: 'R2_REC_VM' | 'R2_REC_READ' | 'R2_REC_EXPORT'): S3Client {
  const need = (k: string) => { const v = process.env[k]?.trim(); if (!v) throw new Error(`${k} is not set`); return v; };
  const account = process.env.R2_ACCOUNT_ID?.trim() || need('CLOUDFLARE_ACCOUNT_ID');
  return new S3Client({
    accessKeyId: need(`${keys}_ACCESS_KEY_ID`), secretAccessKey: need(`${keys}_SECRET_ACCESS_KEY`),
    endpoint: `https://${account}.r2.cloudflarestorage.com`, bucket, region: 'auto',
  });
}

export const md5Hex = (data: Uint8Array | string) => new Bun.CryptoHasher('md5').update(data).digest('hex');
export const sha256Hex = (data: Uint8Array | string) => new Bun.CryptoHasher('sha256').update(data).digest('hex');

/** Write and read back the object's size and ETag (the MD5 of a single-part upload); throws when they differ. */
export async function putChecked(c: S3Client, key: string, data: Uint8Array | string, type: string) {
  await c.write(key, data, { type });
  const st = await c.file(key).stat();
  // The ETag is the MD5 of a single-part upload; R2 marks it weak (W/) and leaves the size out of HEAD for text it may compress.
  const size = typeof data === 'string' ? new TextEncoder().encode(data).length : data.length;
  if ((st.size && st.size !== size) || st.etag.replace(/^W\//, '').replace(/"/g, '') !== md5Hex(data)) throw new Error(`R2 check failed for ${key}`);
}

/** Every key under `prefix` (all pages). */
export async function listAll(c: S3Client, prefix: string, startAfter?: string): Promise<{ key: string; size: number; lastModified?: string }[]> {
  const out: { key: string; size: number; lastModified?: string }[] = [];
  let token: string | undefined;
  for (;;) {
    const page = await c.list({ prefix, maxKeys: 1000, ...(token ? { continuationToken: token } : startAfter ? { startAfter } : {}) });
    for (const x of page.contents ?? []) out.push({ key: x.key, size: x.size ?? 0, lastModified: x.lastModified ? String(x.lastModified) : undefined });
    if (!page.isTruncated || !page.nextContinuationToken) return out;
    token = page.nextContinuationToken;
  }
}

export async function getBytes(c: S3Client, key: string) { return new Uint8Array(await c.file(key).arrayBuffer()); }
export async function getJson<T>(c: S3Client, key: string): Promise<T | undefined> {
  const f = c.file(key);
  if (!(await f.exists())) return undefined;
  return JSON.parse(await f.text()) as T;
}
