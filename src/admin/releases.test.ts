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

  it('groups at midnight Taipei and formats daily and epoch-hour markers in Taipei', () => {
    const list = [{ sha: '1', at: 10 * DAY + 16 * 3600 - 1, title: 'one' }, { sha: '2', at: 10 * DAY + 16 * 3600, title: 'two' }, { sha: '3', at: 11 * DAY, title: 'three' }, { sha: '4', at: 3 * DAY, title: 'old' }];
    const byDay = releasesByDay(list, 10, 11);
    expect([...byDay.keys()]).toEqual([10, 11]);
    expect(byDay.get(10)!.map(r => r.title)).toEqual(['one']);
    expect(byDay.get(11)!.map(r => r.title)).toEqual(['two', 'three']);
    expect(releaseTitle(10, byDay.get(10)!)).toBe('1970-01-11: 1 release (Taipei, UTC+8)\n• 23:59 one');
    expect(releaseTitle(11, byDay.get(11)!)).toBe('1970-01-12: 2 releases (Taipei, UTC+8)\n• 00:00 two\n• 08:00 three');
    const byHour = releasesByDay(list, 255, 256, 3600);
    expect([...byHour.keys()]).toEqual([255, 256]);
    expect(releaseTitle(256, byHour.get(256)!, 3600)).toBe('1970-01-12 00:00: 1 release (Taipei, UTC+8)\n• 00:00 two');
    expect([...releasesByDay(list, 11, 11).keys()]).toEqual([11]);
  });

  it('keeps a well-formed snapshot', () => {
    expect(snapshot.length).toBeGreaterThan(0);
    for (const r of snapshot) expect(r).toMatchObject({ sha: expect.stringMatching(/^[0-9a-f]{7}$/), at: expect.any(Number), title: expect.any(String) });
    expect(mergeReleases(snapshot)).toEqual(snapshot);
  });
});
