/**
 * Refresh src/admin/releases.json, the snapshot of releases the admin page marks on its charts, from
 * the first-parent history of `main` (or the ref given). The build adds whatever its own git history
 * shows (shallow on Vercel), so run this now and then on `dev`, e.g. after a release, and commit it.
 *
 *   bun scripts/releases.ts            # from main
 *   bun scripts/releases.ts origin/main
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeReleases, parseReleaseLog, type Release } from '../src/admin/releases';

const ref = process.argv[2] ?? 'main';
const file = resolve(import.meta.dir, '../src/admin/releases.json');
const log = execFileSync('git', ['log', ref, '--first-parent', '--format=%h%x09%ct%x09%s'], { encoding: 'utf8' });
const old = JSON.parse(readFileSync(file, 'utf8')) as Release[];
const all = mergeReleases(old, parseReleaseLog(log));
writeFileSync(file, `[\n${all.map(r => `  ${JSON.stringify(r)}`).join(',\n')}\n]\n`);
console.log(`${all.length} releases (${all.length - old.length} new) in src/admin/releases.json`);
