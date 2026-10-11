import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOREGROUND_PROBE_MS, OnlineLink } from './online';

/** A connection whose tables accept any listener: enough to build an OnlineLink. */
const deep = (): unknown => new Proxy(function () { /* callable */ }, { get: () => deep(), apply: () => undefined });

/** A page that can be hidden and shown again. */
function fakePage() {
  const listeners = new Map<string, Set<() => void>>();
  const add = (type: string, fn: () => void, o?: { signal?: AbortSignal }) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
    o?.signal?.addEventListener('abort', () => listeners.get(type)!.delete(fn));
  };
  const doc = { visibilityState: 'visible', addEventListener: add };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('addEventListener', add);
  const fire = (type: string) => listeners.get(type)?.forEach(fn => fn());
  return { doc, fire, count: (type: string) => listeners.get(type)?.size ?? 0 };
}

function makeLink() {
  const disconnect = vi.fn();
  const conn = new Proxy({ disconnect }, { get: (t, k) => (k === 'disconnect' ? t.disconnect : deep()) });
  const link = new OnlineLink(conn as never, { toHexString: () => 'id' } as never);
  const internals = link as unknown as { joinedOnce: boolean; lastFrameAt: number };
  internals.joinedOnce = true;
  const onDrop = vi.fn();
  link.onDrop = onDrop;
  return { link, disconnect, onDrop, internals };
}

describe('OnlineLink after the page returns to the foreground', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('drops a link that hears no frame after coming back, so the match reconnects and rejoins', () => {
    const page = fakePage();
    const { link, disconnect, onDrop } = makeLink();
    page.fire('visibilitychange');
    vi.advanceTimersByTime(FOREGROUND_PROBE_MS - 1);
    expect(onDrop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(link.dropReason).toBe('lost');
    expect(disconnect).toHaveBeenCalled();
  });

  it('keeps a link whose frames resume, and probes again on the next return', () => {
    const page = fakePage();
    const { onDrop, internals } = makeLink();
    page.fire('pageshow');
    vi.advanceTimersByTime(500);
    internals.lastFrameAt = performance.now(); // a frame arrived
    vi.advanceTimersByTime(FOREGROUND_PROBE_MS);
    expect(onDrop).not.toHaveBeenCalled();
    page.fire('visibilitychange');
    vi.advanceTimersByTime(FOREGROUND_PROBE_MS + 1);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('does nothing while hidden, before joining, or after the link ended', () => {
    const page = fakePage();
    const a = makeLink();
    page.doc.visibilityState = 'hidden';
    page.fire('visibilitychange');
    vi.advanceTimersByTime(FOREGROUND_PROBE_MS * 2);
    expect(a.onDrop).not.toHaveBeenCalled();
    page.doc.visibilityState = 'visible';
    a.internals.joinedOnce = false;
    page.fire('visibilitychange');
    vi.advanceTimersByTime(FOREGROUND_PROBE_MS * 2);
    expect(a.onDrop).not.toHaveBeenCalled();
    // Leaving on purpose removes the listeners: nothing is left to fire.
    a.internals.joinedOnce = true;
    a.link.dispose();
    expect(page.count('visibilitychange')).toBe(0);
    expect(page.count('pageshow')).toBe(0);
  });
});
