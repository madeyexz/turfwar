# Search and AI-answer visibility (SEO and GEO)

How 角頭械鬥 · Turf War: Taipei is made easy to find and correctly described in classic search (Google,
Bing, Yahoo Taiwan) and in AI answer engines (ChatGPT search, Perplexity, Gemini, Claude, Google AI
Overviews, Copilot). The game itself is a canvas app, so crawlers that do not run script see almost
nothing on `/`; this page records what we added so they, and people who arrive from them, get the right
text, and what only the owner can do.

Back to the [README](../README.md) · [Development](DEVELOPMENT.md) · [Gameplay](GAMEPLAY.md)

## What is in the site

| Piece | Where | Notes |
| --- | --- | --- |
| Title, description, `lang`, `robots` | `index.html` | Title `角頭械鬥 Turf War: Taipei｜免費網頁射擊遊戲，免下載 FPS`; the description leads with the Chinese name and ends with a short English line. `<html lang="zh-TW">` (the game sets `lang` to the player's language when its script runs). `max-image-preview:large` allows large previews. |
| Canonical | every public page | An absolute, **clean** URL (`https://turfwar.ianhsiao.me/`, `/about`, `/en/about`, `/privacy`), written in the HTML, so `?utm_*`, `?lang=` or `?tab=` variants all point at one URL. `og:url`, the sitemap and every JSON-LD `url` are the same clean URLs. |
| Open Graph and Twitter cards | `index.html`, the about pages | `summary_large_image`, a 1200×630 JPEG, `og:locale` `zh_TW` with `en_US` alternate. `/` and `/about` use `public/og/og-zh-TW.jpg`; `/en/about` uses `og-en.jpg`. Rebuild the images with `bun tools/og/make.ts` (needs agent-browser and ImageMagick; the template is `tools/og/og.html`, made from `docs/media/screenshot-ximending-fight.jpg`, the logo and the game's fonts). |
| Crawlable text | The info pages: `/about`, `/guide`, `/maps`, `/begone` (繁體中文) and their `/en/` twins (English); a `<noscript>` block in `index.html` | Static HTML, no script. `/about`: what the game is, at a glance, how to play, modes, room sizes, maps, weapons, controls and a FAQ. `/guide` (攻略): every weapon's price, damage, magazine, reload and movement, the attachments, the cash awards, items, what to buy when, Sabotage tips and a FAQ. `/maps` (地圖): the 13 offered maps with room sizes, modes, bomb sites, vehicles, landmarks and their picker screenshots. `/begone`: what this unofficial homage keeps from BeGone and what is new, a plain non-affiliation line, and a FAQ ("is BeGone still playable?"). Every info page carries the same section links (`<nav class="pages">`, the current page marked) so each is one click from the others. Each language has its own URL, linked with `hreflang` (`zh-TW`, `en`, `x-default` → English) in the pages and the sitemap. The lobby footer links to the page in the player's language ("How to play" / 玩法介紹). Built as extra Vite inputs from `INFO_PAGES` in `vite.config.ts` (like `/privacy`), rewritten in `vercel.json`, kept out of the service worker's precache. To add one, add it to `INFO_PAGES`, `vercel.json`, the sitemap, `INFO` in `src/seo.test.ts` and every page's section links. |
| JSON-LD | `index.html`: `WebSite` and `VideoGame`; info pages: `WebPage`, `BreadcrumbList`, and `FAQPage` where the page has a visible FAQ (`/about`, `/guide`, `/begone`) | `VideoGame`: both names, genres, `gamePlatform` "Web browser", `applicationCategory` `GameApplication`, `operatingSystem` "Any", `playMode` multi- and single-player, `inLanguage` `zh-TW` and `en`, free `Offer`, `numberOfPlayers` 1–48 (24v24 = 48 slots), image, the two trailers, the public GitHub repo as `sameAs`, and the author: one `Person` node (`@id` `https://ianhsiao.me/about#person`, the same id the owner's own site uses, name Ian Hsiao, url `https://ianhsiao.me/`, `sameAs` the GitHub profile `https://github.com/madeyexz`) referenced as `author` and `creator` of the `VideoGame`, `creator` of the `WebSite` and `author` of each about page's `WebPage`. **No ratings, reviews, counts or awards**: we have none, and `src/seo.test.ts` fails if such keys appear. |
| `robots.txt` | `public/robots.txt` | Everything public is allowed; `/admin` is disallowed for every crawler. The named crawlers (Googlebot, Bingbot, GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot, Google-Extended) each have a group, which must repeat `Disallow: /admin` because a crawler with its own group ignores `*`. Other crawlers fall under `*` (allowed). `/admin` also sends `X-Robots-Tag: noindex` (`vercel.json`). The `Sitemap:` line names the sitemap. |
| `sitemap.xml` | `public/sitemap.xml` | Every public URL (`/`, the eight info pages, `/privacy`), clean, with the `xhtml:link` language alternates for the info pages. No `lastmod` (a wrong one is worse than none). |
| `llms.txt`, `llms-full.txt` | `public/` | The llmstxt.org format: both names, key facts, modes, rules, economy, weapons, maps, controls, links, licence and credits, in text an assistant can quote. Facts come from [GAMEPLAY.md](GAMEPLAY.md); keep them in step when rules change. They repeat the trademark note: the names 角頭械鬥 and Turf War: Taipei and the logo are not licensed for reuse. |
| Headers | `vercel.json` | `robots.txt`, `sitemap.xml`, `llms*.txt` get explicit content types and a 1-hour cache; hashed bundles in `/assets/*-<hash>.js|css` are `immutable` for a year (they were revalidated on every visit); `/icons` and `/og` get a day plus stale-while-revalidate. |
| Fonts | `<!--preload:…-->` in each page's head, `fontPreload` in `vite.config.ts` | Preloads Rajdhani 600 and 700 with the same versioned URLs the stylesheets use. The about pages use `font-display: optional` for them, so a late font never shifts the layout. The 1.4 MB Chinese font is deliberately not preloaded (it would compete with the 1.1 MB game script; text shows in the system font first). |

### Decisions worth knowing

- **No redirect from `lawbreaker.vercel.app`.** Saved identities, XP and settings live in `localStorage`,
  which is per origin: redirecting would silently reset every returning player (and break installed
  home-screen apps) who still uses the old address. The static canonical already points both hosts at
  `turfwar.ianhsiao.me`, which consolidates the duplicate content without moving anyone. If the owner wants
  a redirect later, it needs a migration of the saved state first.
- **The lobby `/` is one URL for both languages**, picked by the browser or `?lang=`. `hreflang` therefore
  lives on the about pages (one URL per language), not on `/`. Facebook/LINE/Threads previews of `/` use the
  Chinese card; share `/en/about` for an English one.
- **The FAQ is JSON-LD only for understanding, not for a rich result.** Google's own FAQ page says the FAQ
  rich result no longer appears in Search (from 7 May 2026) and that its documentation was removed. The
  markup still helps machines read the page, and `src/seo.test.ts` checks it repeats the visible FAQ word for word.
- **Query strings never reach a canonical.** The owner tags shared links with `utm_*`; the canonical, `og:url`,
  JSON-LD urls and sitemap are static clean URLs, so `/?utm_source=x` is the same page for crawlers, and the
  lobby renders identically with it. `src/seo.test.ts` enforces it.
- **Not added:** a visually hidden copy of the text on `/` (hidden text is a spam signal and the lobby is a
  fixed full-screen app, so there is no "below the fold"), `Disallow` for CSS/JS (Google needs them to render
  the lobby), `aggregateRating`, and any `llms.txt`-style promise to a specific engine.

## How to verify

```sh
bun run test src/seo.test.ts          # canonical, hreflang, OG, JSON-LD, FAQ = visible text, sitemap, robots, llms, images, vercel.json
bun run build && ls dist/about dist/en/about dist/og dist/robots.txt dist/sitemap.xml dist/llms.txt

# after a deploy (use the preview URL for a dev push)
curl -s  https://turfwar.ianhsiao.me/robots.txt
curl -s  https://turfwar.ianhsiao.me/sitemap.xml
curl -s  https://turfwar.ianhsiao.me/llms.txt | head
curl -sI https://turfwar.ianhsiao.me/llms.txt | grep -i content-type          # text/plain; charset=utf-8
curl -s  "https://turfwar.ianhsiao.me/?utm_source=x" | grep -E 'rel="canonical"|og:url'   # still the clean URL
curl -s  https://turfwar.ianhsiao.me/about | grep -E '<title>|canonical|hreflang|<h1>'
curl -sI https://turfwar.ianhsiao.me/assets/<a hashed bundle>.js | grep -i cache-control   # immutable
curl -sI https://turfwar.ianhsiao.me/admin | grep -i x-robots-tag               # noindex, nofollow
```

- **View-source** of `/`: title, description, canonical, Open Graph, the `<script type="application/ld+json">`
  block and the `<noscript>` text must be in the raw HTML (that is what crawlers without script see).
- **Structured data:** paste the URL or the HTML into the [Schema.org validator](https://validator.schema.org/)
  and Google's [Rich Results Test](https://search.google.com/test/rich-results). `VideoGame` and `FAQPage` do
  not produce a Google rich result today, so expect "no rich results detected" with the data still parsed
  (unverified: re-check the tools' current behaviour).
- **Search Console → URL Inspection → Test live URL → View tested page** shows what Googlebot rendered
  (the lobby, with its script run). Check that the canonical Google chose is the one we declared.
- **Previews:** paste the URL into the Facebook Sharing Debugger, LINE, Threads, X and Slack/Discord to see the card.
- **Lighthouse** (Chrome DevTools, or `bunx lighthouse <url>`) for SEO, accessibility and LCP/CLS. Software-rendered
  orb runs say nothing about real devices: the lobby's 3D backdrop makes a headless run slow. In the orb the two
  about pages scored 100 for SEO and performance on a mobile profile (LCP about 1.6 s, CLS 0) and 100 for SEO on `/`;
  the lobby's own timing must be read on a real device (the deploy screen's `/?bench`) or from PostHog / Search
  Console's Core Web Vitals report, not from the orb.
- **Ask the assistants** (after they have crawled): "What is 角頭械鬥?", "Is Turf War: Taipei free?", "browser FPS from
  Taiwan" in ChatGPT search, Perplexity, Gemini and Copilot; compare what they say with [llms.txt](../public/llms.txt).

## Search data (Search Console, Bing, IndexNow)

Decide SEO changes from real search data, not guesses. `scripts/seo.ts` reads the free Google Search Console and
Bing Webmaster APIs and pings IndexNow; no dependencies (it signs the service-account token with `node:crypto`).

```sh
bun run seo:report               # last 28 days: totals, queries, pages, countries, devices, sitemaps, index status of each sitemap URL; Bing queries, pages, sitemaps
bun run seo:report -- --days 90 --json
bun run seo:ping                 # after a release: submit sitemap.xml to Google and Bing, send every sitemap URL to IndexNow
bun run seo:ping -- /about       # or just the pages that changed
```

- **Credentials** are Amp project secrets (docs/DEVELOPMENT.md, "Orb credentials"): `GSC_SERVICE_ACCOUNT_JSON` (a
  service account of Google Cloud project `turfwar-seo`, a **Full** user on the property) and
  `BING_WEBMASTER_API_KEY`. A missing secret or a failing API prints an error in that section; the rest still runs.
  Never print the secrets.
- **Google property** is the Domain property `sc-domain:ianhsiao.me` (verified by DNS TXT at Cloudflare). It also
  covers the owner's other subdomains, so every Search Analytics query is filtered to `https://turfwar.ianhsiao.me/`
  pages. Data lags 2–3 days, and Google hides rare queries for privacy, so totals can exceed the sum of query rows.
  URL Inspection is limited to about 2,000 calls a day.
- **History**: each weekly run adds a row to [seo-history.md](seo-history.md) (numbers and what changed).
- **Bing** has the site `https://turfwar.ianhsiao.me/`, imported from Search Console.
- **IndexNow** (Bing, Yandex, Naver, Seznam): the key is `INDEXNOW_KEY` in `scripts/seo.ts`, served as
  `public/<key>.txt` (public by design; `src/seo.test.ts` checks they match). Ping only URLs that `main` actually
  serves, i.e. after a release; a ping from a `dev` change announces pages production does not have yet.
- Google ignores IndexNow, and its old sitemap "ping" URL is gone; Google relies on the `robots.txt` `Sitemap:` line
  and the Search Console submission. Its Indexing API is only for job postings and live broadcasts: do not use it.
- Read-only `seo:report` is always fine. `seo:ping` changes nothing on the site but tells the search engines to
  crawl; running it on a release is part of the release procedure.

## Queries to win

Brand first: people who arrive from Google already convert to players at about 93% (78 visitors from search in
the sample, 64 of them from the Android Google app, always landing on `/`), so the title, description and brand
queries are the cheap win. Check the real ones in Search Console's Performance report once it has data.

**繁體中文 (the main audience, about 91% of visitors)**

- Brand: 角頭械鬥, 角頭械鬥 遊戲, 角頭械鬥 FPS, 角頭械鬥 Turf War, 角頭械鬥 攻略, 角頭械鬥 武器, 角頭械鬥 地圖, 角頭械鬥 單挑
- Category: 網頁射擊遊戲, 網頁 FPS, 免下載 FPS, 免下載射擊遊戲, 瀏覽器射擊遊戲, 免費線上射擊遊戲, 線上 FPS 免費, 手機網頁射擊遊戲, 台灣自製 FPS, 台灣開發 射擊遊戲
- Play with friends: 單挑 遊戲, 線上單挑, 6v6 射擊遊戲, 多人射擊遊戲 網頁, 跟朋友玩 射擊遊戲 免註冊
- BeGone fans: BeGone 類似遊戲, BeGone 替代, BeGone 繁體中文, BeGone 網頁遊戲, 類似 BeGone 的 FPS, nPlay BeGone, 爆破 殲滅 FPS
- Place and culture hooks: 西門町 遊戲, 台北 FPS, 台北101 遊戲 地圖, 中正紀念堂 遊戲, 三重 遊戲, 藍白拖 遊戲, 珍奶 遊戲

**English**

- Brand: Turf War Taipei, Turf War: Taipei, 角頭械鬥 game, Turf War Taipei browser game
- Category: browser FPS, browser FPS Taiwan, free browser shooter no download, play FPS in browser, free online multiplayer FPS no install, team shooter in browser, round-based FPS browser, Taipei shooter game, Taiwan browser game
- BeGone fans: BeGone alternative, games like BeGone, BeGone 2026, BeGone-style browser FPS, Counter-Strike style browser game
- Modes: Elimination Sabotage browser game, 1v1 browser FPS, 6v6 browser shooter, 24v24 browser shooter

The page that should answer each: brand and "what is" → `/` and `/about` / `/en/about`; weapons, cash, 攻略 and
"what to buy" → `/guide` / `/en/guide`; maps and the place hooks (西門町, 台北101, 中正紀念堂, 三重) → `/maps` / `/en/maps`;
controls → the about pages; BeGone queries → `/begone` / `/en/begone` (and the about pages' FAQ). Do not claim a
ranking, a player count or a review anywhere.

**What the data said on 2026-10-14** (Search Console, 2026-09-01 → 2026-10-13, fresh data): 190 clicks from 305
impressions, average position 3.2, all on `/`; 73 of the 74 clicks Google attributes to a country from Taiwan. The
named queries are brand only (角頭械鬥 43 clicks at about position 4, turfwar 12 at 3, turf war 9 at 7) plus one-word
follow-ups such as 連結, 網址, 幫我打開 at position 1 (probably AI Mode or Gemini follow-ups; unverified); about 60% of
clicks have no query (withheld). "角頭械鬥" is also a common news phrase (gang brawls), which is likely why the brand
sits near position 4 rather than 1, and "turf war" is a generic English phrase. `/about` was "Crawled - currently not
indexed". So that run added the guide, maps and BeGone pages: more useful, distinct text under the domain for the
long-tail queries above, and more internal links to `/about`.

## Needs the owner (nothing here can be done from the repo)

1. **Google Search Console**: done 2026-10-11 (Domain property `sc-domain:ianhsiao.me`, API access, sitemap
   submitted; see "Search data"). Still only in the web UI: **URL Inspection → Request indexing** (the API can inspect
   but not request) for `/about`, `/en/about`, `/privacy`, which were unknown to Google on 2026-10-11, and Core Web
   Vitals once there is data.
2. **Bing Webmaster Tools**: done 2026-10-11 (imported from Search Console, API key, sitemap submitted, IndexNow key
   in the repo). Yahoo Taiwan's results come from Bing as far as we know (unverified for the current Taiwan
   edition), so Bing coverage is also Yahoo coverage.
3. **Entity consistency**: keep the GitHub repo description and README, the site's names and the social profiles identical (the repo and site already use the same two names), so search and assistants match them as one entity.
4. **Link back from the personal site.** The author (Ian Hsiao) is confirmed and linked from the structured data, `llms.txt` / `llms-full.txt` and the about pages' credits (a plain link, no UTM) to https://ianhsiao.me/, the owner's site, which serves it directly (`www.ianhsiao.me` 301s to it, `/about` 308s to it; its canonical and `Person.url` are `https://ianhsiao.me/`). The `Person` `@id` here is `https://ianhsiao.me/about#person`, the id the owner's own JSON-LD uses, so the two entities match; the id is an identifier, not the profile link. A backlink to the game exists on https://ianhsiao.me/work (checked 2026-10-11), but the homepage https://ianhsiao.me/ has no direct link to https://turfwar.ianhsiao.me/ yet. A plain homepage link (ideally named "角頭械鬥 · Turf War: Taipei") would be a stronger signal; that is the owner's call on their own site. Still open: whether to ever move `lawbreaker.vercel.app` to a redirect (needs a saved-state migration), and whether to add a non-affiliation line about nPlay/BeGone (the repo says "homage" and "no proprietary assets", not more).
5. **Confirm after the first release**: the `main` deploy serves the new files (the `curl`s above), because this
   change was only pushed to `dev` (Vercel preview on `lawbreaker-dev`).
6. **Optional**: submit the URL to LINE Open Graph cache / Facebook Sharing Debugger after the release so old
   previews refresh; give the GitHub repo a social preview image (Settings → Social preview, `public/og/og-en.jpg`)
   and its homepage URL (already set); pin the repo on the owner's profile.

## Earning mentions (the owner's job)

Search and assistants cite what other sites say, and nothing here replaces that. Be honest and non-spammy; disclose
that you made the game; never fake reviews, votes or accounts.

- **巴哈姆特 (Bahamut)**: a post on the game's board or 哈啦區 for browser/FPS games (e.g. "自製的網頁 FPS 角頭械鬥，
  免下載，求回饋"), with the trailer and the 單挑 challenge link; read the board rules first and keep one post per board.
- **PTT**: only on a board whose rules allow self-made projects (check each board's 板規 first, e.g. Steam or a mobile/online-game board); use its required tags and post as 分享, and expect its self-promotion rules to apply. One honest post, no cross-posting.
- **Dcard**: 遊戲板 / 科技板 / 程式設計板 post, on the developer story (built with Claude, Three.js, SpacetimeDB).
- **Threads / Instagram / LINE OpenChat / Discord**: Taiwan game and 單挑 communities; share the match card (分享戰績) with the
  tagged link (`utm_source=threads` and so on) so PostHog shows what works.
- **Reddit** (r/WebGames, r/IndieGaming, r/gamedev "Show off Saturday"), **Hacker News** (Show HN), **Product Hunt**,
  **itch.io** (an HTML5 or "link to the web game" page), **Newgrounds / CrazyGames-style portals** only if their terms allow
  an externally hosted game, **IndieDB**, **GameJolt**: each is a crawlable profile that links back and names the game
  the same way.
- **Taiwan tech press and communities**: iThome, INSIDE, T客邦, 巴哈姆特 GNN, 電獺少女 (pitch the angle: a Taiwan-themed browser
  FPS with 西門町, 台北101 and 中正紀念堂 maps, built largely with an AI coding agent), and Taiwan game-dev Facebook groups.
- **Wikipedia and other wikis**: do not write or edit an entry for it yourself (self-promotion and notability rules);
  if the game is ever covered by independent sources, someone else may add it. The BeGone fandom wiki may have a "similar
  games" section; propose it on the talk page rather than editing for a link.
- **GitHub**: topics (`fps`, `browser-game`, `threejs`, `spacetimedb`, `taiwan`, `webgl`), a release with the trailer, the
  README's first screen in both languages, and an "awesome" list submission (awesome-threejs, awesome-webgl) when it has stars.
- **Video**: the 30 s trailers are in `public/media`; uploading them to YouTube (with both names in the title and the
  link in the description) gives a second, strongly indexed page that names the game.

## Third-party facts, and how current they are

Checked on 2026-10-11 against the vendors' own pages: Google's FAQ rich result is discontinued (7 May 2026);
Google says AI Overviews and AI Mode need no special markup or machine-readable "AI files", only an indexable page
with good text; OpenAI says `OAI-SearchBot` is what controls appearing in ChatGPT search answers, `GPTBot` is for
training, and `ChatGPT-User` is for user-triggered visits and may not follow `robots.txt`.

**Unverified or only from memory, re-check before relying on them:** whether any major engine reads `llms.txt` (Google
says it is not needed; we added it as cheap, harmless insurance for assistants that fetch pages); exactly what
`Google-Extended` governs (training and grounding in some Google AI products, not Search ranking); `PerplexityBot`
and `ClaudeBot` behaviour and whether Anthropic and Perplexity have newer search-specific user agents (`Claude-SearchBot`,
`Perplexity-User`) that should be named; Bing Webmaster Tools features (Search Console import, IndexNow) and Yahoo Taiwan
being served by Bing; Rich Results Test and Schema.org validator behaviour for `VideoGame`.
