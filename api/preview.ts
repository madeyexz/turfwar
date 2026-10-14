/**
 * The page a link-preview crawler gets for a shared link (LINE, Threads and the other Meta apps, Discord,
 * X, Telegram, Slack, iMessage…): vercel.json rewrites `/c?…` (發起單挑) and `/r/<code>` (邀請朋友) here
 * only when the user agent is a known preview crawler, so people always get the game. The Open Graph tags
 * name the challenger or the room, with a picture from `api/og.ts`. `room` (from `/r/<code>`) or the
 * challenge's own query says which link it was.
 * (Node ESM on Vercel: relative imports carry `.js`.)
 */
import { previewOf, previewPage } from './_og/preview.js';

export function GET(request: Request): Response {
  const url = new URL(request.url), room = url.searchParams.get('room');
  const q = new URLSearchParams(url.search);
  q.delete('room');
  // The address the player shared, rebuilt from what the rewrite passed on.
  const link = new URL(room ? `/r/${room}${q.has('ref') ? `?ref=${encodeURIComponent(q.get('ref')!)}` : ''}` : `/c?${q}`, url.origin);
  const preview = previewOf(link);
  if (!preview) return Response.redirect(new URL('/', url.origin).href, 302);
  return new Response(previewPage(link, preview), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex' },
  });
}
