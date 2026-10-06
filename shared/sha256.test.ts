import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { constantTimeEqual, sha256Hex } from './sha256';

describe('sha256', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(sha256Hex('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('agrees with node:crypto on UTF-8 text and every padding length', () => {
    const node = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
    for (const s of ['角頭械鬥', 'Turf War: Taipei 🚓', 'é', '\u{10ffff}']) expect(sha256Hex(s)).toBe(node(s));
    for (let n = 0; n < 200; n++) { const s = 'x'.repeat(n); expect(sha256Hex(s)).toBe(node(s)); }
  });

  it('compares in constant time', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});
