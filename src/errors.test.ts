import { describe, expect, it } from 'vitest';
import { MAX_CLIENT_ERRORS, errorReporter, errorSource } from './errors';

describe('client error reports', () => {
  it('reports each failure once and stops after the page limit', () => {
    const sent: string[] = [];
    const report = errorReporter((kind, message) => sent.push(`${kind}:${message}`));
    expect(report('error', 'boom')).toBe(true);
    expect(report('error', 'boom')).toBe(false);
    expect(report('rejection', 'boom')).toBe(true);
    for (let i = 0; i < 10; i++) report('error', `e${i}`);
    expect(sent).toHaveLength(MAX_CLIENT_ERRORS);
    expect(sent.slice(0, 2)).toEqual(['error:boom', 'rejection:boom']);
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
});
