/**
 * Deploy the asset CDN (src/buildtools/assetcdn.ts, docs/DEVELOPMENT.md "Asset CDN"):
 *
 *   bun run cdn:deploy [--dry-run]
 *
 * Needs CLOUDFLARE_API_TOKEN (Workers Scripts Edit, Workers Routes Edit and Zone DNS Edit on ianhsiao.me)
 * and CLOUDFLARE_ACCOUNT_ID. Run it before pushing a commit that adds or changes a file in public/assets,
 * public/fonts or public/media/maps; the build links a file it does not find there to the site instead.
 *
 * Collects this checkout's versioned files at /<version>/<path>, keeps every file the live CDN lists
 * (fetched back from it: a deployed build may still link to it, whichever branch it came from, and only
 * changed files add up), writes index.json and the headers,
 * and deploys them with Wrangler as the Worker `turfwar-cdn` (static assets only, no script) on the custom
 * domain cdn.turfwar.ianhsiao.me. `--dry-run` stops before the upload and prints what it would send.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CDN_INDEX, CDN_ORIGIN, assetVersions, cdnKey, fetchCdnIndex, type CdnIndex } from '../../../src/buildtools/assetcdn';

const NAME = 'turfwar-cdn';
const HOST = new URL(CDN_ORIGIN).host;
/** Wrangler, pinned so a deploy never depends on what is newest. */
const WRANGLER = 'wrangler@4.151.1';
const dry = process.argv.includes('--dry-run');

const root = resolve(import.meta.dir, '../../..');
const out = resolve(import.meta.dir, '.out'), site = join(out, 'public');
const today = new Date().toISOString().slice(0, 10);

if (!dry) for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) if (!process.env[k]?.trim()) throw new Error(`${k} is not set`);

const versions = assetVersions(join(root, 'public'));
const live = await fetchCdnIndex(CDN_ORIGIN);
console.log(live ? `live CDN lists ${Object.keys(live.files).length} files` : 'live CDN has no index (first deploy)');

rmSync(out, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
const index: CdnIndex = { files: {} };
const put = (key: string) => { const path = join(site, key); mkdirSync(dirname(path), { recursive: true }); return path; };

for (const [file, version] of Object.entries(versions)) {
  const key = cdnKey(file, version);
  copyFileSync(join(root, 'public', file), put(key));
  index.files[key] = live?.files[key] ?? today;
}
const current = Object.keys(index.files).length;

let kept = 0;
for (const [key, added] of Object.entries(live?.files ?? {})) {
  if (index.files[key]) continue;
  const res = await fetch(`${CDN_ORIGIN}/${key}`).catch(() => undefined);
  if (!res?.ok) throw new Error(`${key} is in the live index but could not be fetched (${res?.status ?? 'network error'}); not deploying without it`);
  writeFileSync(put(key), new Uint8Array(await res.arrayBuffer()));
  index.files[key] = added;
  kept++;
}
console.log(`${current} current files, ${kept} older ones kept`);

writeFileSync(join(site, CDN_INDEX), JSON.stringify(index));
// Every file is versioned by its path, so it never changes; any page may load it (models, textures and
// fonts are fetched with CORS). The index is read by builds and this script, so it is never cached.
writeFileSync(join(site, '_headers'), `/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=31536000, immutable
  X-Content-Type-Options: nosniff
  X-Robots-Tag: noindex

/${CDN_INDEX}
  ! Cache-Control
  Cache-Control: no-cache
`);
writeFileSync(join(out, 'wrangler.json'), JSON.stringify({
  name: NAME,
  compatibility_date: '2026-10-01',
  assets: { directory: './public', html_handling: 'none', not_found_handling: 'none' },
  routes: [{ pattern: HOST, custom_domain: true }],
  workers_dev: false,
  preview_urls: false,
}, null, 2));

if (dry) { console.log(`dry run: would deploy ${out} as ${NAME} on ${HOST}`); process.exit(0); }
const run = spawnSync('bunx', [WRANGLER, 'deploy', '--config', join(out, 'wrangler.json')], { cwd: out, stdio: 'inherit' });
if (run.status !== 0) throw new Error(`wrangler deploy failed (${run.status})`);

const check = await fetchCdnIndex(CDN_ORIGIN);
const missing = Object.keys(index.files).filter(k => !check?.files[k]).length;
console.log(missing ? `deployed, but the live index lacks ${missing} files yet (it can take a minute)` : `deployed: ${CDN_ORIGIN} serves ${Object.keys(index.files).length} files`);
