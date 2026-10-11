import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALWAYS_ON, WAKE, WakeDriver, idleWake, retryDelay, step, wakeProgress, wakeSeconds, type WakeEvent, type WakeLink, type WakeState } from './wake';

/** Feed events through the pure machine, collecting what it asks to run. */
function machine<A>() {
  let s: WakeState<A> = idleWake<A>();
  const runs: A[] = [];
  const send = (e: WakeEvent<A>, now: number) => { const r = step(s, e, now); s = r.state; if (r.run !== undefined) runs.push(r.run); return s; };
  return { send, runs, get state() { return s; } };
}

describe('wake state machine', () => {
  it('a warm server goes straight to ready without waking', () => {
    const m = machine<string>();
    expect(m.send({ type: 'start' }, 0).phase).toBe('probing');
    m.send({ type: 'hostUp' }, 150);
    expect(m.send({ type: 'up' }, 400)).toMatchObject({ phase: 'ready', woke: false });
  });

  it('a 503 (or any failed ping) shows waking, and recovery is ready', () => {
    const m = machine<string>();
    m.send({ type: 'start' }, 0);
    expect(m.send({ type: 'cold', from: 'ping' }, 200)).toMatchObject({ phase: 'waking', woke: true, failures: 1 });
    expect(m.send({ type: 'cold', from: 'connect' }, 2500).phase).toBe('waking');
    expect(m.send({ type: 'hostUp' }, 24_000)).toMatchObject({ phase: 'waking', hostUp: true });
    // A connect that fails while the host answers: still up, the database is loading.
    expect(m.send({ type: 'cold', from: 'connect' }, 25_000)).toMatchObject({ phase: 'waking', hostUp: true });
    expect(m.send({ type: 'up' }, 27_000)).toMatchObject({ phase: 'ready', woke: true });
  });

  it('no answer within 6 s is only slow: still "probing", never "asleep" without a failure', () => {
    const m = machine<string>();
    m.send({ type: 'start' }, 1000);
    expect(m.send({ type: 'tick' }, 6999)).toMatchObject({ phase: 'probing', slow: false });
    expect(m.send({ type: 'tick' }, 7000)).toMatchObject({ phase: 'probing', slow: true, woke: false });
    expect(m.send({ type: 'tick' }, 30_000).phase).toBe('probing');
    expect(m.send({ type: 'up' }, 31_000)).toMatchObject({ phase: 'ready', woke: false, slow: true });
  });

  it('gives up after 3 minutes, and Retry starts over', () => {
    const m = machine<string>();
    m.send({ type: 'start' }, 0);
    m.send({ type: 'cold', from: 'ping' }, 100);
    expect(m.send({ type: 'tick' }, WAKE.giveUpMs - 1).phase).toBe('waking');
    expect(m.send({ type: 'tick' }, WAKE.giveUpMs).phase).toBe('unreachable');
    // Late answers from the abandoned attempt change nothing.
    expect(m.send({ type: 'up' }, WAKE.giveUpMs + 10).phase).toBe('unreachable');
    expect(m.send({ type: 'retry' }, 200_000)).toMatchObject({ phase: 'probing', since: 200_000, failures: 0 });
  });

  it('a failure past the limit gives up at once', () => {
    const m = machine<string>();
    m.send({ type: 'start' }, 0);
    expect(m.send({ type: 'cold', from: 'connect' }, WAKE.giveUpMs + 1).phase).toBe('unreachable');
  });

  it('an always-on server is never "asleep": failures keep it probing, then it is unreachable after 30 s', () => {
    let s = idleWake<string>();
    const send = (e: WakeEvent<string>, now: number) => { s = step(s, e, now, ALWAYS_ON).state; return s; };
    send({ type: 'start' }, 0);
    expect(send({ type: 'cold', from: 'ping' }, 200)).toMatchObject({ phase: 'probing', woke: false, failures: 1 });
    expect(send({ type: 'cold', from: 'connect' }, 2500)).toMatchObject({ phase: 'probing', woke: false, failures: 2 });
    expect(send({ type: 'tick' }, ALWAYS_ON.giveUpMs - 1).phase).toBe('probing');
    expect(send({ type: 'tick' }, ALWAYS_ON.giveUpMs).phase).toBe('unreachable');
    expect(ALWAYS_ON.giveUpMs).toBe(30_000);
    // Retry starts over, and a good connection then is plain "ready" (no wake to report).
    send({ type: 'retry' }, 40_000);
    send({ type: 'cold', from: 'ping' }, 40_100);
    expect(send({ type: 'up' }, 41_000)).toMatchObject({ phase: 'ready', woke: false, failures: 1 });
  });

  it('runs a queued action once, when the server is up', () => {
    const m = machine<string>();
    m.send({ type: 'start' }, 0);
    m.send({ type: 'cold', from: 'ping' }, 100);
    m.send({ type: 'queue', action: 'quick' }, 5000);
    expect(m.state.queued).toBe('quick');
    expect(m.runs).toEqual([]);
    m.send({ type: 'up' }, 20_000);
    m.send({ type: 'up' }, 20_001);
    m.send({ type: 'tick' }, 21_000);
    expect(m.runs).toEqual(['quick']);
    expect(m.state.queued).toBeUndefined();
  });

  it('runs at once when already connected, and the last press wins while waking', () => {
    const m = machine<string>();
    m.send({ type: 'start' }, 0);
    m.send({ type: 'queue', action: 'quick' }, 100);
    m.send({ type: 'queue', action: 'start' }, 200);
    m.send({ type: 'up' }, 300);
    expect(m.runs).toEqual(['start']);
    m.send({ type: 'queue', action: 'code' }, 400);
    expect(m.runs).toEqual(['start', 'code']);
  });

  it('cancel drops the queued action', () => {
    const m = machine<string>();
    m.send({ type: 'start' }, 0);
    m.send({ type: 'cold', from: 'ping' }, 100);
    m.send({ type: 'queue', action: 'quick' }, 1000);
    m.send({ type: 'cancel' }, 2000);
    m.send({ type: 'up' }, 9000);
    expect(m.runs).toEqual([]);
    expect(m.state.phase).toBe('ready');
  });

  it('pressing play after giving up retries and keeps the action', () => {
    const m = machine<string>();
    m.send({ type: 'start' }, 0);
    m.send({ type: 'tick' }, WAKE.giveUpMs);
    expect(m.state.phase).toBe('unreachable');
    expect(m.send({ type: 'queue', action: 'quick' }, 190_000)).toMatchObject({ phase: 'probing', since: 190_000, queued: 'quick' });
    m.send({ type: 'up' }, 191_000);
    expect(m.runs).toEqual(['quick']);
  });

  it('a dropped connection probes again; stop forgets everything', () => {
    const m = machine<string>();
    m.send({ type: 'start' }, 0);
    m.send({ type: 'up' }, 100);
    expect(m.send({ type: 'down' }, 60_000)).toMatchObject({ phase: 'probing', since: 60_000 });
    m.send({ type: 'queue', action: 'quick' }, 60_100);
    expect(m.send({ type: 'stop' }, 60_200)).toEqual(idleWake());
    m.send({ type: 'up' }, 60_300);
    expect(m.runs).toEqual([]);
  });

  it('counts seconds, fills the bar by the expected time and backs off to 3 s', () => {
    const s = { ...idleWake<string>(), phase: 'waking' as const, since: 1000 };
    expect(wakeSeconds(s, 13_999)).toBe(12);
    expect(wakeProgress(0)).toBe(0);
    expect(wakeProgress(15_000)).toBeCloseTo(0.45);
    expect(wakeProgress(30_000)).toBeCloseTo(0.9);
    expect(wakeProgress(180_000)).toBeLessThan(0.99);
    expect(wakeProgress(90_000)).toBeGreaterThan(wakeProgress(60_000));
    expect([1, 2, 3, 10].map(retryDelay)).toEqual([2000, 2500, 3000, 3000]);
  });
});

/** A fake server for the driver: pings and connects answer as `up` says. */
function fakeServer() {
  const server = {
    up: false,
    /** Connects hang (the edge holds them) instead of failing at once while down. */
    hold: false,
    pings: 0, connects: 0, open: 0, maxOpen: 0,
    links: [] as { lost: () => void; stopped: boolean }[],
  };
  const deps = {
    now: () => Date.now(),
    ping: async () => { server.pings++; return server.up; },
    connect(lost: () => void): WakeLink {
      server.connects++;
      server.open++; server.maxOpen = Math.max(server.maxOpen, server.open);
      const rec = { lost, stopped: false };
      server.links.push(rec);
      const live = new Promise<void>((resolve, reject) => {
        const settle = () => { if (server.up) resolve(); else if (!server.hold) reject(new Error('503')); else setTimeout(settle, 500); };
        setTimeout(settle, 50);
      });
      live.catch(() => { if (!rec.stopped) { rec.stopped = true; server.open--; } });
      return { live, stop: () => { if (!rec.stopped) { rec.stopped = true; server.open--; } } };
    },
  };
  return { server, deps };
}

describe('WakeDriver', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('wakes a sleeping server, then runs the queued action once', async () => {
    vi.useFakeTimers();
    const { server, deps } = fakeServer();
    const runs: string[] = [];
    const phases: string[] = [];
    const d = new WakeDriver<string>(deps, s => { if (phases.at(-1) !== s.phase) phases.push(s.phase); }, a => runs.push(a));
    d.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(d.state.phase).toBe('waking');
    d.queue('quick');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(runs).toEqual([]);
    server.up = true;
    await vi.advanceTimersByTimeAsync(4000);
    expect(d.state.phase).toBe('ready');
    expect(runs).toEqual(['quick']);
    expect(phases).toEqual(['probing', 'waking', 'ready']);
    // Once ready, no more pings or connects.
    const { pings, connects } = server;
    await vi.advanceTimersByTimeAsync(30_000);
    expect([server.pings, server.connects]).toEqual([pings, connects]);
    expect(runs).toEqual(['quick']);
    d.stop();
  });

  it('keeps one connection in flight while the edge holds them, and pings every 2–3 s', async () => {
    vi.useFakeTimers();
    const { server, deps } = fakeServer();
    server.hold = true;
    const d = new WakeDriver<string>(deps, () => undefined, () => undefined);
    d.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.maxOpen).toBe(1);
    // Held connects are dropped after 20 s; while pings fail, a new one at most every 15 s.
    expect(server.connects).toBeGreaterThanOrEqual(2);
    expect(server.connects).toBeLessThanOrEqual(4);
    expect(server.pings).toBeGreaterThanOrEqual(20);
    expect(server.pings).toBeLessThanOrEqual(30);
    server.up = true;
    await vi.advanceTimersByTimeAsync(4000);
    expect(d.state.phase).toBe('ready');
    expect(server.open).toBe(1);
    d.stop();
    expect(server.open).toBe(0);
  });

  it('gives up after 3 minutes and stops trying until Retry', async () => {
    vi.useFakeTimers();
    const { server, deps } = fakeServer();
    const d = new WakeDriver<string>(deps, () => undefined, () => undefined);
    d.start();
    await vi.advanceTimersByTimeAsync(WAKE.giveUpMs + 1000);
    expect(d.state.phase).toBe('unreachable');
    const { pings, connects } = server;
    await vi.advanceTimersByTimeAsync(60_000);
    expect([server.pings, server.connects]).toEqual([pings, connects]);
    server.up = true;
    d.retry();
    await vi.advanceTimersByTimeAsync(1000);
    expect(d.state.phase).toBe('ready');
    d.stop();
  });

  it('a slow server that never fails stays "probing" (neutral copy), then comes up, with timings', async () => {
    vi.useFakeTimers();
    const { server, deps } = fakeServer();
    server.hold = true; // the connection is dialled and just takes its time
    const slow = {
      ...deps,
      // The host answers 200 after 3.5 s (inside the 4 s ping limit) and the database is ready at 6.5 s.
      ping: async () => { await new Promise(r => setTimeout(r, 3500)); setTimeout(() => { server.up = true; }, 3000); return true; },
      connect(lost: () => void): WakeLink { return { ...deps.connect(lost), importMs: () => 1234 }; },
    };
    const d = new WakeDriver<string>(slow, () => undefined, () => undefined);
    d.start();
    await vi.advanceTimersByTimeAsync(WAKE.slowMs + 100);
    expect(d.state).toMatchObject({ phase: 'probing', slow: true, woke: false, failures: 0 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(d.state).toMatchObject({ phase: 'ready', slow: true, woke: false });
    expect(d.timings).toMatchObject({ pingMs: 3500, pingOk: true, importMs: 1234 });
    d.stop();
  });

  it('records the connection time and the code-loading part of it', async () => {
    vi.useFakeTimers();
    const { server, deps } = fakeServer();
    server.up = true;
    const withImport = { ...deps, connect(lost: () => void): WakeLink { return { ...deps.connect(lost), importMs: () => 41.6 }; } };
    const d = new WakeDriver<string>(withImport, () => undefined, () => undefined);
    d.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(d.state.phase).toBe('ready');
    expect(d.timings).toMatchObject({ connectMs: 50, importMs: 42, pingOk: true });
    d.stop();
  });

  it('a driver for an always-on server never shows waking, gives up after 30 s, and still runs a queued action once it is up', async () => {
    vi.useFakeTimers();
    const { server, deps } = fakeServer();
    const phases: string[] = [];
    const runs: string[] = [];
    const d = new WakeDriver<string>({ ...deps, sleeps: () => false }, s => { if (phases.at(-1) !== s.phase) phases.push(s.phase); }, a => runs.push(a));
    d.start();
    d.queue('quick');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(d.state).toMatchObject({ phase: 'probing', woke: false });
    expect(d.state.failures).toBeGreaterThan(0);
    server.up = true;
    await vi.advanceTimersByTimeAsync(4000);
    expect(d.state.phase).toBe('ready');
    expect(runs).toEqual(['quick']);
    expect(phases).not.toContain('waking');
    d.stop();
    // Down for good: unreachable after 30 s, not 3 minutes.
    server.up = false;
    const down = new WakeDriver<string>({ ...deps, sleeps: () => false }, () => undefined, () => undefined);
    down.start();
    await vi.advanceTimersByTimeAsync(ALWAYS_ON.giveUpMs + 1000);
    expect(down.state.phase).toBe('unreachable');
    down.stop();
  });

  it('cancel keeps the action from running', async () => {
    vi.useFakeTimers();
    const { server, deps } = fakeServer();
    const runs: string[] = [];
    const d = new WakeDriver<string>(deps, () => undefined, a => runs.push(a));
    d.start();
    await vi.advanceTimersByTimeAsync(5000);
    d.queue('start');
    d.cancel();
    server.up = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(d.state.phase).toBe('ready');
    expect(runs).toEqual([]);
    d.stop();
  });

  it('goes back to probing when a live connection drops', async () => {
    vi.useFakeTimers();
    const { server, deps } = fakeServer();
    server.up = true;
    const d = new WakeDriver<string>(deps, () => undefined, () => undefined);
    d.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(d.state.phase).toBe('ready');
    server.up = false;
    server.links.at(-1)!.lost();
    expect(d.state.phase).toBe('probing');
    await vi.advanceTimersByTimeAsync(3000);
    expect(d.state.phase).toBe('waking');
    server.up = true;
    await vi.advanceTimersByTimeAsync(4000);
    expect(d.state.phase).toBe('ready');
    d.stop();
  });

  it('may be stopped from the queued action (the lobby leaves for the match)', async () => {
    vi.useFakeTimers();
    const { server, deps } = fakeServer();
    let d: WakeDriver<string> | undefined;
    const runs: string[] = [];
    d = new WakeDriver<string>(deps, () => undefined, a => { runs.push(a); d!.stop(); });
    d.start();
    d.queue('quick');
    server.up = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(runs).toEqual(['quick']);
    expect(d.state.phase).toBe('idle');
    expect(server.open).toBe(0);
  });
});
