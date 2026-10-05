# Lawbreaker // Frontline

A browser-first, keyboard-and-mouse team shooter in the spirit of fast browser FPS games like
Combat Online and Battlefield-style flag fights. Earn credits for kills and captures, buy your gun
from a 19-weapon arsenal, grab power weapons lying on the map, and take the flags across eight
original battlefields — from a castle and a freight yard to rooftops and a 100-soldier city —
against bots or real players through SpacetimeDB.

Built with Vite, TypeScript, Three.js and SpacetimeDB. Bun is the package manager and script
runner (`bun` / `bunx`, never npm/npx).

## What is in the game

| Area | Implemented |
| --- | --- |
| Modes | **Solo skirmish** (bots fill both teams: 6v6, or 50v50 on Meridian District; three difficulties), **Online match** (SpacetimeDB-authoritative, up to 100 soldiers; humans replace bots; maps rotate between rounds, skipping maps too small for the humans present), **Practice range** (no bots: try every gun and learn the maps). |
| Objective | Domination: capture A, B and C — five flags A–E on Meridian — (8 s solo capture, faster with more teammates, frozen while contested). Owned points tick team score; kills add score; first to 200 or most after 10 min wins, then a new round starts. |
| Battlefields | **Cinder Basin** (desert outpost: central plaza, comm bunkers, ridge watchtower, cargo yard), **Frostline Reach** (arctic relay: walled relay courtyard with gates and wall-top catwalks, rooftop towers, frozen trench with a bridge, crystal ridge), **Verdant Divide** (jungle uplink: uplink plateau, clearing bunkers, creek bed, tree cover). **Ochre Quarter** (desert old town: an original homage to the classic two-site layout of CS:GO's Dust II — Long with its doors, corner and pit, Mid with the crate and doors, Catwalk up to Short, roofed Tunnels — built from our own geometry and CC0 assets). **Meridian District** (400 × 280 m war-torn city for 50v50 Conquest: five points A–E — a wooded park on hills, a construction pit under a steel frame, and the central square at C decked over a drained canal, mirrored onto the far bank; three canal crossings with a walkable canal bed beneath them, elevated highways along both edges for long Recon lanes, a ruined block, enterable two-storey buildings with roof terraces, and a landmark tower over the core; every point has forward spawns for both teams that open while that team holds it uncontested and no enemy is within 25 m). **Citadel Keep** (8v8 hilltop castle: rampart walks over the gates, gatehouse barbicans with dry ditches, twin keeps over the inner courtyard, roofed galleries under the walls), **Railyard** (8v8 freight yard: four tracks of boxcars and tankers, engine sheds at A and C, two-storey depots with mezzanines, a footbridge and a turntable plaza at B) and **Skyline Rooftops** (8v8 rooftops 24–36 m above a city: steel bridges, a glazed sky-bridge, stairwells, a penthouse and an office floor — the street below is fatal). The first three lanes-and-flanks layouts are rotationally symmetric for fairness (tested), as are Meridian, Citadel, Railyard and Skyline; Ochre Quarter keeps its source's attacker/defender asymmetry on purpose (team 0 attacks from the south, A and C are the defenders' sites, B is Mid). Team spawns are protected by one-way energy shields. |
| Gunplay | Hitscan weapons with fire rate, magazines, timed reloads, hip/ADS/moving/air spread, per-shot bloom, recoil climb with partial recovery, view punch, damage falloff and head/leg multipliers. Kits: **Assault** (VX-7 pulse carbine + P-12 sidearm), **Recon** (L-90 scoped rail rifle + R-6 magnum), **Breacher** (S-8 pump scattergun firing a fixed 9-pellet pattern + K-9 full-auto machine pistol) and **Grenadier** (G-0 graviton launcher + P-12). Buy-menu arsenal (models from Quaternius' CC0 Ultimate Gun Pack): pistols **P-9 Hornet** and **D-50 Warden**; SMGs **M-5 Wasp** and **V-10 Viper**; shotguns **Twin-12 Reaper** (sawed-off double barrel) and **A-12 Thunder** (semi-auto); rifles **AR-4 Brawler** (hard-hitting, hard to hold), **BX-3 Kestrel** (accurate bullpup) and **DM-4 Marksman** (semi-auto DMR); snipers **S-3 Swift** and **B-50 Longbow** (bolt-action, one-shot headshots); LMG **H-70 Hammer** (100 rounds). Graviton charges and grenades (G) are physical bodies that arc under gravity; charges detonate on contact or near an enemy. The procedurally built S-8, K-9 and G-0 models live in `src/render/procguns.ts`. |
| Economy | Credits ($800 to start, max $16,000): $300 a kill (+$100 headshot) and $300 a capture. **B** opens the buy menu — every gun by category with its price, plus grenades — during the first 15 s after deploying or anywhere near your team's spawn. Bought weapons fill their slot (pistols secondary, everything else primary) with spare magazines, last until death and are rebought automatically on respawn while affordable. Reloads draw from spare ammo. Purchases are validated by the host. |
| Pickups | Every map places weapons, ammo crates and armor cells: **E** swaps in a lying weapon, ammo and armor are collected by walking over them, and each item respawns 20–45 s after being taken. Power weapons (rail rifle, graviton) sit in exposed spots. Bots buy guns when they deploy and grab better weapons they pass. |
| Movement | Shared deterministic controller: walk, sprint (with sprint-to-fire delay), crouch, slide (crouch while sprinting), jump with coyote time, step-up, ramps/stairs, team shields. |
| Feel | First-person rigged arms (cut from the soldier rig) posed by IK onto CC0 weapon models; procedural sway, figure-eight bob, kick, sprint carry, ADS with red-dot reticle, scope overlay, reload choreography with a magazine in hand, equip and grenade throw; muzzle flash, tracers, impact sparks and dust, bullet marks, explosions; hit markers, headshot/kill confirms, damage-direction arcs, kill feed, procedural WebAudio gunshots, reloads, footsteps and cues; a looping 60-second menu theme sequenced from those same effects. |
| Characters | CC0 rigged base body with an armored suit: helmet with glowing visor, plates, pack, pauldrons, bracers and boots as one rigid-skinned geometry (three draw calls per soldier). CC0 animation library retargeted by bone name: idle/walk/jog/sprint/crouch/jump/slide/death blend by speed, legs twist for strafing, cycles reverse when backpedalling, bladed rifle stance, aim pitch through the spine, two-bone arm IK onto the weapon, posed hands, hit flinches. |
| Bots | Navigation grid generated from each map (multi-level: roofs, catwalks, stairs), A* paths, objective selection that spreads the team, perception with field of view and line of sight, reaction delays, imperfect lead, aim error that settles, strafing and range keeping, burst fire, crouching, reloading and grenades at last-known positions. |
| Settings | Deploy screen: graphics preset (Low / Medium / High), mouse sensitivity, field of view (vertical, with the 16:9 horizontal equivalent), and a 30-second performance check. Saved per browser. |
| HUD | Score/objective bar, capture progress, world markers, teammate name tags, rotating minimap (enemies appear when they fire), vitals with regenerating shield, ammo with spare rounds, credits, buy-zone hint, pickup prompt, death screen with kit choice, scoreboard (Tab), end-of-round screen, buy menu. |

## Controls

| Input | Action |
| --- | --- |
| WASD · mouse | Move · look |
| LMB · RMB | Fire · aim down sights |
| Shift · Space | Sprint · jump |
| C or Ctrl | Crouch (while sprinting: slide) |
| R · Q / wheel · G | Reload · swap weapon · throw grenade |
| B · E | Buy menu · pick up the weapon at your feet |
| Tab · Esc | Scoreboard · release the mouse (pauses solo; click to resume, `M` for the deploy screen) |

## Multiplayer architecture

`spacetimedb/src/index.ts` runs the **same** `shared/match` simulation as solo play, server-side:

- Built for 100 soldiers per match. Player reducers only **queue** input: `report` overwrites the
  soldier's row in a private `inbox` (elapsed time accumulates for the movement budget) and `fire`,
  `grenade`, `reload_weapon`, `switch_slot`, `choose_loadout`, `buy` and `pickup_item` append to a
  private `command` queue. The 30 Hz scheduled `tick` loads the match **once**, applies every queued
  report and command in arrival order through the shared validation, runs bots, thrown bodies,
  pickups, objectives, scoring,
  respawns, round resets and map rotation, and saves. With no humans connected the tick idles.
- What clients subscribe to: `match` (slow fields only: phase, scores, map; rewritten only when
  they change), `roster` (name, team, kit, weapons, spare ammo, credits, alive, score line, respawn
  time; rewritten only on events), `player` (identity → soldier), the event table `match_event`
  (damage, kills, captures) and one `frame` row rewritten every tick: a packed binary snapshot
  (`shared/match/frame.ts`) of every soldier's pose and vitals (22 bytes each, 2 cm positions),
  grenades and charges, capture progress, pickup timers, the clock and that tick's shots. `soldier`, `point` and `body` keep full-precision
  server state and are not subscribed to; per-tick bookkeeping lives in a private `clock` row.
  Private `bot_brain` is unchanged. All original tables and columns remain — including the
  physics-law era's `history` table and law columns, now unused and written neutral — so an existing
  database migrates in place; leftover sentinel drones and bolts are dropped on the first save.
- Clients send their own movement (`report`, 20 Hz) and shots (`fire`) with an optional claimed hit.
  Movement spends a distance budget measured against server time (refills at 14 m/s, capped at
  6 m ≈ 0.7 s of sprinting), so reports that bunch up after a network stall pass but sending reports
  faster never buys distance; rising higher above the last floor than a jump plus a ledge step-up,
  or staying airborne for 2.5 s (longer than any fall on these maps), drops the soldier back down;
  bounds, solid geometry and enemy shields are enforced. Tests drive the real movement controller
  (sprints, slide-hops, jumps, a ledge step-up) through jittered, bunched delivery and expect zero
  corrections. Each shot
  claim is checked for alive shooter, weapon, magazine, fire rate (a client's fire clock may run at
  most 250 ms ahead, so slow weapons get no instant follow-up), origin near the shooter, range, line
  of sight through static geometry, a claimed point within a speed-scaled tolerance of the target's
  hit volumes, and no friendly fire. Damage, kills, scores, credits, purchases and pickups are
  authoritative. Bot shots are simulated entirely on the server.
- Client-side: own movement is predicted with the shared controller; remote soldiers and bodies are
  interpolated ~100 ms behind from the frame; a rejected position snaps the client back; dropped
  (idle) clients rejoin automatically. Online play was verified with two separate browser clients (different
  identities): they see each other move and fight through server validation — one client killed the other, both kill feeds showed it and the
  victim's death screen named the killer.
- Load test (local only): `bun scripts/loadtest.ts --uri ws://127.0.0.1:3100 --db <name> --clients 100`
  runs headless clients that move with the shared controller, fire validated shots and report the
  server tick rate, bytes per client, report round trips and corrections; it refuses non-local URIs.
  `bun scripts/simbench.ts meridian` times the simulation alone. On an M3 Pro with a local server, 100 clients
  on Meridian measured 30 ticks/s, ~84 KB/s per client (~8 MB/s total egress), report round trips
  of 6 / 9 / 12 ms (p50/p95/p99) and zero corrections; the previous one-load-per-reducer design
  measured ~517 KB/s per client and 51 / 147 / 225 ms. These are single-machine numbers, not a
  production load test: Maincloud capacity, real network latency and egress cost are unmeasured.
- Trust model and limits: movement is client-reported (validated, not simulated), hit detection is
  shooter-favoured within tolerances (no full lag compensation), and one match per database.

## Run, test and develop

```sh
bun install --frozen-lockfile
bun install --cwd spacetimedb --frozen-lockfile
bun run dev            # Vite dev server (solo and the practice range work immediately, offline after load)
bun run test           # Vitest (not `bun test`): physics, movement, collision, maps, bots, validation, economy, weapons
bun run build          # type-check + production build
bun run typecheck:module
```

Online play locally needs the [SpacetimeDB CLI](https://spacetimedb.com/install) (verified with 2.10.2):

```sh
bun run dev:spacetime  # starts a local server on :3000 and (re)publishes the module as "lawbreaker"
VITE_SPACETIMEDB_URI=same-origin VITE_SPACETIMEDB_DATABASE=lawbreaker bun run dev
```

`same-origin` routes the websocket through the dev server at `/stdb`, so a single URL serves the
game and the match server. After changing the module, regenerate client bindings with
`spacetime generate --lang typescript --out-dir src/module_bindings --module-path spacetimedb`.
In Amp orbs, `.amp/services.yaml` declares both services (`amp orb services ensure`).

Development pages (dev server only): `/dev/level.html?map=verdant` (battlefield preview),
`/dev/soldier.html` (animation/IK pose sheet), `/dev/viewmodel.html?ads=1` (first-person weapon),
`/dev/viewer.html?model=/assets/props.glb` (asset viewer). Dev-only URL flags `debuginput`,
`fixeddt` and `capture` make automated runs deterministic on software renderers.

## Deploy

Production: https://lawbreaker.vercel.app. The private GitHub repository
`madeyexz/lawbreaker` is connected to Vercel project `madeyexzs-projects/lawbreaker`, with
`main` as its shared development and production branch. Maincloud database: `3d-game-c4lhd`
(dashboard: https://spacetimedb.com/3d-game-c4lhd).

Vercel production build variables are `VITE_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com`
and `VITE_SPACETIMEDB_DATABASE=3d-game-c4lhd`. Do not use `same-origin` on Vercel; that proxy
exists only in the development server.

For module updates, run tests and module type checks, then publish non-destructively:

```sh
bun run test && bun run build && bun run typecheck:module
spacetime publish -s maincloud -p spacetimedb --delete-data=never --yes=remote,skip-login 3d-game-c4lhd
```

Stop if schema changes require deletion; never use the local development script for cloud
publication. On an existing empty starter database, the first valid join initializes the match
atomically; subsequent joins preserve its state. Publish the compatible module before pushing
the matching commit to `main`, which triggers Vercel's GitHub deployment.
Verify the production URL and two separate Online clients after each release.

## Assets and licenses

No proprietary game assets are used. Everything is original code or CC0/OFL:

- Characters, animations, weapons, props and modular kit pieces/trim sheets: free “Standard”
  editions of Quaternius' *Universal Base Characters*, *Universal Animation Library 1 & 2*,
  *Sci-Fi Essentials Kit* and *Modular Sci-Fi MegaKit* — CC0 1.0 (https://quaternius.com).
  Converted by `tools/import-assets.ts` (textures resized to WebP, animation tracks pruned and
  meshopt-compressed); see `public/assets/LICENSE.txt`.
- Buy-menu guns: twelve models from Quaternius' *Ultimate Gun Pack* — CC0 1.0
  (https://opengameart.org/content/low-poly-guns-pack). Converted from OBJ by `tools/import-guns.ts`
  (`bun tools/import-guns.ts`, with the pack extracted under `GUN_SRC`; `--preview <dir>` renders
  measured side views for placing grips, sights and muzzles) into `public/assets/guns.glb` (~270 KB).
- Terrain and surface textures: Poly Haven, CC0 1.0, fetched by `tools/fetch-textures.ts`; see
  `public/assets/tex/LICENSE.txt`.
- Font: Rajdhani by Indian Type Foundry, SIL Open Font License 1.1 (`public/fonts/OFL.txt`).
- Sky, planets, terrain, architecture, armor, effects and audio are procedural.
- Engine/libraries: Three.js (MIT), Vite (MIT). The `spacetimedb` npm package declares ISC
  but ships the SpacetimeDB Business Source License 1.1 text; the SpacetimeDB server/CLI is BSL 1.1.
  Review those terms before any commercial self-hosting.

The asset tools live in `tools/` with their own `package.json`; the source packs themselves are not
committed.

## Performance

Targets 60 fps on an M-series MacBook at the default *medium* preset (DPR ≤ 1, 2048 shadow map,
half-resolution bloom). Budgets: merged static geometry per material, one draw call set per soldier
(body + 3-part armor + weapon), at most three dynamic point lights (pooled muzzle/explosion flashes),
pooled effects. A typical firefight frame is ~150–420 draw calls and ~0.5 M triangles. Remote soldiers use a
crowd level of detail: off-screen soldiers are hidden and not animated; on screen, full animation and
shadows within 30 m, half-rate animation to 70 m, quarter rate beyond (positions update every frame).
Remote gunfire beyond 110 m is not drawn, gunshot audio is limited to 85 m and six voices per frame,
and at most eight teammate name tags show. Measured with the built-in check on an M3 Pro (Chrome,
medium, 1200×942): Solo 50v50 on Meridian ran 59.9 fps average with 0.2% of frames over 16.7 ms
and ~9 ms main-thread time (before the crowd LOD: 50 fps and 19 ms).

**Measure it yourself:** click *Run the 30-second performance check* on the deploy screen (or open
`/?bench`, optionally `&map=frostline&quality=high`). A scripted soldier runs the objective route
and fights through a solo skirmish for 30 s after a warm-up, then a panel reports average fps,
1% low, frame-time median/p95/p99, frames slower than 60 Hz, main-thread time per frame, hitches
over 100 ms, shader compiles during the run, draw calls, triangles, resolution and the GPU string,
with a verdict (met = average ≥ 58 fps and p95 ≤ 18.2 ms) and a *Copy results* button (JSON).
Browsers cap frames at the display refresh rate, so 120 Hz screens can exceed 60. The deploy screen
also has Low / Medium / High graphics presets (`?quality=` works too).

## Known limitations and what remains

- No full lag compensation or server-side rewind for hit validation; very high latency can make
  moving targets harder to hit or let claims fail validation.
- Movement is client-reported (validated). A determined cheater could still play within the
  limits the server allows (up to ~1.6× sprint speed sustained, short 6 m bursts, aim assistance).
- One match per database; no lobbies, parties, persistent progression or matchmaking.
- Every client receives every soldier's pose (no distance-based interest management), so bandwidth
  grows linearly with soldiers per match (~84 KB/s per client at 100). Every tick also writes the
  full soldier set to the database's durable log.
- Bots are deliberately simple at this scale: they look for enemies every 0.2–0.35 s and line-of-
  sight test only the four most pressing candidates.
- First-person and third-person animation is code-driven on CC0 clips; there are no authored
  rifle-specific reload/hit animations, and fingers are posed procedurally.
- Audio is synthesized; there are no recorded weapon samples.
- No dropped weapons on death, no attachments, and no per-player loadout persistence between sessions.
- Mobile/touch is not supported. Not tested on Safari/Firefox in this environment.

## 60-second demo script — one continuous shot

1. **0–6 s** — Deploy screen: choose *Solo skirmish*, *Citadel Keep*, *Assault*, *Veteran*. Click
   **Deploy**.
2. **6–16 s** — Press **B**: the buy menu lists every gun by category with its price. You start
   with $800 — buy the **P-9 Hornet** pistol ($400) and close it.
3. **16–30 s** — Sprint out of the spawn camp (Shift), slide behind cover at the gatehouse (C
   while sprinting), ADS (RMB) and win a firefight: hit markers, a kill confirm, +$300 in the
   corner.
4. **30–40 s** — Climb the bastion stairs to the exposed **L-90 rail rifle** pickup and press **E**
   to swap it in; pick a target across the courtyard.
5. **40–50 s** — Walk over an ammo crate (spare rounds refill) and an armor cell (vitals restore).
6. **50–60 s** — Capture B in the courtyard; die, respawn, and watch your last purchase being
   rebought automatically.

For the online version, open the game in two browsers and choose *Online match* in both: the
second player sees the first player's new gun in their hands and the pickup vanish when taken.

## Project layout

```
shared/        Pure TypeScript shared by browser, tests and the SpacetimeDB module
  collision.ts   AABB/ramp/heightfield world, raycasts, cylinder resolution
  movement.ts    Infantry controller        hitbox.ts  hit volumes      weapons.ts  tuning
  world.ts       Grenades and graviton charges under gravity
  maps/          Builder + eight battlefields (Cinder, Frostline, Verdant, Ochre, Citadel, Railyard,
                 Skyline, Meridian), pickups and forward spawns
  match/         State, simulation tick, combat validation, economy, bots, navigation, packed frame
src/           Browser client: game loop, prediction, rendering, view model, soldiers, HUD, audio, net
spacetimedb/   SpacetimeDB module (tables, scheduled tick, validated reducers)
scripts/       Local load test and simulation benchmark
tools/         Reproducible CC0 asset import and texture fetch scripts
dev/           Development preview pages
```

## References

[SpacetimeDB](https://spacetimedb.com/docs/) · [Three.js](https://threejs.org) ·
[Quaternius](https://quaternius.com) · [Poly Haven](https://polyhaven.com)
