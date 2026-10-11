import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { MAX_CLIENT_ERRORS, errorReporter, errorSource, isOpaque } from './errors';

it('drains early failures once and keeps boot, uncaught and rejected failures in one budget', async () => {
  vi.resetModules();
  const sent: { kind: string; message: string }[] = [];
  const exceptions: unknown[][] = [];
  vi.doMock('./analytics', () => ({ track: (_event: string, props: { kind: string; message: string }) => sent.push(props), captureException: (list: unknown[]) => exceptions.push(list) }));
  const target = new EventTarget();
  const window = {};
  const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
  vi.stubGlobal('window', window);
  vi.stubGlobal('addEventListener', add);
  vi.stubGlobal('location', { origin: 'https://game.test' });
  const script = readFileSync('index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(script, { window, addEventListener: add, removeEventListener: remove });
  const early = Object.assign(new Event('error'), { message: 'early', error: new Error('early'), filename: 'https://game.test/a.js', lineno: 3, colno: 4 });
  target.dispatchEvent(early);
  try {
    const { watchEarlyErrors, reportBootFailure } = await import('./errors');
    watchEarlyErrors(); watchEarlyErrors();
    target.dispatchEvent(early);
    reportBootFailure(new Error('boot'));
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('rejection') }));
    for (let i = 0; i < 8; i++) reportBootFailure(new Error(`boot${i}`));
    expect(sent.map(e => e.message)).toEqual(['early', 'boot', 'rejection', 'boot0', 'boot1']);
    expect(exceptions).toHaveLength(5);
    expect(window).not.toHaveProperty('__earlyErrors');
  } finally {
    vi.unstubAllGlobals(); vi.doUnmock('./analytics'); vi.resetModules();
  }
});

describe('client error reports', () => {
  it('reports each failure once and stops after the page limit', () => {
    const sent: string[] = [];
    const report = errorReporter((kind, message) => sent.push(`${kind}:${message}`));
    expect(report('error', 'boom')).toBe(true);
    expect(report('error', 'boom')).toBe(false);
    expect(report('rejection', 'boom')).toBe(false);
    for (let i = 0; i < 10; i++) report('error', `e${i}`);
    expect(sent).toHaveLength(MAX_CLIENT_ERRORS);
    expect(sent.slice(0, 2)).toEqual(['error:boom', 'error:e0']);
  });

  it('trims long messages and sources, and names an empty one', () => {
    const sent: [string, string | undefined][] = [];
    const report = errorReporter((_kind, message, source) => sent.push([message, source]));
    report('error', 'x'.repeat(500), 'y'.repeat(500));
    report('rejection', '');
    expect(sent[0][0]).toHaveLength(200);
    expect(sent[0][1]).toHaveLength(120);
    expect(sent[1][0]).toBe('unknown');
  });

  it('keeps only the file name of a source location', () => {
    expect(errorSource('https://turfwar.ianhsiao.me/assets/main-BY9Y6QmH.js?v=2', 12, 34)).toBe('main-BY9Y6QmH.js:12:34');
    expect(errorSource(undefined)).toBeUndefined();
  });

  it('tells an opaque "Script error." from a real one', () => {
    expect(isOpaque({ message: 'Script error.', filename: '', lineno: 0 })).toBe(true);
    expect(isOpaque({ message: 'Script error.', filename: 'https://turfwar.ianhsiao.me/assets/main.js', lineno: 3 })).toBe(false);
    expect(isOpaque({ message: 'boom', filename: '', lineno: 0 })).toBe(false);
  });

  it('cleans the message (query strings, private pairs) before it is counted or sent, and passes the failure on', () => {
    const sent: [string, string, unknown][] = [];
    const report = errorReporter((_kind, message, _source, failure) => sent.push([_kind, message, failure]));
    const failure = { name: 'TypeError', message: 'x', stack: 'TypeError\n    at f (https://a.test/b.js:1:2)' };
    expect(report('error', 'load https://turfwar.ianhsiao.me/p.glb?room=ABCD failed', undefined, failure)).toBe(true);
    // The same message with another query is the same failure: once.
    expect(report('error', 'load https://turfwar.ianhsiao.me/p.glb?room=WXYZ failed')).toBe(false);
    expect(sent).toEqual([['error', 'load https://turfwar.ianhsiao.me/p.glb failed', failure]]);
  });
});
