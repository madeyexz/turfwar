/**
 * UTM tagging for links we hand out (the share card, challenge and duel links, docs). Pairs with
 * src/visit.ts, which reads the tags back on the other side. `docs/UTM.md` has the naming rules.
 */
export interface Utm {
  /** The channel: one value per channel (`threads`, `bahamut`, `line`, `share`, `challenge`…). */
  source: string;
  /** How it was posted: `post`, `comment`, `bio`, `dm`, `video`, `share` (docs/UTM.md), or `end_screen` / `share_card` / `duel` for links the game makes. */
  medium?: string;
  /** The specific post, date or feature, e.g. `launch-2026-10`. */
  campaign?: string;
  content?: string;
  term?: string;
}

/**
 * `url` with UTM parameters added. Existing parameters (a room code, a challenge's `c`, `ref`…) keep
 * their values and order; a `utm_*` the URL already has is kept unless `overwrite` is set. Relative
 * URLs (`/?room=ABCD`) stay relative. The fragment is kept; a value that is empty is left out.
 */
export function withUtm(url: string, utm: Utm, overwrite = false): string {
  const base = 'https://x.invalid';
  const u = new URL(url, base);
  const tags: [string, string | undefined][] = [['utm_source', utm.source], ['utm_medium', utm.medium], ['utm_campaign', utm.campaign], ['utm_content', utm.content], ['utm_term', utm.term]];
  for (const [k, v] of tags) {
    if (!v?.trim()) continue;
    if (overwrite) u.searchParams.set(k, v.trim());
    else if (!u.searchParams.has(k)) u.searchParams.append(k, v.trim());
  }
  const out = u.toString();
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return out;
  return url.startsWith('//') ? out.replace(/^https:/, '') : out.slice(base.length);
}
