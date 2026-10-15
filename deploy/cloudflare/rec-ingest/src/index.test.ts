import { describe, expect, it } from 'vitest';
import { InputWriter, encodeBatch, type InputHeader } from '../../../../shared/rec/inputlog';
import { pidOf, sha256Hex } from '../../../../shared/rec/policy';
import worker, { SERVERS, verifyToken } from './index';

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const text = (s: string) => new TextEncoder().encode(s);

async function signer() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const spki = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))));
  const sign = async (claims: object) => {
    const body = `${b64url(text(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))}.${b64url(text(JSON.stringify(claims)))}`;
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, text(body)));
    return `${body}.${b64url(sig)}`;
  };
  return { spki, sign };
}

const ID = 'c2'.padEnd(64, '7');

describe('rec-ingest', () => {
  it('takes only tokens the server signed', async () => {
    const a = await signer(), b = await signer();
    const token = await a.sign({ hex_identity: ID, iss: 'localhost' });
    expect(await verifyToken(token, a.spki)).toBe(ID);
    expect(await verifyToken(token, b.spki)).toBeUndefined();
    const [h, , s] = token.split('.');
    expect(await verifyToken(`${h}.${b64url(text(JSON.stringify({ hex_identity: 'c3'.padEnd(64, '0') })))}.${s}`, a.spki)).toBeUndefined();
    expect(await verifyToken(await a.sign({ hex_identity: ID, exp: 1 }), a.spki)).toBeUndefined();
  });

  it('stores a batch under the pid, never the identity, and refuses what it must', async () => {
    const puts: { key: string; meta?: Record<string, string> }[] = [];
    const env = {
      REC_SALT: 'salt', ADMIN_KEY_SHA256: await sha256Hex('admin'),
      REC: { put: async (key: string, _v: unknown, o?: { customMetadata?: Record<string, string> }) => { puts.push({ key, meta: o?.customMetadata }); }, get: async (k: string) => (k.endsWith('clean-hours.json') ? { text: async () => '{"movementHours":1}' } : null), head: async () => null },
    };
    // A real Maincloud token cannot be made here; the dev server's key is swapped for a test key below.
    const { sign, spki } = await signer();
    const token = await sign({ hex_identity: ID });
    const w = new InputWriter(0); w.key(1, 1, true);
    const session = 'ab'.repeat(12);
    const header = { recFormat: 1, session, seq: 0, db: 'lawbreaker-dev', room: 2, soldierId: 5 } as InputHeader;
    const body = encodeBatch(header, w.take().bytes);
    const post = (h: Record<string, string> = {}, q = `db=lawbreaker-dev&s=${session}&b=0`, data: Uint8Array = body) =>
      worker.fetch(new Request(`https://rec.example/v1/input?${q}`, { method: 'POST', body: data as BodyInit, headers: { Authorization: `Bearer ${token}`, ...h } }), env);
    // Signed by a key the Worker does not know: refused.
    expect((await post()).status).toBe(401);
    expect((await post({ 'Sec-GPC': '1' })).status).toBe(403);
    expect((await post({}, `db=other&s=${session}&b=0`)).status).toBe(400);
    expect(puts).toEqual([]);
    expect((await worker.fetch(new Request('https://rec.example/v1/stats', { headers: { Authorization: 'Bearer nope' } }), env)).status).toBe(401);
    const ok = await worker.fetch(new Request('https://rec.example/v1/stats', { headers: { Authorization: 'Bearer admin' } }), env);
    expect(await ok.json()).toEqual({ movementHours: 1 });

    const real = SERVERS['lawbreaker-dev'].key;
    SERVERS['lawbreaker-dev'].key = spki;
    try {
      expect((await post({}, `db=lawbreaker-dev&s=${session}&b=1`)).status).toBe(400); // header says batch 0
      expect((await post()).status).toBe(204);
      const pid = await pidOf('salt', 'dev', ID);
      expect(puts.map(p => p.key)).toEqual([expect.stringMatching(new RegExp(`^dev/v1/input/dt=\\d{4}-\\d{2}-\\d{2}/pid=${pid}/s=${session}/b=00000\\.til\\.gz$`)), expect.stringMatching(new RegExp(`^dev/v1/index/pid=${pid}/input-`))]);
      expect(puts[0].meta).toMatchObject({ pid, room: '2', soldier: '5', euUk: '1' });
      expect(JSON.stringify(puts)).not.toContain(ID);
    } finally { SERVERS['lawbreaker-dev'].key = real; }
  });
});
