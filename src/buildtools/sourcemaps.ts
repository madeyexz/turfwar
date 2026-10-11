/**
 * Source maps for error tracking, from the build. `vite build` writes hidden maps (no `sourceMappingURL`
 * comment), and the plugin below, after the bundle is written:
 *
 * 1. when `POSTHOG_CLI_API_KEY` and `POSTHOG_CLI_PROJECT_ID` are both set, runs the PostHog CLI's
 *    `sourcemap process`, which writes a chunk id into every script and uploads the maps, tagged with
 *    this build's `app_version` (the git SHA that analytics events carry), so PostHog can show the original
 *    source lines for a minified stack;
 * 2. whatever happens, deletes every `.map` from the output, so the maps are never served publicly.
 *
 * Without the variables (local builds, previews without the key, forks) nothing is uploaded and nothing
 * is printed; a failed upload warns in one line (the key never printed) and the build carries on.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** The CLI's version, pinned so a build never depends on what is newest. */
export const POSTHOG_CLI = '@posthog/cli@0.18.10';
/** The release name the maps are filed under in PostHog (the version is the build's git SHA). */
export const RELEASE_NAME = 'turfwar';

type Env = Record<string, string | undefined>;

/** Whether this build should upload: both variables present and not empty. */
export const uploadEnabled = (env: Env) => !!env.POSTHOG_CLI_API_KEY?.trim() && !!env.POSTHOG_CLI_PROJECT_ID?.trim();

/** The CLI's arguments for a build directory and version. */
export const cliArgs = (dir: string, version: string) => [
  'sourcemap', 'process', '--directory', dir, '--release-name', RELEASE_NAME, '--release-version', version, '--delete-after',
];

/** Text with the API key, the project id and the host removed (the CLI's output goes to a build log). */
export function redact(text: string, env: Env) {
  let out = text;
  for (const secret of [env.POSTHOG_CLI_API_KEY, env.POSTHOG_CLI_PROJECT_ID, env.POSTHOG_CLI_TOKEN]) if (secret?.trim()) out = out.split(secret.trim()).join('[redacted]');
  return out.replace(/phx_[A-Za-z0-9]+/g, '[redacted]');
}

/** Every file under `dir` ending in `.map`, as full paths. */
function mapsIn(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? mapsIn(full) : name.endsWith('.map') ? [full] : [];
  });
}

/** Delete the source maps under `dir` (they must not be served); returns how many. */
export function removeMaps(dir: string) {
  if (!existsSync(dir)) return 0;
  const maps = mapsIn(dir);
  for (const map of maps) rmSync(map, { force: true });
  return maps.length;
}

/** Use the repository's package runner only. */
const RUNNERS: [string, string[]][] = [['bunx', []]];

/** Run the upload; returns a one-line problem, or undefined on success. Never throws. */
export function upload(dir: string, version: string, env: Env = process.env): string | undefined {
  let problem = 'bunx unavailable';
  for (const [bin, pre] of RUNNERS) {
    try {
      const run = spawnSync(bin, [...pre, POSTHOG_CLI, ...cliArgs(dir, version)], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 180_000 });
      if (run.error) { problem = `${bin}: ${redact(run.error.message, env)}`; continue; }
      if (run.status === 0) return undefined;
      const tail = redact(`${run.stderr || run.stdout}`.trim().split('\n').slice(-2).join(' | '), env).slice(0, 300);
      return `exit ${run.status}: ${tail}`;
    } catch (error) { problem = redact(String((error as Error).message), env); }
  }
  return problem;
}

/** The Vite plugin: after a production build, upload the maps (when configured) and delete them. */
export function sourcemaps(version: string): Plugin {
  let outDir = 'dist';
  return {
    name: 'turfwar-sourcemaps',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { outDir = config.build.outDir; },
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        try {
          if (uploadEnabled(process.env)) {
            const problem = upload(outDir, version);
            if (problem) console.warn(`[sourcemaps] upload to PostHog failed (${problem}); the build continues without resolved stacks`);
            else console.log(`[sourcemaps] uploaded for ${RELEASE_NAME}@${version}`);
          }
        } finally {
          // Fail closed if cleanup fails: a successful deployment must never contain maps.
          removeMaps(outDir);
        }
      },
    },
  };
}
