import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { type LawResponse } from '../../api/law';

function response() {
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res as typeof res & LawResponse;
}
const completion = (content: string) => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });

describe('/api/law', () => {
  beforeEach(() => { vi.stubEnv('OPENAI_API_KEY', 'test-server-key'); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('rejects non-POST and malformed bodies without fetching', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    for (const [method, body, status] of [
      ['GET', {}, 405], ['POST', '{', 400], ['POST', { text: '' }, 400],
      ['POST', { text: 'x'.repeat(1001) }, 400], ['POST', { text: 'hi', extra: true }, 400],
    ] as const) {
      const res = response(); await handler({ method, body }, res);
      expect(res.status).toHaveBeenCalledWith(status);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('returns an explicit presets fallback without a key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const res = response(); await handler({ method: 'POST', body: { text: 'slow time' } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ fallback: 'presets' }));
  });
  it('requests strict structured output and returns a validated clamped command', async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion(JSON.stringify({ command: { kind: 'rewind', rewind: { seconds: 99 } } })));
    vi.stubGlobal('fetch', fetchMock);
    const res = response(); await handler({ method: 'POST', body: JSON.stringify({ text: 'rewind' }) }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ command: { kind: 'rewind', rewind: { seconds: 10 } } });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('test-server-key');
  });
  it.each(['not json', '{"command":{"kind":"rewind","rewind":{"seconds":"5"}}}', '{"command":{"kind":"rewind","rewind":{"seconds":5,"eval":"evil"}}}'])('rejects unsafe model output', async content => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion(content)));
    const res = response(); await handler({ method: 'POST', body: { text: 'hi' } }, res);
    expect(res.status).toHaveBeenCalledWith(502);
  });
  it('handles upstream failure without leaking details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const res = response(); await handler({ method: 'POST', body: { text: 'hi' } }, res);
    expect(res.status).toHaveBeenCalledWith(502);
  });
  it('aborts a stalled upstream after 12 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })));
    const res = response(); const pending = handler({ method: 'POST', body: { text: 'hi' } }, res);
    await vi.advanceTimersByTimeAsync(12_000); await pending;
    expect(res.status).toHaveBeenCalledWith(504);
  });
});
