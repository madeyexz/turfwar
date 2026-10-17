import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { MAX_CLIENT_ERRORS, errorReporter, errorSource, graphicsLossClock, isOpaque } from './errors';

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

describe('graphics loss clock', () => {
  it('tells a loss on coming back from the background from one in plain view, and times the return', () => {
    let now = 0, visible = true;
    const clock = graphicsLossClock(() => now, () => visible);
    // In view since the page opened: lost 95.25 s in, back 1.2 s later.
    now = 95_250;
    expect(clock.lost()).toEqual({ uptime_s: 95, visible: true, visible_s: 95.3 });
    now = 96_450;
    expect(clock.restored()).toEqual({ lost_ms: 1200, visible: true, visible_s: 96.5, losses: 1 });
    // Hidden at 120 s, shown again at 300 s: a loss 0.4 s after coming back is the background's.
    now = 120_000; visible = false; clock.visibility();
    now = 300_000; visible = true; clock.visibility();
    now = 300_400;
    expect(clock.lost()).toMatchObject({ uptime_s: 300, visible: true, visible_s: 0.4 });
    now = 300_406;
    expect(clock.restored()).toEqual({ lost_ms: 6, visible: true, visible_s: 0.4, losses: 2 });
    // Lost while hidden: no time in view to give.
    visible = false; clock.visibility();
    expect(clock.lost()).toEqual({ uptime_s: 300, visible: false });
  });

  it('starts uncounted on a page opened in the background', () => {
    let now = 5_000, visible = false;
    const clock = graphicsLossClock(() => now, () => visible);
    visible = true;
    // Visible now, but the clock never saw it come into view: no made-up time in view.
    expect(clock.lost()).toEqual({ uptime_s: 5, visible: true });
    now = 7_000; clock.visibility(); now = 9_000;
    expect(clock.restored()).toEqual({ lost_ms: 4000, visible: true, visible_s: 2, losses: 1 });
  });
});

it('reports a lost graphics context with when and on what, and its return after the first frame drawn again', async () => {
  vi.resetModules();
  const sent: Record<string, unknown>[] = [];
  vi.doMock('./analytics', () => ({ track: (_event: string, props: Record<string, unknown>) => sent.push(props), captureException: () => undefined }));
  const frames: FrameRequestCallback[] = [];
  let now = 42_000;
  vi.stubGlobal('window', {});
  vi.stubGlobal('addEventListener', () => undefined);
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f));
  try {
    const { watchClientErrors } = await import('./errors');
    const canvas = new EventTarget() as HTMLCanvasElement;
    const lost = vi.fn(), restored = vi.fn();
    watchClientErrors(canvas, () => true, lost, restored, () => ({ quality: 'low', canvas: '970x448', map: 'ochre' }));
    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(lost).toHaveBeenCalled();
    expect(sent).toEqual([{ kind: 'webgl_lost', message: 'WebGL context lost', in_match: true, uptime_s: 42, visible: true, visible_s: 42, standalone: false, quality: 'low', canvas: '970x448', map: 'ochre' }]);
    now += 900;
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(restored).toHaveBeenCalled();
    // Sent once two frames have gone by: the first one after the restore re-uploads everything.
    expect(sent).toHaveLength(1);
    now += 2500; frames.shift()!(now);
    expect(sent).toHaveLength(1);
    frames.shift()!(now);
    expect(sent[1]).toEqual({ kind: 'webgl_restored', message: 'WebGL context restored', in_match: true, lost_ms: 900, visible: true, visible_s: 42.9, losses: 1, frame_ms: 2500, quality: 'low', canvas: '970x448', map: 'ochre' });
  } finally {
    vi.unstubAllGlobals(); vi.doUnmock('./analytics'); vi.resetModules();
  }
});
