import { describe, expect, it, vi } from 'vitest';
import { Voice, VoicePool, unit } from './voices';

/** A scheduled source whose 'ended' event the test fires. */
function source() {
  const listeners: (() => void)[] = [];
  return {
    stop: vi.fn(),
    addEventListener: (_type: string, fn: () => void) => { listeners.push(fn); },
    end: () => listeners.splice(0).forEach(fn => fn()),
  };
}
const plug = () => ({ connect: vi.fn(), disconnect: vi.fn() });
const bus = {} as AudioNode;

describe('Voice', () => {
  it('unplugs its exits only after the last source ends', () => {
    const voice = new Voice();
    const out = plug(), send = plug();
    voice.route(out, bus); voice.route(send, bus);
    expect(out.connect).toHaveBeenCalledWith(bus);
    const a = voice.track(source()), b = voice.track(source());
    const onEnd = vi.fn();
    voice.onEnd = onEnd;
    voice.seal();
    a.end();
    expect(out.disconnect).not.toHaveBeenCalled();
    b.end();
    expect(out.disconnect).toHaveBeenCalledOnce();
    expect(send.disconnect).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(voice.ended).toBe(true);
  });

  it('waits for seal: sources ending while the sound is still being built do not end it', () => {
    const voice = new Voice();
    const out = plug();
    voice.route(out, bus);
    voice.track(source()).end();
    expect(out.disconnect).not.toHaveBeenCalled();
    voice.seal();
    expect(out.disconnect).toHaveBeenCalledOnce();
  });

  it('ends at once when sealed without sources (nothing will ever play through it)', () => {
    const voice = new Voice();
    const out = plug();
    voice.route(out, bus);
    voice.seal();
    expect(out.disconnect).toHaveBeenCalledOnce();
  });

  it('stops every live source, tolerating ones that cannot stop', () => {
    const voice = new Voice();
    const a = voice.track(source()), b = voice.track(source());
    b.stop.mockImplementation(() => { throw new DOMException('not started', 'InvalidStateError'); });
    expect(() => voice.stop(1.5)).not.toThrow();
    expect(a.stop).toHaveBeenCalledWith(1.5);
    a.end(); b.end();
    voice.seal();
    expect(voice.ended).toBe(true);
  });
});

describe('VoicePool', () => {
  it('steals the oldest voice when full instead of refusing a near one', () => {
    const stolen: number[] = [];
    const pool = new VoicePool<number>(3, v => stolen.push(v));
    for (const v of [1, 2, 3]) expect(pool.add(v)).toBe(true);
    expect(pool.add(4)).toBe(true);
    expect(stolen).toEqual([1]);
    expect(pool.size).toBe(3);
  });

  it('drops a droppable (distant) voice when full and keeps the rest playing', () => {
    const steal = vi.fn();
    const pool = new VoicePool<number>(2, steal);
    pool.add(1); pool.add(2);
    expect(pool.add(3, true)).toBe(false);
    expect(steal).not.toHaveBeenCalled();
    expect(pool.size).toBe(2);
  });

  it('frees a slot when a voice ends on its own (and ignores stolen ones ending later)', () => {
    const pool = new VoicePool<number>(2, () => undefined);
    pool.add(1); pool.add(2);
    pool.remove(1);
    expect(pool.add(3, true)).toBe(true);
    pool.add(4); // steals 2
    pool.remove(2);
    expect(pool.size).toBe(2);
  });
});

describe('unit', () => {
  it('clamps to 0..1 and maps NaN and infinities to 0', () => {
    expect(unit(0.4)).toBe(0.4);
    expect(unit(-3)).toBe(0);
    expect(unit(7)).toBe(1);
    expect(unit(NaN)).toBe(0);
    expect(unit(Infinity)).toBe(0);
    expect(unit(-Infinity)).toBe(0);
  });
});
