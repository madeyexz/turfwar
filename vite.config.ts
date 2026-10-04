import { defineConfig } from 'vite';
import lawHandler from './api/law';

export default defineConfig({
  server: { allowedHosts: true },
  plugins: [{
    name: 'local-law-api',
    configureServer(server) {
      server.middlewares.use('/api/law', (req, res) => {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
          if (body.length > 4096) { res.statusCode = 413; res.end(); req.destroy(); }
        });
        req.on('end', () => {
          if (res.writableEnded) return;
          const response = {
            status(code: number) { res.statusCode = code; return response; },
            setHeader(name: string, value: string) { res.setHeader(name, value); },
            json(value: unknown) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); },
          };
          void lawHandler({ method: req.method, body }, response);
        });
      });
    },
  }],
  build: { rollupOptions: { output: { manualChunks: { physics: ['@dimforge/rapier3d-compat'], three: ['three'] } } } },
});
