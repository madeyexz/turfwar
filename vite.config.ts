import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** The build's git short SHA (Vercel provides it; locally ask git), sent with analytics events. */
function appVersion() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'; } catch { return 'dev'; }
}

/** /admin and /privacy without the trailing slash serve their pages in the dev server too (Vercel rewrites them). */
const pageRoutes: Plugin = {
  name: 'page-routes',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      for (const page of ['/admin', '/privacy']) {
        if (req.url === page || req.url?.startsWith(`${page}?`)) req.url = `${page}/${req.url.slice(page.length)}`;
      }
      next();
    });
  },
};

/** Every file under `dir`, as paths relative to it with forward slashes. */
const filesIn = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? filesIn(full).map(f => `${name}/${f}`) : [name];
});
const hash = (data: string) => createHash('sha256').update(data).digest('hex').slice(0, 12);

/**
 * The service worker (src/pwa/sw.ts → dist/sw.js) gets this build's file list and two versions:
 * the shell's (this build's hashed files, so every release replaces it) and the static assets'
 * (a hash of public/, so models and textures are downloaded again only when they change).
 */
const pwa: Plugin = {
  name: 'pwa-service-worker',
  apply: 'build',
  writeBundle(options, bundle) {
    const built = Object.keys(bundle).filter(f => f !== 'sw.js' && !f.startsWith('admin') && !f.includes('/admin') && !f.endsWith('.map'));
    const publicDir = resolve(__dirname, 'public');
    const pub = filesIn(publicDir).sort();
    // Precached: the page, this build's scripts and styles, the manifest, the icons and the Latin fonts.
    const shell = [...built, ...pub.filter(f => f === 'manifest.webmanifest' || f.startsWith('icons/') || /^fonts\/rajdhani-\d+\.woff2$/.test(f))].map(f => `/${f}`).sort();
    const assets = createHash('sha256');
    for (const f of pub) assets.update(f).update(readFileSync(join(publicDir, f)));
    const data = { shell, shellVersion: `${appVersion()}-${hash(built.sort().join('|'))}`, staticVersion: assets.digest('hex').slice(0, 12) };
    const file = join(options.dir!, 'sw.js');
    const code = readFileSync(file, 'utf8');
    const filled = code.replace(/(["'`])__TURFWAR_BUILD__\1/, JSON.stringify(JSON.stringify(data)));
    if (filled === code) throw new Error('sw.js: the build placeholder is missing');
    writeFileSync(file, filled);
  },
};

export default defineConfig({
  plugins: [pageRoutes, pwa],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  server: {
    allowedHosts: true,
    // Same-origin websocket route to a local SpacetimeDB so one preview URL serves the game and the match server.
    proxy: { '/stdb': { target: 'http://127.0.0.1:3000', ws: true, rewrite: path => path.replace(/^\/stdb/, '') } },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      // The game, the privacy notice at /privacy, the owner's admin dashboard at /admin (not linked from the game) and the service worker at /sw.js.
      input: { main: resolve(__dirname, 'index.html'), privacy: resolve(__dirname, 'privacy/index.html'), admin: resolve(__dirname, 'admin/index.html'), sw: resolve(__dirname, 'src/pwa/sw.ts') },
      output: { manualChunks: { three: ['three'] }, entryFileNames: chunk => chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js' },
    },
  },
});
