/**
 * What a client says about itself after connecting (the `hello` reducer): its IANA time zone and
 * browser language, kept per identity in the private `player_seen` table to answer "where are my
 * players from" without collecting IP addresses. Both are untrusted text: cleaned and capped here.
 */
export const HELLO_TZ_MAX = 64;
export const HELLO_LANG_MAX = 16;

/** Keep the characters an IANA zone ("America/Argentina/Buenos_Aires", "Etc/GMT+8") can contain. */
const cleanTz = (tz: unknown) => (typeof tz === 'string' ? tz.slice(0, 256).replace(/[^A-Za-z0-9/_+-]/g, '').slice(0, HELLO_TZ_MAX) : '');
/** Keep the characters a BCP 47 tag ("zh-TW", "en-US", "zh-Hant-TW") can contain. */
const cleanLang = (lang: unknown) => (typeof lang === 'string' ? lang.slice(0, 256).replace(/[^A-Za-z0-9-]/g, '').slice(0, HELLO_LANG_MAX) : '');

export function cleanHello(tz: unknown, lang: unknown): { tz: string; lang: string } {
  return { tz: cleanTz(tz), lang: cleanLang(lang) };
}
