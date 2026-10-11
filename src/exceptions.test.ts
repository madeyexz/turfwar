import { describe, expect, it } from 'vitest';
import { asFailure, chunkIdsByFile, cleanUrl, exceptionList, parseStack, scrub } from './exceptions';

const ORIGIN = 'https://turfwar.ianhsiao.me';

describe('scrub', () => {
  it('drops the query string and hash of URLs, wherever they sit in a message', () => {
    expect(scrub('Failed to fetch https://turfwar.ianhsiao.me/assets/props.glb?v=abc123&room=ABCD#top now')).toBe('Failed to fetch https://turfwar.ianhsiao.me/assets/props.glb now');
    expect(scrub('at (https://x.test/a.js?utm_source=threads:1:2)')).toBe('at (https://x.test/a.js)');
  });

  it('blanks private key=value pairs and long hex strings, and leaves ordinary text alone', () => {
    expect(scrub('bad link ?room=ABCD&utm_source=threads&fbclid=IwAR0 here')).toBe('bad link ?room=[x]&utm_source=[x]&fbclid=[x] here');
    expect(scrub(`identity ${'ab12'.repeat(16)} left`)).toBe('identity [id] left');
    expect(scrub("Cannot read properties of undefined (reading 'isReady')")).toBe("Cannot read properties of undefined (reading 'isReady')");
    expect(scrub('WebSocket closed with code=1006')).toBe('WebSocket closed with code=1006');
    expect(scrub('bad (room=ABCD) email=a@example.com phx_secret')).toBe('bad (room=[x]) email=[email] [key]');
    expect(scrub(scrub('room=ABCD token=private'))).toBe('room=[x] token=[x]');
  });

  it('cleans a script URL to its path', () => {
    expect(cleanUrl(`${ORIGIN}/assets/main-BY9Y6QmH.js?v=2#x`)).toBe(`${ORIGIN}/assets/main-BY9Y6QmH.js`);
  });
});

describe('parseStack', () => {
  const v8 = `TypeError: x is not a function
    at Game.frame (${ORIGIN}/assets/main-AAA.js:10:200)
    at https://turfwar.ianhsiao.me/assets/three-BBB.js?v=1:3:4
    at async boot (${ORIGIN}/assets/main-AAA.js:7:8)
    at <anonymous>`;
  const gecko = `frame@${ORIGIN}/assets/main-AAA.js:10:200
@${ORIGIN}/assets/main-AAA.js?room=ABCD:1:2
native code`;

  it('reads V8 stacks, newest first, without queries, and marks our own scripts in_app', () => {
    const frames = parseStack(v8, ORIGIN);
    expect(frames.map(f => [f.function, f.filename, f.lineno, f.colno, f.in_app])).toEqual([
      ['Game.frame', `${ORIGIN}/assets/main-AAA.js`, 10, 200, true],
      [undefined, `${ORIGIN}/assets/three-BBB.js`, 3, 4, true],
      ['boot', `${ORIGIN}/assets/main-AAA.js`, 7, 8, true],
    ]);
    expect(frames.every(f => f.platform === 'web:javascript')).toBe(true);
  });

  it('reads Firefox and Safari stacks, and not our origin as in_app only for foreign scripts', () => {
    const frames = parseStack(gecko, ORIGIN);
    expect(frames).toHaveLength(2);
    expect(frames[1].filename).toBe(`${ORIGIN}/assets/main-AAA.js`);
    expect(parseStack('    at e (https://cdn.other.test/inject.js:1:2)', ORIGIN)[0].in_app).toBe(false);
    expect(parseStack(`    at e (${ORIGIN}.evil.test/inject.js:1:2)`, ORIGIN)[0].in_app).toBe(false);
  });

  it('copes with a missing stack and caps the frames', () => {
    expect(parseStack(undefined)).toEqual([]);
    const many = Array.from({ length: 80 }, (_, i) => `    at f${i} (${ORIGIN}/a.js:${i}:1)`).join('\n');
    expect(parseStack(many, ORIGIN)).toHaveLength(50);
  });
});

describe('exceptionList', () => {
  it('maps each frame to its chunk id by script file, cleans the message and names the mechanism', () => {
    const ids = { [`Error\n    at ${ORIGIN}/assets/main-AAA.js?v=1:1:1`]: 'chunk-main', [`Error\n    at e (${ORIGIN}/assets/three-BBB.js:1:1)`]: 'chunk-three' };
    const chunks = chunkIdsByFile(ids, ORIGIN);
    expect([...chunks]).toEqual([[`${ORIGIN}/assets/main-AAA.js`, 'chunk-main'], [`${ORIGIN}/assets/three-BBB.js`, 'chunk-three']]);
    const [entry] = exceptionList({ name: 'TypeError', message: 'bad https://x.test/p?room=ABCD thing', stack: `TypeError\n    at f (${ORIGIN}/assets/main-AAA.js:10:200)\n    at g (${ORIGIN}/assets/other.js:1:1)` }, 'onerror', chunks, ORIGIN);
    expect(entry).toMatchObject({ type: 'TypeError', value: 'bad https://x.test/p thing', mechanism: { handled: false, type: 'onerror' } });
    expect(entry.stacktrace?.frames.map(f => [f.lineno, f.chunk_id])).toEqual([[1, undefined], [10, 'chunk-main']]);
  });

  it('has no stacktrace when there is no stack, and turns any thrown value into a failure', () => {
    expect(exceptionList({ message: 'boom' }, 'onunhandledrejection', new Map())[0]).not.toHaveProperty('stacktrace');
    expect(asFailure('plain string', 'UnhandledRejection')).toEqual({ name: 'UnhandledRejection', message: 'plain string' });
    expect(asFailure(undefined).message).toBe('unknown');
    const e = new RangeError('too deep');
    expect(asFailure(e)).toMatchObject({ name: 'RangeError', message: 'too deep' });
    expect(asFailure({ message: 'obj' }).message).toBe('obj');
  });
});
