# Development

Running, testing and debugging locally, the URL flags and check scripts, deploying and releasing,
analytics and the admin page, and a one-minute demo script. Start with
[CONTRIBUTING.md](../CONTRIBUTING.md) for the workflow and the checks a pull request needs.

Back to the [README](../README.md) · [Gameplay](GAMEPLAY.md) · [Architecture](ARCHITECTURE.md)

## Run, test and develop

```sh
bun install --frozen-lockfile
bun install --cwd spacetimedb --frozen-lockfile
bun run dev            # Vite dev server (solo and the practice range work immediately, offline after load)
bun run test           # Vitest (not `bun test`): rounds, bomb, economy, weapons, movement, collision, maps, bots, validation
bun run build          # type-check + production build
bun run typecheck:module
```

Online play locally needs the [SpacetimeDB CLI](https://spacetimedb.com/install) (verified with 2.10.2):

```sh
bun run dev:spacetime  # starts a local server on :3000 and (re)publishes the module as "turfwar"
VITE_SPACETIMEDB_URI=same-origin VITE_SPACETIMEDB_DATABASE=turfwar bun run dev
```

`same-origin` routes the websocket through the dev server at `/stdb`, so a single URL serves the
game and the match server. After changing the module, regenerate client bindings with
`spacetime generate --lang typescript --out-dir src/module_bindings --module-path spacetimedb`.
In Amp orbs, `.amp/services.yaml` declares both services (`amp orb services ensure`).

Lobby URL flags: `?tab=quick|start|join` (the open tab), `?mode=offline|online|lab` (what `&autostart=1`
starts: Solo, Quick Play or Practice), `&game=elimination|sabotage`, `&size=duel|squad|war` and `&map=<id>`
(the Start a Server form; a 24v24 map picks 24v24 unless `size` says otherwise), `&room=CODE` (opens Join a
server with the code filled in; with `autostart` joins it), `&team=0|1|auto`, `&skill=0.25…0.75`, `&name=…`,
`&autostart=1`, `&server=sg|us` (the game server for this visit; Settings → Server saves a choice).
A player still on the lobby's made-up callsign (`Player-123` / `玩家123`) is asked for one before playing
(`src/ui/callsign.ts`), so the scoreboard and the server's player list carry chosen names; `&name=`,
`&autostart` and `?bench` skip the question. Choices are remembered per browser under `lawbreaker.*` in localStorage (`lawbreaker.start.*`
holds the form; `lawbreaker.crosshair` holds the crosshair style the HUD draws).

`bun scripts/roomcheck.ts ws://127.0.0.1:<port> <db>` (local only) checks Play Online with separate
identities: the same filters share a room, different maps split, Any joins a specific-map room,
`quick_join` and `join` still work, bad sizes, modes and maps are refused, and after a match fixed rooms
keep their map (and mode) while Any rooms rotate (it ends matches early with `spacetime sql`, owner-only).
`scripts/loadtest.ts` takes `--mode` and `--map` to Play Online with filters.
`bun scripts/startcheck.ts ws://127.0.0.1:<port> <db>` (local only, an empty database) checks Quick Play and
Start a Server with separate identities: Quick Play opens a 6v6 with bots and a second one joins it, a public
started room is listed, fixed and joinable, a private one is hidden, never Quick Played into and joined by
code, bots off leaves slots empty, `start_room` refuses bad sizes, modes and maps, and the older reducers work.

Testing the store: the practice range always buys for free, anywhere; add `&freebuy` to the URL for a
free-buy Solo match; for a **local** Online database, set `"freeBuy":true` in the match's
`configJson` with
`spacetime sql <db> "UPDATE match SET configJson = '…' WHERE id = 0" --server http://127.0.0.1:3000`
(owner-only; never on Maincloud).

Development pages (dev server only): `/dev/level.html?map=verdant` (map preview; `&cut=6` clips
everything above 6 m to see under roofs),
`/dev/soldier.html` (animation/IK pose sheet), `/dev/viewmodel.html?ads=1` (first-person weapon),
`/dev/viewer.html?model=/assets/props.glb` (asset viewer). Dev-only URL flags `debuginput`,
`fixeddt` and `capture` make automated runs deterministic on software renderers.

The map picker shows a picture of each map (`public/media/maps/<id>.webp`, 480×270, under 40 KB).
`bun scripts/mapshots.ts [--url <dev server>] [map …]` shoots them from the level preview through the
agent-browser CLI, with the dev server running; re-shoot a map after changing it.

## Deploy

Production: https://turfwar.ianhsiao.me (also https://lawbreaker.vercel.app). The GitHub repository
[`madeyexz/turfwar`](https://github.com/madeyexz/turfwar) is connected to Vercel project
`madeyexzs-projects/lawbreaker`: pushing `main` deploys production, and every push to `dev` deploys a
preview wired to the development database `lawbreaker-dev`. Releases are maintainers merging `dev` into
`main` (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

### Game servers

| Use | Server | Database |
| --- | --- | --- |
| Production | SpacetimeDB 2.10.2 self-hosted on **InstaCloud, Singapore** (`wss://play.turfwar.ianhsiao.me`) | `turfwar` |
| US East (the previous production; still published, a choice in Settings → Server, read by `/admin`) | Maincloud, US East | `3d-game-c4lhd` |
| Development (`dev` previews) | Maincloud, US East | `lawbreaker-dev` |

Players pick their server in **Settings → Server** (`src/net/servers.ts`; `?server=sg|us` for one
visit): Singapore, the build's own server and the default, or US East, where players from before the
move keep their saved identity and career. Each server keeps its own players; the lobby switches at
once, a match in progress stays on its server, and `play_clicked` / `match_joined` carry `server_choice`.
A `dev` preview's own server is `lawbreaker-dev`.

The Singapore server (`deploy/instacloud/`, InstaCloud project `5ad5aa00-…`, compute service `stdb`)
is a slim container with SpacetimeDB's two binaries and a 10 GiB `/data` volume. It **scales to zero**:
with no traffic it suspends (or stops), and the next request wakes it, ~2 s from a suspend; the
lobby shows a "waking up" state meanwhile. Traffic on an already-open WebSocket does not count as
activity (only requests through the router do), and a match runs entirely on one, so the platform
used to suspend the server mid-match, 5–13 minutes in, dropping everyone (2026-10-07). Since then a
client in a room requests `/v1/ping` once a minute (`keepAwake` in `src/net/ping.ts`); it stops once
the player is out of the room, so the server still sleeps when nobody plays. The lobby pings every
4 s while visible. With the data volume attached, idle means a stop rather than a suspend, so a wake
takes ~20–30 s. `cd deploy/instacloud && insta --agent compute logs stdb --deploy` lists the
platform's suspends and wakes. `start.sh` supervises the server: SpacetimeDB never
deletes its commitlog (100 players write ~12 GB an hour, ~3x smaller once sealed), so once the data
passes 4 GB and nothing has been written for 2 minutes it restarts the server around
`prune-commitlog.sh` (a few seconds), and past 8 GB it does so even mid-match. Measured before
launch: 100 headless players in nine 6v6 rooms held 30 ticks/s; reducer round trip from Taipei
~112 ms (Maincloud ~206 ms); ~21 KB/s down per player.

Its owner identity lives outside the repo in `~/.config/turfwar/` (made once with
`deploy/instacloud/owner.sh <server-url>`, in its own CLI profile so the Maincloud login is untouched).
Back that folder up: the identity that published `turfwar` is the only one that can update it.
To rebuild or reconfigure the container: `cd deploy/instacloud && insta --agent deploy . --group stdb --port 8080 --websocket`.

Vercel production build variables are `VITE_SPACETIMEDB_URI=wss://play.turfwar.ianhsiao.me` and
`VITE_SPACETIMEDB_DATABASE=turfwar` (the custom domain's certificate went live on 2026-10-07; check it with
`cd deploy/instacloud && insta --agent domain check play.turfwar.ianhsiao.me --group stdb`). The platform's own
`wss://prod-main-stdb-2b7636-205bvw6d002.compute.instacloud-edge.com` reaches the same server; the client keys
saved identities by server (`serverIdentityKey` in `src/net/ping.ts`), so either hostname keeps every player.
`scripts/wsping.ts` measures the round trip but registers a `probe` player (its `hello`): delete that row after
running it against production. Do not use `same-origin` on Vercel; that proxy exists only in the
development server.

For module updates, run tests and module type checks, then publish non-destructively to production
(it wakes the Singapore server first and publishes there and to the legacy Maincloud database):

```sh
bun run test && bun run build && bun run typecheck:module
bun run publish:prod                 # or: bun run publish:prod -- sg   (Singapore only)
```

The dev database is published by hand:
`spacetime publish lawbreaker-dev -s maincloud -p spacetimedb --delete-data=never -y`.
Stop if schema changes require deletion; never use the local development script for cloud
publication. On an existing empty starter database, the first valid join initializes the match
atomically; subsequent joins preserve its state. Publish the compatible module before pushing
the matching commit to `main`, which triggers Vercel's GitHub deployment.
Verify the production URL and two separate Online clients after each release.

## Players, analytics and the admin page

Players stay anonymous (no login). The player-facing summary is the privacy page (`privacy/index.html`,
served at `/privacy` and linked from the lobby, in English and 繁體中文): change it in the same commit
whenever what is collected changes. These answer "how many players, and from where":

- **PostHog** (US cloud, project 649207; `src/analytics.ts`): `VITE_POSTHOG_KEY` (public `phc_…`
  token) and `VITE_POSTHOG_HOST` are set in Vercel for Production and for Preview on `dev`.
  posthog-js (slim build, no external scripts) loads lazily once the lobby is up. Autocapture and
  recordings are off; `$pageview` / `$pageleave` stay on; Do Not Track is respected; PostHog derives
  the country from the IP on its side. Events: `lobby_view`, `play_clicked`, `match_joined`,
  `match_left` (also on tab close, by beacon), `round_ended`, `vehicle_entered`, `store_purchase`,
  `language_changed`, `error_shown`, `server_woke`, `net_sample`, with super properties `lang`, `app_version` (git SHA),
  `online_db` and `screen`. Online, the person property `stdb_identity` links a PostHog person to
  a SpacetimeDB profile. Nothing is sent without a key, under `?bench`, `?trailer`, `?capture`,
  `?fixeddt`, in headless browsers (`navigator.webdriver`), or from the dev server unless the URL
  has `?analytics`; dev events then carry `test: true` and a `dev-test-…` distinct id (and are
  printed to the console as sent).
- **Vercel Web Analytics** (`inject()` at the top of `src/main.ts`): cookieless page views and visitor
  counts for the game page (not `/privacy` or `/admin`); the dev server only logs them.
- **SpacetimeDB** keeps the ground truth in the private table `player_seen` (first and last seen,
  sessions, time zone, language, callsign per identity; `player_day` per active day), filled by the
  join reducers, `hello(tz, lang)` (sent once per connection) and the connect lifecycle.
  **Online play time** (`shared/playtime.ts`) lives in the private tables `player_time` (seconds
  per identity, plus `since`, the start of the stretch not yet credited) and `player_day_time`
  (seconds per identity per UTC day). Entering a room opens a stretch; leaving, disconnecting, the
  idle kick (up to when the player went quiet) and the room closing credit it. Each room's tick
  credits its humans once per wall-clock minute (one batch per room per minute, not per tick), and
  a stretch over 10 minutes (ticks stopped) is dropped rather than credited. Lobby time does not
  count; Solo and Practice never reach the server. Players already in a room when this was first
  published start counting at the next minute.
  `bun scripts/players.ts <database> [--server maincloud|http://127.0.0.1:3000]` prints totals, new
  and active players, countries estimated from time zones, who is online, total and per-player play
  time and career totals (read-only, `spacetime sql` as the owner). Local checks:
  `bun scripts/seencheck.ts ws://127.0.0.1:<port> <db>`, and for play time
  `ADMIN_TEST_KEY=<test key> bun scripts/playtimecheck.ts ws://127.0.0.1:<port> <db>` (about two minutes).
- **Connection quality** (`shared/netstats.ts`): online, the client samples the round trip of its
  movement reports (at most every 500 ms; the newest 600 are kept) and counts the server's
  corrections of its soldier. Every 2 minutes in a room and on leaving it calls
  `net_stats(p50_ms, p95_ms, samples, corrections, seconds)`; the module keeps `player_net` (typical
  p50/p95 as means weighted by time, worst p95, corrections, measured seconds) and `player_day_net`
  (per UTC day). Reports are clamped and limited to one per identity per 30 s, only from identities in
  `player_seen`. PostHog: `match_left` carries `ping_p50`, `ping_p95`, `samples`, `corrections`,
  `corrections_per_min`, and `net_sample` goes out every 5 minutes of a match. Ping is measured on the
  page, so a stalled tab inflates it (as it does the HUD's). Local check:
  `ADMIN_TEST_KEY=<test key> bun scripts/netcheck.ts ws://127.0.0.1:<port> <db>`.
- **Device type** (`deviceKind` in `src/game/device.ts`, rules in `shared/devicekind.ts`): right after
  `hello` each online connection calls `device(kind)` with `phone`, `tablet` or `desktop` (not
  touch-primary → desktop; iPhone or Android "Mobile" → phone; iPad → tablet; otherwise a screen whose
  shorter side is at least 600 CSS px is a tablet). The module keeps the latest kind and connections per
  kind in the private `player_device` table (only those three kinds, one report per identity per 30 s,
  only identities in `player_seen`), and `match_joined` carries `device` to PostHog. Local check:
  `ADMIN_TEST_KEY=<test key> bun scripts/devicecheck.ts ws://127.0.0.1:<port> <db>`.

**Admin page** (`/admin`, `admin/index.html`, not linked from the game, `noindex`): live totals,
online play time (total, average and median per player, today, 7 days), rooms, 30-day charts of new
and active players and of play time, countries and a sortable player list (play time, rounds,
matches, kills …), for the database of the build (`VITE_SPACETIMEDB_*`). Connection quality adds a
PING column (typical p50, coloured; hover for p95 and worst p95) and CORR/MIN to the player list,
median ping cards (24 h, 7 d) and corrections per minute, ping by country and a 30-day ping chart, from
the views `admin_player_net` and `admin_daily_net` (subscribed separately: a database without them
shows "—"). A DEVICE column (Phone, Tablet or Computer; hover for connections per kind) and a Devices
card (share of players by the device they last played on, last 7 days and all time) come from the view
`admin_player_device`, subscribed separately the same way. Play time comes from the
views `admin_player_time` and `admin_daily_time`, joined to `admin_players` by the short id: new
views rather than new columns on the old ones, because changing an existing view's columns makes a
publish disconnect every client. The owner logs in with the **admin key**; the module
keeps only its SHA-256 (`ADMIN_KEY_SHA256` in `spacetimedb/src/admin.ts`). `admin_login(key)` adds
the browser's SpacetimeDB identity to the private `admin` table (five wrong keys per identity per
10 minutes, then refused until the window passes), and the `admin_*` views return rows only to
identities in it. The page remembers only that this browser is logged in, never the key; **Log out**
calls `admin_logout`.

- *Rotate the key*: `printf %s "$NEW_KEY" | shasum -a 256`, put the hash in `ADMIN_KEY_SHA256`,
  publish the module (`--delete-data=never`), then sign everyone out (below) and log in again.
- *Revoke every admin session*: **Sign out all admins** on the admin page (`admin_revoke_all`,
  admins only), or, without a logged-in browser, the owner's SQL: `spacetime sql <db> "DELETE FROM admin"`.
- Local check with a test key (never the real one): publish a copy of the module whose
  `ADMIN_KEY_SHA256` is the test key's hash to a local server, then
  `ADMIN_TEST_KEY=<test key> bun scripts/admincheck.ts ws://127.0.0.1:<port> <db>`.

## 60-second demo script — one continuous shot

1. **0–6 s** — Lobby: size *6v6*, mode **[S] Sabotage**, map *Ochre Quarter* from the map picker,
   team *Militia*. Click *Solo vs bots*, then **Start match**.
2. **6–16 s** — Freeze time: press **B** in your base. You start with $1,000 and the MP5 and M9A1;
   open *Attachments* and fit a **Reflex sight** to the MP5 ($800). Close the store.
3. **16–35 s** — Sprint toward site A (Shift; watch stamina), hold RMB to zoom through the reflex and
   win a firefight: hit markers, a kill, "+$500 KILL" and "+$300 FIRST KILL" popups.
4. **35–45 s** — Reach site A and hold **E** for 5 s: the bomb arms, the clock drops to 40 s and the
   bomb beeps. Defend it.
5. **45–60 s** — The bomb goes off or SWAT disarms it: the round banner, round-end cash, and the
   next round's freeze. Press **Tab** for the scoreboard.

For the online version, open the game in two browsers (separate identities) and choose *Online* in
both: each sees the other move, fight, buy and arm, all validated by the server.
