/**
 * The picture in a shared link's preview (1200×630; `api/_og/preview.ts` says which): 「<name> 向你發起單挑！」
 * over the challenge's map, or 「朋友邀你一起打」 for an invite to a private room. Drawn with @vercel/og
 * (satori) in the Node runtime; the text's glyphs come from Google Fonts (Noto Sans TC, subset to this
 * picture's characters), the map art and logo from `api/_og` (vercel.json includes them). The same
 * address always draws the same picture, so it is cached for a long time.
 * (Node ESM on Vercel: relative imports carry `.js`.)
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from '@vercel/og';
import { MAP_NAMES, previewOf, type Preview } from './_og/preview.js';

const ACCENT = '#7ff6ff', CRIMSON = '#ff5544', INK = '#e9f3f5', MUTED = '#9fb3b9';
const asset = (name: string) => readFile(join(process.cwd(), 'api', '_og', name));
const dataUrl = (bytes: Buffer, type: string) => `data:${type};base64,${bytes.toString('base64')}`;

/** The 藍白拖, as the kill feed draws it (src/game/skins.ts). */
const SLIPPER = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 2 32 16"><path d="M10 10c0-4.5 3-6.5 8-6.5h11c5.5 0 9.5 2.6 9.5 6.5s-4 6.5-9.5 6.5H18c-5 0-8-2-8-6.5z" fill="#f4f6f4" stroke="#1f5bd1" stroke-width="1.6"/><path d="M26 3.6c1.6 2 1.6 10.8 0 12.8M30.5 3.8c1.6 2 1.6 10.4 0 12.4" stroke="#2f6fe0" stroke-width="3.2" fill="none" stroke-linecap="round"/></svg>').toString('base64');

/** Noto Sans TC at `weight`, holding just `text`'s glyphs (Google Fonts sends TrueType to a plain fetch). */
async function font(text: string, weight: number): Promise<ArrayBuffer | undefined> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@${weight}&text=${encodeURIComponent(text)}`)).text();
    const src = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(css)?.[1];
    return src ? await (await fetch(src)).arrayBuffer() : undefined;
  } catch { return undefined; }
}

type Node = { type: string; props: Record<string, unknown> & { style?: Record<string, unknown>; children?: unknown } };
const h = (type: string, style: Record<string, unknown>, children?: unknown, props: Record<string, unknown> = {}): Node => ({ type, props: { ...props, style, children } });

/** The words on the picture: a small line over the headline, the headline (two lines), the stat line, the button. */
function words(p: Preview) {
  if (p.kind === 'invite') return { over: '你的朋友', head: ['邀你一起打', '《角頭械鬥》'], stat: `私人房 ${p.room}`, go: '點開直接加入 →' };
  const where = p.map ? MAP_NAMES[p.map] : '';
  return {
    over: '', head: [p.name, '向你發起單挑！'],
    stat: where && p.beat !== undefined ? `${where} · ${p.beat} 殺` : where ? `${where} · 1v1` : '1v1',
    go: '點開直接單挑 →',
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url), q = url.searchParams;
  // The picture's own address names the preview the way a link would.
  const p: Preview | undefined = q.get('k') === 'invite'
    ? previewOf(new URL(`/r/${q.get('room') ?? ''}`, url.origin))
    : previewOf(new URL(`/c?${new URLSearchParams({ ch: q.get('ch') ?? '', map: q.get('map') ?? '', ...(q.has('beat') ? { beat: q.get('beat')! } : {}) })}`, url.origin));
  if (!p) return new Response('Not found', { status: 404 });
  const w = words(p), foot = '免下載，瀏覽器就能玩 · turfwar.ianhsiao.me', brand = '角頭械鬥 TURF WAR: TAIPEI';
  const [black, medium, logo, map] = await Promise.all([
    font([w.over, ...w.head, w.go, brand].join(''), 900),
    font([w.stat, foot].join(''), 500),
    asset('logo.png'),
    asset(`maps/${p.kind === 'duel' && p.map ? p.map : 'taipei'}.jpg`).catch(() => undefined),
  ]);
  const [first, second] = w.head;
  const firstSize = p.kind === 'invite' ? 80 : first.length > 8 ? 76 : 96, secondSize = p.kind === 'invite' ? 80 : 92;
  const fonts = [black && { name: 'Noto Sans TC', data: black, weight: 900 as const }, medium && { name: 'Noto Sans TC', data: medium, weight: 500 as const }]
    .filter(Boolean) as { name: string; data: ArrayBuffer; weight: 900 | 500 }[];

  const page = h('div', { width: 1200, height: 630, display: 'flex', position: 'relative', background: '#071016', fontFamily: 'Noto Sans TC', color: INK }, [
    map ? h('img', { position: 'absolute', left: 0, top: 0, width: 1200, height: 630, objectFit: 'cover' }, undefined, { src: dataUrl(map, 'image/jpeg'), width: 1200, height: 630 }) : null,
    h('div', { position: 'absolute', left: 0, top: 0, width: 1200, height: 630, background: 'linear-gradient(90deg, rgba(5,10,14,0.96) 0%, rgba(5,10,14,0.82) 55%, rgba(5,10,14,0.35) 100%)' }),
    h('img', { position: 'absolute', right: 70, bottom: 120, width: 300, height: 150, transform: 'rotate(-22deg)' }, undefined, { src: SLIPPER, width: 300, height: 150 }),
    h('div', { position: 'absolute', left: 70, top: 56, display: 'flex', alignItems: 'center', gap: 18 }, [
      h('img', { width: 60, height: 60, borderRadius: 12 }, undefined, { src: dataUrl(logo, 'image/png'), width: 60, height: 60 }),
      h('div', { fontSize: 28, fontWeight: 900, letterSpacing: 4, color: ACCENT }, brand),
    ]),
    h('div', { position: 'absolute', left: 70, top: p.kind === 'invite' ? 140 : 160, display: 'flex', flexDirection: 'column' }, [
      w.over ? h('div', { fontSize: 36, fontWeight: 900, color: MUTED }, w.over) : null,
      h('div', { fontSize: firstSize, fontWeight: 900, color: '#ffffff', lineHeight: 1.1 }, first),
      h('div', { fontSize: secondSize, fontWeight: 900, color: CRIMSON, lineHeight: 1.15 }, second),
      h('div', { marginTop: p.kind === 'invite' ? 8 : 18, fontSize: 40, fontWeight: 500, color: INK }, w.stat),
    ].filter(Boolean)),
    h('div', { position: 'absolute', left: 70, bottom: 64, display: 'flex', alignItems: 'center', gap: 28 }, [
      h('div', { padding: '12px 26px', fontSize: 34, fontWeight: 900, letterSpacing: 4, color: '#ffffff', background: CRIMSON }, w.go),
      h('div', { fontSize: 26, fontWeight: 500, color: MUTED }, foot),
    ]),
  ].filter(Boolean));

  return new ImageResponse(page as never, {
    width: 1200, height: 630, fonts,
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable', 'X-Robots-Tag': 'noindex' },
  });
}
