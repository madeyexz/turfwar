import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../shared/sha256';
import {
  ADMIN_KEY_SHA256, ADMIN_MAX_FAILURES, ADMIN_WINDOW_MICROS, AdminError, adminLogin, adminLogout, adminRevokeAll, dailyRows, DAY_MICROS,
  dailyTimeRows, forAdmin, keyMatches, playerRows, playTimeRows, shortId, type AdminAttempts, type AdminStore,
} from '../src/admin';

// A test key and its hash, injected in place of the real one (which only the owner knows).
const TEST_KEY = 'test-admin-key-for-vitest';
const TEST_HASH = sha256Hex(TEST_KEY);

function memoryStore() {
  const admins = new Set<string>();
  const attempts = new Map<string, AdminAttempts>();
  const store: AdminStore = {
    isAdmin: id => admins.has(id),
    grant: id => { admins.add(id); },
    revoke: id => { admins.delete(id); },
    revokeAll: () => admins.clear(),
    attempts: id => attempts.get(id),
    setAttempts: (id, a) => { if (a) attempts.set(id, a); else attempts.delete(id); },
  };
  return { store, admins, attempts };
}

const MIN = 60_000_000n;

describe('admin key', () => {
  it('stores only a SHA-256 hash', () => {
    expect(ADMIN_KEY_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts the right key and refuses wrong ones', () => {
    expect(keyMatches(TEST_KEY, TEST_HASH)).toBe(true);
    expect(keyMatches(TEST_KEY.toUpperCase(), TEST_HASH)).toBe(false);
    expect(keyMatches(`${TEST_KEY} `, TEST_HASH)).toBe(false);
    expect(keyMatches('', TEST_HASH)).toBe(false);
    expect(keyMatches('x'.repeat(10_000), sha256Hex('x'.repeat(10_000)))).toBe(false); // too long: never hashed
    expect(keyMatches(TEST_KEY, TEST_HASH.toUpperCase())).toBe(true);
    // The test key is not the real one.
    expect(keyMatches(TEST_KEY)).toBe(false);
  });

  it('logs in with the right key and clears earlier failures', () => {
    const { store, admins, attempts } = memoryStore();
    expect(adminLogin(store, 'alice', 'nope', 0n, TEST_HASH)).toEqual({ ok: false, left: ADMIN_MAX_FAILURES - 1 });
    expect(adminLogin(store, 'alice', TEST_KEY, 1n, TEST_HASH).ok).toBe(true);
    expect(admins.has('alice')).toBe(true);
    expect(attempts.has('alice')).toBe(false);
  });
});

describe('admin login rate limit', () => {
  it('allows five failures per identity per ten minutes, then refuses even the right key', () => {
    const { store, admins } = memoryStore();
    for (let i = 0; i < ADMIN_MAX_FAILURES; i++) {
      expect(adminLogin(store, 'mallory', `guess-${i}`, BigInt(i) * MIN, TEST_HASH)).toEqual({ ok: false, left: ADMIN_MAX_FAILURES - i - 1 });
    }
    expect(() => adminLogin(store, 'mallory', 'guess-6', 6n * MIN, TEST_HASH)).toThrow(AdminError);
    expect(() => adminLogin(store, 'mallory', TEST_KEY, 9n * MIN, TEST_HASH)).toThrow(/Too many attempts/);
    expect(admins.has('mallory')).toBe(false);
    // Other identities are unaffected.
    expect(adminLogin(store, 'bob', TEST_KEY, 6n * MIN, TEST_HASH).ok).toBe(true);
    // Once the window (from the first failure) has passed, attempts are allowed again.
    expect(adminLogin(store, 'mallory', TEST_KEY, ADMIN_WINDOW_MICROS, TEST_HASH).ok).toBe(true);
  });

  it('starts a new window for failures after an old one expired', () => {
    const { store, attempts } = memoryStore();
    adminLogin(store, 'eve', 'a', 0n, TEST_HASH);
    adminLogin(store, 'eve', 'b', 20n * MIN, TEST_HASH);
    expect(attempts.get('eve')).toEqual({ windowStart: 20n * MIN, failures: 1 });
  });
});

describe('admin sessions', () => {
  it('logs out only the caller', () => {
    const { store, admins } = memoryStore();
    adminLogin(store, 'a', TEST_KEY, 0n, TEST_HASH);
    adminLogin(store, 'b', TEST_KEY, 0n, TEST_HASH);
    adminLogout(store, 'a');
    expect([...admins]).toEqual(['b']);
  });

  it('revokes everyone, but only when an admin asks', () => {
    const { store, admins } = memoryStore();
    adminLogin(store, 'a', TEST_KEY, 0n, TEST_HASH);
    adminLogin(store, 'b', TEST_KEY, 0n, TEST_HASH);
    expect(() => adminRevokeAll(store, 'stranger')).toThrow(/Admins only/);
    expect(admins.size).toBe(2);
    adminRevokeAll(store, 'a');
    expect(admins.size).toBe(0);
  });
});

describe('admin views', () => {
  const day = (d: number) => BigInt(d) * DAY_MICROS + 3600_000_000n;
  const seen = [
    { identity: 'aa11', firstSeen: day(100), lastSeen: day(102), sessions: 3, tz: 'Asia/Taipei', lang: 'zh-TW' },
    { identity: 'bb22', firstSeen: day(102), lastSeen: day(102), sessions: 1, tz: 'Asia/Tokyo', lang: 'ja', name: 'Kenji' },
    { identity: 'cc33', firstSeen: day(101), lastSeen: day(101), sessions: 2, tz: '', lang: '' },
  ];
  const profiles = [{ identity: 'aa11', name: 'Ah-Bing', kills: 12, matchesPlayed: 4 }];

  it('give a non-admin nothing and an admin the data', () => {
    const { store } = memoryStore();
    adminLogin(store, 'owner', TEST_KEY, 0n, TEST_HASH);
    const rows = () => playerRows(seen, profiles);
    expect(forAdmin(store, 'someone', rows)).toEqual([]);
    const mine = forAdmin(store, 'owner', rows);
    expect(mine).toHaveLength(3);
    adminLogout(store, 'owner');
    expect(forAdmin(store, 'owner', rows)).toEqual([]);
  });

  it('list players by an anonymous short id with career numbers, newest activity first', () => {
    const rows = playerRows(seen, profiles);
    expect(rows.map(r => r.id)).toEqual([shortId('aa11'), shortId('bb22'), shortId('cc33')]);
    expect(rows[0]).toMatchObject({ name: 'Ah-Bing', sessions: 3, matches: 4, kills: 12, tz: 'Asia/Taipei' });
    expect(rows[1]).toMatchObject({ name: 'Kenji', matches: 0, kills: 0 });
    expect(rows[2]).toMatchObject({ name: '' });
    for (const r of rows) { expect(r.id).toMatch(/^[0-9a-f]{10}$/); expect(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain('aa11'); }
  });

  it('count new and active players per day for the 30 days up to the latest activity', () => {
    const active: Record<number, number> = { 100: 1, 101: 2, 102: 2 };
    const rows = dailyRows(seen, d => active[d] ?? 0);
    expect(rows).toHaveLength(30);
    expect(rows[29]).toEqual({ day: 102, date: '1970-04-13', newPlayers: 1, activePlayers: 2 });
    expect(rows[28]).toMatchObject({ day: 101, newPlayers: 1, activePlayers: 2 });
    expect(rows[27]).toMatchObject({ day: 100, newPlayers: 1, activePlayers: 1 });
    expect(rows[0]).toMatchObject({ day: 73, newPlayers: 0, activePlayers: 0 });
    expect(dailyRows([], () => 0)).toEqual([]);
  });

  it('give every player seen their rounds and play time by the same short id (zeros when missing)', () => {
    const rounds = [{ identity: 'aa11', roundsPlayed: 37 }];
    const times = [{ identity: 'aa11', seconds: 3n * 3600n + 720n, since: 0n }, { identity: 'bb22', seconds: 2700n, since: day(102) }];
    const rows = playTimeRows(seen.map(s => s.identity), rounds, times);
    expect(rows).toEqual([
      { id: shortId('aa11'), rounds: 37, playSeconds: 11_520n, playingSince: 0n },
      { id: shortId('bb22'), rounds: 0, playSeconds: 2700n, playingSince: day(102) },
      { id: shortId('cc33'), rounds: 0, playSeconds: 0n, playingSince: 0n },
    ]);
    // The ids line up with admin_players, so the page can join them.
    expect(new Set(rows.map(r => r.id))).toEqual(new Set(playerRows(seen, profiles).map(r => r.id)));
    // Only players ever seen are listed.
    expect(playTimeRows([], rounds, times)).toEqual([]);
  });

  it('sum play time per day for the 30 days up to the latest day', () => {
    const play: Record<number, bigint> = { 101: 600n, 103: 120n };
    const rows = dailyTimeRows(103, d => play[d] ?? 0n);
    expect(rows).toHaveLength(30);
    expect(rows[29]).toEqual({ day: 103, date: '1970-04-14', playSeconds: 120n });
    expect(rows[27]).toMatchObject({ day: 101, playSeconds: 600n });
    expect(rows[28]).toMatchObject({ playSeconds: 0n });
    expect(dailyTimeRows(-1, () => 1n)).toEqual([]);
  });
});
