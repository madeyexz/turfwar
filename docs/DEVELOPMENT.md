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

**最新更新 (latest update)**: the lobby shows the newest entry of `NEWS` in `src/ui/news.ts`, one line with
its date and a NEW mark the first time a browser sees it (`lawbreaker.newsSeen`). Add an entry at the top
when a release brings something players will notice: short, player-facing (not a commit message), in both
languages, with a new `id`.

Lobby URL flags: `?tab=quick|start|join` (the open tab), `?mode=offline|online|lab` (what `&autostart=1`
starts: Solo, Quick Play or Practice), `&game=elimination|sabotage`, `&size=duel|squad|war` and `&map=<id>`
(the Start a Server form; a 24v24 map picks 24v24 unless `size` says otherwise), `&room=CODE` (opens Join a
server with the code filled in; with `autostart` joins it), `&team=0|1|auto`, `&skill=0.25…0.75`, `&name=…`,
`&autostart=1`, `&server=tw|us` (the game server for this visit; Settings → Server saves a choice).
發起單挑 challenge links (`src/game/challenge.ts`): `/c?ch=<callsign>&map=<id>&beat=<kills>&ref=<share code>` (older links: `/?c=1&…`)
and `&room=CODE` when the challenger opened a private 1v1 room, plus `&utm_source=share|challenge|duel&utm_medium=share_card` (`tagLink`; unknown parameters never change what the link opens). The lobby shows 「<callsign> 向你下戰帖！」; accepting joins
the room, or plays a Solo 1v1 on that map against a bot named after the challenger when there is no room or it is
gone, full or empty. Invite links: `/r/<code>?ref=<share code>` (邀請朋友; the lobby shows 「朋友邀你一起打！」 and joins that private
room; the dev server serves `/c` and `/r/<code>` like Vercel). `?classic=1` shows the plain knife for one visit whatever the saved skin (`src/game/skins.ts`).
`/dev/viewmodel.html?weapon=knife&skin=slipper|gold|broom|knife` previews a knife skin in first person (B cycles it).
A player still on the lobby's made-up callsign (`Player-123` / `玩家123`) is asked for one before playing
(`src/ui/callsign.ts`), so the scoreboard and the server's player list carry chosen names; `&name=`,
`&autostart` and `?bench` skip the question. Choices are remembered per browser under `lawbreaker.*` in localStorage (`lawbreaker.start.*`
holds the form; `lawbreaker.crosshair` holds the crosshair style the HUD draws).

`bun scripts/roomcheck.ts ws://127.0.0.1:<port> <db>` (local only) checks Play Online with separate
identities: the same filters share a room, different maps split, Any joins a specific-map room,
`quick_join` and `join` still work, bad sizes, modes and maps are refused, and after a match fixed rooms
keep their map (and mode) while Any rooms rotate (it ends matches early with `spacetime sql`, owner-only).
`scripts/loadtest.ts` takes `--mode` and `--map` to Play Online with filters.
`bun scripts/mapcheck.ts ws://127.0.0.1:<port> <db> <map> <size>` checks two independent clients
spawn in their bases, walk to a common point without corrections, and replicate a shot that spends
ammo and damages the target. A false shot origin must be refused or replaced with the shooter's
own eye. Use `taipei 6`, `xinyi 24`, and `taipei101 6` for the replaced maps. The check stops after
180 seconds. Scripted clients and bot tests do not replace human playtesting or a device FPS check.
`bun scripts/slippercheck.ts ws://127.0.0.1:<port> <db>` (local only) checks the thrown 藍白拖 with two
identities in a private 1v1 (placed with `spacetime sql`, owner-only): no wind-up does 30, a second throw
with an empty hand does nothing, the other client's frame shows the slipper, walking onto it picks it
up, and a full wind-up kills as a knife kill.
`bun scripts/molotovcheck.ts ws://127.0.0.1:<port> <db>` (local only) checks the 燃燒彈 the same way: throwing
without one does nothing, buying one costs $400 and rides in gearJson, the other client's frame shows the bottle
and then the fire, the burst event arrives, the target burns (burn damage events) until moved out, and a second throw does nothing.
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
`/dev/soldier.html` (animation/IK pose sheet), `/dev/roster.html` (every soldier model through each movement state) and `/dev/crew.html` (a scripted skirmish; both take `?capture`, which holds the clock and exposes `window.__frame(n)` for frame-by-frame recordings on a software renderer), `/dev/viewmodel.html?ads=1` (first-person weapon),
`/dev/viewer.html?model=/assets/props.glb` (asset viewer), `/dev/vehicles.html?show=car:0,scooter:1,heli:2&focus=0&angle=front`
(drivable vehicles in a studio, with `&wrecked=1`, `&rotor=1`, `&seats=1`, `&boxes=1`; `?map=taipei&focus=3` at their map
spots; `window.__stats` gives each one's draw calls and triangles), `/dev/flyover.html?sky=overcast&live=1` (the National
Day flyover, `src/render/flyover.ts`, over Liberty Square from the memorial hall's platform, with a crowd; without `live`,
`window.__fly.frame(t)` draws pass time `t`, frame by frame for trailers). Dev-only URL flags `debuginput`,
`fixeddt` and `capture` make automated runs deterministic on software renderers; `flyover` sends the flyover over a
match every minute (not in production builds).

Third-person soldiers are Quaternius' Modular Men (`public/assets/soldiers.glb`, `soldier-anims.glb`; `bun tools/import-modular.ts`
with the pack's `Individual Characters/glTF` folder at `MODULAR_SRC`): the SWAT operator for team 0, six street-gang characters
for the Militia (`src/game/crew.ts`). The importer renames their bones to the Universal Base Characters rig's names, so the IK in
`src/render/rig.ts` drives both. `?soldiers=classic` brings back the older soldier with procedural gear; first-person arms always
use that classic soldier.

The map picker shows a picture of each map (`public/media/maps/<id>.webp`, 480×270, under 40 KB).
`bun scripts/mapshots.ts [--url <dev server>] [map …]` shoots them from the level preview through the
agent-browser CLI, with the dev server running; re-shoot a map after changing it.
The 2026-10-11 map replacement also removed the old trailers and screenshots containing the
superseded geometry, and regenerated the map thumbnails and social previews. New trailer footage
must use the authored maps. Historical commits and release titles remain unchanged; no Git history
was rewritten.

GPU-compressed textures: the surface sets (`public/assets/tex/*.webp`)
ship as KTX2 copies that the game transcodes to the GPU's own format (ASTC, ETC2, BC7…) in a worker
(`src/render/textures.ts`, three's `KTX2Loader`); the `.webp` files are the source and the fallback
(no WebAssembly, a file that fails, or `?ktx2=0`). Medium and High load `tex/<set>_<kind>.ktx2`
(1024², ETC1S; normals ETC1S tuned for normals); Low, the
phones' default, loads the `low/` copies (512², the same codecs), caps the sign atlas at 2048×1024 and anisotropic filtering at 4×. The models' own textures (soldier.glb,
weapons.glb, props.glb) work the same way since 2026-10-17: each GLB keeps a 1×1 stand-in under the
texture's name and `loadModelTextures` loads `modeltex/<name>.ktx2` (1024²), `modeltex/low/<name>.ktx2`
(512² on Low) or, without KTX2, `modeltex/<name>.webp` (shrunk to 512 px on Low).
After changing a source `.webp`, or updating three, rebuild them (about three minutes) with
[Basis Universal](https://github.com/BinomialLLC/basis_universal) installed
(`brew install basis_universal`; tested with basisu 2.50, and 2.00 built from the v2_0_2 tag):

```sh
bun install --cwd tools --frozen-lockfile
bun tools/make-ktx2.ts            # everything; or name sets: bun tools/make-ktx2.ts brick
bun tools/make-model-textures.ts  # the GLBs' textures; re-run after import-assets / import-guns write new GLBs
```

It also copies three's Basis transcoder into `public/assets/basis/`, so it is versioned like any asset.

## Deploy

Production: https://turfwar.ianhsiao.me (also https://lawbreaker.vercel.app). The GitHub repository
[`madeyexz/turfwar`](https://github.com/madeyexz/turfwar) is connected to Vercel project
`madeyexzs-projects/lawbreaker`: pushing `main` deploys production, and every push to `dev` deploys a
preview wired to the development database `lawbreaker-dev`. Releases are maintainers merging `dev` into
`main` (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

### Asset CDN

Vercel serves the pages, scripts and styles. The models, textures, sounds, fonts and map pictures (every
versioned file in `public/assets`, `public/fonts` and `public/media/maps`) come from Cloudflare at
`https://cdn.turfwar.ianhsiao.me`: the Worker `turfwar-cdn`, static assets only, which Cloudflare does not
charge or limit. Vercel's free plan counts every request and byte, and the launch week of October 2026
used most of a month's allowance on these files. Each file is at `/<content hash>/<path>`, so one URL is
always the same bytes, and the `dev` previews and production share the CDN (`src/buildtools/assetcdn.ts`).

- **When you add or change a file in those folders, run `bun run cdn:deploy` before you push** (Amp orbs
  have the credentials; on a Mac, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`). It adds the
  checkout's files and keeps every file it deployed before, so pages left open over a release still load.
- The build on Vercel reads the CDN's `index.json` and links each file it lists to the CDN. A file the
  CDN lacks is served by Vercel as before, and the build log says `asset CDN: … run bun run cdn:deploy`.
  Nothing breaks; it only costs Vercel requests until the next build after a deploy.
- Local builds, the dev server and the CrazyGames build do not use the CDN. `ASSET_CDN=<origin>` makes a
  build use one (`ASSET_CDN=https://cdn.turfwar.ianhsiao.me bun run build && bun run preview` tests it),
  and `ASSET_CDN=off` turns it off on Vercel.

### Game servers

| Use | Server | Database |
| --- | --- | --- |
| Production, the default | SpacetimeDB 2.10.2 self-hosted on **GCP, Taiwan** (`asia-east1-b`, `wss://tw.turfwar.ianhsiao.me`) | `turfwar` |
| US East (the previous production; still published, the default for new players far from Taipei, a choice in Settings → Server, read by `/admin` alone or with Taipei) | Maincloud, US East | `3d-game-c4lhd` |
| Development (`dev` previews) | Maincloud, US East | `lawbreaker-dev` |

Players pick their server in **Settings → Server** (`src/net/servers.ts`; `?server=tw|us` for one
visit): Taipei, the build's own server; or US East, where players from before
Singapore keep their saved identity and career. Without a choice, production picks by the browser time
zone (`regionServer`, since 2026-10-18): `America/`, `Europe/` (Istanbul and Moscow included), `Africa/`
and `Atlantic/` zones start on US East (CrazyGames players there measured 300–400 ms to Taipei), all
others on Taipei. A browser that already holds a Taipei identity stays on Taipei, the pick is not saved,
and a `dev` preview or local build keeps its own server. A link to a friend's room (`/r/<code>`, or a
challenge naming a room; also CrazyGames invite and "join friend" parameters) carries `s=us` when the
room is on US East and opens on the room's server for that visit (no `s` = Taipei; `linkServer` in
`src/game/challenge.ts`, `followLink`). A `sg` saved in a browser (from when Singapore was a
choice) silently falls back to the default and is rewritten, and `?server=sg` is ignored (`?stdb=` /
`?db=` can still point a build at any server, for development). Taipei began on 2026-10-07 as a copy
of Singapore, signing keys included, so a player's identity is the same on Taipei; each server keeps
its own stats.
The lobby switches at once, a match in progress stays on its server, and `play_clicked` /
`match_joined` carry `server_choice`. A `dev` preview's own server is `lawbreaker-dev` (offered with
US East).

The Taipei server (`deploy/gcp-taipei/`, GCP project `game-turfwar-ianhsiao-me`, VM `turfwar-tw`, an
e2-small with 2 GB of swap and a 20 GB disk, static IP 34.81.41.144) runs the container built from
`deploy/instacloud/Dockerfile` (with `start.sh`'s pruning) on `/var/lib/turfwar`, behind
Caddy (HTTPS from Let's Encrypt for `tw.turfwar.ianhsiao.me`, a Cloudflare DNS-only A record, and
`34-81-41-144.sslip.io`). It is always on (no scale-to-zero): roughly US$18–20 a month plus
traffic, under the project's NT$1000 budget alert. Request round trip from Taipei ~12–35 ms
(Singapore ~125–160 ms). To work on it: `gcloud compute ssh turfwar-tw --zone asia-east1-b
--project game-turfwar-ianhsiao-me`, then `sudo docker logs turfwar-stdb`; `setup.sh` (re)installs
Docker, Caddy and the image (`HOSTS="…" sudo bash setup.sh`), `run.sh` (re)starts the container.
The disk has a daily snapshot schedule (`turfwar-daily`, 19:00 UTC, kept 7 days); take one by hand
before risky work with `gcloud compute disks snapshot turfwar-tw --zone asia-east1-b`. `setup.sh` leaves
the image built; `sudo docker builder prune -af && sudo docker image prune -af` frees the build layers.

Singapore (InstaCloud, production before Taipei) was retired and deleted on 2026-10-11, and its data is gone.
The game has no code for a sleeping or stopped server: every server it offers is always on, so a
failed ping or connect is just "can't reach it" (normal "connecting" copy, retries for 30 s, then
"Can't reach the server" with Retry; `src/net/connect.ts`). The Taipei container is built from
`deploy/instacloud/` (a slim image with SpacetimeDB's two binaries; the folder keeps its old name).
`start.sh` supervises the server: SpacetimeDB never
deletes its commitlog (100 players write ~12 GB an hour, ~3x smaller once sealed), so once the data
passes 4 GB and nothing has been written for 2 minutes it restarts the server around
`prune-commitlog.sh` (a few seconds), and past 8 GB it does so even mid-match. Measured before
launch: 100 headless players in nine 6v6 rooms held 30 ticks/s; reducer round trip from Taipei
~112 ms (Maincloud ~206 ms); ~21 KB/s down per player.

The owner identity lives outside the repo in `~/.config/turfwar/` (made once with
`deploy/instacloud/owner.sh <server-url>`, in its own CLI profile `instacloud-cli.toml` so the Maincloud
login is untouched; its server `taipei` is added by `deploy/publish-prod.sh`). Back that folder up: the
identity that published `turfwar` is the only one that can update it. To rebuild or reconfigure the
container, see `deploy/gcp-taipei/` above.

Vercel production build variables are `VITE_SPACETIMEDB_URI=wss://tw.turfwar.ianhsiao.me` (Taipei) and
`VITE_SPACETIMEDB_DATABASE=turfwar`. The client keys saved identities by server (`serverIdentityKey` in
`src/net/ping.ts`; the key is still named `instacloud-singapore`, because Taipei took over Singapore's
identities), so both of Taipei's hostnames (`tw.turfwar.ianhsiao.me` and its sslip.io name) keep every player.
`scripts/wsping.ts` measures the round trip but registers a `probe` player (its `hello`): delete that row after
running it against production. Do not use `same-origin` on Vercel; that proxy exists only in the
development server.

For module updates, run tests and module type checks, then publish non-destructively to production
(Taipei, then the legacy Maincloud database; `deploy/publish-prod.sh`):

```sh
bun run test && bun run build && bun run typecheck:module
bun run publish:prod                 # or: bun run publish:prod -- tw   (Taipei only)
```

The dev database is published by hand:
`spacetime publish lawbreaker-dev -s maincloud -p spacetimedb --delete-data=never -y`.
Stop if schema changes require deletion; never use the local development script for cloud
publication. On an existing empty starter database, the first valid join initializes the match
atomically; subsequent joins preserve its state. Publish the compatible module before pushing
the matching commit to `main`, which triggers Vercel's GitHub deployment.
Verify the production URL and two separate Online clients after each release.
Then run `bun run seo:ping` (sitemap to Google and Bing, the public pages to IndexNow; docs/SEO.md, "Search data").

### CrazyGames build

The game is also uploaded to CrazyGames (developer.crazygames.com) as a zip of static files. It is built on the
Mac, not on Vercel, so give it the production server and PostHog variables, as Vercel's production build has
them. `vite build --mode crazygames` reads `.env`, `.env.local`, `.env.crazygames` and `.env.crazygames.local`
(not `.env.production*`). Keep the values in `.env.crazygames.local` (gitignored by `.env*`; the key is the
public `phc_…` project token in Vercel's `VITE_POSTHOG_KEY`, also visible in the production bundle):

```sh
VITE_SPACETIMEDB_URI=wss://tw.turfwar.ianhsiao.me
VITE_SPACETIMEDB_DATABASE=turfwar
VITE_POSTHOG_KEY=phc_…
VITE_POSTHOG_HOST=https://us.i.posthog.com
```

Then run `bun run build:crazygames` (or pass the four variables on its command line). The build stops with an
error when one is missing, when the key is not a `phc_…` key or when the URI is not `wss://`: without them the
upload connects to no server and sends no PostHog events (CrazyGames players were missing from PostHog until
2026-10-18 for this reason). The website build and the dev servers do not check them.

This writes `dist-crazygames/` and `turfwar-crazygames.zip` (`vite build --mode crazygames`, vite.config.ts):
the game page only, every URL relative (`base: './'`; CrazyGames serves it from its CDN under an unknown
path), no service worker, info/privacy/admin pages, search metadata or Vercel Web Analytics, and the
CrazyGames SDK script in the head. Upload the zip in the developer portal. The players share the
production databases with the website, so the module and this build must stay compatible like the website.

`src/crazygames.ts` holds the `CRAZYGAMES` flag and the SDK wrapper; every call is a no-op on the website,
when an ad blocker stops the script, and outside CrazyGames' domains. In that build:

- loading start/stop (bootstrap and the lobby), gameplay start/stop from the game loop (playing unless the
  match has ended or the menu is open), and a midgame video ad when a player leaves a finished match (the SDK
  keeps ads 3 minutes apart; none during Basic Launch);
- a new player's first visit (no warm-up stored, no rounds on this browser, not arriving by an invite, a challenge,
  a room code or "Play with friends") starts by itself, without the lobby, in a Solo warm-up on Taipei 101: 6v6
  Elimination, first to 4 rounds, bots at skill 0.2 on top of the rookie easing; a notice says it is against bots,
  Esc leaves it as any match, and its end screen offers **Play online** (Quick Play). Since 2026-10-19, because
  players without a kill left after a median 46 s and those with one after about 4 minutes (Basic Launch, desktop
  conversion and playtime); `play_clicked` has `kind: warmup` for it;
- textures load half-size first (the Low preset's `low/` KTX2 copies, at any preset; `lowFirst` in
  src/render/textures.ts) and the preset's own replace them one file at a time 15 s after the lobby is ready
  (`sharpenTextures`): a first visit on Medium downloads 9.7 MB before its first match instead of 16.6 MB
  (measured 2026-10-19 on the warm-up; the other 10.8 MB follow in the background);
- CrazyGames' Data module keeps `SAVED_KEYS` (src/crazygames.ts: progress with the daily streak, the warm-up flag,
  skins, key bindings, crosshair; never the game ID): restored before the game reads its storage (bootstrap; the
  progress with more XP wins), saved on progress, every 30 s and on page hide. It works only when the submission's
  **Progress Save** is "Data Module"; otherwise the module throws once and the game keeps local saves only. The
  submission uses **"LocalStorage" (Automatic Progress Save)** since 2026-10-21: with "Data Module" (20–21 Oct)
  CrazyGames stopped restoring localStorage, so returning players lost their callsign, game ID and settings
  (`has_prior_storage` fell from ~30% to ~0) and PostHog D1 broke. Keep it on LocalStorage;
- the platform's `muteAudio` and `disableChat` settings, its locale (unless the player chose a language) and,
  for a logged-in player, the CrazyGames username as callsign; the callsign prompt is skipped;
- invite and challenge links become CrazyGames invite links (`r` room code, `c` challenge; no UTM tags),
  read back at boot and by the join-room listener; a private room is reported with `updateRoom`; instant
  multiplayer opens the invite room;
- no links back to the playable website (GitHub, about pages), no install hint and no fullscreen key (the site
  has its own button); the privacy page is linked on the website, with a first-visit notice in the lobby;
- analytics events carry `platform: crazygames` (`web` on the website).

Try it locally with `bun run dev:crazygames` (or the built zip from any static server under a subpath): on
localhost the SDK runs in its `local` mode, which logs its calls ("HTML5 SDK"), shows fake ads, and takes
`?czy_invite=true&r=<CODE>`, `?disableChat=true` and `?muteAudio=true`.

### Recording

Match recording (bot training and the licensed dataset) has its own services: the Cloudflare Worker
`turfwar-rec-ingest` at `rec.turfwar.ianhsiao.me`, the recorder and its hourly processor on the Taipei VM,
and the R2 buckets `turfwar-rec` and `turfwar-export`. How they work, their keys, deletion, the recount and
the export: [docs/RECORDING.md](RECORDING.md). Deploy the Worker with `bun deploy/cloudflare/rec-ingest/deploy.ts`
and the VM side with `deploy/gcp-taipei/recorder/deploy.sh`; a release that changes the frame format or the
recording formats must update the recorder in the same release.

### Orb credentials

Amp orbs get the deploy credentials as Amp secrets. `.agents/setup` installs the clients (bun
dependencies, `spacetime` 2.10.2) into the shared snapshot, which never holds a credential;
`.agents/resume` logs them in from the secrets each time an orb starts. A missing secret just skips
its tool. Releases still need the owner's go-ahead (see AGENTS.md).

| Secret | Scope | Gives the orb |
| --- | --- | --- |
| `SPACETIME_MAINCLOUD_TOKEN` | personal | default `spacetime` config: `lawbreaker-dev` and `3d-game-c4lhd` on Maincloud (the default server stays `local`); expires 2028-10-03 |
| `TURFWAR_OWNER_TOKEN` | personal | `~/.config/turfwar/instacloud-cli.toml`, so `bun run publish:prod` works unchanged |
| `TURFWAR_TW_SSH_KEY` | personal | `ssh turfwar-tw` (user `amp`, sudo, instance metadata of VM `turfwar-tw`) |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | project | not set (optional): `bunx vercel ls` and friends, no login or link needed. Without them, `gh api repos/madeyexz/turfwar/deployments` lists preview URLs |
| `TURFWAR_ADMIN_KEY` | project | the `/admin` login |
| `POSTHOG_PERSONAL_API_KEY` | project | read-only queries on PostHog project 649207 |
| `GSC_SERVICE_ACCOUNT_JSON` | project | `bun run seo:report` / `seo:ping`: Google Search Console API on `sc-domain:ianhsiao.me` (service account of Google Cloud project `turfwar-seo`, Full user) |
| `BING_WEBMASTER_API_KEY` | project | the same scripts' Bing Webmaster Tools API (site `https://turfwar.ianhsiao.me/`) |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | project | R2 buckets, account API tokens, the ingest Worker and the asset CDN Worker (`bun run cdn:deploy`) with their routes/DNS on `ianhsiao.me` (docs/RECORDING.md) |
| `REC_SALT` | project | the recording pid salt (also a Worker secret and in the VM's `/etc/turfwar-rec/env`); never rotate it without a plan |
| `R2_REC_VM_*`, `R2_REC_READ_*`, `R2_REC_EXPORT_*` | project | R2 S3 keys (`_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`): VM read/write, read-only, export (docs/RECORDING.md) |

Set or rotate one with `amp secrets set NAME --user|--project ianhsiao/turfwar --secret --data-file -`
(value on stdin), or in Amp Settings; never paste a value into a thread. Read-only checks: `spacetime list
--server maincloud`, `spacetime --config-path ~/.config/turfwar/instacloud-cli.toml login show`,
`ssh turfwar-tw 'sudo docker ps'`, `bunx vercel ls`, and
`curl -H "Authorization: Bearer $POSTHOG_PERSONAL_API_KEY" https://us.posthog.com/api/projects/649207/`.

## Search and AI-answer visibility

`/about` and `/en/about` (static pages, built like `/privacy`), the head tags and JSON-LD in `index.html`,
`public/robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt` and the previews in `public/og/` (`bun tools/og/make.ts`)
make the game findable and correctly described; `src/seo.test.ts` checks them. What was done, how to verify it,
the keyword list and the owner's checklist (Search Console, Bing Webmaster Tools, mentions) are in [SEO.md](SEO.md).

## Players, analytics and the admin page

### Client error tracking and private source maps

`client_error` remains available for existing queries. Code errors also send `$exception` to
PostHog Error Tracking, including early errors and caught boot failures (`kind: boot`). The old
boot `error_shown` event is replaced by this pair. Reports share a five-message budget per page;
opaque `Script error.` has one separate report with uptime/visibility context. WebGL loss remains
a `client_error` (`webgl_lost` / `webgl_restored`, with timing, visibility and drawing context; see the event list below). `src/exceptions.ts` cleans known secrets and URL queries/fragments; never put user
input in exception messages. Error events drop inherited callsign, room, attribution and person-set
properties. They retain anonymous SDK identifiers, build, server, browser and in-app context.
Do Not Track, Global Privacy Control and all existing automation exclusions still apply.

Vite creates hidden source maps. The final build step always deletes them from `dist`, even if an
upload fails or credentials are absent. Cleanup failure fails the build rather than publishing maps.
Upload is optional and non-fatal; without both credentials it is silent. Configure these **private
build variables**, never `VITE_*`, in Vercel Production and the `dev` Preview scope:

| Variable | Value |
| --- | --- |
| `POSTHOG_CLI_API_KEY` | Personal API key with source-map upload access, from PostHog Settings → User → Personal API keys |
| `POSTHOG_CLI_PROJECT_ID` | `649207` |
| `POSTHOG_CLI_HOST` | `https://us.posthog.com` |

The pinned `@posthog/cli@0.18.10` processes maps with release name `turfwar` and version equal to
`app_version` (git SHA). It injects chunk IDs before upload; deploy these processed bundles.
Use Error Tracking → Issues; exclude `test: true` events (`properties.test is null` in SQL), then
filter by `app_version`, `kind`, `server_host` and `in_app`. Configure issue alerts in PostHog and
connect the desired Slack/webhook/email destination in project integrations. The owner must enable
and test those integrations; source-map upload alone does not enable alerts.

Verification must distinguish a parsed local stack from actual PostHog symbolication. After owner
setup, use a private preview to throw an intentional bundled error and confirm that its issue shows
the original TypeScript file and line. Do not claim resolved production stacks until that succeeds.

### Server errors and optional Taipei watcher (owner setup)

`server_error` is a new private table, capped at 200 rows. `admin_errors` returns rows only to
authenticated admins. `/admin` → Errors subscribes separately, so older modules show “unavailable”
without breaking the dashboard. A row contains ingestion time, source `runtime`, and a fixed
panic/ERROR count summary. It does **not** identify the failing reducer or contain a raw stack.
The owner must inspect VM logs for details. Failed reducers retain their normal rollback behavior:
writing an error row then rethrowing would roll the row back too. The host watcher writes summaries
through `record_server_error` in a separate transaction, using an authenticated admin identity.
Without the watcher, this table does not collect failures automatically. Module logs not emitted
to Docker stderr/stdout are outside this watcher's coverage; use `spacetime logs` for those.

No module publish is part of a frontend build. **Needs the owner**, after approval, from the reviewed
checkout (stop on destructive migration requirements; never reset data):

```sh
# Development first, when authorized:
spacetime publish lawbreaker-dev --server maincloud --module-path spacetimedb --delete-data=never -y
# Production only in a separately authorized release, using the owner's saved profile:
bun run publish:prod
```

After publishing, verify admin vs non-admin access with two identities, send a monitor test summary,
and confirm the Errors list updates. No module was published as part of implementing this feature.

The optional Python 3 watcher is `deploy/gcp-taipei/watch-errors.py`. Install it on the VM as
`/usr/local/lib/turfwar/watch-errors.py`. Create root-only `/etc/turfwar/errors.env` (mode `0600`):

```sh
WEBHOOK_URL='https://your-slack-or-discord-webhook'
# Optional: enables the private database summary in addition to the webhook.
ADMIN_TOKEN='token-of-a-dedicated-signed-in-admin-session'
```

Keep this file outside Git. An absent file or empty webhook URL is a silent no-op. The webhook must
use HTTPS. For database writes, sign a dedicated browser session in to Taipei `/admin` through
the existing rate-limited login. Its SpacetimeDB token is in browser local storage under
`lawbreaker.admin.token:<server-uri>:turfwar`. Transfer it privately to the env file; never paste
it into chat or use the database owner's publishing token. Revoking admin sessions disables its
writes until it signs in again. The database target is fixed to local `127.0.0.1:8080`, database
`turfwar`; the token is never sent to the webhook. Add this to root's crontab only after approval:

```cron
* * * * * /usr/bin/python3 /usr/local/lib/turfwar/watch-errors.py
```

The watcher uses a lock and persistent per-destination cursors in `/var/lib/turfwar/error-watcher`.
It scans at most 2000 Docker log lines per interval, starting with the last minute on first run.
It sends only counts, never log content. A failed delivery leaves its cursor for retry; a crash
after delivery but before cursor save can duplicate a summary. Bursts over 2000 lines can be
undercounted. Alerts are best-effort, not a complete incident archive. Monitor cron failures too.
Test its logic with `python3 deploy/gcp-taipei/test_watch_errors.py`; this does not contact a VM or
webhook. Installation, credentials, scheduling and live delivery tests remain owner actions.

Players stay anonymous (no login). The player-facing summary is the privacy page (`privacy/index.html`,
served at `/privacy` and linked from the lobby, in English and 繁體中文): change it in the same commit
whenever what is collected changes. These answer "how many players, and from where":

- **PostHog** (US cloud, project 649207; `src/analytics.ts`): `VITE_POSTHOG_KEY` (public `phc_…`
  token) and `VITE_POSTHOG_HOST` are set in Vercel for Production and for Preview on `dev`.
  posthog-js (slim build, no external scripts) loads lazily once the lobby is up. Autocapture and
  recordings are off; `$pageview` / `$pageleave` stay on; Do Not Track is respected; PostHog derives
  the country from the IP on its side. Events: `lobby_view`, `play_clicked`, `match_joined`,
  `match_left` (also on tab close, by beacon; `exit` says how: `menu_button`, `end_screen`, `leave_key`,
  `removed`, `afk` (the server removed us for no real action for 90 s, docs/ARCHITECTURE.md "AFK kick"), `lost` (the connection dropped and the room could not be rejoined), `rejoined` (it dropped and we came straight back to the same room; `lost` counted these too until 2026-10-11) or `close`), `round_ended`, `vehicle_entered`, `store_purchase`,
  `share_card_opened` / `share_card_shared` (`method`: `native` card + link through the share sheet, `link` link only through it, `copy`, `download`, `line`, `threads`), `duel_clicked` (約朋友單挑, `via` `room` or `link`), `challenge_link_opened` / `challenge_started` / `challenge_completed`, `invite_opened` / `invite_sent` (`method`: `line`, `threads`, `copy`, `native`) / `invite_link_opened` / `invite_joined` (`joined`: the room was there) for 邀請朋友, `callsign_asked` (a new player was asked for a callsign; `play_clicked` follows only when they answer), `language_changed`, `discord_clicked` (the lobby's Discord button), `lobby_ready` (`boot_ms`: page open → the models and shared textures loaded, once a page; since 2026-10-18 Play works before that; since 2026-10-19 a failed load is tried twice more, 1.5 s and 3 s later, and `retries` says how many failed first; since the release after 3c3f6e2 it is tried until it loads (every 1.5 s × tries, at most 10 s, sooner when the browser comes back online or the page into view), the third failure is reported once as a `boot` `client_error` with `file` (host and path of the first file that failed), `uptime_s`, `visible`, `hidden_while_loading`, `online` and `sw` (a service worker controlled the page), and Play waits with "connection trouble, still trying" instead of repeating the failure), `first_kill` (this browser's first kill ever, once; person property `first_kill_at`), `error_shown`, `connect_slow` (the lobby's connection took over 6 s or needed a retry after a failed ping or connect: `seconds`, `queued`, `failures`, `reconnect` and the split of the wait, `ping_ms`/`ping_ok` (first ping), `connect_ms`, `import_ms` (SDK chunk load). Until 2026-10-12 this was called `server_woke` and the lobby also showed an "asleep" screen for it; Singapore is gone from the game, so the event and screen are gone. The first week's ~920 `server_woke` events are therefore slow connects, almost all on Taipei, which is always on, plus 7 Oct's real Singapore wake-ups, and a query for the whole period should read both names), `net_sample`, `bench_result` (the 30-second performance check, `?bench`: map, preset, drawing-buffer `resolution`, `gpu`, `avg_fps`, `low1_fps`, frame-time `median_ms`/`p95_ms`/`p99_ms`/`max_ms`, `slow_frames` (% over 60 Hz), `cpu_median_ms`/`cpu_p95_ms`, `draw_calls`, `triangles`, `shader_compiles`, `hitch_count` (frames over 100 ms) and `hitch_compiled` (of those, with a shader compile), `meets60`; a `?bench` page sends this event only, no page views or errors), `client_error` (the page's own failures:
  uncaught errors, promises nobody caught and a lost WebGL context, at most 5 a page, `src/errors.ts`; a "Script error." the browser gives no details of is sent once a page apart from those 5, with `source: opaque`, `uptime_s`, `standalone` and `visible`; a lost WebGL context, `kind: webgl_lost` (the first of a page) and each `webgl_restored` (up to 10 a page), says when and on what since 2026-10-17: `uptime_s`, `visible`, `visible_s` (seconds since the page last came into view: near 0 is a phone back from the background, large is a loss in plain view), `standalone` (lost), `lost_ms`, `frame_ms` (the first frame after the restore) and `losses` (restored), `quality`, `pixel_ratio`, `canvas` (drawing-buffer size) and `map`), (`match_joined` also says `private` (the room has a code), `hosted` (we opened it with 約朋友單挑) and `wait_ms` (Play pressed → in the match; since 2026-10-18 Play works while the models load, so an early press includes the rest of their loading); `match_left`'s `seconds` is the stay with the tab in view and `hidden_s` the time it sat hidden, and its `kills` / `deaths` sum every match of the stay (until 2026-10-16 `seconds` included hidden time, so a tab left open in the background claimed hours or days, and `kills` / `deaths` were only the last match's scoreboard, often 0/0 after a long stay; filter those older rows, e.g. `frames / fps` against `seconds`); `match_left` also carries `fps`, `fps_low` (1% low) and `frames` for the match, and how it was drawn: `gpu` (WebGL's unmasked renderer string, at most 160 characters; on Windows Chrome it names the card and the backend, e.g. `ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 …)`, and shows a software renderer such as SwiftShader), `quality` (preset), `pixel_ratio` (drawn at when leaving) and `dpr_scale` (the adaptive resolution's scale, 1 = never stepped down); rooms that found an opponent: hosted `room` codes with a second person's `match_joined` on the same code), with super properties `lang`, `app_version` (git SHA),
  `online_db`, `screen` and (`src/visit.ts`, `src/game/device.ts`) `in_app` (the app whose built-in browser it is: Threads, Instagram, Messenger, Facebook, LINE, TikTok…), `visit_n`, `has_prior_storage`, `storage_ok`, the first-touch `first_utm_*` / `first_referrer` / `first_touch_at` / `first_gclid` / `first_fbclid` and this visit's `visit_utm_*` / `visit_referrer` (UTM naming rules and links to post: [UTM.md](UTM.md); `withUtm` in `src/utm.ts` tags the links the game makes). Online, the person property `stdb_identity` links a PostHog person to
  a SpacetimeDB profile. Nothing is sent without a key, under `?trailer`, `?capture`,
  `?fixeddt`, in headless browsers (`navigator.webdriver`), or from the dev server unless the URL
  has `?analytics`; dev events then carry `test: true` and a `dev-test-…` distinct id (and are
  printed to the console as sent).
- **Vercel Web Analytics** (`inject()` at the top of `src/main.ts`): cookieless page views and visitor
  counts for the game page (not `/privacy` or `/admin`); the dev server only logs them.
- **SpacetimeDB** keeps the ground truth in the private table `player_seen` (first and last seen,
  sessions, time zone, language, callsign per identity; `player_day` per active day; `player_hour` per
  active hour, kept two weeks), filled by the
  join reducers, `hello(tz, lang)` (sent once per connection) and the connect lifecycle.
  **Online play time** (`shared/playtime.ts`) lives in the private tables `player_time` (seconds
  per identity, plus `since`, the start of the stretch not yet credited) and `player_day_time`
  (seconds per identity per UTC day). Entering a room opens a stretch; leaving, disconnecting, the
  idle kick (up to when the player went quiet), the AFK kick (up to the last real action) and the room closing credit it. Each room's tick
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

**Admin page** (`/admin`, `admin/index.html`, not linked from the game, `noindex`): one section per
question, shown one at a time from a sidebar on the left (grouped Overview, Growth, Operations, Reference; the URL's
`#section` keeps the choice across reloads and Back; on narrow screens the sidebar folds into a bar on top).
The sidebar's server switcher (`src/admin/servers.ts`) opens on **All production** on a Taipei build: Taipei and
US East added together (`src/admin/merge.ts`), with one connection, identity and login per server (one admin key
logs in to both). Each server can also be picked on its own (and Maincloud dev). Together, counts and room-hours add
up; identities are per server, so a person who played on both counts once on each; each hour's peak is the two
servers' peaks added, an upper bound; a window is covered only from the later server's first recorded day; a view
either module lacks shows as missing. The Live rooms, Errors and Players tables gain a Server column.
All calendar days and timestamp labels use **Taipei (UTC+8)**, independent of the viewer's browser time zone.
A day begins at **00:00 Taipei, exactly 16:00 UTC on the preceding date**; epoch-hour keys remain unchanged.
Elapsed-time windows (24 hours, activation's first 24 hours, play durations and cooldowns) are not calendar days.
The private tables `taipei_player_day`, `taipei_player_day_time` and `taipei_player_day_net` collect separate
Taipei daily activity, play seconds and connection quality, exposed only to authenticated admins through
`admin_taipei_player_day`, `admin_taipei_player_day_time` and `admin_taipei_player_day_net`.
The private `taipei_coverage` table persists the first collecting transaction's `startedAt`;
`admin_taipei_coverage` exposes it to admins. Opening a view does not start or move coverage.
If collection starts mid-day, the first fully covered day is the next Taipei midnight; if it starts exactly
at midnight, that day is covered. The UTC daily tables and views remain intact.

History from before Taipei collection is rebuilt once per database by `admin_rebuild_taipei_days` (admins only;
`TURFWAR_ADMIN_KEY=… bun scripts/taipei-rebuild.ts <wss://server> <db>`; a second call is refused). Taipei is a
whole-hour offset, so every Taipei day whose hours are all in `player_hour` (kept two weeks) is rebuilt
**exactly**; the launch days before hourly records are **estimated** from the UTC-day rows (a UTC day counts on the
Taipei day holding 16 of its 24 hours, or on the true Taipei day of the player's firstSeen when that falls in it;
the UTC day straddling the first exact day keeps only what its hourly-covered late hours do not explain). It merges
with live Taipei rows (union of days, the larger play time, the fuller ping record), moves `taipei_coverage` back to
the first exact day, and records both boundaries in private `taipei_rebuild` (`admin_taipei_rebuild`). Production
Taipei: hourly records began 2026-10-10 00:00 Taipei (the first ~25 minutes predate the module), launch days
2026-10-06 to 10-09 are estimated. The dashboard draws estimated days faint and says so in their tooltips; rolling
windows (MAU) start at the first recorded day and are faint until 30 days are recorded. Before a database is
rebuilt, days before its coverage show as gaps.

It opens on **Key metrics** (`src/admin/activity.ts`, charts in `src/admin/chart.ts`):
KPI tiles (value, change against the period before, sparkline) and charts for **DAU** (players with a `taipei_player_day` row on
the Taipei day: they said `hello`, reconnected or entered a room, so Solo-only players never count), **MAU** (rolling: players
active on any of the 30 Taipei days ending that day; faint while the window reaches back before the first recorded day),
DAU/MAU, **CCU per hour** (humans in Online rooms; the average at once is `room_hour` human-minutes ÷ 60, sampled
once a minute per live room, falling back to `player_hour` play time ÷ 3600 for hours before `room_hour` began; the peak
at once is `peak_hour`) and **PCCU per day** (the highest `peak_hour` of the Taipei day, with launch-week peaks rebuilt from
PostHog where nothing was recorded), plus a card naming each source and the first record the server has. An **Active user** switch above the tiles sets what DAU,
MAU and DAU/MAU count: **Joined** (the `taipei_player_day` definition above) or at least **3, 5 or 10 minutes** of Online play on the
Taipei day, summed over the day from `taipei_player_day_time` (today adds a match still in progress; lobby time, Solo and Practice never
count). It opens on 5 min+ and is remembered per browser with the chart controls (`qualifying` in `src/admin/activity.ts`). All of it is
computed in the page from existing admin views. Every chart has one shared tooltip: hover a day or hour, or focus the
chart and use ←/→. Then the **Scorecard** (`src/admin/growth.ts`): one headline figure per
funnel stage graded against `TARGETS` (on track / watch / problem), what to look at when it is off, and a "Focus
first" banner naming the earliest stage in the funnel with a problem. Then **Now** (online, active 24 h, peak today and ever,
live rooms), **Acquisition** (players, new and active with the change from the period before, active 30 days = MAU, a
30-day chart of returning and new players per day, countries, and a **Channels** table: new players by in-app browser
or first-touch source with their kill-in-24 h, D1, D7 and median play), **Activation** (the first 24 hours: connected
→ entered a room → finished a round → made a kill → finished a match → came back, All / Phone / Computer, the biggest
leak marked), **Retention** (cohorts, and **Who comes back**: D1 and D7 by device and channel), **Engagement** (play
time, minutes per active day, the 30+ round core and players by rounds played), **Virality** (K-factor, sharers,
invites per sharer, invite → player, top sharers), **Server health** (drops, and kicks per join: idle and AFK, human share of
seats, humans per room, wait to match, a fill/drops chart), **Quality** (median fps and 1% low, players under 30 fps,
page load, fps bands, fps by in-app browser, then ping and devices), **Benchmarks** and **Players** (a sortable list:
play time, active days, rounds, matches, kills, fps, channel …, with an All / Phone / Computer switch), for the
server picked at the top (the build's own by default). **Growth metrics** (`shared/metrics.ts`, client side
`src/growth.ts`), private tables each with an admin-only view: `player_perf` (from `perf_stats`, sent with the 2-minute
connection report and on leaving: median fps and 1% low weighted by seconds, wait from Play to the match, page load;
one per 30 s, clamped; a frame over 1 s is a gap, not a frame, so software-rendered orbs report no frame rate),
`player_source` (from `visit`, once per connection after `hello`: first touch, in-app browser, own share code, the
share code that brought them, running share and duel counts that may only grow; `admin_player_source` turns codes
into counts), `player_milestone` (first room, round, kill and finished match, stamped by `enter_room` and the tick's
career-stat fold; 1 = before the table existed) and `room_hour` (per hour: room-, seat-, human- and bot-minutes from
each room's minute flush; joins, leaves, drops when a connection closes in a room, idle kicks), with AFK kicks per hour
in `afk_hour` (`admin_afk_hour`, joined by hour on the page). Everything is online
play only. Local check (separate identities, ~1 minute):
`ADMIN_TEST_KEY=<test key> bun scripts/growthcheck.ts ws://127.0.0.1:<port> <db>`. **Peak online** (peak CCU, `src/admin/peak.ts`): the private table `peak_hour` keeps, per
hour since the epoch, the most players in rooms at once (all, and Phone and Computer by each player's latest device
report) and when the all-player peak was reached; entering a room (the only time the count rises) and each room's
minute flush raise it, and it is kept (24 rows a day). The view `admin_peak_hour` feeds the Peak today / ever
tiles and Key metrics' PCCU and hourly CCU (tick: the average at once, from play time; dashed line: 12, one full
6v6 room). Local check: `ADMIN_TEST_KEY=<test key> bun scripts/peakcheck.ts ws://127.0.0.1:<port> <db>`.
**Benchmarks** (`src/admin/benchmarks.ts`): this server's MAU, DAU, peak CCU and lifetime players (all, and on a
Taiwan time zone) against BeGone's estimated Taiwan peak, the estimate's funnel and evidence (nplay.com in the
Wayback Machine), and Turf War's launch-week peaks rebuilt from PostHog before `peak_hour` existed. Days are Taipei days. **Phone and Computer side by side**
(`src/admin/groups.ts`): every figure shows All, Phone and Computer, and the 30-day charts draw a Phone
and a Computer bar each day. A player's side is the device they last played on (`admin_player_device`;
phones and tablets are Phone; players without a report count only in All), and per-day figures use it
for every day. The daily play time and ping come per player from the views `admin_taipei_player_day_time` and
`admin_taipei_player_day_net` (from the separate Taipei tables), subscribed separately like the rest.
**Chart controls** at the top right of the content (remembered per browser): the range, 90, 30 or 7 Taipei days or the last
48 hours (hourly, labelled in Taipei time; Key metrics' daily charts show at least 7 days and its CCU chart is
always hourly over the range), and Split (Phone and Computer side by side) or
Combined (everyone in one bar; the cohorts become one table). Hours come from the private table
`player_hour` (per identity per hour since the epoch: a row when the player was seen, play time split
on the hour by shared/playtime.ts, connection reports folded like `player_day_net`), read through the
view `admin_player_hour` (the 168 hours up to the latest); the rooms' minute flush deletes rows older
than two weeks. **Retention** (`src/admin/retention.ts`) comes from the view `admin_taipei_player_day` (every Taipei day
each player was active, from `taipei_player_day`; subscribed separately: a database without it shows "—"):
the share who came back on any later day, classic day-N retention (back exactly 1, 3, 7, 14 or 30 days
after their first day) pooled over every cohort whose day N is over, and a table of the last 14 days'
cohorts. **Release flags** on the 30-day charts mark the days `main` got a release (hover for what
shipped): the build reads `main`'s first-parent "Release…" commits from git and adds the snapshot in
`src/admin/releases.json`, since Vercel's clone is shallow; release days and tooltip hours use Taipei time. Refresh it with `bun scripts/releases.ts`
on `dev` now and then (after a release is fine) and commit it. Connection quality adds a
PING column (typical p50, coloured; hover for p95 and worst p95) and CORR/MIN to the player list,
median ping cards (24 h, 7 d) and corrections per minute, ping by country and a 30-day ping chart, from
the views `admin_player_net` (lifetime) and `admin_taipei_player_day_net` (daily, aggregated in the page; subscribed separately: a database without them
shows "—"). A DEVICE column (Phone, Tablet or Computer; hover for connections per kind) and a Devices
card (share of players by the device they last played on, last 7 days and all time) come from the view
`admin_player_device`, subscribed separately the same way. Play time comes from the
views `admin_player_time` (lifetime) and `admin_taipei_player_day_time` (daily), joined to `admin_players` by the short id: new
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
