import { countryOf } from '../tzcountry';

/**
 * Match recording for bot training (docs/RECORDING.md): the rules every part shares — the client's
 * consent and input logger, the module's `consent` reducer and `recorder_subjects` view, the recorder on
 * the Taipei VM, the ingest Worker, the processor and the export. No browser or server APIs here.
 */

/** The Terms version that announced match recording: soldiers who accepted an older one are never recorded. */
export const REC_TERMS_VERSION = 1;
/** The Terms version the current client shows next to Play. */
export const TERMS_VERSION = 1;
/** Version of the segment (`.tfr`) and input-log (`.til`) containers. */
export const REC_FORMAT = 1;
/** Version of the clean rules (`clean.ts`); quality records carry it, so a later version can recount. */
export const CLEAN_RULES = 'clean-v1' as const;
/** Version of the export rules (`export.ts`). */
export const EXPORT_RULES = 'export-v1' as const;

/** Why a player is left out of both datasets: their switch, their browser's signal, or the platform the game runs on. */
export type ExcludedBy = '' | 'setting' | 'gpc' | 'dnt' | 'platform';
export const EXCLUDED_BY: readonly ExcludedBy[] = ['', 'setting', 'gpc', 'dnt', 'platform'];
export const cleanExcludedBy = (by: string): ExcludedBy => (EXCLUDED_BY as readonly string[]).includes(by) ? by as ExcludedBy : 'setting';

/**
 * Countries whose players are left out of the export set (EU, EEA, UK and Switzerland), by the names
 * `shared/tzcountry.ts` gives and by ISO 3166 code (Cloudflare's `request.cf.country`).
 */
export const LEFT_OUT_COUNTRIES = new Set([
  'Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czechia', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece',
  'Hungary', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Poland', 'Portugal', 'Romania',
  'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Iceland', 'Liechtenstein', 'Norway', 'United Kingdom', 'Switzerland',
]);
export const LEFT_OUT_ISO = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO',
  'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
  // Territories that follow EU or UK law, and Cloudflare's "unknown".
  'GI', 'IM', 'JE', 'GG', 'AX', 'GF', 'GP', 'MQ', 'RE', 'YT', 'XX', 'T1',
]);

/** Whether a browser time zone puts a player in the left-out region; an empty or unknown zone counts as left out. */
export function leftOutZone(tz: string): boolean {
  const country = tz.trim() ? countryOf(tz) : 'Other';
  return country === 'Other' || LEFT_OUT_COUNTRIES.has(country);
}
/** The same for Cloudflare's country code; a missing code counts as left out. */
export const leftOutCountry = (iso: string | undefined | null) => !iso || LEFT_OUT_ISO.has(iso.toUpperCase());

/** A human soldier is a recording subject when they accepted the recording Terms and are not excluded. */
export interface ConsentState { termsVersion: number; excluded: boolean }
export const isSubject = (c: ConsentState | undefined) => !!c && c.termsVersion >= REC_TERMS_VERSION && !c.excluded;

/** Where recordings live in R2 (the bucket's key prefix): production and the `lawbreaker-dev` test data apart. */
export type RecEnv = 'tw' | 'dev';
export const recPrefix = (env: RecEnv) => (env === 'tw' ? 'v1' : 'dev/v1');

/**
 * Pseudonymous player id: HMAC-SHA256(salt, "turfwar:<env>:<identity hex>"), first 16 bytes in hex.
 * WebCrypto, so the recorder (Bun), the Worker and the scripts compute the same value.
 */
export async function pidOf(salt: string, env: RecEnv, identityHex: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(salt.trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`turfwar:${env}:${identityHex.toLowerCase().replace(/^0x/, '')}`)));
  return [...mac.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)));
}

/** UTC calendar date of an epoch-ms time, for key prefixes (`dt=`). The export keeps the Taipei date instead. */
export const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Days after which a recording is deleted (3 years). */
export const KEEP_DAYS = 3 * 365;
/** Days after which a recording with no usable seconds is deleted. */
export const UNUSABLE_KEEP_DAYS = 30;
