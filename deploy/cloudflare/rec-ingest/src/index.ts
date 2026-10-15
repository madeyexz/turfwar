/**
 * turfwar-rec-ingest: the Cloudflare Worker at https://rec.turfwar.ianhsiao.me (docs/RECORDING.md).
 *
 * POST /v1/input?db=<database>&s=<session>&b=<batch>  — one gzip-compressed input batch (`.til`) from a
 *   player's browser. The `Authorization: Bearer` token is the player's SpacetimeDB token: its ES256
 *   signature is checked against the game server's public key, and its identity becomes the pseudonymous
 *   pid (HMAC with REC_SALT); the identity itself is not stored. Browsers that send Global Privacy Control
 *   or Do Not Track are refused (the client does not send then; this is the second lock).
 * GET /v1/stats[?env=dev]  — the processor's clean-hours summary for the admin page (admin key).
 * GET /health
 *
 * Bindings: REC (R2 bucket turfwar-rec), secrets REC_SALT and ADMIN_KEY_SHA256 (hex sha256 of the admin key).
 * Deploy: `bun deploy/cloudflare/rec-ingest/deploy.ts` (docs/DEVELOPMENT.md "Recording").
 */
import { INPUT_MAGIC, type InputHeader } from '../../../../shared/rec/inputlog';
import { leftOutCountry, pidOf, recPrefix, sha256Hex, utcDate, type RecEnv } from '../../../../shared/rec/policy';

interface R2Bucket {
  put(key: string, value: ArrayBuffer | Uint8Array | string, opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string>; httpMetadata?: { contentType?: string } } | null>;
  head(key: string): Promise<unknown | null>;
}
interface Env { REC: R2Bucket; REC_SALT: string; ADMIN_KEY_SHA256: string }

/** Where each recorded database's tokens come from (`GET /v1/identity/public-key`). A key change needs a redeploy. */
export const SERVERS: Record<string, { env: RecEnv; key: string }> = {
  turfwar: {
    env: 'tw',
    key: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7W5QjJXFD7lzeieDN6gsL36u9V+NY+ZslOqeBR0+kSYFww/Ipfd+eOcUoDlb35DYI1laHyfximZDbsC8OpmJCg==',
  },
  'lawbreaker-dev': {
    env: 'dev',
    key: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAER4jxM7lr09A/raPJEPP4cs+/cMblpngonEvt8FbpOnzvz7e/0w/tn6ayq8LPsGSlwDfkBwFK3wcqjxSA+B7myw==',
  },
};
/** The largest batch taken (compressed) and the most it may inflate to. */
const MAX_BODY = 256 * 1024;
const MAX_INFLATED = 4 * 1024 * 1024;

const ORIGINS = [/^https:\/\/turfwar\.ianhsiao\.me$/, /^https:\/\/lawbreaker\.vercel\.app$/, /^https:\/\/[a-z0-9-]+-madeyexz(-[a-z0-9]+)?\.vercel\.app$/, /^https:\/\/(lawbreaker|turfwar)-[a-z0-9-]+\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  if (!ORIGINS.some(r => r.test(origin))) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
}
const reply = (req: Request, status: number, body = '', type = 'text/plain') => new Response(status === 204 ? null : body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', ...cors(req) } });

const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = (s: string) => b64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
const keys = new Map<string, Promise<CryptoKey>>();
const keyFor = (spki: string) => {
  let k = keys.get(spki);
  if (!k) keys.set(spki, k = crypto.subtle.importKey('spki', b64(spki), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']));
  return k;
};

/** The token's identity (hex) when its ES256 signature checks out against `spki`. */
export async function verifyToken(token: string, spki: string): Promise<string | undefined> {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const head = JSON.parse(new TextDecoder().decode(b64url(parts[0]))) as { alg?: string };
    if (head.alg !== 'ES256') return undefined;
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await keyFor(spki), b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return undefined;
    const claims = JSON.parse(new TextDecoder().decode(b64url(parts[1]))) as { hex_identity?: string; exp?: number };
    if (claims.exp && claims.exp * 1000 < Date.now()) return undefined;
    return typeof claims.hex_identity === 'string' && /^[0-9a-f]{64}$/.test(claims.hex_identity) ? claims.hex_identity : undefined;
  } catch { return undefined; }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > MAX_INFLATED) { await reader.cancel(); return undefined; }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}

/** The header of a `.til` batch, when the bytes are one. */
function batchHeader(bytes: Uint8Array): InputHeader | undefined {
  if (bytes.length < 8 || new TextDecoder().decode(bytes.subarray(0, 4)) !== INPUT_MAGIC) return undefined;
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (8 + len > bytes.length) return undefined;
  try { return JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as InputHeader; } catch { return undefined; }
}

async function input(req: Request, env: Env, url: URL): Promise<Response> {
  if (req.headers.get('Sec-GPC') === '1' || req.headers.get('DNT') === '1') return reply(req, 403, 'privacy signal');
  const db = url.searchParams.get('db') ?? '', s = url.searchParams.get('s') ?? '', b = Number(url.searchParams.get('b'));
  const server = SERVERS[db];
  if (!server || !/^[0-9a-f]{24}$/.test(s) || !Number.isInteger(b) || b < 0 || b > 99_999) return reply(req, 400, 'bad request');
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY) return reply(req, 413, 'too large');
  const identity = await verifyToken((req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''), server.key);
  if (!identity) return reply(req, 401, 'bad token');
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length > MAX_BODY || !body.length) return reply(req, 413, 'too large');
  const raw = await inflate(body);
  const header = raw && batchHeader(raw);
  if (!header || header.recFormat !== 1 || header.db !== db || header.session !== s || header.seq !== b) return reply(req, 400, 'not a batch');

  const pid = await pidOf(env.REC_SALT, server.env, identity);
  const prefix = recPrefix(server.env), day = utcDate(Date.now());
  const country = (req as Request & { cf?: { country?: string } }).cf?.country;
  const meta = { pid, room: String(header.room), soldier: String(header.soldierId), euUk: leftOutCountry(country) ? '1' : '0', received: String(Date.now()), bytes: String(raw.length) };
  const key = `${prefix}/input/dt=${day}/pid=${pid}/s=${s}/b=${String(b).padStart(5, '0')}.til.gz`;
  await env.REC.put(key, body[0] === 0x1f ? body : await gzip(raw), { httpMetadata: { contentType: 'application/gzip' }, customMetadata: meta });
  // The player-to-file index (for deletion and opt-out): one small object per session.
  if (b === 0) {
    await env.REC.put(`${prefix}/index/pid=${pid}/input-${day}-${s}.json`, JSON.stringify({ kind: 'input', prefix: `${prefix}/input/dt=${day}/pid=${pid}/s=${s}/`, at: Date.now() }), { httpMetadata: { contentType: 'application/json' } });
  }
  return reply(req, 204);
}

async function stats(req: Request, env: Env, url: URL): Promise<Response> {
  const key = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!key || !env.ADMIN_KEY_SHA256 || (await sha256Hex(key)) !== env.ADMIN_KEY_SHA256.trim().toLowerCase()) return reply(req, 401, 'admin key');
  const prefix = recPrefix(url.searchParams.get('env') === 'dev' ? 'dev' : 'tw');
  const obj = await env.REC.get(`${prefix}/stats/clean-hours.json`);
  if (!obj) return reply(req, 404, '{}', 'application/json');
  // The newest recount, which may be later than the processor's last run.
  const stats = JSON.parse(await obj.text()) as Record<string, unknown>;
  const recount = await env.REC.get(`${prefix}/stats/recount.json`);
  if (recount) stats.recount = JSON.parse(await recount.text());
  return reply(req, 200, JSON.stringify(stats), 'application/json');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return reply(req, 204);
    try {
      if (req.method === 'POST' && url.pathname === '/v1/input') return await input(req, env, url);
      if (req.method === 'GET' && url.pathname === '/v1/stats') return await stats(req, env, url);
      if (req.method === 'GET' && url.pathname === '/health') return reply(req, 200, 'ok');
      return reply(req, 404, 'not found');
    } catch (e) {
      console.error('rec-ingest', e instanceof Error ? e.message : String(e));
      return reply(req, 500, 'error');
    }
  },
};
