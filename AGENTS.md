# Lawbreaker // Frontline

Browser-first team FPS: credits, a buy menu, map pickups and flag fights from 8v8 arenas
to a 100-soldier city. Read `README.md`
for gameplay, architecture, asset attribution, known limits, and the demo script.
Improve playable gunplay, map flow, animation, and multiplayer—not only the HUD.

## Stack

- **Bun 1.3.10** for packages and scripts. Use `bun` / `bunx`, never npm/npx.
- **TypeScript + Vite + Three.js** for the browser. No React or Unity runtime.
- **Shared TypeScript simulation**, used by Solo and the server. Rapier was removed
  in the rebuild; do not assume the original prototype's physics engine remains.
- **SpacetimeDB 2.10.2** TypeScript module and client SDK for Online matches.
- **Vitest** for tests.
- **Vercel** serves the built frontend (static; there are no serverless routes).
- GLB characters/weapons and animations from CC0 Quaternius packs (buy-menu guns from the
  CC0 Ultimate Gun Pack via `tools/import-guns.ts`); CC0 Poly Haven
  textures; Rajdhani font under OFL. Keep license files and attribution intact.

## Where code belongs

- `shared/`: environment-independent simulation, collision, movement, hit volumes,
  weapons and prices, thrown bodies, and map definitions (with pickups). No browser APIs here.
- `shared/match/`: match state, combat validation, economy (credits, buying, pickups), bots,
  navigation, the packed per-tick frame, and the simulation tick.
- `src/game/`: client loop, player prediction/input, Solo link, settings, performance check.
- `src/net/online.ts`: SpacetimeDB connection, replicated state, interpolation, and intents.
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
stats. Solo (bots fill a chosen server size, Duel to Mega 12v12), Online (one match per database;
map and mode rotate each match) and a Practice range. Maps have ammo crates; bases are padded to
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
VITE_SPACETIMEDB_URI=same-origin VITE_SPACETIMEDB_DATABASE=lawbreaker bun run dev
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
- Known limits include one match per database, no full lag compensation, and observed
  latency spikes/movement corrections. Do not present this as load-tested production.

## Git, environments, and release safety

- Source of truth: `https://github.com/madeyexz/lawbreaker` (private).
- Shared development/default and Vercel production branch: **`main`**.
- GitHub-backed Amp project: `https://ampcode.com/@ianhsiao/lawbreaker`.
- Mac development checkout: `/Users/ianhsiao/Developer/lawbreaker-release`.
- Mac and orbs are separate clones. Check `git status`, fetch/pull before work, and
  preserve uncommitted changes. Files are not automatically mirrored between machines.
- Pushing `main` triggers Vercel production deployment. Do not push or
  publish merely to test; obtain authorization for releases and shared-state changes.
- Frontend: `https://lawbreaker.vercel.app`.
- Maincloud database: **`3d-game-c4lhd`**, URI `wss://maincloud.spacetimedb.com`.
  Build-time public variables are `VITE_SPACETIMEDB_URI` and `VITE_SPACETIMEDB_DATABASE`.
- Updating an existing database does not invoke the `init` lifecycle. Preserve the
  guarded first-join initialization and avoid duplicate tick schedules.
- Never reset Maincloud data. Authorized module releases must use `--delete-data=never`
  and stop on destructive migration requirements. Follow README's release procedure,
  keep module and frontend compatible, and verify both after deployment.
