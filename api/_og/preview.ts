/**
 * Link previews for the links players send (LINE, Threads, Messenger, Discord…): what a 發起單挑 link
 * (`/c?ch=…&map=…&beat=…`) or an invite link (`/r/<code>`) says about itself, read the way the game
 * reads it (src/game/challenge.ts; kept separate so the preview function stays small), and the little page
 * a link-preview crawler is served (`api/preview.ts`) with its picture (`api/og.ts`). Everything here
 * comes from the URL, so it is cleaned and escaped.
 */

export type Preview = { kind: 'duel'; name: string; map?: string; beat?: number } | { kind: 'invite'; room: string };

/** Maps with a backdrop in `api/_og/maps` (the ones whose art is public), by their 繁體中文 names (src/ui/i18n.ts MAPS_ZH). */
export const MAP_NAMES: Record<string, string> = {
  citadel: '山城要塞', memorial: '中正紀念堂', meridian: '子午線街區', ochre: '赭石舊城', pipeline: '輸油管', railyard: '鐵道貨場',
  sanchong: '三重', skyline: '天際屋頂', taipei: '西門町', taipei101: '台北101・88F', timbertown: '伐木鎮', warehouse: '倉庫', xinyi: '台北101・信義',
};

/** Callsigns as the game cleans them: letters, digits, space, _ - . (at most 16). */
const cleanName = (s: string) => s.replace(/[^\p{L}\p{N} _\-.]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);

/** The preview a link's address asks for, or undefined (an address the game would not read as a challenge or invite). */
export function previewOf(url: URL): Preview | undefined {
  const invite = /^\/r\/([A-Za-z]{4})\/?$/.exec(url.pathname);
  if (invite) return { kind: 'invite', room: invite[1].toUpperCase().replace(/[^A-Z]/g, '') };
  const p = url.searchParams;
  if (!/^\/c\/?$/.test(url.pathname) && !(url.pathname === '/' && p.has('c'))) return undefined;
  const name = cleanName(p.get('ch') ?? '');
  if (!name) return undefined;
  const map = p.get('map') ?? '', beat = Number(p.get('beat'));
  return {
    kind: 'duel', name,
    ...(MAP_NAMES[map] ? { map } : {}),
    ...(p.has('beat') && Number.isInteger(beat) && beat >= 0 && beat <= 999 ? { beat } : {}),
  };
}

/** The preview's title and description (繁體中文: the players who share are in Taiwan). */
export function previewText(p: Preview): { title: string; description: string } {
  if (p.kind === 'invite') return { title: '朋友邀你一起打《角頭械鬥》', description: `私人房 ${p.room}，點開直接加入。免下載，瀏覽器就能玩。` };
  const where = p.map ? MAP_NAMES[p.map] : '';
  const stat = where && p.beat !== undefined ? `在${where}打出 ${p.beat} 殺，` : where ? `${where} 1v1，` : '';
  return { title: `${p.name} 向你發起單挑！《角頭械鬥》`, description: `${stat}敢接嗎？點開直接單挑，免下載。` };
}

/** The address of the preview's picture (`api/og.ts`). */
export function previewImage(origin: string, p: Preview) {
  const q = new URLSearchParams(p.kind === 'invite' ? { k: 'invite', room: p.room } : { k: 'duel', ch: p.name });
  if (p.kind === 'duel' && p.map) q.set('map', p.map);
  if (p.kind === 'duel' && p.beat !== undefined) q.set('beat', String(p.beat));
  return `${origin}/api/og?${q}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** The page a link-preview crawler gets for `url`: the Open Graph and Twitter tags, nothing to run. */
export function previewPage(url: URL, p: Preview) {
  const { title, description } = previewText(p), image = previewImage(url.origin, p);
  return `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"><meta name="robots" content="noindex">
<meta property="og:type" content="website"><meta property="og:site_name" content="角頭械鬥 · Turf War: Taipei">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url.href)}"><meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:locale" content="zh_TW">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(image)}">
</head><body><h1>${esc(title)}</h1><p>${esc(description)}</p><p><a href="${esc(url.href)}">${esc(url.href)}</a></p></body></html>`;
}
