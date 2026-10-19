/**
 * The asset CDN: the game's versioned public/ files (models, textures, sounds, fonts, the map pictures)
 * served by Cloudflare at cdn.turfwar.ianhsiao.me, not by Vercel, whose free plan counts every request
 * and byte (a launch week used most of a month's allowance). It is a Worker with static assets only:
 * Cloudflare does not charge or limit requests to those.
 *
 * A file is at `/<version>/<path>` (its content hash, the `?v=` of src/assetUrl.ts), so one URL is always
 * the same bytes, and the dev and production builds share one CDN. `bun run cdn:deploy`
 * (deploy/cloudflare/cdn/deploy.ts) adds this checkout's files and keeps the ones it deployed before
 * (`index.json` lists them), so a page left open over a release still finds its files.
 *
 * The website build reads that index and links each file it lists to the CDN. A file the CDN does not
 * hold yet (an asset changed and the CDN was not deployed) stays on the site, so the CDN never breaks a
 * build: it only makes it cost more.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const CDN_ORIGIN = 'https://cdn.turfwar.ianhsiao.me';
/** The CDN's list of its files: `{ files: { "<version>/<path>": "<date added, YYYY-MM-DD>" } }`. */
export const CDN_INDEX = 'index.json';
export interface CdnIndex { files: Record<string, string> }

/** A file's place on the CDN. */
export const cdnKey = (file: string, version: string) => `${version}/${file}`;

/** Every file under `dir`, as paths relative to it with forward slashes. */
export const filesIn = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? filesIn(full).map(f => `${name}/${f}`) : [name];
});
export const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex').slice(0, 12);

/** The public/ files that get a content version (and go to the CDN), each with its version. */
export const assetVersions = (publicDir: string): Record<string, string> => Object.fromEntries(
  filesIn(publicDir).filter(f => /^(assets|fonts|media\/maps)\//.test(f)).sort().map(f => [f, hash(readFileSync(join(publicDir, f)))]));

/**
 * The CDN a build links to: `ASSET_CDN` when set (an origin, or `off`), else the CDN for the builds on
 * Vercel and none for local ones (the dev server and `bun run build` serve everything themselves).
 */
export function cdnOrigin(env: Record<string, string | undefined>) {
  const set = env.ASSET_CDN?.trim();
  if (set !== undefined && set !== '') return set === 'off' ? '' : set.replace(/\/+$/, '');
  return env.VERCEL ? CDN_ORIGIN : '';
}

/** What the CDN holds, or undefined when it cannot be read (not deployed yet, offline). */
export async function fetchCdnIndex(origin: string): Promise<CdnIndex | undefined> {
  try {
    const res = await fetch(`${origin}/${CDN_INDEX}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return undefined;
    const index = await res.json() as CdnIndex;
    return index && typeof index.files === 'object' ? index : undefined;
  } catch {
    return undefined;
  }
}
