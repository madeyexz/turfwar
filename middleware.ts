/**
 * Vercel Routing Middleware for the links players send: a link-preview crawler (LINE, Threads and the
 * other Meta apps, Discord, X, Telegram, Slack, iMessage…) asking for a 發起單挑 link (`/c`) or an
 * invite link (`/r/<code>`) gets a small page whose Open Graph tags name the challenger or the room,
 * with a picture from `api/og.ts`. Everyone else goes on to the game (vercel.json serves index.html).
 * Only these two paths run it; anything that goes wrong also falls through to the game.
 */
import { previewOf, previewPage } from './api/_og/preview';

export const config = { matcher: ['/c', '/r/:code'] };

/**
 * Preview crawlers by their own names only: in-app browsers say Line/, Instagram, KAKAOTALK, Pinterest or
 * Barcelona (Threads) in a person's user agent, and those people must get the game.
 */
const CRAWLER = /facebookexternalhit|facebot|line-poker|linespider|twitterbot|slackbot|discordbot|telegrambot|whatsapp\/|linkedinbot|skypeuripreview|embedly|pinterestbot|redditbot|applebot|googlebot|bingbot|kakaotalk-scrap|iframely|vkshare|mastodon|bluesky/i;

/** Carry on to the page (what @vercel/functions' `next()` sends). */
const next = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

export default function middleware(request: Request): Response {
  try {
    if (!CRAWLER.test(request.headers.get('user-agent') ?? '')) return next();
    const url = new URL(request.url), preview = previewOf(url);
    if (!preview) return next();
    return new Response(previewPage(url, preview), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex' },
    });
  } catch {
    return next();
  }
}
