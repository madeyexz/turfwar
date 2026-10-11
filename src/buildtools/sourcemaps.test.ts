import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cliArgs, redact, removeMaps, sourcemaps, uploadEnabled, upload } from './sourcemaps';

describe('source map upload settings', () => {
  it('uploads only when both the key and the project are set', () => {
    expect(uploadEnabled({})).toBe(false);
    expect(uploadEnabled({ POSTHOG_CLI_API_KEY: 'phx_x' })).toBe(false);
    expect(uploadEnabled({ POSTHOG_CLI_PROJECT_ID: '1' })).toBe(false);
    expect(uploadEnabled({ POSTHOG_CLI_API_KEY: ' ', POSTHOG_CLI_PROJECT_ID: '1' })).toBe(false);
    expect(uploadEnabled({ POSTHOG_CLI_API_KEY: 'phx_x', POSTHOG_CLI_PROJECT_ID: '649207' })).toBe(true);
  });

  it('files the maps under the build\'s git SHA and deletes them after upload', () => {
    expect(cliArgs('dist', 'abc1234')).toEqual(['sourcemap', 'process', '--directory', 'dist', '--release-name', 'turfwar', '--release-version', 'abc1234', '--delete-after']);
  });

  it('never prints the key, the project id or any phx_ token', () => {
    const env = { POSTHOG_CLI_API_KEY: 'phx_SECRETKEY123', POSTHOG_CLI_PROJECT_ID: '649207' };
    const out = redact('401 for phx_SECRETKEY123 at /api/projects/649207/x and phx_OtherToken9', env);
    expect(out).not.toMatch(/SECRETKEY|649207|OtherToken/);
    expect(out).toContain('[redacted]');
  });
});

describe('the build step', () => {
  it('deletes every .map under the output, nested ones too, and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maps-'));
    mkdirSync(join(dir, 'assets'));
    for (const f of ['assets/a.js', 'assets/a.js.map', 'sw.js', 'sw.js.map']) writeFileSync(join(dir, f), 'x');
    expect(removeMaps(dir)).toBe(2);
    expect([existsSync(join(dir, 'assets/a.js')), existsSync(join(dir, 'sw.js')), existsSync(join(dir, 'sw.js.map')), existsSync(join(dir, 'assets/a.js.map'))]).toEqual([true, true, false, false]);
  });

  it('with the variables absent it uploads nothing, prints nothing, still deletes the maps and never throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maps-'));
    writeFileSync(join(dir, 'a.js.map'), '{}');
    const saved = { key: process.env.POSTHOG_CLI_API_KEY, id: process.env.POSTHOG_CLI_PROJECT_ID };
    delete process.env.POSTHOG_CLI_API_KEY; delete process.env.POSTHOG_CLI_PROJECT_ID;
    const logs: unknown[] = [];
    const log = console.log, warn = console.warn;
    console.log = (...a) => { logs.push(a); }; console.warn = (...a) => { logs.push(a); };
    try {
      const plugin = sourcemaps('abc1234') as unknown as { configResolved(c: { build: { outDir: string } }): void; closeBundle: { handler(): void } };
      plugin.configResolved({ build: { outDir: dir } });
      expect(() => plugin.closeBundle.handler()).not.toThrow();
    } finally {
      console.log = log; console.warn = warn;
      if (saved.key !== undefined) process.env.POSTHOG_CLI_API_KEY = saved.key;
      if (saved.id !== undefined) process.env.POSTHOG_CLI_PROJECT_ID = saved.id;
    }
    expect(logs).toEqual([]);
    expect(existsSync(join(dir, 'a.js.map'))).toBe(false);
  });

  it('a failing runner is reported as one line, not thrown', () => {
    const problem = upload(mkdtempSync(join(tmpdir(), 'maps-')), 'abc1234', { POSTHOG_CLI_API_KEY: 'phx_k', POSTHOG_CLI_PROJECT_ID: '1', PATH: '/nonexistent' });
    expect(typeof problem).toBe('string');
    expect(problem).not.toContain('phx_k');
  });
});
