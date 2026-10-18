import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { mergeReleases, parseReleaseLog, type Release } from './src/admin/releases';
import { sourcemaps } from './src/buildtools/sourcemaps';

/** The build's git short SHA (Vercel provides it; locally ask git), sent with analytics events. */
function appVersion() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'; } catch { return 'dev'; }
}

/**
 * The releases the admin page marks on its charts: the snapshot in src/admin/releases.json plus what
 * this checkout's git history shows of `main` (and HEAD) — Vercel clones shallowly, so the snapshot keeps
 * the older ones — plus the commit Vercel is building when it is itself a release.
 */
function releases(): Release[] {
  const snapshot = JSON.parse(readFileSync(resolve(__dirname, 'src/admin/releases.json'), 'utf8')) as Release[];
  const fromGit = ['main', 'HEAD'].flatMap(ref => {
    try { return parseReleaseLog(execSync(`git log ${ref} --first-parent --format=%h%x09%ct%x09%s --`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()); } catch { return []; }
  });
  const sha = process.env.VERCEL_GIT_COMMIT_SHA, message = process.env.VERCEL_GIT_COMMIT_MESSAGE;
  const building = sha && message ? parseReleaseLog(`${sha}\t${Math.floor(Date.now() / 1000)}\t${message.split('\n')[0]}`) : [];
  return mergeReleases(snapshot, fromGit, building);
}

/** The static pages for search and answer engines (docs/SEO.md): each at /<page> (繁體中文) and /en/<page> (English). */
const INFO_PAGES = ['about', 'guide', 'maps', 'begone'];

/**
 * /admin, /privacy and the info pages (/about, /en/about, …) without the trailing slash serve their pages in the dev server too
 * (Vercel rewrites them), and so do an invite link's /r/<code> and a challenge link's /c (src/game/challenge.ts).
 */
const pageRoutes: Plugin = {
  name: 'page-routes',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      for (const page of ['/admin', '/privacy', '/terms', ...INFO_PAGES.flatMap(p => [`/${p}`, `/en/${p}`])]) {
        if (req.url === page || req.url?.startsWith(`${page}?`)) req.url = `${page}/${req.url.slice(page.length)}`;
      }
      const invite = /^(?:\/r\/[A-Za-z]{4}|\/c)\/?(\?.*)?$/.exec(req.url ?? '');
      if (invite) req.url = `/index.html${invite[1] ?? ''}`;
      next();
    });
  },
};

/** Every file under `dir`, as paths relative to it with forward slashes. */
const filesIn = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? filesIn(full).map(f => `${name}/${f}`) : [name];
});
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex').slice(0, 12);

/**
 * `<!--preload:rajdhani-600,rajdhani-700-->` in a page's head becomes preload links for those fonts with the
 * versioned URLs the stylesheets ask for, so the font is already on its way when the first text paints
 * (the lobby's text is drawn by script, so without it the fetch starts late and the swap shifts the layout).
 */
const fontPreload: Plugin = {
  name: 'font-preload',
  transformIndexHtml: { order: 'pre', handler: html => html.replace(/<!--preload:([a-z0-9,-]+)-->/, (_, names: string) => names.split(',')
    .map(n => `<link rel="preload" as="font" type="font/woff2" crossorigin href="${versioned(`fonts/${n}.woff2`)}" />`).join('\n    ')) },
};

/**
 * `<!--preload:game-->` in the game page's head becomes early fetches for what the lobby waits for before
 * Play can start a match: the models (src/assets.ts) and the KTX2 transcoder, and in a build the game's
 * own script chunks (modulepreload: fetched and parsed, not run). Without them the downloads start only
 * after the scripts have run (on CrazyGames, after their SDK has started). Low priority, so the page's
 * scripts and fonts still come first. The surface textures depend on the quality preset and are not here.
 */
const GAME_PRELOADS = ['assets/weapons.glb', 'assets/props.glb', 'assets/soldier.glb', 'assets/guns.glb', 'assets/soldiers.glb', 'assets/soldier-anims.glb',
  'assets/basis/basis_transcoder.js', 'assets/basis/basis_transcoder.wasm'];
const gamePreload: Plugin = {
  name: 'game-preload',
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      if (!html.includes('<!--preload:game-->')) return html;
      const files = GAME_PRELOADS.map(f => `<link rel="preload" as="fetch" crossorigin fetchpriority="low" href="${versioned(f)}" />`);
      // The game's chunk (bootstrap.ts imports it on its own), the SDK's (the lobby's connection) and the KTX2
      // loader's, each with the chunks it imports.
      const chunks = Object.values(ctx.bundle ?? {}).flatMap(c => (c.type === 'chunk' ? [c] : []));
      const wanted = ['/src/main.ts', '/src/module_bindings/index.ts', '/three/examples/jsm/loaders/KTX2Loader.js'];
      const scripts = [...new Set(chunks.filter(c => c.moduleIds.some(id => wanted.some(w => id.endsWith(w)))).flatMap(c => [c.fileName, ...c.imports]))]
        .filter(f => !html.includes(f));
      const base = crazygames ? './' : '/';
      return html.replace('<!--preload:game-->', [...scripts.map(f => `<link rel="modulepreload" crossorigin href="${base}${f}" />`), ...files].join('\n    '));
    },
  },
};

/**
 * The public/ files the service worker caches as static assets (models, textures, sounds, fonts, the
 * map pictures), each with its content hash. The game asks for `<file>?v=<hash>` (src/assetUrl.ts, and
 * the stylesheets' url()s below), so one URL always means the same bytes: browsers keep it for good
 * (vercel.json) and a release that changes one file has players fetch only that file.
 */
const publicDir = resolve(__dirname, 'public');
const VERSIONS: Record<string, string> = Object.fromEntries(filesIn(publicDir).filter(f => /^(assets|fonts|media\/maps)\//.test(f)).sort()
  .map(f => [f, hash(readFileSync(join(publicDir, f)))]));
/**
 * The CrazyGames build (`vite build --mode crazygames`, `bun run build:crazygames`): the game page alone, uploaded to
 * CrazyGames and served from their CDN under a path we do not know, so every URL is relative (`base: './'`),
 * with no service worker, no info/privacy/admin pages and no search metadata. Set before any plugin hook runs.
 */
let crazygames = false;
/** A public/ file's URL with its version, from the site root (or, in the CrazyGames build, from the page). */
const versioned = (file: string) => `${crazygames ? '' : '/'}${file}${VERSIONS[file] ? `?v=${VERSIONS[file]}` : ''}`;

/** Stylesheets' `url(/fonts/…)` and the like get their file's version too. */
const versionedCssUrls: Plugin = {
  name: 'versioned-css-urls',
  enforce: 'pre',
  transform(code, id) {
    if (!/\.css($|\?)/.test(id)) return;
    // The CrazyGames build's stylesheets sit in assets/, so a public/ file is one folder up.
    return code.replace(/url\((['"]?)\/([^'")?#]+)\1\)/g, (all, quote: string, file: string) => VERSIONS[file] ? `url(${quote}${crazygames ? '../' : ''}${versioned(file)}${quote})` : all);
  },
};

/**
 * The service worker (src/pwa/sw.ts → dist/sw.js) gets this build's file list with the shell's
 * version (this build's hashed files, so every release replaces it) and the static assets' current
 * URLs (each with its content version, so it keeps the files that did not change).
 */
const pwa: Plugin = {
  name: 'pwa-service-worker',
  apply: (_, env) => env.command === 'build' && env.mode !== 'crazygames',
  writeBundle(options, bundle) {
    // The info pages are for search engines and links: the game does not need them offline.
    const info = new RegExp(`^(en/)?(${INFO_PAGES.join('|')})/`);
    const built = Object.keys(bundle).filter(f => f !== 'sw.js' && !f.startsWith('admin') && !f.includes('/admin') && !info.test(f) && !f.endsWith('.map'));
    const pub = filesIn(publicDir).sort();
    // Precached: the page, this build's scripts and styles, the manifest, the small icons and the Latin fonts
    // (the 512 px icons are only for installing, and the browser fetches them then).
    const shell = [...built.map(f => `/${f}`), ...pub.filter(f => f === 'manifest.webmanifest' || (f.startsWith('icons/') && !f.includes('512')) || /^fonts\/rajdhani-\d+\.woff2$/.test(f)).map(versioned)].sort();
    const data = { shell, shellVersion: `${appVersion()}-${hash(built.sort().join('|'))}`, assets: Object.keys(VERSIONS).map(versioned) };
    const file = join(options.dir!, 'sw.js');
    const code = readFileSync(file, 'utf8');
    const filled = code.replace(/(["'`])__TURFWAR_BUILD__\1/, JSON.stringify(JSON.stringify(data)));
    if (filled === code) throw new Error('sw.js: the build placeholder is missing');
    writeFileSync(file, filled);
  },
};

/**
 * The CrazyGames page: their SDK script first in the head (docs.crazygames.com/sdk/intro), relative icon links,
 * and none of the site's search and link-preview metadata (canonical, Open Graph, JSON-LD, the web app manifest).
 */
const crazygamesPage: Plugin = {
  name: 'crazygames-page',
  apply: (_, env) => env.mode === 'crazygames',
  transformIndexHtml: { order: 'pre', handler: html => html
    .replace(/\s*<link rel="(canonical|manifest|apple-touch-icon)"[^>]*>/g, '')
    .replace(/\s*<meta (property="og:|name="twitter:|name="robots"|name="apple-mobile-web-app-|name="mobile-web-app-)[^>]*>/g, '')
    .replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/, '')
    .replace(/<noscript>[\s\S]*?<\/noscript>/, '')
    .replace(/href="\/icons\//g, 'href="icons/')
    .replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" />\n    <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>') },
};

/** The public/ files only the website serves (search, link previews, the installable app), left out of the CrazyGames upload. */
const crazygamesPrune: Plugin = {
  name: 'crazygames-prune',
  apply: (_, env) => env.command === 'build' && env.mode === 'crazygames',
  writeBundle(options) {
    for (const f of readdirSync(options.dir!)) {
      if (/^(og|robots\.txt|sitemap\.xml|llms.*\.txt|manifest\.webmanifest|[0-9a-f]{32}\.txt)$/.test(f)) rmSync(join(options.dir!, f), { recursive: true });
    }
  },
};

/**
 * The CrazyGames zip is built on a Mac, not on Vercel, so nothing else supplies the production values: without them
 * the upload connects to no server and sends no analytics (src/analytics.ts is a silent no-op without a key).
 * Stop that build instead. Read from the environment, `.env.crazygames.local` or the other files Vite loads for the mode.
 */
function requireCrazygamesEnv(mode: string) {
  const env = loadEnv(mode, __dirname, 'VITE_');
  const problems = [
    !env.VITE_POSTHOG_KEY?.startsWith('phc_') && 'VITE_POSTHOG_KEY (the public phc_… project key)',
    !env.VITE_POSTHOG_HOST && 'VITE_POSTHOG_HOST (https://us.i.posthog.com)',
    !env.VITE_SPACETIMEDB_URI?.startsWith('wss://') && 'VITE_SPACETIMEDB_URI (a wss:// URI; CrazyGames has no same-origin proxy)',
    !env.VITE_SPACETIMEDB_DATABASE && 'VITE_SPACETIMEDB_DATABASE',
  ].filter(Boolean);
  if (problems.length) throw new Error(`The CrazyGames build needs the production values. Missing or wrong: ${problems.join(', ')}. Put them in .env.crazygames.local (docs/DEVELOPMENT.md, "CrazyGames build").`);
}

export default defineConfig(({ command, mode }) => {
  crazygames = mode === 'crazygames';
  if (crazygames && command === 'build') requireCrazygamesEnv(mode);
  return {
    base: crazygames ? './' : '/',
    plugins: [pageRoutes, versionedCssUrls, fontPreload, gamePreload, crazygamesPage, crazygamesPrune, pwa, sourcemaps(appVersion())],
    define: { __APP_VERSION__: JSON.stringify(appVersion()), __ASSET_VERSIONS__: JSON.stringify(VERSIONS), __RELEASES__: JSON.stringify(releases()) },
    server: {
      allowedHosts: true,
      // Same-origin websocket route to a local SpacetimeDB so one preview URL serves the game and the match server
      // (port 3000 unless STDB_PROXY_TARGET names another, e.g. a throwaway server for a cold-start test).
      proxy: { '/stdb': { target: process.env.STDB_PROXY_TARGET || 'http://127.0.0.1:3000', ws: true, rewrite: path => path.replace(/^\/stdb/, '') } },
    },
    build: {
      outDir: crazygames ? 'dist-crazygames' : 'dist',
      // Hidden: maps are written but not linked from the scripts; src/buildtools/sourcemaps.ts uploads them to PostHog (when its env vars are set) and deletes them from dist.
      sourcemap: 'hidden',
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        // The game, the privacy notice at /privacy, the info pages (/about, /guide, /maps, /begone in 繁體中文 and under /en/ in English; static text for search and answer engines, docs/SEO.md), the owner's admin dashboard at /admin (not linked from the game) and the service worker at /sw.js.
        input: crazygames ? { main: resolve(__dirname, 'index.html') } : {
          main: resolve(__dirname, 'index.html'), privacy: resolve(__dirname, 'privacy/index.html'), terms: resolve(__dirname, 'terms/index.html'),
          ...Object.fromEntries(INFO_PAGES.flatMap(p => [[p, resolve(__dirname, `${p}/index.html`)], [`${p}En`, resolve(__dirname, `en/${p}/index.html`)]])),
          admin: resolve(__dirname, 'admin/index.html'), sw: resolve(__dirname, 'src/pwa/sw.ts'),
        },
        output: { manualChunks: { three: ['three'] }, entryFileNames: chunk => chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js' },
      },
    },
  };
});
