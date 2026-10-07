# 角頭械鬥 · Turf War: Taipei

Browser-first round-based team FPS modelled on BeGone (nplay): Elimination and Sabotage,
cash and a store, attachments, 1v1 / 6v6 / 24v24 rooms. Repository:
`https://github.com/madeyexz/turfwar`. `README.md` is the public overview and asset attribution;
`docs/GAMEPLAY.md` (rules, weapons, maps, vehicles, controls), `docs/ARCHITECTURE.md` (multiplayer,
performance, known limits, layout) and `docs/DEVELOPMENT.md` (flags, check scripts, deploy, analytics,
admin, demo script) hold the deep detail.
Improve playable gunplay, map flow, animation, and multiplayer—not only the HUD.

**Read `CONTRIBUTING.md` before changing code; it holds the branch/PR workflow and checks for outside
contributors.** Outside contributors fork, branch from `dev` and open pull requests against `dev`.
Maintainer agents work as documented below instead: branch off `dev` and merge back with git, no pull
requests.

## Stack

- **Bun 1.3.10** for packages and scripts. Use `bun` / `bunx`, never npm/npx.
- **TypeScript + Vite + Three.js** for the browser. No React or Unity runtime.
- **Shared TypeScript simulation**, used by Solo and the server. Rapier was removed
  in the rebuild; do not assume the original prototype's physics engine remains.
- **SpacetimeDB 2.10.2** TypeScript module and client SDK for Online matches.
- **Vitest** for tests.
- **Vercel** serves the built frontend (static; there are no serverless routes).
- GLB characters/weapons and animations from CC0 Quaternius packs (store guns from the
  CC0 Ultimate Gun Pack via `tools/import-guns.ts`); CC0 Poly Haven
  textures; Rajdhani font under OFL. Keep license files and attribution intact.

## Where code belongs

- `shared/`: environment-independent simulation, collision, movement, hit volumes,
  weapons, attachments and prices, thrown bodies, drivable vehicles, and map definitions (with ammo crates, bomb sites, ladders and vehicle spots). No browser APIs here.
- `shared/match/`: match state, combat validation, economy (cash, store, crates), rounds and the bomb, bots,
  navigation, the packed per-tick frame, and the simulation tick.
- `src/game/`: client loop, player prediction/input, Solo link, settings, performance check.
- `src/net/online.ts`: SpacetimeDB connection, replicated state, interpolation, and intents.
- `src/analytics.ts`: PostHog product analytics (lazy, guarded; see `docs/DEVELOPMENT.md` "Players, analytics and the admin page").
- `privacy/index.html`, `src/privacy/`: the public `/privacy` page (English and 繁體中文). Keep it true
  whenever what the game stores or sends changes.
- `admin/index.html`, `src/admin/`: the owner's `/admin` dashboard (admin-key login checked in the module; admin-only views).
- Other `src/` modules: rendering, soldier/viewmodel animation, effects, HUD, and audio.
- `spacetimedb/src/index.ts`: tables, reducers, lifecycle, and scheduled match tick.
- `src/module_bindings/`: generated client bindings; regenerate after module API changes.
- `public/assets/`, `public/fonts/`: runtime assets and licenses.
- `tools/`: asset conversion/fetch tools with their own dependencies; not runtime code.
- `dev/`: development-only map, model, soldier, and first-person weapon preview pages.

## Gameplay and authority

The rules follow BeGone (nplay): round-based Elimination and Sabotage (SWAT defends, Militia
arms the bomb), first to 10 rounds, 4 s freeze and 20 s buy time, BeGone's cash awards, its
weapons (knife, MP5, M4A1, M1014, M110, M249, M9A1, MP7, M67) and attachments with their exact
stats. Room sizes are 1v1, 6v6 and 24v24 (24v24 only on big maps: Meridian). Solo (bots fill
the room), Online (one database holds many rooms: Quick Play fills public rooms of a size and
rotates map and mode; private rooms take a 4-letter code; a room ticks only while humans are in it)
and a Practice range. Maps have ammo crates; bases are padded to
12 spawn slots. `shared/weapons.ts` and `shared/match/economy.ts` cite the BeGone numbers.

Online damage, scores, cash, purchases, crates, rounds, the bomb, bots and chat are server-controlled. Human
movement is client-predicted/reported and server-validated, not fully server-simulated.
Keep client and module simulation/schema compatible. Do not weaken validation to
hide synchronization failures. Test with separate client identities.

Player reducers only queue input; the scheduled tick applies it through the shared rules
(base, buy time and cash for purchases, reach and cash for ammo crates). Keep
that one-load-per-tick shape: per-reducer match loads do not scale to 100 soldiers.

## Local development

```sh
bun install --frozen-lockfile
bun install --cwd spacetimedb --frozen-lockfile
bun run dev
bun run test
bun run build
bun run typecheck:module
```

`bun run test` runs Vitest; `bun test` is a different runner.

For local Online play, run `bun run dev:spacetime` in one terminal, then:

```sh
VITE_SPACETIMEDB_URI=same-origin VITE_SPACETIMEDB_DATABASE=turfwar bun run dev
```

The dev server proxies `/stdb` to port **3000**. `same-origin` works only with this
Vite dev proxy—not `vite preview` or Vercel. The local backend script may reset
incompatible **disposable local** data; never use it against production.
In an Amp orb, use `amp orb services ensure` with `.amp/services.yaml`.

Regenerate bindings when needed:

```sh
spacetime generate --lang typescript --out-dir src/module_bindings --module-path spacetimedb
```

## Verification

- Run tests, build, and module typecheck for shared simulation/network changes.
- For rendering or animation changes, run and visually inspect representative states.
  Useful pages: `/dev/level.html`, `/dev/soldier.html`, `/dev/viewmodel.html`.
- For networking changes, verify separate clients join, replicate, and obey server
  validation/cooldowns. A successful build alone does not verify Online play.
- Target 60 fps on M-series Macs, but do not claim it from software-rendered orb tests.
  Use the deploy screen's 30-second performance check (`/?bench`).
- Known limits include all rooms sharing one database's reducer thread, no full lag compensation, and observed
  latency spikes/movement corrections. Do not present this as load-tested production.

## Git, environments, and release safety

- Source of truth: `https://github.com/madeyexz/turfwar` (renamed from `madeyexz/lawbreaker`; private
  until the owner makes it public). Never change its visibility or settings without the owner.
- Branches: **`main` = production** (Vercel production, game servers `turfwar` in Taipei (default) and Singapore); **`dev` =
  development** (every push is a Vercel preview wired to Maincloud `lawbreaker-dev`). Branch features
  off `dev`, commit, and merge back into `dev` with git (no pull requests). A release is merging `dev`
  into `main` and pushing, after publishing the module to the production database (see below); nothing
  reaches `main` otherwise.
- GitHub-backed Amp project: `https://ampcode.com/@ianhsiao/lawbreaker`.
- Mac development checkout: `/Users/ianhsiao/Developer/lawbreaker-release`.
- Mac and orbs are separate clones. Check `git status`, fetch/pull before work, and
  preserve uncommitted changes. Files are not automatically mirrored between machines.
- Pushing `main` triggers Vercel production deployment. Do not push or
  publish merely to test; obtain authorization for releases and shared-state changes.
- Frontend: `https://turfwar.ianhsiao.me` (production; `https://lawbreaker.vercel.app` still works, DNS for ianhsiao.me is on Cloudflare); `dev` previews are listed by `vercel ls`.
- Production game servers, both database **`turfwar`**: **Taipei**, the default — SpacetimeDB on a GCP VM in
  Taiwan, `wss://tw.turfwar.ianhsiao.me` (`deploy/gcp-taipei/`, always on) — and **Singapore** on InstaCloud,
  `wss://play.turfwar.ianhsiao.me` (`deploy/instacloud/`; it scales to zero and wakes on the next request).
  Taipei began as a copy of Singapore (signing keys included). The owner identity is in `~/.config/turfwar/`
  on the Mac, outside the repo; `bun run publish:prod` publishes to Taipei, Singapore and legacy Maincloud.
  InstaCloud's CLI is driven as `insta --agent …` from `deploy/instacloud/` (the linked directory).
- Maincloud databases, URI `wss://maincloud.spacetimedb.com`: legacy production **`3d-game-c4lhd`**
  (still published by `publish:prod` and readable in `/admin`), development **`lawbreaker-dev`**
  (publish `dev`'s module there freely; still never reset it while people test). Build-time public
  variables are `VITE_SPACETIMEDB_URI` and `VITE_SPACETIMEDB_DATABASE` (Vercel: Production → Taipei
  `turfwar`; Preview for branch `dev` → Maincloud `lawbreaker-dev`).
- Updating an existing database does not invoke the `init` lifecycle. Preserve the
  guarded first-join initialization and avoid duplicate tick schedules.
- Never reset production data (Taipei, Singapore or Maincloud). Authorized module releases must use `--delete-data=never`
  and stop on destructive migration requirements. Follow the release procedure in docs/DEVELOPMENT.md (Deploy),
  keep module and frontend compatible, and verify both after deployment.
