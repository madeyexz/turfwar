# Contributing to 角頭械鬥 · Turf War: Taipei

Thanks for helping. Bug fixes, new maps, better gunplay and animation, performance work,
translations and docs are all welcome. This page covers the workflow, setup, the checks a pull
request needs and the few rules that keep Online play safe.

## Workflow

`main` is production: every push to it deploys https://turfwar.ianhsiao.me. `dev` is development:
every push to it deploys a preview wired to the development database. All work goes through `dev`.

1. **Fork** the repository and clone your fork.
2. **Branch from `dev`**, never from `main`:
   ```sh
   git remote add upstream https://github.com/madeyexz/turfwar.git   # once
   git fetch upstream
   git switch -c my-change upstream/dev
   ```
3. **Make focused commits**: one logical change each, with a message that says what changed and why.
4. **Open the pull request against `dev`.** Never target `main` directly; pull requests to `main`
   are closed.
5. A maintainer reviews and merges it into `dev`. **Releases are maintainers merging `dev` into
   `main`** (after publishing the server module to the production database), which deploys
   production.

Keep a pull request to one topic. For anything large (a new mode, a new map, a schema change), open
an issue first so we can agree on the approach.

## Setup

You need **Bun 1.3.10** ([bun.sh](https://bun.sh)). Use `bun` / `bunx` for everything, never npm or npx.

```sh
bun install --frozen-lockfile
bun install --cwd spacetimedb --frozen-lockfile
bun run dev            # Vite dev server: Solo and Practice work right away
```

**Local Online play** needs the [SpacetimeDB CLI](https://spacetimedb.com/install) 2.10.2. In one
terminal start a local server and publish the module:

```sh
bun run dev:spacetime  # local server on :3000, module published as "lawbreaker"
```

and in another run the game against it:

```sh
VITE_SPACETIMEDB_URI=same-origin VITE_SPACETIMEDB_DATABASE=lawbreaker bun run dev
```

`same-origin` routes the websocket through the Vite dev server (`/stdb` → port 3000); it works only
there, not with `vite preview` or on Vercel. The local script may reset its own **disposable local**
data; never point it at a shared database. More flags, dev pages and check scripts are in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Checks before a pull request

```sh
bun run test              # Vitest. Note: `bun test` is a different runner and will not work.
bun run build             # type-check and production build
bun run typecheck:module  # the SpacetimeDB module
```

All three must pass. In addition:

- **Rendering, animation or UI changes:** include screenshots (before and after where it helps).
  Useful pages: `/dev/level.html?map=<id>`, `/dev/soldier.html`, `/dev/viewmodel.html`.
- **Networking or module changes:** check with **two clients** (two browsers or profiles, so two
  separate identities) on a local server: both join, see each other move and fight, and the server
  still refuses what it should (bad shots, purchases outside the buy window, teleports).
- **Performance-sensitive changes:** run the lobby's 30-second performance check (`/?bench`) and
  include the result.

### Pull request checklist

The same list is in the pull request template:

- [ ] Branched from `dev`; the pull request targets `dev`.
- [ ] Focused: one topic, with clear commit messages.
- [ ] `bun run test`, `bun run build` and `bun run typecheck:module` pass.
- [ ] Screenshots for rendering, animation or UI changes.
- [ ] Checked with two clients for networking or module changes.
- [ ] Module changes are additive (no data deletion) and the bindings are regenerated.
- [ ] Shared simulation stays browser-free; client and module stay compatible.
- [ ] New assets are CC0, OFL or compatible, with attribution added to the README.
- [ ] Docs updated where behaviour changed (README, `docs/`, the privacy page if data collection changed).

## Where code belongs

- `shared/`: environment-independent simulation: collision, movement, hit volumes, weapons,
  attachments and prices, thrown bodies, drivable vehicles and map definitions. **No browser APIs.**
- `shared/match/`: match state, combat validation, the economy (cash, store, crates), rounds and the
  bomb, bots, navigation, the packed per-tick frame and the simulation tick.
- `src/game/`: the client loop, player prediction and input, the Solo link, settings, the
  performance check.
- `src/net/online.ts`: the SpacetimeDB connection, replicated state, interpolation and intents.
- `src/analytics.ts`: product analytics. `privacy/index.html`: the privacy page.
- Other `src/` modules: rendering, soldier and view-model animation, effects, HUD, store, audio, i18n
  (`src/ui/i18n.ts`, English and 繁體中文).
- `spacetimedb/src/index.ts`: tables, reducers, lifecycle and the scheduled match tick.
- `src/module_bindings/`: generated client bindings (never edit by hand).
- `public/assets/`, `public/fonts/`: runtime assets and their licence files.
- `tools/`: asset conversion and fetch tools with their own dependencies; not runtime code.
- `dev/`: development-only preview pages.

## Rules

- **The server stays authoritative.** Online damage, scores, cash, purchases, crates, rounds, the
  bomb, bots and chat are decided by the server; movement is client-predicted and server-validated.
  Never weaken validation to hide a synchronisation problem; fix the cause.
- **Keep client and module compatible.** Both run the shared simulation; a change to it, to the
  schema or to a reducer must work for the client and the module together.
- **Module changes are additive.** Add tables, columns (with defaults) and reducers; never require
  deleting data. The production database is updated in place with `--delete-data=never`, and a
  migration that needs deletion cannot ship. After changing the module's API, regenerate the bindings:
  ```sh
  spacetime generate --lang typescript --out-dir src/module_bindings --module-path spacetimedb
  ```
- **Player reducers only queue input**; the scheduled tick applies it through the shared rules,
  loading each match once per tick. Keep that shape.
- **Shared simulation stays browser-free**: nothing in `shared/` may touch the DOM, `window`,
  `localStorage` or other browser APIs.
- **Assets must be CC0, OFL or a compatible licence**, with attribution in the README's
  [Assets and licenses](README.md#assets-and-licenses) section and licence files kept intact. No
  proprietary game assets.
- **Every player-facing string** goes through `src/ui/i18n.ts`, in English and Traditional Chinese.

## Code style

Match the surrounding code: TypeScript, small focused functions, comments that explain why, the
same naming and formatting as the file you are in. No new frameworks or runtime dependencies without
discussing it in an issue first.

## Reporting bugs and requesting features

Use [GitHub issues](https://github.com/madeyexz/turfwar/issues) with the bug or feature template.
For a bug, include what you did, what you expected and what happened, the map and mode, Solo or
Online, your browser and OS, and a screenshot or the console output if you can. Never post
secrets, keys or other people's data in an issue.

## Code of conduct

Be kind. Assume good intent, keep feedback about the work, and help newcomers. Harassment or
abuse of any kind is not tolerated, and maintainers may remove comments or block people who do it.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE),
the same as the rest of the code. Assets you add keep their own licence (CC0, OFL or compatible),
credited in the README.
