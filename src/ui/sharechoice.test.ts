import { describe, expect, it } from 'vitest';
import { shareActs, shareFlow, type ShareDeps, type ShareResult } from './sharechoice';

const deps = (file: ShareResult, link: ShareResult, copy: boolean) => {
  const calls: string[] = [];
  const d: ShareDeps = {
    shareFile: async () => { calls.push('file'); return file; },
    shareLink: async () => { calls.push('link'); return link; },
    copy: async () => { calls.push('copy'); return copy; },
  };
  return { d, calls };
};

describe('the share dialog', () => {
  it('offers the card first where files can be shared, the link where only links can, else copy or save', () => {
    expect(shareActs({ files: true, link: true }, false)).toEqual(['native', 'download', 'copy']);
    expect(shareActs({ files: false, link: true }, true)).toEqual(['link', 'copy', 'download']);
    expect(shareActs({ files: false, link: false }, false)).toEqual(['download', 'copy']);
    // A room's whole point is its link: copying comes first on a computer.
    expect(shareActs({ files: false, link: false }, true)).toEqual(['copy', 'download']);
  });

  it('shares the card with its link when it can', async () => {
    const { d, calls } = deps('native', 'native', true);
    expect(await shareFlow('native', d)).toBe('native');
    expect(calls).toEqual(['file']);
  });

  it('falls back from the card to the link to the clipboard', async () => {
    let r = deps('unsupported', 'native', true);
    expect(await shareFlow('native', r.d)).toBe('link');
    expect(r.calls).toEqual(['file', 'link']);
    r = deps('unsupported', 'unsupported', true);
    expect(await shareFlow('native', r.d)).toBe('copy');
    expect(r.calls).toEqual(['file', 'link', 'copy']);
    r = deps('unsupported', 'unsupported', false);
    expect(await shareFlow('native', r.d)).toBe('failed');
  });

  it('does not retry after the player closes the share sheet', async () => {
    let r = deps('cancel', 'native', true);
    expect(await shareFlow('native', r.d)).toBe('cancel');
    expect(r.calls).toEqual(['file']);
    r = deps('unsupported', 'cancel', true);
    expect(await shareFlow('link', r.d)).toBe('cancel');
    expect(r.calls).toEqual(['link']);
  });

  it('copy only copies', async () => {
    const r = deps('native', 'native', true);
    expect(await shareFlow('copy', r.d)).toBe('copy');
    expect(r.calls).toEqual(['copy']);
  });
});
