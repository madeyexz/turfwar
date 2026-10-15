/**
 * Build and deploy the recording ingest Worker (docs/DEVELOPMENT.md "Recording"):
 *
 *   bun deploy/cloudflare/rec-ingest/deploy.ts [--dry-run]
 *
 * Needs CLOUDFLARE_API_TOKEN (Workers Scripts Edit, Zone DNS Edit + Workers Routes Edit on ianhsiao.me),
 * CLOUDFLARE_ACCOUNT_ID, REC_SALT and TURFWAR_ADMIN_KEY (only its sha256 goes to Cloudflare). Uploads the
 * script with its R2 binding and secrets, turns the workers.dev address off, and attaches the custom
 * domain rec.turfwar.ianhsiao.me (Cloudflare makes its DNS record). Prints statuses, never values.
 */
import { sha256Hex } from '../../../shared/rec/policy';

const NAME = 'turfwar-rec-ingest';
const HOST = 'rec.turfwar.ianhsiao.me';
const ZONE = 'ianhsiao.me';
const BUCKET = 'turfwar-rec';
const dry = process.argv.includes('--dry-run');

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v.trim(); };
const token = need('CLOUDFLARE_API_TOKEN'), account = need('CLOUDFLARE_ACCOUNT_ID');
const salt = need('REC_SALT'), adminHash = await sha256Hex(need('TURFWAR_ADMIN_KEY'));

const built = await Bun.build({ entrypoints: [new URL('./src/index.ts', import.meta.url).pathname], target: 'browser', format: 'esm', minify: true });
if (!built.success) throw new Error(built.logs.join('\n'));
const code = await built.outputs[0].text();
console.log(`built ${code.length} bytes`);
if (dry) process.exit(0);

async function cf(method: string, path: string, body?: BodyInit, json = true) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method, body, headers: { Authorization: `Bearer ${token}`, ...(json && body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const out = await res.json() as { success: boolean; errors?: { code: number; message: string }[]; result?: unknown };
  console.log(`${method} ${path.replace(account, '<account>')} → ${res.status}${out.success ? '' : ` ${JSON.stringify(out.errors)}`}`);
  if (!out.success) throw new Error('Cloudflare API call failed');
  return out.result;
}

const form = new FormData();
form.append('metadata', JSON.stringify({
  main_module: 'index.js',
  compatibility_date: '2026-10-01',
  bindings: [
    { type: 'r2_bucket', name: 'REC', bucket_name: BUCKET },
    { type: 'secret_text', name: 'REC_SALT', text: salt },
    { type: 'secret_text', name: 'ADMIN_KEY_SHA256', text: adminHash },
  ],
  observability: { enabled: true },
}));
form.append('index.js', new Blob([code], { type: 'application/javascript+module' }), 'index.js');
await cf('PUT', `/accounts/${account}/workers/scripts/${NAME}`, form, false);
await cf('POST', `/accounts/${account}/workers/scripts/${NAME}/subdomain`, JSON.stringify({ enabled: false }));

const zones = await cf('GET', `/zones?name=${ZONE}`) as { id: string }[];
await cf('PUT', `/accounts/${account}/workers/domains`, JSON.stringify({ hostname: HOST, service: NAME, zone_id: zones[0].id, environment: 'production' }));
console.log(`deployed ${NAME} at https://${HOST}`);
