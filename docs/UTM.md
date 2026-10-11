# UTM link sheet

Every link we post that points to the game carries UTM tags, so the first visit can be traced to a
channel. Without them most traffic arrives with no referrer (in-app browsers and messengers strip
it) and cannot be told apart. The game keeps the first tagged visit in the browser and sends it with
every analytics event (`first_utm_source`, `first_utm_medium`, … and this visit's own `visit_utm_*`;
see [DEVELOPMENT.md](DEVELOPMENT.md#players-analytics-and-the-admin-page) and the
[privacy page](../privacy/index.html)).

## The rules

1. **One `utm_source` per channel**, from the table below. Never invent a variant (`Threads`, `threads.net`).
2. **`utm_medium` comes from a fixed set**:
   `post` (your own post), `comment` (a reply or comment), `bio` (a profile link), `dm` (a private message or group chat),
   `video` (a video description or pinned comment), `share` (a link the game generated for a player, set by the game itself).
   Links in our own repository add `readme`, `docs` and `repo` (the GitHub "Website" field); links the game itself makes use `end_screen`, `share_card` or `duel` (rule 8).
3. **`utm_campaign` names the specific post or occasion**: lowercase, hyphens, `topic-yyyy-mm` or
   `topic-yyyy-mm-dd`, e.g. `launch-2026-10`, `ximending-clip-2026-10-12`. Reuse it for every channel of one push so channels can be compared.
4. Optional: `utm_content` tells two links in the same post apart (`trailer`, `play-button`).
5. Values are lowercased and limited to letters, digits and `._~:/@+-`; keep them to ASCII.
6. Tag the link, not the page: keep **canonical, Open Graph and `og:url` free of query strings** (they are).
7. Chinese-speaking channels may add `&lang=zh` to open in 繁體中文 whatever the phone's language is. It does not change the tags.
8. Links the game makes itself use `src/utm.ts` (`withUtm(url, { source, medium, campaign })`): `utm_source=share` or `challenge`,
   `utm_medium=end_screen`, `share_card` or `duel`. Room and challenge parameters (`room`, `c`, `ref`…) are never touched.
9. Do not add `gclid` or `fbclid` by hand: ad platforms append them. The game records only that one was present (`first_gclid`, `first_fbclid`), never the value.

## Copy-paste links

Replace `launch-2026-10` with the campaign, and `post` with the medium if it is not a post.

| Channel | `utm_source` | Link |
| --- | --- | --- |
| Threads | `threads` | `https://turfwar.ianhsiao.me/?utm_source=threads&utm_medium=post&utm_campaign=launch-2026-10` |
| Instagram | `instagram` | `https://turfwar.ianhsiao.me/?utm_source=instagram&utm_medium=bio&utm_campaign=launch-2026-10` |
| 巴哈姆特 (Bahamut) | `bahamut` | `https://turfwar.ianhsiao.me/?utm_source=bahamut&utm_medium=post&utm_campaign=launch-2026-10&lang=zh` |
| PTT | `ptt` | `https://turfwar.ianhsiao.me/?utm_source=ptt&utm_medium=post&utm_campaign=launch-2026-10&lang=zh` |
| Dcard | `dcard` | `https://turfwar.ianhsiao.me/?utm_source=dcard&utm_medium=post&utm_campaign=launch-2026-10&lang=zh` |
| LINE | `line` | `https://turfwar.ianhsiao.me/?utm_source=line&utm_medium=dm&utm_campaign=launch-2026-10&lang=zh` |
| Discord | `discord` | `https://turfwar.ianhsiao.me/?utm_source=discord&utm_medium=post&utm_campaign=launch-2026-10` |
| YouTube | `youtube` | `https://turfwar.ianhsiao.me/?utm_source=youtube&utm_medium=video&utm_campaign=launch-2026-10` |
| Reddit | `reddit` | `https://turfwar.ianhsiao.me/?utm_source=reddit&utm_medium=post&utm_campaign=launch-2026-10` |
| GitHub | `github` | `https://turfwar.ianhsiao.me/?utm_source=github&utm_medium=readme&utm_campaign=repo` (README; `docs` in other docs) |
| LinkedIn | `linkedin` | `https://turfwar.ianhsiao.me/?utm_source=linkedin&utm_medium=post&utm_campaign=launch-2026-10` |
| Facebook | `facebook` | `https://turfwar.ianhsiao.me/?utm_source=facebook&utm_medium=post&utm_campaign=launch-2026-10` |
| X | `x` | `https://turfwar.ianhsiao.me/?utm_source=x&utm_medium=post&utm_campaign=launch-2026-10` |

The permanent profile and repository links (`utm_medium=bio` or `readme`) use the campaign `profile`:

| Where | Link |
| --- | --- |
| Threads bio | `https://turfwar.ianhsiao.me/?utm_source=threads&utm_medium=bio&utm_campaign=profile` |
| Instagram bio | `https://turfwar.ianhsiao.me/?utm_source=instagram&utm_medium=bio&utm_campaign=profile` |
| GitHub repository "Website" field | `https://turfwar.ianhsiao.me/?utm_source=github&utm_medium=repo&utm_campaign=profile` |
| YouTube channel / video description | `https://turfwar.ianhsiao.me/?utm_source=youtube&utm_medium=video&utm_campaign=profile` |
| LinkedIn profile | `https://turfwar.ianhsiao.me/?utm_source=linkedin&utm_medium=bio&utm_campaign=profile` |
| X bio | `https://turfwar.ianhsiao.me/?utm_source=x&utm_medium=bio&utm_campaign=profile` |

## Reading the results

In PostHog (HogQL, filter `properties.test is null`), group by `properties.first_utm_source` for where
players first came from and by `properties.visit_utm_source` for where this visit came from; a person
with no `first_*` property arrived without tags or a referrer. `properties.visit_n` and
`properties.has_prior_storage` separate returning visitors from fresh storage (a first visit with
`has_prior_storage = true` had saved data and is a return whose analytics ID may have been lost), and
`properties.in_app` names the app's built-in browser:

```sql
select properties.first_utm_source as channel, count(distinct person_id) as people
from events where event = 'lobby_view' and properties.test is null group by channel order by people desc
```

## Links we cannot change from the repo

README links carry `utm_source=github`. The privacy page and `/admin` link only to the game's own
pages, which is navigation inside the site and is not tagged (a tag there would overwrite the
visit's real source). Everything on the platforms above (bios, groups, descriptions) has to be
pasted by a person; use the tables above.
