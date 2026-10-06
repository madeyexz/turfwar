import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** The build's git short SHA (Vercel provides it; locally ask git), sent with analytics events. */
function appVersion() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'; } catch { return 'dev'; }
}

/** /admin without the trailing slash serves the admin page in the dev server too (Vercel rewrites it). */
const adminRoute: Plugin = {
  name: 'admin-route',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/admin' || req.url?.startsWith('/admin?')) req.url = `/admin/${req.url.slice(6)}`;
      next();
    });
  },
};

export default defineConfig({
  plugins: [adminRoute],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  server: {
    allowedHosts: true,
    // Same-origin websocket route to a local SpacetimeDB so one preview URL serves the game and the match server.
    proxy: { '/stdb': { target: 'http://127.0.0.1:3000', ws: true, rewrite: path => path.replace(/^\/stdb/, '') } },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      // The game, and the owner's admin dashboard at /admin (not linked from the game).
      input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin/index.html') },
      output: { manualChunks: { three: ['three'] } },
    },
  },
});
