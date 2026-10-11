import { afterEach, describe, expect, it, vi } from 'vitest';
import { Renderer } from './renderer';

/** Just what `warm` and `draw` touch of a Renderer. */
const asRenderer = (o: object) => o as unknown as Renderer;
const scene = () => ({ traverse: () => undefined });

describe('Renderer warm-up and lost graphics', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('warms with compile (no polling timer to throw) and survives a compile that throws', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const compile = vi.fn();
    const compileAsync = vi.fn();
    const self = { renderer: { compile, compileAsync, initTexture: vi.fn() }, scene: scene(), camera: {}, viewScene: scene(), viewCamera: {} };
    (Renderer.prototype.warm as () => void).call(asRenderer(self));
    expect(compile).toHaveBeenCalledTimes(2);
    expect(compileAsync).not.toHaveBeenCalled();
    compile.mockImplementation(() => { throw new Error('context lost'); });
    expect(() => (Renderer.prototype.warm as () => void).call(asRenderer(self))).not.toThrow();
  });

  it('draws nothing while the context is lost, and draws again once it is back', () => {
    let lost = true;
    const render = vi.fn();
    const self = {
      lastTime: 0, frames: 0, quality: {}, sky: undefined, scope: { render }, composer: { render },
      renderer: { getContext: () => ({ isContextLost: () => lost }), info: { reset: vi.fn() }, shadowMap: {} },
      placeShadow: vi.fn(), camera: {}, scene: {}, viewCamera: {},
    };
    const draw = (Renderer.prototype as unknown as { draw(t: number): void }).draw;
    draw.call(self, 1);
    expect(render).not.toHaveBeenCalled();
    expect(self.renderer.info.reset).not.toHaveBeenCalled();
    lost = false;
    draw.call(self, 2);
    expect(render).toHaveBeenCalledTimes(2);
  });
});
