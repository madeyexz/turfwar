import { describe, expect, it } from 'vitest';
import { mergeReleases, parseReleaseLog, releasesByDay, releaseTitle } from './releases';
import snapshot from './releases.json';

const DAY = 86_400;

describe('admin releases', () => {
  it('reads release commits from git log output and drops the rest', () => {
    const log = [
      `8533c53\t${20735 * DAY + 3600}\tRelease: analytics for how phones play`,
      `fd93814\t${20735 * DAY}\tMerge mobile play analytics into dev`,
      `b6eb497\t${20735 * DAY + 60}\tRelease Turf War app icon`,
      `6b77b36\t${20733 * DAY}\tMerge branch 'dev' into release-tmp`,
      '',
    ].join('\n');
    expect(parseReleaseLog(log)).toEqual([
      { sha: '8533c53', at: 20735 * DAY + 3600, title: 'analytics for how phones play' },
      { sha: 'b6eb497', at: 20735 * DAY + 60, title: 'Turf War app icon' },
    ]);
  });

  it('merges lists once per commit, oldest first', () => {
    const a = { sha: 'aaaaaaa', at: 2, title: 'a' }, b = { sha: 'bbbbbbb', at: 1, title: 'b' };
    expect(mergeReleases([a], [{ ...a, sha: 'aaaaaaa1234' }, b])).toEqual([b, a]);
  });

  it('groups releases by UTC day within a range and titles a day\'s marker', () => {
    const list = [{ sha: '1', at: 10 * DAY + 60, title: 'one' }, { sha: '2', at: 10 * DAY + 7200, title: 'two' }, { sha: '3', at: 12 * DAY, title: 'three' }, { sha: '4', at: 3 * DAY, title: 'old' }];
    const byDay = releasesByDay(list, 9, 12);
    expect([...byDay.keys()]).toEqual([10, 12]);
    expect(byDay.get(10)!.map(r => r.title)).toEqual(['one', 'two']);
    expect(releaseTitle(10, byDay.get(10)!)).toBe('1970-01-11: 2 releases (UTC)\n• 00:01 one\n• 02:00 two');
    const byHour = releasesByDay(list, 240, 242, 3600);
    expect([...byHour.keys()]).toEqual([240, 242]);
    expect(releaseTitle(242, byHour.get(242)!, 3600)).toBe('1970-01-11 02:00: 1 release (UTC)\n• 02:00 two');
  });

  it('keeps a well-formed snapshot', () => {
    expect(snapshot.length).toBeGreaterThan(0);
    for (const r of snapshot) expect(r).toMatchObject({ sha: expect.stringMatching(/^[0-9a-f]{7}$/), at: expect.any(Number), title: expect.any(String) });
    expect(mergeReleases(snapshot)).toEqual(snapshot);
  });
});
