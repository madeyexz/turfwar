import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../ui/i18n';
import { PING_INTERVAL_MS, PingMonitor, PingSamples, hostAnswers, median, pingAllowed, pingTone, pingUrl, serverIdentityKey, serverRegion } from './ping';

afterEach(() => { setLang('en', false); vi.useRealTimers(); });

describe('pingUrl', () => {
  it('maps the websocket scheme to HTTP on the same host', () => {
    expect(pingUrl('wss://maincloud.spacetimedb.com')).toBe('https://maincloud.spacetimedb.com/v1/ping');
    expect(pingUrl('ws://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/v1/ping');
    expect(pingUrl('https://example.com/')).toBe('https://example.com/v1/ping');
  });
  it('keeps the dev proxy path of same-origin', () => {
    // onlineConfig turns "same-origin" into ws(s)://<page host>/stdb/; Vite proxies /stdb to port 3000.
    expect(pingUrl('ws://localhost:5211/stdb/')).toBe('http://localhost:5211/stdb/v1/ping');
    expect(pingUrl('wss://preview.example.dev/stdb/')).toBe('https://preview.example.dev/stdb/v1/ping');
  });
  it('rejects what is not a server URL', () => {
    expect(pingUrl('same-origin')).toBeUndefined();
    expect(pingUrl('ftp://host')).toBeUndefined();
  });
});

describe('serverRegion', () => {
  it('names known hosts and falls back to the host name', () => {
    expect(serverRegion('wss://maincloud.spacetimedb.com')).toBe('US East');
    expect(serverRegion('ws://localhost:5211/stdb/')).toBe('Local');
    expect(serverRegion('ws://127.0.0.1:3000')).toBe('Local');
    expect(serverRegion('wss://tw.example.com')).toBe('tw.example.com');
    setLang('zh-TW', false);
    expect(serverRegion('wss://maincloud.spacetimedb.com')).toBe('美東');
  });
  it('shows a host it does not know by its name', () => {
    for (const uri of ['wss://turfwar.ianhsiao.me', 'wss://game.example.org', 'wss://tw.turfwar.ianhsiao.me.evil.example']) {
      expect(serverRegion(uri), uri).toBe(new URL(uri).hostname);
    }
  });
});

describe('serverIdentityKey', () => {
  it('puts the Taipei server in Taipei under each of its names', () => {
    for (const uri of ['wss://tw.turfwar.ianhsiao.me', 'wss://34-81-41-144.sslip.io/']) expect(serverRegion(uri), uri).toBe('Taipei');
  });

  it('keeps one identity for Taipei under each of its names, the one players got on the retired Singapore server (same signing keys)', () => {
    for (const uri of ['wss://tw.turfwar.ianhsiao.me', 'wss://34-81-41-144.sslip.io/']) {
      expect(serverIdentityKey(uri), uri).toBe('instacloud-singapore');
    }
  });
  it('leaves every other server keyed by its URI, so saved identities keep working', () => {
    expect(serverIdentityKey('wss://maincloud.spacetimedb.com')).toBe('wss://maincloud.spacetimedb.com');
    expect(serverIdentityKey('same-origin')).toBe('same-origin');
  });
});

describe('hostAnswers', () => {
  const reply =(status: number) => async () => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => new ArrayBuffer(0) } as Response);
  const signal = new AbortController().signal;
  it('is true only for a 200 from the host', async () => {
    expect(await hostAnswers('https://h/v1/ping', signal, reply(200))).toBe(true);
    // A sleeping server's edge: 502/503/504, or a network (or CORS) error.
    for (const status of [502, 503, 504, 404]) expect(await hostAnswers('https://h/v1/ping', signal, reply(status)), String(status)).toBe(false);
    expect(await hostAnswers('https://h/v1/ping', signal, async () => { throw new TypeError('Failed to fetch'); })).toBe(false);
  });
});

describe('ping samples', () => {
  it('takes the median', () => {
    expect(median([])).toBeUndefined();
    expect(median([5])).toBe(5);
    expect(median([300, 190, 195])).toBe(195);
    expect(median([1, 4, 2, 3])).toBe(2.5);
  });
  it('drops the first (handshake) sample and keeps the median of the last five', () => {
    const s = new PingSamples();
    s.add(640);
    expect(s.value).toBeUndefined();
    s.add(190);
    expect(s.value).toBe(190);
    for (const ms of [200, 900, 195, 193]) s.add(ms);
    expect(s.value).toBe(195); // 190 200 900 195 193
    s.add(185); // 190 drops out: 200 900 195 193 185
    expect(s.value).toBe(195);
    s.add(180); s.add(181); // 195 193 185 180 181
    expect(s.value).toBe(185);
  });
  it('after a pause drops one sample again but keeps showing the old value', () => {
    const s = new PingSamples();
    s.add(600); s.add(190);
    s.cool();
    s.add(650);
    expect(s.value).toBe(190);
    s.add(200);
    expect(s.value).toBe(195);
  });
  it('has no value after a failure until it warms up again', () => {
    const s = new PingSamples();
    s.add(600); s.add(190);
    s.fail();
    expect(s.value).toBeUndefined();
    s.add(700);
    expect(s.value).toBeUndefined();
    s.add(210);
    expect(s.value).toBe(210);
  });
});

describe('pingTone', () => {
  it('is green under 80 ms, amber under 160 ms, red otherwise', () => {
    expect(pingTone(12)).toBe('good');
    expect(pingTone(79)).toBe('good');
    expect(pingTone(80)).toBe('fair');
    expect(pingTone(159)).toBe('fair');
    expect(pingTone(160)).toBe('bad');
    expect(pingTone(195)).toBe('bad');
  });
});

describe('pingAllowed', () => {
  it('is off under the automation flags', () => {
    expect(pingAllowed('')).toBe(true);
    expect(pingAllowed('?lang=zh-TW')).toBe(true);
    for (const f of ['bench', 'trailer', 'capture', 'fixeddt']) expect(pingAllowed(`?${f}`), f).toBe(false);
  });
});

describe('PingMonitor', () => {
  it('samples only while active, warms up first, then every 4 s', async () => {
    vi.useFakeTimers();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const calls: string[] = [];
    const fetcher = async (url: string) => { calls.push(url); clock += calls.length === 1 ? 600 : 190; return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) } as Response; };
    const changed = vi.fn();
    const m = new PingMonitor(changed, fetcher);
    m.track('wss://maincloud.spacetimedb.com');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(0); // not active yet
    m.setActive(true);
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2); // the dropped handshake, then the first real sample at once
    expect(calls[0]).toBe('https://maincloud.spacetimedb.com/v1/ping');
    expect(m.get('wss://maincloud.spacetimedb.com')).toBe(190);
    expect(changed).toHaveBeenCalledTimes(1);
    clock += PING_INTERVAL_MS; await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    expect(calls).toHaveLength(3);
    m.setActive(false);
    clock += 20_000; await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toHaveLength(3);
  });

  it('stops pinging a server it no longer tracks (another server was chosen)', async () => {
    vi.useFakeTimers();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const calls: string[] = [];
    const fetcher = async (url: string) => { calls.push(url); clock += 120; return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) } as Response; };
    const m = new PingMonitor(() => undefined, fetcher);
    const tw = 'wss://tw.turfwar.ianhsiao.me', us = 'wss://maincloud.spacetimedb.com';
    m.track(tw);
    m.setActive(true);
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1);
    expect(m.get(tw)).toBe(120);
    m.untrack(tw);
    m.track(us);
    calls.length = 0;
    for (let i = 0; i < 3; i++) { clock += PING_INTERVAL_MS; await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS); }
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.every(u => u === 'https://maincloud.spacetimedb.com/v1/ping')).toBe(true);
    expect(m.get(tw)).toBeUndefined();
    expect(m.get(us)).toBe(120);
  });
});

