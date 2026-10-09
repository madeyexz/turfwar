/**
 * Releases on the admin page's charts (pure, for tests and for vite.config.ts). A release is a
 * first-parent commit on `main` whose subject starts with "Release" (docs/DEVELOPMENT.md, Deploy).
 * The build reads them from git (`git log --first-parent --format=%h%x09%ct%x09%s`) and adds the
 * snapshot in `releases.json` (`bun scripts/releases.ts` refreshes it), because Vercel's clone is
 * shallow: git there only sees the latest few.
 */
export interface Release { sha: string; at: number; title: string }

/** Releases in `git log --format=%h%x09%ct%x09%s` output (`at` in Unix seconds), with "Release:" taken off the title. */
export function parseReleaseLog(log: string): Release[] {
  const out: Release[] = [];
  for (const line of log.split('\n')) {
    const [sha, at, ...rest] = line.split('\t');
    const subject = rest.join('\t');
    if (!sha || !/^\d+$/.test(at ?? '') || !/^Release\b/.test(subject)) continue;
    out.push({ sha: sha.slice(0, 7), at: Number(at), title: subject.replace(/^Release\b:?\s*/, '') || 'Release' });
  }
  return out;
}

/** Every release once (by short SHA), oldest first. */
export function mergeReleases(...lists: Release[][]): Release[] {
  const bySha = new Map<string, Release>();
  for (const list of lists) for (const r of list) if (!bySha.has(r.sha.slice(0, 7))) bySha.set(r.sha.slice(0, 7), { ...r, sha: r.sha.slice(0, 7) });
  return [...bySha.values()].sort((a, b) => a.at - b.at);
}

/** Releases per UTC day number (or per hour since the epoch, with `unit` 3600), for `from` to `to` (inclusive), each one's in order. */
export function releasesByDay(releases: readonly Release[], from: number, to: number, unit = 86_400): Map<number, Release[]> {
  const out = new Map<number, Release[]>();
  for (const r of releases) {
    const day = Math.floor(r.at / unit);
    if (day < from || day > to) continue;
    let list = out.get(day);
    if (!list) out.set(day, (list = []));
    list.push(r);
  }
  return out;
}

/** A marker's tooltip: the day (or hour, with `unit` 3600), how many releases, and their titles (times in UTC). */
export function releaseTitle(day: number, releases: readonly Release[], unit = 86_400): string {
  const date = new Date(day * unit * 1000).toISOString().slice(0, unit < 86_400 ? 16 : 10).replace('T', ' ');
  const lines = releases.map(r => `• ${new Date(r.at * 1000).toISOString().slice(11, 16)} ${r.title}`);
  return `${date}: ${releases.length} release${releases.length === 1 ? '' : 's'} (UTC)\n${lines.join('\n')}`;
}
