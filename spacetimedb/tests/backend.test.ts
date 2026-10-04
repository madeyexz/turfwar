import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectBackend, recordLaw, recordScore } from '../../src/backend';

describe('optional browser backend', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('needs no configuration and does not attempt network writes offline', async () => {
    vi.stubEnv('VITE_SPACETIMEDB_URI', '');
    vi.stubEnv('VITE_SPACETIMEDB_DATABASE', '');
    const status = vi.fn();
    const disconnect = connectBackend(status);
    expect(status).toHaveBeenCalledWith('offline');
    expect(await recordLaw({ kind: 'rewind', rewind: { seconds: 5 } })).toBe(false);
    expect(await recordScore(100)).toBe(false);
    disconnect();
  });
});
