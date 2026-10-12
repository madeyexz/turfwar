# SEO history

One row per weekly SEO run (`bun run seo:report`, docs/SEO.md "Search data"), newest last, so trends show up across
orbs. Google figures cover the report's 28-day window (it ends 2 days before the run); "indexed" counts sitemap URLs
whose URL Inspection coverage is "Submitted and indexed". Google withholds rare queries, so the top query rows sum
to less than the totals.

| Run | Google clicks | Impressions | CTR | Avg position | Indexed (of sitemap) | Bing sitemap | Top queries (clicks/impr., position) | Changes this run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-11 | 44 | 71 | 62.0% | 2.5 | 1 / 4 (`/` only; about pages and `/privacy` unknown, released today) | Success, 4 URLs | turfwar 2/5 (4.6); turf war 1/3 (7.3); 角頭械鬥 0/1 (11.0); other games like this 0/1 (9.0) | Baseline; none (too little data) |
| 2026-10-12 | 44 (±0) | 71 (±0) | 62.0% | 2.5 | 1 / 4 (`/`; `/about`, `/en/about`, `/privacy` now "Discovered - currently not indexed", were unknown) | Success, 4 URLs (crawled 10-11); Google sitemap read 10-11, 4 submitted / 0 indexed | same as 2026-10-11 (no new Search Console day yet) | seo:report retries Google 5xx and inspects URLs one by one (URL Inspection returned 500s); site content unchanged, still true to GAMEPLAY.md after the map rework |
